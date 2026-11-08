import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const botToken = 'integration-test-token';
const apiKey = 'integration-test-api-key';
const playlistId = `PLint${Date.now().toString(36)}`;
const videoA = 'AAAA0000001';
const videoB = 'BBBB0000002';
const videoC = 'CCCC0000003';
const videoD = 'DDDD0000004';
const localVideo = 'LOCL0000005';
const previewVideo = 'THUMB000001';
const previewThumbnail = `https://i.ytimg.com/vi/${previewVideo}/hqdefault.jpg`;
const remotePlaylistItems = [videoA, videoB, videoC];
let pg: PGlite | undefined;
let pgServer: PGLiteSocketServer | undefined;
let app: Awaited<ReturnType<typeof import('./server.js').createApp>>;
let originalFetch: typeof fetch;
let remoteIds = remotePlaylistItems;

function telegramAuth(userId: number) {
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: userId, first_name: `Test ${userId}` }) });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return `tma ${params.toString()}`;
}

before(async () => {
  process.env.NODE_ENV = 'test';
  const neonTestUrl = process.env.NEON_TEST_DATABASE_URL;
  if (neonTestUrl) process.env.DATABASE_URL = neonTestUrl;
  else process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/telegram_music_test';
  process.env.TELEGRAM_BOT_TOKEN = botToken;
  process.env.BOT_TOKEN = botToken;
  process.env.YOUTUBE_API_KEY = apiKey;
  process.env.DEV_AUTH_ENABLED = 'true';
  process.env.YOUTUBE_MOCK_MODE = 'false';
  process.env.DEV_AUTH_USER_ID = '100000001';

  if (!neonTestUrl) {
    pg = await PGlite.create();
    await pg.exec(await readFile('prisma/migrations/0001_init/migration.sql', 'utf8'));
    await pg.exec(await readFile('prisma/migrations/0002_separate_youtube_cache/migration.sql', 'utf8'));
    await pg.exec(await readFile('prisma/migrations/0003_bot_notifications/migration.sql', 'utf8'));
    pgServer = new PGLiteSocketServer({ db: pg, host: '127.0.0.1', port: 0, maxConnections: 10 });
    await pgServer.start();
    process.env.DATABASE_URL = `postgresql://postgres:postgres@${pgServer.getServerConn()}/postgres`;
  }

  const serverModule = await import('./server.js');
  app = await serverModule.createApp();
  await app.ready();
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.json().devAuthEnabled, true);
  assert.equal(health.json().devAuthUserId, '100000001');
  assert.equal(health.json().youtubeMockEnabled, false);
  const publicHealth = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(publicHealth.statusCode, 200);
  assert.equal(publicHealth.json().ok, true);
  const home = await app.inject({ method: 'GET', url: '/' });
  const csp = home.headers['content-security-policy'];
  assert.ok(csp);
  assert.match(csp, /script-src[^;]*https:\/\/www\.youtube\.com/);
  assert.match(csp, /script-src[^;]*https:\/\/telegram\.org/);
  assert.match(csp, /frame-src[^;]*https:\/\/www\.youtube\.com[^;]*https:\/\/www\.youtube-nocookie\.com/);
  assert.match(csp, /img-src[^;]*https:\/\/i\.ytimg\.com[^;]*data:/);
  assert.match(csp, /connect-src[^;]*'self'[^;]*https:\/\/telegram\.org/);
  assert.match(csp, /frame-ancestors[^;]*web\.telegram\.org/);
  assert.equal(home.headers['permissions-policy'], 'autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com"), encrypted-media=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")');
  assert.equal(home.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(home.headers['x-frame-options'], undefined);

  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, 'https://www.googleapis.com', 'integration tests must not make external requests');
    assert.equal(url.searchParams.get('key'), apiKey);
    if (url.pathname.endsWith('/playlists')) {
      return Response.json({ items: [{ id: playlistId, snippet: { title: 'Fixture Playlist', thumbnails: { medium: { url: 'https://example.test/playlist.jpg' } } }, contentDetails: { itemCount: remoteIds.length }, status: { privacyStatus: 'public' } }] });
    }
    if (url.pathname.endsWith('/playlistItems')) {
      return Response.json({ items: remoteIds.map((id, index) => ({ id: `source-${index}-${id}`, snippet: { title: `Title ${id}`, channelTitle: 'Fixture Channel', resourceId: { videoId: id } }, contentDetails: { videoId: id } })) });
    }
    if (url.pathname.endsWith('/videos')) {
      const ids = (url.searchParams.get('id') ?? '').split(',');
      if (ids.includes(previewVideo)) return Response.json({ items: [{ id: previewVideo, snippet: { title: 'Verified thumbnail fixture', channelTitle: 'YouTube Developers', thumbnails: { high: { url: previewThumbnail } } }, contentDetails: { duration: 'PT2M30S' } }] });
      throw new Error('Mocked YouTube Data API transport failure');
    }
    throw new Error(`Unexpected YouTube API endpoint: ${url.pathname}`);
  }) as typeof fetch;
});

