import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { campaigns, designs, pledges, users } from "@/lib/db/schema";
import { onShirts } from "@/lib/media/shots";

// What the public sees of designers: campaigns that have been out in the world (not drafts, in review or rejected).
export const PUBLIC_STATUSES = ["live", "closing", "funded", "in_production", "shipped", "missed"] as const;
const FUNDED = new Set<string>(["funded", "in_production", "shipped"]);
// Live first, then the ones that made it, then the ones that can be brought back.
const RANK: Record<string, number> = { live: 0, closing: 0, funded: 1, in_production: 1, shipped: 1, missed: 2 };

const backed = sql<number>`coalesce((select sum(${pledges.quantity}) from ${pledges} where ${pledges.campaignId} = ${campaigns.id} and ${pledges.status} in ('pledged','charge_pending','charged','charge_failed')), 0)::int`;

// Public campaigns with their artwork (on shirts where there are photos) and shirts pre-ordered, best first.
export async function publicCampaigns(userIds?: string[]) {
  if (userIds && !userIds.length) return [];
  const d = await db();
  const rows = await d
    .select({ c: campaigns, lineArt: designs.lineArtKey, art: designs.compositeKey, backed })
    .from(campaigns)
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(and(inArray(campaigns.status, [...PUBLIC_STATUSES]), userIds ? inArray(campaigns.userId, userIds) : undefined));
  rows.sort((a, b) => RANK[a.c.status] - RANK[b.c.status] || b.backed - a.backed || b.c.createdAt.getTime() - a.c.createdAt.getTime());
  return onShirts(rows, (x) => x.c.designId);
}

export type CampaignRow = Awaited<ReturnType<typeof publicCampaigns>>[number];

export function designerStats(list: CampaignRow[]) {
  return {
    launched: list.length,
    preordered: list.reduce((s, x) => s + x.backed, 0),
    funded: list.filter((x) => FUNDED.has(x.c.status)).length,
    live: list.filter((x) => x.c.status === "live" || x.c.status === "closing").length,
    firstAt: list.reduce<Date | undefined>((m, x) => (!m || x.c.createdAt < m ? x.c.createdAt : m), undefined),
  };
}

export type DirectorySort = "popular" | "new";

// Everyone with at least one public campaign, by shirts pre-ordered, or newest first (by their first campaign).
export async function listDesigners(sort: DirectorySort = "popular") {
  const list = await publicCampaigns();
  const byUser = new Map<string, CampaignRow[]>();
  for (const row of list) byUser.set(row.c.userId, [...(byUser.get(row.c.userId) ?? []), row]);
  if (!byUser.size) return [];
  const d = await db();
  const people = await d
    .select({ id: users.id, handle: users.handle, name: users.name, avatarKey: users.avatarKey, location: users.location, bio: users.bio })
    .from(users)
    .where(inArray(users.id, [...byUser.keys()]));
  const out = people.map((p) => {
    const mine = byUser.get(p.id)!;
    return { ...p, stats: designerStats(mine), thumbs: mine.slice(0, 3) };
  });
  out.sort((a, b) =>
    sort === "new"
      ? b.stats.firstAt!.getTime() - a.stats.firstAt!.getTime()
      : b.stats.preordered - a.stats.preordered || b.stats.funded - a.stats.funded || a.name.localeCompare(b.name),
  );
  return out;
}
