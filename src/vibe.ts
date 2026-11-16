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
  hasMore?: boolean;
}

const CACHE_MS = 10 * 60_000;
const BATCH_SIZE = 20;
const POOL_LIMIT = 500;

interface VibeChannelPage {
  label: string;
  nextPageToken: string | null;
  exhausted: boolean;
}

interface VibeCacheEntry {
  expiresAt: number;
  result: VibeResult;
  profile: VibeProfile | null;
  library: VibeCandidate[];
  discovery: VibeCandidate[];
  known: Set<string>;
  channelPages: VibeChannelPage[];
}

const cache = new Map<string, VibeCacheEntry>();

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
  const limit = Math.max(1, Math.min(POOL_LIMIT, options.limit ?? BATCH_SIZE));
  const rng = options.rng ?? Math.random;
  const recommendationLibrary = discovery.length || library.some(candidate => !candidate.favorite)
    ? library.filter(candidate => !candidate.favorite)
    : library;
  const scored = uniqueById([...recommendationLibrary, ...discovery].map(candidate => scoreVibeCandidate(candidate, profile, rng)));
  const libraryRanked = scored.filter(item => item.source === 'library').sort((a, b) => b.score - a.score);
  const discoveryRanked = scored.filter(item => item.source === 'discovery').sort((a, b) => b.score - a.score);
  const discoverySlots = Math.min(discoveryRanked.length, Math.round(limit * 0.58));
  const librarySlots = Math.min(libraryRanked.length, limit - discoverySlots);
  const selected = uniqueById([...discoveryRanked.slice(0, discoverySlots), ...libraryRanked.slice(0, librarySlots)]);

  for (const item of [...discoveryRanked, ...libraryRanked].sort((a, b) => b.score - a.score)) {
    if (selected.length >= limit) break;
    if (!selected.some(existing => existing.videoId === item.videoId)) selected.push(item);
  }

  return [...selected].sort((a, b) => b.score - a.score).slice(0, limit).map(({ score: _score, ...track }) => ({
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

export function selectVibeBatch(tracks: VibeTrack[], limit: number): VibeTrack[] {
  const batchSize = Math.max(1, Math.min(BATCH_SIZE, limit));
  const selected: VibeTrack[] = [];
  const selectedIds = new Set<string>();
  const channelCounts = new Map<string, number>();
  const perChannelLimit = Math.max(1, Math.ceil(batchSize * 0.6));

  for (const track of tracks) {
    const channel = normalizeVibeText(track.channel ?? '') || 'unknown';
    if ((channelCounts.get(channel) ?? 0) >= perChannelLimit) continue;
    selected.push(track);
    selectedIds.add(track.videoId);
    channelCounts.set(channel, (channelCounts.get(channel) ?? 0) + 1);
    if (selected.length >= batchSize) return selected;
  }

  for (const track of tracks) {
    if (selectedIds.has(track.videoId)) continue;
    selected.push(track);
    if (selected.length >= batchSize) break;
  }
  return selected;
}

function responsePage(entry: VibeCacheEntry, excluded: Set<string>, limit: number): VibeResult {
  return {
    ...entry.result,
    tracks: selectVibeBatch(entry.result.tracks.filter(track => !excluded.has(track.videoId)), limit),
    hasMore: entry.result.tracks.length < POOL_LIMIT &&
      entry.channelPages.some(page => !page.exhausted && Boolean(page.nextPageToken)),
  };
}

function rankCacheEntry(entry: VibeCacheEntry): void {
  if (!entry.profile) return;
  entry.result.tracks = rankVibe(entry.profile, entry.library, entry.discovery, { limit: POOL_LIMIT });
}

async function extendVibeCache(entry: VibeCacheEntry, excluded: Set<string>, limit: number): Promise<void> {
  let pagesFetched = 0;
  for (const channelPage of entry.channelPages) {
    while (!channelPage.exhausted && channelPage.nextPageToken) {
      if (entry.result.tracks.length >= POOL_LIMIT) return;
      if (pagesFetched >= 2) return;
      const available = entry.result.tracks.filter(track => !excluded.has(track.videoId));
      if (available.length >= limit) return;

      try {
        const page = await searchVideos(channelPage.label, 25, channelPage.nextPageToken);
        pagesFetched++;
        channelPage.nextPageToken = page.nextPageToken;
        channelPage.exhausted = !page.nextPageToken;
        const discovered: VibeCandidate[] = [];
        for (const item of page.items) {
          if (!item.videoId || entry.known.has(item.videoId) || !sameChannel(item.channel, channelPage.label)) continue;
          entry.known.add(item.videoId);
          discovered.push({
            videoId: item.videoId,
            title: item.title,
            channel: item.channel,
            thumbnail: item.thumbnail,
            duration: item.duration,
            source: 'discovery',
            favorite: false,
            recent: false,
          });
        }

        if (discovered.length) {
          try {
            const details = await getVideos(discovered.map(item => item.videoId));
            const withDetails = mergeDiscoveryDetails(discovered.map(item => ({
              sourceItemId: `vibe-${item.videoId}`,
              videoId: item.videoId,
              title: item.title,
              channel: item.channel,
              thumbnail: item.thumbnail,
              availability: 'AVAILABLE',
            } as YouTubeTrack)), details);
            const detailById = new Map(withDetails.map(item => [item.videoId ?? '', item]));
            for (const item of discovered) {
              const detail = detailById.get(item.videoId);
              if (!detail) continue;
              item.title = detail.title || item.title;
              item.channel = detail.channel ?? item.channel;
              item.thumbnail = detail.thumbnail ?? item.thumbnail;
              item.duration = detail.duration ?? item.duration;
            }
          } catch {
            entry.result.degraded = true;
            entry.result.notice = 'Дані пошуку отримано, але не вдалося уточнити частину деталей.';
          }
          entry.discovery.push(...discovered);
          rankCacheEntry(entry);
        }
      } catch (error) {
        channelPage.exhausted = true;
        entry.result.degraded = true;
        entry.result.notice = error instanceof YouTubeError && error.reason === 'daily_quota_budget_reached'
          ? 'Ліміт пошуку YouTube на сьогодні вичерпано — продовжуємо з уже зібраною добіркою.'
          : 'Пошук YouTube зараз недоступний — продовжуємо з уже зібраною добіркою.';
        return;
      }
    }
  }
}

export async function buildVibe(
  db: PrismaClient,
  userId: string,
  options: { refresh?: boolean; limit?: number; excludeIds?: string[] } = {},
): Promise<VibeResult> {
  const limit = Math.max(1, Math.min(BATCH_SIZE, options.limit ?? BATCH_SIZE));
  const excluded = new Set(options.excludeIds ?? []);
  const cached = cache.get(userId);
  if (!options.refresh && cached && cached.expiresAt > Date.now()) {
    if (cached.profile && responsePage(cached, excluded, limit).tracks.length < limit) {
      await extendVibeCache(cached, excluded, limit);
    }
    return responsePage(cached, excluded, limit);
  }

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
    const entry: VibeCacheEntry = {
      expiresAt: Date.now() + CACHE_MS,
      result: empty,
      profile: null,
      library: [],
      discovery: [],
      known: new Set(allIds),
      channelPages: [],
    };
    cache.set(userId, entry);
    return responsePage(entry, excluded, limit);
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
  const channelPages: VibeChannelPage[] = [];

  for (const channel of profile.topChannels.slice(0, 2)) {
    const label = profile.channelLabels.get(channel) ?? channel;
    const channelPage: VibeChannelPage = { label, nextPageToken: null, exhausted: true };
    channelPages.push(channelPage);
    try {
      const page = await searchVideos(label, 25);
      channelPage.nextPageToken = page.nextPageToken;
      channelPage.exhausted = !page.nextPageToken;
      for (const item of page.items) {
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
        if (discovery.length >= 50) break;
      }
    } catch (error) {
      channelPage.exhausted = true;
      degraded = true;
      searchNotice = error instanceof YouTubeError && error.reason === 'daily_quota_budget_reached'
        ? 'Ліміт пошуку YouTube на сьогодні вичерпано — показуємо добірку з твоєї бібліотеки.'
        : 'Пошук YouTube зараз недоступний — показуємо добірку з твоєї бібліотеки.';
      break;
    }
    if (discovery.length >= 50) break;
  }

  if (discovery.length) {
    try {
      const details = await getVideos(discovery.slice(0, 50).map(item => item.videoId));
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
      degraded = true;
      if (!searchNotice) searchNotice = 'Дані пошуку отримано, але не вдалося уточнити частину деталей.';
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

  const entry: VibeCacheEntry = {
    expiresAt: Date.now() + CACHE_MS,
    result,
    profile,
    library: candidates,
    discovery,
    known,
    channelPages,
  };
  rankCacheEntry(entry);
  cache.set(userId, entry);
  if (entry.result.degraded && searchNotice) entry.result.notice = searchNotice;
  return responsePage(entry, excluded, limit);
}
