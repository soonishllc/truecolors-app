import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { recordOrder, reviewCampaign, submitCampaign, tick } from "../src/lib/campaigns/service";
import { db } from "../src/lib/db/client";
import { batches, campaigns } from "../src/lib/db/schema";
import {
  batchDestinations, batchLines, createBatch, lasVegasInboundCsv, markBatch, workOrderCsv,
} from "../src/lib/production/batch";
import {
  quiqupInvoiceHtml, quiqupPackingListCsv, quiqupProductImportCsv, quiqupReview, saveQuiqupInbound,
} from "../src/lib/production/quiqup";
import { sku } from "../src/lib/rules";
import { fakeShopify, freshDb, order, readyDesigner } from "./helpers";

const DAY = 24 * 3600_000;
const start = new Date("2026-11-01T10:00:00Z");
const at = (ms: number) => new Date(start.getTime() + ms);

async function campaign(handle: string, title: string) {
  const { user, design } = await readyDesigner(handle);
  const c = await submitCampaign(user.id, design.id, { title, story: "" });
  await reviewCampaign("kevin@probablyfine.ae", c.id, true, "", start);
  return statusOf(c.id);
}

async function statusOf(id: string) {
  const d = await db();
  return (await d.select().from(campaigns).where(eq(campaigns.id, id)))[0];
}

const rows = (csv: string) => csv.trim().split("\n").slice(1).map((r) => r.split(","));

// Marina Sunset sells in both stores; Desert Rose only in the USA.
async function mixedBatch() {
  const marina = await campaign("maya", "Marina Sunset");
  const rose = await campaign("omar", "Desert Rose");
  const pid = (c: typeof marina) => c.shopifyProductId!;
  for (let i = 0; i < 3; i++) await recordOrder(order(pid(marina), 10, { market: "US", size: "M" }));
  for (let i = 0; i < 2; i++) await recordOrder(order(pid(marina), 10, { market: "US", size: "L" }));
  for (let i = 0; i < 4; i++) await recordOrder(order(pid(marina), 10, { market: "AE", size: "M" }));
  await recordOrder(order(pid(marina), 10, { market: "AE", size: "S" }));
  for (let i = 0; i < 10; i++) await recordOrder(order(pid(rose), 10, { market: "US", size: "S" }));
  await tick(at(DAY));
  await tick(at(21 * DAY));
  const batch = await createBatch([marina.id, rose.id], "November run");
  return { marina, rose, batch };
}

beforeEach(async () => {
  await freshDb();
  fakeShopify();
});

