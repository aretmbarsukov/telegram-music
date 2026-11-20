import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../database.js';
import { authHook, identity, queryInitDataAuthHook, videoIdSchema } from './shared.js';
import { AudioProviderError, getAudioProviderUrl, resolveDirectAudio } from '../audio-provider.js';

export function registerTrackRoutes(app: FastifyInstance): void {
  const audioStreamAuthHook = async (request: Parameters<typeof queryInitDataAuthHook>[0], reply: Parameters<typeof queryInitDataAuthHook>[1]) => {
    await queryInitDataAuthHook(request, reply);
    if (!request.identity) request.log.warn('Audio stream authentication failed');
  };

  app.post('/api/tracks/:id/prefetch', { preHandler: authHook }, async (request, reply) => {
    if (!getAudioProviderUrl()) return reply.code(204).send();
    const params = z.object({ id: videoIdSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid track ID' });
    try {
      await resolveDirectAudio(params.data.id);
      return reply.code(204).send();
    } catch (error) {
      if (error instanceof AudioProviderError) return reply.code(error.statusCode).send({ error: error.message });
      throw error;
    }
  });

  app.get('/api/tracks/:id/audio-stream', {
    preHandler: audioStreamAuthHook,
    logLevel: 'warn',
  }, async (request, reply) => {
    const params = z.object({ id: videoIdSchema }).safeParse(request.params);
    if (!params.success) {
      request.log.warn('Audio stream request has an invalid track ID');
      return reply.code(400).send({ error: 'Invalid track ID' });
    }
    if (!getAudioProviderUrl()) {
      request.log.warn('Audio stream provider is not configured');
      return reply.code(404).send({ error: 'Direct audio provider is not configured' });
    }

    let resolved: { url: string; mimeType?: string };
    try {
      resolved = await resolveDirectAudio(params.data.id);
    } catch (error) {
      const statusCode = error instanceof AudioProviderError ? error.statusCode : 502;
      request.log.warn({ statusCode }, 'Audio stream URL resolution failed');
      return reply.code(statusCode).send({ error: error instanceof AudioProviderError ? error.message : 'Audio stream URL resolution failed' });
    }

    const rangeHeader = request.headers.range;
    const upstreamHeaders: Record<string, string> = { Accept: 'audio/*' };
    if (typeof rangeHeader === 'string') upstreamHeaders.Range = rangeHeader;
    let upstream: Response;
    try {
      upstream = await fetch(resolved.url, { headers: upstreamHeaders, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    } catch {
      request.log.warn('Audio stream upstream request failed');
      return reply.code(502).send({ error: 'Could not reach direct audio provider' });
    }
    if (!upstream.ok && upstream.status !== 206) {
      request.log.warn({ upstreamStatus: upstream.status }, 'Audio stream upstream returned an error');
      if (upstream.status === 416) return reply.code(416).send({ error: 'Requested audio range is not satisfiable' });
      return reply.code(upstream.status === 404 ? 404 : 502).send({ error: 'Audio stream unavailable' });
    }
    if (typeof rangeHeader === 'string' && upstream.status !== 206) {
      request.log.warn({ upstreamStatus: upstream.status }, 'Audio stream upstream did not honor the requested range');
      return reply.code(502).send({ error: 'Upstream audio provider does not support byte ranges' });
    }

    const contentLength = upstream.headers.get('content-length');
    const contentRange = upstream.headers.get('content-range');
    const upstreamContentType = (upstream.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase();
    const contentType = upstreamContentType === 'audio/mp4' || upstreamContentType === 'audio/mpeg'
      ? upstreamContentType
      : 'audio/mp4';
    reply.header('Cache-Control', 'private, no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Content-Type', contentType);
    if (contentLength) reply.header('Content-Length', contentLength);
    if (contentRange) reply.header('Content-Range', contentRange);

    if (upstream.status === 206 || typeof rangeHeader === 'string') {
      reply.code(206);
    } else {
      reply.code(upstream.status);
    }
    if (!upstream.body) return reply.send();
    const reader = upstream.body.getReader();
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) controller.close();
          else controller.enqueue(result.value);
        } catch {
          request.log.warn('Audio stream body read failed');
          controller.error(new Error('Audio stream body read failed'));
        }
      },
      cancel(reason) {
        void reader.cancel(reason);
      },
    });
    return reply.send(stream);
  });

  app.get('/api/history', { preHandler: authHook }, async request => {
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { telegramId: who.telegramId }, select: { id: true } });
    if (!user) return [];
    const rows = await db.playbackHistory.findMany({ where: { userId: user.id }, orderBy: { playedAt: 'desc' }, take: 30, include: { track: true } });
    const metadata = await db.youTubeMetadata.findMany({ where: { videoId: { in: rows.map(row => row.track.youtubeVideoId) } } });
    const cacheById = new Map(metadata.map(row => [row.videoId, row]));
    return rows.map(row => {
      const videoId = row.track.youtubeVideoId;
      const cache = cacheById.get(videoId);
      return { id: row.id, videoId, playedAt: row.playedAt, title: cache?.title ?? (cache?.status === 'EXPIRED' ? 'YouTube metadata expired' : 'YouTube video'), channel: cache?.channelTitle ?? null, thumbnail: cache?.thumbnailUrl ?? null, duration: cache?.duration ?? null, availability: cache?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE', metadataStatus: cache?.status ?? 'EXPIRED' };
    });
  });

  app.post('/api/history', { preHandler: authHook }, async (request, reply) => {
    const body = z.object({ videoId: videoIdSchema }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'Invalid video ID' });
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.upsert({ where: { telegramId: who.telegramId }, create: { ...who, settings: { create: {} } }, update: {} });
    const result = await db.$transaction(async tx => {
      const track = await tx.track.upsert({ where: { youtubeVideoId: body.data.videoId }, create: { youtubeVideoId: body.data.videoId }, update: {}, select: { id: true } });
      return tx.playbackHistory.create({ data: { userId: user.id, trackId: track.id }, select: { id: true, playedAt: true } });
    });
    return reply.code(201).send({ id: result.id, videoId: body.data.videoId, playedAt: result.playedAt });
  });

  app.get('/api/favorites', { preHandler: authHook }, async request => {
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { telegramId: who.telegramId }, select: { id: true } });
    if (!user) return [];
    const rows = await db.favorite.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, include: { track: true } });
    const metadata = await db.youTubeMetadata.findMany({ where: { videoId: { in: rows.map(row => row.track.youtubeVideoId) } } });
    const cacheById = new Map(metadata.map(row => [row.videoId, row]));
    return rows.map(row => {
      const videoId = row.track.youtubeVideoId;
      const cache = cacheById.get(videoId);
      return { videoId, title: cache?.title ?? 'YouTube video', channel: cache?.channelTitle ?? null, thumbnail: cache?.thumbnailUrl ?? null, duration: cache?.duration ?? null, availability: cache?.status === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'AVAILABLE', metadataStatus: cache?.status ?? 'EXPIRED' };
    });
  });

  app.post('/api/favorites/:videoId', { preHandler: authHook }, async (request, reply) => {
    const params = z.object({ videoId: videoIdSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid video ID' });
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.upsert({ where: { telegramId: who.telegramId }, create: { ...who, settings: { create: {} } }, update: {} });
    const track = await db.track.upsert({ where: { youtubeVideoId: params.data.videoId }, create: { youtubeVideoId: params.data.videoId }, update: {}, select: { id: true } });
    await db.favorite.upsert({ where: { userId_trackId: { userId: user.id, trackId: track.id } }, create: { userId: user.id, trackId: track.id }, update: {} });
    const { invalidateVibe } = await import('../vibe.js');
    invalidateVibe(user.id);
    return reply.code(204).send();
  });

  app.delete('/api/favorites/:videoId', { preHandler: authHook }, async (request, reply) => {
    const params = z.object({ videoId: videoIdSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: 'Invalid video ID' });
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { telegramId: who.telegramId }, select: { id: true } });
    if (user) {
      await db.favorite.deleteMany({ where: { userId: user.id, track: { youtubeVideoId: params.data.videoId } } });
      const { invalidateVibe } = await import('../vibe.js');
      invalidateVibe(user.id);
    }
    return reply.code(204).send();
  });
}
