import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { seal, unseal } from "./auth/session";
import { shopify } from "./campaigns/shopify-ops";
import { config } from "./config";
import { db } from "./db/client";
import {
  campaigns, challengeEntries, challenges, designs, fanRewards, fans, friendCodes, pledges, users, votes, waitlist,
} from "./db/schema";
import { UserError } from "./design/service";
import { sendEmail } from "./email";
import { PREORDER_PRICE, PRICE_CENTS, REFERRALS_PER_REWARD, friendCode } from "./rules";
import { publicUrl, safePath, storefront } from "./links";
import { throttleEmail } from "./ratelimit";

// Fans have no passwords: they confirm their email once from a link, and a cookie remembers them for a year.

const FAN_COOKIE = "tc_fan";
const YEAR_MINUTES = 365 * 24 * 60;

const cleanEmail = (email: string) => {
  const e = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new UserError("Enter a valid email address.");
  return e;
};

export async function ensureFan(emailInput: string) {
  const email = cleanEmail(emailInput);
  const d = await db();
  const [found] = await d.select().from(fans).where(eq(fans.email, email));
  if (found) return found;
  const [fan] = await d
    .insert(fans)
    .values({ email, referralCode: `f-${randomBytes(4).toString("hex")}` })
    .onConflictDoNothing()
    .returning();
  return fan ?? (await d.select().from(fans).where(eq(fans.email, email)))[0];
}

// Emails a link that confirms the address and brings them back to `next`, joining the waitlist `join` on the way
// if given (the token is sealed, so it can't be swapped). Returns the link in dev.
export async function sendFanLink(emailInput: string, next: string, why: string, join?: string): Promise<string | undefined> {
  const fan = await ensureFan(emailInput);
  const link = `${config().APP_URL}/fan/verify?token=${seal({ fanId: fan.id, next: safePath(next, "/me"), join }, 24 * 60)}`;
  await sendEmail({
    to: fan.email,
    subject: "Confirm your email for Truecolors",
    body: `Tap to confirm your email and ${why}:\n${link}\n\nThe link works for 24 hours. If you didn't ask for this, ignore it.`,
  });
  return config().DEV_SHOW_LOGIN_LINKS ? link : undefined;
}

export async function verifyFan(token: string): Promise<string | undefined> {
  const t = unseal<{ fanId: string; next: string; join?: string }>(token);
  if (!t) return;
  const d = await db();
  await d.update(fans).set({ verifiedAt: new Date() }).where(and(eq(fans.id, t.fanId), isNull(fans.verifiedAt)));
  if (t.join && WAITLIST_TARGET.test(t.join)) {
    const [fan] = await d.select().from(fans).where(eq(fans.id, t.fanId));
    if (fan) await joinWaitlist(fan.email, t.join);
  }
  (await cookies()).set(FAN_COOKIE, seal({ fanId: t.fanId }, YEAR_MINUTES), {
    httpOnly: true, sameSite: "lax", secure: config().APP_URL.startsWith("https"), path: "/", maxAge: YEAR_MINUTES * 60,
  });
  return t.next;
}

export async function currentFan() {
  const t = unseal<{ fanId: string }>((await cookies()).get(FAN_COOKIE)?.value);
  if (!t) return;
  const d = await db();
  const [fan] = await d.select().from(fans).where(eq(fans.id, t.fanId));
  return fan?.verifiedAt ? fan : undefined;
}

// The backer arriving from their post-checkout email (?backed=<token>): who they are, without a cookie, which a
// store page's frame may not keep.
export async function fanFromBackedLink(token: string | undefined) {
  const t = unseal<{ fanId: string }>(token);
  if (!t) return;
  const d = await db();
  const [fan] = await d.select().from(fans).where(eq(fans.id, t.fanId));
  return fan;
}

// A backer's edition numbers on a campaign: shirts are numbered in the order they were pre-ordered.
export const backerNumbers = (campaignId: string, email: string) =>
  editionNumbers(campaignId, (r) => r.email === email);

