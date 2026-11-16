import type { PrismaClient } from './generated/prisma/client.js';
import { getVideos, searchVideos, YouTubeError, type YouTubeTrack } from './youtube.js';
import { isoDurationToSeconds } from './playlist-export.js';

export interface VibeSeed {
  videoId: string;
  title: string;
  channel: string | null;
  duration: string | null;
  weight: number;
}

export interface VibeProfile {
  channelWeights: Map<string, number>;
  channelLabels: Map<string, string>;
  tokenWeights: Map<string, number>;
  topChannels: string[];
  averageDurationSeconds: number;
}

export interface VibeCandidate {
  videoId: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  duration: string | null;
  source: 'library' | 'discovery';
  favorite: boolean;
  recent: boolean;
}

export interface VibeTrack {
  videoId: string;
  title: string;
  channel: string | null;
  thumbnail: string | null;
  duration: string | null;
  availability: 'AVAILABLE' | 'UNAVAILABLE';
  reason: string;
}

export interface VibeResult {
  tracks: VibeTrack[];
  seeds: { favorites: number; channels: number };
  degraded: boolean;
  notice?: string;
}

const CACHE_MS = 10 * 60_000;
const cache = new Map<string, { expiresAt: number; result: VibeResult }>();

export function resetVibeCache(): void {
  cache.clear();
}

export function invalidateVibe(userId: string): void {
  cache.delete(userId);
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'official', 'video', 'music', 'feat', 'ft',
  'remix', 'lyrics', 'audio', 'from', 'your', 'you', 'mix', 'live', 'version', 'prod',
  'instrumental', 'edit', 'radio', 'song', 'full', 'album', 'new', 'best', 'topic', 'vevo',
  'clip', 'hd', 'hq', 'original', 'visualizer', 'пісня', 'музика', 'премьера', 'клип',
  'для', 'как', 'это', 'что', 'мой', 'моя', 'мої', 'моє', 'пісні', 'музики',
]);

export function normalizeVibeText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function vibeTokens(value: string): string[] {
  return [...new Set(normalizeVibeText(value).split(' ').filter(token => token.length >= 3 && !STOPWORDS.has(token)))];
}

