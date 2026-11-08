# Handoff — 2026-11-08

## Render Free deployment

- The user selected Render Free, with no card or paid add-ons. Private GitHub repo: `aretmbarsukov/telegram-music`, branch `main`. Render web service `telegram-music` was created in Frankfurt from commit `ca51017` using `npm ci && npm run db:generate && npm run build`, `npm start`, Free compute, and health path `/health`.
- Public URL: `https://telegram-music-mhem.onrender.com`. Actual HTTP checks on 2026-11-08: `GET /` returned 200 and the Luna HTML; `GET /health` returned 200 with `{"ok":true,"service":"telegram-music"}`; `GET /api/health` returned 200 with dev auth disabled and YouTube mock disabled; unauthenticated `GET /api/playlists` returned 401 as expected. This verifies the live app/API process and auth boundary, not Telegram command handling or YouTube import/playback.
- Render logs showed the server listening and the Telegram webhook registration success message. The startup code configures bot commands and the Mini App menu button before registering the webhook. Bot commands have not yet been exercised from Telegram.
- Render environment fields were populated by the owner. No secret values belong in this document. A prior accessibility inspection accidentally emitted environment credential values and current Mini App `initData` in tool output; the owner was informed and asked to continue without rotation. Do not inspect, repeat, log, or commit any credential values. The currently open Telegram Mini App still pointed to the old temporary Cloudflare URL and showed “Сервер недоступний”; reopen via the bot's updated menu button to obtain a fresh app session and test the Render URL.
- Production Fastify exposes the shallow public `GET /health`; `GET /api/health` remains for local dev-auth detection. When explicit `APP_ORIGIN` and `TELEGRAM_WEBHOOK_URL` are absent, config uses Render's `RENDER_EXTERNAL_URL` for HTTPS app/webhook setup. The generated URL above is the expected base URL. Explicit URL env vars are still recommended in Render after creation.
- Production Fastify starts the periodic sync loop in-process; no separate Render worker is needed. It scans each minute, uses a process-level overlap guard and atomic per-source sync claim, and stops the timer during shutdown. Local `npm run worker` remains supported.
- `docs/DEPLOYMENT.md` covers build/start, environment variables, webhook, health, monitor setup, updates, and Free plan limits. The user will create the optional UptimeRobot/cron-job.org account; no monitor is currently configured.
- Actual local checks on 2026-11-08 after the deployment URL fallback change: `npm run lint`, `npm run typecheck`, `npm test` (32/32), and `npm run build` passed. These tests used PGlite/mocks and are not live Telegram or YouTube verification.
- `.env` was ignored by Git (`git check-ignore -v .env` returned `.gitignore:3:.env .env`) and excluded from commits. Secret scan covered 56 candidate files and committed history without finding Google API-key or Telegram bot-token patterns or an unrecognized PostgreSQL credential URI. Initial commits: `8b48b60`, `89d385a`, `ca51017`; private `main` was pushed to GitHub.
- Render Free sleeps after 15 minutes idle, may take about a minute to cold-start, and has 750 shared instance-hours per workspace/month. A 5-minute ping may reduce sleeping but does not guarantee uptime; a 31-day always-on month uses 744 hours before other workspace services.
- Verified from Render logs: server listening and Telegram webhook registration completed; `configureMenuButton` is awaited before that registration. Still unverified: actual `/start`, `/playlists`, `/sync`, `/settings` interactions; a fresh Render-backed Mini App session; real YouTube playlist import; audible iframe playback inside Telegram; external monitor. Verify these before claiming them as working.

## Neon PostgreSQL provisioning and verification

