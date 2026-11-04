import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db/client";
import { campaigns, designs, pledges, users } from "@/lib/db/schema";
import { daysLeft } from "@/lib/format";
import { listChallenges, phase } from "@/lib/challenges";
import { onShirts } from "@/lib/media/shots";
import { fileUrl } from "@/lib/storage";
import { TileSweep } from "@/components/TileSweep";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Explore designs · Truecolors" };

const FILTERS = {
  live: { label: "Live now", statuses: ["live"] },
  funded: { label: "Funded", statuses: ["funded", "in_production", "shipped"] },
  back: { label: "Bring it back", statuses: ["missed"] },
  all: { label: "All", statuses: ["live", "closing", "funded", "in_production", "shipped", "missed"] },
} as const;
const SORTS = { ending: "Ending soon", popular: "Most backed", new: "Newest" } as const;
type Filter = keyof typeof FILTERS;
type Sort = keyof typeof SORTS;

export default async function Explore({ searchParams }: { searchParams: Promise<{ show?: string; sort?: string; q?: string }> }) {
  const q = await searchParams;
  const show: Filter = q.show && q.show in FILTERS ? (q.show as Filter) : "live";
  const sort: Sort = q.sort && q.sort in SORTS ? (q.sort as Sort) : show === "live" ? "ending" : "popular";
  const term = q.q?.trim().slice(0, 60);
  const d = await db();
  const backed = sql<number>`coalesce((select sum(${pledges.quantity}) from ${pledges} where ${pledges.campaignId} = ${campaigns.id} and ${pledges.status} in ('pledged','charged','charge_failed')), 0)::int`;
  const rows = await onShirts(await d
    .select({ c: campaigns, designer: users.name, handle: users.handle, lineArt: designs.lineArtKey, art: designs.compositeKey, backed })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(and(
      inArray(campaigns.status, [...FILTERS[show].statuses]),
      term ? or(ilike(campaigns.title, `%${term}%`), ilike(users.name, `%${term}%`)) : undefined,
    )), (x) => x.c.designId);
  rows.sort((a, b) =>
    sort === "ending" ? (a.c.endsAt?.getTime() ?? Infinity) - (b.c.endsAt?.getTime() ?? Infinity)
    : sort === "popular" ? b.backed - a.backed
    : b.c.createdAt.getTime() - a.c.createdAt.getTime(),
  );
  const challenge = (await listChallenges()).find((ch) => phase(ch) !== "closed");
  const href = (p: Partial<Record<"show" | "sort" | "q", string>>) => {
    const params = new URLSearchParams({ show, sort, ...(term && { q: term }), ...p });
    return `/explore?${params}`;
  };

  return (
    <>
      <div className="eyebrow">Explore</div>
      <h1>Every design, <span className="sun-text">in the sun</span></h1>
      <p className="muted" style={{ maxWidth: 560 }}>
        Hover or tap a design to see it change colour. Pre-order the ones you love: nobody pays unless a design reaches its goal.
      </p>

      {challenge && (
        <Link href={`/challenges/${challenge.slug}`} className="challenge-strip">
          <span className="badge phase-voting">Challenge</span>
          <span><strong>{challenge.title}</strong> · vote for what gets made next</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      <div className="explore-bar">
        <nav className="tabs" aria-label="Show">
          {(Object.keys(FILTERS) as Filter[]).map((f) => (
            <Link key={f} href={href({ show: f, sort: f === "live" ? "ending" : "popular" })} className={f === show ? "tab on" : "tab"} aria-current={f === show ? "page" : undefined}>
              {FILTERS[f].label}
            </Link>
          ))}
        </nav>
        <form className="explore-search" action="/explore">
          <input type="hidden" name="show" value={show} />
          <input type="hidden" name="sort" value={sort} />
          <input type="search" name="q" defaultValue={term} placeholder="Search designs or designers" aria-label="Search" />
        </form>
        <div className="sorts small">
          {(Object.keys(SORTS) as Sort[]).map((s) => (
            <Link key={s} href={href({ sort: s })} className={s === sort ? "on" : undefined}>{SORTS[s]}</Link>
          ))}
        </div>
      </div>

      {rows.length === 0 && (
        <p className="muted">{term ? `Nothing matches “${term}”.` : show === "live" ? "No live campaigns right now. Check back soon." : "Nothing here yet."}</p>
      )}
      <div className="grid explore-grid">
        {rows.map(({ c, designer, handle, lineArt, art, sweep, backed }) => {
          const days = daysLeft(c.endsAt);
          const pct = Math.min(100, (backed / c.goal) * 100);
          return (
            <article key={c.id} className="tile">
              <Link href={`/c/${c.slug}`} className="tile-art">
                {lineArt && <img className="art" src={fileUrl(lineArt)} alt="" />}
                {art && <img className="art tile-sun" src={fileUrl(art)} alt={c.title} />}
                {sweep && <TileSweep src={fileUrl(sweep)} />}
                {c.status === "live" && days <= 3 && <span className="corner-badge">Ends in {days}d</span>}
                {c.editionSize && <span className="corner-badge">Edition of {c.editionSize}</span>}
              </Link>
              <div>
                <Link href={`/c/${c.slug}`} className="name">{c.title}</Link>
                <div className="meta">by <Link href={`/d/${handle}`}>{designer}</Link></div>
              </div>
              {c.status !== "missed" && <div className="progress"><div style={{ "--w": `${pct}%` } as React.CSSProperties} /></div>}
              <div className="meta">
                {c.status === "live" ? `${backed} of ${c.goal} · ${days} days left`
                  : c.status === "missed" ? `${backed} of ${c.goal} · ask for it back`
                  : `${backed} backed · funded`}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
