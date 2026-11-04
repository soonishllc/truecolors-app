import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { cookies } from "next/headers";
import { seal, unseal } from "./auth/session";
import { shopify } from "./campaigns/shopify-ops";
import { config } from "./config";
import { db } from "./db/client";
import {
  campaigns, challengeEntries, challenges, designs, fanRewards, fans, pledges, users, votes, waitlist,
} from "./db/schema";
import { UserError } from "./design/service";
import { sendEmail } from "./email";
import { PRICE_CENTS, REFERRALS_PER_REWARD } from "./rules";
import { publicUrl, safePath } from "./links";

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

// Emails a link that confirms the address and brings them back to `next`. Returns the link in dev.
export async function sendFanLink(emailInput: string, next: string, why: string): Promise<string | undefined> {
  const fan = await ensureFan(emailInput);
  const link = `${config().APP_URL}/fan/verify?token=${seal({ fanId: fan.id, next: safePath(next, "/me") }, 24 * 60)}`;
  await sendEmail({
    to: fan.email,
    subject: "Confirm your email for Truecolors",
    body: `Tap to confirm your email and ${why}:\n${link}\n\nThe link works for 24 hours. If you didn't ask for this, ignore it.`,
  });
  return config().DEV_SHOW_LOGIN_LINKS ? link : undefined;
}

export async function verifyFan(token: string): Promise<string | undefined> {
  const t = unseal<{ fanId: string; next: string }>(token);
  if (!t) return;
  const d = await db();
  await d.update(fans).set({ verifiedAt: new Date() }).where(and(eq(fans.id, t.fanId), isNull(fans.verifiedAt)));
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

// ---- Waitlists ---------------------------------------------------------------------------------------

export const designerTarget = (userId: string) => `designer:${userId}`;
// A campaign and its relaunch share one list, keyed by the first campaign.
export const campaignTarget = (c: { id: string; relaunchOf: string | null }) => `campaign:${c.relaunchOf ?? c.id}`;

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
      pending: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.status} in ('pledged','charge_failed')), 0)::int`,
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
