# Decisions

1. Start with a dependency-free browser prototype because this workspace had no project files and no API credentials. This makes core interaction reviewable without pretending remote integrations work.
2. Keep playback on the official YouTube iframe; never proxy or extract media.
3. Treat YouTube synchronization as one-way. Local additions are explicitly separate and survive future reconciliation.
4. The prototype persists only in browser `localStorage`; production identity and persistence require the documented API/database architecture.
5. Public integrations require real credentials; use a local development identity only outside production.
6. Added a separate Fastify TypeScript backend, PostgreSQL/Prisma 7 schema, grammY bot, YouTube Data API client and worker while keeping the existing prototype intact.
7. Use Prisma 7.10.1 with `@prisma/adapter-pg` and `prisma.config.ts`; this avoids an older CLI dependency audit finding and follows the current Prisma PostgreSQL adapter setup.
8. Store the YouTube playlist source owner explicitly and enforce `(ownerUserId, youtubeId)` uniqueness so different users can import the same public source safely.
9. Reserve each official YouTube Data API request attempt in a UTC daily quota counter, defaulting to 9,000 units. The daily cap leaves headroom under the current standard default allocation; actual project quota must be verified in Google Cloud.
10. Store YouTube API metadata in `YouTubeMetadata` and source cache fields, separate from Track/PlaylistItem/Favorite/PlaybackHistory. The cache has no foreign key to user Track rows. At expiry, clear only cache columns and retain the stable video ID and every user association so a later API refresh can restore metadata without data loss.