after(async () => {
  if (app) await app.close();
  if (originalFetch) globalThis.fetch = originalFetch;
  if (pgServer) await pgServer.stop();
  if (pg) await pg.close();
});

test('imports a mocked public playlist, deduplicates videos, reconciles sync, preserves local items and isolates owners', async () => {
  const user1Headers = { 'x-dev-user-id': '100000001' };
  const imported = await app.inject({ method: 'POST', url: '/api/youtube/import', headers: user1Headers, payload: { url: `https://www.youtube.com/playlist?list=${playlistId}` } });
  assert.equal(imported.statusCode, 201, imported.body);
  assert.equal(imported.json().trackCount, 3);
  const playlistIdInDb = imported.json().id as string;
  const playlistDb = (await import('./database.js')).getDatabase();
  const importedItems = await playlistDb.playlistItem.findMany({ where: { playlistId: playlistIdInDb }, orderBy: { position: 'asc' }, include: { track: true } });
  assert.deepEqual(importedItems.map(item => item.track.youtubeVideoId), remotePlaylistItems);

  const local = await app.inject({ method: 'POST', url: `/api/playlists/${playlistIdInDb}/tracks`, headers: user1Headers, payload: { videoId: localVideo, title: 'My local title' } });
  assert.equal(local.statusCode, 201, local.body);

  // Two duplicate entries in the remote source collapse to one membership per video ID.
  remoteIds = [videoC, videoA, videoD, videoD];
  const sync = await app.inject({ method: 'POST', url: `/api/playlists/${playlistIdInDb}/sync`, headers: user1Headers });
  assert.equal(sync.statusCode, 200, sync.body);
  assert.deepEqual({ added: sync.json().added, removed: sync.json().removed, reordered: sync.json().reordered }, { added: 1, removed: 1, reordered: true });

  const finalItems = await playlistDb.playlistItem.findMany({ where: { playlistId: playlistIdInDb }, orderBy: { position: 'asc' }, include: { track: true } });
  assert.deepEqual(finalItems.map(item => item.track.youtubeVideoId), [videoC, videoA, videoD, localVideo]);
  assert.equal(finalItems.filter(item => item.track.youtubeVideoId === videoD).length, 1);
  assert.equal(finalItems.find(item => item.track.youtubeVideoId === localVideo)?.origin, 'LOCAL');
  assert.equal(finalItems.find(item => item.track.youtubeVideoId === localVideo)?.customTitle, 'My local title');

  const ownerFailure = await app.inject({ method: 'GET', url: `/api/playlists/${playlistIdInDb}`, headers: { authorization: telegramAuth(200000002) } });
  assert.equal(ownerFailure.statusCode, 404);
  const otherUserList = await app.inject({ method: 'GET', url: '/api/playlists', headers: { authorization: telegramAuth(200000002) } });
  assert.deepEqual(otherUserList.json(), []);
});

test('persists and returns the YouTube video ID and thumbnail for a locally added video', async () => {
  const headers = { 'x-dev-user-id': '100000001' };
  const database = (await import('./database.js')).getDatabase();
  const created = await app.inject({ method: 'POST', url: '/api/playlists', headers, payload: { name: 'Thumbnail fixture playlist' } });
  assert.equal(created.statusCode, 201);
  const playlistIdInDb = created.json().id as string;
  const preview = await app.inject({ method: 'POST', url: '/api/youtube/preview', headers, payload: { url: `https://www.youtube.com/watch?v=${previewVideo}` } });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.deepEqual({ kind: preview.json().kind, videoId: preview.json().videoId, thumbnail: preview.json().thumbnail }, { kind: 'video', videoId: previewVideo, thumbnail: previewThumbnail });
  const added = await app.inject({ method: 'POST', url: `/api/playlists/${playlistIdInDb}/tracks`, headers, payload: { videoId: previewVideo, title: 'Verified thumbnail fixture' } });
  assert.equal(added.statusCode, 201, added.body);
  const detail = await app.inject({ method: 'GET', url: `/api/playlists/${playlistIdInDb}`, headers });
  assert.equal(detail.statusCode, 200);
  assert.deepEqual({ videoId: detail.json().items[0].track.id, thumbnail: detail.json().items[0].track.thumbnail }, { videoId: previewVideo, thumbnail: previewThumbnail });
  const cached = await database.youTubeMetadata.findUnique({ where: { videoId: previewVideo } });
  assert.equal(cached?.thumbnailUrl, previewThumbnail);
});

