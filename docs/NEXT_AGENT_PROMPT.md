# Prompt for the next agent

Continue the Telegram Music project in this checkout. Read `AGENTS.md`, `README.md`, `docs/HANDOFF.md`, and this file, then inspect the actual code and current status before changing it. Preserve the browser prototype; its source is in the project root and the served copy is in `public/`.

## Goal

Deliver a Telegram bot and Mini App for private, user-isolated music libraries backed by PostgreSQL. Support public YouTube playlist import, one-way 30-minute/manual sync, local additions that survive sync, and playback only through the official YouTube iframe. Never scrape/download/extract audio, write to YouTube, bypass ads, or put secrets in browser code.

## Current code

- Node.js + TypeScript + Fastify 5, Prisma 7.10.1, PostgreSQL `pg` adapter, grammY.
- Prisma schema includes users, playlists/items, tracks, YouTube source, sync history, settings, favorites/history, and UTC daily quota counters. Initial migration is `prisma/migrations/0001_init/migration.sql`.
- API and static UI are served by `src/server.ts`; every account route authenticates Telegram `initData` and scopes playlist lookup by user. A development header works only outside production.
- `src/youtube.ts` calls only official Data API v3 endpoints, retries temporary failures, and reserves each API attempt against a 9,000-unit daily database budget. Playlist imports are public-only and capped at 100 pages.
- `src/sync.ts` implements one-way reconciliation and preserves local rows; `src/worker.ts` checks for due sources every minute. `src/bot.ts` implements grammY commands.
- YouTube video API fields live separately in `YouTubeMetadata`, which has no foreign key to user Track records. Cache failure marks entries `STALE`; after 30 days only cache fields are cleared and rows become `EXPIRED`. Track IDs, playlist items, local titles, favorites and history are retained. Sync or preview restores metadata by video ID.
- `app.js` connects playlist CRUD, additions, import, manual sync and playback/history to the API on localhost/Telegram. API failures remain visible and do not switch to local browser storage. A standalone browser-local prototype remains outside those contexts.
- `src/bot.ts` exports the tested `createMusicBot` grammY factory. It implements `/start`, `/help`, `/app`, `/playlists` with user-scoped inline callbacks, `/sync`, `/add`, and `/settings` for sync interval and notifications. Bot and Mini App share `DATABASE_URL` and the same Telegram-ID user row.
- Successful syncs return new track titles; the worker, API sync endpoint and bot call `src/telegram-notifications.ts`. It groups titles into one message per changed playlist and checks persisted `UserSettings.notificationsEnabled` (`true` by default in migration `0003_bot_notifications`).
- Local `BOT_MODE=polling` runs via `npm run bot`. Production `BOT_MODE=webhook` mounts `/telegram/webhook` in Fastify, sets the webhook on Telegram, and validates the secret-token header before grammY handles the update. See `docs/TELEGRAM_SETUP.md` for `.env`, BotFather and HTTPS tunnel steps.

## Verified

On 2026-11-08: playlist CRUD/import/add/sync frontend flows are connected to the API on localhost and Telegram; dev auth and mock YouTube are explicit development-only flags. `npm run dev:demo` starts Fastify with PGlite and deterministic mock responses. The official IFrame Player API is integrated with playlist play/shuffle, track-context queues, next/previous, repeat queue/one, unavailable-video skipping, original-video links, API-backed Recently Played, and pause on hidden/pagehide. Three real public video IDs are fixtures; their present embed permissions were not live-verified. Telegram commands, inline playlist callbacks, persisted settings, grouped notifications, polling and a guarded webhook are implemented and tests use mocked grammY/Bot API. A Neon project named `telegram-music` was created in Europe on PostgreSQL 17; migrations `0001`–`0003` deployed successfully, `prisma migrate status` was up to date, and `prisma migrate diff` returned `No difference detected.` The integration suite passed 31/31 against a separate Neon test branch. Render Free preparation now includes `/health`, one-process production sync with an overlap guard, and `docs/DEPLOYMENT.md`; no Render service or GitHub remote has been created. Latest local checks passed (`npm run lint`, `npm run typecheck`, `npm test` 32/32, `npm run build`). No live Telegram/YouTube credentials or playback were verified. Exact PostgreSQL 16 compatibility remains unverified; see HANDOFF.

## Immediate work

1. Continue Render Free setup after the owner signs in: create a **Free** web service from the private GitHub repository only after it exists; if Render requests payment details, stop. Use `npm ci && npm run db:generate && npm run build`, `npm start`, and `/health`.
2. Enter all deploy values/secrets only in Render's service Environment settings. Use the generated `onrender.com` URL for `APP_ORIGIN` and `TELEGRAM_WEBHOOK_URL`; do not read/paste `.env` contents into GitHub or chat. The app registers the webhook and menu button on startup.
3. Have the owner create an UptimeRobot free HTTP monitor or cron-job.org GET job for `/health` every 5 minutes. This may reduce Render Free spin-down but cannot guarantee 24/7 uptime; see Free-plan caveats in `docs/DEPLOYMENT.md`.
4. With credentials entered by the owner, verify `/start`, `/playlists`, `/sync`, `/settings`, real YouTube playlist import, and audible iframe playback. Do not report these as working before live checks. Recommend restricting the YouTube key by API; do not use IP restrictions unless Render provides a verified static egress IP.
5. Native PostgreSQL migration and integration checks are complete on Neon PostgreSQL 17. If PostgreSQL 16 compatibility is specifically required, use a separate disposable instance; never reset existing data. Add metadata restoration coverage by stable video ID.
6. Persist favorites through the API; add account data deletion with explicit semantics; test unavailable YouTube retries and concurrent worker/manual sync; finish privacy policy and production operational review.

## Commands

Quick ephemeral demo: `npm install`, then `npm run dev:demo`; open `http://127.0.0.1:8787`. Uses in-memory PGlite and mocked YouTube responses; all data resets when stopped. For persistent local development, copy `.env.example` to `.env`, set `DATABASE_URL` for a local PostgreSQL service, run `npm run db:generate` and `npx prisma migrate deploy`, then `npm run dev`. `.env.example` explicitly enables local-only `DEV_AUTH_ENABLED=true` and `YOUTUBE_MOCK_MODE=true`; production startup rejects either flag. Run `npm run worker` separately for scheduled syncs; run `npm run bot` after setting a real bot token and HTTPS Mini App URL.

## Constraints

Neon PostgreSQL 17 is configured for this project, with `.env` holding a direct `DATABASE_URL`; do not print or commit it. `.gitignore` contains `.env`, but this checkout has no `.git` directory so Git status/ignore tracking could not be verified. Neon project compute is 0.25 CU; the account billing tier was not inspected. No Telegram token, YouTube API key, privacy policy, or HTTPS deployment is available in this checkout; PGlite is also available for ephemeral tests. Follow current YouTube Data API policies and refresh/delete API cache fields within 30 days while preserving all user records and links. Never enable development auth in production. Do not delete Track/PlaylistItem/Favorite/PlaybackHistory records as part of cache cleanup. Preserve the existing frontend prototype unless a concrete technical need requires a targeted change.
