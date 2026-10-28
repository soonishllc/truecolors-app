import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { campaigns, designs, media, pledges, royaltyEntries, users, type CampaignStatus } from "../db/schema";
import { UserError } from "../design/service";
import {
  CAMPAIGN_DAYS, CHARGE_RETRY_EVERY_HOURS, CHARGE_RETRY_HOURS, CURRENCY, FUNDING_GOAL, MARKET,
  MAX_LIVE_CAMPAIGNS_PER_DESIGNER, PAYOUT_BUFFER_DAYS, PRICE_CENTS, RELAUNCHES_ALLOWED, RETURN_WINDOW_DAYS,
  SIZES, STRETCH_GOALS, royaltyCents, shareBps,
} from "../rules";
import { fileUrl } from "../storage";
import {
  lineNetCents, lineTaxCents, refCode, cents,
  type FulfillmentPayload, type OrderPayload, type RefundPayload,
} from "../shopify/webhooks";
import { shopify } from "./shopify-ops";

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const OPEN: CampaignStatus[] = ["in_review", "live", "closing"];
// Pledges that still count toward the goal.
const COUNTING = ["pledged", "charged", "charge_failed"] as const;

const slugify = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "design";

async function uniqueCode(title: string): Promise<{ slug: string; code: string }> {
  const d = await db();
  const base = slugify(title);
  const letters = base.replace(/[^a-z]/g, "").toUpperCase().slice(0, 5) || "TC";
  for (let n = 0; n < 50; n++) {
    const slug = n ? `${base}-${n + 1}` : base;
    const code = n ? `${letters}${n + 1}` : letters;
    const clash = await d
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(sql`${campaigns.slug} = ${slug} or ${campaigns.designCode} = ${code}`);
    if (!clash.length) return { slug, code };
  }
  throw new Error("Could not find a free campaign code");
}

export async function submitCampaign(userId: string, designId: string, input: { title: string; story: string }) {
  const d = await db();
  const [user] = await d.select().from(users).where(eq(users.id, userId));
  const [design] = await d.select().from(designs).where(and(eq(designs.id, designId), eq(designs.userId, userId)));
  if (!design) throw new UserError("Design not found.");
  if (!design.printReport?.ok) throw new UserError("Fix the print check problems before launching.");
  const hasVideo = await d.select({ id: media.id }).from(media).where(and(eq(media.designId, designId), eq(media.kind, "video")));
  if (!hasVideo.length) throw new UserError("Make the mockups and reveal video before launching.");
  if (!user.agreementAcceptedAt) throw new UserError("Accept the designer agreement first.");

  const open = await d
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(and(eq(campaigns.userId, userId), inArray(campaigns.status, OPEN)));
  if (open.length >= MAX_LIVE_CAMPAIGNS_PER_DESIGNER) {
    throw new UserError(`You can have ${MAX_LIVE_CAMPAIGNS_PER_DESIGNER} campaigns open at a time.`);
  }

  const { slug, code } = await uniqueCode(input.title);
  const [c] = await d
    .insert(campaigns)
    .values({
      slug, designCode: code, designId, userId, title: input.title, story: input.story, market: MARKET,
      status: "in_review", goal: FUNDING_GOAL, stretchGoals: STRETCH_GOALS, priceCents: PRICE_CENTS, currency: CURRENCY,
    })
    .returning();
  return c;
}

export async function relaunchCampaign(userId: string, campaignId: string) {
  const d = await db();
  const [c] = await d.select().from(campaigns).where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)));
  if (!c || c.status !== "missed") throw new UserError("Only a campaign that missed its goal can be relaunched.");
  const root = c.relaunchOf ?? c.id;
  const earlier = await d.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.relaunchOf, root));
  if (earlier.length >= RELAUNCHES_ALLOWED) throw new UserError("This design has already been relaunched.");
  const next = await submitCampaign(userId, c.designId, { title: c.title, story: c.story });
  await d.update(campaigns).set({ relaunchOf: root }).where(eq(campaigns.id, next.id));
  return next;
}