describe("production batches split by store", () => {
  it("sends USD pre-orders to Las Vegas and AED pre-orders to Quiqup, SKU by SKU", async () => {
    const { marina, rose, batch } = await mixedBatch();
    expect(await batchDestinations(batch.id)).toEqual(["las_vegas", "quiqup"]);

    const count = async (dest: "las_vegas" | "quiqup") =>
      Object.fromEntries((await batchLines(batch.id, dest)).map((l) => [sku(l.code, l.size as never), l.qty]));
    expect(await count("las_vegas")).toEqual({
      [sku(marina.designCode, "M")]: 30, [sku(marina.designCode, "L")]: 20, [sku(rose.designCode, "S")]: 100,
    });
    expect(await count("quiqup")).toEqual({ [sku(marina.designCode, "S")]: 10, [sku(marina.designCode, "M")]: 40 });

    // Cancún still prints the whole batch in one run.
    expect(rows(await workOrderCsv(batch.id)).map((r) => [r[0], Number(r[3])])).toEqual(expect.arrayContaining([
      [sku(marina.designCode, "M"), 70], [sku(marina.designCode, "S"), 10], [sku(marina.designCode, "L"), 20], [sku(rose.designCode, "S"), 100],
    ]));
    expect(rows(await lasVegasInboundCsv(batch.id)).map((r) => [r[0], Number(r[2])])).toEqual(expect.arrayContaining([
      [sku(marina.designCode, "M"), 30], [sku(marina.designCode, "L"), 20], [sku(rose.designCode, "S"), 100],
    ]));
    expect(rows(await lasVegasInboundCsv(batch.id))).toHaveLength(3);
    expect(rows(await quiqupProductImportCsv(batch.id)).map((r) => [r[0], r[1], Number(r[3]), Number(r[4])])).toEqual([
      [sku(marina.designCode, "S"), sku(marina.designCode, "S"), 10, 200],
      [sku(marina.designCode, "M"), sku(marina.designCode, "M"), 40, 200],
    ]);
  });

  it("tracks each 3PL's receipt and ships a campaign once every 3PL it needs has it", async () => {
    const { marina, rose, batch } = await mixedBatch();
    await markBatch(batch.id, "sent");
    await markBatch(batch.id, "las_vegas", at(30 * DAY));
    expect((await statusOf(rose.id)).status).toBe("shipped");
    expect((await statusOf(marina.id)).status).toBe("in_production");
    const d = await db();
    const lookup = async () => (await d.select().from(batches).where(eq(batches.id, batch.id)))[0];
    expect(await lookup()).toMatchObject({ status: "sent", lasVegasReceivedAt: at(30 * DAY), quiqupReceivedAt: null });

    await markBatch(batch.id, "quiqup", at(31 * DAY));
    expect((await statusOf(marina.id)).status).toBe("shipped");
    expect(await lookup()).toMatchObject({ status: "received", quiqupReceivedAt: at(31 * DAY) });
  });

  it("builds Quiqup's packing list and invoice from the packed cartons and flags what Quiqup must hear about", async () => {
    const { marina, rose, batch } = await mixedBatch();
    const S = sku(marina.designCode, "S");
    const M = sku(marina.designCode, "M");
    await expect(quiqupPackingListCsv(batch.id)).rejects.toThrow(/cartons/);

    const input = {
      invoiceNo: "TC-INB-008", consignor: "True Colors Trading LLC", consignorAddress: "Deira, Dubai",
      unitValue: "3.50", arrivesAt: "2026-11-25T09:00",
    };
    await expect(saveQuiqupInbound(batch.id, { ...input, cartons: `#BOX 1 | 49x49x34 | 12 | ${sku(rose.designCode, "S")}=10` }))
      .rejects.toThrow(/isn't one of this batch's UAE SKUs/);

    // Two small shirts were held back as damaged.
    await saveQuiqupInbound(batch.id, { ...input, cartons: `#BOX 1 | 49x49x34 | 12.5 | ${M}=30, ${S}=8\n#BOX 2 | 40x40x20 | 2.1 | ${M}=10` });
    expect(rows(await quiqupPackingListCsv(batch.id))).toEqual([
      ["Quiqup", "#001", S, S, "Marina Sunset UV Color-Change Tee - S", "8", "#BOX 1", "49", "49", "34", "12.5"],
      ["Quiqup", "#001", M, M, "Marina Sunset UV Color-Change Tee - M", "30", "#BOX 1", "49", "49", "34", ""],
      ["Quiqup", "#001", M, M, "Marina Sunset UV Color-Change Tee - M", "10", "#BOX 2", "40", "40", "20", "2.1"],
    ]);
    expect(rows(await quiqupProductImportCsv(batch.id)).map((r) => [r[0], Number(r[3])])).toEqual([[S, 8], [M, 40]]);

    expect(await quiqupReview(batch.id)).toMatchObject({
      shirts: 48, kg: 14.6, mixedBoxes: ["#BOX 1"], splitSkus: [M],
      differences: [{ sku: S, ordered: 10, packed: 8 }],
      deadline: new Date("2026-11-23T05:00:00Z"),
    });

    const invoice = await quiqupInvoiceHtml(batch.id);
    expect(invoice).toContain("TC-INB-008");
    expect(invoice).toContain("Quiqup Delivery LLC");
    expect(invoice).toContain("6109.10");
    expect(invoice).toMatch(/48 units<\/td><td><\/td><td class="num">USD 168\.00/);
  });
});
