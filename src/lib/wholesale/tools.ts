import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { outlets, wholesaleContacts, wholesalers } from "../db/schema";
import {
  PARTNER_MSRP_MULTIPLE, PARTNER_PRICE, SETTLEMENT_DAYS, WHOLESALE_MIN_UNITS, WHOLESALE_TIERS,
} from "../rules";
import { catalogFor } from "../shopify/wholesale";
import { wholesaleOps } from "./ops";
import { config } from "../config";
import { confirmSalesReport, outletSummary, reportSales, requestRestock } from "./consignment";
import { briefsFor, requestDesign } from "./designs";
import { reportFault } from "./service";
import { placeOrder, quoteOrder, showMoney, summary } from "./orders";
import { publicUrl } from "../links";

// The bot's tools. Every one takes the sender from the verified WhatsApp number, never from the model, so
// a wholesaler only ever sees their own orders and stock. Stockists can quote and place orders; a placed
// order is always one we quoted, so the model can't change prices or quantities on the way.

type Contact = typeof wholesaleContacts.$inferSelect;
type Wholesaler = typeof wholesalers.$inferSelect;
type Outlet = typeof outlets.$inferSelect;

export type Sender = { phone: string; contact?: Contact; wholesaler?: Wholesaler; outlets: Outlet[] };

// What a run of the bot knows about the conversation and decided besides its reply.
export type RunState = {
  handover?: string;
  // Extra Gorgias tags for the handover, such as display-service.
  tags?: string[];
  ticketId?: string;
  // Photos the customer sent since the bot last replied.
  images?: string[];
};

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
    const items = catalogFor(await wholesaleOps().wholesaleCatalog(), sender.wholesaler?.id);
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

// Display partners name the outlet when they have more than one.
function outletOf(sender: Sender, name: unknown) {
  if (sender.outlets.length === 1) return sender.outlets[0];
  const wanted = String(name ?? "").trim().toLowerCase();
  const match = sender.outlets.find((o) => o.name.toLowerCase() === wanted) ?? sender.outlets.find((o) => wanted && o.name.toLowerCase().includes(wanted));
  if (!match) throw new Error(`Which outlet? ${sender.outlets.map((o) => o.name).join(", ") || "none set up yet"}`);
  return match;
}

const outletParam = { outlet: { type: "string", description: "The outlet's name; empty if they have only one." } };

