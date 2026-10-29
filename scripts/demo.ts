import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { sendLoginLink } from "../src/lib/auth/session";
import { config } from "../src/lib/config";
import { db } from "../src/lib/db/client";
import { createChallenge, enterChallenge, toggleVote } from "../src/lib/challenges";
import {
  challengeEntries, challenges, campaigns, designs, generations, identities, invites, loginTokens, media, payoutMethods, pledges, royaltyEntries,
  users, votes,
} from "../src/lib/db/schema";
import { inArray } from "drizzle-orm";
import { designerTarget, ensureFan, joinWaitlist, sendFanLink } from "../src/lib/fans";
import { colourDesign, createDesign, renderMedia } from "../src/lib/design/service";
import { CURRENCY, FUNDING_GOAL, PRICE_CENTS, SIZES, STRETCH_GOALS, royaltyCents, shareBps } from "../src/lib/rules";

// Local only: a demo designer with designs, campaigns and pre-orders, so the studio dashboard has something
// to show. Prints a login link for the demo designer.
//   npm run demo                 mock artist, free
//   npm run demo -- --reset --ai rebuilds the demo with real designs from the OpenAI image model (8 paid calls)

const EMAIL = "demo.designer@truecolors.design";
const DAY = 86_400_000;
const CITIES = ["Austin", "Miami", "Brooklyn", "San Diego", "Chicago", "Houston", "Denver", "Seattle"];

const FAN = "demo.fan@example.com";

// A fan with a pre-order on every demo campaign, a few referrals, a vote and a follow, for the My pre-orders page.
// Funded campaigns get edition numbers, as they would when they close.
async function demoFan(userId: string) {
  const d = await db();
  const mine = await d.select().from(campaigns).where(eq(campaigns.userId, userId));
  const fan = await ensureFan(FAN);
  for (const c of mine) {
    const list = await d.select().from(pledges).where(eq(pledges.campaignId, c.id)).orderBy(pledges.createdAt);
    if (!list.length || list.some((p) => p.email === FAN)) continue;
    await d.update(pledges).set({ email: FAN, quantity: c.status === "funded" ? 2 : 1 }).where(eq(pledges.id, list[1].id));
    for (const p of list.slice(-3)) await d.update(pledges).set({ fanRef: fan.id }).where(eq(pledges.id, p.id));
    if (c.status === "funded" && !c.editionSize) {
      let next = 1;
      for (const p of await d.select().from(pledges).where(eq(pledges.campaignId, c.id)).orderBy(pledges.createdAt)) {
        await d.update(pledges).set({ editionStart: next }).where(eq(pledges.id, p.id));
        next += p.quantity;
      }
      await d.update(campaigns).set({ editionSize: next - 1, closedAt: new Date() }).where(eq(campaigns.id, c.id));
    }
  }
  await joinWaitlist(FAN, designerTarget(userId));
  const [entry] = await d.select().from(challengeEntries).limit(1);
  if (entry) await d.insert(votes).values({ entryId: entry.id, fanId: fan.id }).onConflictDoNothing();
  console.log(`Demo fan ready. Open their pre-orders: ${await sendFanLink(FAN, "/me", "see your pre-orders")}`);
}

// A live design challenge with the demo designer's designs entered and some votes, if there isn't one yet.
async function demoChallenge(userId: string) {
  const d = await db();
  if ((await d.select().from(challenges)).length) return;
  const now = Date.now();
  const ch = await createChallenge({
    title: "Summer in the Emirates",
    brief: "Beach clubs, dune bashing, dhows at sunset: design the shirt you'd wear all summer. Bold line art that comes alive in the sun works best.",
    prize: "The winning design launches as a featured campaign on truecolors.global",
    submitBy: new Date(now + 5 * DAY), voteBy: new Date(now + 12 * DAY),
  });
  const mine = await d.select().from(designs).where(eq(designs.userId, userId));
  for (const x of mine.slice(0, 2)) await enterChallenge(userId, ch.id, x.id);
  const entries = await d.select().from(challengeEntries).where(eq(challengeEntries.challengeId, ch.id));
  for (let i = 0; i < 23; i++) {
    const fan = await ensureFan(`demo.fan${i}@example.com`);
    await toggleVote(fan.id, entries[i % 3 === 0 ? 1 : 0].id);
  }
}

const args = process.argv.slice(2);

// Removes the demo designer and everything hanging off them, plus the demo challenge.
async function reset() {
  const d = await db();
  const [user] = await d.select().from(users).where(eq(users.email, EMAIL));
  const [ch] = await d.select().from(challenges).where(eq(challenges.slug, "summer-in-the-emirates"));
  if (ch) {
    const entries = await d.select().from(challengeEntries).where(eq(challengeEntries.challengeId, ch.id));
    if (entries.length) await d.delete(votes).where(inArray(votes.entryId, entries.map((e) => e.id)));
    await d.delete(challengeEntries).where(eq(challengeEntries.challengeId, ch.id));
    await d.delete(challenges).where(eq(challenges.id, ch.id));
  }
  if (!user) return;
  const mine = await d.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.userId, user.id));
  const ids = mine.map((c) => c.id);
  await d.delete(royaltyEntries).where(eq(royaltyEntries.userId, user.id));
  if (ids.length) await d.delete(pledges).where(inArray(pledges.campaignId, ids));
  await d.delete(campaigns).where(eq(campaigns.userId, user.id));
  const myDesigns = (await d.select({ id: designs.id }).from(designs).where(eq(designs.userId, user.id))).map((x) => x.id);
  if (myDesigns.length) {
    await d.delete(challengeEntries).where(inArray(challengeEntries.designId, myDesigns));
    await d.delete(media).where(inArray(media.designId, myDesigns));
    await d.delete(generations).where(inArray(generations.designId, myDesigns));
  }
  await d.delete(designs).where(eq(designs.userId, user.id));
  await d.delete(identities).where(eq(identities.userId, user.id));
  await d.delete(payoutMethods).where(eq(payoutMethods.userId, user.id));
  await d.delete(loginTokens).where(eq(loginTokens.userId, user.id));
  await d.update(invites).set({ usedBy: null }).where(eq(invites.usedBy, user.id));
  await d.delete(users).where(eq(users.id, user.id));
}

