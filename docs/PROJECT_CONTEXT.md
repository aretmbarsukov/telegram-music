# Project context

Build a Telegram bot and Mini App for organizing YouTube music playlists. The first release should focus on a dependable mobile library, public playlist import and periodic one-way YouTube-to-app synchronization, local additions, and official YouTube playback. Never download audio or alter source playlists. The app should support Ukrainian, Spanish and English and Telegram theme colors.

## Scope

MVP: Telegram `initData` authentication; private user-owned playlists; create/edit/delete; YouTube link validation and metadata; public playlist import; one-way scheduled/manual sync with status/history and safe local additions; official iframe playback; queue, favorites, search; bot launch/help/sync commands; responsive UI; documentation and meaningful tests.

Version 2: language and sync controls, sync notifications, undo, bulk add, sharing with access controls, richer history and ordering.

Future: Google OAuth for private playlists, collaborative playlists, advanced recommendations. These require policy and privacy review.

## Current implementation

See `docs/HANDOFF.md`. A TypeScript Fastify/Prisma backend, Telegram initData verification, grammY commands, YouTube Data API adapter/import and one-way sync worker are implemented, with the original local UI preserved and bridged to the API. YouTube cache fields are separate from user playlist memberships and related records; expiry clears only cache data, and refresh can restore metadata by video ID. External and database integrations still need live verification. See `docs/ROADMAP.md` for missing production requirements.
