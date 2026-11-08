import type { Prisma } from './generated/prisma/client.js';
import type { YouTubeTrack } from './youtube.js';

type CacheWriter = Pick<Prisma.TransactionClient, 'youTubeMetadata'>;

export async function upsertYouTubeMetadata(tx: CacheWriter, item: YouTubeTrack, now = new Date()) {
  if (!item.videoId) return;
  await tx.youTubeMetadata.upsert({
    where: { videoId: item.videoId },
    create: { videoId: item.videoId, title: item.availability === 'AVAILABLE' ? item.title : null, channelTitle: item.availability === 'AVAILABLE' ? item.channel : null, thumbnailUrl: item.availability === 'AVAILABLE' ? item.thumbnail : null, status: item.availability === 'AVAILABLE' ? 'FRESH' : 'UNAVAILABLE', refreshedAt: now, lastAttemptAt: now },
    update: { title: item.availability === 'AVAILABLE' ? item.title : null, channelTitle: item.availability === 'AVAILABLE' ? item.channel : null, thumbnailUrl: item.availability === 'AVAILABLE' ? item.thumbnail : null, ...(item.availability !== 'AVAILABLE' ? { duration: null } : {}), status: item.availability === 'AVAILABLE' ? 'FRESH' : 'UNAVAILABLE', refreshedAt: now, lastAttemptAt: now, retryAt: null, lastErrorCode: null },
  });
}

export function cacheFailureState(refreshedAt: Date | null, now: Date, expiryDays = 30) {
  if (refreshedAt && now.getTime() - refreshedAt.getTime() >= expiryDays * 86_400_000) return 'EXPIRED' as const;
  return 'STALE' as const;
}

export function metadataFailureUpdate(refreshedAt: Date | null, now: Date, errorCode: string) {
  const status = cacheFailureState(refreshedAt, now);
  if (status === 'EXPIRED') return { title: null, channelTitle: null, thumbnailUrl: null, duration: null, status, lastAttemptAt: now, retryAt: null, lastErrorCode: errorCode };
  return { status, lastAttemptAt: now, retryAt: new Date(now.getTime() + 6 * 60 * 60_000), lastErrorCode: errorCode };
}
