import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildQueue, firstPlayableIndex, nextPlayableIndex, previousPlayableIndex, shuffleUpcoming } from './player-queue.js';

test('shuffle puts selected track first and shuffles the remaining queue deterministically', () => {
  const result = buildQueue(['a', 'b', 'c', 'd'], 'b', true, () => 0);
  assert.deepEqual(result, { queue: ['b', 'd', 'a', 'c'], currentIndex: 0 });
  assert.equal(new Set(result.queue).size, 4);
});

test('shuffle upcoming keeps current and already-played entries fixed', () => {
  assert.deepEqual(shuffleUpcoming(['a', 'b', 'c', 'd'], 1, () => 0), ['a', 'b', 'd', 'c']);
});

test('next and previous move through the queue and stop at either end without repeat', () => {
  assert.equal(nextPlayableIndex(['a', 'b', 'c'], 0), 1);
  assert.equal(nextPlayableIndex(['a', 'b', 'c'], 2), null);
  assert.equal(previousPlayableIndex(['a', 'b', 'c'], 2), 1);
  assert.equal(previousPlayableIndex(['a', 'b', 'c'], 0), null);
});

test('repeat queue wraps and skips unavailable tracks in both directions', () => {
  const unavailable = new Set(['a', 'c']);
  assert.equal(nextPlayableIndex(['a', 'b', 'c'], 2, unavailable, 'queue'), 1);
  assert.equal(previousPlayableIndex(['a', 'b', 'c'], 1, unavailable, 'queue'), 1);
});

test('repeat one restarts only on natural end; manual next still advances', () => {
  assert.equal(nextPlayableIndex(['a', 'b'], 0, new Set(), 'one', 'ended'), 0);
  assert.equal(nextPlayableIndex(['a', 'b'], 0, new Set(), 'one', 'manual'), 1);
  assert.equal(nextPlayableIndex(['a', 'b'], 1, new Set(), 'one', 'manual'), null);
});

test('automatic skip selects the next available item and stops if every item is unavailable', () => {
  assert.equal(firstPlayableIndex(['bad-1', 'bad-2', 'good'], 0, new Set(['bad-1', 'bad-2'])), 2);
  assert.equal(firstPlayableIndex(['bad-1', 'bad-2'], 0, new Set(['bad-1', 'bad-2'])), null);
  assert.equal(nextPlayableIndex(['a', 'b'], 0, new Set(['a', 'b']), 'queue'), null);
});
