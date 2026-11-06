import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { campaigns, designs, pledges, users } from "@/lib/db/schema";
import { daysLeft } from "@/lib/format";
import { listChallenges, phase } from "@/lib/challenges";
import { onShirts } from "@/lib/media/shots";
import { fileUrl, thumbUrl } from "@/lib/storage";
import { TileSweep } from "@/components/TileSweep";
import { preorderPrice, visitorMarket } from "@/lib/markets";
import { trackView } from "@/lib/analytics";
import { storefront } from "@/lib/links";
import "../explore/home.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Designs · Truecolors" };

const FILTERS = {
  live: { label: "Live now", statuses: ["live"] },
  funded: { label: "Funded", statuses: ["funded", "in_production", "shipped"] },
  back: { label: "Bring it back", statuses: ["missed"] },
  all: { label: "All", statuses: ["live", "closing", "funded", "in_production", "shipped", "missed"] },
} as const;
const SORTS = { ending: "Ending soon", popular: "Most backed", new: "Newest" } as const;
type Filter = keyof typeof FILTERS;
type Sort = keyof typeof SORTS;

export default async function Designs({ searchParams }: { searchParams: Promise<{ show?: string; sort?: string; q?: string }> }) {
  const q = await searchParams;
  await trackView("explore_viewed", q, { path: "/designs", props: { show: q.show ?? null, q: q.q?.slice(0, 60) ?? null } });
  const show: Filter = q.show && q.show in FILTERS ? (q.show as Filter) : "live";
  const sort: Sort = q.sort && q.sort in SORTS ? (q.sort as Sort) : show === "live" ? "ending" : "popular";
  const term = q.q?.trim().slice(0, 60);
  const designer = await currentUser();
  const d = await db();
  const backed = sql<number>`coalesce((select sum(${pledges.quantity}) from ${pledges} where ${pledges.campaignId} = ${campaigns.id} and ${pledges.status} in ('pledged','charge_pending','charged','charge_failed')), 0)::int`;
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
  const market = await visitorMarket();
  const price = preorderPrice(market);
  const challenge = (await listChallenges()).find((ch) => phase(ch) !== "closed");
  // A quiet Live tab (nothing live, or a couple of campaigns nobody has backed yet) never dead-ends: it goes on to
  // designs the community already funded, the shirts ready to ship today, the open challenge and a way to design one.
  const quiet = show === "live" && !term && (rows.length < 2 || rows.every((r) => r.backed === 0));
  const funded = quiet
    ? await onShirts(await d
        .select({ c: campaigns, designer: users.name, lineArt: designs.lineArtKey, art: designs.compositeKey, backed })
        .from(campaigns)
        .innerJoin(users, eq(users.id, campaigns.userId))
        .innerJoin(designs, eq(designs.id, campaigns.designId))
        .where(inArray(campaigns.status, ["funded", "in_production", "shipped"]))
        .orderBy(desc(sql`coalesce(${campaigns.fundedAt}, ${campaigns.createdAt})`))
        .limit(4), (x) => x.c.designId)
    : [];
  const href = (p: Partial<Record<"show" | "sort" | "q", string>>) => {
    const params = new URLSearchParams({ show, sort, ...(term && { q: term }), ...p });
    return `/designs?${params}`;
  };

  return (
    <>
      <div className="eyebrow">Designs</div>
      <h1 className="designs-title">Every community design</h1>
      <p className="muted designs-lede">Back the ones you love on pre-order: you only pay if they reach 100 and get printed.</p>

      {challenge && !quiet && (
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
        <form className="explore-search" action="/designs">
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
        <p className="muted">{term ? `Nothing matches “${term}”.` : show === "live" ? "Nothing on pre-order this minute. Here’s what’s already made it, and what you can wear today." : "Nothing here yet."}</p>
      )}
      {/* A couple of designs fill the width rather than leaving half the row empty. */}
      <div className={`grid explore-grid${rows.length < 3 ? " few" : ""}`}>
        {rows.map(({ c, designer, handle, lineArt, art, sweep, backed }) => {
          const days = daysLeft(c.endsAt);
          const pct = Math.min(100, (backed / c.goal) * 100);
          return (
            <article key={c.id} className="tile">
              <Link href={`/c/${c.slug}`} className="tile-art">
                {lineArt && <img className="art" src={thumbUrl(lineArt, 320)} loading="lazy" decoding="async" alt="" />}
                {art && <img className="art tile-sun" src={thumbUrl(art, 320)} loading="lazy" decoding="async" alt={c.title} />}
                {sweep && <TileSweep src={fileUrl(sweep)} />}
                {c.status === "live" && days <= 7 && <span className="corner-badge">Ends in {days}d</span>}
                {c.editionSize && <span className="corner-badge">Edition of {c.editionSize}</span>}
              </Link>
              <div>
                <Link href={`/c/${c.slug}`} className="name">{c.title}</Link>
                <div className="meta">by <Link href={`/d/${handle}`}>{designer}</Link></div>
              </div>
              {/* An empty bar with "Be #001" reads as an open door, not a dead campaign. */}
              {c.status !== "missed" && <div className={`progress${backed === 0 ? " empty" : ""}`}><div style={{ "--w": `${pct}%` } as React.CSSProperties} /></div>}
              <div className="meta">
                {c.status === "live" ? <><b className="tile-price">{price}</b> · {backed > 0 ? `${backed} of ${c.goal} · ` : <span className="be-first">Be #001 · 0 of {c.goal} · </span>}{days}d left</>
                  : c.status === "missed" ? `${backed} of ${c.goal} · ask for it back`
                  : `${backed} backed · funded`}
              </div>
            </article>
          );
        })}
      </div>

      {quiet && (
        <section className="explore-more" aria-label="More to see">
          {funded.length > 0 && (
            <>
              <h2 className="explore-more-head">Funded by the community</h2>
              <div className={`grid explore-grid${funded.length < 3 ? " few" : ""}`}>
                {funded.map(({ c, designer, lineArt, art, backed }) => (
                  <article key={c.id} className="tile">
                    <Link href={`/c/${c.slug}`} className="tile-art">
                      {lineArt && <img className="art" src={thumbUrl(lineArt, 320)} loading="lazy" decoding="async" alt="" />}
                      {art && <img className="art tile-sun" src={thumbUrl(art, 320)} loading="lazy" decoding="async" alt={c.title} />}
                      <span className="corner-badge">{c.status === "shipped" ? "Shipped" : c.status === "in_production" ? "Printing" : "Funded"}</span>
                    </Link>
                    <div>
                      <Link href={`/c/${c.slug}`} className="name">{c.title}</Link>
                      <div className="meta">by {designer} · {backed} backed</div>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
          <div className="explore-ways">
            <a href={`${storefront(market)}/collections/all`} className="way-card way-shop">
              <span className="eyebrow">Ready to ship</span>
              <b>Shop tees in stock</b>
              <span>Black line art indoors, full colour in the sun. Ships from {market === "US" ? "Las Vegas" : "Dubai"}.</span>
              <span className="way-go" aria-hidden="true">→</span>
            </a>
            {challenge && (
              <Link href={`/challenges/${challenge.slug}`} className="way-card">
                <span className="eyebrow">{phase(challenge) === "open" ? "Challenge · entries open" : "Challenge · voting"}</span>
                <b>{challenge.title}</b>
                <span>{phase(challenge) === "open" ? "Enter a design. The winner gets made." : "Vote for what gets made next."}</span>
                <span className="way-go" aria-hidden="true">→</span>
              </Link>
            )}
            <Link href={designer ? "/studio/new" : "/join"} className="way-card way-design">
              <span className="eyebrow">Design your own</span>
              <b>Your design could be the next one here</b>
              <span>Describe an idea, the AI draws it. Launch a pre-order and earn on every shirt.</span>
              <span className="way-go" aria-hidden="true">→</span>
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
