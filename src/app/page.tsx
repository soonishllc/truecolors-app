import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { campaignStats } from "@/lib/campaigns/service";
import { db } from "@/lib/db/client";
import { campaigns, designs, users } from "@/lib/db/schema";
import { daysLeft } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const d = await db();
  const live = await d
    .select({ c: campaigns, name: users.name, art: designs.compositeKey })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(inArray(campaigns.status, ["live", "funded"]));
  const stats = await Promise.all(live.map((x) => campaignStats(x.c.id)));

  return (
    <>
      <h1>Shirts that come alive in the sun</h1>
      <p className="muted">
        Designs by our community. Pre-order the ones you love: when a design reaches 100 pre-orders, we print it.
      </p>
      {live.length === 0 && <p>No live campaigns right now. Check back soon.</p>}
      <div className="grid">
        {live.map(({ c, name, art }, i) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="card" style={{ textDecoration: "none" }}>
            {art && <img className="art" src={fileUrl(art)} alt="" />}
            <p><strong>{c.title}</strong><br /><span className="muted small">by {name}</span></p>
            <div className="progress"><div style={{ width: `${Math.min(100, (stats[i].pledged / c.goal) * 100)}%` }} /></div>
            <p className="small">{stats[i].pledged} of {c.goal} · {c.status === "funded" ? "funded" : `${daysLeft(c.endsAt)} days left`}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
