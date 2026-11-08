import assert from 'node:assert/strict';
import { test } from 'node:test';
import { playerErrorDetails } from './player-errors.js';

test('invalid, unavailable, and embed-blocked videos have clear messages and skip once', () => {
  for (const code of [2, 5, 100, 101, 150]) {
    const details = playerErrorDetails(code);
    assert.ok(details.message.length > 20);
    assert.equal(details.skip, true);
  }
});

test('missing YouTube client identity reports a setup message without looping through the queue', () => {
  const details = playerErrorDetails(153);
  assert.match(details.message, /адресу сайту/);
  assert.equal(details.skip, false);
});

test('unknown player errors are reported and stop instead of failing silently', () => {
  const details = playerErrorDetails(999);
  assert.match(details.message, /999/);
  assert.equal(details.skip, false);
});
