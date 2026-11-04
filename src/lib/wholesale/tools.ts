import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { outlets, wholesaleContacts, wholesalers } from "../db/schema";
import {
  PARTNER_MSRP_MULTIPLE, PARTNER_PRICE, SETTLEMENT_DAYS, WHOLESALE_MIN_UNITS, WHOLESALE_TIERS,
} from "../rules";
import { wholesaleOps } from "./ops";
import { placeOrder, quoteOrder, summary } from "./orders";

// The bot's tools. Every one takes the sender from the verified WhatsApp number, never from the model, so
// a wholesaler only ever sees their own orders and stock. Stockists can quote and place orders; a placed
// order is always one we quoted, so the model can't change prices or quantities on the way.

type Contact = typeof wholesaleContacts.$inferSelect;
type Wholesaler = typeof wholesalers.$inferSelect;
type Outlet = typeof outlets.$inferSelect;

export type Sender = { phone: string; contact?: Contact; wholesaler?: Wholesaler; outlets: Outlet[] };

// What a run of the bot decided besides its reply.
export type RunState = { handover?: string };

export async function identifySender(phone: string): Promise<Sender> {
  const d = await db();
  const [contact] = await d.select().from(wholesaleContacts).where(eq(wholesaleContacts.phone, phone));
  if (!contact) return { phone, outlets: [] };
  const [wholesaler] = await d.select().from(wholesalers).where(eq(wholesalers.id, contact.wholesalerId));
  const theirOutlets = wholesaler?.displayPartner
    ? await d.select().from(outlets).where(eq(outlets.wholesalerId, wholesaler.id))
    : [];
  return { phone, contact, wholesaler, outlets: theirOutlets };
}

const isActive = (s: Sender) => s.wholesaler?.status === "active";

type Tool = {
  def: Anthropic.Beta.BetaTool;
  run(input: Record<string, unknown>, sender: Sender, state: RunState): Promise<unknown>;
};

const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  required,
  additionalProperties: false,
});

const getCatalog: Tool = {
  def: {
    name: "get_catalog",
    description:
      "Lists the designs wholesalers can order, with sizes, stock on hand and the retail price. For an active " +
      "stockist it also returns their minimum order and quantity discounts; for a display partner, their price per shirt.",
    input_schema: schema({}),
    strict: true,
  },
  async run(_input, sender) {
    const items = await wholesaleOps().wholesaleCatalog();
    const w = sender.wholesaler;
    return {
      designs: items,
      ...(isActive(sender) && w?.stockist && {
        stockistTerms: {
          minimumShirts: WHOLESALE_MIN_UNITS,
          discountOffRetail: WHOLESALE_TIERS.map((t) => ({ fromShirts: t.fromUnits, percent: t.discountBps / 100 })),
        },
      }),
      ...(isActive(sender) && w?.displayPartner && {
        partnerTerms: {
          pricePerShirtSold: PARTNER_PRICE[w.currency] ?? "to be confirmed by the team",
          currency: w.currency,
          msrpIs: `${PARTNER_MSRP_MULTIPLE}x the partner price, VAT included`,
          settlementEveryDays: SETTLEMENT_DAYS,
        },
      }),
    };
  },
};

const getOrders: Tool = {
  def: {
    name: "get_orders",
    description:
      "Lists this wholesaler's most recent Shopify orders: order number, date, payment and fulfilment status, " +
      "total, FedEx or courier tracking, and the order status page link where they can see the invoice.",
    input_schema: schema({ limit: { type: "integer", description: "How many orders, newest first (1-20)." } }, ["limit"]),
    strict: true,
  },
  async run(input, sender) {
    const id = sender.wholesaler?.shopifyCustomerId;
    if (!id) return { orders: [], note: "This account has no Shopify orders linked yet." };
    const limit = Math.min(20, Math.max(1, Number(input.limit) || 5));
    return { orders: await wholesaleOps().customerOrders(id, limit) };
  },
};

const getDisplayStock: Tool = {
  def: {
    name: "get_display_stock",
    description: "Shows the Truecolors stock on this partner's display(s), by design and size, for each of their outlets.",
    input_schema: schema({}),
    strict: true,
  },
  async run(_input, sender) {
    return {
      outlets: await Promise.all(
        sender.outlets.map(async (o) => ({
          outlet: o.name,
          city: o.city,
          stock: o.shopifyLocationId ? await wholesaleOps().locationStock(o.shopifyLocationId) : [],
        })),
      ),
    };
  },
};

