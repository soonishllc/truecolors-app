import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import {
  outlets, restocks, salesReports, settlements, stockCounts, wholesalers, type ConsignmentLine,
} from "../db/schema";
import { UserError } from "../design/service";
import { PARTNER_PRICE, REMINDER_HOURS, SETTLEMENT_REMINDERS } from "../rules";
import type { OrderPayload } from "../shopify/webhooks";
import { catalogFor } from "../shopify/wholesale";
import { wholesaleOps } from "./ops";
import { notify, showMoney } from "./orders";

// Display partners hold Truecolors stock on consignment. Each outlet is a Shopify location: restocks move
// stock onto it, confirmed sales reports take it off, and a count on a visit corrects it. Every period
// (15 days, or 7 for busy outlets) the shirts sold are settled at the partner price, half the MSRP, as a
// Shopify invoice. A period with no sales report pauses restocks and sends reminders until the team counts.

type Outlet = typeof outlets.$inferSelect;
type Wholesaler = typeof wholesalers.$inferSelect;
export type Restock = typeof restocks.$inferSelect;
export type SalesReport = typeof salesReports.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
type TickLog = string[];

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const SETTLEMENT_TAG = "consignment-settlement";

const shortRef = (prefix: string) => {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `${prefix}-${[...randomBytes(5)].map((b) => alphabet[b % alphabet.length]).join("")}`;
};
const units = (lines: { quantity: number }[]) => lines.reduce((s, l) => s + l.quantity, 0);
const describe = (lines: ConsignmentLine[]) => lines.map((l) => `${l.quantity} × ${l.title} ${l.size}`).join("\n");
export const periodEnd = (o: Outlet) => new Date(o.periodStart.getTime() + o.settlementDays * DAY);

async function load(outletId: string) {
  const d = await db();
  const [row] = await d
    .select({ outlet: outlets, wholesaler: wholesalers })
    .from(outlets)
    .innerJoin(wholesalers, eq(wholesalers.id, outlets.wholesalerId))
    .where(eq(outlets.id, outletId));
  if (!row) throw new UserError("No such outlet.");
  return row;
}

function requireLocation(o: Outlet): string {
  if (!o.shopifyLocationId) throw new UserError(`${o.name} has no Shopify location yet; the team needs to set that up.`);
  return o.shopifyLocationId;
}

// All wholesale ships from the Cancún hub, display restocks included.
function supplyLocation(_o: Outlet): string {
  const id = config().WHOLESALE_LOCATION_ID;
  if (!id) throw new UserError("The Cancún stock location isn't set up yet.");
  return id;
}

async function catalogIndex(wholesalerId: string) {
  const catalog = catalogFor(await wholesaleOps().wholesaleCatalog(), wholesalerId);
  return new Map(catalog.flatMap((p) => p.sizes.map((s) => [s.sku.toUpperCase(), { title: p.title, ...s }] as const)));
}

// Turns {sku, quantity} pairs into lines, refusing SKUs that aren't in the wholesale catalog.
async function toLines(
  wholesalerId: string, request: { sku: string; quantity: number }[], allowZero = false,
): Promise<ConsignmentLine[]> {
  const index = await catalogIndex(wholesalerId);
  const merged = new Map<string, number>();
  for (const { sku, quantity } of request) {
    const q = Number(quantity);
    if (!Number.isInteger(q) || q < 0) throw new UserError(`${sku}: use whole numbers of shirts.`);
    const key = sku.trim().toUpperCase();
    merged.set(key, (merged.get(key) ?? 0) + q);
  }
  const unknown = [...merged.keys()].filter((sku) => !index.has(sku));
  if (unknown.length) throw new UserError(`Not in the catalog: ${unknown.join(", ")}.`);
  return [...merged]
    .filter(([, q]) => allowZero || q > 0)
    .map(([sku, quantity]) => {
      const v = index.get(sku)!;
      return { variantId: v.variantId, inventoryItemId: v.inventoryItemId, sku, title: v.title, size: v.size, quantity };
    });
}

// What's on the display now, by SKU.
async function onDisplay(o: Outlet): Promise<Map<string, number>> {
  const lines = await wholesaleOps().locationStock(requireLocation(o));
  return new Map(lines.map((l) => [l.sku.toUpperCase(), l.available]));
}

// ---- Restocks -------------------------------------------------------------------------------------------

