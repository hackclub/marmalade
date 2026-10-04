ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
-- Seed the single instance admin. Everyone else keeps the `user` default, so
-- promotion is a deliberate act rather than something inherited from a Jelly
-- team role.
--
-- Matched on email rather than a hardcoded id so this reads as a statement
-- about a person. If the address is wrong the statement is a no-op and
-- nobody is an admin, which is the safe way to be wrong — recover with
-- BETTER_AUTH_ADMIN_USER_IDS.
UPDATE "user" SET "role" = 'admin' WHERE "email" = 'hc@matmanna.dev';
