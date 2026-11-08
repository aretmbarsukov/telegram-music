# Telegram Music

A mobile-first Telegram music library for managing YouTube playlists. The original browser prototype is preserved and served by the new Fastify application.

## Local development

Requirements: Node.js 22+ and npm. For a zero-setup preview with Fastify routes, Prisma, temporary PostgreSQL (PGlite), and mocked YouTube data:

```powershell
npm install
npm run dev:demo
```

Open `http://127.0.0.1:8787`. Create a playlist or import `https://www.youtube.com/playlist?list=PLdemo123`. The demo database is in memory and resets when stopped.

For persistent local data, start a PostgreSQL service, copy `.env.example` to `.env`, set `DATABASE_URL`, then run:

```powershell
npm install
npm run db:generate
npx prisma migrate deploy
npm run dev
```

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env`; adjust values if needed. The sample database password is for local development only.
3. Start PostgreSQL: `docker compose up -d postgres`.
4. Generate Prisma client and apply schema: `npm run db:generate`, then `npm run db:push` (or use `npm run db:migrate -- --name init` for migration-based development).
5. Start the API and UI: `npm run dev`.
6. Open `http://127.0.0.1:8787`. Local API calls use the development-only identity from `DEV_AUTH_USER_ID`.

The sample `.env.example` explicitly enables `DEV_AUTH_ENABLED=true` and `YOUTUBE_MOCK_MODE=true` for local development. Set both to `false` in production; the application refuses to start in production if either is enabled. Dev identity is accepted only when the server has the toggle enabled and only for `DEV_AUTH_USER_ID`. On localhost, the frontend checks `/api/health` before using that identity. In Telegram it sends `initData` as `Authorization: tma …` and the server verifies its signature and age.

API errors are displayed and do not switch the app to browser-local prototype data. The standalone browser prototype remains available outside localhost/Telegram contexts.

## YouTube Data API

Create/configure a Google Cloud project and enable YouTube Data API v3. Put its key in the server-side `YOUTUBE_API_KEY` variable, never in browser code. The app imports public playlists only. API request attempts are reserved against a daily budget (default 9,000 units, configurable up to 10,000), and API retry/rate limits are bounded. Read the current official [YouTube Data API documentation](https://developers.google.com/youtube/v3) and [Developer Policies](https://developers.google.com/youtube/terms/developer-policies); configure and review the quota before real use. The worker refreshes metadata before day 30. Failed refresh marks cache stale; expiry clears only YouTube cache fields and preserves tracks, playlist entries, favorites, history and local titles. A later successful preview or sync restores metadata by video ID.

## Telegram bot and Mini App

See the step-by-step [Telegram setup guide](docs/TELEGRAM_SETUP.md) for creating the bot, setting `BOT_TOKEN`, configuring the Mini App menu button, exposing local development over HTTPS, and choosing polling or production webhook mode. Bot handlers and the Fastify Mini App use the same Prisma `DATABASE_URL` and `User` rows. The backend verifies Telegram Mini App `initData` using the bot token. Never enable development identity in production.

## Background sync

In production (`NODE_ENV=production`), the API process starts the periodic sync loop itself, checking for due jobs every minute. A process-level overlap guard prevents two cycles from running at once, and the existing database claim prevents concurrent syncs of the same source. Render deployment therefore uses one web service for the API, Telegram webhook, and sync loop. For local development, `npm run worker` is still available as a separate process. Manual sync is available in the playlist page or through `/sync` in the bot.

## Render Free deployment

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the one-service Render setup, HTTPS webhook and Mini App configuration, secure environment variables, and optional five-minute UptimeRobot monitor. Render Free sleeps after inactivity, so an external monitor may reduce cold starts but cannot guarantee 24/7 service or an SLA.

## Checks

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npx prisma validate`

Database-backed integration checks require PostgreSQL. Live Telegram and YouTube integration checks also require user-provided credentials. Render Free deployment instructions are in `docs/DEPLOYMENT.md`; no live Render service has been created or verified yet.