async function attempt(fn: () => Promise<unknown>) {
  try {
    return await fn();
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const requestRestockTool: Tool = {
  def: {
    name: "request_restock",
    description:
      "Asks the team to restock a display partner's outlet. It proposes topping every design and size back up to the " +
      "outlet's usual level and returns the proposal; the team approves and sends it.",
    input_schema: schema({ ...outletParam, note: { type: "string", description: "Anything the partner asked for; empty if nothing." } }, ["outlet", "note"]),
    strict: true,
  },
  run: (input, sender) =>
    attempt(async () => {
      const r = await requestRestock(outletOf(sender, input.outlet).id, sender.contact?.id ?? null, String(input.note ?? ""));
      return { requested: true, shirts: r.units, lines: r.lines.map((l) => `${l.quantity} × ${l.title} ${l.size}`), note: "The team approves restocks and confirms when they're sent." };
    }),
};

const reportSalesTool: Tool = {
  def: {
    name: "report_sales",
    description:
      "Records what a display partner sold on their own till, by SKU (from get_catalog or get_display_stock) and quantity. " +
      "Returns a draft report with a reference and what they'll owe; read it back and confirm it with confirm_sales_report once they agree.",
    input_schema: schema(
      { ...outletParam, lines: { type: "array", items: schema({ sku: { type: "string" }, quantity: { type: "integer" } }, ["sku", "quantity"]) } },
      ["outlet", "lines"],
    ),
    strict: true,
  },
  run: (input, sender) =>
    attempt(async () => {
      const r = await reportSales(outletOf(sender, input.outlet).id, input.lines as { sku: string; quantity: number }[], "whatsapp");
      return { report: r.ref, shirts: r.units, lines: r.lines.map((l) => `${l.quantity} × ${l.title} ${l.size}`), status: "draft, not confirmed yet" };
    }),
};

const confirmSalesTool: Tool = {
  def: {
    name: "confirm_sales_report",
    description: "Confirms a sales report the partner has agreed is right. Only call it after they say yes.",
    input_schema: schema({ ...outletParam, report: { type: "string", description: "The report reference, like S-7F3K2." } }, ["outlet", "report"]),
    strict: true,
  },
  run: (input, sender) =>
    attempt(async () => {
      const r = await confirmSalesReport(outletOf(sender, input.outlet).id, String(input.report));
      return { confirmed: r.ref, shirts: r.units };
    }),
};

const getSettlementTool: Tool = {
  def: {
    name: "get_settlement",
    description:
      "Shows a display partner's current period for an outlet: shirts sold so far, what they owe so far, when the period " +
      "ends, whether restocks are paused, and their recent settlements with payment links.",
    input_schema: schema(outletParam, ["outlet"]),
    strict: true,
  },
  run: (input, sender) =>
    attempt(async () => {
      const s = await outletSummary(outletOf(sender, input.outlet).id);
      return {
        outlet: s.outlet.name, periodEnds: s.periodEnds.toDateString(), soldThisPeriod: s.soldThisPeriod,
        owedSoFar: s.owedSoFar === undefined ? "price to be confirmed by the team" : showMoney(s.owedSoFar, s.currency),
        restocksPaused: s.restocksPaused, salesReportDue: s.overdue,
        settlements: s.settlements.map((x) => ({
          period: `${x.periodStart.toDateString()} to ${x.periodEnd.toDateString()}`, shirts: x.reportedUnits + x.missingUnits,
          amount: x.amount ? showMoney(x.amount, x.currency) : "being checked", status: x.status, payUrl: x.payUrl ?? undefined,
        })),
      };
    }),
};

const requestDesignTool: Tool = {
  def: {
    name: "request_design",
    description:
      "Asks the Truecolors design team for a design made for the wholesaler's location: their city, resort, landmark " +
      "or theme. Truecolors owns location designs unless agreed otherwise; once approved, only this wholesaler can order it.",
    input_schema: schema({ brief: { type: "string", description: "What they want, in their words: place, landmarks, feel, colours." } }, ["brief"]),
    strict: true,
  },
  run: (input, sender) =>
    attempt(async () => {
      const b = await requestDesign(sender.wholesaler!.id, sender.contact?.id ?? null, String(input.brief ?? ""));
      return { requested: b.ref, next: "The design team will pick it up; they'll get a link to review the design in the wholesale portal." };
    }),
};

const getDesignsTool: Tool = {
  def: {
    name: "get_designs",
    description:
      "Lists the wholesaler's location design requests and where each stands. Designs ready for review are approved " +
      "or sent back in the wholesale portal, where they can see the shade and sun mockups: give them the link.",
    input_schema: schema({}),
    strict: true,
  },
  run: (_input, sender) =>
    attempt(async () => ({
      reviewIn: publicUrl("/wholesale#designs"),
      designs: (await briefsFor(sender.wholesaler!.id)).map(({ b, design }) => ({
        ref: b.ref, brief: b.brief, design: design?.title, feedback: b.feedback ?? undefined,
        status: {
          open: "waiting for a designer", assigned: "being designed", in_review: "ready for you to review",
          changes_requested: "being changed", approved: "approved, going into your catalog", live: "in your catalog", declined: "declined",
        }[b.status],
      })),
    })),
};

const reportFaultTool: Tool = {
  def: {
    name: "report_fault",
    description:
      "Logs a fault on a display partner's display (UV light, button, screen, glass, lock) for the service team, with any " +
      "photos they sent, and passes the chat to a person. Tell them the team will reply here.",
    input_schema: schema(
      {
        ...outletParam,
        display: { type: "string", description: "Which display: Sunbox, Prism, Tower or its serial; empty if they have one." },
        problem: { type: "string", description: "What's wrong, in their words." },
      },
      ["outlet", "display", "problem"],
    ),
    strict: true,
  },
  run: (input, sender, state) =>
    attempt(async () => {
      const outlet = outletOf(sender, input.outlet);
      const { ticket, display } = await reportFault({
        outletId: outlet.id, contactId: sender.contact?.id ?? null, problem: String(input.problem ?? ""),
        display: String(input.display ?? ""), photos: state.images ?? [], gorgiasTicketId: state.ticketId,
      });
      state.handover = `display fault ${ticket.ref} at ${outlet.name}${display ? ` (${display.kind} ${display.serial})` : ""}: ${ticket.problem}`;
      state.tags = [...(state.tags ?? []), "display-service"];
      return { logged: ticket.ref, display: display ? `${display.kind} ${display.serial}` : "not sure which; the team will check" };
    }),
};

const handToPerson: Tool = {
  def: {
    name: "hand_to_person",
    description:
      "Passes the chat to the Truecolors wholesale team. Use it for anything you can't answer or do with your tools: " +
      "changing or cancelling an order, payment problems, complaints, contract terms, or when they ask for a person. " +
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
    getCatalog, getOrders, requestDesignTool, getDesignsTool,
    ...(w.stockist ? [quoteOrderTool, placeOrderTool] : []),
    ...(w.displayPartner ? [getDisplayStock, reportSalesTool, confirmSalesTool, getSettlementTool, requestRestockTool, reportFaultTool] : []),
    handToPerson,
  ];
}
