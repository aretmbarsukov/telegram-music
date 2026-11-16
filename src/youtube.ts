import { config } from './config.js';
import { getDatabase } from './database.js';
import { isoDurationToSeconds } from './playlist-export.js';

export type YouTubeLink = { kind: 'playlist'; id: string } | { kind: 'video'; id: string };
export interface YouTubeTrack { sourceItemId: string; videoId: string | null; title: string; channel: string | null; thumbnail: string | null; duration: string | null; availability: string; embeddable?: boolean; privacyStatus?: string | null; liveBroadcastContent?: string | null; }
export interface YouTubePlaylist { id: string; title: string; thumbnail: string | null; itemCount: number; }
export class YouTubeError extends Error {
  constructor(message: string, readonly statusCode = 502, readonly reason = 'youtube_error') { super(message); }
}

export function parseYouTubeUrl(raw: string): YouTubeLink | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (!['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'].includes(host)) return null;
  const list = url.searchParams.get('list');
  if (list && /^[\w-]{1,100}$/.test(list)) return { kind: 'playlist', id: list };
  let video = host.endsWith('youtu.be') ? url.pathname.split('/').filter(Boolean)[0] : url.searchParams.get('v');
  if (!video) video = url.pathname.match(/\/(?:embed|shorts)\/([^/?]+)/)?.[1] ?? null;
  if (video && /^[\w-]{11}$/.test(video)) return { kind: 'video', id: video };
  return null;
}

function apiKey(): string {
  if (!config.YOUTUBE_API_KEY) throw new YouTubeError('YouTube Data API is not configured', 503, 'api_key_missing');
  return config.YOUTUBE_API_KEY;
}

const mockVideos = [
  { videoId: 'M7lc1UVf-VE', title: 'YouTube IFrame API demo', channel: 'YouTube Developers', thumbnail: null, duration: 'PT15S', embeddable: true, privacyStatus: 'public', liveBroadcastContent: 'none' },
  { videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', channel: 'jawed', thumbnail: null, duration: 'PT19S', embeddable: true, privacyStatus: 'public', liveBroadcastContent: 'none' },
  { videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny · open movie', channel: 'Blender Foundation', thumbnail: null, duration: 'PT9M56S', embeddable: true, privacyStatus: 'public', liveBroadcastContent: 'none' },
];

const mockSearchCatalog = [
  { videoId: '9bZkp7q19f0', title: 'Gangnam Style', channel: 'officialpsy', thumbnail: null, duration: 'PT4M13S' },
  { videoId: 'kJQP7kiw5Fk', title: 'Despacito', channel: 'Luis Fonsi', thumbnail: null, duration: 'PT4M42S' },
  { videoId: 'jfKfPfyJRdk', title: 'lofi hip hop radio', channel: 'Lofi Girl', thumbnail: null, duration: 'PT0S' },
  { videoId: '60ItHLz5WEA', title: 'Faded', channel: 'Alan Walker', thumbnail: null, duration: 'PT3M32S' },
  { videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny · open movie', channel: 'Blender Foundation', thumbnail: null, duration: 'PT9M56S' },
  { videoId: 'M7lc1UVf-VE', title: 'YouTube IFrame API demo', channel: 'YouTube Developers', thumbnail: null, duration: 'PT15S' },
  { videoId: 'min00000001', title: 'One Minute Song', channel: 'Luna Demo', thumbnail: null, duration: 'PT1M' },
  { videoId: 'ten00000001', title: 'Ten Minute Song', channel: 'Luna Demo', thumbnail: null, duration: 'PT10M' },
  { videoId: 'lng00000001', title: 'Long Song', channel: 'Luna Demo', thumbnail: null, duration: 'PT10M1S' },
  { videoId: 'revw0000001', title: 'Album review', channel: 'Luna Demo', thumbnail: null, duration: 'PT4M' },
  { videoId: 'podc0000001', title: 'Music podcast', channel: 'Luna Demo', thumbnail: null, duration: 'PT30M' },
];

function mockPlaylistItems(id: string): YouTubeTrack[] {
  return mockVideos.map((video, index) => ({ sourceItemId: `mock-${id}-${index + 1}`, videoId: video.videoId, title: video.title, channel: video.channel, thumbnail: video.thumbnail, duration: video.duration, availability: 'AVAILABLE' }));
}

async function request<T>(path: string, params: Record<string, string>, cost = 1): Promise<T> {
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  for (const [key, value] of Object.entries({ ...params, key: apiKey() })) url.searchParams.set(key, value);
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const day = new Date().toISOString().slice(0, 10);
      const db = getDatabase();
      await db.youTubeQuotaDay.upsert({ where: { day }, create: { day, units: 0 }, update: {} });
      const reservation = await db.youTubeQuotaDay.updateMany({ where: { day, units: { lte: config.YOUTUBE_DAILY_QUOTA_LIMIT - cost } }, data: { units: { increment: cost } } });
      if (!reservation.count) throw new YouTubeError('Daily YouTube API quota budget reached', 429, 'daily_quota_budget_reached');
      const response = await fetch(url, { signal: AbortSignal.timeout(12_000) });
      if (response.ok) return await response.json() as T;
      const payload = await response.json().catch(() => null) as { error?: { errors?: { reason?: string }[] } } | null;
      const reason = payload?.error?.errors?.[0]?.reason ?? `http_${response.status}`;
      const retryable = response.status === 429 || response.status >= 500 || reason === 'rateLimitExceeded' || reason === 'backendError';
      if (!retryable || attempt === 2) {
        const status = reason === 'quotaExceeded' ? 503 : (response.status === 404 || response.status === 403 ? 422 : 502);
        throw new YouTubeError(reason === 'quotaExceeded' ? 'YouTube API quota is exhausted' : `YouTube API request failed (${reason})`, status, reason);
      }
      await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
    } catch (error) {
      if (error instanceof YouTubeError) throw error;
      last = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 300 * 2 ** attempt));
    }
  }
  throw new YouTubeError(`Could not reach YouTube API: ${String(last)}`, 502, 'network_error');
}

