import { and, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { cardStats } from "@/lib/campaign-card";
import { db } from "@/lib/db/client";
import { campaigns, pledges } from "@/lib/db/schema";
import { FUNDING_GOAL } from "@/lib/rules";

export type TickerItem = { text: string; href?: string };

// What's always true, between the live lines.
const STANDING: TickerItem[] = [
  { text: `${FUNDING_GOAL} pre-orders and it's printed` },
  { text: "Grey indoors, full colour in the sun" },
  { text: "Designed by the community" },
  { text: "Printed in Cancún" },
  { text: "Ships from Dubai & Las Vegas" },
  { text: "Nobody pays unless it's made" },
];

// The ticker band's lines: the latest pre-orders by city ("Dubai backed YALLA"), the designs closest to printing
// ("YALLA · 28 to go"), and the standing promises in between, so it's never empty.
export async function tickerItems(): Promise<TickerItem[]> {
  const d = await db();
  const recent = await d
    .select({ city: pledges.city, title: campaigns.title, slug: campaigns.slug })
    .from(pledges)
    .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
    .where(and(
      isNotNull(pledges.city),
      inArray(pledges.status, ["pledged", "charge_pending", "charged", "charge_failed"]),
      gt(pledges.createdAt, new Date(Date.now() - 30 * 86_400_000)),
    ))
    .orderBy(desc(pledges.createdAt))
    .limit(6);
  const close = (await d
    .select({ title: campaigns.title, slug: campaigns.slug, goal: campaigns.goal, backed: cardStats.backed })
    .from(campaigns)
    .where(eq(campaigns.status, "live")))
    .filter((c) => c.backed > 0 && c.backed < c.goal)
    .sort((a, b) => b.backed / b.goal - a.backed / a.goal)
    .slice(0, 4);
  const live: TickerItem[] = [
    ...recent.map((r) => ({ text: `${r.city} backed ${r.title}`, href: `/c/${r.slug}` })),
    ...close.map((c) => ({ text: `${c.title} · ${c.goal - c.backed} to go`, href: `/c/${c.slug}` })),
  ];
  // Live and standing lines take turns.
  const out: TickerItem[] = [];
  for (let i = 0; i < Math.max(live.length, STANDING.length); i++) {
    if (live[i]) out.push(live[i]);
    if (STANDING[i]) out.push(STANDING[i]);
  }
  return out;
}
