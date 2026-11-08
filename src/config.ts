import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().optional(),
  BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  BOT_MODE: z.enum(['polling', 'webhook']).default('polling'),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1).max(256).regex(/^[A-Za-z0-9_-]+$/).optional(),
  YOUTUBE_API_KEY: z.string().optional(),
  DEV_AUTH_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  YOUTUBE_MOCK_MODE: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  YOUTUBE_DAILY_QUOTA_LIMIT: z.coerce.number().int().min(1).max(10_000).default(9_000),
  APP_ORIGIN: z.string().url().default('http://localhost:8787'),
  DEV_AUTH_USER_ID: z.string().regex(/^\d{1,20}$/).default('100000001'),
});

export const config = schema.parse(process.env);
export const telegramBotToken = config.BOT_TOKEN || config.TELEGRAM_BOT_TOKEN;

if (config.NODE_ENV === 'production' && (config.DEV_AUTH_ENABLED || config.YOUTUBE_MOCK_MODE)) {
  throw new Error('Development authentication and YouTube mock mode are disabled in production');
}
if (config.NODE_ENV === 'production' && !config.DATABASE_URL) {
  throw new Error('DATABASE_URL is required in production');
}
if (config.NODE_ENV === 'production' && (!telegramBotToken || config.BOT_MODE !== 'webhook' || !config.TELEGRAM_WEBHOOK_URL || !config.TELEGRAM_WEBHOOK_SECRET || !config.TELEGRAM_WEBHOOK_URL.startsWith('https://') || !config.APP_ORIGIN.startsWith('https://'))) {
  throw new Error('Production requires BOT_TOKEN, BOT_MODE=webhook, HTTPS Mini App and webhook URLs, and TELEGRAM_WEBHOOK_SECRET');
}
