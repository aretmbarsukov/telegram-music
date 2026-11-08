# Roadmap

| Feature | Status |
|---|---|
| Mobile-first library prototype and official YouTube iframe | Implemented; visual QA still needed |
| TypeScript Fastify API and local static UI hosting | Implemented; health/static HTTP smoke check passed |
| Prisma 7/PostgreSQL schema and SQL migrations | Migrations applied in ephemeral PGlite PostgreSQL-in-WASM integration tests; separate PostgreSQL server validation still pending |
| Telegram `initData` HMAC, freshness and identity validation | Implemented and unit tested; real bot token not configured |
| User-scoped playlist CRUD and local track add API | Implemented; database integration not run |
| Server-side official YouTube Data API preview/import | Implemented; requires API key and PostgreSQL for live check |
| One-way periodic/manual sync, retry, status/history | Implemented; requires live API and database verification |
| API request budget and endpoint rate limits | Implemented; daily budget counter uses PostgreSQL |
| grammY command handlers, scoped inline playlists, settings and shared database | Implemented and tested with mocked grammY updates; live Telegram verification still requires a bot token |
| New-track notifications and user preference | Implemented; grouped per playlist, persisted toggle, PGlite and notifier tests; live send unverified |
| Local long polling and production webhook | Implemented; webhook secret route covered with Fastify test; Telegram registration/polling need credentials |
| Frontend/API bridge | Playlist CRUD, import/add/sync use backend on localhost and Telegram; explicit dev identity and mocked YouTube env flags; API errors do not fall back to local prototype data; visual browser QA still pending |
| Playback history persisted server-side | Implemented with user-scoped GET/POST routes and Recently Played integration tests; favorites REST persistence is still outstanding |
| Safe YouTube cache freshness and expiry | Implemented; unit tested; database migration not applied here |
| PostgreSQL integration/isolation tests | PGlite integration covers import, sync reconciliation, duplicate tracks, local item preservation, owner isolation, and expired-cache user-row retention; native PostgreSQL 16 container validation pending because Docker is unavailable |
| Deployment, HTTPS, privacy policy and account deletion flow | Not started |

## Next sequence

1. Run PostgreSQL in a Docker-equipped environment, apply migration, verify API CRUD and owner isolation.
2. Add tests around sync reconciliation with fixtures: additions, removals, order changes, duplicates, local additions, unavailable/private playlists, retries and concurrency.
3. Add a user data deletion route; keep it separate from YouTube cache cleanup.
4. Configure credentials to verify public playlist import and YouTube player in Telegram; verify bot commands.
5. Review responsive UI and keyboard/player controls, then prepare HTTPS deployment configuration without publishing it.
