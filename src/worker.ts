import { config } from './config.js';
import { getDatabase, closeDatabase } from './database.js';
import { syncYouTubeSource } from './sync.js';
import { getVideos } from './youtube.js';
import { metadataFailureUpdate } from './youtube-cache.js';
import { notifyAddedTracks } from './telegram-notifications.js';
import { createNonOverlappingRunner } from './non-overlapping.js';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const intervalMs = 60_000;
export async function maintainYouTubeMetadata(db: ReturnType<typeof getDatabase>) {
  const now = new Date(); const refreshBefore = new Date(now.getTime() - 25 * 86_400_000);
  const entries = await db.youTubeMetadata.findMany({ where: { status: { not: 'EXPIRED' }, refreshedAt: { lt: refreshBefore }, OR: [{ retryAt: null }, { retryAt: { lte: now } }] }, orderBy: { refreshedAt: 'asc' }, take: 500 });
  for (let offset = 0; offset < entries.length; offset += 50) {
    const batch = entries.slice(offset, offset + 50);
    try {
      const fresh = await getVideos(batch.map(item => item.videoId)); const byId = new Map(fresh.map(item => [item.videoId, item]));
      for (const item of batch) {
        const current = byId.get(item.videoId);
        if (!current) {
          await db.youTubeMetadata.update({ where: { videoId: item.videoId }, data: { title: null, channelTitle: null, thumbnailUrl: null, duration: null, status: 'UNAVAILABLE', refreshedAt: now, lastAttemptAt: now, retryAt: null, lastErrorCode: 'video_unavailable' } });
          continue;
        }
        await db.youTubeMetadata.update({ where: { videoId: item.videoId }, data: { title: current.title, channelTitle: current.channel, thumbnailUrl: current.thumbnail, duration: current.duration, status: 'FRESH', refreshedAt: now, lastAttemptAt: now, retryAt: null, lastErrorCode: null } });
      }
    } catch (error) {
      for (const item of batch) {
        const errorCode = error instanceof Error && 'reason' in error && typeof error.reason === 'string' ? error.reason.slice(0, 64) : 'refresh_error';
        await db.youTubeMetadata.update({ where: { videoId: item.videoId }, data: metadataFailureUpdate(item.refreshedAt, now, errorCode) });
      }
      console.error('YouTube metadata refresh attempt failed; user records and references were preserved', error instanceof Error ? error.message : 'Unknown error');
    }
  }
  if (entries.length) console.info('YouTube metadata maintenance completed', { checked: entries.length });
}

const runDueSyncs = createNonOverlappingRunner(async () => {
  try {
    const db = getDatabase();
    await maintainYouTubeMetadata(db);
    const due = await db.youTubeSource.findMany({ where: { nextSyncAt: { lte: new Date() }, OR: [{ status: { not: 'RUNNING' } }, { lastAttemptAt: { lt: new Date(Date.now() - 30 * 60_000) } }] }, orderBy: { nextSyncAt: 'asc' }, take: 10 });
    for (const source of due) {
      try {
        const result = await syncYouTubeSource(db, source.id);
        await notifyAddedTracks(db, source.id, result.addedTracks);
        console.info('YouTube sync completed', { sourceId: source.id, ...result });
      } catch (error) {
        console.error('YouTube sync failed', { sourceId: source.id, error: error instanceof Error ? error.message : 'Unknown error' });
      }
    }
  } catch (error) { console.error('Sync worker loop failed', error); }
});

let timer: NodeJS.Timeout | undefined;
export function startSyncWorker(options: { intervalMs?: number; runImmediately?: boolean } = {}): () => void {
  if (timer) return stopSyncWorker;
  if (!config.DATABASE_URL) throw new Error('DATABASE_URL is required to run the sync worker');
  const interval = options.intervalMs ?? intervalMs;
  console.info('YouTube sync worker started; checking for due jobs', { intervalMs: interval });
  if (options.runImmediately !== false) void runDueSyncs();
  timer = setInterval(() => { void runDueSyncs(); }, interval);
  return stopSyncWorker;
}

export function stopSyncWorker(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startSyncWorker();
  const shutdown = async () => { stopSyncWorker(); await closeDatabase(); process.exit(0); };
  process.once('SIGINT', () => { void shutdown(); });
  process.once('SIGTERM', () => { void shutdown(); });
}
