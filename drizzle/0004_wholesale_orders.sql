CREATE TABLE "wholesale_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref" text NOT NULL,
	"wholesaler_id" uuid NOT NULL,
	"status" text DEFAULT 'quoted' NOT NULL,
	"currency" text NOT NULL,
	"lines" jsonb NOT NULL,
	"units" integer NOT NULL,
	"discount_bps" integer NOT NULL,
	"subtotal" text NOT NULL,
	"payment_method" text,
	"draft_order_id" text,
	"shopify_order_id" text,
	"shopify_order_name" text,
	"pay_url" text,
	"tracking_number" text,
	"documents" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shipping_problem" text,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_orders_ref_unique" UNIQUE("ref")
);
--> statement-breakpoint
ALTER TABLE "wholesale_orders" ADD CONSTRAINT "wholesale_orders_wholesaler_id_wholesalers_id_fk" FOREIGN KEY ("wholesaler_id") REFERENCES "public"."wholesalers"("id") ON DELETE no action ON UPDATE no action;