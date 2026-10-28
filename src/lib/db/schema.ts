import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // Public handle, also the code on the designer's share link (?ref=handle).
  handle: text("handle").notNull().unique(),
  credits: integer("credits").notNull().default(0),
  agreementVersion: text("agreement_version"),
  agreementAcceptedAt: ts("agreement_accepted_at"),
  createdAt: createdAt(),
});

export const invites = pgTable("invites", {
  code: text("code").primaryKey(),
  note: text("note"),
  usedBy: uuid("used_by").references(() => users.id),
  usedAt: ts("used_at"),
  createdAt: createdAt(),
});

export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const designs = pgTable("designs", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  preset: text("preset").notNull(),
  prompt: text("prompt").notNull(),
  lineArtKey: text("line_art_key"),
  colourKey: text("colour_key"),
  compositeKey: text("composite_key"),
  printLineKey: text("print_line_key"),
  printColourKey: text("print_colour_key"),
  printReport: jsonb("print_report").$type<PrintReport>(),
  flags: jsonb("flags").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export type PrintReport = {
  ok: boolean;
  colours: number;
  maxColours: number;
  widthPx: number;
  heightPx: number;
  problems: string[];
};

export const generations = pgTable("generations", {
  id: id(),
  designId: uuid("design_id").notNull().references(() => designs.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  kind: text("kind").$type<"line_art" | "colour" | "refine">().notNull(),
  prompt: text("prompt").notNull(),
  provider: text("provider").notNull(),
  credits: integer("credits").notNull(),
  outputKey: text("output_key").notNull(),
  createdAt: createdAt(),
});

export const media = pgTable("media", {
  id: id(),
  designId: uuid("design_id").notNull().references(() => designs.id),
  kind: text("kind").$type<"mockup" | "video">().notNull(),
  template: text("template").notNull(),
  view: text("view").$type<"shade" | "sun" | "reveal">().notNull(),
  key: text("key").notNull(),
  createdAt: createdAt(),
});

export type CampaignStatus =
  | "in_review"
  | "rejected"
  | "live"
  | "closing"
  | "funded"
  | "missed"
  | "in_production"
  | "shipped";

export const campaigns = pgTable("campaigns", {
  id: id(),
  slug: text("slug").notNull().unique(),
  designCode: text("design_code").notNull().unique(),
  designId: uuid("design_id").notNull().references(() => designs.id),
  userId: uuid("user_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  story: text("story").notNull().default(""),
  market: text("market").notNull(),
  status: text("status").$type<CampaignStatus>().notNull(),
  goal: integer("goal").notNull(),
  stretchGoals: jsonb("stretch_goals").$type<number[]>().notNull(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull(),
  startsAt: ts("starts_at"),
  endsAt: ts("ends_at"),
  shopifyProductId: text("shopify_product_id"),
  shopifyHandle: text("shopify_handle"),
  sellingPlanGroupId: text("selling_plan_group_id"),
  variantIds: jsonb("variant_ids").$type<Record<string, string>>(),
  reviewNote: text("review_note"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: ts("reviewed_at"),
  fundedAt: ts("funded_at"),
  closedAt: ts("closed_at"),
  relaunchOf: uuid("relaunch_of"),
  batchId: uuid("batch_id"),
  createdAt: createdAt(),
});

export type PledgeStatus = "pledged" | "charged" | "charge_failed" | "cancelled" | "refunded";

// One pre-order line on a Shopify order.
export const pledges = pgTable(
  "pledges",
  {
    id: id(),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    shopifyOrderId: text("shopify_order_id").notNull(),
    orderName: text("order_name").notNull(),
    lineItemId: text("line_item_id").notNull(),
    size: text("size").notNull(),
    quantity: integer("quantity").notNull(),
    netCents: integer("net_cents").notNull(),
    taxCents: integer("tax_cents").notNull().default(0),
    viaDesignerLink: boolean("via_designer_link").notNull().default(false),
    // The order also holds other products, so it can't be charged in full or cancelled as a whole.
    sharedOrder: boolean("shared_order").notNull().default(false),
    status: text("status").$type<PledgeStatus>().notNull().default("pledged"),
    chargeAttempts: integer("charge_attempts").notNull().default(0),
    firstChargeAt: ts("first_charge_at"),
    nextChargeAt: ts("next_charge_at"),
    lastChargeError: text("last_charge_error"),
    chargedAt: ts("charged_at"),
    fulfilledAt: ts("fulfilled_at"),
    needsAttention: text("needs_attention"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("pledges_line_unique").on(t.shopifyOrderId, t.lineItemId)],
);

export const royaltyEntries = pgTable(
  "royalty_entries",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    campaignId: uuid("campaign_id").notNull().references(() => campaigns.id),
    pledgeId: uuid("pledge_id").notNull().references(() => pledges.id),
    kind: text("kind").$type<"earning" | "clawback">().notNull(),
    // Makes webhook retries safe: "earning" or "refund:<refund id>".
    sourceRef: text("source_ref").notNull(),
    rateBps: integer("rate_bps").notNull(),
    baseCents: integer("base_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    payableAfter: ts("payable_after"),
    payoutId: uuid("payout_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("royalty_source_unique").on(t.pledgeId, t.sourceRef)],
);

export const payouts = pgTable("payouts", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => users.id),
  totalCents: integer("total_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").$type<"pending" | "paid">().notNull().default("pending"),
  reference: text("reference"),
  paidAt: ts("paid_at"),
  createdAt: createdAt(),
});

export const batches = pgTable("batches", {
  id: id(),
  status: text("status").$type<"draft" | "sent" | "received">().notNull().default("draft"),
  note: text("note"),
  createdAt: createdAt(),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  topic: text("topic").notNull(),
  receivedAt: createdAt(),
});