test('expires old YouTube cache without deleting playlists, local tracks, favorites, or playback history', async () => {
  const database = (await import('./database.js')).getDatabase();
  const user = await database.user.create({ data: { telegramId: BigInt(Date.now()) * 100_000n + 300000003n, firstName: 'Cache cleanup owner' } });
  const playlist = await database.playlist.create({ data: { userId: user.id, title: 'Keep this playlist' } });
  const cleanupVideoId = `K${Date.now().toString(36).slice(-10).padStart(10, '0')}`;
  const track = await database.track.create({ data: { youtubeVideoId: cleanupVideoId } });
  await database.playlistItem.create({ data: { playlistId: playlist.id, trackId: track.id, origin: 'LOCAL', customTitle: 'Keep my title', position: 0 } });
  await database.favorite.create({ data: { userId: user.id, trackId: track.id } });
  await database.playbackHistory.create({ data: { userId: user.id, trackId: track.id, playedAt: new Date() } });
  await database.youTubeMetadata.create({ data: { videoId: track.youtubeVideoId, title: 'Old API title', channelTitle: 'Old API channel', thumbnailUrl: 'https://example.test/old.jpg', duration: 'PT3M', refreshedAt: new Date(Date.now() - 31 * 86_400_000), lastAttemptAt: new Date(Date.now() - 31 * 86_400_000) } });

  const before = {
    playlists: await database.playlist.count({ where: { userId: user.id } }),
    items: await database.playlistItem.count({ where: { playlistId: playlist.id } }),
    tracks: await database.track.count({ where: { id: track.id } }),
    favorites: await database.favorite.count({ where: { userId: user.id } }),
    history: await database.playbackHistory.count({ where: { userId: user.id } }),
  };
  const { maintainYouTubeMetadata } = await import('./worker.js');
  const oldError = console.error;
  const oldInfo = console.info;
  console.error = () => {};
  console.info = () => {};
  try { await maintainYouTubeMetadata(database); }
  finally { console.error = oldError; console.info = oldInfo; }

  const after = {
    playlists: await database.playlist.count({ where: { userId: user.id } }),
    items: await database.playlistItem.count({ where: { playlistId: playlist.id } }),
    tracks: await database.track.count({ where: { id: track.id } }),
    favorites: await database.favorite.count({ where: { userId: user.id } }),
    history: await database.playbackHistory.count({ where: { userId: user.id } }),
  };
  assert.deepEqual(after, before);
  const retained = await database.playlistItem.findFirst({ where: { playlistId: playlist.id }, include: { track: true } });
  assert.equal(retained?.origin, 'LOCAL');
  assert.equal(retained?.customTitle, 'Keep my title');
  assert.equal(retained?.track.youtubeVideoId, track.youtubeVideoId);
  assert.equal(await database.favorite.count({ where: { userId: user.id, trackId: track.id } }), 1);
  assert.equal(await database.playbackHistory.count({ where: { userId: user.id, trackId: track.id } }), 1);
  const expired = await database.youTubeMetadata.findUnique({ where: { videoId: track.youtubeVideoId } });
  assert.equal(expired?.status, 'EXPIRED');
  assert.equal(expired?.title, null);
  assert.equal(expired?.channelTitle, null);
  assert.equal(expired?.thumbnailUrl, null);
  assert.equal(expired?.duration, null);
});

test('playlist API supports create, rename, listing and delete', async () => {
  const headers = { 'x-dev-user-id': '100000001' };
  const created = await app.inject({ method: 'POST', url: '/api/playlists', headers, payload: { name: 'CRUD test playlist' } });
  assert.equal(created.statusCode, 201);
  const id = created.json().id as string;
  const renamed = await app.inject({ method: 'PATCH', url: `/api/playlists/${id}`, headers, payload: { name: 'Renamed CRUD playlist' } });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().name, 'Renamed CRUD playlist');
  const list = await app.inject({ method: 'GET', url: '/api/playlists', headers });
  assert.equal(list.json().some((playlist: { id: string }) => playlist.id === id), true);
  const deleted = await app.inject({ method: 'DELETE', url: `/api/playlists/${id}`, headers });
  assert.equal(deleted.statusCode, 204);
  const missing = await app.inject({ method: 'GET', url: `/api/playlists/${id}`, headers });
  assert.equal(missing.statusCode, 404);
});

test('playback history is written and read only for the authenticated user', async () => {
  const owner = { 'x-dev-user-id': '100000001' };
  const recorded = await app.inject({ method: 'POST', url: '/api/history', headers: owner, payload: { videoId: 'HIST0000001' } });
  assert.equal(recorded.statusCode, 201);
  assert.equal(recorded.json().videoId, 'HIST0000001');
  const ownerHistory = await app.inject({ method: 'GET', url: '/api/history', headers: owner });
  assert.equal(ownerHistory.json().some((row: { videoId: string }) => row.videoId === 'HIST0000001'), true);
  const otherHistory = await app.inject({ method: 'GET', url: '/api/history', headers: { authorization: telegramAuth(400000004) } });
  assert.deepEqual(otherHistory.json(), []);
});

test('notification setting defaults on and is persisted in the shared user settings row', async () => {
  const database = (await import('./database.js')).getDatabase();
  const user = await database.user.create({ data: { telegramId: BigInt(Date.now()) * 100_000n + 500000005n, firstName: 'Notification preference owner' } });
  const settings = await database.userSettings.create({ data: { userId: user.id } });
  assert.equal(settings.notificationsEnabled, true);
  const updated = await database.userSettings.update({ where: { userId: user.id }, data: { notificationsEnabled: false } });
  assert.equal(updated.notificationsEnabled, false);
});
