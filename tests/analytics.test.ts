import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
}));

const { anonId, fromQuery, funnelReport, track, trackOrder, trackView } = await import("../src/lib/analytics");
const { submitCampaign, reviewCampaign } = await import("../src/lib/campaigns/service");
const { db } = await import("../src/lib/db/client");
const { campaigns, events } = await import("../src/lib/db/schema");
const { withUtm } = await import("../src/lib/share");
const { fakeShopify, freshDb, order, readyDesigner } = await import("./helpers");

async function liveCampaign() {
  const { user, design } = await readyDesigner("maya");
  const c = await submitCampaign(user.id, design.id, { title: "Marina Sunset", story: "" });
  await reviewCampaign("kevin@probablyfine.ae", c.id, true, "", new Date());
  const d = await db();
  return { user, c: (await d.select().from(campaigns).where(eq(campaigns.id, c.id)))[0] };
}

const all = async () => (await db()).select().from(events);

beforeEach(async () => {
  await freshDb();
  fakeShopify();
  jar.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("track", () => {
  it("records an event with its fields", async () => {
    await track("explore_viewed", { path: "/explore", ref: "maya", utmSource: "whatsapp", anonId: "a1", props: { show: "live" } });
    const [e] = await all();
    expect(e).toMatchObject({ name: "explore_viewed", path: "/explore", ref: "maya", utmSource: "whatsapp", anonId: "a1", props: { show: "live" } });
  });

  it("never throws, even when the insert fails", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(track("campaign_viewed", { campaignId: "not-a-uuid" })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    expect(await all()).toHaveLength(0);
    err.mockRestore();
  });

  it("sends the same event to PostHog when POSTHOG_KEY is set", async () => {
    vi.stubEnv("POSTHOG_KEY", "phc_test");
    vi.stubEnv("POSTHOG_HOST", "https://eu.i.posthog.com/");
    const fetch = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetch);
    await track("designer_joined", { anonId: "a1", props: { via: "email" } });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://eu.i.posthog.com/i/v0/e/");
    expect(JSON.parse(String(init.body))).toMatchObject({ api_key: "phc_test", event: "designer_joined", distinct_id: "a1", properties: { via: "email" } });
  });

  it("doesn't call PostHog without a key", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await track("designer_joined");
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("page views", () => {
  it("reads ref and utm_* from the query", () => {
    expect(fromQuery({ ref: " Maya ", utm_source: "WhatsApp", utm_medium: "share", utm_campaign: ["marina", "x"] }))
      .toEqual({ ref: "maya", utmSource: "whatsapp", utmMedium: "share", utmCampaign: "marina" });
  });

  it("keeps one anonymous id per visitor", async () => {
    const first = await anonId();
    expect(first).toBeTruthy();
    expect(await anonId()).toBe(first);
    await trackView("campaign_viewed", { ref: "maya", utm_source: "x" }, { path: "/c/marina" });
    expect((await all())[0]).toMatchObject({ anonId: first, ref: "maya", utmSource: "x", path: "/c/marina" });
  });
});

describe("pre-orders", () => {
  it("tracks a campaign order once, with its ref and landing-page utm", async () => {
    const { c } = await liveCampaign();
    const o = { ...order(c.shopifyProductId!, 2, { ref: "maya" }), landing_site: "/products/x?utm_source=whatsapp&utm_medium=share" };
    await trackOrder(o);
    await trackOrder(o); // Shopify retry
    const rows = (await all()).filter((e) => e.name === "preorder_placed");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ campaignId: c.id, ref: "maya", utmSource: "whatsapp", utmMedium: "share", props: { quantity: 2 } });
  });

  it("ignores orders with no campaign in them", async () => {
    await trackOrder(order("12345", 1));
    expect(await all()).toHaveLength(0);
  });
});

describe("funnel report", () => {
  it("counts each step and ranks refs and sources by pre-orders", async () => {
    const { c } = await liveCampaign();
    await track("designer_joined");
    await track("design_drawn");
    for (const ref of ["maya", "maya", "f-abc"]) await track("campaign_viewed", { campaignId: c.id, ref, utmSource: "whatsapp" });
    await track("campaign_viewed", { campaignId: c.id, utmSource: "x" });
    await trackOrder(order(c.shopifyProductId!, 1, { ref: "maya" }));
    const r = await funnelReport(30);
    expect(r.steps.find((s) => s.name === "designer_joined")?.count).toBe(1);
    expect(r.steps.find((s) => s.name === "campaign_viewed")?.count).toBe(4);
    expect(r.steps.find((s) => s.name === "preorder_placed")?.count).toBe(1);
    expect(r.refs[0]).toEqual({ key: "maya", views: 2, preorders: 1 });
    expect(r.sources.map((s) => s.key)).toEqual(["whatsapp", "x"]);
  });
});

describe("share links", () => {
  it("adds utm for the channel and campaign, keeping ref", () => {
    const u = new URL(withUtm("https://www.truecolors.global/apps/truecolors/c/marina-sunset?ref=f-abc", "whatsapp"));
    expect(Object.fromEntries(u.searchParams)).toEqual({ ref: "f-abc", utm_source: "whatsapp", utm_medium: "share", utm_campaign: "marina-sunset" });
    expect(new URL(withUtm("https://x.test/challenges/summer", "x")).searchParams.has("utm_campaign")).toBe(false);
  });
});
