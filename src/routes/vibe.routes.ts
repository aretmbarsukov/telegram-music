import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getDatabase } from '../database.js';
import { buildVibe } from '../vibe.js';
import { YouTubeError, searchMusicTracks } from '../youtube.js';
import { upsertYouTubeMetadata } from '../youtube-cache.js';
import { authHook, identity } from './shared.js';

export function registerVibeRoutes(app: FastifyInstance): void {
  app.get('/api/vibe', { preHandler: authHook, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = z.object({ refresh: z.enum(['0', '1']).optional(), exclude: z.string().max(6000).optional() }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Invalid query' });
    const excludeIds = query.data.exclude ? query.data.exclude.split(',') : [];
    if (excludeIds.length > 500 || excludeIds.some(id => !/^[\w-]{11}$/.test(id))) return reply.code(400).send({ error: 'Invalid excluded video IDs' });
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.findUnique({ where: { telegramId: who.telegramId }, select: { id: true } });
    if (!user) return { tracks: [], seeds: { favorites: 0, channels: 0 }, degraded: false, notice: 'Додай треки в бібліотеку та познач улюблені, щоб зібрати свій вайб.' };
    try {
      return await buildVibe(db, user.id, { refresh: query.data.refresh === '1', excludeIds });
    } catch (error) {
      if (error instanceof YouTubeError) return reply.code(error.statusCode).send({ error: error.message, reason: error.reason });
      throw error;
    }
  });

  app.get('/api/youtube/search', { preHandler: authHook, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const query = z.object({ q: z.string().trim().min(2).max(100) }).safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: 'Search query must be between 2 and 100 characters' });
    const who = identity(request);
    const db = getDatabase();
    try {
      const tracks = await searchMusicTracks(query.data.q, 20);
      if (tracks.length) await db.$transaction(async tx => { for (const track of tracks) await upsertYouTubeMetadata(tx, track); });
      const videoIds = tracks.flatMap(track => track.videoId ? [track.videoId] : []);
      const user = await db.user.findUnique({ where: { telegramId: who.telegramId }, select: { id: true } });
      const memberships = user && videoIds.length ? await db.playlistItem.findMany({ where: { playlist: { userId: user.id }, track: { youtubeVideoId: { in: videoIds } } }, select: { playlistId: true, track: { select: { youtubeVideoId: true } } } }) : [];
      const playlistIdsByVideo = new Map<string, string[]>();
      for (const item of memberships) {
        const ids = playlistIdsByVideo.get(item.track.youtubeVideoId) ?? [];
        ids.push(item.playlistId);
        playlistIdsByVideo.set(item.track.youtubeVideoId, ids);
      }
      return { tracks: tracks.map(track => ({ ...track, playlistIds: track.videoId ? playlistIdsByVideo.get(track.videoId) ?? [] : [] })) };
    } catch (error) {
      if (error instanceof YouTubeError) return reply.code(error.statusCode).send({ error: error.message, reason: error.reason });
      throw error;
    }
  });
}