// Proposes topping every design and size back up to the outlet's usual level. The team approves it.
export async function requestRestock(outletId: string, requestedBy: string | null, note = ""): Promise<Restock> {
  const { outlet } = await load(outletId);
  if (outlet.overdueSince) throw new UserError("Restocks are paused until this period's sales are reported.");
  const have = await onDisplay(outlet);
  const index = await catalogIndex(outlet.wholesalerId);
  const lines: ConsignmentLine[] = [...index]
    .map(([sku, v]) => ({
      variantId: v.variantId, inventoryItemId: v.inventoryItemId, sku, title: v.title, size: v.size,
      quantity: Math.max(0, outlet.parPerSku - (have.get(sku) ?? 0)),
    }))
    .filter((l) => l.quantity > 0);
  if (!lines.length) throw new UserError(`${outlet.name} is already stocked to its usual level.`);
  const d = await db();
  // One open request per outlet: asking again refreshes it.
  await d.delete(restocks).where(and(eq(restocks.outletId, outlet.id), eq(restocks.status, "requested")));
  const [r] = await d
    .insert(restocks)
    .values({ outletId: outlet.id, lines, units: units(lines), requestedBy, note: note || null })
    .returning();
  return r;
}

export async function decideRestock(restockId: string, approve: boolean) {
  const d = await db();
  const [r] = await d
    .update(restocks)
    .set({ status: approve ? "approved" : "declined", decidedAt: new Date() })
    .where(and(eq(restocks.id, restockId), eq(restocks.status, "requested")))
    .returning();
  if (!r) throw new UserError("That restock has already been decided.");
  const { outlet, wholesaler } = await load(r.outletId);
  await notify(wholesaler, `restock-${r.status}:${r.id}`, `Restock for ${outlet.name}: ${approve ? "approved" : "not this time"}`, [
    approve ? `We're preparing ${r.units} shirts for ${outlet.name}:\n${describe(r.lines)}` : "We won't send this restock; the team will be in touch about why.",
  ]);
  return r;
}

// The team has sent it: the shirts leave the supply location and appear on the display.
export async function markRestockSent(restockId: string) {
  const d = await db();
  const [r] = await d.select().from(restocks).where(eq(restocks.id, restockId));
  if (r?.status !== "approved") throw new UserError("Only approved restocks can be sent.");
  const { outlet, wholesaler } = await load(r.outletId);
  const from = supplyLocation(outlet);
  const to = requireLocation(outlet);
  await wholesaleOps().adjustStock(
    r.lines.flatMap((l) => [
      { inventoryItemId: l.inventoryItemId, locationId: from, delta: -l.quantity },
      { inventoryItemId: l.inventoryItemId, locationId: to, delta: l.quantity },
    ]),
    `restock/${r.id}`,
  );
  await d.update(restocks).set({ status: "sent", sentAt: new Date() }).where(eq(restocks.id, r.id));
  await notify(wholesaler, `restock-sent:${r.id}`, `Restock on its way to ${outlet.name}`, [describe(r.lines)]);
}

// ---- Sales reports --------------------------------------------------------------------------------------

// A partner's count of what they sold. It stays a draft until they confirm it.
export async function reportSales(
  outletId: string, request: { sku: string; quantity: number }[], source: SalesReport["source"],
): Promise<SalesReport> {
  const { outlet } = await load(outletId);
  const lines = await toLines(outlet.wholesalerId, request, true);
  const have = await onDisplay(outlet);
  const tooMany = lines.filter((l) => l.quantity > (have.get(l.sku) ?? 0));
  if (tooMany.length) {
    throw new UserError(`More than the display holds: ${tooMany.map((l) => `${l.sku} (${have.get(l.sku) ?? 0} on the display)`).join(", ")}.`);
  }
  const d = await db();
  await d.delete(salesReports).where(and(eq(salesReports.outletId, outlet.id), eq(salesReports.status, "draft")));
  const [r] = await d
    .insert(salesReports)
    .values({ ref: shortRef("S"), outletId: outlet.id, lines: lines.filter((l) => l.quantity > 0), units: units(lines), source })
    .returning();
  return r;
}

// Confirming takes the sold shirts off the display's stock. If the period has ended, it settles at once.
export async function confirmSalesReport(outletId: string, ref: string, now = new Date()) {
  const d = await db();
  const [r] = await d
    .update(salesReports)
    .set({ status: "confirmed", confirmedAt: now })
    .where(and(eq(salesReports.outletId, outletId), eq(salesReports.ref, ref.trim().toUpperCase()), eq(salesReports.status, "draft")))
    .returning();
  if (!r) throw new UserError(`There's no sales report ${ref} waiting to be confirmed.`);
  const { outlet } = await load(outletId);
  if (r.lines.length) {
    const at = requireLocation(outlet);
    await wholesaleOps().adjustStock(
      r.lines.map((l) => ({ inventoryItemId: l.inventoryItemId, locationId: at, delta: -l.quantity })),
      `sales/${r.ref}`,
    );
  }
  await settleOutlet(outlet.id, now, []);
  return r;
}

