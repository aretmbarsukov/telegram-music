import type { PrismaClient } from './generated/prisma/client.js';
import { getPlaylist, getPlaylistItems, YouTubeError } from './youtube.js';
import { upsertYouTubeMetadata, cacheFailureState, metadataFailureUpdate } from './youtube-cache.js';

export class SyncBusyError extends Error {}

export function summarizeSync(beforeIds: string[], afterIds: string[], localIds: Set<string>) {
  const beforeSet = new Set(beforeIds); const afterSet = new Set(afterIds);
  const added = afterIds.filter(id => !beforeSet.has(id) && !localIds.has(id)).length;
  const removed = beforeIds.filter(id => !afterSet.has(id)).length;
  const oldCommon = beforeIds.filter(id => afterSet.has(id) && !localIds.has(id));
  const newCommon = afterIds.filter(id => beforeSet.has(id) && !localIds.has(id));
  const reordered = oldCommon.some((id, index) => newCommon[index] !== id);
  return { added, removed, reordered };
}

export async function syncYouTubeSource(db: PrismaClient, sourceId: string) {
  const source = await db.youTubeSource.findUnique({ where: { id: sourceId }, include: { playlist: { select: { id: true } } } });
  if (!source) throw new YouTubeError('YouTube source not found', 404, 'source_not_found');
  const now = new Date();
  const claim = await db.youTubeSource.updateMany({
    where: { id: source.id, OR: [{ status: { not: 'RUNNING' } }, { lastAttemptAt: { lt: new Date(now.getTime() - 30 * 60_000) } }] },
    data: { status: 'RUNNING', lastAttemptAt: now, lastError: null },
  });
  if (claim.count === 0) throw new SyncBusyError('A synchronization is already running');
  const history = await db.syncHistory.create({ data: { sourceId: source.id, status: 'RUNNING' } });
  try {
    const [remotePlaylist, remoteItems] = await Promise.all([getPlaylist(source.youtubeId), getPlaylistItems(source.youtubeId)]);
    const valid = remoteItems.filter((item): item is typeof item & { videoId: string } => Boolean(item.videoId));
    const unique = [...new Map(valid.map(item => [item.videoId, item])).values()];
    const before = await db.playlistItem.findMany({ where: { playlistId: source.playlistId, origin: 'YOUTUBE_SYNC' }, select: { track: { select: { youtubeVideoId: true } }, position: true } });
    const localsBefore = await db.playlistItem.findMany({ where: { playlistId: source.playlistId, origin: 'LOCAL' }, select: { id: true, trackId: true, position: true, track: { select: { youtubeVideoId: true } } }, orderBy: { position: 'asc' } });
    const beforeIds = before.map(item => item.track.youtubeVideoId);
    const newIds = unique.map(item => item.videoId);
    const localIds = new Set(localsBefore.map(item => item.track.youtubeVideoId));
    const syncedItems = unique.filter(item => !localIds.has(item.videoId));
    const summary = summarizeSync(beforeIds, newIds, localIds);
    const beforeSet = new Set(beforeIds);
    const addedTracks = syncedItems.filter(item => !beforeSet.has(item.videoId)).map(item => ({ videoId: item.videoId, title: item.title }));
    await db.$transaction(async tx => {
      const trackRows = [] as { id: string; youtubeVideoId: string }[];
      for (const item of unique) {
        const track = await tx.track.upsert({
          where: { youtubeVideoId: item.videoId },
          create: { youtubeVideoId: item.videoId },
          update: {},
          select: { id: true, youtubeVideoId: true },
        });
        await upsertYouTubeMetadata(tx, item, now);
        trackRows.push(track);
      }
      await tx.playlistItem.deleteMany({ where: { playlistId: source.playlistId, origin: 'YOUTUBE_SYNC' } });
      if (syncedItems.length) await tx.playlistItem.createMany({ data: syncedItems.map(item => { const index = unique.indexOf(item); return { playlistId: source.playlistId, trackId: trackRows[index]!.id, sourceItemId: item.sourceItemId, origin: 'YOUTUBE_SYNC' as const, position: syncedItems.indexOf(item) }; }) });
      const locals = await tx.playlistItem.findMany({ where: { playlistId: source.playlistId, origin: 'LOCAL' }, orderBy: { position: 'asc' }, select: { id: true } });
      for (const [index, item] of locals.entries()) await tx.playlistItem.update({ where: { id: item.id }, data: { position: syncedItems.length + index } });
      await tx.youTubeSource.update({ where: { id: source.id }, data: { status: 'SUCCESS', cachedTitle: remotePlaylist.title, cachedThumbnailUrl: remotePlaylist.thumbnail, metadataStatus: 'FRESH', metadataAt: now, metadataRetryAt: null, lastSuccessAt: now, lastAttemptAt: now, nextSyncAt: new Date(now.getTime() + source.intervalMins * 60_000), lastError: null } });
      await tx.syncHistory.update({ where: { id: history.id }, data: { status: 'SUCCESS', finishedAt: new Date(), added: summary.added, removed: summary.removed, reordered: summary.reordered ? 1 : 0 } });
    });
    return { ...summary, addedTracks, unavailable: remoteItems.filter(item => !item.videoId || item.availability !== 'AVAILABLE').length, total: unique.length, syncedAt: now };
  } catch (error) {
    const unavailable = error instanceof YouTubeError && (error.reason === 'playlist_unavailable' || error.reason === 'playlistNotFound');
    const message = error instanceof Error ? error.message.slice(0, 250) : 'Unknown sync error';
    const failedAt = new Date();
    const refs = await db.playlistItem.findMany({ where: { playlistId: source.playlistId, origin: 'YOUTUBE_SYNC' }, select: { track: { select: { youtubeVideoId: true } } } });
    const ids = [...new Set(refs.map(item => item.track.youtubeVideoId))];
    const cacheRows = ids.length ? await db.youTubeMetadata.findMany({ where: { videoId: { in: ids } } }) : [];
    const errorCode = error instanceof YouTubeError ? error.reason.slice(0, 64) : 'sync_error';
    await db.$transaction([
      db.youTubeSource.update({ where: { id: source.id }, data: { status: unavailable ? 'UNAVAILABLE' : 'FAILED', metadataStatus: cacheFailureState(source.metadataAt, new Date()), ...(cacheFailureState(source.metadataAt, new Date()) === 'EXPIRED' ? { cachedTitle: null, cachedThumbnailUrl: null, metadataRetryAt: null } : { metadataRetryAt: new Date(Date.now() + 6 * 60 * 60_000) }), lastAttemptAt: new Date(), nextSyncAt: new Date(Date.now() + (unavailable ? 60 : 5) * 60_000), lastError: message } }),
      db.syncHistory.update({ where: { id: history.id }, data: { status: unavailable ? 'UNAVAILABLE' : 'FAILED', finishedAt: new Date(), errorCode: error instanceof YouTubeError ? error.reason : 'sync_error' } }),
      ...cacheRows.map(cache => db.youTubeMetadata.update({ where: { videoId: cache.videoId }, data: metadataFailureUpdate(cache.refreshedAt, failedAt, errorCode) })),
    ]);
    throw error;
  }
}
