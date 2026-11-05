import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { recordOrder, reviewCampaign, submitCampaign } = await import("../src/lib/campaigns/service");
const { db } = await import("../src/lib/db/client");
const { campaigns } = await import("../src/lib/db/schema");
const { resetConfig } = await import("../src/lib/config");
const { fanFromBackedLink } = await import("../src/lib/fans");
const { signSessionToken, verifySessionToken } = await import("../src/lib/shopify/session-token");
const { GET, OPTIONS } = await import("../src/app/api/checkout/backer/route");
const { fakeShopify, freshDb, order, readyDesigner } = await import("./helpers");

const SECRET = "proxy-app-secret";
const SHOP = "cjfxb1-ex.myshopify.com";
const now = () => Math.floor(Date.now() / 1000);
const token = (claims: object = {}, secret = SECRET) =>
  signSessionToken({ dest: SHOP, aud: "client-id", exp: now() + 60, nbf: now() - 1, ...claims }, secret);

async function liveCampaign() {
  const { user, design } = await readyDesigner();
  const c = await submitCampaign(user.id, design.id, { title: "Marina Sunset", story: "" });
  await reviewCampaign("kevin@probablyfine.ae", c.id, true, "", new Date());
  const d = await db();
  return (await d.select().from(campaigns).where(eq(campaigns.id, c.id)))[0];
}

const ask = (query: Record<string, string>, auth: string | null = token()) =>
  GET(new Request(`https://app.truecolors.global/api/checkout/backer?${new URLSearchParams(query)}`, {
    headers: auth ? { Authorization: `Bearer ${auth}` } : {},
  }));

beforeEach(async () => {
  process.env.SHOPIFY_PROXY_SECRET = SECRET;
  process.env.SHOPIFY_STORE_DOMAIN = SHOP;
  resetConfig();
  await freshDb();
  fakeShopify();
});

describe("checkout session tokens", () => {
  it("accepts the shop's token signed with the app's secret, and nothing else", () => {
    expect(verifySessionToken(token(), SECRET, SHOP)?.aud).toBe("client-id");
    expect(verifySessionToken(token({ dest: `https://${SHOP}` }), SECRET, SHOP)).toBeTruthy();
    expect(verifySessionToken(token({}, "another-secret"), SECRET, SHOP)).toBeUndefined();
    expect(verifySessionToken(token({ dest: "other.myshopify.com" }), SECRET, SHOP)).toBeUndefined();
    expect(verifySessionToken(token({ exp: now() - 60 }), SECRET, SHOP)).toBeUndefined();
    expect(verifySessionToken(token({ nbf: now() + 60 }), SECRET, SHOP)).toBeUndefined();
    expect(verifySessionToken("not.a.token", SECRET, SHOP)).toBeUndefined();
    expect(verifySessionToken(undefined, SECRET, SHOP)).toBeUndefined();
  });
});

describe("GET /api/checkout/backer", () => {
  it("refuses a request without a valid session token", async () => {
    expect((await ask({ order: "gid://shopify/Order/1" }, null)).status).toBe(401);
    expect((await ask({ order: "gid://shopify/Order/1" }, token({}, "wrong"))).status).toBe(401);
  });

  it("answers the browser's preflight from the extension's origin", async () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("gives a UAE backer their numbers and their own link back to the design in the store", async () => {
    const c = await liveCampaign();
    await recordOrder(order(c.shopifyProductId!, 1, { market: "AE" }));
    const mine = order(c.shopifyProductId!, 2, { market: "AE", email: "sara@example.com" });
    await recordOrder(mine);

    const res = await ask({ order: `gid://shopify/OrderIdentity/${mine.id}` });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    const body = await res.json();
    expect(body.pending).toBe(false);
    expect(body.backings).toHaveLength(1);
    const [b] = body.backings;
    expect(b).toMatchObject({ slug: c.slug, title: "Marina Sunset", numbers: [2, 3] });
    expect(b.url).toMatch(new RegExp(`^https://www\\.truecolors\\.global/apps/truecolors/c/${c.slug}\\?backed=`));
    // The link is the same sealed backer link the welcome email carries.
    const fan = await fanFromBackedLink(new URL(b.url).searchParams.get("backed") ?? undefined);
    expect(fan?.email).toBe("sara@example.com");
  });

  it("links a USA backer to the design in the /en-us store", async () => {
    const c = await liveCampaign();
    const mine = order(c.shopifyProductId!, 1, { market: "US" });
    await recordOrder(mine);
    const body = await (await ask({ order: `gid://shopify/Order/${mine.id}` })).json();
    expect(body.backings[0].numbers).toEqual([1]);
    expect(body.backings[0].url).toContain(`https://www.truecolors.global/en-us/apps/truecolors/c/${c.slug}?backed=`);
  });

  it("says pending while a pre-order's webhook hasn't arrived, and nothing for other orders", async () => {
    const c = await liveCampaign();
    const waiting = await (await ask({ order: "gid://shopify/OrderIdentity/424242", products: `gid://shopify/Product/${c.shopifyProductId},gid://shopify/Product/999` })).json();
    expect(waiting).toEqual({ backings: [], pending: true });
    const other = await (await ask({ order: "gid://shopify/OrderIdentity/434343", products: "gid://shopify/Product/999" })).json();
    expect(other).toEqual({ backings: [], pending: false });
  });

  it("rejects a request without an order", async () => {
    expect((await ask({})).status).toBe(400);
  });
});
