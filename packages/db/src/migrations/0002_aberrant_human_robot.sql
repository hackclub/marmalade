CREATE INDEX "idx_comment_conversation_id" ON "comment" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_comment_created_at" ON "comment" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_status" ON "jelly_conversation" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_conversation_created_at" ON "jelly_conversation" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_last_message_at" ON "jelly_conversation" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_updated_at" ON "jelly_conversation" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "idx_conversation_subject_gin" ON "jelly_conversation" USING gin ("subject" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_conversation_mailbox_jelly_mailbox_id" ON "jelly_conversation_mailbox" USING btree ("jelly_mailbox_id");--> statement-breakpoint
CREATE INDEX "idx_conversation_mailbox_conversation_id" ON "jelly_conversation_mailbox" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_message_conversation_id" ON "jelly_message" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_message_sent_at" ON "jelly_message" USING btree ("sent_at");--> statement-breakpoint
CREATE INDEX "idx_message_created_at" ON "jelly_message" USING btree ("created_at");