// ---- Stock counts ---------------------------------------------------------------------------------------

// The team's count on a visit. The display's stock is set to what was found; shirts missing beyond what
// was reported are settled as sold.
export async function recordStockCount(outletId: string, counted: { sku: string; quantity: number }[], countedBy: string, now = new Date()) {
  const { outlet } = await load(outletId);
  const lines = await toLines(outlet.wholesalerId, counted, true);
  const have = await onDisplay(outlet);
  const index = await catalogIndex(outlet.wholesalerId);
  // Anything on the display that wasn't counted was not found.
  for (const sku of have.keys()) {
    if (!lines.some((l) => l.sku === sku) && index.has(sku) && (have.get(sku) ?? 0) > 0) {
      const v = index.get(sku)!;
      lines.push({ variantId: v.variantId, inventoryItemId: v.inventoryItemId, sku, title: v.title, size: v.size, quantity: 0 });
    }
  }
  const withExpected = lines.map((l) => ({ ...l, expected: have.get(l.sku) ?? 0 }));
  const missing = withExpected.reduce((s, l) => s + Math.max(0, l.expected - l.quantity), 0);
  await wholesaleOps().adjustStock(
    withExpected.map((l) => ({ inventoryItemId: l.inventoryItemId, locationId: requireLocation(outlet), delta: l.quantity - l.expected })),
    `count/${outlet.id}/${now.toISOString()}`,
  );
  const d = await db();
  const [count] = await d
    .insert(stockCounts)
    .values({ outletId: outlet.id, lines: withExpected, missingUnits: missing, countedBy })
    .returning();
  await settleOutlet(outlet.id, now, []);
  return count;
}

// ---- Settlement -----------------------------------------------------------------------------------------

async function remind(outlet: Outlet, wholesaler: Wholesaler, now: Date, log: TickLog) {
  const d = await db();
  if (!outlet.overdueSince) {
    await d.update(outlets).set({ overdueSince: now, remindersSent: 0 }).where(eq(outlets.id, outlet.id));
    outlet = { ...outlet, overdueSince: now, remindersSent: 0 };
  }
  const nextAt = outlet.overdueSince!.getTime() + outlet.remindersSent * REMINDER_HOURS * HOUR;
  if (outlet.remindersSent >= SETTLEMENT_REMINDERS) {
    log.push(`${outlet.name}: no sales report, needs a visit to count`);
    return;
  }
  if (now.getTime() < nextAt) return;
  await notify(
    wholesaler,
    `sales-reminder:${outlet.id}:${outlet.periodStart.toISOString()}:${outlet.remindersSent + 1}`,
    `Truecolors sales for ${outlet.name}: please send your numbers`,
    [
      `The period from ${outlet.periodStart.toDateString()} has ended. Send us the shirts you sold, by design and size, ` +
        "on WhatsApp (a photo of the till report is fine) or in the wholesale portal.",
      "Restocks are on hold until we have them.",
    ],
  );
  await d.update(outlets).set({ remindersSent: outlet.remindersSent + 1 }).where(eq(outlets.id, outlet.id));
  log.push(`${outlet.name}: sales reminder ${outlet.remindersSent + 1} sent`);
}

// Closes an outlet's period once it has ended and there's something to settle it on: a confirmed sales
// report or a count made since the period began. Otherwise it reminds the partner.
export async function settleOutlet(outletId: string, now: Date, log: TickLog) {
  const { outlet, wholesaler } = await load(outletId);
  const end = periodEnd(outlet);
  if (now < end || wholesaler.status !== "active") return;
  const d = await db();
  const reports = await d
    .select()
    .from(salesReports)
    .where(and(eq(salesReports.outletId, outlet.id), eq(salesReports.status, "confirmed"), isNull(salesReports.settlementId)));
  const counts = await d.select().from(stockCounts).where(and(eq(stockCounts.outletId, outlet.id), isNull(stockCounts.settlementId)));
  const fresh = [...reports.map((r) => r.confirmedAt!), ...counts.map((c) => c.createdAt)].some((t) => t >= outlet.periodStart);
  if (!fresh) return remind(outlet, wholesaler, now, log);

  const reported = reports.reduce((s, r) => s + r.units, 0);
  const missing = counts.reduce((s, c) => s + c.missingUnits, 0);
  const price = PARTNER_PRICE[wholesaler.currency];
  const total = reported + missing;
  const [s] = await d
    .insert(settlements)
    .values({
      outletId: outlet.id, periodStart: outlet.periodStart, periodEnd: end, reportedUnits: reported, missingUnits: missing,
      currency: wholesaler.currency,
      unitPrice: price === undefined ? null : price.toFixed(2),
      amount: price === undefined ? null : (price * total).toFixed(2),
      status: total === 0 ? "paid" : "review",
      problem: price === undefined && total > 0 ? `No partner price set for ${wholesaler.currency} yet (rules.ts).` : null,
      paidAt: total === 0 ? now : null,
    })
    .returning();
  if (reports.length) await d.update(salesReports).set({ settlementId: s.id }).where(inArray(salesReports.id, reports.map((r) => r.id)));
  if (counts.length) await d.update(stockCounts).set({ settlementId: s.id }).where(inArray(stockCounts.id, counts.map((c) => c.id)));
  // The next period starts where this one ended, or now if the partner was late enough to miss whole periods.
  const nextStart = now.getTime() - end.getTime() >= outlet.settlementDays * DAY ? now : end;
  await d.update(outlets).set({ periodStart: nextStart, overdueSince: null, remindersSent: 0 }).where(eq(outlets.id, outlet.id));
  log.push(`${outlet.name}: settlement for ${total} shirts ready for review`);
}

