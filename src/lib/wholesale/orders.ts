import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, or } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { wholesaleContacts, wholesaleOrders, wholesalers, type WholesaleLine } from "../db/schema";
import { UserError } from "../design/service";
import { sendEmail } from "../email";
import { money } from "../format";
import { CURRENCY_COUNTRY, QUOTE_HOURS, WHOLESALE_MIN_UNITS, wholesaleDiscountBps } from "../rules";
import type { OrderPayload } from "../shopify/webhooks";
import { put } from "../storage";
import { wholesaleOps } from "./ops";

// Stockist orders: quote, place, pay, ship. A quote fixes the lines and prices on our side; placing it makes
// a Shopify draft order at exactly those prices. Card payments go through the draft order's checkout link;
// bank transfers become an order awaiting payment that the team marks paid. Once paid, the order is booked
// with FedEx from Cancún, fulfilled in Shopify with its tracking, and the stockist is told.

type Wholesaler = typeof wholesalers.$inferSelect;
export type WholesaleOrder = typeof wholesaleOrders.$inferSelect;

const ORDER_TAG = "wholesale";
const refTag = (ref: string) => `wholesale-order:${ref}`;
const BOOKING = "Booking with FedEx…";

const toCents = (amount: string) => Math.round(Number(amount) * 100);
const amount = (cents: number) => (cents / 100).toFixed(2);
export const showMoney = (value: string, currency: string) => money(toCents(value), currency);

function newRef() {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `Q-${[...randomBytes(5)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

function requireStockist(w: Wholesaler | undefined): Wholesaler {
  if (!w || w.status !== "active" || !w.stockist) throw new UserError("Only active stockists can order.");
  return w;
}

async function wholesalerById(id: string) {
  const d = await db();
  const [w] = await d.select().from(wholesalers).where(eq(wholesalers.id, id));
  return w;
}

export type QuoteRequest = { sku: string; quantity: number }[];

// Prices a basket for a stockist: their market's retail price less the tier discount for the total quantity.
export async function quoteOrder(wholesalerId: string, request: QuoteRequest, now = new Date()): Promise<WholesaleOrder> {
  const w = requireStockist(await wholesalerById(wholesalerId));
  const wanted = new Map<string, number>();
  for (const { sku, quantity } of request) {
    const q = Number(quantity);
    if (!Number.isInteger(q) || q < 0) throw new UserError(`${sku}: quantities are whole numbers of shirts.`);
    if (q > 0) wanted.set(sku.trim().toUpperCase(), (wanted.get(sku.trim().toUpperCase()) ?? 0) + q);
  }
  if (!wanted.size) throw new UserError("The order has no shirts in it.");
  const units = [...wanted.values()].reduce((a, b) => a + b, 0);
  if (units < WHOLESALE_MIN_UNITS) throw new UserError(`The minimum order is ${WHOLESALE_MIN_UNITS} shirts; this has ${units}.`);
  const discountBps = wholesaleDiscountBps(units)!;

  const ops = wholesaleOps();
  const catalog = await ops.wholesaleCatalog();
  const bySku = new Map(catalog.flatMap((p) => p.sizes.map((s) => [s.sku.toUpperCase(), { product: p, size: s }] as const)));
  const missing = [...wanted.keys()].filter((sku) => !bySku.has(sku));
  if (missing.length) throw new UserError(`Not in the wholesale catalog: ${missing.join(", ")}.`);

  const hub = config().WHOLESALE_LOCATION_ID;
  const hubStock = hub ? new Map((await ops.locationStock(hub)).map((l) => [l.sku.toUpperCase(), l.available])) : undefined;
  const short = [...wanted].filter(([sku, q]) => q > (hubStock?.get(sku) ?? (hub ? 0 : bySku.get(sku)!.size.available)));
  if (short.length) {
    throw new UserError(`Not enough stock for: ${short.map(([sku]) => `${sku} (${hubStock?.get(sku) ?? bySku.get(sku)!.size.available} left)`).join(", ")}.`);
  }

  const prices = await ops.variantPrices([...wanted.keys()].map((sku) => bySku.get(sku)!.size.variantId), CURRENCY_COUNTRY[w.currency]);
  const lines: WholesaleLine[] = [...wanted].map(([sku, quantity]) => {
    const { product, size } = bySku.get(sku)!;
    const price = prices.get(size.variantId);
    if (!price || price.currency !== w.currency) throw new UserError(`${sku} has no ${w.currency} price in Shopify yet.`);
    const retail = toCents(price.amount);
    return {
      variantId: size.variantId, sku, title: product.title, size: size.size, quantity,
      retail: amount(retail), unit: amount(Math.round((retail * (10_000 - discountBps)) / 10_000)),
    };
  });
  const subtotal = lines.reduce((s, l) => s + toCents(l.unit) * l.quantity, 0);

  const d = await db();
  const [order] = await d
    .insert(wholesaleOrders)
    .values({
      ref: newRef(), wholesalerId: w.id, currency: w.currency, lines, units, discountBps, subtotal: amount(subtotal),
      expiresAt: new Date(now.getTime() + QUOTE_HOURS * 3_600_000),
    })
    .returning();
  return order;
}

export type Placed = { order: WholesaleOrder; payUrl?: string; bankDetails?: string; reference: string };

// Places a quote the stockist has accepted. Card: a checkout link. Bank transfer: an order awaiting payment,
// with the bank details and the order number to quote as the reference.
export async function placeOrder(
  wholesalerId: string, ref: string, method: "card" | "bank_transfer", now = new Date(),
): Promise<Placed> {
  const w = requireStockist(await wholesalerById(wholesalerId));
  if (!w.shopifyCustomerId) throw new UserError("This account isn't linked to a Shopify customer yet; the team needs to set that up.");
  if (method === "bank_transfer" && !config().WHOLESALE_BANK_DETAILS) throw new UserError("Bank transfer isn't set up yet; pay by card or ask the team.");
  const d = await db();
  const [claimed] = await d
    .update(wholesaleOrders)
    .set({ status: "awaiting_payment", paymentMethod: method })
    .where(and(eq(wholesaleOrders.ref, ref.trim().toUpperCase()), eq(wholesaleOrders.wholesalerId, w.id), eq(wholesaleOrders.status, "quoted")))
    .returning();
  if (!claimed) throw new UserError(`There's no open quote ${ref} on this account.`);
  if (claimed.expiresAt < now) {
    await d.update(wholesaleOrders).set({ status: "cancelled" }).where(eq(wholesaleOrders.id, claimed.id));
    throw new UserError(`Quote ${claimed.ref} has lapsed; ask for a new one.`);
  }

  const ops = wholesaleOps();
  let order: WholesaleOrder;
  try {
    const draft = await ops.createWholesaleDraftOrder({
      shopifyCustomerId: w.shopifyCustomerId, currency: claimed.currency, lines: claimed.lines,
      tags: [ORDER_TAG, refTag(claimed.ref)], note: `Wholesale quote ${claimed.ref}`, reserveUntil: claimed.expiresAt,
    });
    const pending = method === "bank_transfer" ? await ops.completeDraftAsPending(draft.id) : undefined;
    [order] = await d
      .update(wholesaleOrders)
      .set({
        draftOrderId: draft.id, payUrl: method === "card" ? draft.invoiceUrl : null,
        shopifyOrderId: pending?.orderId ?? null, shopifyOrderName: pending?.orderName ?? null,
      })
      .where(eq(wholesaleOrders.id, claimed.id))
      .returning();
  } catch (e) {
    await d.update(wholesaleOrders).set({ status: "quoted", paymentMethod: null }).where(eq(wholesaleOrders.id, claimed.id));
    throw e;
  }

  const reference = order.shopifyOrderName ?? order.ref;
  const placed: Placed = {
    order, reference,
    ...(method === "card" ? { payUrl: order.payUrl! } : { bankDetails: config().WHOLESALE_BANK_DETAILS.replace(/\\n/g, "\n") }),
  };
  await notify(w, `order-placed:${order.ref}`, `Your Truecolors order ${reference}: how to pay`, [
    summary(order),
    method === "card"
      ? `Pay by card here:\n${placed.payUrl}`
      : `Pay by bank transfer, quoting ${reference}:\n${placed.bankDetails}`,
    "We ship from Cancún by FedEx, duties paid, as soon as payment arrives.",
  ]);
  return placed;
}

