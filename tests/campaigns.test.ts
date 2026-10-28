import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  campaignStats, recordFulfillment, recordOrder, recordRefund, reviewCampaign, submitCampaign, tick,
} from "../src/lib/campaigns/service";
import { resetConfig } from "../src/lib/config";
import { db } from "../src/lib/db/client";
import { campaigns, pledges, royaltyEntries } from "../src/lib/db/schema";
import { designerEarnings, preparePayouts } from "../src/lib/royalties/ledger";
import { fakeShopify, freshDb, order, readyDesigner, type FakeShopify } from "./helpers";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const start = new Date("2026-11-01T10:00:00Z");
const at = (ms: number) => new Date(start.getTime() + ms);

let shop: FakeShopify;

async function liveCampaign() {
  const { user, design } = await readyDesigner();
  const c = await submitCampaign(user.id, design.id, { title: "Marina Sunset", story: "From my balcony" });
  await reviewCampaign("kevin@probablyfine.ae", c.id, true, "", start);
  const d = await db();
  const [live] = await d.select().from(campaigns).where(eq(campaigns.id, c.id));
  return { user, c: live };
}

async function secondCampaign() {
  const { user, design } = await readyDesigner("omar");
  const c = await submitCampaign(user.id, design.id, { title: "Desert Rose", story: "" });
  await reviewCampaign("kevin@probablyfine.ae", c.id, true, "", start);
  return statusOf(c.id);
}

async function statusOf(id: string) {
  const d = await db();
  return (await d.select().from(campaigns).where(eq(campaigns.id, id)))[0];
}

beforeEach(async () => {
  await freshDb();
  shop = fakeShopify();
});