async function editionNumbers(campaignId: string, mine: (r: { email: string | null; orderId: string }) => boolean) {
  const d = await db();
  const rows = await d
    .select({ email: pledges.email, orderId: pledges.shopifyOrderId, quantity: pledges.quantity })
    .from(pledges)
    .where(and(eq(pledges.campaignId, campaignId), inArray(pledges.status, ["pledged", "charge_pending", "charged", "charge_failed"])))
    .orderBy(pledges.createdAt);
  const numbers: number[] = [];
  let n = 0;
  for (const r of rows) {
    for (let i = 0; i < r.quantity; i++) {
      n++;
      if (mine(r)) numbers.push(n);
    }
  }
  return numbers;
}

// What the Thank you and Order status pages show a backer (extensions/backer-share-card): for each design in the
// order, its edition numbers and the backer's own link back to it, in the store of the market they paid in.
export async function orderBackings(shopifyOrderId: string) {
  const d = await db();
  const rows = await d
    .select({ c: campaigns, email: pledges.email, currency: pledges.currency })
    .from(pledges)
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .where(and(eq(pledges.shopifyOrderId, shopifyOrderId), inArray(pledges.status, ["pledged", "charge_pending", "charged", "charge_failed"])))
    .orderBy(pledges.createdAt);
  const byCampaign = new Map(rows.map((r) => [r.c.id, r]));
  return Promise.all([...byCampaign.values()].map(async ({ c, email, currency }) => {
    const fan = email ? (await d.select().from(fans).where(eq(fans.email, email)))[0] : undefined;
    const page = `${storefront(currency === PREORDER_PRICE.US.currency ? "US" : "AE")}${config().PROXY_PATH}/c/${c.slug}`;
    return {
      slug: c.slug,
      title: c.title,
      numbers: await editionNumbers(c.id, (r) => r.orderId === shopifyOrderId),
      url: fan ? `${page}?backed=${encodeURIComponent(seal({ fanId: fan.id }, 60 * 24 * 90))}` : page,
    };
  }));
}

// ---- Waitlists ---------------------------------------------------------------------------------------

export const designerTarget = (userId: string) => `designer:${userId}`;
// A campaign and its relaunch share one list, keyed by the first campaign.
export const campaignTarget = (c: { id: string; relaunchOf: string | null }) => `campaign:${c.relaunchOf ?? c.id}`;

export const WAITLIST_TARGET = /^(designer|campaign):[0-9a-f-]{36}$/;

// Double opt-in: a fan already confirmed in this browser joins straight away; anyone else gets a link that confirms
// their email and joins them. Returns whether they're on the list now, and the link in dev.
export async function requestWaitlist(emailInput: string, target: string, next: string) {
  if (!WAITLIST_TARGET.test(target)) throw new UserError("Something went wrong. Reload the page and try again.");
  const email = cleanEmail(emailInput);
  const fan = await currentFan();
  if (fan?.email === email) {
    await joinWaitlist(email, target);
    return { joined: true as const };
  }
  await throttleEmail(email);
  return { joined: false as const, link: await sendFanLink(email, next, "follow along", target) };
}

export async function joinWaitlist(emailInput: string, target: string) {
  const email = cleanEmail(emailInput);
  const d = await db();
  await d.insert(waitlist).values({ email, target }).onConflictDoNothing();
}

export async function waitlistCount(target: string) {
  const d = await db();
  const [row] = await d.select({ n: sql<number>`count(*)::int` }).from(waitlist).where(eq(waitlist.target, target));
  return row.n;
}