export function summary(o: WholesaleOrder): string {
  const lines = o.lines.map((l) => `${l.quantity} × ${l.title} ${l.size} at ${showMoney(l.unit, o.currency)}`);
  return `${lines.join("\n")}\n${o.units} shirts, ${o.discountBps / 100}% off retail. Total ${showMoney(o.subtotal, o.currency)} before shipping.`;
}

// Emails every contact at the wholesaler who has an email. The key makes each notice go out once.
export async function notify(w: Wholesaler, key: string, subject: string, paragraphs: string[]) {
  const d = await db();
  const contacts = await d.select().from(wholesaleContacts).where(eq(wholesaleContacts.wholesalerId, w.id));
  for (const c of contacts.filter((c) => c.email)) {
    await sendEmail({ to: c.email!, subject, body: `Hi ${c.name},\n\n${paragraphs.join("\n\n")}`, key: `${key}:${c.id}` });
  }
}

// Shopify's orders/create webhook. Card payments arrive as a paid order made from the draft; bank transfers
// first as an order awaiting payment. Either way the order carries the quote's tag.
export async function recordWholesaleShopifyOrder(payload: OrderPayload) {
  const ref = payload.tags?.split(",").map((t) => t.trim()).find((t) => t.startsWith("wholesale-order:"))?.slice("wholesale-order:".length);
  if (!ref) return;
  const d = await db();
  await d
    .update(wholesaleOrders)
    .set({ shopifyOrderId: String(payload.id), shopifyOrderName: payload.name })
    .where(and(eq(wholesaleOrders.ref, ref), isNull(wholesaleOrders.shopifyOrderId)));
  if (payload.financial_status !== "paid") return;
  const [paid] = await d
    .update(wholesaleOrders)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(wholesaleOrders.ref, ref), eq(wholesaleOrders.status, "awaiting_payment")))
    .returning();
  if (paid) await shipOrder(paid.id);
}

