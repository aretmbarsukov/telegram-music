import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../database.js';
import { parseYouTubeUrl, getPlaylist, getPlaylistItems, getVideo, YouTubeError } from '../youtube.js';
import { upsertYouTubeMetadata, metadataFailureUpdate } from '../youtube-cache.js';
import { syncYouTubeSource, SyncBusyError } from '../sync.js';
import { notifyAddedTracks } from '../telegram-notifications.js';
import { authHook, identity, idSchema, titleSchema, videoIdSchema } from './shared.js';

export function registerPlaylistRoutes(app: FastifyInstance): void {
  app.get('/api/playlists', { preHandler: authHook }, async request => {
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { telegramId: who.telegramId }, select: { id: true } });
    if (!user) return [];
    const rows = await db.playlist.findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { items: true } }, youtube: { select: { youtubeId: true, cachedTitle: true, cachedThumbnailUrl: true, metadataStatus: true, status: true, lastSuccessAt: true } } } });
    return rows.map(p => ({ id: p.id, name: p.title ?? p.youtube?.cachedTitle ?? 'YouTube playlist', createdAt: p.createdAt, updatedAt: p.updatedAt, trackCount: p._count.items, artworkUrl: p.artworkUrl ?? p.youtube?.cachedThumbnailUrl ?? null, youtube: p.youtube }));
  });

  app.post('/api/playlists', { preHandler: authHook }, async (request, reply) => {
    const parsed = z.object({ name: titleSchema }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid playlist name' });
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.upsert({ where: { telegramId: who.telegramId }, create: { ...who, settings: { create: {} } }, update: {} });
    const playlist = await db.playlist.create({ data: { userId: user.id, title: parsed.data.name } });
    return reply.code(201).send({ id: playlist.id, name: playlist.title, createdAt: playlist.createdAt, trackCount: 0 });
  });

  app.get('/api/playlists/:playlistId', { preHandler: authHook }, async (request, reply) => {
    const params = z.object({ playlistId: idSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid playlist id' });
    const who = identity(request);
    const db = getDatabase();
    const playlist = await db.playlist.findFirst({ where: { id: params.data.playlistId, user: { telegramId: who.telegramId } }, include: { items: { orderBy: { position: 'asc' }, include: { track: true } }, youtube: true } });
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });
    const metadata = await db.youTubeMetadata.findMany({ where: { videoId: { in: playlist.items.map(i => i.track.youtubeVideoId) } } });
    const cacheById = new Map(metadata.map(item => [item.videoId, item]));
    return { id: playlist.id, name: playlist.title ?? playlist.youtube?.cachedTitle ?? 'YouTube playlist', items: playlist.items.map(i => { const cache = cacheById.get(i.track.youtubeVideoId); return { id: i.id, itemId: i.id, origin: i.origin, position: i.position, track: { id: i.track.youtubeVideoId, title: i.customTitle ?? cache?.title ?? (cache?.status === 'EXPIRED' ? 'YouTube metadata expired' : 'YouTube video'), channel: cache?.channelTitle ?? null, thumbnail: cache?.thumbnailUrl ?? null, duration: cache?.duration ?? null, availability: cache?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE', metadataStatus: cache?.status ?? 'EXPIRED' } }; }), youtube: playlist.youtube };
  });

  app.patch('/api/playlists/:playlistId', { preHandler: authHook }, async (request, reply) => {
    const params = z.object({ playlistId: idSchema }).safeParse(request.params);
    const body = z.object({ name: titleSchema }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Invalid playlist update' });
    const who = identity(request);
    const db = getDatabase();
    const found = await db.playlist.findFirst({ where: { id: params.data.playlistId, user: { telegramId: who.telegramId } }, select: { id: true } });
    if (!found) return reply.code(404).send({ error: 'Playlist not found' });
    const p = await db.playlist.update({ where: { id: found.id }, data: { title: body.data.name } });
    return { id: p.id, name: p.title, updatedAt: p.updatedAt };
  });

  app.delete('/api/playlists/:playlistId', { preHandler: authHook }, async (request, reply) => {
    const params = z.object({ playlistId: idSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid playlist id' });
    const who = identity(request);
    const db = getDatabase();
    const found = await db.playlist.findFirst({ where: { id: params.data.playlistId, user: { telegramId: who.telegramId } }, select: { id: true } });
    if (!found) return reply.code(404).send({ error: 'Playlist not found' });
    await db.playlist.delete({ where: { id: found.id } });
    return reply.code(204).send();
  });

  app.post('/api/playlists/:playlistId/tracks', { preHandler: authHook }, async (request, reply) => {
    const params = z.object({ playlistId: idSchema }).safeParse(request.params);
    const body = z.object({ videoId: videoIdSchema, title: z.string().trim().max(300).optional(), channel: z.string().trim().max(200).optional() }).safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: 'Invalid track or playlist' });
    const who = identity(request);
    const db = getDatabase();
    const playlist = await db.playlist.findFirst({ where: { id: params.data.playlistId, user: { telegramId: who.telegramId } }, select: { id: true } });
    if (!playlist) return reply.code(404).send({ error: 'Playlist not found' });
    const data = body.data;
    try {
      const result = await db.$transaction(async tx => {
        const track = await tx.track.upsert({ where: { youtubeVideoId: data.videoId }, create: { youtubeVideoId: data.videoId }, update: {} });
        const duplicate = await tx.playlistItem.findFirst({ where: { playlistId: playlist.id, trackId: track.id } });
        if (duplicate) throw Object.assign(new Error('Track already exists in this playlist'), { code: 'P2002' });
        const count = await tx.playlistItem.count({ where: { playlistId: playlist.id } });
        const cache = await tx.youTubeMetadata.findUnique({ where: { videoId: data.videoId }, select: { status: true } });
        const item = await tx.playlistItem.create({ data: { playlistId: playlist.id, trackId: track.id, origin: 'LOCAL', customTitle: cache?.status === 'FRESH' ? null : (data.title || null), position: count } });
        await tx.playlist.update({ where: { id: playlist.id }, data: { updatedAt: new Date() } });
        return item;
      });
      return reply.code(201).send({ id: result.id, videoId: data.videoId, origin: 'LOCAL' });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return reply.code(409).send({ error: 'Track already exists in this playlist' });
      throw error;
    }
  });

  app.post('/api/youtube/preview', { preHandler: authHook, config: { rateLimit: { max: 20, timeWindow: '1 hour' } } }, async (request, reply) => {
    const body = z.object({ url: z.string().trim().min(1).max(2048) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid YouTube URL' });
    const parsed = parseYouTubeUrl(body.data.url);
    if (!parsed) return reply.code(400).send({ error: 'Unsupported YouTube link' });
    const db = getDatabase();
    if (parsed.kind === 'video') {
      let video: Awaited<ReturnType<typeof getVideo>>;
      try { video = await getVideo(parsed.id); }
      catch (error) {
        const cached = await db.youTubeMetadata.findUnique({ where: { videoId: parsed.id } });
        if (cached) await db.youTubeMetadata.update({ where: { videoId: parsed.id }, data: metadataFailureUpdate(cached.refreshedAt, new Date(), error instanceof YouTubeError ? error.reason : 'preview_error') });
        throw error;
      }
      const now = new Date();
      await db.youTubeMetadata.upsert({ where: { videoId: parsed.id }, create: { videoId: parsed.id, title: video.title, channelTitle: video.channel, thumbnailUrl: video.thumbnail, duration: video.duration, status: 'FRESH', refreshedAt: now, lastAttemptAt: now }, update: { title: video.title, channelTitle: video.channel, thumbnailUrl: video.thumbnail, duration: video.duration, status: 'FRESH', refreshedAt: now, lastAttemptAt: now, retryAt: null, lastErrorCode: null } });
      return { kind: 'video', ...video };
    }
    const playlist = await getPlaylist(parsed.id);
    return { kind: 'playlist', ...playlist };
  });

  app.post('/api/youtube/import', { preHandler: authHook, config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, async (request, reply) => {
    const body = z.object({ url: z.string().trim().min(1).max(2048) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid YouTube playlist URL' });
    const parsed = parseYouTubeUrl(body.data.url);
    if (!parsed || parsed.kind !== 'playlist') return reply.code(400).send({ error: 'A YouTube playlist link is required' });
    const who = identity(request);
    const db = getDatabase();
    const [remote, remoteItems] = await Promise.all([getPlaylist(parsed.id), getPlaylistItems(parsed.id)]);
    const unique = [...new Map(remoteItems.filter(item => item.videoId).map(item => [item.videoId!, item])).values()];
    const user = await db.user.upsert({ where: { telegramId: who.telegramId }, create: { ...who, settings: { create: {} } }, update: {} });
    const already = await db.youTubeSource.findUnique({ where: { ownerUserId_youtubeId: { ownerUserId: user.id, youtubeId: parsed.id } }, select: { playlistId: true } });
    if (already) return reply.code(409).send({ error: 'This YouTube playlist is already in your library', playlistId: already.playlistId });
    let playlist: Awaited<ReturnType<typeof db.playlist.create>>;
    try {
      playlist = await db.$transaction(async tx => {
        const importedAt = new Date();
        const created = await tx.playlist.create({ data: { userId: user.id, title: null, artworkUrl: null } });
        const source = await tx.youTubeSource.create({ data: { playlistId: created.id, ownerUserId: user.id, youtubeId: remote.id, cachedTitle: remote.title, cachedThumbnailUrl: remote.thumbnail, metadataStatus: 'FRESH', metadataAt: importedAt, status: 'SUCCESS', lastSuccessAt: importedAt, nextSyncAt: new Date(importedAt.getTime() + 30 * 60_000) } });
        const trackIds: string[] = [];
        for (const item of unique) {
          const track = await tx.track.upsert({ where: { youtubeVideoId: item.videoId! }, create: { youtubeVideoId: item.videoId! }, update: {} });
          await upsertYouTubeMetadata(tx, item, importedAt);
          trackIds.push(track.id);
        }
        if (unique.length) await tx.playlistItem.createMany({ data: unique.map((item, index) => ({ playlistId: created.id, trackId: trackIds[index]!, origin: 'YOUTUBE_SYNC' as const, sourceItemId: item.sourceItemId, position: index })) });
        await tx.syncHistory.create({ data: { sourceId: source.id, status: 'SUCCESS', finishedAt: new Date(), added: unique.length } });
        return created;
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return reply.code(409).send({ error: 'This YouTube playlist is already in your library' });
      throw error;
    }
    return reply.code(201).send({ id: playlist.id, name: remote.title, sourcePlaylistId: remote.id, trackCount: unique.length, unavailableCount: remoteItems.filter(item => !item.videoId || item.availability !== 'AVAILABLE').length });
  });

  app.post('/api/playlists/:playlistId/sync', { preHandler: authHook, config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const params = z.object({ playlistId: idSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid playlist id' });
    const who = identity(request);
    const db = getDatabase();
    const source = await db.youTubeSource.findFirst({ where: { playlistId: params.data.playlistId, playlist: { user: { telegramId: who.telegramId } } }, select: { id: true } });
    if (!source) return reply.code(404).send({ error: 'Synchronized playlist not found' });
    try {
      const result = await syncYouTubeSource(db, source.id);
      await notifyAddedTracks(db, source.id, result.addedTracks);
      return result;
    } catch (error) {
      if (error instanceof SyncBusyError) return reply.code(409).send({ error: 'Synchronization is already running' });
      if (error instanceof YouTubeError) return reply.code(error.statusCode).send({ error: error.message, reason: error.reason });
      throw error;
    }
  });

  app.delete('/api/playlists/:playlistId/tracks/:itemId', { preHandler: authHook }, async (request, reply) => {
    const params = z.object({ playlistId: idSchema, itemId: idSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid item id' });
    const who = identity(request);
    const db = getDatabase();
    const item = await db.playlistItem.findFirst({ where: { id: params.data.itemId, playlistId: params.data.playlistId, playlist: { user: { telegramId: who.telegramId } } }, select: { id: true, playlistId: true, position: true } });
    if (!item) return reply.code(404).send({ error: 'Track not found' });
    await db.$transaction([
      db.playlistItem.delete({ where: { id: item.id } }),
      db.playlistItem.updateMany({ where: { playlistId: item.playlistId, position: { gt: item.position } }, data: { position: { decrement: 1 } } }),
      db.playlist.update({ where: { id: item.playlistId }, data: { updatedAt: new Date() } }),
    ]);
    return reply.code(204).send();
  });
}
