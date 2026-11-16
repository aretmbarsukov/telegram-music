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

test('mobile player styles keep tappable controls and a scrollable page', async () => {
  const [minimal, publicMinimal] = await Promise.all([
    readFile('minimal.css', 'utf8'),
    readFile('public/minimal.css', 'utf8'),
  ]);
  assert.equal(publicMinimal, minimal, 'root and served CSS must stay synchronized');
  // The queue button used to collapse to 12x2 px because of `font-size: 0`.
  assert.match(minimal, /\.queue-button\s*\{[^}]*min-height:\s*44px/s);
  // The transparent overlay and `pointer-events: none` made YouTube's own controls dead.
  assert.match(minimal, /\.player-stage::after\s*\{[^}]*display:\s*none/s);
  assert.match(minimal, /\.youtube-player\s*\{[^}]*pointer-events:\s*auto\s*!important/s);
  // The player view must scroll clear of the fixed bar, which sits above the mobile nav.
  assert.match(minimal, /body\.is-player-view \.shell\s*\{[^}]*padding-bottom:\s*calc\(240px/s);
});
