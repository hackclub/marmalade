CREATE TABLE "api_key" (
	"id" serial PRIMARY KEY NOT NULL,
	"key_prefix" text NOT NULL,
	"secret_hash" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_by" text NOT NULL,
	"jelly_team_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"revoked_at" timestamp,
	CONSTRAINT "api_key_key_prefix_unique" UNIQUE("key_prefix")
);
--> statement-breakpoint
CREATE TABLE "api_key_scope" (
	"id" serial PRIMARY KEY NOT NULL,
	"api_key_id" integer NOT NULL,
	"scope_mailbox" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"jelly_team_id" text NOT NULL,
	"action" text NOT NULL,
	"resource" text NOT NULL,
	"resource_id" text NOT NULL,
	"status" text NOT NULL,
	"ip_address" varchar,
	"user_agent" text,
	"changes" jsonb,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"body" text,
	"author_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text,
	"status" text DEFAULT 'open' NOT NULL,
	"messages_count" integer DEFAULT 0 NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"attachments_count" integer DEFAULT 0 NOT NULL,
	"snoozed_until" timestamp,
	"url" text,
	"markdown_url" text,
	"messages_url" text,
	"comments_url" text,
	"draft_reply_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_conversation_assignment" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"jelly_contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_conversation_label" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"label_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_conversation_mailbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"jelly_mailbox_id" text NOT NULL,
	"jelly_team_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_label" (
	"id" serial PRIMARY KEY NOT NULL,
	"label_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_message" (
	"id" text PRIMARY KEY NOT NULL,
	"conversation_id" text NOT NULL,
	"subject" text,
	"content" text,
	"content_html" text,
	"sender_id" text,
	"is_inbound" boolean DEFAULT true NOT NULL,
	"attachments_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_message_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text,
	"byte_size" integer,
	"url" text,
	"inline" boolean DEFAULT false NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_message_contact" (
	"type" text NOT NULL,
	"id" serial PRIMARY KEY NOT NULL,
	"message_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_mailbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_mailbox_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"is_default" boolean NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"jelly_team_id" text NOT NULL,
	"exists_in_jelly" boolean NOT NULL,
	CONSTRAINT "jelly_mailbox_jelly_mailbox_id_jelly_team_id_unique" UNIQUE("jelly_mailbox_id","jelly_team_id")
);
--> statement-breakpoint
CREATE TABLE "jelly_mailbox_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_contact_id" text NOT NULL,
	"jelly_mailbox_id" text NOT NULL,
	"jelly_team_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_mailbox_id" text NOT NULL,
	"jelly_team_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"marmalade_user_id" text NOT NULL,
	"marmalade_mailbox_id" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_team" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_contact" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text,
	"email" text NOT NULL,
	"role" text DEFAULT 'contact' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"jelly_team_id" text NOT NULL,
	"exists_in_jelly" boolean NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "jelly_contact_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_key_scope" ADD CONSTRAINT "api_key_scope_api_key_id_api_key_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_key"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_conversation_id_jelly_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jelly_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_author_id_jelly_contact_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."jelly_contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_assignment" ADD CONSTRAINT "jelly_conversation_assignment_conversation_id_jelly_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jelly_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_assignment" ADD CONSTRAINT "jelly_conversation_assignment_jelly_contact_id_jelly_contact_id_fk" FOREIGN KEY ("jelly_contact_id") REFERENCES "public"."jelly_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_label" ADD CONSTRAINT "jelly_conversation_label_conversation_id_jelly_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jelly_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_label" ADD CONSTRAINT "jelly_conversation_label_label_id_jelly_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."jelly_label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_mailbox" ADD CONSTRAINT "jelly_conversation_mailbox_conversation_id_jelly_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jelly_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_mailbox" ADD CONSTRAINT "jelly_conversation_mailbox_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message" ADD CONSTRAINT "jelly_message_conversation_id_jelly_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."jelly_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message" ADD CONSTRAINT "jelly_message_sender_id_jelly_contact_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."jelly_contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message_attachment" ADD CONSTRAINT "jelly_message_attachment_message_id_jelly_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."jelly_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message_contact" ADD CONSTRAINT "jelly_message_contact_message_id_jelly_message_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."jelly_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message_contact" ADD CONSTRAINT "jelly_message_contact_contact_id_jelly_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."jelly_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_mailbox" ADD CONSTRAINT "jelly_mailbox_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_mailbox_member" ADD CONSTRAINT "jelly_mailbox_member_jelly_contact_id_jelly_contact_id_fk" FOREIGN KEY ("jelly_contact_id") REFERENCES "public"."jelly_contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_mailbox_member" ADD CONSTRAINT "jelly_mailbox_member_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox" ADD CONSTRAINT "mailbox_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_member" ADD CONSTRAINT "mailbox_member_marmalade_user_id_user_id_fk" FOREIGN KEY ("marmalade_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_member" ADD CONSTRAINT "mailbox_member_marmalade_mailbox_id_mailbox_id_fk" FOREIGN KEY ("marmalade_mailbox_id") REFERENCES "public"."mailbox"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_contact" ADD CONSTRAINT "jelly_contact_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");