import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../database.js';
import { authHook, identity, videoIdSchema } from './shared.js';

export function registerTrackRoutes(app: FastifyInstance): void {
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