export async function reviewCampaign(reviewer: string, campaignId: string, approve: boolean, note: string, now = new Date()) {
  const d = await db();
  const [c] = await d.select().from(campaigns).where(eq(campaigns.id, campaignId));
  if (!c || c.status !== "in_review") throw new UserError("This campaign is not waiting for review.");
  const reviewed = { reviewNote: note, reviewedBy: reviewer, reviewedAt: now };
  if (!approve) {
    await d.update(campaigns).set({ ...reviewed, status: "rejected" }).where(eq(campaigns.id, c.id));
    return;
  }

  const agreement = config().DESIGNER_AGREEMENT_VERSION;
  if (!agreement) throw new UserError("The designer agreement isn't final yet, so no campaign can go live.");
  const [designer] = await d.select().from(users).where(eq(users.id, c.userId));
  if (designer.agreementVersion !== agreement) {
    throw new UserError("The designer hasn't accepted the current designer agreement.");
  }

  const [design] = await d.select().from(designs).where(eq(designs.id, c.designId));
  const images = await d
    .select()
    .from(media)
    .where(and(eq(media.designId, c.designId), eq(media.kind, "mockup")));
  const endsAt = new Date(now.getTime() + CAMPAIGN_DAYS * DAY);
  const appUrl = config().APP_URL;
  const product = await shopify().createCampaignProduct({
    campaignId: c.id,
    title: c.title,
    descriptionHtml:
      `<p>${escapeHtml(c.story)}</p><p>Designed by ${escapeHtml(designer.name)}. ` +
      `Pre-order: you're only charged if this design reaches ${c.goal} pre-orders by ${endsAt.toDateString()}.</p>`,
    designCode: c.designCode,
    designerName: designer.handle,
    priceCents: c.priceCents,
    endsAt,
    imageUrls: [design.compositeKey!, ...images.map((m) => m.key)].map((k) => `${appUrl}${fileUrl(k)}`),
  });
  await d
    .update(campaigns)
    .set({
      ...reviewed, status: "live", startsAt: now, endsAt,
      shopifyProductId: product.productId, shopifyHandle: product.handle,
      variantIds: product.variantIds, sellingPlanGroupId: product.sellingPlanGroupId,
    })
    .where(eq(campaigns.id, c.id));
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}

export async function campaignStats(campaignId: string) {
  const d = await db();
  const [row] = await d
    .select({
      pledged: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.status} in ('pledged','charged','charge_failed')), 0)::int`,
      charged: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.status} = 'charged'), 0)::int`,
    })
    .from(pledges)
    .where(eq(pledges.campaignId, campaignId));
  return row;
}

// ---- Shopify webhooks ------------------------------------------------------------------------------

export async function recordOrder(order: OrderPayload) {
  const d = await db();
  const productIds = [...new Set(order.line_items.map((l) => l.product_id).filter(Boolean).map(String))];
  if (!productIds.length) return;
  const found = await d
    .select({ c: campaigns, handle: users.handle })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .where(inArray(campaigns.shopifyProductId, productIds));
  if (!found.length) return;

  const byProduct = new Map(found.map((f) => [f.c.shopifyProductId!, f]));
  const campaignLines = order.line_items.filter((l) => byProduct.has(String(l.product_id)));
  const campaignsInOrder = new Set(campaignLines.map((l) => String(l.product_id)));
  const sharedOrder = campaignLines.length < order.line_items.length || campaignsInOrder.size > 1;
  const ref = refCode(order);

  for (const line of campaignLines) {
    const { c, handle } = byProduct.get(String(line.product_id))!;
    const accepting = c.status === "live";
    const size = SIZES.find((s) => line.variant_title?.toUpperCase().split(/[\s/]+/).includes(s)) ?? line.variant_title ?? "?";
    await d
      .insert(pledges)
      .values({
        campaignId: c.id,
        shopifyOrderId: String(order.id),
        orderName: order.name,
        lineItemId: String(line.id),
        size,
        quantity: line.quantity,
        netCents: lineNetCents(line),
        taxCents: lineTaxCents(line),
        viaDesignerLink: ref === handle.toLowerCase(),
        sharedOrder,
        status: accepting ? "pledged" : "cancelled",
        needsAttention: accepting ? null : `Order arrived after the campaign stopped taking pre-orders (${c.status}); cancel this line by hand.`,
      })
      .onConflictDoNothing();
  }
}

