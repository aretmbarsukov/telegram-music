import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeUrl } from './youtube.js';
import { getPlaylist, getPlaylistItems, getVideo, getVideos } from './youtube.js';
import { config } from './config.js';

test('parses standard video URL forms', () => {
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), { kind: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=4'), { kind: 'video', id: 'dQw4w9WgXcQ' });
  assert.deepEqual(parseYouTubeUrl('https://music.youtube.com/shorts/dQw4w9WgXcQ'), { kind: 'video', id: 'dQw4w9WgXcQ' });
});

test('recognizes YouTube and YouTube Music playlist URLs', () => {
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890abcd'), { kind: 'playlist', id: 'PL1234567890abcd' });
  assert.deepEqual(parseYouTubeUrl('https://music.youtube.com/playlist?list=PL1234567890abcd'), { kind: 'playlist', id: 'PL1234567890abcd' });
});

test('rejects malformed and non-YouTube URLs', () => {
  assert.equal(parseYouTubeUrl('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseYouTubeUrl('https://youtube.com/watch?v=short'), null);
  assert.equal(parseYouTubeUrl('not a link'), null);
});

test('YouTube mock mode returns deterministic fixtures without network access', async () => {
  const original = config.YOUTUBE_MOCK_MODE;
  config.YOUTUBE_MOCK_MODE = true;
  try {
    const playlist = await getPlaylist('PLdemo123');
    const items = await getPlaylistItems('PLdemo123');
    const video = await getVideo(items[0]!.videoId!);
    const videos = await getVideos(items.slice(0, 2).map(item => item.videoId!));
    assert.equal(playlist.title, 'Luna demo playlist');
    assert.equal(items.length, 3);
    assert.equal(video.title, 'YouTube IFrame API demo');
    assert.equal(videos.length, 2);
  } finally {
    config.YOUTUBE_MOCK_MODE = original;
  }
});
