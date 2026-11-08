import { Bot, InlineKeyboard } from 'grammy';
import type { Context } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { PrismaClient } from './generated/prisma/client.js';
import { config, telegramBotToken } from './config.js';
import { getDatabase, closeDatabase } from './database.js';
import { syncYouTubeSource } from './sync.js';
import { notifyAddedTracks } from './telegram-notifications.js';
import type { TelegramMessageSender } from './telegram-notifications.js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const intervalChoices = [15, 30, 60, 120] as const;
type Interval = typeof intervalChoices[number];
type SyncFn = typeof syncYouTubeSource;
type TelegramUser = NonNullable<Context['from']>;
export interface BotDependencies {
  db?: PrismaClient;
  getDb?: () => PrismaClient;
  appOrigin?: string;
  sync?: SyncFn;
  notify?: (db: PrismaClient, sourceId: string, tracks: { videoId: string; title: string }[]) => Promise<void>;
  botInfo?: UserFromGetMe;
}

const makeAppKeyboard = (appOrigin: string) => appOrigin.startsWith('https://')
  ? new InlineKeyboard().webApp('Відкрити музичний застосунок', appOrigin)
  : new InlineKeyboard().url('Відкрити застосунок', appOrigin);

export function createMusicBot(token: string, dependencies: BotDependencies = {}): Bot {
  const bot = new Bot(token, dependencies.botInfo ? { botInfo: dependencies.botInfo } : {});
  const dbFor = () => dependencies.db ?? (dependencies.getDb ?? getDatabase)();
  const appOrigin = dependencies.appOrigin ?? config.APP_ORIGIN;
  const appKeyboard = () => makeAppKeyboard(appOrigin);
  const syncSource = dependencies.sync ?? syncYouTubeSource;
  const notify = dependencies.notify ?? notifyAddedTracks;

  async function ensureUser(from: TelegramUser) {
    const db = dbFor();
    const user = await db.user.upsert({
      where: { telegramId: BigInt(from.id) },
      create: { telegramId: BigInt(from.id), firstName: from.first_name, lastName: from.last_name ?? null, username: from.username ?? null, languageCode: from.language_code ?? null, settings: { create: {} } },
      update: { firstName: from.first_name, lastName: from.last_name ?? null, username: from.username ?? null, languageCode: from.language_code ?? null },
      select: { id: true, settings: true },
    });
    const settings = await db.userSettings.upsert({ where: { userId: user.id }, create: { userId: user.id }, update: {} });
    return { db, user, settings };
  }

  const settingsText = (interval: number, notifications: boolean) => `Налаштування синхронізації\nІнтервал: кожні ${interval} хвилин.\nСповіщення про нові треки: ${notifications ? 'увімкнені' : 'вимкнені'}.`;
  const settingsKeyboard = (interval: number, notifications: boolean) => {
    const keyboard = new InlineKeyboard();
    for (const choice of intervalChoices) keyboard.text(`${interval === choice ? '✓ ' : ''}${choice} хв`, `setting:interval:${choice}`);
    keyboard.row().text(`Сповіщення: ${notifications ? 'увімкнені' : 'вимкнені'}`, 'setting:notifications:toggle');
    keyboard.row();
    if (appOrigin.startsWith('https://')) keyboard.webApp('Відкрити музичний застосунок', appOrigin);
    else keyboard.url('Відкрити застосунок', appOrigin);
    return keyboard;
  };

  bot.command('start', async ctx => {
    if (ctx.from) await ensureUser(ctx.from);
    await ctx.reply(`Привіт${ctx.from?.first_name ? `, ${ctx.from.first_name}` : ''}! Твоя музика чекає на тебе.`, { reply_markup: appKeyboard() });
  });
  bot.command('help', ctx => ctx.reply('Команди: /app — відкрити застосунок; /playlists — список плейлистів; /sync — синхронізувати YouTube-плейлисти; /add — додати музику; /settings — інтервал і сповіщення.', { reply_markup: appKeyboard() }));
  bot.command('app', ctx => ctx.reply('Відкрий музичну бібліотеку:', { reply_markup: appKeyboard() }));
  bot.command('playlists', async ctx => {
    if (!ctx.from) return;
    const db = dbFor();
    const user = await db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, select: { id: true } });
    const playlists = user ? await db.playlist.findMany({ where: { userId: user.id }, include: { _count: { select: { items: true } }, youtube: { select: { id: true, cachedTitle: true } } }, orderBy: { updatedAt: 'desc' }, take: 20 }) : [];
    const keyboard = new InlineKeyboard();
    for (const playlist of playlists) keyboard.text(`${playlist.title ?? playlist.youtube?.cachedTitle ?? 'YouTube плейлист'} · ${playlist._count.items}`, `playlist:${playlist.id}`).row();
    if (appOrigin.startsWith('https://')) keyboard.webApp('Відкрити музичний застосунок', appOrigin);
    else keyboard.url('Відкрити застосунок', appOrigin);
    const text = playlists.length ? 'Обери плейлист, щоб переглянути його стан:' : 'Тут поки немає плейлистів.';
    await ctx.reply(text, { reply_markup: keyboard });
  });
  bot.callbackQuery(/^playlist:([\w-]+)$/, async ctx => {
    const id = ctx.match[1]!;
    const db = dbFor();
    const playlist = await db.playlist.findFirst({ where: { id, user: { telegramId: BigInt(ctx.from.id) } }, include: { _count: { select: { items: true } }, youtube: { select: { cachedTitle: true, status: true, lastSuccessAt: true } } } });
    await ctx.answerCallbackQuery(playlist ? undefined : { text: 'Плейлист не знайдено' });
    if (!playlist) return;
    const title = playlist.title ?? playlist.youtube?.cachedTitle ?? 'YouTube плейлист';
    const lastSync = playlist.youtube?.lastSuccessAt ? `Остання синхронізація: ${playlist.youtube.lastSuccessAt.toLocaleString('uk-UA')}.` : 'Синхронізація ще не виконувалась.';
    await ctx.reply(`${title}\n${playlist._count.items} треків. ${lastSync}`, { reply_markup: appKeyboard() });
  });
  bot.command('sync', async ctx => {
    if (!ctx.from) return;
    const db = dbFor();
    const user = await db.user.findUnique({ where: { telegramId: BigInt(ctx.from.id) }, select: { id: true } });
    const sources = user ? await db.youTubeSource.findMany({ where: { ownerUserId: user.id }, select: { id: true } }) : [];
    if (!sources.length) return ctx.reply('У тебе ще немає імпортованих YouTube-плейлистів.', { reply_markup: appKeyboard() });
    let synced = 0; let errors = 0; let additions = 0;
    for (const source of sources) {
      try {
        const result = await syncSource(db, source.id);
        synced++; additions += result.added;
        await notify(db, source.id, result.addedTracks);
      } catch { errors++; }
    }
    await ctx.reply(`Синхронізацію завершено: ${synced} успішно, ${errors} з помилкою; нових треків: ${additions}.`, { reply_markup: appKeyboard() });
  });
  bot.command('add', ctx => ctx.reply('Щоб додати музику: відкрий застосунок → вибери плейлист → «Додати трек» → встав посилання на окреме YouTube-відео. Для імпорту добірки скористайся «Імпортувати плейлист».', { reply_markup: appKeyboard() }));
  bot.command('settings', async ctx => {
    if (!ctx.from) return;
    const { settings } = await ensureUser(ctx.from);
    await ctx.reply(settingsText(settings.syncIntervalMins, settings.notificationsEnabled), { reply_markup: settingsKeyboard(settings.syncIntervalMins, settings.notificationsEnabled) });
  });
  bot.callbackQuery(/^setting:interval:(\d+)$/, async ctx => {
    const interval = Number(ctx.match[1]);
    if (!intervalChoices.includes(interval as Interval)) return ctx.answerCallbackQuery({ text: 'Невідомий інтервал' });
    const { db, user } = await ensureUser(ctx.from);
    const now = new Date();
    const settings = await db.userSettings.update({ where: { userId: user.id }, data: { syncIntervalMins: interval } });
    await db.youTubeSource.updateMany({ where: { ownerUserId: user.id }, data: { intervalMins: interval, nextSyncAt: new Date(now.getTime() + interval * 60_000) } });
    await ctx.answerCallbackQuery({ text: `Інтервал оновлено: ${interval} хв` });
    await ctx.editMessageText(settingsText(settings.syncIntervalMins, settings.notificationsEnabled), { reply_markup: settingsKeyboard(settings.syncIntervalMins, settings.notificationsEnabled) });
  });
  bot.callbackQuery('setting:notifications:toggle', async ctx => {
    const { db, user, settings } = await ensureUser(ctx.from);
    const updated = await db.userSettings.update({ where: { userId: user.id }, data: { notificationsEnabled: !settings.notificationsEnabled } });
    await ctx.answerCallbackQuery({ text: updated.notificationsEnabled ? 'Сповіщення увімкнено' : 'Сповіщення вимкнено' });
    await ctx.editMessageText(settingsText(updated.syncIntervalMins, updated.notificationsEnabled), { reply_markup: settingsKeyboard(updated.syncIntervalMins, updated.notificationsEnabled) });
  });
  bot.catch(error => { console.error('Telegram bot update failed', error); });
  return bot;
}

