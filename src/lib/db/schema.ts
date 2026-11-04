import { sql } from "drizzle-orm";
import {
  boolean,
  primaryKey,
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

// Social accounts a designer signs in with. Connecting them also tells the studio where they share.
export const identities = pgTable(
  "identities",
  {
    id: id(),
    userId: uuid("user_id").notNull().references(() => users.id),
    provider: text("provider").$type<"google" | "apple" | "x" | "instagram" | "tiktok">().notNull(),
    // The provider's stable id for the account.
    subject: text("subject").notNull(),
    username: text("username"),
    // Followers when they last signed in or connected; not every provider shares it.
    followers: integer("followers"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("identities_subject_unique").on(t.provider, t.subject),
    uniqueIndex("identities_user_provider_unique").on(t.userId, t.provider),
  ],
);

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
  // "sweep": the card animation, the flat lay fading from shade to sun (made by renderMedia); "worn": someone
  // wearing it walking into the sun, made outside the app and attached with scripts/add-sweep.ts --worn.
  kind: text("kind").$type<"mockup" | "video" | "sweep" | "worn">().notNull(),
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
  // Every shirt is numbered when a funded campaign closes: "#37 of 142". No restocks.
  editionSize: integer("edition_size"),
  // When each update email went to backers, e.g. { halfway: "2026-11-02T…" }, so each goes once.
  milestones: jsonb("milestones").$type<Record<string, string>>().notNull().default({}),
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
    // The fan whose link brought this pre-order, for referral rewards.
    fanRef: uuid("fan_ref"),
    // From the Shopify order: who to send campaign updates to, and the city shown in the live feed.
    email: text("email"),
    city: text("city"),
    // This line's shirts are numbered editionStart … editionStart + quantity - 1.
    editionStart: integer("edition_start"),
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

// Fans don't have accounts: an email they've confirmed once, kept in a cookie. They vote in challenges,
// join waitlists and get their own referral link.
export const fans = pgTable("fans", {
  id: id(),
  email: text("email").notNull().unique(),
  referralCode: text("referral_code").notNull().unique(),
  verifiedAt: ts("verified_at"),
  createdAt: createdAt(),
});

// "Tell me when it launches" for a designer, and "bring it back" for a campaign that missed its goal.
// target is "designer:<user id>" or "campaign:<first campaign id>".
export const waitlist = pgTable(
  "waitlist",
  {
    id: id(),
    email: text("email").notNull(),
    target: text("target").notNull(),
    notifiedAt: ts("notified_at"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("waitlist_unique").on(t.email, t.target)],
);

// Every email the app sends. The key stops the same update going twice.
export const emails = pgTable("emails", {
  id: id(),
  key: text("key").unique(),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  provider: text("provider").notNull(),
  error: text("error"),
  createdAt: createdAt(),
});

// A free tee for every few pre-orders a fan's link brings in, issued as a single-use Shopify discount code.
export const fanRewards = pgTable("fan_rewards", {
  id: id(),
  fanId: uuid("fan_id").notNull().references(() => fans.id),
  code: text("code").notNull(),
  createdAt: createdAt(),
});

export const challenges = pgTable("challenges", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  brief: text("brief").notNull(),
  prize: text("prize").notNull(),
  submitBy: ts("submit_by").notNull(),
  voteBy: ts("vote_by").notNull(),
  createdAt: createdAt(),
});

export const challengeEntries = pgTable(
  "challenge_entries",
  {
    id: id(),
    challengeId: uuid("challenge_id").notNull().references(() => challenges.id),
    designId: uuid("design_id").notNull().references(() => designs.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("challenge_entry_unique").on(t.challengeId, t.designId)],
);

export const votes = pgTable(
  "votes",
  {
    entryId: uuid("entry_id").notNull().references(() => challengeEntries.id),
    fanId: uuid("fan_id").notNull().references(() => fans.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.fanId] })],
);

export type PayoutMethodKind = "paypal" | "bank" | "usdc";

// Where a designer's earnings go. The details are encrypted; summary is the masked version shown on screen.
export const payoutMethods = pgTable("payout_methods", {
  userId: uuid("user_id").primaryKey().references(() => users.id),
  kind: text("kind").$type<PayoutMethodKind>().notNull(),
  details: text("details").notNull(),
  summary: text("summary").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---- Wholesale ---------------------------------------------------------------------------------------

// A wholesale business. Stockists buy outright; display partners hold consignment stock at their outlets.
// One business can be both. Leads are businesses that have messaged but aren't set up yet.
export const wholesalers = pgTable("wholesalers", {
  id: id(),
  name: text("name").notNull(),
  status: text("status").$type<"lead" | "active" | "closed">().notNull().default("lead"),
  stockist: boolean("stockist").notNull().default(false),
  displayPartner: boolean("display_partner").notNull().default(false),
  currency: text("currency").$type<"AED" | "USD" | "MXN">().notNull().default("USD"),
  // The Shopify customer their orders are placed under.
  shopifyCustomerId: text("shopify_customer_id"),
  // What a lead told the bot about themselves: city, venue, interest.
  notes: text("notes"),
  createdAt: createdAt(),
});

// A person at a wholesaler. Their WhatsApp number identifies them to the bot; their email signs them in
// to the portal through their Shopify customer account.
export const wholesaleContacts = pgTable("wholesale_contacts", {
  id: id(),
  wholesalerId: uuid("wholesaler_id").notNull().references(() => wholesalers.id),
  name: text("name").notNull(),
  // Digits only, with the country code: 971501234567.
  phone: text("phone").unique(),
  email: text("email").unique(),
  role: text("role").$type<"owner" | "staff">().notNull().default("staff"),
  createdAt: createdAt(),
});

// A display partner's outlet. Its stock is inventory at its own Shopify location.
export const outlets = pgTable("outlets", {
  id: id(),
  wholesalerId: uuid("wholesaler_id").notNull().references(() => wholesalers.id),
  name: text("name").notNull(),
  city: text("city").notNull(),
  country: text("country").notNull(),
  shopifyLocationId: text("shopify_location_id"),
  // Where restocks come from: Quiqup (UAE, GCC), Shipdudes (US, Canada, islands) or Cancún by FedEx.
  supplyRoute: text("supply_route").$type<"quiqup" | "shipdudes" | "cancun">().notNull(),
  createdAt: createdAt(),
});

// One WhatsApp conversation, as a Gorgias ticket. The bot answers until it hands over or a person replies.
export const botConversations = pgTable("bot_conversations", {
  id: id(),
  gorgiasTicketId: text("gorgias_ticket_id").notNull().unique(),
  phone: text("phone").notNull(),
  contactId: uuid("contact_id").references(() => wholesaleContacts.id),
  status: text("status").$type<"bot" | "human">().notNull().default("bot"),
  handoverReason: text("handover_reason"),
  createdAt: createdAt(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// Every message the bot has seen or sent, by Gorgias message id, so a repeated webhook is answered once.
export const botMessages = pgTable("bot_messages", {
  id: id(),
  conversationId: uuid("conversation_id").notNull().references(() => botConversations.id),
  gorgiasMessageId: text("gorgias_message_id").notNull().unique(),
  role: text("role").$type<"customer" | "bot" | "agent">().notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export type WholesaleLine = {
  variantId: string;
  sku: string;
  title: string;
  size: string;
  quantity: number;
  // Per shirt, in the order's currency, as decimal strings.
  retail: string;
  unit: string;
};

// A stockist order, from quote to shipment. The quote fixes the lines and prices on our side, so the bot and
// portal can only place what was quoted. Shopify holds the draft order, the order and the payment.
export const wholesaleOrders = pgTable("wholesale_orders", {
  id: id(),
  // Short code the stockist sees on the quote: Q-7F3K2.
  ref: text("ref").notNull().unique(),
  wholesalerId: uuid("wholesaler_id").notNull().references(() => wholesalers.id),
  status: text("status")
    .$type<"quoted" | "awaiting_payment" | "paid" | "shipped" | "cancelled">()
    .notNull()
    .default("quoted"),
  currency: text("currency").$type<"AED" | "USD" | "MXN">().notNull(),
  lines: jsonb("lines").$type<WholesaleLine[]>().notNull(),
  units: integer("units").notNull(),
  discountBps: integer("discount_bps").notNull(),
  subtotal: text("subtotal").notNull(),
  paymentMethod: text("payment_method").$type<"card" | "bank_transfer">(),
  draftOrderId: text("draft_order_id"),
  shopifyOrderId: text("shopify_order_id"),
  shopifyOrderName: text("shopify_order_name"),
  payUrl: text("pay_url"),
  trackingNumber: text("tracking_number"),
  // FedEx labels and the commercial invoice, as stored files.
  documents: jsonb("documents").$type<{ kind: "label" | "commercial_invoice"; key: string }[]>().notNull().default([]),
  // Why shipping hasn't happened yet, for the Admin page.
  shippingProblem: text("shipping_problem"),
  expiresAt: ts("expires_at").notNull(),
  paidAt: ts("paid_at"),
  shippedAt: ts("shipped_at"),
  createdAt: createdAt(),
});
