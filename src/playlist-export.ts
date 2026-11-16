import type { PrismaClient } from './generated/prisma/client.js';

export interface PlaylistExportTrack {
  videoId: string;
  title: string;
  channel: string | null;
  duration: string | null;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
}

export interface PlaylistExport {
  id: string;
  title: string;
  hasYouTubeSource: boolean;
  youtubePlaylistId?: string | null;
  tracks: PlaylistExportTrack[];
}

/** Convert the ISO-8601 durations returned by the YouTube Data API to seconds. */
export function isoDurationToSeconds(value: string | null | undefined): number {
  if (!value) return -1;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value);
  if (!match) return -1;
  const [, days, hours, minutes, seconds] = match;
  if (!days && !hours && !minutes && !seconds) return -1;
  return Number(days ?? 0) * 86_400 + Number(hours ?? 0) * 3_600 + Number(minutes ?? 0) * 60 + Number(seconds ?? 0);
}

function singleLine(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Build an extended M3U playlist. It contains official YouTube links only. */
export function buildM3u(playlist: PlaylistExport): string {
  const lines = ['#EXTM3U', `#PLAYLIST:${singleLine(playlist.title) || 'Luna playlist'}`];
  for (const track of playlist.tracks) {
    const label = [track.channel, track.title].filter((part): part is string => Boolean(part && part.trim())).map(singleLine).join(' - ') || 'YouTube video';
    lines.push(`#EXTINF:${isoDurationToSeconds(track.duration)},${label}`);
    lines.push(`https://www.youtube.com/watch?v=${encodeURIComponent(track.videoId)}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Official link that opens a whole playlist in YouTube Music or YouTube.
 * Background playback is handled by those apps; no media is extracted here.
 */
export function backgroundPlaybackUrl(input: { youtubePlaylistId?: string | null; videoIds?: string[] }): string | null {
  if (input.youtubePlaylistId) {
    return `https://music.youtube.com/playlist?list=${encodeURIComponent(input.youtubePlaylistId)}`;
  }
  const videoIds = (input.videoIds ?? []).filter(Boolean).slice(0, 50);
  if (!videoIds.length) return null;
  return `https://www.youtube.com/watch_videos?video_ids=${videoIds.map(encodeURIComponent).join(',')}`;
}

export function playlistFileName(title: string): string {  const cleaned = singleLine(title)
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\.+$/g, '')
    .slice(0, 80)
    .trim();
  return `${cleaned || 'luna-playlist'}.m3u`;
}

/** Load one user-owned playlist in playback order, with cached YouTube metadata. */
export async function loadPlaylistExport(db: PrismaClient, playlistId: string, telegramId: bigint): Promise<PlaylistExport | null> {
  const playlist = await db.playlist.findFirst({
    where: { id: playlistId, user: { telegramId } },
    select: {
      id: true,
      title: true,
      youtube: { select: { id: true, cachedTitle: true } },
      items: {
        orderBy: { position: 'asc' },
        select: { customTitle: true, track: { select: { youtubeVideoId: true } } },
      },
    },
  });
  if (!playlist) return null;
  const videoIds = playlist.items.map(item => item.track.youtubeVideoId);
  const metadata = videoIds.length ? await db.youTubeMetadata.findMany({ where: { videoId: { in: videoIds } } }) : [];
  const cacheById = new Map(metadata.map(row => [row.videoId, row]));
  return {
    id: playlist.id,
    title: playlist.title ?? playlist.youtube?.cachedTitle ?? 'YouTube playlist',
    hasYouTubeSource: Boolean(playlist.youtube),
    youtubePlaylistId: playlist.youtube?.id ?? null,
    tracks: playlist.items.map(item => {
      const videoId = item.track.youtubeVideoId;
      const cache = cacheById.get(videoId);
      return {
        videoId,
        title: item.customTitle ?? cache?.title ?? (cache?.status === 'EXPIRED' ? 'YouTube metadata expired' : 'YouTube video'),
        channel: cache?.channelTitle ?? null,
        duration: cache?.duration ?? null,
        availability: cache?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE',
      };
    }),
  };
}