// Tells everyone waiting on these lists about a campaign that's just gone live.
export async function notifyWaitlists(c: typeof campaigns.$inferSelect, targets: string[]) {
  const d = await db();
  const [designer] = await d.select().from(users).where(eq(users.id, c.userId));
  const list = await d.select().from(waitlist).where(and(inArray(waitlist.target, targets), isNull(waitlist.notifiedAt)));
  const url = publicUrl(`/c/${c.slug}`);
  const comeback = targets.some((t) => t.startsWith("campaign:"));
  for (const w of list) {
    await sendEmail({
      to: w.email,
      key: `waitlist:${c.id}:${w.email}`,
      subject: comeback ? `${c.title} is back` : `${designer.name} just launched ${c.title}`,
      body: `${comeback ? `You asked us to bring back ${c.title}. It's live again` : `${designer.name}'s new design ${c.title} is live`}: ` +
        `pre-order it here before the campaign closes.\n${url}\n\nNobody is charged unless it reaches ${c.goal} pre-orders.`,
    });
    await d.update(waitlist).set({ notifiedAt: new Date() }).where(eq(waitlist.id, w.id));
  }
}

// ---- Referral rewards --------------------------------------------------------------------------------

// Pre-orders a fan's link brought in. Only charged ones count toward rewards, and never their own orders.
export async function referralStats(fan: typeof fans.$inferSelect) {
  const d = await db();
  const own = or(isNull(pledges.email), ne(pledges.email, fan.email));
  const [row] = await d
    .select({
      pending: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.status} in ('pledged','charge_pending','charge_failed')), 0)::int`,
      charged: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.status} = 'charged'), 0)::int`,
    })
    .from(pledges)
    .where(and(eq(pledges.fanRef, fan.id), own));
  const rewards = await d.select().from(fanRewards).where(eq(fanRewards.fanId, fan.id));
  return { ...row, rewards };
}

// Run by the cron tick: issues a free-tee code for every REFERRALS_PER_REWARD charged referrals not yet rewarded.
export async function issueFanRewards(log: string[] = []) {
  const d = await db();
  const referrers = await d.selectDistinct({ fanId: pledges.fanRef }).from(pledges).where(eq(pledges.status, "charged"));
  for (const { fanId } of referrers) {
    if (!fanId) continue;
    const [fan] = await d.select().from(fans).where(eq(fans.id, fanId));
    if (!fan) continue;
    const stats = await referralStats(fan);
    const owed = Math.floor(stats.charged / REFERRALS_PER_REWARD) - stats.rewards.length;
    for (let i = 0; i < owed; i++) {
      const code = `TCFAN-${randomBytes(4).toString("hex").toUpperCase()}`;
      await shopify().createRewardCode(code, PRICE_CENTS);
      await d.insert(fanRewards).values({ fanId, code });
      await sendEmail({
        to: fan.email,
        key: `reward:${code}`,
        subject: "You've earned a free Truecolors tee",
        body: `Your link brought in ${stats.charged} pre-orders. Thank you! Here's a free tee on us: use code ${code} ` +
          `at checkout on ${config().STORE_URL}. It works once, on any shirt.`,
      });
      log.push(`fan reward ${code} for ${fan.email}`);
    }
  }
  return log;
}

// Run by the cron tick: a friend code in Shopify for every referral link that doesn't have one yet: confirmed fans'
// codes and the handles of designers with a live campaign.
export async function issueFriendCodes(log: string[] = []) {
  const d = await db();
  const have = new Set((await d.select({ ref: friendCodes.ref }).from(friendCodes)).map((r) => r.ref));
  const fanRefs = (await d.select({ ref: fans.referralCode }).from(fans).where(sql`${fans.verifiedAt} is not null`)).map((r) => r.ref);
  const designerRefs = (await d.selectDistinct({ ref: users.handle }).from(users)
    .innerJoin(campaigns, eq(campaigns.userId, users.id)).where(eq(campaigns.status, "live"))).map((r) => r.ref.toLowerCase());
  for (const ref of [...new Set([...fanRefs, ...designerRefs])]) {
    if (have.has(ref)) continue;
    const code = friendCode(ref);
    await shopify().createFriendCode(code);
    await d.insert(friendCodes).values({ ref, code }).onConflictDoNothing();
    log.push(`friend code ${code}`);
  }
  return log;
}

