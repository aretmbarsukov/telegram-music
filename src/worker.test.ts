import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createNonOverlappingRunner } from './non-overlapping.js';

test('background sync runner skips overlapping invocations and becomes available after completion', async () => {
  let releaseTask!: () => void;
  let calls = 0;
  const runner = createNonOverlappingRunner(async () => {
    calls++;
    await new Promise<void>(resolve => { releaseTask = resolve; });
  });

  const first = runner();
  assert.equal(await runner(), false);
  assert.equal(calls, 1);
  releaseTask();
  assert.equal(await first, true);
  const third = runner();
  assert.equal(calls, 2);
  releaseTask();
  assert.equal(await third, true);
  assert.equal(calls, 2);
});
