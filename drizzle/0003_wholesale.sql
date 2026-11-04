CREATE TABLE "bot_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gorgias_ticket_id" text NOT NULL,
	"phone" text NOT NULL,
	"contact_id" uuid,
	"status" text DEFAULT 'bot' NOT NULL,
	"handover_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_conversations_gorgias_ticket_id_unique" UNIQUE("gorgias_ticket_id")
);
--> statement-breakpoint
CREATE TABLE "bot_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"gorgias_message_id" text NOT NULL,
	"role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bot_messages_gorgias_message_id_unique" UNIQUE("gorgias_message_id")
);
--> statement-breakpoint
CREATE TABLE "outlets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wholesaler_id" uuid NOT NULL,
	"name" text NOT NULL,
	"city" text NOT NULL,
	"country" text NOT NULL,
	"shopify_location_id" text,
	"supply_route" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wholesaler_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"role" text DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wholesale_contacts_phone_unique" UNIQUE("phone"),
	CONSTRAINT "wholesale_contacts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wholesalers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'lead' NOT NULL,
	"stockist" boolean DEFAULT false NOT NULL,
	"display_partner" boolean DEFAULT false NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"shopify_customer_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_conversations" ADD CONSTRAINT "bot_conversations_contact_id_wholesale_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."wholesale_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bot_messages" ADD CONSTRAINT "bot_messages_conversation_id_bot_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."bot_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outlets" ADD CONSTRAINT "outlets_wholesaler_id_wholesalers_id_fk" FOREIGN KEY ("wholesaler_id") REFERENCES "public"."wholesalers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_contacts" ADD CONSTRAINT "wholesale_contacts_wholesaler_id_wholesalers_id_fk" FOREIGN KEY ("wholesaler_id") REFERENCES "public"."wholesalers"("id") ON DELETE no action ON UPDATE no action;