async function main() {
  process.env.AI_PROVIDER = args.includes("--ai") ? "openai" : "mock";
  if (config().DATABASE_URL) throw new Error("The demo is for the local database only");
  if (args.includes("--reset")) await reset();
  const d = await db();
  let [user] = await d.select().from(users).where(eq(users.email, EMAIL));
  if (user) {
    await demoChallenge(user.id);
    await demoFan(user.id);
    for (const p of await d.select().from(pledges)) {
      if (!p.city) await d.update(pledges).set({ city: CITIES[Number(p.orderName.slice(-2)) % CITIES.length] }).where(eq(pledges.id, p.id));
    }
    return console.log(`Demo designer exists. Log in: ${await sendLoginLink(EMAIL)}`);
  }
  [user] = await d
    .insert(users)
    .values({ email: EMAIL, name: "Layla Haddad", handle: "layla", credits: 24, agreementVersion: "draft", agreementAcceptedAt: new Date() })
    .returning();

  const plan = [
    {
      title: "YALLA", preset: "letter-fill", status: "live", pledged: 72, daysIn: 15,
      idea: "the word YALLA, each letter filled with a different Dubai scene: Burj Khalifa at dusk, a dhow on the creek, palm islands, red dunes and a falcon",
    },
    {
      title: "Fabulous Las Vegas", preset: "postcard", status: "live", pledged: 31, daysIn: 9,
      idea: "vintage Las Vegas souvenir: the classic diamond-shaped welcome sign reading Welcome to Fabulous Las Vegas, neon lights, dice, playing cards, palm trees and the Strip at night",
    },
    {
      title: "Beast Mode", preset: "merch", status: "funded", pledged: 118, daysIn: 21,
      idea: "a grinning cartoon panther mascot bursting out of a torn circle with lightning bolts, and the words BEAST MODE in huge chunky letters",
    },
    {
      title: "Sunny Days", preset: "tattoo", status: null, pledged: 0, daysIn: 0,
      idea: "a swallow carrying a rose past a rising sun, with a banner scroll reading SUNNY DAYS",
    },
  ] as const;

  const now = Date.now();
  for (const [n, p] of plan.entries()) {
    const design = await createDesign(user.id, { title: p.title, presetId: p.preset, idea: p.idea });
    await colourDesign(user.id, design.id);
    await renderMedia(user.id, design.id);
    if (!p.status) continue;
    const startsAt = new Date(now - p.daysIn * DAY);
    const [c] = await d
      .insert(campaigns)
      .values({
        slug: `${p.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${n}`, designCode: `DEMO${n}`, designId: design.id,
        userId: user.id, title: p.title, market: "US", status: p.status, goal: FUNDING_GOAL, stretchGoals: STRETCH_GOALS,
        priceCents: PRICE_CENTS, currency: CURRENCY, startsAt, endsAt: new Date(startsAt.getTime() + 21 * DAY),
        fundedAt: p.status === "funded" ? new Date(now - DAY) : null,
      })
      .returning();
    for (let i = 0; i < p.pledged; i++) {
      // More pre-orders near the start and the end, like real campaigns.
      const t = Math.random() < 0.5 ? Math.random() ** 2 : 1 - Math.random() ** 2;
      const via = Math.random() < 0.45;
      const [pl] = await d
        .insert(pledges)
        .values({
          campaignId: c.id, shopifyOrderId: randomBytes(6).toString("hex"), orderName: `#D${1000 + i}`, lineItemId: "1",
          size: SIZES[i % SIZES.length], quantity: 1, netCents: PRICE_CENTS, viaDesignerLink: via,
          email: `demo.backer${n}.${i}@example.com`, city: CITIES[(i * 7 + n) % CITIES.length],
          status: p.status === "funded" ? "charged" : "pledged",
          createdAt: new Date(startsAt.getTime() + t * (p.daysIn * DAY - 3_600_000)),
        })
        .returning();
      if (p.status === "funded") {
        const bps = shareBps(via);
        await d.insert(royaltyEntries).values({
          userId: user.id, campaignId: c.id, pledgeId: pl.id, kind: "earning", sourceRef: "earning", rateBps: bps,
          baseCents: PRICE_CENTS, amountCents: royaltyCents(PRICE_CENTS, bps), currency: CURRENCY,
          payableAfter: new Date(now + (i % 3 === 0 ? -DAY : 10 * DAY)),
        });
      }
    }
  }
  await demoChallenge(user.id);
  await demoFan(user.id);
  console.log(`Demo designer ready. Log in: ${await sendLoginLink(EMAIL)}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
