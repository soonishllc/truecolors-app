CREATE TABLE "restocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"lines" jsonb NOT NULL,
	"units" integer NOT NULL,
	"requested_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"sent_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sales_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"outlet_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lines" jsonb NOT NULL,
	"units" integer NOT NULL,
	"source" text NOT NULL,
	"settlement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmed_at" timestamp with time zone,
	CONSTRAINT "sales_reports_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"reported_units" integer NOT NULL,
	"missing_units" integer NOT NULL,
	"currency" text NOT NULL,
	"unit_price" text,
	"amount" text,
	"status" text DEFAULT 'review' NOT NULL,
	"draft_order_id" text,
	"pay_url" text,
	"problem" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invoiced_at" timestamp with time zone,
	"paid_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"outlet_id" uuid NOT NULL,
	"lines" jsonb NOT NULL,
	"missing_units" integer NOT NULL,
	"counted_by" text NOT NULL,
	"settlement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "par_per_sku" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "settlement_days" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "period_start" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "overdue_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outlets" ADD COLUMN "reminders_sent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "restocks" ADD CONSTRAINT "restocks_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restocks" ADD CONSTRAINT "restocks_requested_by_wholesale_contacts_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."wholesale_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_reports" ADD CONSTRAINT "sales_reports_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_outlet_id_outlets_id_fk" FOREIGN KEY ("outlet_id") REFERENCES "public"."outlets"("id") ON DELETE no action ON UPDATE no action;