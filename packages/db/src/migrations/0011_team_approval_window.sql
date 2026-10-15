-- NOTE: `db:push` is the deploy path here. One column with a default, so
-- the push does not prompt and existing teams keep the 24-hour window they
-- were already getting.

ALTER TABLE "jelly_team" ADD COLUMN "approval_ttl_minutes" integer DEFAULT 1440 NOT NULL;