import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { batches, campaigns, designs, pledges, type QuiqupCarton, type QuiqupInbound } from "../db/schema";
import { UserError } from "../design/service";
import { SIZES, sku, type Size } from "../rules";
import { fileUrl } from "../storage";

// Funded designs are made in Cancún and go on to the 3PLs together, so freight and receiving costs are shared
// across a batch of a few hundred shirts. Each pre-order goes to the 3PL of the store it was bought in, told
// apart by the currency the backer paid: ShipBob in Las Vegas for the USA store (USD), Quiqup in Dubai for the
// UAE store (AED).

export const DESTINATIONS = {
  las_vegas: { place: "Las Vegas", tpl: "ShipBob", received: "Received in Las Vegas" },
  quiqup: { place: "Dubai", tpl: "Quiqup", received: "Received at Quiqup" },
} as const;
export type Destination = keyof typeof DESTINATIONS;

export const destinationOf = (currency: string): Destination => (currency === "AED" ? "quiqup" : "las_vegas");
const forDestination = (dest: Destination) => (dest === "quiqup" ? eq(pledges.currency, "AED") : ne(pledges.currency, "AED"));
const receivedColumn = { las_vegas: "lasVegasReceivedAt", quiqup: "quiqupReceivedAt" } as const;

export async function unbatchedFunded() {
  const d = await db();
  return d.select().from(campaigns).where(and(eq(campaigns.status, "funded"), isNull(campaigns.batchId)));
}

export async function createBatch(campaignIds: string[], note: string) {
  if (!campaignIds.length) throw new UserError("Pick at least one funded campaign.");
  const d = await db();
  const picked = await d
    .select()
    .from(campaigns)
    .where(and(inArray(campaigns.id, campaignIds), eq(campaigns.status, "funded"), isNull(campaigns.batchId)));
  if (picked.length !== campaignIds.length) throw new UserError("Some campaigns are not funded or are already batched.");
  const [b] = await d.insert(batches).values({ note }).returning();
  await d.update(campaigns).set({ batchId: b.id, status: "in_production" }).where(inArray(campaigns.id, campaignIds));
  return b;
}

// Which 3PLs each campaign in the batch ships to.
async function campaignDestinations(batchId: string) {
  const d = await db();
  const rows = await d
    .selectDistinct({ campaignId: pledges.campaignId, currency: pledges.currency })
    .from(pledges)
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .where(and(eq(campaigns.batchId, batchId), eq(pledges.status, "charged")));
  const by = new Map<string, Set<Destination>>();
  for (const r of rows) by.set(r.campaignId, (by.get(r.campaignId) ?? new Set()).add(destinationOf(r.currency)));
  return by;
}

export async function batchDestinations(batchId: string): Promise<Destination[]> {
  const all = new Set([...(await campaignDestinations(batchId)).values()].flatMap((s) => [...s]));
  return (Object.keys(DESTINATIONS) as Destination[]).filter((dest) => all.has(dest));
}

// "sent" when the batch goes to Cancún; then each 3PL is marked as it receives its share. A campaign has
// shipped once every 3PL it needs has received it, and the batch is done once they all have.
export async function markBatch(batchId: string, step: "sent" | Destination, now = new Date()) {
  const d = await db();
  if (step === "sent") {
    await d.update(batches).set({ status: "sent" }).where(eq(batches.id, batchId));
    return;
  }
  const byCampaign = await campaignDestinations(batchId);
  const needed = await batchDestinations(batchId);
  if (!needed.includes(step)) throw new UserError(`Nothing in this batch ships to ${DESTINATIONS[step].place}.`);
  const [b] = await d.update(batches).set({ [receivedColumn[step]]: now }).where(eq(batches.id, batchId)).returning();
  const received = (dest: Destination) => Boolean(b[receivedColumn[dest]]);
  const shipped = [...byCampaign].filter(([, dests]) => [...dests].every(received)).map(([id]) => id);
  if (shipped.length) await d.update(campaigns).set({ status: "shipped" }).where(inArray(campaigns.id, shipped));
  if (needed.every(received)) await d.update(batches).set({ status: "received" }).where(eq(batches.id, batchId));
}

// One row per SKU: every pre-order in the batch, or just those going to one 3PL.
export async function batchLines(batchId: string, dest?: Destination) {
  const d = await db();
  const rows = await d
    .select({
      campaignId: campaigns.id,
      title: campaigns.title,
      code: campaigns.designCode,
      printLineKey: designs.printLineKey,
      printColourKey: designs.printColourKey,
      size: pledges.size,
      qty: sql<number>`sum(${pledges.quantity})::int`,
    })
    .from(campaigns)
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .innerJoin(pledges, and(eq(pledges.campaignId, campaigns.id), eq(pledges.status, "charged")))
    .where(and(eq(campaigns.batchId, batchId), dest && forDestination(dest)))
    .groupBy(campaigns.id, campaigns.title, campaigns.designCode, designs.printLineKey, designs.printColourKey, pledges.size);
  return rows.sort((a, b) => a.code.localeCompare(b.code) || SIZES.indexOf(a.size as never) - SIZES.indexOf(b.size as never));
}

export const csv = (rows: (string | number)[][]) =>
  rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",")).join("\n") + "\n";

// What Cancún prints: one row per SKU, with links to both print layers.
export async function workOrderCsv(batchId: string) {
  const base = config().APP_URL;
  const lines = await batchLines(batchId);
  return csv([
    ["SKU", "Design", "Size", "Quantity", "Line art file (black)", "Colour file (SolarShift)"],
    ...lines.map((l) => [
      sku(l.code, l.size as never), l.title, l.size, l.qty,
      `${base}${fileUrl(l.printLineKey!)}`, `${base}${fileUrl(l.printColourKey!)}`,
    ]),
  ]);
}

export const itemName = (title: string, size: string) => `${title} UV Color-Change Tee - ${size}`;

// Receiving list for ShipBob in Las Vegas: the USA store's pre-orders. Columns follow a generic SKU/quantity
// layout; map them to ShipBob's own receiving template once we have it.
export async function lasVegasInboundCsv(batchId: string) {
  const lines = await batchLines(batchId, "las_vegas");
  return csv([
    ["SKU", "Product name", "Quantity", "Barcode (Code 128)"],
    ...lines.map((l) => {
      const code = sku(l.code, l.size as Size);
      return [code, itemName(l.title, l.size), l.qty, code];
    }),
  ]);
}

// Every shirt's edition number, for the numbered tag or card that goes in with it.
export async function editionsCsv(batchId: string) {
  const d = await db();
  const rows = await d
    .select({ p: pledges, c: campaigns })
    .from(pledges)
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .where(and(eq(campaigns.batchId, batchId), eq(pledges.status, "charged")))
    .orderBy(campaigns.designCode, pledges.editionStart);
  return csv([
    ["Order", "SKU", "Design", "Size", "Edition number", "Edition size"],
    ...rows.flatMap(({ p, c }) =>
      Array.from({ length: p.quantity }, (_, i) => [
        p.orderName, sku(c.designCode, p.size as never), c.title, p.size,
        p.editionStart ? `#${p.editionStart + i}` : "", c.editionSize ?? "",
      ]),
    ),
  ]);
}