// From the Admin page, once a bank transfer has landed.
export async function markBankTransferPaid(orderId: string) {
  const d = await db();
  const [o] = await d.select().from(wholesaleOrders).where(eq(wholesaleOrders.id, orderId));
  if (!o || o.status !== "awaiting_payment" || !o.shopifyOrderId) throw new UserError("That order isn't waiting for a bank transfer.");
  await wholesaleOps().markOrderPaid(o.shopifyOrderId);
  await d.update(wholesaleOrders).set({ status: "paid", paidAt: new Date() }).where(eq(wholesaleOrders.id, o.id));
  await shipOrder(o.id);
}

// Books FedEx, saves the documents, fulfils the Shopify order with the tracking number and tells the stockist.
// Anything that stops it is kept on the order for the Admin page, where shipping can be retried.
export async function shipOrder(orderId: string, opts: { retry?: boolean } = {}) {
  const d = await db();
  const [o] = await d
    .update(wholesaleOrders)
    .set({ shippingProblem: BOOKING })
    .where(and(
      eq(wholesaleOrders.id, orderId), eq(wholesaleOrders.status, "paid"), isNull(wholesaleOrders.trackingNumber),
      opts.retry ? undefined : or(isNull(wholesaleOrders.shippingProblem), ne(wholesaleOrders.shippingProblem, BOOKING)),
    ))
    .returning();
  if (!o) return;
  const problem = (text: string) =>
    d.update(wholesaleOrders).set({ shippingProblem: text }).where(eq(wholesaleOrders.id, o.id));
  const ops = wholesaleOps();
  try {
    const shipTo = await ops.orderShipTo(o.shopifyOrderId!);
    if (!shipTo) return problem("The Shopify order has no complete shipping address.");
    const shipment = await ops.bookShipment({
      shipTo, units: o.units, currency: o.currency, customsValue: o.subtotal, reference: o.shopifyOrderName ?? o.ref, date: new Date(),
    });
    const documents = [];
    for (const doc of shipment.documents) {
      documents.push({ kind: doc.kind, key: await put(`wholesale/${o.ref}`, "pdf", Buffer.from(doc.pdf, "base64")) });
    }
    await d
      .update(wholesaleOrders)
      .set({ trackingNumber: shipment.trackingNumber, documents, shippingProblem: "Booked with FedEx; marking shipped in Shopify…" })
      .where(eq(wholesaleOrders.id, o.id));
    await ops.fulfilWithTracking(o.shopifyOrderId!, shipment.trackingNumber);
    const [shipped] = await d
      .update(wholesaleOrders)
      .set({ status: "shipped", shippedAt: new Date(), shippingProblem: null })
      .where(eq(wholesaleOrders.id, o.id))
      .returning();
    const w = (await wholesalerById(o.wholesalerId))!;
    await notify(w, `order-shipped:${o.ref}`, `Your Truecolors order ${shipped.shopifyOrderName ?? o.ref} has shipped`, [
      `It's on its way from Cancún by FedEx, duties paid. Tracking number ${shipment.trackingNumber}:`,
      `https://www.fedex.com/fedextrack/?trknbr=${shipment.trackingNumber}`,
      summary(shipped),
    ]);
  } catch (e) {
    console.error(`[wholesale] shipping ${o.ref}:`, (e as Error).message);
    await problem((e as Error).message);
  }
}

export async function ordersFor(wholesalerId: string) {
  const d = await db();
  return d
    .select()
    .from(wholesaleOrders)
    .where(and(eq(wholesaleOrders.wholesalerId, wholesalerId), inArray(wholesaleOrders.status, ["quoted", "awaiting_payment", "paid", "shipped"])))
    .orderBy(desc(wholesaleOrders.createdAt))
    .limit(30);
}

export async function quoteFor(wholesalerId: string, ref: string) {
  const d = await db();
  const [o] = await d
    .select()
    .from(wholesaleOrders)
    .where(and(eq(wholesaleOrders.wholesalerId, wholesalerId), eq(wholesaleOrders.ref, ref.trim().toUpperCase())));
  return o;
}

export async function adminOrders() {
  const d = await db();
  return d
    .select({ o: wholesaleOrders, w: wholesalers })
    .from(wholesaleOrders)
    .innerJoin(wholesalers, eq(wholesalers.id, wholesaleOrders.wholesalerId))
    .where(ne(wholesaleOrders.status, "cancelled"))
    .orderBy(desc(wholesaleOrders.createdAt))
    .limit(50);
}
