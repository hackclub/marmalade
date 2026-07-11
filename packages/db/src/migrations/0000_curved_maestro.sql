CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"timestamp" timestamp NOT NULL,
	"user_id" text NOT NULL,
	"team_id" text NOT NULL,
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
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_comment_id" text NOT NULL,
	"conversation_id" integer NOT NULL,
	"jelly_conversation_id" text NOT NULL,
	"inbox_id" integer NOT NULL,
	"body" text NOT NULL,
	"deleted" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp,
	"author" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "comment_jelly_comment_id_unique" UNIQUE("jelly_comment_id")
);
--> statement-breakpoint
CREATE TABLE "conversation" (
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_conversation_id" text NOT NULL,
	"inbox_id" integer NOT NULL,
	"subject" text,
	"status" text DEFAULT 'open' NOT NULL,
	"messages_count" integer DEFAULT 0 NOT NULL,
	"comments_count" integer DEFAULT 0 NOT NULL,
	"attachments_count" integer DEFAULT 0 NOT NULL,
	"snoozed_until" timestamp,
	"mailboxes" jsonb,
	"labels" jsonb,
	"assignees" jsonb,
	"url" text,
	"markdown_url" text,
	"messages_url" text,
	"comments_url" text,
	"draft_reply_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_message_at" timestamp NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_jelly_conversation_id_unique" UNIQUE("jelly_conversation_id")
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_message_id" text NOT NULL,
	"conversation_id" integer NOT NULL,
	"jelly_conversation_id" text,
	"inbox_id" integer NOT NULL,
	"subject" text,
	"content" text,
	"content_html" text,
	"from" jsonb,
	"to" jsonb,
	"cc" jsonb,
	"bcc" jsonb,
	"sender_name" text,
	"sender_email" text,
	"sender" jsonb,
	"is_inbound" boolean DEFAULT true NOT NULL,
	"attachments_count" integer DEFAULT 0 NOT NULL,
	"attachments" jsonb,
	"url" text,
	"status" text NOT NULL,
	"metadata" jsonb NOT NULL,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"received_at" timestamp NOT NULL,
	CONSTRAINT "message_jelly_message_id_unique" UNIQUE("jelly_message_id")
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
	"exists_in_jelly" boolean NOT NULL,
	CONSTRAINT "jelly_mailbox_jelly_mailbox_id_unique" UNIQUE("jelly_mailbox_id")
);
--> statement-breakpoint
CREATE TABLE "jelly_mailbox_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_member_id" text NOT NULL,
	"jelly_mailbox_id" text NOT NULL,
	"jelly_team_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox" (
	"id" serial PRIMARY KEY NOT NULL,
	"jelly_mailbox_id" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "mailbox_jelly_mailbox_id_unique" UNIQUE("jelly_mailbox_id")
);
--> statement-breakpoint
CREATE TABLE "mailbox_member" (
	"id" serial PRIMARY KEY NOT NULL,
	"marmalade_user_id" text NOT NULL,
	"marmalade_mailbox_id" integer NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"jelly_team_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jelly_team_member" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"jelly_team_id" text NOT NULL,
	"exists_in_jelly" boolean NOT NULL,
	CONSTRAINT "jelly_team_member_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");