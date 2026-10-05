ALTER TABLE "jelly_team" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "api_base_url" text DEFAULT 'https://app.letsjelly.com' NOT NULL;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "api_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "webhook_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "credentials_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;