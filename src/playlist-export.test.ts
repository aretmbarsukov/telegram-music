import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { PrismaClient } from './generated/prisma/client.js';
import { backgroundPlaybackUrl, buildM3u, isoDurationToSeconds, loadPlaylistExport, playlistFileName, type PlaylistExport } from './playlist-export.js';

test('converts YouTube ISO-8601 durations to seconds', () => {
  assert.equal(isoDurationToSeconds('PT3M32S'), 212);
  assert.equal(isoDurationToSeconds('PT1H2M3S'), 3723);
  assert.equal(isoDurationToSeconds('P1DT1S'), 86401);
  assert.equal(isoDurationToSeconds('PT0S'), 0);
  assert.equal(isoDurationToSeconds(null), -1);
  assert.equal(isoDurationToSeconds('LIVE'), -1);
});

test('builds an ordered M3U with official YouTube links and sanitized labels', () => {
  const playlist: PlaylistExport = {
    id: 'playlist-1',
    title: 'Road\ntrip',
    hasYouTubeSource: true,
    tracks: [
      { videoId: 'AAAAAAAAAAA', title: 'Faded', channel: 'Alan Walker', duration: 'PT3M32S', availability: 'AVAILABLE' },
      { videoId: 'BBBBBBBBBBB', title: 'Local\nTitle', channel: null, duration: null, availability: 'UNAVAILABLE' },
    ],
  };
  assert.equal(playlistFileName('Road trip'), 'Road trip.m3u');
  assert.equal(playlistFileName('a/b:c*d?'), 'a-b-c-d-.m3u');
  assert.equal(playlistFileName('   '), 'luna-playlist.m3u');
  assert.equal(
    buildM3u(playlist),
    [
      '#EXTM3U',
      '#PLAYLIST:Road trip',
      '#EXTINF:212,Alan Walker - Faded',
      'https://www.youtube.com/watch?v=AAAAAAAAAAA',
      '#EXTINF:-1,Local Title',
      'https://www.youtube.com/watch?v=BBBBBBBBBBB',
      '',
    ].join('\n'),
  );
});

test('builds official background-playback links without extracting media', () => {
  assert.equal(backgroundPlaybackUrl({ youtubePlaylistId: 'PL123' }), 'https://music.youtube.com/playlist?list=PL123');
  assert.equal(backgroundPlaybackUrl({ videoIds: ['AAAAAAAAAAA', 'BBBBBBBBBBB'] }), 'https://www.youtube.com/watch_videos?video_ids=AAAAAAAAAAA,BBBBBBBBBBB');
  assert.equal(backgroundPlaybackUrl({ videoIds: [] }), null);
  const many = Array.from({ length: 55 }, (_, index) => `V${index}`);
  const capped = backgroundPlaybackUrl({ videoIds: many });
  assert.ok(capped);
  assert.equal(capped.split('video_ids=')[1]!.split(',').length, 50);
});

test('loads a user-owned playlist in position order with cached metadata', async () => {
  const db = {
    playlist: {
      findFirst: async (args: unknown) => {
        assert.deepEqual((args as { where: { user: { telegramId: bigint } } }).where.user.telegramId, 42n);
        return {
          id: 'playlist-1',
          title: null,
          youtube: { id: 'source-1', cachedTitle: 'Remote playlist' },
          items: [
            { customTitle: null, track: { youtubeVideoId: 'AAAAAAAAAAA' } },
            { customTitle: 'My local title', track: { youtubeVideoId: 'BBBBBBBBBBB' } },
          ],
        };
      },
    },
    youTubeMetadata: {
      findMany: async () => [
        { videoId: 'AAAAAAAAAAA', title: 'Remote title', channelTitle: 'Channel', duration: 'PT4M13S', status: 'FRESH' },
        { videoId: 'BBBBBBBBBBB', title: 'Ignored title', channelTitle: null, duration: null, status: 'UNAVAILABLE' },
      ],
    },
  } as unknown as PrismaClient;
  const result = await loadPlaylistExport(db, 'playlist-1', 42n);
  assert.ok(result);
  assert.equal(result.title, 'Remote playlist');
  assert.equal(result.hasYouTubeSource, true);
  assert.equal(result.youtubePlaylistId, 'source-1');
  assert.deepEqual(result.tracks, [
    { videoId: 'AAAAAAAAAAA', title: 'Remote title', channel: 'Channel', duration: 'PT4M13S', availability: 'AVAILABLE' },
    { videoId: 'BBBBBBBBBBB', title: 'My local title', channel: null, duration: null, availability: 'UNAVAILABLE' },
  ]);
});

test('returns null when the playlist does not belong to the user', async () => {
  const db = { playlist: { findFirst: async () => null } } as unknown as PrismaClient;
  assert.equal(await loadPlaylistExport(db, 'missing', 42n), null);
});
