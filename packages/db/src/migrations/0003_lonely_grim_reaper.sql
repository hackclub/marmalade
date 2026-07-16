CREATE TABLE "api_key_field_scope" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"scope_resource_type" text NOT NULL,
	"scope_field" text NOT NULL,
	CONSTRAINT "api_key_field_scope_api_key_id_scope_resource_type_scope_field_unique" UNIQUE("api_key_id","scope_resource_type","scope_field")
);
--> statement-breakpoint
ALTER TABLE "api_key_scope" RENAME COLUMN "scope_mailbox" TO "scope_resource_type";--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_user_id_user_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" DROP CONSTRAINT "audit_log_jelly_team_id_jelly_team_id_fk";
--> statement-breakpoint
DROP INDEX "idx_conversation_subject_gin";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_scope" ADD COLUMN "scope_resource_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "api_key_id" integer;--> statement-breakpoint
ALTER TABLE "api_key_field_scope" ADD CONSTRAINT "api_key_field_scope_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_scope" ADD CONSTRAINT "api_key_scope_api_key_id_scope_resource_type_scope_resource_id_unique" UNIQUE("api_key_id","scope_resource_type","scope_resource_id");