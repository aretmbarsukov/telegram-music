import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildVibeProfile,
  normalizeVibeText,
  rankVibe,
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

test('ranking keeps discovery first, deduplicates, and caps a single channel', () => {
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
  assert.equal(ranked.filter(track => track.videoId.startsWith('disc')).length, 5);
  assert.equal(ranked.some(track => track.videoId === 'libr0000001'), false);
  assert.ok(ranked.every(track => track.availability === 'AVAILABLE' && track.reason));
  const perChannel = new Map<string, number>();
  for (const track of ranked) perChannel.set(track.channel ?? '', (perChannel.get(track.channel ?? '') ?? 0) + 1);
  assert.ok([...perChannel.values()].every(count => count <= 5));
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

  assert.equal(ranked.length, 2);
  assert.ok(ranked.every(track => track.videoId.startsWith('libr')));
});