interface PlaylistListResponse { items?: { id: string; snippet?: { title?: string; thumbnails?: Record<string, { url?: string }> }; contentDetails?: { itemCount?: number }; status?: { privacyStatus?: string } }[]; }
interface PlaylistItemsResponse { nextPageToken?: string; items?: { id?: string; snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }>; resourceId?: { videoId?: string } }; contentDetails?: { videoId?: string; duration?: string } }[]; }
interface VideosResponse { items?: { id: string; snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }>; liveBroadcastContent?: string }; contentDetails?: { duration?: string }; status?: { embeddable?: boolean; privacyStatus?: string } }[]; }
interface SearchListResponse { nextPageToken?: string; items?: { id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: Record<string, { url?: string }> } }[]; }
export interface YouTubeSearchPage { items: YouTubeTrack[]; nextPageToken: string | null; }
const thumbnail = (t?: Record<string, { url?: string }>) => t?.maxres?.url ?? t?.standard?.url ?? t?.high?.url ?? t?.medium?.url ?? t?.default?.url ?? null;

export async function getPlaylist(id: string): Promise<YouTubePlaylist> {
  if (config.YOUTUBE_MOCK_MODE) return { id, title: 'Luna demo playlist', thumbnail: null, itemCount: mockVideos.length };
  const result = await request<PlaylistListResponse>('playlists', { part: 'snippet,contentDetails,status', id, maxResults: '1' });
  const item = result.items?.[0];
  if (!item || item.status?.privacyStatus !== 'public') throw new YouTubeError('Playlist is missing or is not public', 422, 'playlist_unavailable');
  return { id: item.id, title: item.snippet?.title || 'YouTube playlist', thumbnail: thumbnail(item.snippet?.thumbnails), itemCount: item.contentDetails?.itemCount ?? 0 };
}

export async function getPlaylistItems(id: string): Promise<YouTubeTrack[]> {
  if (config.YOUTUBE_MOCK_MODE) return mockPlaylistItems(id);
  const tracks: YouTubeTrack[] = []; let pageToken: string | undefined; let pages = 0;
  do {
    const result = await request<PlaylistItemsResponse>('playlistItems', { part: 'snippet,contentDetails', playlistId: id, maxResults: '50', ...(pageToken ? { pageToken } : {}) });
    for (const item of result.items ?? []) tracks.push({
      sourceItemId: item.id ?? `unavailable-${tracks.length}`,
      videoId: item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId ?? null,
      title: item.snippet?.title || 'Unavailable video', channel: item.snippet?.channelTitle ?? null,
      thumbnail: thumbnail(item.snippet?.thumbnails),
      duration: item.contentDetails?.duration ?? null,
      availability: /^(deleted|private) video$/i.test(item.snippet?.title ?? '') ? 'UNAVAILABLE' : 'AVAILABLE',
    });
    pageToken = result.nextPageToken; pages++;
    if (pages >= 100) throw new YouTubeError('Playlist exceeds the current import page limit', 422, 'playlist_too_large');
  } while (pageToken);
  return tracks;
}

export async function getVideo(id: string) {
  if (config.YOUTUBE_MOCK_MODE) {
    const known = mockVideos.find(video => video.videoId === id);
    return known ?? { videoId: id, title: `Demo track ${id}`, channel: 'Luna Demo', thumbnail: null, duration: 'PT3M30S' };
  }
  const result = await request<VideosResponse>('videos', { part: 'snippet,contentDetails,status', id, maxResults: '1' });
  const item = result.items?.[0];
  if (!item) throw new YouTubeError('Video is missing or unavailable', 422, 'video_unavailable');
  return { videoId: item.id, title: item.snippet?.title || 'YouTube video', channel: item.snippet?.channelTitle ?? null, thumbnail: thumbnail(item.snippet?.thumbnails), duration: item.contentDetails?.duration ?? null };
}


