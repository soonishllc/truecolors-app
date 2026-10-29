import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { sendLoginLink } from "../src/lib/auth/session";
import { config } from "../src/lib/config";
import { db } from "../src/lib/db/client";
import { campaigns, pledges, royaltyEntries, users } from "../src/lib/db/schema";
import { colourDesign, createDesign, renderMedia } from "../src/lib/design/service";
import { CURRENCY, FUNDING_GOAL, PRICE_CENTS, SIZES, STRETCH_GOALS, royaltyCents, shareBps } from "../src/lib/rules";

// Local only: a demo designer with designs, campaigns and pre-orders, so the studio dashboard has something
// to show. Uses the mock artist, so it costs nothing. Prints a login link for the demo designer.

const EMAIL = "demo.designer@truecolors.design";
const DAY = 86_400_000;

async function main() {
  if (config().DATABASE_URL) throw new Error("The demo is for the local database only");
  process.env.AI_PROVIDER = "mock";
  const d = await db();
  let [user] = await d.select().from(users).where(eq(users.email, EMAIL));
  if (user) return console.log(`Demo designer exists. Log in: ${await sendLoginLink(EMAIL)}`);
  [user] = await d
    .insert(users)
    .values({ email: EMAIL, name: "Layla Haddad", handle: "layla", credits: 24, agreementVersion: "draft", agreementAcceptedAt: new Date() })
    .returning();

  const plan = [
    { title: "Marina Golden Hour", preset: "skyline", idea: "Dubai Marina towers at sunset with dhows", status: "live", pledged: 72, daysIn: 15 },
    { title: "Falcon Over the Dunes", preset: "patriotic", idea: "A falcon gliding over red desert dunes", status: "live", pledged: 31, daysIn: 9 },
    { title: "Jumeirah Beach Club", preset: "beach", idea: "Palm trees, a lifeguard tower and waves", status: "funded", pledged: 118, daysIn: 21 },
    { title: "Souq Lanterns", preset: "souvenir", idea: "Hanging brass lanterns in an old souq", status: null, pledged: 0, daysIn: 0 },
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
  console.log(`Demo designer ready. Log in: ${await sendLoginLink(EMAIL)}`);
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
