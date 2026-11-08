# PostgreSQL data model

The concrete Prisma schema is `prisma/schema.prisma`. The initial structure is created by `0001_init`; `0002_separate_youtube_cache` migrates existing data without removing user records.

- `User`: unique Telegram account ID, profile fields, settings, playlists and owned YouTube sources.
- `Playlist`: owner, optional user-selected title/artwork and timestamps. Imported YouTube title/artwork lives in its source cache.
- `Track`: stable YouTube video ID identity referenced by user records. Cache expiry never deletes this row.
- `PlaylistItem`: user-owned playlist membership, source item ID, position, origin (`YOUTUBE_SYNC` or `LOCAL`), and optional user custom title. Cache maintenance never modifies it. Sync changes only synced memberships when the source playlist changes; local rows remain.
- `YouTubeMetadata`: API cache keyed by video ID, deliberately without a foreign key to `Track`. Title/channel/thumbnail/duration and freshness state can be cleared independently. Track identity, memberships, favorites and playback history remain available for recovery.
- `YouTubeSource`: one source per local playlist; `(ownerUserId, youtubeId)` is unique so different users can import the same public playlist independently. Cached source title/artwork and cache freshness are separate from a user's optional playlist title/artwork.
- `SyncHistory`: attempt status, timestamps, addition/removal/reorder counts, and safe error code.
- `UserSettings`: language, theme and configurable 30-minute default interval.
- `Favorite`, `PlaybackHistory`: user-scoped joins to tracks.
- `YouTubeQuotaDay`: atomic daily unit reservation for all outbound Data API calls, keyed by UTC date.

The metadata worker refreshes cache data before day 30. A failed refresh marks cache status `STALE`; after 30 days it clears only cached metadata columns and records `EXPIRED`. Unavailable videos clear cached fields and become `UNAVAILABLE`. No cache maintenance query deletes `Track`, `PlaylistItem`, `Favorite`, or `PlaybackHistory` rows. A successful playlist sync or video preview upserts cache metadata by stable video ID, restoring display data without rebuilding or losing user links.

Ownership is checked in API query predicates, not trusted from client-supplied owner IDs. Playlist/source deletion may cascade within that user's library, but the independent global cache has no path to cascade into user records. A complete self-service account/data deletion endpoint is still required before production.
