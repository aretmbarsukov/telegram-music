import { timingSafeEqual } from 'node:crypto';
import type { Bot } from 'grammy';
import type { Update } from 'grammy/types';
import type { FastifyInstance } from 'fastify';

export const telegramWebhookPath = '/telegram/webhook';

function matchesSecret(expectedSecret: string, supplied: string | string[] | undefined): boolean {
  if (typeof supplied !== 'string') return false;
  const expected = Buffer.from(expectedSecret);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function registerTelegramWebhook(app: FastifyInstance, bot: Pick<Bot, 'handleUpdate'>, secretToken: string): void {
  app.post(telegramWebhookPath, async (request, reply) => {
    if (!matchesSecret(secretToken, request.headers['x-telegram-bot-api-secret-token'])) {
      return reply.code(401).send({ error: 'Invalid Telegram webhook secret' });
    }
    try {
      await bot.handleUpdate(request.body as Update);
      return reply.code(200).send({ ok: true });
    } catch (error) {
      request.log.error({ err: error }, 'Telegram webhook update failed');
      return reply.code(500).send({ error: 'Could not process Telegram update' });
    }
  });
}