export async function configureMenuButton(bot: Bot, appOrigin = config.APP_ORIGIN): Promise<void> {
  if (!appOrigin.startsWith('https://')) return;
  await bot.api.setMyCommands([
    { command: 'start', description: 'Почати роботу' },
    { command: 'help', description: 'Довідка та команди' },
    { command: 'app', description: 'Відкрити музичний застосунок' },
    { command: 'playlists', description: 'Мої плейлисти' },
    { command: 'sync', description: 'Синхронізувати плейлисти' },
    { command: 'add', description: 'Як додати музику' },
    { command: 'settings', description: 'Налаштування синхронізації' },
  ]);
  await bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Відкрити музичний застосунок', web_app: { url: appOrigin } } });
}

async function runLongPolling(): Promise<void> {
  if (config.BOT_MODE !== 'polling') throw new Error('Long polling requires BOT_MODE=polling; production webhook mode is started by the API server.');
  if (!telegramBotToken) throw new Error('BOT_TOKEN is required to run the bot');
  const bot = createMusicBot(telegramBotToken);
  await bot.api.deleteWebhook({ drop_pending_updates: false });
  await configureMenuButton(bot);
  try { await bot.start({ onStart: info => console.info(`Bot @${info.username} started with long polling`) }); }
  finally { await closeDatabase(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runLongPolling();