export async function recordCancelledOrder(order: OrderPayload) {
  const d = await db();
  await d
    .update(pledges)
    .set({ status: "cancelled", nextChargeAt: null })
    .where(and(eq(pledges.shopifyOrderId, String(order.id)), inArray(pledges.status, ["pledged", "charge_failed"])));
}

export async function recordRefund(refund: RefundPayload) {
  const d = await db();
  for (const item of refund.refund_line_items) {
    const [p] = await d
      .select()
      .from(pledges)
      .where(and(eq(pledges.shopifyOrderId, String(refund.order_id)), eq(pledges.lineItemId, String(item.line_item_id))));
    if (!p) continue;
    const [earning] = await d
      .select()
      .from(royaltyEntries)
      .where(and(eq(royaltyEntries.pledgeId, p.id), eq(royaltyEntries.kind, "earning")));
    if (earning) {
      const base = Math.min(cents(item.subtotal), p.netCents);
      await d
        .insert(royaltyEntries)
        .values({
          userId: earning.userId, campaignId: p.campaignId, pledgeId: p.id, kind: "clawback",
          sourceRef: `refund:${refund.id}:${item.line_item_id}`, rateBps: earning.rateBps, baseCents: base,
          amountCents: -royaltyCents(base, earning.rateBps), currency: earning.currency,
          // A clawback is netted against the next payout straight away.
          payableAfter: new Date(0),
        })
        .onConflictDoNothing();
    }
    if (item.quantity >= p.quantity) {
      await d.update(pledges).set({ status: "refunded", nextChargeAt: null }).where(eq(pledges.id, p.id));
    }
  }
}

export async function recordFulfillment(f: FulfillmentPayload) {
  const d = await db();
  const at = new Date(f.created_at);
  const lineIds = f.line_items.map((l) => String(l.id));
  if (!lineIds.length) return;
  const shipped = await d
    .update(pledges)
    .set({ fulfilledAt: at })
    .where(and(eq(pledges.shopifyOrderId, String(f.order_id)), inArray(pledges.lineItemId, lineIds)))
    .returning({ id: pledges.id });
  if (!shipped.length) return;
  await d
    .update(royaltyEntries)
    .set({ payableAfter: new Date(at.getTime() + (RETURN_WINDOW_DAYS + PAYOUT_BUFFER_DAYS) * DAY) })
    .where(
      and(
        inArray(royaltyEntries.pledgeId, shipped.map((s) => s.id)),
        eq(royaltyEntries.kind, "earning"),
        isNull(royaltyEntries.payableAfter),
      ),
    );
}

// ---- Charging and closing, run by the cron tick ----------------------------------------------------

type Pledge = typeof pledges.$inferSelect;
type Campaign = typeof campaigns.$inferSelect;

type Item = { p: Pledge; c: Campaign };

