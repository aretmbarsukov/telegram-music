import { config } from './config.js';

export class AudioProviderError extends Error {
  constructor(message: string, readonly statusCode = 502) {
    super(message);
  }
}

interface ResolvedAudio {
  url: string;
  mimeType?: string;
  expiresAt: number;
}

const cache = new Map<string, ResolvedAudio>();
const CACHE_MS = 2 * 60 * 60 * 1000;

export function getAudioProviderUrl(): string | null {
  const value = config.AUDIO_STREAM_PROVIDER_URL?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export async function resolveDirectAudio(trackId: string): Promise<{ url: string; mimeType?: string }> {
  const providerTemplate = getAudioProviderUrl();
  if (!providerTemplate) throw new AudioProviderError('Audio stream provider is not configured', 503);
  if (!/^[\w-]{11}$/.test(trackId)) throw new AudioProviderError('Invalid track ID', 400);

  const now = Date.now();
  const cached = cache.get(trackId);
  if (cached && cached.expiresAt > now) return { url: cached.url, ...(cached.mimeType ? { mimeType: cached.mimeType } : {}) };
  if (cached) cache.delete(trackId);

  const providerUrl = providerTemplate.includes('{id}')
    ? providerTemplate.replace('{id}', encodeURIComponent(trackId))
    : `${providerTemplate}${providerTemplate.includes('?') ? '&' : '?'}id=${encodeURIComponent(trackId)}`;

  let response: Response;
  try {
    response = await fetch(providerUrl, { signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new AudioProviderError('Audio stream provider is unavailable', 502);
  }
  if (!response.ok) throw new AudioProviderError(`Audio stream provider returned HTTP ${response.status}`, response.status === 429 ? 429 : 502);

  const payload = await response.json().catch(() => null) as { url?: unknown; mimeType?: unknown } | null;
  if (!payload || typeof payload.url !== 'string') throw new AudioProviderError('Audio stream provider returned invalid response', 502);
  let resolvedUrl: URL;
  try {
    resolvedUrl = new URL(payload.url);
  } catch {
    throw new AudioProviderError('Audio stream provider returned invalid URL', 502);
  }
  if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
    throw new AudioProviderError('Audio stream provider returned unsupported URL', 502);
  }
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : undefined;
  cache.set(trackId, { url: resolvedUrl.toString(), ...(mimeType ? { mimeType } : {}), expiresAt: now + CACHE_MS });
  return { url: resolvedUrl.toString(), ...(mimeType ? { mimeType } : {}) };
}

export function clearAudioProviderCache(): void {
  cache.clear();
}
