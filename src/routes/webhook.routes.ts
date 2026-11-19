import type { FastifyInstance } from 'fastify';
import type { Bot } from 'grammy';
import { config } from '../config.js';
import { registerTelegramWebhook } from '../telegram-webhook.js';

export function registerWebhookRoute(app: FastifyInstance, bot?: Bot): void {
  if (!bot) return;
  if (!config.TELEGRAM_WEBHOOK_SECRET) throw new Error('TELEGRAM_WEBHOOK_SECRET is required for webhook mode');
  registerTelegramWebhook(app, bot, config.TELEGRAM_WEBHOOK_SECRET);
}
