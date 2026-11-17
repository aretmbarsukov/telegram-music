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

test('home view includes the translated YouTube music search and playlist-save UI', async () => {
  const [source, servedSource, rootHtml, publicHtml, translations, servedTranslations] = await Promise.all([
    readFile('app.js', 'utf8'),
    readFile('public/app.js', 'utf8'),
    readFile('index.html', 'utf8'),
    readFile('public/index.html', 'utf8'),
    readFile('i18n.js', 'utf8'),
    readFile('public/i18n.js', 'utf8'),
  ]);
  assert.equal(servedSource, source, 'root and served app must stay synchronized');
  assert.equal(publicHtml, rootHtml, 'root and served HTML must stay synchronized');
  assert.equal(servedTranslations, translations, 'root and served translations must stay synchronized');
  for (const id of ['music-search-form', 'music-search-query', 'music-search-playlist', 'music-search-results']) {
    assert.ok(rootHtml.includes(`id="${id}"`), `missing search element #${id}`);
  }
  assert.match(source, /data-search-add/);
  assert.match(translations, /musicSearchSaved:/);
});

test('mobile player styles keep tappable controls and a scrollable page', async () => {
  const [minimal, publicMinimal] = await Promise.all([
    readFile('minimal.css', 'utf8'),
    readFile('public/minimal.css', 'utf8'),
  ]);
  assert.equal(publicMinimal, minimal, 'root and served CSS must stay synchronized');
  // The queue button used to collapse to 12x2 px because of `font-size: 0`.
  assert.match(minimal, /\.queue-button\s*\{[^}]*min-height:\s*44px/s);
  // The app owns playback controls; clicks must not reach the YouTube iframe.
  assert.match(minimal, /\.player-stage::after\s*\{[^}]*display:\s*none/s);
  assert.match(minimal, /\.youtube-player,\s*\.youtube-player iframe\s*\{[^}]*pointer-events:\s*none\s*!important/s);
  assert.match(minimal, /\.player-bar\s*\{[^}]*width:\s*calc\(100% - 32px\)/s);
  assert.match(minimal, /\.player-bar\s*\{[^}]*max-width:\s*760px/s);
  assert.match(minimal, /\.player-bar\s*\{[^}]*left:\s*50%[^}]*transform:\s*translateX\(-50%\)/s);
  assert.match(minimal, /\.now-playing,\s*\.player-controls,\s*\.player-right,\s*\.progress-row,\s*\.progress\s*\{[^}]*max-width:\s*100%/s);
  assert.match(minimal, /\.now-playing,\s*\.player-controls,\s*\.player-right,\s*\.progress-row,\s*\.progress\s*\{[^}]*min-width:\s*0/s);
  assert.match(minimal, /\.player-page\s*\{[^}]*max-width:\s*800px/s);
  assert.match(minimal, /@media \(max-width: 700px\)[\s\S]*?\.player-bar\s*\{[^}]*width:\s*min\(calc\(100% - 32px\),\s*380px\)/s);
  assert.match(minimal, /@media \(max-width: 700px\)[\s\S]*?\.player-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(minimal, /@media \(max-width: 700px\)[\s\S]*?\.player-controls\s*\{[^}]*max-width:\s*320px/s);
  // The player view must scroll clear of the fixed bar, which sits above the mobile nav.
  assert.match(minimal, /body\.is-player-view \.shell\s*\{[^}]*padding-bottom:\s*calc\(240px/s);
});