function increment(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function normalizeMap(map: Map<string, number>): void {
  const max = Math.max(0, ...map.values());
  if (!max) return;
  for (const [key, value] of map) map.set(key, value / max);
}

export function buildVibeProfile(seeds: VibeSeed[]): VibeProfile {
  const channelWeights = new Map<string, number>();
  const channelLabels = new Map<string, string>();
  const tokenWeights = new Map<string, number>();
  let durationSum = 0;
  let durationWeight = 0;

  for (const seed of seeds) {
    if (seed.channel) {
      const channel = normalizeVibeText(seed.channel);
      if (channel) {
        increment(channelWeights, channel, seed.weight);
        channelLabels.set(channel, seed.channel);
      }
    }
    for (const token of vibeTokens(seed.title)) increment(tokenWeights, token, seed.weight);
    const seconds = isoDurationToSeconds(seed.duration);
    if (seconds > 0) {
      durationSum += seconds * seed.weight;
      durationWeight += seed.weight;
    }
  }

  normalizeMap(channelWeights);
  normalizeMap(tokenWeights);
  const topChannels = [...channelWeights.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([channel]) => channel);

  return {
    channelWeights,
    channelLabels,
    tokenWeights,
    topChannels,
    averageDurationSeconds: durationWeight ? durationSum / durationWeight : 0,
  };
}

function channelAffinity(candidate: VibeCandidate, profile: VibeProfile): number {
  if (!candidate.channel) return 0;
  return profile.channelWeights.get(normalizeVibeText(candidate.channel)) ?? 0;
}

interface ScoredCandidate extends VibeCandidate {
  score: number;
  reason: string;
}

export function scoreVibeCandidate(candidate: VibeCandidate, profile: VibeProfile, rng: () => number = Math.random): ScoredCandidate {
  let score = 0;
  let reason = '';
  const channel = channelAffinity(candidate, profile);
  if (channel > 0) {
    score += 12 * channel;
    reason = candidate.channel ? `Бо тобі подобається ${candidate.channel}` : 'Бо тобі подобається цей канал';
  }

  const candidateTokens = new Set(vibeTokens(candidate.title));
  let tokenWeight = 0;
  for (const token of candidateTokens) tokenWeight += profile.tokenWeights.get(token) ?? 0;
  score += Math.min(7, tokenWeight * 2.5);
  if (!reason && tokenWeight > 0) reason = 'Схоже на твій вайб';

  const seconds = isoDurationToSeconds(candidate.duration);
  if (profile.averageDurationSeconds > 0 && seconds > 0) {
    score += 1.2 * Math.max(0, 1 - Math.abs(seconds - profile.averageDurationSeconds) / 240);
  }

  if (candidate.source === 'discovery') score += 1.8;
  if (candidate.favorite) score -= 2.2;
  if (candidate.recent) score -= 0.8;
  score += rng() * 0.8;

  if (!reason) reason = candidate.source === 'discovery' ? 'Нова музика для тебе' : 'З твоєї бібліотеки';
  return { ...candidate, score, reason };
}

function uniqueById(items: ScoredCandidate[]): ScoredCandidate[] {
  const seen = new Set<string>();
  return items.filter(item => {
    if (seen.has(item.videoId)) return false;
    seen.add(item.videoId);
    return true;
  });
}

export function rankVibe(
  profile: VibeProfile,
  library: VibeCandidate[],
  discovery: VibeCandidate[],
  options: { limit?: number; rng?: () => number } = {},
): VibeTrack[] {
  const limit = Math.max(1, Math.min(30, options.limit ?? 24));
  const rng = options.rng ?? Math.random;
  const scored = uniqueById([...library, ...discovery].map(candidate => scoreVibeCandidate(candidate, profile, rng)));
  const libraryRanked = scored.filter(item => item.source === 'library').sort((a, b) => b.score - a.score);
  const discoveryRanked = scored.filter(item => item.source === 'discovery').sort((a, b) => b.score - a.score);
  const discoverySlots = Math.min(discoveryRanked.length, Math.round(limit * 0.58));
  const librarySlots = Math.min(libraryRanked.length, limit - discoverySlots);
  const selected = uniqueById([...discoveryRanked.slice(0, discoverySlots), ...libraryRanked.slice(0, librarySlots)]);

  for (const item of [...discoveryRanked, ...libraryRanked].sort((a, b) => b.score - a.score)) {
    if (selected.length >= limit) break;
    if (!selected.some(existing => existing.videoId === item.videoId)) selected.push(item);
  }

  // Avoid a wall of tracks from one channel while keeping the strongest matches first.
  const capped: ScoredCandidate[] = [];
  const perChannel = new Map<string, number>();
  const maxPerChannel = 5;
  for (const item of [...selected].sort((a, b) => b.score - a.score)) {
    const key = normalizeVibeText(item.channel ?? '') || 'unknown';
    if ((perChannel.get(key) ?? 0) >= maxPerChannel) continue;
    capped.push(item);
    perChannel.set(key, (perChannel.get(key) ?? 0) + 1);
    if (capped.length >= limit) break;
  }

  return capped.map(({ score: _score, ...track }) => ({
    videoId: track.videoId,
    title: track.title,
    channel: track.channel,
    thumbnail: track.thumbnail,
    duration: track.duration,
    availability: 'AVAILABLE' as const,
    reason: track.reason,
  }));
}

function sameChannel(left: string | null, right: string): boolean {
  if (!left) return false;
  const a = normalizeVibeText(left);
  const b = normalizeVibeText(right);
  return a === b || a.includes(b) || b.includes(a);
}

function mergeDiscoveryDetails(items: YouTubeTrack[], details: Awaited<ReturnType<typeof getVideos>>): YouTubeTrack[] {
  const byId = new Map(details.map(item => [item.videoId, item]));
  return items.map(item => {
    const detail = byId.get(item.videoId ?? '');
    if (!detail) return item;
    return {
      ...item,
      title: detail.title || item.title,
      channel: detail.channel ?? item.channel,
      thumbnail: detail.thumbnail ?? item.thumbnail,
      duration: detail.duration ?? item.duration,
    };
  });
}

export async function buildVibe(
  db: PrismaClient,
  userId: string,
  options: { refresh?: boolean; limit?: number } = {},
): Promise<VibeResult> {
  const cached = cache.get(userId);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) return cached.result;

  const [favoriteRows, historyRows, libraryRows] = await Promise.all([
    db.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { track: { select: { youtubeVideoId: true } } },
    }),
    db.playbackHistory.findMany({
      where: { userId },
      orderBy: { playedAt: 'desc' },
      take: 80,
      select: { track: { select: { youtubeVideoId: true } } },
    }),
    db.playlistItem.findMany({
      where: { playlist: { userId } },
      select: { trackId: true, track: { select: { youtubeVideoId: true } } },
      distinct: ['trackId'],
    }),
  ]);

  const favoriteIds = [...new Set(favoriteRows.map(row => row.track.youtubeVideoId))];
  const historyIds = [...new Set(historyRows.map(row => row.track.youtubeVideoId))];
  const libraryIds = [...new Set(libraryRows.map(row => row.track.youtubeVideoId))];
  const allIds = [...new Set([...libraryIds, ...favoriteIds, ...historyIds])];
  const metadataRows = allIds.length ? await db.youTubeMetadata.findMany({ where: { videoId: { in: allIds } } }) : [];
  const metadataById = new Map(metadataRows.map(row => [row.videoId, row]));

  const favoriteSet = new Set(favoriteIds);
  const recentSet = new Set(historyIds.slice(0, 30));
  const seeds: VibeSeed[] = [];
  const seeded = new Set<string>();

  const addSeed = (videoId: string, weight: number) => {
    if (seeded.has(videoId)) return;
    const metadata = metadataById.get(videoId);
    if (!metadata?.title || metadata.status === 'UNAVAILABLE') return;
    seeds.push({
      videoId,
      title: metadata.title,
      channel: metadata.channelTitle,
      duration: metadata.duration,
      weight,
    });
    seeded.add(videoId);
  };

  for (const videoId of favoriteIds) addSeed(videoId, 3);
  for (const videoId of historyIds.slice(0, 30)) addSeed(videoId, 1.2);

  let notice: string | undefined;
  if (!seeds.length) {
    for (const videoId of libraryIds.slice(0, 12)) addSeed(videoId, 0.4);
    if (seeds.length) notice = 'Постав ♥ кільком трекам — і вайб стане точнішим.';
  }
  if (!seeds.length) {
    const empty: VibeResult = {
      tracks: [],
      seeds: { favorites: favoriteIds.length, channels: 0 },
      degraded: false,
      notice: 'Додай треки в бібліотеку та познач улюблені, щоб зібрати свій вайб.',
    };
    cache.set(userId, { expiresAt: Date.now() + CACHE_MS, result: empty });
    return empty;
  }

  const profile = buildVibeProfile(seeds);
  const candidates: VibeCandidate[] = [];
  for (const videoId of allIds) {
    const metadata = metadataById.get(videoId);
    if (!metadata?.title || metadata.status === 'UNAVAILABLE') continue;
    candidates.push({
      videoId,
      title: metadata.title,
      channel: metadata.channelTitle,
      thumbnail: metadata.thumbnailUrl,
      duration: metadata.duration,
      source: 'library',
      favorite: favoriteSet.has(videoId),
      recent: recentSet.has(videoId),
    });
  }

  const known = new Set(allIds);
  const discovery: VibeCandidate[] = [];
  let degraded = false;
  let searchNotice: string | undefined;

  for (const channel of profile.topChannels.slice(0, 2)) {
    const label = profile.channelLabels.get(channel) ?? channel;
    try {
      const found = await searchVideos(label, 10);
      for (const item of found) {
        if (!item.videoId || known.has(item.videoId) || !sameChannel(item.channel, label)) continue;
        known.add(item.videoId);
        discovery.push({
          videoId: item.videoId,
          title: item.title,
          channel: item.channel,
          thumbnail: item.thumbnail,
          duration: item.duration,
          source: 'discovery',
          favorite: false,
          recent: false,
        });
        if (discovery.length >= 20) break;
      }
    } catch (error) {
      degraded = true;
      searchNotice = error instanceof YouTubeError && error.reason === 'daily_quota_budget_reached'
        ? 'Ліміт пошуку YouTube на сьогодні вичерпано — показуємо добірку з твоєї бібліотеки.'
        : 'Пошук YouTube зараз недоступний — показуємо добірку з твоєї бібліотеки.';
      break;
    }
    if (discovery.length >= 20) break;
  }

  if (discovery.length) {
    try {
      const details = await getVideos(discovery.slice(0, 20).map(item => item.videoId));
      const withDetails = mergeDiscoveryDetails(
        discovery.map(item => ({
          sourceItemId: `vibe-${item.videoId}`,
          videoId: item.videoId,
          title: item.title,
          channel: item.channel,
          thumbnail: item.thumbnail,
          availability: 'AVAILABLE',
        } as YouTubeTrack)),
        details,
      );
      const detailById = new Map(withDetails.map(item => [item.videoId ?? '', item]));
      for (const item of discovery) {
        const detail = detailById.get(item.videoId);
        if (!detail) continue;
        item.title = detail.title || item.title;
        item.channel = detail.channel ?? item.channel;
        item.thumbnail = detail.thumbnail ?? item.thumbnail;
        item.duration = detail.duration ?? item.duration;
      }
    } catch {
      /* Discovery still works without duration details. */
    }
  }

  const tracks = rankVibe(profile, candidates, discovery, { limit: options.limit ?? 24 });
  const result: VibeResult = {
    tracks,
    seeds: { favorites: favoriteIds.length, channels: profile.topChannels.length },
    degraded,
  };
  if (searchNotice) result.notice = searchNotice;
  else if (notice) result.notice = notice;

  cache.set(userId, { expiresAt: Date.now() + CACHE_MS, result });
  return result;
}
