import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { batches, campaigns, designs, pledges } from "../db/schema";
import { UserError } from "../design/service";
import { SIZES, sku } from "../rules";
import { fileUrl } from "../storage";

// Funded designs go to Cancún and on to the Las Vegas 3PL together, so freight and receiving
// costs are shared across a batch of a few hundred shirts.

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

export async function markBatch(batchId: string, status: "sent" | "received") {
  const d = await db();
  await d.update(batches).set({ status }).where(eq(batches.id, batchId));
  if (status === "received") {
    await d.update(campaigns).set({ status: "shipped" }).where(eq(campaigns.batchId, batchId));
  }
}

export async function batchLines(batchId: string) {
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
    .where(eq(campaigns.batchId, batchId))
    .groupBy(campaigns.id, campaigns.title, campaigns.designCode, designs.printLineKey, designs.printColourKey, pledges.size);
  return rows.sort((a, b) => a.code.localeCompare(b.code) || SIZES.indexOf(a.size as never) - SIZES.indexOf(b.size as never));
}

const csv = (rows: (string | number)[][]) =>
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

// Receiving list for the Las Vegas 3PL. Columns follow a generic SKU/quantity layout; map them to the
// 3PL's own receiving template once we have it.
export async function inboundCsv(batchId: string) {
  const lines = await batchLines(batchId);
  return csv([
    ["SKU", "Product name", "Quantity", "Barcode (Code 128)"],
    ...lines.map((l) => {
      const code = sku(l.code, l.size as never);
      return [code, `${l.title} UV Color-Change Tee - ${l.size}`, l.qty, code];
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
