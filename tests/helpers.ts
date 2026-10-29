import { openPglite, useDb } from "../src/lib/db/client";
import { designs, media, users } from "../src/lib/db/schema";
import { useShopify, type ShopifyOps } from "../src/lib/campaigns/shopify-ops";
import type { OrderPayload } from "../src/lib/shopify/webhooks";

export async function freshDb() {
  const d = openPglite();
  useDb(d);
  return d;
}

export type FakeShopify = ShopifyOps & {
  charges: { orderId: string; amountCents?: number }[];
  rewardCodes: string[];
  cancelled: string[];
  failOrders: Set<string>;
};

export function fakeShopify(): FakeShopify {
  const fake: FakeShopify = {
    charges: [],
    rewardCodes: [],
    cancelled: [],
    failOrders: new Set(),
    createCampaignProduct: async (input) => ({
      productId: `p-${input.designCode}`,
      handle: input.designCode.toLowerCase(),
      variantIds: { S: "v1", M: "v2", L: "v3", XL: "v4" },
      sellingPlanGroupId: "spg-1",
    }),
    chargeOrder: async (orderId, _key, amountCents) => {
      fake.charges.push({ orderId, amountCents });
      return fake.failOrders.has(orderId) ? { ok: false, error: "Card declined" } : { ok: true, reference: `ref-${orderId}` };
    },
    cancelOrder: async (orderId) => {
      fake.cancelled.push(orderId);
    },
    createRewardCode: async (code) => {
      fake.rewardCodes.push(code);
    },
  };
  useShopify(fake);
  return fake;
}

// A designer with a finished, print-ready design and a reveal video, ready to launch.
export async function readyDesigner(handle = "maya") {
  const d = await (await import("../src/lib/db/client")).db();
  const [user] = await d
    .insert(users)
    .values({ email: `${handle}@example.com`, name: handle, handle, credits: 10, agreementVersion: "v1", agreementAcceptedAt: new Date() })
    .returning();
  const [design] = await d
    .insert(designs)
    .values({
      userId: user.id, title: "Marina Sunset", preset: "skyline", prompt: "marina", lineArtKey: "a.png",
      compositeKey: "b.png", printLineKey: "c.png", printColourKey: "d.png",
      printReport: { ok: true, colours: 5, maxColours: 7, widthPx: 4200, heightPx: 4200, problems: [] },
    })
    .returning();
  await d.insert(media).values({ designId: design.id, kind: "video", template: "reveal", view: "reveal", key: "v.mp4" });
  return { user, design };
}

let orderSeq = 1000;

export function order(
  productId: string,
  qty: number,
  opts: { ref?: string; size?: string; extraLine?: boolean; alsoProduct?: string; email?: string; city?: string } = {},
): OrderPayload {
  const id = orderSeq++;
  const lines = [
    {
      id: id * 10, product_id: Number.isNaN(Number(productId)) ? (productId as unknown as number) : Number(productId),
      variant_title: opts.size ?? "M", quantity: qty, price: "36.00", total_discount: "0.00",
      tax_lines: [{ price: (qty * 2.88).toFixed(2) }],
    },
  ];
  if (opts.extraLine) {
    lines.push({ id: id * 10 + 1, product_id: 999 as number, variant_title: "L", quantity: 1, price: "36.00", total_discount: "0.00", tax_lines: [] });
  }
  if (opts.alsoProduct) {
    lines.push({ id: id * 10 + 2, product_id: opts.alsoProduct as unknown as number, variant_title: "S", quantity: 1, price: "36.00", total_discount: "0.00", tax_lines: [] });
  }
  return {
    id, name: `#${id}`, currency: "USD", line_items: lines,
    note_attributes: opts.ref ? [{ name: "tc_ref", value: opts.ref }] : [],
    email: opts.email ?? `backer${id}@example.com`,
    shipping_address: { city: opts.city ?? "Austin" },
  };
}
