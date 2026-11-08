import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from './generated/prisma/client.js';
import type { Update } from 'grammy/types';
import { createMusicBot, configureMenuButton } from './bot.js';

const ownerId = 7654321;
const playlist = { id: 'playlist-1', title: 'Road trip', _count: { items: 4 }, youtube: { id: 'source-1', cachedTitle: 'Remote playlist', status: 'SUCCESS', lastSuccessAt: new Date('2026-01-01T00:00:00Z') } };

function setup() {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const state = { interval: 30, notificationsEnabled: true, settingsWrites: 0, playlistOwner: ownerId, sourceUpdates: [] as unknown[] };
  const db = {
    user: {
      upsert: async () => ({ id: 'user-1', settings: null }),
      findUnique: async () => ({ id: 'user-1' }),
    },
    userSettings: {
      upsert: async () => ({ id: 'settings-1', userId: 'user-1', language: 'uk', theme: 'system', syncEnabled: true, syncIntervalMins: state.interval, notificationsEnabled: state.notificationsEnabled }),
      update: async ({ data }: { data: { syncIntervalMins?: number; notificationsEnabled?: boolean } }) => {
        if (data.syncIntervalMins !== undefined) state.interval = data.syncIntervalMins;
        if (data.notificationsEnabled !== undefined) state.notificationsEnabled = data.notificationsEnabled;
        state.settingsWrites++;
        return { id: 'settings-1', userId: 'user-1', language: 'uk', theme: 'system', syncEnabled: true, syncIntervalMins: state.interval, notificationsEnabled: state.notificationsEnabled };
      },
    },
    playlist: {
      findMany: async () => [playlist],
      findFirst: async ({ where }: { where: { user: { telegramId: bigint } } }) => where.user.telegramId === BigInt(state.playlistOwner) ? playlist : null,
    },
    youTubeSource: {
      findMany: async () => [{ id: 'source-1' }],
      updateMany: async (args: unknown) => { state.sourceUpdates.push(args); return { count: 1 }; },
    },
  } as unknown as PrismaClient;
  const notifications: unknown[] = [];
  const bot = createMusicBot('123456:test-only-token', {
    db,
    botInfo: { id: 999, is_bot: true, first_name: 'Music Bot', username: 'music_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false, has_topics_enabled: false, allows_users_to_create_topics: false, can_manage_bots: false, supports_join_request_queries: false },
    appOrigin: 'https://music.example.test',
    sync: async () => ({ added: 2, removed: 0, reordered: false, unavailable: 0, total: 2, syncedAt: new Date(), addedTracks: [{ videoId: 'AAAA0000001', title: 'New One' }, { videoId: 'BBBB0000002', title: 'New Two' }] }),
    notify: async (_database, sourceId, tracks) => { notifications.push({ sourceId, tracks }); },
  });
  bot.api.config.use((async (_previous: unknown, method: string, payload: unknown) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    if (method === 'sendMessage') return { ok: true, result: { message_id: calls.length, date: 1_800_000_000, chat: { id: ownerId, type: 'private', first_name: 'Mira' }, text: String((payload as { text?: string }).text ?? '') } } as never;
    return { ok: true, result: true } as never;
  }) as never);
  return { bot, calls, state, notifications };
}

function handle(bot: ReturnType<typeof createMusicBot>, update: unknown) { return bot.handleUpdate(update as Update); }

function messageUpdate(text: string, userId = ownerId) {
  const command = text.split(' ')[0]!;
  return { update_id: Math.floor(Math.random() * 1_000_000), message: { message_id: 1, date: 1_800_000_000, chat: { id: userId, type: 'private' as const, first_name: 'Mira' }, from: { id: userId, is_bot: false, first_name: 'Mira' }, text, entities: [{ offset: 0, length: command.length, type: 'bot_command' as const }] } };
}

function callbackUpdate(data: string, userId = ownerId) {
  return { update_id: Math.floor(Math.random() * 1_000_000), callback_query: { id: `callback-${Math.random()}`, from: { id: userId, is_bot: false, first_name: 'Mira' }, chat_instance: 'chat-instance', message: { message_id: 3, date: 1_800_000_000, chat: { id: userId, type: 'private' as const, first_name: 'Mira' }, from: { id: 999, is_bot: true, first_name: 'Music Bot' }, text: 'menu' }, data } };
}

test('registers users and replies to start, help, app, and add with an HTTPS Mini App button', async () => {
  const { bot, calls } = setup();
  for (const text of ['/start', '/help', '/app', '/add']) await handle(bot, messageUpdate(text));
  assert.equal(calls.filter(call => call.method === 'sendMessage').length, 4);
  assert.match(String(calls[0]!.payload.text), /Привіт, Mira/);
  assert.match(String(calls[3]!.payload.text), /Додати трек/);
  const keyboard = calls[0]!.payload.reply_markup as { inline_keyboard: { text: string; web_app?: { url: string } }[][] };
  assert.equal(keyboard.inline_keyboard[0]![0]!.text, 'Відкрити музичний застосунок');
  assert.equal(keyboard.inline_keyboard[0]![0]!.web_app?.url, 'https://music.example.test');
});

test('configures Telegram chat menu as the HTTPS Mini App', async () => {
  const { bot, calls } = setup();
  await configureMenuButton(bot, 'https://music.example.test');
  const call = calls.find(entry => entry.method === 'setChatMenuButton');
  assert.ok(call);
  const button = call.payload.menu_button as { type: string; text: string; web_app: { url: string } };
  assert.equal(button.type, 'web_app');
  assert.equal(button.text, 'Відкрити музичний застосунок');
  assert.equal(button.web_app.url, 'https://music.example.test');
});

test('shows user-scoped playlists as inline buttons and handles playlist selection', async () => {
  const { bot, calls } = setup();
  await handle(bot, messageUpdate('/playlists'));
  const reply = calls.find(call => call.method === 'sendMessage')!;
  const markup = reply.payload.reply_markup as { inline_keyboard: { callback_data?: string }[][] };
  assert.equal(markup.inline_keyboard[0]![0]!.callback_data, 'playlist:playlist-1');
  await bot.handleUpdate(callbackUpdate('playlist:playlist-1'));
  assert.equal(calls.some(call => call.method === 'sendMessage' && String(call.payload.text).includes('Road trip')) , true);
  await bot.handleUpdate(callbackUpdate('playlist:playlist-1', ownerId + 1));
  assert.equal(calls.some(call => call.method === 'answerCallbackQuery' && call.payload.text === 'Плейлист не знайдено'), true);
});

test('syncs playlists, groups added-track notice, and settings update interval and notifications', async () => {
  const { bot, calls, state, notifications } = setup();
  await bot.handleUpdate(messageUpdate('/sync'));
  assert.equal(notifications.length, 1);
  assert.equal(calls.some(call => call.method === 'sendMessage' && String(call.payload.text).includes('нових треків: 2')), true);
  await bot.handleUpdate(messageUpdate('/settings'));
  await bot.handleUpdate(callbackUpdate('setting:interval:60'));
  assert.equal(state.interval, 60);
  assert.equal(state.sourceUpdates.length, 1);
  assert.deepEqual((state.sourceUpdates[0] as { data: { intervalMins: number } }).data.intervalMins, 60);
  await bot.handleUpdate(callbackUpdate('setting:notifications:toggle'));
  assert.equal(state.notificationsEnabled, false);
  assert.equal(state.settingsWrites, 2);
  assert.equal(calls.some(call => call.method === 'editMessageText' && String(call.payload.text).includes('вимкнені')), true);
});