- Created Neon project `telegram-music` in `aws-eu-central-1` (Europe), PostgreSQL 17, with 0.25 CU default compute. The project is `red-snow-45600364`. The Neon account billing tier was not inspected; review Neon usage/billing in its console if needed.
- Created a separate Neon branch named `integration-tests` (`br-polished-smoke-b9bb8y4v`) for integration tests. The production/default branch was used only for migration deployment and read-only migration status/schema-diff checks; integration fixtures were written only to the separate test branch.
- Retrieved the direct (unpooled) TLS connection string using Neon CLI and saved it as `DATABASE_URL` in the project `.env`. The URL is intentionally not recorded here. `.gitignore` contains `.env`; this workspace has no `.git` directory, so Git's tracked/ignore status could not be verified with Git commands.
- Actual commands: `npm install` succeeded (305 packages audited; npm reported 4 moderate vulnerabilities); `npm run db:generate` succeeded; `npx prisma migrate deploy` applied `0001_init`, `0002_separate_youtube_cache`, and `0003_bot_notifications` successfully to Neon PostgreSQL 17.
- Actual checks: `npx prisma migrate status` reported `Database schema is up to date!`; `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code` reported `No difference detected.`
- The Neon test branch already had all three migrations applied before tests. With `NEON_TEST_DATABASE_URL` set to that branch's direct connection string, `npm test` passed 31/31, including import/sync, cache cleanup preserving playlists/local tracks/favorites/history, playlist CRUD, playback history, and notification settings. YouTube calls were mocked. No test data was written to the default branch.
- Final checks after the integration-test adapter change: `npm run lint`, `npm run typecheck`, `npm test` (31/31 on Neon branch), and `npm run build` all succeeded. Native PostgreSQL migration and integration validation are now completed on PostgreSQL 17, closing the prior general native-PostgreSQL migration risk. PostgreSQL 16 compatibility specifically was not tested.
- The earlier Docker-unavailable notes below describe the state before Neon was provisioned; they are historical and superseded by this verification. No real Telegram or YouTube API credentials were used.

## Telegram bot implementation update

- Replaced the top-level-only polling bot with an import-safe `createMusicBot` factory. Commands: `/start` upserts the shared Telegram user and settings then greets; `/help`, `/app`, `/playlists`, `/sync`, `/add`, and `/settings` now perform their described actions. Playlist rows are inline callback buttons scoped to the requesting Telegram account.
- HTTPS `APP_ORIGIN` is sent as a `web_app` inline button. On bot startup, the code registers command suggestions and the chat menu web app button with Bot API `setMyCommands` and `setChatMenuButton`. HTTP origins use a normal URL button; Telegram Mini App launch requires the documented HTTPS tunnel URL.
- `/settings` offers 15/30/60/120-minute sync intervals and a persisted new-track-notification toggle. Interval choices update the user's `UserSettings` and all their YouTube sources. Migration `0003_bot_notifications` adds `notificationsEnabled` with a `true` default; both PGlite demo and integration setup apply it.
- Successful sync results now include newly added source tracks. The periodic worker, Mini App manual-sync endpoint, and bot `/sync` invoke the notifier. It sends at most one grouped message per playlist, truncates long lists, suppresses messages when that user's preference is off, and catches Telegram send failures without marking sync as failed.
- Polling remains the local `npm run bot` mode (`BOT_MODE=polling`); it clears any previous webhook without dropping pending updates. Production `BOT_MODE=webhook` is handled by Fastify: it registers `POST /telegram/webhook`, sets the webhook URL with Telegram `secret_token`, and checks `X-Telegram-Bot-Api-Secret-Token` with a constant-time comparison before passing updates to grammY. Production config requires a token, HTTPS Mini App and webhook URLs, webhook secret, and webhook mode; dev auth and mocked YouTube remain forbidden in production.
- `BOT_TOKEN` is now the documented name and `TELEGRAM_BOT_TOKEN` remains a supported alias used by Mini App `initData` verification. Bot and API use the same `DATABASE_URL`/Prisma `User` rows.
- Added grammY `handleUpdate` command tests using Bot API transformers and fake database delegates, notification grouping/preference tests, a webhook secret Fastify test, and a PGlite migration/default test. No valid token was used. During an early test run the integration process's deliberately invalid `integration-test-token` reached Telegram's API and returned 404; no valid token/message was involved. The notification sender was changed to make real sends impossible in `NODE_ENV=test` unless a sender is explicitly injected. The final test run passed.
- Local setup documentation is in `docs/TELEGRAM_SETUP.md`, covering BotFather, `.env`, shared PostgreSQL, Cloudflare Quick Tunnel/ngrok, Mini App menu setup, polling, and production webhook env.
- Final actual checks on 2026-11-08: lint, typecheck, build passed; tests passed (31/31). No real bot token was configured, so Telegram menu setup, polling against Telegram, and webhook registration have not been live-verified.
- `npm run dev:demo` does not share its in-memory PGlite instance with the separate polling process; use the persistent local PostgreSQL instructions when verifying that bot and Mini App see the same account data.

