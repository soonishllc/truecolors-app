CREATE TABLE "design_briefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"wholesaler_id" uuid NOT NULL,
	"requested_by" uuid,
	"brief" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"designer_id" uuid,
	"design_id" uuid,
	"feedback" text,
	"design_code" text,
	"shopify_product_id" text,
	"exclusive_until" timestamp with time zone,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "design_briefs_ref_unique" UNIQUE("ref"),
	CONSTRAINT "design_briefs_design_code_unique" UNIQUE("design_code")
);
--> statement-breakpoint
CREATE TABLE "displays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"serial" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"installed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "displays_serial_unique" UNIQUE("serial")
);
--> statement-breakpoint
CREATE TABLE "service_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"display_id" uuid,
	"reported_by" uuid,
	"problem" text NOT NULL,
	"photos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gorgias_ticket_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "service_tickets_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "royalty_entries" ALTER COLUMN "campaign_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "royalty_entries" ALTER COLUMN "pledge_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "royalty_entries" ADD COLUMN "design_id" uuid;--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_wholesaler_id_wholesalers_id_fk" FOREIGN KEY ("wholesaler_id") REFERENCES "public"."wholesalers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_requested_by_wholesale_contacts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."wholesale_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_designer_id_users_id_fk" FOREIGN KEY ("designer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_briefs" ADD CONSTRAINT "design_briefs_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "displays" ADD CONSTRAINT "displays_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_display_id_displays_id_fk" FOREIGN KEY ("display_id") REFERENCES "public"."displays"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_tickets" ADD CONSTRAINT "service_tickets_reported_by_wholesale_contacts_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."wholesale_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "royalty_entries" ADD CONSTRAINT "royalty_entries_design_id_designs_id_fk" FOREIGN KEY ("design_id") REFERENCES "public"."designs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "royalty_wholesale_source_unique" ON "royalty_entries" USING btree ("source_ref") WHERE "royalty_entries"."pledge_id" is null;