// Charges the saved card on one order for the given pledges and records the designer's share for each.
async function chargePledges(items: Item[], amountCents: number | undefined, now: Date) {
  const d = await db();
  const first = items[0].p;
  const attempt = Math.max(...items.map((x) => x.p.chargeAttempts)) + 1;
  const key = `${first.shopifyOrderId}:${[...new Set(items.map((x) => x.c.id))].sort().join("+")}:${attempt}`;
  const result = await shopify().chargeOrder(first.shopifyOrderId, key, amountCents);
  const ids = items.map((x) => x.p.id);
  const firstChargeAt = first.firstChargeAt ?? now;

  if (!result.ok) {
    await d
      .update(pledges)
      .set({
        status: "charge_failed", chargeAttempts: attempt, firstChargeAt, lastChargeError: result.error,
        nextChargeAt: new Date(now.getTime() + CHARGE_RETRY_EVERY_HOURS * HOUR),
      })
      .where(inArray(pledges.id, ids));
    return false;
  }

  await d
    .update(pledges)
    .set({ status: "charged", chargeAttempts: attempt, firstChargeAt, chargedAt: now, nextChargeAt: null, lastChargeError: null })
    .where(inArray(pledges.id, ids));
  await d
    .insert(royaltyEntries)
    .values(
      items.map(({ p, c }) => {
        const rateBps = shareBps(p.viaDesignerLink);
        return {
          userId: c.userId, campaignId: c.id, pledgeId: p.id, kind: "earning" as const, sourceRef: "earning",
          rateBps, baseCents: p.netCents, amountCents: royaltyCents(p.netCents, rateBps), currency: c.currency,
        };
      }),
    )
    .onConflictDoNothing();
  return true;
}

async function reachedGoal(c: Campaign) {
  return Boolean(c.fundedAt) || (await campaignStats(c.id)).pledged >= c.goal;
}

// Charges this campaign's pledges on one order. Single-campaign orders are charged their whole balance.
// An order shared with other products is charged only its campaign lines on Shopify Plus; without Plus,
// Shopify can only take the whole balance, so it waits until every pre-order on it has reached its goal.
async function chargeOrderPledges(c: Campaign, orderPledges: Pledge[], now: Date, log: TickLog) {
  const first = orderPledges[0];
  if (!first.sharedOrder) {
    await chargePledges(orderPledges.map((p) => ({ p, c })), undefined, now);
    log.push(`${c.slug}: charged ${first.orderName}`);
    return;
  }
  if (config().SHOPIFY_PLUS) {
    const amount = orderPledges.reduce((s, p) => s + p.netCents + p.taxCents, 0);
    await chargePledges(orderPledges.map((p) => ({ p, c })), amount, now);
    log.push(`${c.slug}: charged ${c.slug} lines on ${first.orderName}`);
    return;
  }

  const d = await db();
  const outstanding = await d
    .select({ p: pledges, c: campaigns })
    .from(pledges)
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .where(and(eq(pledges.shopifyOrderId, first.shopifyOrderId), inArray(pledges.status, ["pledged", "charge_failed"])));
  // A line a person still has to remove would be charged with the balance, so wait for them.
  if (outstanding.some((x) => x.p.needsAttention)) return;
  for (const x of outstanding) {
    if (x.c.id === c.id) continue;
    if (!["live", "closing"].includes(x.c.status) || !(await reachedGoal(x.c))) return;
  }
  const ok = await chargePledges(outstanding, undefined, now);
  if (ok) {
    await d
      .update(pledges)
      .set({ needsAttention: "Shared order charged in full: check the balance matched the funded designs." })
      .where(inArray(pledges.id, outstanding.map((x) => x.p.id)));
  }
  log.push(`${c.slug}: charged ${first.orderName} in full with ${outstanding.length} lines`);
}

// Cancels the order behind these pledges, refunding anything charged. Shared orders are left to a person.
async function cancelPledges(orderPledges: Pledge[], reason: string) {
  const d = await db();
  const first = orderPledges[0];
  const ids = orderPledges.map((p) => p.id);
  if (first.sharedOrder) {
    await d
      .update(pledges)
      .set({ status: "cancelled", nextChargeAt: null, needsAttention: `${reason} Shared order: cancel or refund these lines by hand.` })
      .where(inArray(pledges.id, ids));
    return;
  }
  await shopify().cancelOrder(first.shopifyOrderId, reason);
  for (const p of orderPledges) {
    // Charged lines become "refunded" when Shopify's refund webhook arrives; that also claws back the royalty.
    if (p.status !== "charged") {
      await d.update(pledges).set({ status: "cancelled", nextChargeAt: null }).where(eq(pledges.id, p.id));
    }
  }
}