## YouTube IFrame player update

- Added official YouTube IFrame Player API playback to the player view. Standard player controls are explicitly enabled; the embed is responsive with a 200px minimum height. Hidden-page and `pagehide` events pause playback.
- Playlist detail now has Play and Shuffle actions. Clicking a track in a playlist starts a queue in that playlist's context; clicking tracks elsewhere starts a one-track queue. Queue helpers support Fisher–Yates shuffle, next/previous, repeat queue/one, and skipping unavailable IDs. Queue behavior has six automated tests.
- IFrame errors 100, 101, and 150 show a status message and automatically advance to the next available queue entry. When no entries remain, the error and terminal state remain visible. Player view links to the original YouTube watch page.
- `PLAYING` state records playback through user-scoped `POST /api/history`; on API startup the frontend loads `GET /api/history` into Recently Played. Existing visibility pause behavior remains and page close now also requests pause.
- Mock YouTube playlist now contains three real public video IDs: `M7lc1UVf-VE` (the video used in Google's IFrame API example), `jNQXAC9IVRw`, and `aqz-KE-bpKQ`. The current embed permissions of all candidates were not live-tested here; IFrame errors are handled by the player. No YouTube API credentials were used.
- Mirrored `app.js`, `index.html`, `styles.css`, and the new `player-queue.js` to `public/`; source and served copies were hash-matched at copy time.
- Actual checks on 2026-11-08: `npm run lint` passed; `npm run typecheck` passed; `npm test` passed (23/23); `npm run build` passed. These checks do not constitute live playback verification. No mobile screenshot or real Telegram/YouTube session was captured.
- Demo server smoke check: `npm run dev:demo` built successfully but its server start returned `EADDRINUSE` on `127.0.0.1:8787`. The already-running process (PID 3688, `node scripts/dev-demo.mjs`) was left untouched. HTTP checks against it returned `/api/health` 200 with dev auth and YouTube mock enabled, served the module/player error UI and player queue module (200). This confirms the existing demo server responds with updated static files; it does not confirm actual iframe playback.
- To run the disposable local demo: `npm run dev:demo`, then open `http://127.0.0.1:8787`. Import `https://www.youtube.com/playlist?list=PLdemo123`, open it, then use Play or Shuffle. Try row Play, next/previous, shuffle, repeat, and the original-video link. Stop the server with Ctrl+C; PGlite demo data resets.

## Current next steps

- In Telegram, close the stale Mini App from the former Cloudflare tunnel, then launch the Mini App again from `@lunaa_musicbot`'s menu button. The open old session showed “Сервер недоступний”. Test `/start`, `/playlists`, `/sync`, and `/settings`; do not expose secrets while diagnosing logs.
- Create the owner's five-minute UptimeRobot HTTP monitor for `https://telegram-music-mhem.onrender.com/health`; this account was not created by the agent and cannot guarantee continuous uptime.
- Verify real public YouTube playlist import and audible IFrame playback in Telegram Mini App. Do not claim these work based only on `/health` or build success.
- Continue account-data deletion/privacy work. Native PostgreSQL migration and integration tests were verified on Neon PostgreSQL 17; exact PostgreSQL 16 compatibility remains unverified.

## Frontend/backend integration update

- The served `public/` frontend now uses the Fastify API on localhost and in Telegram for playlist list/detail, create, rename, delete, YouTube import, single-video preview/add, and manual sync. Search and sorting remain in the UI over the API-provided playlist list. Playlist details show item availability, duration, sync status, and last-success time.
- Telegram requests send the raw Web App `initData` in `Authorization: tma ...`; backend HMAC/freshness validation remains authoritative. Local dev auth now requires `DEV_AUTH_ENABLED=true` and the matching `DEV_AUTH_USER_ID`. The toggle defaults off and the app refuses production startup if development auth or YouTube mock mode is enabled. The frontend reads `/api/health` before sending the local development header.
- API connection/auth errors, loading, empty playlist, and no-search-results states are visible. An API failure no longer flips localhost/Telegram sessions to browser-local prototype storage. Video links and playlist links are distinguished in the import/add dialogs.
- Added `YOUTUBE_MOCK_MODE=true` deterministic server-side fixtures for playlist preview/import/sync and arbitrary valid video links. No key or outbound YouTube request is needed in this mode. Mock IDs are preview/test data; IFrame playback availability for them is not guaranteed.
- Added `npm run dev:demo`: it applies both migrations to an in-memory PGlite database, starts the same Fastify API, enables explicit local auth and YouTube mocks, and resets its database on stop. The persistent setup remains available with a local PostgreSQL and `npx prisma migrate deploy`.
- Copied `app.js`, `index.html`, and `api-states.css` to `public/`; verified SHA-256 hashes of root and served copies matched at the time of copying.
- Actual verification: lint, typecheck, build, and tests pass (16/16). The running `dev:demo` server also passed HTTP smoke requests for health, playlist create, mock YouTube import, and playlist details (4 imported tracks; first title `Moonlight Walk`; source status `SUCCESS`).
- Requested visual review could not run: the browser local-origin permission gate declined navigation to `http://127.0.0.1:8787`. No screenshot was captured and no alternate browser path was attempted.
- At the time of this frontend integration checkpoint, no real Telegram token or YouTube API key was configured. The later Render deployment is recorded at the top of this file. Favorites REST persistence remains outstanding; playback history GET/POST is implemented and integration-tested.

## Integration test update

- Added `src/integration.test.ts`, which boots an ephemeral PGlite PostgreSQL-in-WASM instance, applies migrations `0001` and `0002`, and connects the application through PGlite's PostgreSQL wire-protocol socket. Tests mock `fetch` and reject unexpected external requests.
- The integration scenario verifies public playlist import, duplicate-video deduplication, sync additions/removals/reordering, preservation of a locally added item and custom title, and cross-user playlist isolation using signed Telegram `initData` for the second user.
- `src/server.ts` now exports `createApp()` so Fastify injection tests can exercise routes without listening as the production entry point. Production startup remains enabled when the built server file is run directly.
- Added ESLint for the existing browser `app.js`; TypeScript source is checked by `typecheck`/build because the available TypeScript ESLint parser does not support the repository's TypeScript 7 compiler.
- Added cache-maintenance integration coverage: the test creates a user, playlist, local track, favorite, playback-history row, and 31-day-old YouTube metadata; it invokes the worker's real `maintainYouTubeMetadata` function with mocked failed YouTube fetches. It verifies metadata becomes `EXPIRED` and fields are cleared while the playlist, item, track, favorite, history, and local title remain.
- `prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code` ran using a pair of temporary PGlite servers for the configured datasource and shadow datasource. Actual output: `Loaded Prisma config from prisma.config.ts.`, `No difference detected.`, exit code `0`.
- Historical Docker availability check: `docker version` failed because PowerShell reported `docker` is not recognized as a command, so no `postgres:16` container was started at that time. This was superseded by the Neon PostgreSQL 17 verification at the top of this file; only PostgreSQL 16-specific compatibility remains unverified.
- No existing or production database was contacted or reset. No real YouTube request was made.
- Actual checks on 2026-11-08: `npm run lint`, `npm run typecheck`, `npm run build` passed; `npm test` passed (13/13, including PGlite route and cache-cleanup scenarios).

## Current status

Implemented a safe split between YouTube API cache and user-owned tracks/memberships. The user explicitly prohibited deleting compositions or related user data. Cache expiry now clears only metadata columns; it never deletes `Track`, `PlaylistItem`, `Favorite`, or `PlaybackHistory` records. A successful sync or video preview rehydrates cache by stable YouTube video ID.

## Design changes

- `Track` contains stable `youtubeVideoId` identity only; favorites and playback history refer to this stable row.
- `PlaylistItem.customTitle` stores the user's local title separately from YouTube metadata.
- `YouTubeMetadata` stores video title, channel, thumbnail, duration and freshness state. It has no foreign key to `Track`, so cache cleanup cannot cascade.
- `YouTubeSource` stores remote title/artwork and metadata status separately from the optional user playlist title/artwork.
- Migration `prisma/migrations/0002_separate_youtube_cache/migration.sql` creates the independent cache table, copies current API metadata into it, preserves legacy local item labels as user custom titles, and drops cached columns from `Track`. Existing playlist title labels are retained.
- Worker checks cache before 25 days; failed refresh marks it `STALE` and retries after six hours. At/after 30 days, only cached title/channel/thumbnail/duration are cleared and the row is marked `EXPIRED`. Unavailable videos clear cache fields and become `UNAVAILABLE` while user relations remain.
- Manual preview/sync can restore expired metadata by ID. The playlist page displays stale/expired cache state.

## Checks completed this turn

- Static review of migration `0002_separate_youtube_cache`: it creates an independent metadata cache, backfills it from legacy Track metadata before dropping those old metadata columns, preserves legacy local item titles in `PlaylistItem.customTitle`, and makes playlist titles nullable without clearing existing values. It contains no deletion of Track, PlaylistItem, Favorite, or PlaybackHistory rows and adds no cache-to-user-data foreign key/cascade.
- `npx prisma validate` passed using a placeholder `DATABASE_URL`; this validates the schema, not connectivity.
- Unit tests cover stale-vs-expired cache decisions and assert the expiry update contains only cache fields, without track/favorite references.
- Historical note (superseded by the Neon verification above): migrations `0001` and `0002` had been applied in ephemeral PGlite, while Docker was unavailable. Neon PostgreSQL 17 now has all three migrations deployed and the integration suite has run against an isolated Neon branch. No existing user database was reset.

## Remaining blockers

- **Resolved:** native PostgreSQL migration deployment, migration status/schema diff, and the integration suite have been verified on Neon PostgreSQL 17. PostgreSQL 16-specific compatibility is not verified. Never reset production or cascade-delete user data.
- The live Render URL and owner-entered production credentials are now configured, but Telegram commands, real YouTube import, and audible playback remain unverified. The public HTTPS URL is `https://telegram-music-mhem.onrender.com`.
- Metadata rehydration by video ID remains untested against a database/API integration fixture.
- Account data deletion route, privacy policy, external monitoring, and direct verification of production Telegram/YouTube integrations remain outstanding.
- Favorites REST persistence remains incomplete. Playback-history GET/POST API and user scoping are implemented and covered by integration tests; frontend uses these endpoints for Recently Played.

## Continue

Read `AGENTS.md`, `README.md`, this file and `docs/NEXT_AGENT_PROMPT.md`. Neon PostgreSQL 17 migration and integration verification is complete on 2026-11-08; do not rerun destructive setup or use the default Neon branch for fixture tests. If PostgreSQL 16 compatibility is required, use a new disposable isolated instance. Continue account-data deletion/privacy work, favorites API persistence, and metadata restoration coverage by stable video ID. Never add cache cleanup that deletes user relations.
