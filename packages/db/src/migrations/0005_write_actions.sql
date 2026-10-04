CREATE TABLE "jelly_action" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text NOT NULL,
	"jelly_team_id" text NOT NULL,
	"jelly_mailbox_id" text,
	"action_type" text NOT NULL,
	"target_resource_type" text NOT NULL,
	"target_resource_id" text,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"actor_type" text NOT NULL,
	"actor_key" text NOT NULL,
	"api_key_id" integer,
	"user_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 8 NOT NULL,
	"needs_reconcile" timestamp,
	"scheduled_for" timestamp DEFAULT now() NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"locked_by" text,
	"last_error" jsonb,
	"jelly_response" jsonb,
	"jelly_resource_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	CONSTRAINT "jelly_action_actor_idempotency_key" UNIQUE("actor_key","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "jelly_circuit_state" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"paused_until" timestamp,
	"paused_reason" text,
	"last_failure_at" timestamp,
	"last_success_at" timestamp,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jelly_circuit_state_key" UNIQUE("scope","scope_id")
);
--> statement-breakpoint
CREATE TABLE "jelly_quota_bucket" (
	"id" serial PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" text NOT NULL,
	"window" text NOT NULL,
	"window_start" timestamp NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jelly_quota_bucket_key" UNIQUE("scope","scope_id","window","window_start")
);
--> statement-breakpoint
CREATE TABLE "jelly_request_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_id" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status_code" integer,
	"duration_ms" integer NOT NULL,
	"retry_after_seconds" integer,
	"error" text,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"api_key_id" integer,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "worker_heartbeat" (
	"id" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp DEFAULT now() NOT NULL,
	"last_claimed_count" integer DEFAULT 0 NOT NULL,
	"last_duration_ms" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
ALTER TABLE "mailbox" ADD COLUMN "writes_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "jelly_action" ADD CONSTRAINT "jelly_action_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_action" ADD CONSTRAINT "jelly_action_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_action" ADD CONSTRAINT "jelly_action_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_request_log" ADD CONSTRAINT "jelly_request_log_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_request_log" ADD CONSTRAINT "jelly_request_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_jelly_action_drain" ON "jelly_action" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "idx_jelly_action_mailbox" ON "jelly_action" USING btree ("jelly_mailbox_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_jelly_action_api_key" ON "jelly_action" USING btree ("api_key_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_jelly_action_type_status" ON "jelly_action" USING btree ("action_type","status");--> statement-breakpoint
CREATE INDEX "idx_jelly_action_target" ON "jelly_action" USING btree ("target_resource_type","target_resource_id");--> statement-breakpoint
CREATE INDEX "idx_jelly_quota_bucket_window" ON "jelly_quota_bucket" USING btree ("window","window_start");--> statement-breakpoint
CREATE INDEX "idx_jelly_request_log_created_at" ON "jelly_request_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_jelly_request_log_status" ON "jelly_request_log" USING btree ("status_code","created_at");--> statement-breakpoint
CREATE INDEX "idx_jelly_request_log_path" ON "jelly_request_log" USING btree ("path","created_at");--> statement-breakpoint
CREATE INDEX "idx_jelly_request_log_action" ON "jelly_request_log" USING btree ("action_id");