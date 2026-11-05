import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { db } from "./db/client";
import { campaigns, events } from "./db/schema";
import { refCode, type OrderPayload } from "./shopify/webhooks";

// First-party analytics. Every funnel step lands in the `events` table; if POSTHOG_KEY is set the same event is also
// sent to PostHog (POSTHOG_HOST, default https://us.i.posthog.com) from the server. Tracking never breaks a request.

// The funnel, in order. Designers: join → draw → colour → media → send for review. Shoppers: explore → campaign → pre-order.
export const FUNNEL = [
  { name: "designer_joined", label: "Designer signed up" },
  { name: "design_drawn", label: "Design drawn" },
  { name: "design_coloured", label: "Design coloured" },
  { name: "media_made", label: "Media made" },
  { name: "sent_for_review", label: "Sent for review" },
  { name: "explore_viewed", label: "Explore viewed" },
  { name: "campaign_viewed", label: "Campaign page viewed" },
  { name: "preorder_placed", label: "Pre-order placed" },
] as const;

export type EventName = (typeof FUNNEL)[number]["name"];

export type TrackData = {
  path?: string;
  ref?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  campaignId?: string;
  userId?: string;
  anonId?: string;
  props?: Record<string, unknown>;
};

export const ANON_COOKIE = "tc_anon";

const clip = (v: unknown, n = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : undefined);

// The visitor's anonymous id: read from its cookie, or a new one, saved where the request allows setting cookies
// (server actions and route handlers; a page render can only read them). Undefined outside a request.
export async function anonId(): Promise<string | undefined> {
  try {
    const jar = await cookies();
    const have = jar.get(ANON_COOKIE)?.value;
    if (have) return have;
    const id = randomUUID();
    try {
      jar.set(ANON_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 365 * 86_400 });
    } catch {
      // Rendering a page: cookies are read-only here. The id still groups this one event.
    }
    return id;
  } catch {
    return undefined;
  }
}

// ref and utm_* from a page's searchParams.
export function fromQuery(q: Record<string, string | string[] | undefined>): Pick<TrackData, "ref" | "utmSource" | "utmMedium" | "utmCampaign"> {
  const one = (k: string) => clip(Array.isArray(q[k]) ? q[k][0] : q[k], 80)?.toLowerCase();
  return { ref: one("ref"), utmSource: one("utm_source"), utmMedium: one("utm_medium"), utmCampaign: one("utm_campaign") };
}

// Records one event. Never throws: a failure is logged and swallowed.
export async function track(name: EventName, data: TrackData = {}): Promise<void> {
  try {
    const row = {
      name,
      path: clip(data.path, 300),
      ref: clip(data.ref, 80),
      utmSource: clip(data.utmSource, 80),
      utmMedium: clip(data.utmMedium, 80),
      utmCampaign: clip(data.utmCampaign, 120),
      campaignId: data.campaignId,
      userId: data.userId,
      anonId: clip(data.anonId, 80),
      props: data.props ?? {},
    };
    await (await db()).insert(events).values(row);
    toPostHog(row);
  } catch (e) {
    console.error(`[analytics] ${name} not recorded:`, e);
  }
}

// A page view: ref and utm_* from the query, plus the visitor's anonymous id.
export async function trackView(name: EventName, q: Record<string, string | string[] | undefined>, data: TrackData = {}) {
  try {
    await track(name, { ...fromQuery(q), anonId: await anonId(), ...data });
  } catch (e) {
    console.error(`[analytics] ${name} not recorded:`, e);
  }
}