describe("campaign lifecycle", () => {
  it("goes live on approval with a 21-day window and the agreed goal", async () => {
    const { c } = await liveCampaign();
    expect(c.status).toBe("live");
    expect(c.goal).toBe(100);
    expect(c.endsAt!.getTime() - start.getTime()).toBe(21 * DAY);
    expect(c.shopifyProductId).toBe(`p-${c.designCode}`);
  });

  it("charges nobody until pledges reach the goal", async () => {
    const { c } = await liveCampaign();
    for (let i = 0; i < 9; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await tick(at(DAY));
    expect(shop.charges).toHaveLength(0);
    expect(await campaignStats(c.id)).toEqual({ pledged: 90, charged: 0 });
  });

  it("charges every pledge once the goal is reached, then later pledges too", async () => {
    const { c } = await liveCampaign();
    for (let i = 0; i < 10; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await tick(at(DAY));
    expect(shop.charges).toHaveLength(10);
    // Single-campaign orders are charged their whole balance.
    expect(shop.charges.every((ch) => ch.amountCents === undefined)).toBe(true);
    expect((await statusOf(c.id)).fundedAt).toEqual(at(DAY));

    await recordOrder(order(c.shopifyProductId!, 2));
    await tick(at(2 * DAY));
    expect(shop.charges).toHaveLength(11);
    expect(await campaignStats(c.id)).toEqual({ pledged: 102, charged: 102 });
  });

  it("closes as funded at the deadline", async () => {
    const { c } = await liveCampaign();
    for (let i = 0; i < 10; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await tick(at(DAY));
    await tick(at(21 * DAY));
    expect((await statusOf(c.id)).status).toBe("funded");
  });

  it("cancels every order and charges nobody when the goal is missed", async () => {
    const { c } = await liveCampaign();
    for (let i = 0; i < 4; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await tick(at(21 * DAY));
    expect((await statusOf(c.id)).status).toBe("missed");
    expect(shop.charges).toHaveLength(0);
    expect(shop.cancelled).toHaveLength(4);
  });

  it("retries a failed card for 3 days, then cancels it", async () => {
    const { c } = await liveCampaign();
    const bad = order(c.shopifyProductId!, 1);
    shop.failOrders.add(String(bad.id));
    for (let i = 0; i < 10; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await recordOrder(bad);

    await tick(at(DAY));
    await tick(at(DAY + 12 * HOUR));
    await tick(at(DAY + 24 * HOUR));
    const badCharges = shop.charges.filter((ch) => ch.orderId === String(bad.id));
    expect(badCharges.length).toBe(3);

    await tick(at(DAY + 72 * HOUR));
    expect(shop.cancelled).toContain(String(bad.id));
    expect(await campaignStats(c.id)).toEqual({ pledged: 100, charged: 100 });
  });

  it("misses and refunds if failed cards drop it under the goal by the deadline", async () => {
    const { c } = await liveCampaign();
    const orders = Array.from({ length: 10 }, () => order(c.shopifyProductId!, 10));
    shop.failOrders.add(String(orders[0].id));
    for (const o of orders) await recordOrder(o);

    await tick(at(20 * DAY));
    await tick(at(21 * DAY));
    // Still retrying the failed card at the deadline, so the campaign waits.
    expect((await statusOf(c.id)).status).toBe("closing");
    await tick(at(23 * DAY));
    const after = await statusOf(c.id);
    expect(after.status).toBe("missed");
    // All 10 orders cancelled: 9 charged ones refunded through cancellation, 1 that never paid.
    expect(new Set(shop.cancelled).size).toBe(10);
  });

  it("charges a campaign order that also holds in-stock items its whole remaining balance", async () => {
    const { c } = await liveCampaign();
    for (let i = 0; i < 9; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await recordOrder(order(c.shopifyProductId!, 10, { extraLine: true }));
    await tick(at(DAY));
    expect(shop.charges).toHaveLength(10);
    expect(shop.charges.every((ch) => ch.amountCents === undefined)).toBe(true);
  });

  it("on Shopify Plus, charges only the campaign's lines on a shared order", async () => {
    process.env.SHOPIFY_PLUS = "true";
    resetConfig();
    try {
      const { c } = await liveCampaign();
      for (let i = 0; i < 9; i++) await recordOrder(order(c.shopifyProductId!, 10));
      await recordOrder(order(c.shopifyProductId!, 10, { extraLine: true }));
      await tick(at(DAY));
      // 10 x $36 plus $28.80 tax on those lines.
      expect(shop.charges.find((ch) => ch.amountCents !== undefined)?.amountCents).toBe(36_000 + 2_880);
    } finally {
      delete process.env.SHOPIFY_PLUS;
      resetConfig();
    }
  });

  it("without Plus, waits to charge an order with two designs until both reach their goal", async () => {
    const { c } = await liveCampaign();
    const other = await secondCampaign();
    const shared = order(c.shopifyProductId!, 10, { alsoProduct: other.shopifyProductId! });
    await recordOrder(shared);
    for (let i = 0; i < 9; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await tick(at(DAY));
    expect(shop.charges.map((ch) => ch.orderId)).not.toContain(String(shared.id));

    for (let i = 0; i < 99; i++) await recordOrder(order(other.shopifyProductId!, 1));
    await tick(at(2 * DAY));
    const sharedCharges = shop.charges.filter((ch) => ch.orderId === String(shared.id));
    expect(sharedCharges).toEqual([{ orderId: String(shared.id), amountCents: undefined }]);
    expect(await campaignStats(c.id)).toEqual({ pledged: 100, charged: 100 });
    expect(await campaignStats(other.id)).toEqual({ pledged: 100, charged: 100 });
  });
});

describe("royalties", () => {
  async function fundedWith(ref?: string) {
    const { user, c } = await liveCampaign();
    const first = order(c.shopifyProductId!, 10, { ref });
    await recordOrder(first);
    for (let i = 0; i < 9; i++) await recordOrder(order(c.shopifyProductId!, 10));
    await tick(at(DAY));
    return { user, c, first };
  }

  it("pays 10% of net sales, and 15% on sales through the designer's link", async () => {
    const { user } = await fundedWith("maya");
    const e = await designerEarnings(user.id);
    // 9 orders x $360 x 10% + 1 order x $360 x 15%
    expect(e.earned).toBe(9 * 3_600 + 5_400);
  });

  it("holds earnings until the return window closes after shipping", async () => {
    const { user, first } = await fundedWith();
    const d = await db();
    const [p] = await d.select().from(pledges).where(eq(pledges.shopifyOrderId, String(first.id)));
    await recordFulfillment({ id: 1, order_id: first.id, created_at: at(30 * DAY).toISOString(), line_items: [{ id: Number(p.lineItemId) }] });

    expect(await preparePayouts(at(40 * DAY))).toHaveLength(0);
    const made = await preparePayouts(at(45 * DAY));
    expect(made).toHaveLength(1);
    expect(made[0].totalCents).toBe(3_600);
    expect((await designerEarnings(user.id)).history).toHaveLength(1);
  });

  it("claws back the share on a refund, once even if the webhook repeats", async () => {
    const { user, first } = await fundedWith();
    const d = await db();
    const [p] = await d.select().from(pledges).where(eq(pledges.shopifyOrderId, String(first.id)));
    const refund = { id: 77, order_id: first.id, refund_line_items: [{ line_item_id: Number(p.lineItemId), quantity: 10, subtotal: "360.00" }] };
    await recordRefund(refund);
    await recordRefund(refund);
    const clawbacks = await d.select().from(royaltyEntries).where(eq(royaltyEntries.kind, "clawback"));
    expect(clawbacks).toHaveLength(1);
    expect(clawbacks[0].amountCents).toBe(-3_600);
    expect((await designerEarnings(user.id)).earned).toBe(9 * 3_600);
  });
});

describe("launch rules", () => {
  it("blocks a third open campaign", async () => {
    const { user, design } = await readyDesigner();
    await submitCampaign(user.id, design.id, { title: "One", story: "" });
    await submitCampaign(user.id, design.id, { title: "Two", story: "" });
    await expect(submitCampaign(user.id, design.id, { title: "Three", story: "" })).rejects.toThrow(/2 campaigns/);
  });

  it("ignores duplicate order webhooks", async () => {
    const { c } = await liveCampaign();
    const o = order(c.shopifyProductId!, 5);
    await recordOrder(o);
    await recordOrder(o);
    expect((await campaignStats(c.id)).pledged).toBe(5);
  });
});
