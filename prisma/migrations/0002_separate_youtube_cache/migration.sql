-- Keep API metadata separate from user-owned Track and PlaylistItem records.
-- The cache table intentionally has no foreign key, so cache cleanup cannot cascade.
CREATE TYPE "YouTubeCacheStatus" AS ENUM ('FRESH', 'STALE', 'EXPIRED', 'UNAVAILABLE');

CREATE TABLE "YouTubeMetadata" (
    "videoId" VARCHAR(20) NOT NULL,
    "title" TEXT,
    "channelTitle" TEXT,
    "thumbnailUrl" TEXT,
    "duration" TEXT,
    "status" "YouTubeCacheStatus" NOT NULL DEFAULT 'FRESH',
    "refreshedAt" TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    "retryAt" TIMESTAMP(3),
    "lastErrorCode" TEXT,
    CONSTRAINT "YouTubeMetadata_pkey" PRIMARY KEY ("videoId")
);

CREATE INDEX "YouTubeMetadata_status_refreshedAt_retryAt_idx"
ON "YouTubeMetadata"("status", "refreshedAt", "retryAt");

INSERT INTO "YouTubeMetadata" ("videoId", "title", "channelTitle", "thumbnailUrl", "status", "refreshedAt", "lastAttemptAt")
SELECT "youtubeVideoId", "title", "channelTitle", "thumbnailUrl",
       CASE WHEN "availability" = 'AVAILABLE' THEN 'FRESH'::"YouTubeCacheStatus" ELSE 'UNAVAILABLE'::"YouTubeCacheStatus" END,
       "metadataAt", "metadataAt"
FROM "Track";

ALTER TABLE "PlaylistItem" ADD COLUMN "customTitle" VARCHAR(300);
-- Preserve legacy local-item labels on their user-owned membership rows.
UPDATE "PlaylistItem" AS item
SET "customTitle" = track."title"
FROM "Track" AS track
WHERE item."trackId" = track."id" AND item."origin" = 'LOCAL';

ALTER TABLE "Playlist" ALTER COLUMN "title" DROP NOT NULL;
ALTER TABLE "YouTubeSource"
  ADD COLUMN "cachedTitle" VARCHAR(300),
  ADD COLUMN "cachedThumbnailUrl" TEXT,
  ADD COLUMN "metadataStatus" "YouTubeCacheStatus" NOT NULL DEFAULT 'EXPIRED',
  ADD COLUMN "metadataAt" TIMESTAMP(3),
  ADD COLUMN "metadataRetryAt" TIMESTAMP(3);

-- Existing playlist titles are retained as user labels. Fresh remote title/artwork arrive on next sync.
ALTER TABLE "Track"
  DROP COLUMN "title",
  DROP COLUMN "channelTitle",
  DROP COLUMN "thumbnailUrl",
  DROP COLUMN "availability",
  DROP COLUMN "metadataAt";
