-- NOTE: `db:push` is the deploy path here, so it applies the DDL below and
-- would skip anything else in this file.
--
-- Safe to push: two nullable columns, no default needed and nothing to
-- backfill. Actions already awaiting approval have no deadline and so never
-- expire, which is the right answer for a window that was never offered
-- with one.

ALTER TABLE "jelly_action" ADD COLUMN "approval_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "slack_id" text;