// From tick(): close every display partner's outlets whose period has ended.
export async function runSettlements(now: Date, log: TickLog) {
  const d = await db();
  const all = await d
    .select({ id: outlets.id })
    .from(outlets)
    .innerJoin(wholesalers, eq(wholesalers.id, outlets.wholesalerId))
    .where(and(eq(wholesalers.status, "active"), eq(wholesalers.displayPartner, true)));
  for (const { id } of all) {
    try {
      await settleOutlet(id, now, log);
    } catch (e) {
      log.push(`settlement ${id}: error ${(e as Error).message}`);
    }
  }
}

// The team has checked the statement: invoice it as a Shopify draft order with a card link, and email it.
export async function invoiceSettlement(settlementId: string) {
  const d = await db();
  const [s] = await d.select().from(settlements).where(eq(settlements.id, settlementId));
  if (s?.status !== "review") throw new UserError("That settlement isn't waiting for review.");
  if (!s.unitPrice || !s.amount) throw new UserError(s.problem ?? "This settlement has no price yet.");
  const { outlet, wholesaler } = await load(s.outletId);
  if (!wholesaler.shopifyCustomerId) throw new UserError(`${wholesaler.name} isn't linked to a Shopify customer yet.`);
  const reports = await d.select().from(salesReports).where(eq(salesReports.settlementId, s.id));
  const sold = new Map<string, { title: string; quantity: number }>();
  for (const l of reports.flatMap((r) => r.lines)) {
    const key = `${l.title} ${l.size}`;
    sold.set(key, { title: key, quantity: (sold.get(key)?.quantity ?? 0) + l.quantity });
  }
  const period = `${s.periodStart.toDateString()} to ${s.periodEnd.toDateString()}`;
  const lines = [
    ...[...sold.values()].map((l) => ({ title: `${l.title}, sold at ${outlet.name}`, quantity: l.quantity, unit: s.unitPrice! })),
    ...(s.missingUnits ? [{ title: `Shirts missing at the stock count, ${outlet.name}`, quantity: s.missingUnits, unit: s.unitPrice }] : []),
  ];
  const draft = await wholesaleOps().createInvoiceDraftOrder({
    shopifyCustomerId: wholesaler.shopifyCustomerId, currency: s.currency, lines,
    tags: [SETTLEMENT_TAG, `${SETTLEMENT_TAG}:${s.id}`], note: `Consignment settlement, ${outlet.name}, ${period}`,
  });
  await d
    .update(settlements)
    .set({ status: "invoiced", draftOrderId: draft.id, payUrl: draft.invoiceUrl, invoicedAt: new Date(), problem: null })
    .where(eq(settlements.id, s.id));
  const bank = config().WHOLESALE_BANK_DETAILS.replace(/\\n/g, "\n");
  await notify(wholesaler, `settlement:${s.id}`, `Truecolors settlement for ${outlet.name}: ${showMoney(s.amount, s.currency)}`, [
    `For ${period}: ${s.reportedUnits + s.missingUnits} shirts at ${showMoney(s.unitPrice, s.currency)} each.` +
      (s.missingUnits ? ` That includes ${s.missingUnits} not found at our stock count.` : ""),
    `Pay by card: ${draft.invoiceUrl}`,
    ...(bank ? [`Or by bank transfer, quoting ${draft.name}:\n${bank}`] : []),
  ]);
}

