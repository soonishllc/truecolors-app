import { sql } from "drizzle-orm";
import { campaigns, pledges } from "@/lib/db/schema";

const COUNTING = sql`('pledged','charge_pending','charged','charge_failed')`;
const mine = sql`${pledges.campaignId} = ${campaigns.id} and ${pledges.status} in ${COUNTING}`;

// What a design card says about its pre-orders, as columns to select alongside a campaign: how many, how many in
// the last day, and where and when the latest came from (the city, as the campaign page's live feed shows it).
export const cardStats = {
  backed: sql<number>`coalesce((select sum(${pledges.quantity}) from ${pledges} where ${mine}), 0)::int`,
  today: sql<number>`coalesce((select sum(${pledges.quantity}) from ${pledges} where ${mine} and ${pledges.createdAt} > now() - interval '24 hours'), 0)::int`,
  lastCity: sql<string | null>`(select ${pledges.city} from ${pledges} where ${mine} and ${pledges.city} is not null order by ${pledges.createdAt} desc limit 1)`,
  lastAt: sql<string | null>`(select max(${pledges.createdAt}) from ${pledges} where ${mine})::text`,
};
