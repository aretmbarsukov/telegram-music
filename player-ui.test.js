import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

test('player renderer only addresses elements present in the served HTML', async () => {
  const [source, telegramBridge, publicHtml] = await Promise.all([
    readFile('public/js/main.js', 'utf8'),
    readFile('public/js/telegram-bridge.js', 'utf8'),
    readFile('public/index.html', 'utf8'),
  ]);
  const playerIds = [
    'now-playing', 'player-track-title', 'player-track-channel', 'mini-player-title',
    'mini-player-channel', 'stage-favorite', 'shuffle', 'repeat', 'youtube-original',
    'youtube-music', 'playback-message', 'queue-list', 'youtube-player', 'player-stage',
    'view-player', 'player-toggle', 'current-time', 'duration', 'progress-fill',
  ];
  for (const id of playerIds) {
    if (source.includes("$('#" + id)) {
      assert.ok(publicHtml.includes('id="' + id + '"'), 'missing player element #' + id);
    }
    assert.ok(publicHtml.includes('id="native-audio-player"'));
    assert.ok(publicHtml.includes('playsinline'));
  }
  assert.match(source, /playerVars:\s*\{\s*playsinline:\s*1,\s*origin:\s*location\.origin,\s*controls:\s*0\s*\}/);
  assert.match(source, /initializeTelegramWebApp/);
  assert.match(source, /AUDIO_STREAM_PROVIDER|directAudioMode|audio-stream/);
  assert.ok(source.includes('initData=${encodeURIComponent(telegram.initData)}'));
  assert.ok(source.includes('apiHealth.audioStreamEnabled === true'));
  assert.match(source, /const playRequest = nativeAudio\.play\(\)/);
  assert.match(source, /playRequest\?\.catch\(\(error\) => reportNativeAudioError\(error\)\)/);
  assert.match(source, /nativeAudio\?\.error\?\.code/);
  assert.match(publicHtml, /href="css\/tokens\.css\?v=5"/);
  assert.match(publicHtml, /href="css\/app\.css\?v=5"/);
  assert.match(publicHtml, /src="i18n\.js\?v=5"/);
  assert.match(publicHtml, /src="\/js\/main\.js\?v=5"/);
  assert.match(publicHtml, /src="\/js\/seek-bar\.js\?v=5"/);
  assert.match(telegramBridge, /webApp\.ready/);
  assert.match(telegramBridge, /webApp\.expand/);
  assert.match(telegramBridge, /disableVerticalSwipes/);
  assert.match(source, /telegram\?\.BackButton|BackButton/);
  assert.match(telegramBridge, /impactOccurred/);
  assert.match(source, /navigator\.mediaSession/);
  assert.match(source, /setActionHandler/);
  assert.match(source, /playerStreamRetries/);
});

test('home view includes the translated YouTube music search and playlist-save UI', async () => {
  const [source, publicHtml, translations] = await Promise.all([
    readFile('public/js/main.js', 'utf8'),
    readFile('public/index.html', 'utf8'),
    readFile('public/i18n.js', 'utf8'),
  ]);
  for (const id of ['music-search-form', 'music-search-query', 'music-search-playlist', 'music-search-results']) {
    assert.ok(publicHtml.includes(`id="${id}"`), `missing search element #${id}`);
  }
  assert.match(source, /data-search-add/);
  assert.match(translations, /musicSearchSaved:/);
});

test('mobile player styles keep tappable controls and a scrollable page', async () => {
  const appCss = await readFile('public/css/app.css', 'utf8');
  const tokens = await readFile('public/css/tokens.css', 'utf8');
  assert.match(tokens, /--tg-theme-bg-color/);
  assert.match(tokens, /--tg-theme-text-color/);
  assert.match(appCss, /100dvh/);
  assert.match(appCss, /env\(safe-area-inset-bottom/);
  assert.match(appCss, /env\(safe-area-inset-top/);
  assert.match(appCss, /--tg-viewport-stable-height/);
  assert.match(appCss, /@keyframes shimmer/);
  assert.match(appCss, /backdrop-filter:\s*blur/);
  assert.doesNotMatch(appCss, /important/);
  // The queue button used to collapse to 12x2 px because of `font-size: 0`.
  assert.match(appCss, /\.queue-button\s*\{[^}]*min-height:\s*44px/s);
  // The app owns playback controls; clicks must not reach the YouTube iframe.
  assert.match(appCss, /\.player-stage::after\s*\{[^}]*display:\s*none/s);
  assert.match(appCss, /\.youtube-player,\s*\.youtube-player iframe\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(appCss, /\.player-bar\s*\{[^}]*width:\s*calc\(100% - 32px\)/s);
  assert.match(appCss, /\.player-bar\s*\{[^}]*max-width:\s*760px/s);
  assert.match(appCss, /\.player-bar\s*\{[^}]*left:\s*50%[^}]*transform:\s*translateX\(-50%\)/s);
  assert.match(appCss, /\.now-playing\s*\{[^}]*min-width:\s*0/s);
  assert.match(appCss, /\.progress\s*\{[^}]*min-width:\s*0/s);
  assert.match(appCss, /\.progress\s*\{[^}]*max-width:\s*100%/s);
  assert.match(appCss, /\.player-page\s*\{[^}]*max-width:\s*800px/s);
  assert.match(appCss, /@media \(max-width: 700px\)[\s\S]*?\.player-bar\s*\{[^}]*width:\s*min\(calc\(100% - 32px\),\s*380px\)/s);
  assert.match(appCss, /@media \(max-width: 700px\)[\s\S]*?\.player-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto/s);
  assert.match(appCss, /@media \(max-width: 700px\)[\s\S]*?\.player-controls\s*\{[^}]*max-width:\s*320px/s);
  assert.match(appCss, /@media \(max-width: 700px\)[\s\S]*?\.player-controls \.progress-row\s*\{[^}]*max-width:\s*240px/s);
  assert.match(appCss, /\.progress\s*\{[^}]*background:\s*transparent/s);
  assert.match(appCss, /\.progress::before\s*\{[^}]*height:\s*3px/s);
  assert.match(appCss, /\.progress #progress-fill,[\s\S]*?\.progress > i\s*\{[^}]*height:\s*3px/s);
  // The player view must scroll clear of the fixed bar, which sits above the mobile nav.
  assert.match(appCss, /body\.is-player-view \.shell\s*\{[^}]*padding-bottom:\s*calc\(240px/s);
});