const recordLead: Tool = {
  def: {
    name: "record_lead",
    description:
      "Saves a new business that wants to stock Truecolors or take a display, so the wholesale team can follow up. " +
      "Call it once you know at least the business name and city.",
    input_schema: schema(
      {
        contact_name: { type: "string" },
        business_name: { type: "string" },
        city: { type: "string" },
        venue_type: { type: "string", description: "e.g. hotel boutique, airport shop, gift shop, attraction" },
        interest: { type: "string", enum: ["stock", "display", "both", "not sure"] },
        email: { type: "string", description: "Empty if they didn't give one." },
      },
      ["contact_name", "business_name", "city", "venue_type", "interest", "email"],
    ),
    strict: true,
  },
  async run(input, sender) {
    if (sender.contact) return { saved: false, note: "This number already belongs to a wholesale account." };
    const d = await db();
    const str = (k: string) => String(input[k] ?? "").trim();
    const [w] = await d
      .insert(wholesalers)
      .values({
        name: str("business_name"),
        status: "lead",
        notes: `${str("venue_type")} in ${str("city")}; interested in: ${str("interest")}`,
      })
      .returning();
    const email = str("email").toLowerCase() || null;
    const [contact] = await d
      .insert(wholesaleContacts)
      .values({ wholesalerId: w.id, name: str("contact_name"), phone: sender.phone, email, role: "owner" })
      .onConflictDoNothing()
      .returning();
    if (contact) Object.assign(sender, { contact, wholesaler: w });
    return { saved: Boolean(contact) };
  },
};

const quoteOrderTool: Tool = {
  def: {
    name: "quote_order",
    description:
      "Prices a stockist's basket: checks the minimum order and stock, applies their quantity discount in their " +
      "currency, and returns a quote reference with the lines and total. Use SKUs from get_catalog. Show the stockist " +
      "the quote and ask them to confirm it, and how they'll pay, before placing it.",
    input_schema: schema(
      {
        lines: {
          type: "array",
          items: schema({ sku: { type: "string" }, quantity: { type: "integer" } }, ["sku", "quantity"]),
        },
      },
      ["lines"],
    ),
    strict: true,
  },
  async run(input, sender) {
    try {
      const q = await quoteOrder(sender.wholesaler!.id, input.lines as { sku: string; quantity: number }[]);
      return { quote: q.ref, validUntil: q.expiresAt.toISOString(), summary: summary(q), currency: q.currency, total: q.subtotal };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
};

const placeOrderTool: Tool = {
  def: {
    name: "place_order",
    description:
      "Places a quote the stockist has explicitly confirmed. Card returns a checkout link to send them; bank_transfer " +
      "returns bank details and the order number to quote as the payment reference. Only call it after they say yes to the quote.",
    input_schema: schema(
      { quote: { type: "string", description: "The quote reference, like Q-7F3K2." }, payment: { type: "string", enum: ["card", "bank_transfer"] } },
      ["quote", "payment"],
    ),
    strict: true,
  },
  async run(input, sender) {
    try {
      const placed = await placeOrder(sender.wholesaler!.id, String(input.quote), input.payment === "bank_transfer" ? "bank_transfer" : "card");
      return {
        placed: true, reference: placed.reference, payUrl: placed.payUrl, bankDetails: placed.bankDetails,
        note: "It ships from Cancún by FedEx, duties paid, once payment arrives. They'll get the tracking by email.",
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
};

const handToPerson: Tool = {
  def: {
    name: "hand_to_person",
    description:
      "Passes the chat to the Truecolors wholesale team. Use it for anything you can't answer or do with your tools: " +
      "changing or cancelling an order, payment problems, restocks, complaints, custom designs, contract terms, or when they ask for a person. " +
      "After calling it, tell them a team member will reply here.",
    input_schema: schema({ reason: { type: "string", description: "One line for the team: what they need." } }, ["reason"]),
    strict: true,
  },
  async run(input, _sender, state) {
    state.handover = String(input.reason ?? "asked for a person");
    return { handedOver: true };
  },
};

// Which tools this sender gets: leads can browse and leave their details; active wholesalers see their own
// orders, and display partners their display stock.
export function toolsFor(sender: Sender): Tool[] {
  if (!isActive(sender)) return [getCatalog, ...(sender.contact ? [] : [recordLead]), handToPerson];
  const w = sender.wholesaler!;
  return [
    getCatalog, getOrders,
    ...(w.stockist ? [quoteOrderTool, placeOrderTool] : []),
    ...(w.displayPartner ? [getDisplayStock] : []),
    handToPerson,
  ];
}
