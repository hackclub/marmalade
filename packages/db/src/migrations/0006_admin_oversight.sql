CREATE TABLE "jelly_webhook_delivery" (
	"id" serial PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"status" text NOT NULL,
	"error" text,
	"duration_ms" integer,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quota_policy" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"window" text NOT NULL,
	"ceiling" integer NOT NULL,
	"note" text,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quota_policy_key" UNIQUE("scope","scope_id","window")
);
--> statement-breakpoint
CREATE TABLE "usage_rollup" (
	"id" serial PRIMARY KEY NOT NULL,
	"bucket_hour" timestamp NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"dimension" text NOT NULL,
	"status" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"p50_ms" integer,
	"p95_ms" integer,
	CONSTRAINT "usage_rollup_key" UNIQUE("bucket_hour","scope","scope_id","dimension","status")
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "require_approval" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_jelly_webhook_delivery_received" ON "jelly_webhook_delivery" USING btree ("received_at");--> statement-breakpoint
CREATE INDEX "idx_jelly_webhook_delivery_event" ON "jelly_webhook_delivery" USING btree ("event","received_at");--> statement-breakpoint
CREATE INDEX "idx_usage_rollup_bucket" ON "usage_rollup" USING btree ("bucket_hour");--> statement-breakpoint
CREATE INDEX "idx_usage_rollup_scope" ON "usage_rollup" USING btree ("scope","scope_id","bucket_hour");