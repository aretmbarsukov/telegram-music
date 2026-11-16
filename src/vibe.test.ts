import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVibeProfile,
  normalizeVibeText,
  rankVibe,
  selectVibeBatch,
  scoreVibeCandidate,
  type VibeCandidate,
  type VibeSeed,
} from './vibe.js';

const seed = (overrides: Partial<VibeSeed> = {}): VibeSeed => ({
  videoId: 'seed0000001',
  title: 'Night drive',
  channel: 'Lofi Girl',
  duration: 'PT3M30S',
  weight: 3,
  ...overrides,
});

const candidate = (overrides: Partial<VibeCandidate> = {}): VibeCandidate => ({
  videoId: 'cand0000001',
  title: 'Night drive',
  channel: 'Lofi Girl',
  thumbnail: null,
  duration: 'PT3M30S',
  source: 'discovery',
  favorite: false,
  recent: false,
  ...overrides,
});

test('normalizes Cyrillic, punctuation, and casing for matching', () => {
  assert.equal(normalizeVibeText('  Нічний   ВАЙБ! '), 'нічний вайб');
  assert.equal(normalizeVibeText('Lofi-Girl / Radio'), 'lofi girl radio');
});

test('builds channel and token weights from favorites and history', () => {
  const profile = buildVibeProfile([
    seed(),
    seed({ videoId: 'seed0000002' }),
    seed({ videoId: 'seed0000003', channel: 'Other Artist', title: 'Morning drive', weight: 1 }),
  ]);

  assert.equal(profile.topChannels[0], 'lofi girl');
  assert.equal(profile.channelWeights.get('lofi girl'), 1);
  assert.ok((profile.channelWeights.get('other artist') ?? 0) <= 1);
  assert.ok((profile.tokenWeights.get('drive') ?? 0) > 0);
  assert.equal(profile.averageDurationSeconds, 210);
});

test('scores a matching channel above an unrelated one and explains why', () => {
  const profile = buildVibeProfile([seed()]);
  const rng = () => 0.5;
  const match = scoreVibeCandidate(candidate(), profile, rng);
  const unrelated = scoreVibeCandidate(
    candidate({ videoId: 'cand0000002', channel: 'Random Channel', title: 'Something else' }),
    profile,
    rng,
  );

  assert.ok(match.score > unrelated.score);
  assert.match(match.reason, /Lofi Girl/);
  assert.equal(unrelated.reason, 'Нова музика для тебе');
});

test('ranking keeps discovery first and retains a large deduplicated candidate pool', () => {
  const profile = buildVibeProfile([seed()]);
  const discovery: VibeCandidate[] = [];
  for (let index = 0; index < 9; index++) {
    discovery.push(
      candidate({
        videoId: `disc${String(index).padStart(7, '0')}`,
        channel: 'Lofi Girl',
        title: `Night drive ${index}`,
      }),
    );
  }
  const library: VibeCandidate[] = [
    candidate({ videoId: 'libr0000001', source: 'library', favorite: true, channel: 'Lofi Girl' }),
    candidate({ videoId: 'libr0000002', source: 'library', channel: 'Other Artist', title: 'Morning drive' }),
  ];

  const ranked = rankVibe(profile, library, discovery, { limit: 8, rng: () => 0.5 });

  assert.ok(ranked.length >= 5 && ranked.length <= 8);
  assert.equal(new Set(ranked.map(track => track.videoId)).size, ranked.length);
  assert.ok(ranked.filter(track => track.videoId.startsWith('disc')).length >= 5);
  assert.equal(ranked.some(track => track.videoId === 'libr0000001'), false);
  assert.ok(ranked.every(track => track.availability === 'AVAILABLE' && track.reason));
  assert.ok(ranked.filter(track => track.channel === 'Lofi Girl').length > 5);
});

test('recommendation batches diversify channels without truncating the full pool', () => {
  const tracks = [
    ...Array.from({ length: 16 }, (_, index) => ({
      videoId: `lofi${String(index).padStart(7, '0')}`,
      title: `Lofi ${index}`,
      channel: 'Lofi Girl',
      thumbnail: null,
      duration: null,
      availability: 'AVAILABLE' as const,
      reason: 'Match',
    })),
    ...Array.from({ length: 10 }, (_, index) => ({
      videoId: `other${String(index).padStart(6, '0')}`,
      title: `Other ${index}`,
      channel: 'Other Artist',
      thumbnail: null,
      duration: null,
      availability: 'AVAILABLE' as const,
      reason: 'Match',
    })),
  ];
  const batch = selectVibeBatch(tracks, 20);
  assert.equal(batch.length, 20);
  assert.equal(batch.filter(track => track.channel === 'Lofi Girl').length, 12);
  assert.equal(batch.filter(track => track.channel === 'Other Artist').length, 8);
});

test('ranking falls back to library tracks when discovery is empty', () => {
  const profile = buildVibeProfile([seed()]);
  const ranked = rankVibe(
    profile,
    [
      candidate({ videoId: 'libr0000001', source: 'library', favorite: true }),
      candidate({ videoId: 'libr0000002', source: 'library', channel: 'Other Artist' }),
    ],
    [],
    { limit: 10, rng: () => 0.5 },
  );

  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.videoId, 'libr0000002');
});
