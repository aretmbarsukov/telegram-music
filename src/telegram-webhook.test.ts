import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerTelegramWebhook, telegramWebhookPath } from './telegram-webhook.js';

test('protects webhook updates with the Telegram secret token header', async () => {
  const app = Fastify();
  let received = 0;
  registerTelegramWebhook(app, { handleUpdate: async () => { received++; } }, 'secret_test-123');
  await app.ready();
  const rejected = await app.inject({ method: 'POST', url: telegramWebhookPath, payload: { update_id: 1 } });
  assert.equal(rejected.statusCode, 401);
  assert.equal(received, 0);
  const accepted = await app.inject({ method: 'POST', url: telegramWebhookPath, headers: { 'x-telegram-bot-api-secret-token': 'secret_test-123' }, payload: { update_id: 2 } });
  assert.equal(accepted.statusCode, 200);
  assert.equal(received, 1);
  await app.close();
});
