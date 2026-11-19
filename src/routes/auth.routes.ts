import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../database.js';
import { authHook, identity } from './shared.js';

export function registerAuthRoutes(app: FastifyInstance): void {
  app.get('/api/me', { preHandler: authHook }, async request => {
    const who = identity(request);
    const db = getDatabase();
    const user = await db.user.upsert({
      where: { telegramId: who.telegramId },
      create: { ...who, settings: { create: {} } },
      update: { username: who.username, firstName: who.firstName, lastName: who.lastName, languageCode: who.languageCode },
      include: { settings: true },
    });
    return { id: user.id, telegramId: user.telegramId.toString(), firstName: user.firstName, username: user.username, language: user.settings?.language ?? 'uk' };
  });
}