// One pre-order event per campaign in a Shopify order, with whose link (tc_ref) and which utm_* it came through.
// Safe to repeat: Shopify retries webhooks, so an order already tracked is skipped.
export async function trackOrder(order: OrderPayload): Promise<void> {
  try {
    const ids = [...new Set(order.line_items.map((l) => l.product_id).filter(Boolean).map(String))];
    if (!ids.length) return;
    const d = await db();
    const found = await d.select({ id: campaigns.id, productId: campaigns.shopifyProductId, slug: campaigns.slug })
      .from(campaigns).where(inArray(campaigns.shopifyProductId, ids));
    if (!found.length) return;
    const orderId = String(order.id);
    const seen = await d.select({ id: events.id }).from(events)
      .where(and(eq(events.name, "preorder_placed"), sql`${events.props}->>'orderId' = ${orderId}`)).limit(1);
    if (seen.length) return;
    const utm = orderUtm(order);
    for (const c of found) {
      const quantity = order.line_items.filter((l) => String(l.product_id) === c.productId).reduce((s, l) => s + l.quantity, 0);
      await track("preorder_placed", {
        ...utm, ref: refCode(order), campaignId: c.id, path: `/c/${c.slug}`, props: { orderId, orderName: order.name, quantity },
      });
    }
  } catch (e) {
    console.error("[analytics] preorder_placed not recorded:", e);
  }
}

// utm_* from the cart attributes if the store set them, else from the order's landing page.
function orderUtm(order: OrderPayload): Pick<TrackData, "utmSource" | "utmMedium" | "utmCampaign"> {
  const attr = (k: string) => order.note_attributes?.find((a) => a.name === k)?.value;
  let landing: URLSearchParams | undefined;
  try {
    const site = (order as { landing_site?: string | null }).landing_site;
    if (site) landing = new URL(site, "https://x.invalid").searchParams;
  } catch {
    // A malformed landing URL just means no utm.
  }
  const get = (k: string) => clip(attr(k) ?? landing?.get(k) ?? undefined, 80)?.toLowerCase();
  return { utmSource: get("utm_source"), utmMedium: get("utm_medium"), utmCampaign: get("utm_campaign") };
}

type Row = Omit<TrackData, "props"> & { name: string; props: Record<string, unknown> };

// Fire-and-forget to PostHog's capture API when POSTHOG_KEY is set.
function toPostHog(row: Row) {
  const key = process.env.POSTHOG_KEY;
  if (!key) return;
  const host = (process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
  const body = {
    api_key: key,
    event: row.name,
    distinct_id: row.userId ?? row.anonId ?? `server-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    properties: {
      ...row.props,
      $current_url: row.path, ref: row.ref, utm_source: row.utmSource, utm_medium: row.utmMedium, utm_campaign: row.utmCampaign,
      campaign_id: row.campaignId, ...(row.userId || row.anonId ? {} : { $process_person_profile: false }),
    },
  };
  fetch(`${host}/i/v0/e/`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000),
  }).catch((e) => console.error("[analytics] PostHog send failed:", e));
}

// Last-N-days counts per funnel step, and which links and sources the views and pre-orders came through.
export async function funnelReport(days = 30) {
  const d = await db();
  const since = new Date(Date.now() - days * 86_400_000);
  const recent = gte(events.createdAt, since);
  const counts = await d.select({ name: events.name, n: sql<number>`count(*)::int` }).from(events).where(recent).groupBy(events.name);
  const byName = new Map(counts.map((c) => [c.name, c.n]));
  const steps = FUNNEL.map((s) => ({ ...s, count: byName.get(s.name) ?? 0 }));

  const preorders = sql<number>`count(*) filter (where ${events.name} = 'preorder_placed')::int`;
  const views = sql<number>`count(*) filter (where ${events.name} = 'campaign_viewed')::int`;
  const shopper = and(recent, inArray(events.name, ["campaign_viewed", "preorder_placed"]));
  const refs = await d.select({ key: events.ref, views, preorders }).from(events)
    .where(and(shopper, sql`${events.ref} is not null`)).groupBy(events.ref).orderBy(sql`3 desc, 2 desc`).limit(10);
  const sources = await d.select({ key: events.utmSource, views, preorders }).from(events)
    .where(and(shopper, sql`${events.utmSource} is not null`)).groupBy(events.utmSource).orderBy(sql`3 desc, 2 desc`).limit(10);
  return { days, steps, refs, sources };
}
