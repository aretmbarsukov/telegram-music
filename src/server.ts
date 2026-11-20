import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bot } from 'grammy';

import { config, telegramBotToken } from './config.js';
import { closeDatabase } from './database.js';
import { telegramWebhookPath } from './telegram-webhook.js';
import { createMusicBot, configureMenuButton } from './bot.js';
import { startSyncWorker } from './worker.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerTrackRoutes } from './routes/tracks.routes.js';
import { registerPlaylistRoutes } from './routes/playlists.routes.js';
import { registerVibeRoutes } from './routes/vibe.routes.js';
import { registerWebhookRoute } from './routes/webhook.routes.js';
import { registerErrorHandler } from './routes/error-handler.js';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "frame-ancestors 'self' https://web.telegram.org https://*.web.telegram.org",
  "script-src 'self' https://telegram.org https://www.youtube.com https://s.ytimg.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' https://i.ytimg.com https://*.ytimg.com https://img.youtube.com data:",
  "connect-src 'self' https://telegram.org https://www.youtube.com https://youtube.com https://*.youtube.com",
  "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com",
  "media-src 'self' blob: data: https:",
].join('; ');

export async function createApp(options: { telegramBot?: Bot; runBackgroundSync?: boolean } = {}) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test', bodyLimit: 64 * 1024, trustProxy: true });
  let stopBackgroundSync: (() => void) | undefined;

  app.addHook('onSend', async (_request, reply, payload) => {
    reply.header('Content-Security-Policy', contentSecurityPolicy);
    reply.header('Permissions-Policy', 'autoplay=(self "https://www.youtube.com" "https://www.youtube-nocookie.com"), encrypted-media=(self "https://www.youtube.com" "https://www.youtube-nocookie.com")');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('X-Content-Type-Options', 'nosniff');
    return payload;
  });

  await app.register(cors, { origin: config.APP_ORIGIN, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  const publicRoot = resolve(process.cwd(), 'public');
  await app.register(staticFiles, {
    root: publicRoot,
    prefix: '/',
    index: ['index.html'],
    setHeaders(reply, filePath) {
      const publicPath = relative(publicRoot, filePath).replace(/\\/g, '/');
      if (publicPath === 'index.html' || publicPath.startsWith('js/')) {
        reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      }
    },
  });

  registerErrorHandler(app);
  registerWebhookRoute(app, options.telegramBot);
  registerAuthRoutes(app);
  registerTrackRoutes(app);
  registerPlaylistRoutes(app);
  registerVibeRoutes(app);

  app.get('/health', async () => ({
    ok: true,
    service: 'telegram-music',
    audioStreamEnabled: Boolean(config.AUDIO_STREAM_PROVIDER_URL?.trim()),
  }));
  app.get('/api/health', async () => ({
    ok: true,
    service: 'telegram-music-api',
    devAuthEnabled: config.DEV_AUTH_ENABLED && config.NODE_ENV !== 'production',
    devAuthUserId: config.DEV_AUTH_ENABLED && config.NODE_ENV !== 'production' ? config.DEV_AUTH_USER_ID : null,
    youtubeMockEnabled: config.YOUTUBE_MOCK_MODE,
    audioProviderConfigured: Boolean(config.AUDIO_STREAM_PROVIDER_URL?.trim()),
    audioStreamEnabled: Boolean(config.AUDIO_STREAM_PROVIDER_URL?.trim()),
  }));

  if (options.runBackgroundSync) stopBackgroundSync = startSyncWorker({ runImmediately: false });
  app.addHook('onClose', async () => {
    stopBackgroundSync?.();
    await closeDatabase();
  });
  return app;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let bot: Bot | undefined;
  if (config.BOT_MODE === 'webhook') {
    if (!telegramBotToken || !config.TELEGRAM_WEBHOOK_URL || !config.TELEGRAM_WEBHOOK_SECRET) {
      throw new Error('Webhook mode requires BOT_TOKEN, TELEGRAM_WEBHOOK_URL, and TELEGRAM_WEBHOOK_SECRET');
    }
    bot = createMusicBot(telegramBotToken);
  }
  const app = await createApp({ ...(bot ? { telegramBot: bot } : {}), runBackgroundSync: config.NODE_ENV === 'production' });
  try {
    await app.listen({ port: config.PORT, host: config.HOST });
    if (bot && config.TELEGRAM_WEBHOOK_URL && config.TELEGRAM_WEBHOOK_SECRET) {
      await configureMenuButton(bot);
      const url = `${config.TELEGRAM_WEBHOOK_URL.replace(/\/$/, '')}${telegramWebhookPath}`;
      await bot.api.setWebhook(url, { secret_token: config.TELEGRAM_WEBHOOK_SECRET });
      app.log.info(`Telegram webhook registered at ${url}`);
    }
    const shutdown = () => { void app.close(); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  } catch (error) {
    app.log.error(error);
    await app.close();
    process.exitCode = 1;
  }
}
