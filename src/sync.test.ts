import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSync } from './sync.js';
import { cacheFailureState, metadataFailureUpdate } from './youtube-cache.js';

test('counts additions and removals without treating a local add as synced content', () => {
  assert.deepEqual(summarizeSync(['a', 'b'], ['b', 'c', 'local'], new Set(['local'])), { added: 1, removed: 1, reordered: false });
});

test('detects relative reorder among retained source tracks', () => {
  assert.deepEqual(summarizeSync(['a', 'b', 'c'], ['c', 'b', 'a'], new Set()), { added: 0, removed: 0, reordered: true });
});

test('ignores local items when comparing source order and leaves them out of source additions', () => {
  assert.deepEqual(summarizeSync(['a', 'b'], ['a', 'local', 'b'], new Set(['local'])), { added: 0, removed: 0, reordered: false });
});

test('keeps recent cached metadata marked stale after a failed refresh', () => {
  const now = new Date('2026-11-08T12:00:00Z'); const refreshed = new Date('2026-10-20T12:00:00Z');
  const update = metadataFailureUpdate(refreshed, now, 'quotaExceeded');
  assert.equal(update.status, 'STALE');
  assert.equal('title' in update, false);
  assert.equal(update.retryAt.getTime(), now.getTime() + 6 * 60 * 60_000);
});

test('expires only YouTube cache fields after 30 days and preserves the track reference', () => {
  const now = new Date('2026-11-08T12:00:00Z'); const refreshed = new Date('2026-10-01T12:00:00Z');
  assert.equal(cacheFailureState(refreshed, now), 'EXPIRED');
  const update = metadataFailureUpdate(refreshed, now, 'network_error');
  assert.deepEqual(update, { title: null, channelTitle: null, thumbnailUrl: null, duration: null, status: 'EXPIRED', lastAttemptAt: now, retryAt: null, lastErrorCode: 'network_error' });
  assert.equal('trackId' in update, false);
  assert.equal('favorite' in update, false);
});
