-- NOTE: `db:push` is the deploy path here, so it applies the DDL below and
-- would skip anything else in this file. Every statement is therefore
-- additive and safe to push: each new column is nullable or has a default,
-- and the new constraints hold over NULLs.
--
-- The data step that goes with this — filling `jelly_team_id` on the rows that
-- already exist, and giving the one connected team a slug — deliberately does
-- NOT live here, because a data step in a migration file never runs under
-- `db:push`. It is `ensureTeamSlug()` and `backfillTeamIds()` in
-- `packages/api/src/lib/team.ts`, called from `team.resync` and
-- `mailbox.resync`. Both are idempotent and a no-op once they have taken
-- effect.
--
-- The columns stay nullable afterwards on purpose. Making them `NOT NULL`
-- needs the backfill to have run everywhere first, and a `NOT NULL` column
-- added before that would stop the push and take the deploy with it.

ALTER TABLE "comment" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_conversation" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_conversation_assignment" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_conversation_label" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_label" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_message" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_message_attachment" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_message_contact" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "mailbox_member" ADD COLUMN "jelly_team_id" text;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "daily_ceiling" integer DEFAULT 80000 NOT NULL;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "onboarded_at" timestamp;--> statement-breakpoint
ALTER TABLE "jelly_team" ADD COLUMN "first_webhook_at" timestamp;--> statement-breakpoint
ALTER TABLE "comment" ADD CONSTRAINT "comment_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation" ADD CONSTRAINT "jelly_conversation_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_assignment" ADD CONSTRAINT "jelly_conversation_assignment_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_conversation_label" ADD CONSTRAINT "jelly_conversation_label_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_label" ADD CONSTRAINT "jelly_label_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message" ADD CONSTRAINT "jelly_message_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message_attachment" ADD CONSTRAINT "jelly_message_attachment_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jelly_message_contact" ADD CONSTRAINT "jelly_message_contact_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_member" ADD CONSTRAINT "mailbox_member_jelly_team_id_jelly_team_id_fk" FOREIGN KEY ("jelly_team_id") REFERENCES "public"."jelly_team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_comment_jelly_team_id" ON "comment" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_jelly_team_id" ON "jelly_conversation" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_assignment_jelly_team_id" ON "jelly_conversation_assignment" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_label_jelly_team_id" ON "jelly_conversation_label" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_label_jelly_team_id" ON "jelly_label" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_message_jelly_team_id" ON "jelly_message" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_message_attachment_jelly_team_id" ON "jelly_message_attachment" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_message_contact_jelly_team_id" ON "jelly_message_contact" USING btree ("jelly_team_id");--> statement-breakpoint
CREATE INDEX "idx_mailbox_member_jelly_team_id" ON "mailbox_member" USING btree ("jelly_team_id");--> statement-breakpoint
ALTER TABLE "jelly_label" ADD CONSTRAINT "jelly_label_label_id_jelly_team_id_unique" UNIQUE("label_id","jelly_team_id");--> statement-breakpoint
ALTER TABLE "mailbox_member" ADD CONSTRAINT "mailbox_member_marmalade_user_id_marmalade_mailbox_id_unique" UNIQUE("marmalade_user_id","marmalade_mailbox_id");--> statement-breakpoint
ALTER TABLE "jelly_team" ADD CONSTRAINT "jelly_team_slug_unique" UNIQUE("slug");