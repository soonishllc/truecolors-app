ALTER TABLE "batches" ADD COLUMN "las_vegas_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "quiqup_received_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "batches" ADD COLUMN "quiqup_inbound" jsonb;