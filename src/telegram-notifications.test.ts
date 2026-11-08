import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from './generated/prisma/client.js';
import { notifyAddedTracks } from './telegram-notifications.js';

function fakeDb(enabled: boolean) {
  return { youTubeSource: { findUnique: async () => ({ cachedTitle: 'Remote Mix', playlist: { title: null }, owner: { telegramId: 321n, settings: { notificationsEnabled: enabled } } }) } } as unknown as PrismaClient;
}

test('sends one grouped playlist message when notifications are enabled', async () => {
  const sent: { chatId: number; text: string }[] = [];
  await notifyAddedTracks(fakeDb(true), 'source-1', Array.from({ length: 12 }, (_, i) => ({ videoId: `VID${String(i).padStart(8, '0')}`, title: `Track ${i + 1}` })), async (chatId, text) => { sent.push({ chatId, text }); });
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.chatId, 321);
  assert.match(sent[0]!.text, /«Remote Mix»/);
  assert.match(sent[0]!.text, /Track 1/);
  assert.match(sent[0]!.text, /та ще 2 треків/);
});

test('does not send additions when user disabled notifications', async () => {
  let sends = 0;
  await notifyAddedTracks(fakeDb(false), 'source-1', [{ videoId: 'AAAA0000001', title: 'Track' }], async () => { sends++; });
  assert.equal(sends, 0);
});