// Designers of location designs earn on what each paid settlement covers: shirts reported sold and shirts
// missing at a count, at the partner price.
async function settlementRoyalties(s: Settlement) {
  if (!s.unitPrice) return;
  const d = await db();
  const reports = await d.select().from(salesReports).where(eq(salesReports.settlementId, s.id));
  const counts = await d.select().from(stockCounts).where(eq(stockCounts.settlementId, s.id));
  const bySku = new Map<string, number>();
  for (const l of reports.flatMap((r) => r.lines)) bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + l.quantity);
  for (const l of counts.flatMap((c) => c.lines)) bySku.set(l.sku, (bySku.get(l.sku) ?? 0) + Math.max(0, l.expected - l.quantity));
  const { recordLocationRoyalties, royaltyHold } = await import("./designs");
  await recordLocationRoyalties({
    source: `settlement:${s.id}`, currency: s.currency, payableAfter: royaltyHold(new Date()),
    lines: [...bySku].map(([sku, quantity]) => ({ sku, quantity, unit: s.unitPrice! })),
  });
}

// A bank transfer against a settlement has landed.
export async function markSettlementPaid(settlementId: string) {
  const d = await db();
  const [s] = await d.select().from(settlements).where(eq(settlements.id, settlementId));
  if (s?.status !== "invoiced" || !s.draftOrderId) throw new UserError("That settlement hasn't been invoiced.");
  await wholesaleOps().completeDraftAsPending(s.draftOrderId, false);
  const [paid] = await d.update(settlements).set({ status: "paid", paidAt: new Date() }).where(eq(settlements.id, s.id)).returning();
  await settlementRoyalties(paid);
}

// Shopify's orders/create webhook: a settlement invoice paid by card.
export async function recordSettlementPayment(payload: OrderPayload) {
  const id = payload.tags?.split(",").map((t) => t.trim()).find((t) => t.startsWith(`${SETTLEMENT_TAG}:`))?.slice(SETTLEMENT_TAG.length + 1);
  if (!id || payload.financial_status !== "paid") return;
  const d = await db();
  const [paid] = await d
    .update(settlements)
    .set({ status: "paid", paidAt: new Date() })
    .where(and(eq(settlements.id, id), eq(settlements.status, "invoiced")))
    .returning();
  if (paid) await settlementRoyalties(paid);
}

// ---- What partners and the team see ---------------------------------------------------------------------

export async function outletSummary(outletId: string, now = new Date()) {
  const { outlet, wholesaler } = await load(outletId);
  const d = await db();
  const reports = await d
    .select()
    .from(salesReports)
    .where(and(eq(salesReports.outletId, outlet.id), eq(salesReports.status, "confirmed"), isNull(salesReports.settlementId)));
  const recent = await d.select().from(settlements).where(eq(settlements.outletId, outlet.id)).orderBy(desc(settlements.periodEnd)).limit(5);
  const openRestock = await d
    .select()
    .from(restocks)
    .where(and(eq(restocks.outletId, outlet.id), inArray(restocks.status, ["requested", "approved"])));
  const price = PARTNER_PRICE[wholesaler.currency];
  const sold = reports.reduce((s, r) => s + r.units, 0);
  return {
    outlet,
    periodEnds: periodEnd(outlet),
    overdue: Boolean(outlet.overdueSince) || now >= periodEnd(outlet),
    restocksPaused: Boolean(outlet.overdueSince),
    soldThisPeriod: sold,
    owedSoFar: price === undefined ? undefined : (price * sold).toFixed(2),
    currency: wholesaler.currency,
    settlements: recent,
    openRestock: openRestock[0],
  };
}

export async function consignmentQueue() {
  const d = await db();
  const named = { outlet: outlets, wholesaler: wholesalers };
  return {
    restocks: await d
      .select({ r: restocks, ...named })
      .from(restocks)
      .innerJoin(outlets, eq(outlets.id, restocks.outletId))
      .innerJoin(wholesalers, eq(wholesalers.id, outlets.wholesalerId))
      .where(inArray(restocks.status, ["requested", "approved"]))
      .orderBy(desc(restocks.createdAt)),
    settlements: await d
      .select({ s: settlements, ...named })
      .from(settlements)
      .innerJoin(outlets, eq(outlets.id, settlements.outletId))
      .innerJoin(wholesalers, eq(wholesalers.id, outlets.wholesalerId))
      .where(inArray(settlements.status, ["review", "invoiced"]))
      .orderBy(desc(settlements.createdAt)),
    overdue: await d
      .select(named)
      .from(outlets)
      .innerJoin(wholesalers, eq(wholesalers.id, outlets.wholesalerId))
      .where(isNotNull(outlets.overdueSince)),
  };
}
