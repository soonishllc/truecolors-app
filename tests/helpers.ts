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
  charges: { orderId: string; amountCents?: number; currency?: string }[];
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
    chargeOrder: async (orderId, _key, amount) => {
      fake.charges.push({ orderId, amountCents: amount?.cents, currency: amount?.currency });
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

// As Shopify sends it: amounts in the shop's currency (AED), plus the customer's own in `*_set.presentment_money`.
// A USA order pays $36 a shirt (AED 132.21 at the shop's rate) and $2.88 tax; a UAE order pays AED 129 and AED 6.45 VAT.
const MARKET_PRICES = {
  US: { currency: "USD", shirt: 36, tax: 2.88, rate: 3.6725 },
  AE: { currency: "AED", shirt: 129, tax: 6.45, rate: 1 },
} as const;

export function order(
  productId: string,
  qty: number,
  opts: { ref?: string; size?: string; extraLine?: boolean; alsoProduct?: string; email?: string; city?: string; market?: "US" | "AE" } = {},
): OrderPayload {
  const id = orderSeq++;
  const m = MARKET_PRICES[opts.market ?? "US"];
  const money = (paid: number) => ({ shop: (paid * m.rate).toFixed(2), set: { presentment_money: { amount: paid.toFixed(2) } } });
  const line = (lineId: number, product: string | number, size: string, quantity: number, taxed: boolean) => {
    const price = money(m.shirt);
    const tax = money(quantity * m.tax);
    return {
      id: lineId, product_id: Number.isNaN(Number(product)) ? (product as unknown as number) : Number(product),
      variant_title: size, quantity, price: price.shop, price_set: price.set, total_discount: "0.00",
      tax_lines: taxed ? [{ price: tax.shop, price_set: tax.set }] : [],
    };
  };
  const lines = [line(id * 10, productId, opts.size ?? "M", qty, true)];
  if (opts.extraLine) lines.push(line(id * 10 + 1, 999, "L", 1, false));
  if (opts.alsoProduct) lines.push(line(id * 10 + 2, opts.alsoProduct, "S", 1, false));
  return {
    id, name: `#${id}`, currency: "AED", presentment_currency: m.currency, line_items: lines,
    note_attributes: opts.ref ? [{ name: "tc_ref", value: opts.ref }] : [],
    email: opts.email ?? `backer${id}@example.com`,
    shipping_address: { city: opts.city ?? "Austin" },
  };
}