export async function getVideos(ids: string[]) {
  if (!ids.length || ids.length > 50) throw new YouTubeError('videos.list accepts batches of 1 to 50 video IDs', 400, 'invalid_batch');
  if (config.YOUTUBE_MOCK_MODE) return ids.map(id => {
    const known = mockVideos.find(video => video.videoId === id);
    const searchResult = mockSearchCatalog.find(video => video.videoId === id);
    return known ?? (searchResult ? { ...searchResult, embeddable: true, privacyStatus: 'public', liveBroadcastContent: 'none' } : { videoId: id, title: `Demo track ${id}`, channel: 'Luna Demo', thumbnail: null, duration: 'PT3M30S', embeddable: true, privacyStatus: 'public', liveBroadcastContent: 'none' });
  });
  const result = await request<VideosResponse>('videos', { part: 'snippet,contentDetails,status', id: ids.join(','), maxResults: '50' });
  return (result.items ?? []).map(item => ({
    videoId: item.id,
    title: item.snippet?.title || 'YouTube video',
    channel: item.snippet?.channelTitle ?? null,
    thumbnail: thumbnail(item.snippet?.thumbnails),
    duration: item.contentDetails?.duration ?? null,
    ...(item.status?.embeddable !== undefined ? { embeddable: item.status.embeddable } : {}),
    privacyStatus: item.status?.privacyStatus ?? null,
    liveBroadcastContent: item.snippet?.liveBroadcastContent ?? null,
  }));
}

/**
 * Official YouTube search used to discover tracks similar to the user's liked channels.
 * `search.list` costs 100 quota units, so callers must cache results.
 */
export async function searchVideos(query: string, maxResults = 10, pageToken?: string): Promise<YouTubeSearchPage> {
  const limit = Math.max(1, Math.min(25, maxResults));
  if (config.YOUTUBE_MOCK_MODE) {
    return {
      items: mockSearchCatalog.slice(0, limit).map(video => ({
      sourceItemId: `mock-search-${video.videoId}`,
      videoId: video.videoId,
      title: video.title,
      channel: video.channel,
      thumbnail: video.thumbnail,
      duration: video.duration,
      availability: 'AVAILABLE',
      })),
      nextPageToken: null,
    };
  }
  const params: Record<string, string> = {
    part: 'snippet',
    q: query,
    type: 'video',
    videoCategoryId: '10',
    videoEmbeddable: 'true',
    maxResults: String(limit),
    safeSearch: 'none',
  };
  if (pageToken) params.pageToken = pageToken;
  const result = await request<SearchListResponse>('search', params, 100);
  const items = (result.items ?? []).flatMap(item => {
    const videoId = item.id?.videoId;
    if (!videoId || !/^[\w-]{11}$/.test(videoId)) return [];
    return [{
      sourceItemId: `search-${videoId}`,
      videoId,
      title: item.snippet?.title || 'YouTube video',
      channel: item.snippet?.channelTitle ?? null,
      thumbnail: thumbnail(item.snippet?.thumbnails),
      duration: null,
      availability: 'AVAILABLE',
    }];
  });
  return { items, nextPageToken: result.nextPageToken ?? null };
}

const NON_MUSIC_TITLE = /\b(?:podcasts?|reviews?|reactions?|interviews?|commentary|tutorials?|analysis|explained|documentar(?:y|ies)|movies?|films?|livestreams?|live\s+streams?|radio|full\s+albums?|compilations?|top\s+\d+)\b|(?:подкаст|обзор|реакци|интервью|стрим|эфир|разбор|документал|фильм|огляд|реакці|інтерв['’]ю|стрім|ефір|розбір|документал|фільм|критик|émission|critique|en\s+direct)/iu;

export async function searchMusicTracks(query: string, maxResults = 20): Promise<YouTubeTrack[]> {
  const page = await searchVideos(query, maxResults);
  const videoIds = page.items.flatMap(track => track.videoId ? [track.videoId] : []);
  if (!videoIds.length) return [];
  const details = await getVideos(videoIds.slice(0, 50));
  const detailsById = new Map(details.map(video => [video.videoId, video]));
  return page.items.flatMap(track => {
    if (!track.videoId) return [];
    const detail = detailsById.get(track.videoId);
    if (!detail) return [];
    const candidate = { ...track, ...detail, sourceItemId: track.sourceItemId, availability: track.availability };
    const durationSeconds = isoDurationToSeconds(candidate.duration);
    if (candidate.privacyStatus !== 'public' || candidate.embeddable !== true || candidate.liveBroadcastContent !== 'none') return [];
    if (durationSeconds < 60 || durationSeconds > 600 || NON_MUSIC_TITLE.test(candidate.title)) return [];
    return [candidate];
  });
}