function byOrder(list: Pledge[]): Pledge[][] {
  const m = new Map<string, Pledge[]>();
  for (const p of list) m.set(p.shopifyOrderId, [...(m.get(p.shopifyOrderId) ?? []), p]);
  return [...m.values()];
}

export type TickLog = string[];

export async function tickCampaign(c: Campaign, now: Date, log: TickLog) {
  const d = await db();
  const load = () =>
    d.select().from(pledges).where(and(eq(pledges.campaignId, c.id), inArray(pledges.status, [...COUNTING])));

  let list = await load();
  const pledged = () => list.reduce((s, p) => s + p.quantity, 0);
  const charged = () => list.filter((p) => p.status === "charged").reduce((s, p) => s + p.quantity, 0);

  // Retries that ran out: cancel those orders so they stop counting.
  const expired = list.filter(
    (p) => p.status === "charge_failed" && p.firstChargeAt && now.getTime() - p.firstChargeAt.getTime() >= CHARGE_RETRY_HOURS * HOUR,
  );
  for (const group of byOrder(expired)) {
    await cancelPledges(group, `Card could not be charged after ${CHARGE_RETRY_HOURS / 24} days.`);
    log.push(`${c.slug}: cancelled ${group[0].orderName}, card failed`);
  }
  if (expired.length) list = await load();

  // Once pledges reach the goal, every pledge is charged, including ones that arrive later.
  if (c.fundedAt || pledged() >= c.goal) {
    const due = list.filter(
      (p) => p.status === "pledged" || (p.status === "charge_failed" && p.nextChargeAt && p.nextChargeAt <= now),
    );
    for (const group of byOrder(due)) await chargeOrderPledges(c, group, now, log);
    if (due.length) list = await load();
    if (!c.fundedAt && charged() >= c.goal) {
      await d.update(campaigns).set({ fundedAt: now }).where(eq(campaigns.id, c.id));
      c = { ...c, fundedAt: now };
      log.push(`${c.slug}: funded with ${charged()} charged`);
    }
  }

  if (c.status === "live" && c.endsAt && now >= c.endsAt) {
    await d.update(campaigns).set({ status: "closing" }).where(eq(campaigns.id, c.id));
    c = { ...c, status: "closing" };
  }
  if (c.status !== "closing") return;

  const retrying = list.some((p) => p.status === "charge_failed");
  if (pledged() < c.goal) {
    // Missed, either at the deadline or after failed cards dropped it under the goal: nobody pays.
    for (const group of byOrder(list)) await cancelPledges(group, "The design didn't reach its pre-order goal.");
    await d.update(campaigns).set({ status: "missed", closedAt: now }).where(eq(campaigns.id, c.id));
    log.push(`${c.slug}: missed with ${pledged()} of ${c.goal}`);
  } else if (!retrying && charged() >= c.goal) {
    await d.update(campaigns).set({ status: "funded", closedAt: now, fundedAt: c.fundedAt ?? now }).where(eq(campaigns.id, c.id));
    log.push(`${c.slug}: closed funded with ${charged()}`);
  }
}

export async function tick(now = new Date()): Promise<TickLog> {
  const d = await db();
  const log: TickLog = [];
  const active = await d.select().from(campaigns).where(inArray(campaigns.status, ["live", "closing"]));
  for (const c of active) {
    try {
      await tickCampaign(c, now, log);
    } catch (e) {
      log.push(`${c.slug}: error ${(e as Error).message}`);
    }
  }
  return log;
}

export async function needsAttention() {
  const d = await db();
  return d
    .select({ p: pledges, slug: campaigns.slug })
    .from(pledges)
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .where(sql`${pledges.needsAttention} is not null`);
}

export async function clearAttention(pledgeId: string) {
  const d = await db();
  await d.update(pledges).set({ needsAttention: null }).where(eq(pledges.id, pledgeId));
}

