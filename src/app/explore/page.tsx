import { desc, eq, inArray, sql } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { HeroReveal } from "@/components/HeroReveal";
import { CampaignCard } from "@/components/CampaignCard";
import { HowItWorks } from "@/components/HowItWorks";
import { Ticker } from "@/components/Ticker";
import { trackView } from "@/lib/analytics";
import { cardStats } from "@/lib/campaign-card";
import { currentUser } from "@/lib/auth/session";
import { listChallenges, phase } from "@/lib/challenges";
import { db } from "@/lib/db/client";
import { campaigns, designs, pledges, users, type CampaignStatus } from "@/lib/db/schema";
import { storefront } from "@/lib/links";
import { preorderPrice, visitorMarket } from "@/lib/markets";
import { onShirts } from "@/lib/media/shots";
import { FUNDING_GOAL } from "@/lib/rules";
import { storeOriginals } from "@/lib/shopify/originals";
import { siteImageUrl } from "@/lib/site-images";
import { tickerItems } from "@/lib/ticker";
import "./home.css";
import "../designers/designers.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Community designs · Truecolors" };

const PUBLIC: CampaignStatus[] = ["live", "closing", "funded", "in_production", "shipped", "missed"];
const COUNTING = sql`('pledged','charge_pending','charged','charge_failed')`;

// Made with the studio: real AI output, idea to shade to sun, so visitors see what designing here makes.
const EXAMPLES = [
  { id: "iguana", idea: "An iguana holding a taco beside Mayan ruins and a cenote" },
  { id: "axolotl", idea: "Un ajolote bailando en la playa de Cancún: “Cancún Mi Amor”" },
  { id: "dog", idea: "My dog with his collar tag, a sun and palm leaves behind him" },
  { id: "sun-mascot", idea: "A grinning sun in sunglasses with a surfboard" },
];