// The friend code for a referral link, once it's live in Shopify.
export async function friendCodeFor(ref: string | undefined) {
  if (!ref) return;
  const d = await db();
  const [row] = await d.select().from(friendCodes).where(eq(friendCodes.ref, ref.toLowerCase()));
  return row?.code;
}

export async function fanByReferralCode(code: string) {
  const d = await db();
  const [fan] = await d.select().from(fans).where(eq(fans.referralCode, code.toLowerCase()));
  return fan;
}

// ---- A fan's own page --------------------------------------------------------------------------------

export async function signOutFan() {
  (await cookies()).delete(FAN_COOKIE);
}

// Inside the store, the store's signed-in customer is also the fan with that email (Shopify confirmed it), so
// their pre-orders, votes and referral link need no emailed link. Callers must have verified the email.
export async function signInStoreFan(email: string | undefined) {
  if (!email) return signOutFan();
  const fan = await ensureFan(email);
  const d = await db();
  await d.update(fans).set({ verifiedAt: new Date() }).where(and(eq(fans.id, fan.id), isNull(fans.verifiedAt)));
  (await cookies()).set(FAN_COOKIE, seal({ fanId: fan.id }, YEAR_MINUTES), {
    httpOnly: true, sameSite: "lax", secure: config().APP_URL.startsWith("https"), path: "/", maxAge: YEAR_MINUTES * 60,
  });
}

// Every pre-order placed with this fan's email, newest first, with its campaign and edition numbers.
export async function fanPreorders(fan: typeof fans.$inferSelect) {
  const d = await db();
  const rows = await d
    .select({ p: pledges, c: campaigns, lineArt: designs.lineArtKey, art: designs.compositeKey, designer: users.name })
    .from(pledges)
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .innerJoin(users, eq(users.id, campaigns.userId))
    .where(eq(pledges.email, fan.email))
    .orderBy(desc(pledges.createdAt));
  return rows.map((r) => ({
    ...r,
    editions: r.p.editionStart ? Array.from({ length: r.p.quantity }, (_, i) => r.p.editionStart! + i) : [],
  }));
}

export async function fanVotes(fanId: string) {
  const d = await db();
  return d
    .select({ title: designs.title, art: designs.compositeKey, lineArt: designs.lineArtKey, challenge: challenges.title, slug: challenges.slug, voteBy: challenges.voteBy })
    .from(votes)
    .innerJoin(challengeEntries, eq(challengeEntries.id, votes.entryId))
    .innerJoin(designs, eq(designs.id, challengeEntries.designId))
    .innerJoin(challenges, eq(challenges.id, challengeEntries.challengeId))
    .where(eq(votes.fanId, fanId))
    .orderBy(desc(votes.createdAt));
}

// Designers this fan follows and missed designs they want back, with names to show.
export async function fanFollowing(email: string) {
  const d = await db();
  const list = await d.select().from(waitlist).where(eq(waitlist.email, email)).orderBy(desc(waitlist.createdAt));
  return Promise.all(
    list.map(async (w) => {
      const [kind, id] = w.target.split(":");
      if (kind === "designer") {
        const [u] = await d.select({ name: users.name, handle: users.handle }).from(users).where(eq(users.id, id));
        return { target: w.target, label: u ? `${u.name}'s next launch` : "A designer", href: u ? `/d/${u.handle}` : undefined };
      }
      const [c] = await d.select({ title: campaigns.title, slug: campaigns.slug }).from(campaigns).where(eq(campaigns.id, id));
      return { target: w.target, label: c ? `${c.title} coming back` : "A design coming back", href: c ? `/c/${c.slug}` : undefined };
    }),
  );
}

export async function leaveWaitlist(email: string, target: string) {
  const d = await db();
  await d.delete(waitlist).where(and(eq(waitlist.email, email), eq(waitlist.target, target)));
}
