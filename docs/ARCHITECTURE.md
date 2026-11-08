# Architecture

## Current implementation

- `src/server.ts`: Fastify REST API and static hosting for `public/`.
- `src/auth.ts`: Telegram Web App `initData` HMAC validation, expiry checks, and development-only test identity.
- `src/database.ts`: Prisma 7 client using the official PostgreSQL `pg` adapter.
- `prisma/schema.prisma`: normalized account, playlist, track, separate YouTube metadata cache/source, sync history, preferences, favorites, playback history, and daily quota schema.
- `src/youtube.ts`, `src/youtube-cache.ts`: official YouTube Data API v3 public metadata client, URL parsing, bounded retries, daily request budget reservation, freshness states, and cache-only expiry updates. Explicit local `YOUTUBE_MOCK_MODE=true` returns deterministic fixtures without outbound API requests; configuration rejects mock mode in production.
- `src/sync.ts`, `src/worker.ts`: manual and periodic one-way reconciliation; the standalone worker polls every minute for sources due at their configured 30-minute interval and refreshes cached video metadata before its 30-day expiry. In production, the Fastify process starts the same loop in-process; a process-level overlap guard and the per-source database claim prevent overlapping sync work.
- `src/bot.ts`: import-safe grammY bot factory for `/start`, `/help`, `/app`, `/playlists`, `/sync`, `/add`, `/settings`, scoped inline playlist callbacks, and the HTTPS Mini App chat menu button. `BOT_MODE=polling` runs with `npm run bot`; production `BOT_MODE=webhook` is mounted on Fastify and validates Telegram's secret-token header before `handleUpdate`.
- `src/telegram-notifications.ts`: sends at most one new-track message per changed playlist, honors persisted per-user `notificationsEnabled`, and is called after successful syncs by the worker, API and bot.
- `src/telegram-webhook.ts`: Fastify webhook route with constant-time secret-header comparison.
- `index.html`, `styles.css`, `api-states.css`, `app.js`: preserved browser prototype with backend-backed localhost/Telegram flow; `public/` contains the served copies. Telegram sends `initData`; localhost uses the development header only after `/api/health` advertises the explicitly enabled development identity. API errors never fall back to local prototype data. Other standalone contexts retain the original browser-local prototype.

## REST API

- `GET /api/health` is public.
- Authenticated routes use `Authorization: tma <initData>`.
- `GET /api/me`, `GET/POST /api/playlists`, `GET/PATCH/DELETE /api/playlists/:id`.
- `POST/DELETE /api/playlists/:id/tracks`, `POST /api/playlists/:id/sync`.
- `POST /api/youtube/preview`, `POST /api/youtube/import`.
- Bot and API operations resolve the same Telegram `User` from Telegram ID and share the same Prisma database.
- In non-production only, `x-dev-user-id` matching `DEV_AUTH_USER_ID` enables local API testing. Production ignores this header.
- Development identity is off by default and requires `DEV_AUTH_ENABLED=true`; production startup rejects that flag. `YOUTUBE_MOCK_MODE=true` is also development-only and rejected in production.

Every playlist query checks ownership through the signed Telegram account. Telegram bot and API share `User` rows.

## YouTube policy and quota

Only official Data API v3 endpoints are called server-side; playback stays in the official YouTube iframe. API request attempts reserve one unit from a UTC daily budget (default 9,000, leaving headroom under the default 10,000 units/day allocation). Playlist item calls request up to 50 items and cost 1 unit each; imports are capped at 100 pages. Preview/import/manual sync endpoints also have rate limits. Sync refreshes metadata and reconciles the playlist; it never writes to YouTube. Configure and review the quota in Google Cloud before real use. Track and playlist API metadata live in cache fields separate from user records. Failed refresh marks cache `STALE`; after 30 days, only cached title/channel/thumbnail/duration fields are cleared. Tracks, playlist items, favorites and history are not deleted. A later successful preview or sync restores cache by stable YouTube ID.

## Local setup

See `README.md`. PostgreSQL Compose configuration is in `docker-compose.yml`. Docker was unavailable in the development environment, so the schema was validated/generated and SQL migration created, but no live database migration or data-backed API test was possible.

## Production requirements still outstanding

Use HTTPS and a public Mini App URL; configure a real bot token and YouTube key securely; provide a privacy policy and account data deletion flow; verify YouTube API compliance; add operational monitoring; deploy API, webhook and in-process sync on Render Free; run database integration tests with an isolated PostgreSQL service. Render preparation is documented; no Render service has been created or live-verified.
