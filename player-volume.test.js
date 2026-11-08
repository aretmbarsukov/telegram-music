import assert from 'node:assert/strict';
import { test } from 'node:test';
import { togglePlayerAudio } from './player-volume.js';

test('unmutes explicitly and restores a zero player volume to a moderate level', () => {
  const calls = [];
  let muted = true;
  let volume = 0;
  const player = {
    isMuted: () => muted,
    getVolume: () => volume,
    unMute: () => { calls.push('unMute'); muted = false; },
    mute: () => { calls.push('mute'); muted = true; },
    setVolume: value => { calls.push('setVolume:' + value); volume = value; },
  };

  assert.equal(togglePlayerAudio(player), false);
  assert.deepEqual(calls, ['unMute', 'setVolume:50']);
  assert.equal(muted, false);
  assert.equal(volume, 50);
});

test('mutes explicitly without changing a nonzero volume', () => {
  const calls = [];
  const player = {
    isMuted: () => false,
    getVolume: () => 35,
    unMute: () => calls.push('unMute'),
    mute: () => calls.push('mute'),
    setVolume: value => calls.push('setVolume:' + value),
  };

  assert.equal(togglePlayerAudio(player), true);
  assert.deepEqual(calls, ['mute']);
});
