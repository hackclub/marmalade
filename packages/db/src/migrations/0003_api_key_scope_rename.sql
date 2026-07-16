-- Migrate api_key_scope: scope_mailbox -> scope_resource_type + scope_resource_id
-- Step 1: Add new columns as nullable first
ALTER TABLE "api_key_scope" ADD COLUMN "scope_resource_type" text;--> statement-breakpoint
ALTER TABLE "api_key_scope" ADD COLUMN "scope_resource_id" text;--> statement-breakpoint
-- Step 2: Copy existing data - all existing scopes are "mailbox" type
UPDATE "api_key_scope" SET "scope_resource_type" = 'mailbox', "scope_resource_id" = "scope_mailbox";--> statement-breakpoint
-- Step 3: Make columns NOT NULL now that data is populated
ALTER TABLE "api_key_scope" ALTER COLUMN "scope_resource_type" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_scope" ALTER COLUMN "scope_resource_id" SET NOT NULL;--> statement-breakpoint
-- Step 4: Drop old column and its NOT NULL constraint
ALTER TABLE "api_key_scope" DROP COLUMN "scope_mailbox";--> statement-breakpoint
-- Step 5: Add new unique constraint
ALTER TABLE "api_key_scope" ADD CONSTRAINT "api_key_scope_api_key_id_scope_resource_type_scope_resource_id_key" UNIQUE("api_key_id","scope_resource_type","scope_resource_id");
