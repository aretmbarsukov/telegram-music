import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('player renderer only addresses elements present in the served HTML', async () => {
  const [source, rootHtml, publicHtml] = await Promise.all([
    readFile('app.js', 'utf8'),
    readFile('index.html', 'utf8'),
    readFile('public/index.html', 'utf8'),
  ]);
  assert.equal(publicHtml, rootHtml, 'root and served HTML must stay synchronized');
  const playerIds = [
    'now-playing', 'player-track-title', 'player-track-channel', 'mini-player-title',
    'mini-player-channel', 'stage-favorite', 'shuffle', 'repeat', 'youtube-original',
    'youtube-music', 'playback-message', 'queue-list', 'youtube-player', 'player-stage',
    'view-player', 'player-toggle', 'current-time', 'duration', 'progress-fill',
  ];
  for (const id of playerIds) {
    if (source.includes("$('#" + id)) {
      assert.ok(rootHtml.includes('id="' + id + '"'), 'missing player element #' + id);
    }
  }
});