// The community's home: what's happening now (designs close to printing, the open challenge), how it works, the
// shirts already made, and the way in to making one. Every section hides when it has nothing, and the Originals
// and examples mean the page is never empty, even before the first campaign.
export default async function CommunityHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const q = await searchParams;
  await trackView("explore_viewed", q, { path: "/explore" });
  const designer = await currentUser();
  const market = await visitorMarket();
  const d = await db();
  const shirts = (statuses: readonly CampaignStatus[], limit: number) =>
    d.select({ c: campaigns, designer: users.name, handle: users.handle, avatarKey: users.avatarKey, lineArt: designs.lineArtKey, art: designs.compositeKey, ...cardStats })
      .from(campaigns)
      .innerJoin(users, eq(users.id, campaigns.userId))
      .innerJoin(designs, eq(designs.id, campaigns.designId))
      .where(inArray(campaigns.status, [...statuses]))
      .orderBy(desc(campaigns.startsAt))
      .limit(limit);

  // Close to printing first: the ones a backer can tip over the line.
  const live = (await onShirts(await shirts(["live"], 24), (x) => x.c.designId))
    .sort((a, b) => b.backed / b.c.goal - a.backed / a.c.goal)
    .slice(0, 6);
  const made = await onShirts(await shirts(["funded", "in_production", "shipped"], 4), (x) => x.c.designId);
  const challenge = (await listChallenges()).find((ch) => phase(ch) !== "closed");
  const originals = await storeOriginals(8);
  const ticker = await tickerItems();

  const [counts] = await d
    .select({
      launched: sql<number>`count(*) filter (where ${inArray(campaigns.status, PUBLIC)})::int`,
      designers: sql<number>`count(distinct ${campaigns.userId}) filter (where ${inArray(campaigns.status, PUBLIC)})::int`,
    })
    .from(campaigns);
  const [{ preordered }] = await d
    .select({ preordered: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.status} in ${COUNTING}), 0)::int` })
    .from(pledges);
  const create = designer ? "/studio/new" : "/join";
  const shop = storefront(market);
  const price = preorderPrice(market);

  return (
    <>
      <HeroReveal sun={siteImageUrl("home-hero-sun")} shade={siteImageUrl("home-hero-shade")} video="/site/home-hero.mp4" short>
        <div className="eyebrow">Community designs</div>
        <h1>Designed by you.<br /><span className="sun-text">Funded by fans.</span></h1>
        <p>Shirts by our community that change colour in the sun. Back the ones you love: when a design reaches {FUNDING_GOAL} pre-orders, we print it.</p>
        <p className="home-ctas">
          <Link href="/designs" className="button">Back a design</Link>
          <Link href={create} className="button secondary">{designer ? "Start a new design" : "Create yours"}</Link>
        </p>
      </HeroReveal>

      <Ticker items={ticker} />

      {/* The community in numbers once there are some; until then, what's true about every shirt. */}
      <div className="home-stats">
        {counts.launched > 0 && preordered > 0 ? (
          <>
            <div><b>{counts.launched}</b><span>designs launched</span></div>
            <div><b>{preordered}</b><span>shirts pre-ordered</span></div>
            <div><b>{counts.designers}</b><span>designers</span></div>
          </>
        ) : (
          <>
            <div><b>{FUNDING_GOAL}</b><span>pre-orders and it&apos;s printed</span></div>
            <div><b>10–15%</b><span>to the designer, every sale</span></div>
            <div><b>Cancún</b><span>printed · ships from Dubai &amp; Las Vegas</span></div>
          </>
        )}
      </div>

      {live.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <div><div className="eyebrow">Live now</div><h2>Almost there</h2></div>
            <Link href="/designs" className="button small secondary">All designs →</Link>
          </div>
          <div className="home-rail card-rail">
            {live.map((row) => <CampaignCard key={row.c.id} row={row} price={price} />)}
          </div>
        </section>
      )}

      {challenge && (
        <Link href={`/challenges/${challenge.slug}`} className="home-challenge">
          <span className="eyebrow">Challenge · {phase(challenge) === "voting" ? "vote now" : "enter now"}</span>
          <b>{challenge.title}</b>
          <span className="muted">Designers enter, you vote, and the winner is printed.</span>
          <span className="home-challenge-go" aria-hidden="true">→</span>
        </Link>
      )}

      <section className="home-section">
        <div className="eyebrow">How it works</div>
        <HowItWorks />
      </section>

      {made.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <div><div className="eyebrow">Made it</div><h2>Funded by the community</h2></div>
            <Link href="/designs?show=funded" className="button small secondary">See them all →</Link>
          </div>
          <div className="grid home-grid">
            {made.map((row) => <CampaignCard key={row.c.id} row={row} />)}
          </div>
        </section>
      )}

      <section className="home-section">
        <div className="section-head">
          <div><div className="eyebrow">Made with the studio</div><h2>An idea in, a shirt out</h2></div>
          <Link href={create} className="button small secondary">Try it →</Link>
        </div>
        <p className="muted home-sub">Real designs the AI drew from one line of text. Drag your finger over one, or hover, to step it into the sun.</p>
        <div className="home-rail">
          {EXAMPLES.map((x) => (
            <figure key={x.id} className="tile home-example">
              <div className="tile-art">
                <img className="art" src={`/examples/gallery/${x.id}-shade.webp`} loading="lazy" decoding="async" alt="" />
                <img className="art tile-sun" src={`/examples/gallery/${x.id}-sun.webp`} loading="eager" decoding="async" alt={x.idea} />
              </div>
              <figcaption className="meta">“{x.idea}”</figcaption>
            </figure>
          ))}
        </div>
      </section>

      {originals.length > 0 && (
        <section className="home-section">
          <div className="section-head">
            <div><div className="eyebrow">Truecolors Originals</div><h2>Ready to wear today</h2></div>
            <a href={`${shop}/collections/all`} target="_top" className="button small secondary">Shop →</a>
          </div>
          <p className="muted home-sub">Our own designs, in stock and shipping from {market === "US" ? "Las Vegas" : "Dubai"}.</p>
          <div className="home-rail">
            {originals.map((p) => (
              <a key={p.handle} href={`${shop}/products/${p.handle}`} target="_top" className="tile">
                <div className="tile-art">
                  <img className="art" src={p.image} loading="lazy" decoding="async" alt={p.title} />
                  {p.hover && <img className="art tile-sun" src={p.hover} loading="eager" decoding="async" alt="" />}
                </div>
                <div className="name">{p.title}</div>
              </a>
            ))}
          </div>
        </section>
      )}

      <section className="home-band">
        <h2>Your idea could be next</h2>
        <p>Describe it, the AI draws it, and if {FUNDING_GOAL} people pre-order it, we print it. You earn on every shirt.</p>
        <Link href={create} className="button sun-button">{designer ? "Start a new design" : "Create yours, free"}</Link>
      </section>
    </>
  );
}
