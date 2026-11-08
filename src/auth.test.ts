import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { AuthError, validateInitData } from './auth.js';
import { authenticate } from './auth.js';
import { config } from './config.js';
import type { FastifyRequest } from 'fastify';

function sign(fields: Record<string, string>, token: string): string {
  const pairs = Object.entries(fields).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  const check = pairs.map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams([...pairs, ['hash', hash]]).toString();
}

test('accepts valid, recent Telegram initData and parses identity', () => {
  const token = 'test-only-token'; const now = 1_800_000_000;
  const data = sign({ auth_date: String(now - 60), query_id: 'q123', user: JSON.stringify({ id: 123456789, first_name: 'Ada', username: 'ada', language_code: 'uk' }) }, token);
  const identity = validateInitData(data, token, now);
  assert.equal(identity.telegramId, 123456789n);
  assert.equal(identity.firstName, 'Ada');
  assert.equal(identity.languageCode, 'uk');
});

test('rejects modified Telegram initData', () => {
  const token = 'test-only-token'; const now = 1_800_000_000;
  const data = sign({ auth_date: String(now), user: JSON.stringify({ id: 12, first_name: 'Ada' }) }, token).replace('first_name%22%3A%22Ada', 'first_name%22%3A%22Eve');
  assert.throws(() => validateInitData(data, token, now), AuthError);
});

test('rejects expired Telegram initData', () => {
  const token = 'test-only-token'; const now = 1_800_000_000;
  const data = sign({ auth_date: String(now - 86_401), user: JSON.stringify({ id: 12, first_name: 'Ada' }) }, token);
  assert.throws(() => validateInitData(data, token, now), /expired/);
});

test('local development identity requires the explicit toggle and never works in production', () => {
  const originalEnabled = config.DEV_AUTH_ENABLED;
  const originalEnvironment = config.NODE_ENV;
  const request = { headers: { 'x-dev-user-id': config.DEV_AUTH_USER_ID } } as unknown as FastifyRequest;
  try {
    config.DEV_AUTH_ENABLED = false;
    config.NODE_ENV = 'development';
    assert.throws(() => authenticate(request), AuthError);
    config.DEV_AUTH_ENABLED = true;
    assert.equal(authenticate(request).telegramId, BigInt(config.DEV_AUTH_USER_ID));
    config.NODE_ENV = 'production';
    assert.throws(() => authenticate(request), AuthError);
  } finally {
    config.DEV_AUTH_ENABLED = originalEnabled;
    config.NODE_ENV = originalEnvironment;
  }
});
