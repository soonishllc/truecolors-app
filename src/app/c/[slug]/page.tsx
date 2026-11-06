import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fanEmailAction, waitlistAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { BuyBox } from "@/components/BuyBox";
import { Countdown } from "@/components/Countdown";
import { DesignerChip } from "@/components/DesignerChip";
import { ShadeSun } from "@/components/ShadeSun";
import { ShareKit } from "@/components/ShareKit";
import { SunReveal } from "@/components/SunReveal";
import { TileSweep } from "@/components/TileSweep";
import { campaignStats } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { RETAIL_MARKETS, preorderPrice, visitorMarket } from "@/lib/markets";
import { campaigns, designs, media, pledges, users } from "@/lib/db/schema";
import { backerNumbers, campaignTarget, currentFan, designerTarget, fanFromBackedLink, friendCodeFor, referralStats, waitlistCount } from "@/lib/fans";
import { ago, money, nextStretch } from "@/lib/format";
import {
  FRIEND_DISCOUNT_PERCENT, GARMENT, PREORDER_PRICE, SHIPPING, REFERRALS_PER_REWARD, RETURN_WINDOW_DAYS, SIZES, STRETCH_REWARDS, TWO_PACK_PERCENT,
} from "@/lib/rules";
import { productUrl } from "@/lib/shopify/campaigns";
import { fileUrl, thumbUrl } from "@/lib/storage";
import { publicUrl, storefront } from "@/lib/links";
import { trackView } from "@/lib/analytics";
import "../campaign.css";
import "../../designers/designers.css";

export const dynamic = "force-dynamic";

const PUBLIC = ["live", "closing", "funded", "in_production", "shipped", "missed"];
const COUNTING = ["pledged", "charge_pending", "charged", "charge_failed"] as const;
const WALL_SIZE = 24;
const edition = (n: number) => `#${String(n).padStart(3, "0")}`;

// The first backers, numbered in pre-order order the way their shirts are: "#007 · Dubai · 2h ago". Only the
// number, the city and when: never an email or a name.
async function backerWall(campaignId: string) {
  const d = await db();
  const rows = await d
    .select({ quantity: pledges.quantity, city: pledges.city, at: pledges.createdAt, start: pledges.editionStart })
    .from(pledges)
    .where(and(eq(pledges.campaignId, campaignId), inArray(pledges.status, [...COUNTING])))
    .orderBy(pledges.createdAt)
    .limit(WALL_SIZE);
  const wall: { n: number; city: string | null; at: Date }[] = [];
  let n = 0;
  for (const r of rows) {
    for (let i = 0; i < r.quantity && wall.length < WALL_SIZE; i++) {
      n++;
      wall.push({ n: r.start != null ? r.start + i : n, city: r.city, at: r.at });
    }
  }
  return wall;
}

async function load(slug: string) {
  const d = await db();
  const [row] = await d
    .select({ c: campaigns, designer: users, design: designs })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(eq(campaigns.slug, slug));
  if (!row || !PUBLIC.includes(row.c.status)) return;
  const files = await d.select().from(media).where(eq(media.designId, row.c.designId));
  return { ...row, files, stats: await campaignStats(row.c.id) };
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const data = await load((await params).slug);
  if (!data) return {};
  const image = data.files.find((m) => m.template === "split-square") ?? data.files.find((m) => m.kind === "mockup");
  return {
    title: `${data.c.title} by ${data.designer.name} · Truecolors`,
    description: "Black-and-white indoors, full colour in the sun. A numbered limited run: pre-order it and help get it printed.",
    openGraph: image ? { images: [`${config().APP_URL}${fileUrl(image.key)}`] } : undefined,
  };
}

export default async function CampaignPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string; backed?: string; market?: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { c, designer, design, files, stats } = data;
  const q = await searchParams;
  await trackView("campaign_viewed", q, { campaignId: c.id, path: `/c/${c.slug}` });
  // Only a real share link credits anyone: an organic visit isn't the designer's own-link sale, and it mustn't
  // overwrite a friend's link already on the cart.
  const ref = q.ref?.trim() || undefined;
  const market = await visitorMarket(q.market);
  const d = await db();
  const recent = await d
    .select({ size: pledges.size, quantity: pledges.quantity, city: pledges.city, at: pledges.createdAt })
    .from(pledges)
    .where(and(eq(pledges.campaignId, c.id), inArray(pledges.status, [...COUNTING])))
    .orderBy(desc(pledges.createdAt))
    .limit(6);
  // Back from their post-checkout email: the backer, with their numbers and their own link up top.
  const backer = await fanFromBackedLink(q.backed);
  const fan = backer ?? (await currentFan());
  const referrals = fan && (await referralStats(fan));
  const video = files.find((m) => m.kind === "video");
  const mockups = files.filter((m) => m.kind === "mockup");
  const sweep = files.find((m) => m.kind === "sweep");
  const worn = files.find((m) => m.kind === "worn");
  const pairShade = mockups.find((m) => m.template === "flat-square" && m.view === "shade");
  const pairSun = mockups.find((m) => m.template === "flat-square" && m.view === "sun");
  const target = nextStretch(stats.pledged, c.goal, c.stretchGoals) ?? stats.pledged;
  const pct = Math.min(100, Math.round((stats.pledged / Math.max(target, 1)) * 100));
  const pageUrl = publicUrl(`/c/${c.slug}`);
  const open = c.status === "live";
  const missed = c.status === "missed";
  const goals = [c.goal, ...c.stretchGoals];
  const toGo = c.goal - stats.pledged;
  const buyUrl = c.shopifyHandle ? productUrl(c.shopifyHandle, ref, market) : undefined;
  // Shares keep whichever link brought this visitor, so the designer or fan still gets the credit.
  const shareUrl = ref ? `${pageUrl}?ref=${encodeURIComponent(ref)}` : pageUrl;
  const share = encodeURIComponent(`${c.title}: a shirt that changes colour in the sun ${shareUrl}`);
  const comebackList = missed ? await waitlistCount(campaignTarget(c)) : 0;
  // The hero shows the colour change happening: the store's shade and sun pictures, or before those are made, the
  // design itself (greyed when there's no separate line art).
  const heroPair = !worn && !(sweep && pairShade) && pairShade && pairSun;
  const heroArt = !worn && !(sweep && pairShade) && !heroPair && design.compositeKey;
  const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const shipFrom = c.endsAt && new Date(c.endsAt.getTime() + 21 * 86_400_000);
  const shipTo = c.endsAt && new Date(c.endsAt.getTime() + 28 * 86_400_000);
  // Few backers yet: the first-backer offer reads better than a near-empty bar.
  const early = open && !c.fundedAt && stats.pledged < 10;
  const more = await moreDesigns(c.id);
  // Proof that people are buying: only ever real numbers, and nothing when there's nothing to show.
  const dayAgo = Date.now() - 86_400_000;
  const today = recent.filter((p) => p.at.getTime() > dayAgo).reduce((n, p) => n + p.quantity, 0);
  // Arrived from someone's link: say so, since a friend's recommendation is why they're here.
  const sharedBy = q.ref && !backer ? (q.ref === designer.handle ? designer.name.split(" ")[0] : "A friend") : undefined;
  // The friend's reward: their code, applied on the way to checkout. Only once it exists in Shopify.
  const friend = sharedBy && fan?.referralCode !== q.ref?.toLowerCase() ? await friendCodeFor(q.ref) : undefined;
  const myNumbers = backer?.email ? await backerNumbers(c.id, backer.email) : [];
  // Straight to checkout on the pre-order plan (the store goes through the friend's code first when there is one).
  const prefix = market === "US" ? config().STORE_US_PATH : "";
  const cart = c.sellingPlanId ? {
    action: `${storefront(market)}/cart/add`,
    sellingPlan: c.sellingPlanId,
    returnTo: friend ? `${prefix}/discount/${encodeURIComponent(friend)}?redirect=${encodeURIComponent(`${prefix}/checkout`)}` : `${prefix}/checkout`,
    ref,
  } : undefined;
  const unit = PREORDER_PRICE[market];
  const packCents = Math.round(unit.cents * 2 * (100 - TWO_PACK_PERCENT) / 100);
  const packPrice = money(packCents, unit.currency);
  const packSave = money(unit.cents * 2 - packCents, unit.currency);
  const wall = await backerWall(c.id);
  const designerLive = (await d.select({ id: campaigns.id }).from(campaigns)
    .where(and(eq(campaigns.userId, designer.id), eq(campaigns.status, "live")))).length;

  return (
    <>
      <nav className="crumbs small" aria-label="Breadcrumb">
        <ol>
          <li><Link href="/designs">Designs</Link></li>
          <li><Link href={`/d/${designer.handle}`}>{designer.name}</Link></li>
          <li aria-current="page">{c.title}</li>
        </ol>
      </nav>
      <div className="pair">
        <div>
          {worn ? (
            <video className="art worn" src={fileUrl(worn.key)} autoPlay muted loop playsInline aria-label={`${c.title}, worn in the sun`} />
          ) : sweep && pairShade ? (
            <div className="tile-art hero-sweep">
              <img className="art" src={fileUrl(pairShade.key)} alt={c.title} />
              <TileSweep src={fileUrl(sweep.key)} inView />
            </div>
          ) : heroPair ? <SunReveal shade={fileUrl(pairShade.key)} sun={fileUrl(pairSun.key)} alt={c.title} />
            : heroArt ? (
              <SunReveal
                shade={fileUrl(design.lineArtKey ?? heroArt)} sun={fileUrl(heroArt)} alt={c.title}
                grey={!design.lineArtKey || design.lineArtKey === heroArt}
              />
            ) : video ? <video className="art" src={fileUrl(video.key)} poster={design.lineArtKey ? thumbUrl(design.lineArtKey) : undefined} autoPlay muted loop playsInline />
            // Before the mockups and clips are made: the design itself.
            : design.compositeKey ? <img className="art" src={fileUrl(design.compositeKey)} alt={c.title} /> : null}
        </div>
        <div className="buy-col">
          {backer && myNumbers.length > 0 && (
            <div className="backed-card">
              <div className="eyebrow">You&apos;re in</div>
              <p className="backed-no">{myNumbers.map((n) => `#${String(n).padStart(3, "0")}`).join(" · ")}</p>
              <p className="small">
                {myNumbers.length > 1 ? "Your numbers are" : "Your number is"} printed inside the shirt. Help it reach {c.goal}: friends
                who use your link get {FRIEND_DISCOUNT_PERCENT}% off, and every {REFERRALS_PER_REWARD} who back it earn you a free tee.
              </p>
              <ShareKit url={`${pageUrl}?ref=${backer.referralCode}`} text={`I just backed ${c.title}, a shirt that changes colour in the sun. ${FRIEND_DISCOUNT_PERCENT}% off with my link:`} />
            </div>
          )}
          {sharedBy && !missed && (
            <p className="shared-by small">
              {sharedBy === "A friend" ? "A friend sent you this one." : `${sharedBy}, the designer, sent you this one.`}
              {friend && open && <> <b>{FRIEND_DISCOUNT_PERCENT}% off your pre-order</b>, taken off at checkout.</>}
            </p>
          )}
          <div className="eyebrow">{missed ? "Campaign ended" : `Edition of ${c.editionSize ?? c.goal} · Numbered`}</div>
          <h1>{c.title}</h1>
          <Link className="designer-chip" href={`/d/${designer.handle}`}>
            <span className="avatar" aria-hidden="true">{designer.name.slice(0, 1)}</span>
            <span>
              <span className="small muted">Designed by</span>
              <b>{designer.name}</b>
            </span>
            {designerLive > 1 && <span className="small muted designer-more">{designerLive} designs live →</span>}
          </Link>
          {!missed && (
            <>
              <p className="price-line">
                {/* The same compare-at price the store product carries: what it costs once it's launched. */}
                <s className="muted was">{money(unit.compareAtCents, unit.currency)}</s>{" "}
                <span className="stat">{preorderPrice(market)}</span>{" "}
                <span className="save-tag">Pre-order price</span>
              </p>

            </>
          )}

          {missed ? (
            <div className="card comeback">
              <p><strong>{c.title} ended with {stats.pledged} of {c.goal} pre-orders</strong>, so it wasn&apos;t printed and nobody paid.</p>
              <p className="small muted">{comebackList > 0 ? `${comebackList} people want it back. ` : ""}Add your email and you&apos;ll hear first if it returns.</p>
              <ActionForm action={waitlistAction} submit="Bring it back" className="inline-form">
                <input type="hidden" name="target" value={campaignTarget(c)} />
                <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
              </ActionForm>
            </div>
          ) : (
            <>
              {/* How close it is, big enough to read at a glance: the count, the bar, the clock, today's backers. */}
              <div className="camp-progress">
                <p className="camp-count">
                  <span className="camp-num">{stats.pledged}</span>
                  <span className="camp-of"> of {target}</span>
                  <span className="camp-label">pre-orders</span>
                </p>
                <div className="progress"><div style={{ "--w": `${pct}%` } as React.CSSProperties} /></div>
                <p className="camp-meta small">
                  {c.fundedAt ? <span className="good">Funded, going to print</span>
                    : toGo > 0 && <span className="to-go">{toGo} to go</span>}
                  {open && c.endsAt && <span><Countdown endsAt={c.endsAt.toISOString()} /></span>}
                  {open && today > 0 && (
                    <span className="hot-line"><span className="feed-dot" aria-hidden="true" /> {today} backed today</span>
                  )}
                </p>
                {early && (
                  <p className="first-backers small">
                    Numbered 1–{c.goal} in the order people pre-order. Yours: <b>{edition(stats.pledged + 1)}</b>.
                  </p>
                )}
              </div>
              {open && (
                <BuyBox
                  href={buyUrl} cart={cart} variants={c.variantIds} sizes={SIZES} price={preorderPrice(market)}
                  packPrice={packPrice} packSave={packSave}
                  progress={early ? `Yours would be #${String(stats.pledged + 1).padStart(3, "0")}` : `${stats.pledged} of ${target}`}
                >
                  {c.endsAt && <Countdown endsAt={c.endsAt.toISOString()} />}
                </BuyBox>
              )}
              <p className="small risk-line">
                {c.fundedAt
                  ? <><b>Funded.</b> Pre-orders are charged now and go straight to print.</>
                  : <><b>You&apos;re only charged if it reaches {c.goal}.</b> {c.goal} people need to pre-order{c.endsAt ? ` by ${day(c.endsAt)}` : ""}. If not, nothing is printed and nobody pays.</>}
              </p>
              <p className="small muted spec-line">
                {GARMENT.fabric ? `${GARMENT.fabric} · ` : ""}Unisex S–XL{shipTo && open ? ` · arrives by ${day(shipTo)}` : ` · ships in the ${RETAIL_MARKETS[market].label}`}
                {/* Inside the store, its own market switch does this. */}
                <span className="site-only">
                  Shopping from {market === "AE" ? "the USA" : "the UAE"}?{" "}
                  <Link href={`/c/${c.slug}?market=${market === "AE" ? "US" : "AE"}${q.ref ? `&ref=${encodeURIComponent(q.ref)}` : ""}`}>
                    {preorderPrice(market === "AE" ? "US" : "AE")} in the {RETAIL_MARKETS[market === "AE" ? "US" : "AE"].label} store
                  </Link>
                </span>
              </p>
              {open && (
                <p className="small muted now-link">
                  Want one sooner? <a href={`${config().STORE_URL.replace(/\/$/, "")}/collections/all`} target="_parent">Shop ready-to-ship designs</a>
                </p>
              )}
              {c.endsAt && shipFrom && shipTo && (
                <ol className="timeline small">
                  <li><b>{day(c.endsAt)}</b> Closes</li>
                  <li><b>{c.goal} backers</b> It&apos;s printed</li>
                  <li><b>{day(shipFrom)}–{day(shipTo)}</b> Ships, tracked</li>
                </ol>
              )}
            </>
          )}

          <p className="story"><strong>Grey line art in the shade. Full colour in the sun.</strong> {c.story}</p>
          {!missed && (
            <>
              <ul className="promise">
                <li>
                  <b>Numbered limited edition.</b>{" "}
                  {c.editionSize ? `${c.editionSize} made, never restocked. ` : "No restocks. "}Your number is printed inside, in the order people back it.
                </li>
                <li><b>Returns.</b> Within {RETURN_WINDOW_DAYS} days of delivery. <Link href="/pre-orders">How pre-orders work</Link></li>
              </ul>
              <details className="garment" id="size-guide">
                <summary>Size, fabric &amp; care</summary>
                <ul>
                  <li><b>Sizes</b> {SIZES.join(", ")}, unisex.</li>
                  {GARMENT.fabric && <li><b>Fabric</b> {GARMENT.fabric}</li>}
                  <li><b>Made in</b> Canc&uacute;n, Mexico. {market === "AE" ? "Ships from Dubai across the UAE and the Gulf." : "Ships from Las Vegas to US addresses."}</li>
                  {GARMENT.fit && <li><b>Fit</b> {GARMENT.fit}</li>}
                  <li><b>The colour change</b> Grey line art indoors and in shade. In direct sun the print turns full colour in seconds, and fades back once you&apos;re out of the sun. On cloudy days it still changes, just lighter; most glass blocks the UV.</li>
                  {GARMENT.care && <li><b>Care</b> {GARMENT.care}</li>}
                  <li><b>Delivery</b> {SHIPPING[market]}.</li>
                </ul>
                {GARMENT.sizeChart && (
                  <table className="size-chart">
                    <thead><tr><th>Size</th>{SIZES.map((s) => <th key={s}>{s}</th>)}</tr></thead>
                    <tbody>
                      {GARMENT.sizeChart.map((row) => (
                        <tr key={row.label}><th>{row.label}</th>{SIZES.map((s) => <td key={s}>{row[s]}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </details>
              <div className="share-buttons">
                <a className="chip" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${share}`}>WhatsApp</a>
                {video && <a className="chip" href={fileUrl(video.key)} download>↓ Video</a>}
              </div>
            </>
          )}

          {recent.length > 0 && (
            <div className="live-feed">
              <div className="backers" aria-hidden="true">
                {recent.slice(0, 5).map((_, i) => <span key={i} style={{ "--i": i } as React.CSSProperties} />)}
              </div>
              <ul>
                {recent.slice(0, 3).map((p, i) => (
                  <li key={i}>
                    <span className="feed-dot" aria-hidden="true" />
                    Someone{p.city ? ` in ${p.city}` : ""} pre-ordered {p.quantity > 1 ? `${p.quantity}× ` : ""}{p.size}
                    <time className="muted"> · {ago(p.at)}</time>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {!missed && (
        <section className="backer-wall" aria-labelledby="wall-h">
          <div className="eyebrow">Backers</div>
          {wall.length > 0 ? (
            <>
              <h2 id="wall-h">The first {wall.length === 1 ? "backer" : `${wall.length} backers`}</h2>
              <ol className="wall">
                {wall.map((b, i) => (
                  <li key={i}>
                    <b>{edition(b.n)}</b>
                    {b.city && <span>{b.city}</span>}
                    <time className="muted" dateTime={b.at.toISOString()}>{ago(b.at)}</time>
                  </li>
                ))}
              </ol>
              {stats.pledged > wall.length && <p className="small muted">and {stats.pledged - wall.length} more.</p>}
            </>
          ) : (
            <>
              <h2 id="wall-h">Be {edition(1)}</h2>
              <p className="small muted">Nobody has backed it yet. The first pre-order gets shirt {edition(1)}, printed inside.</p>
            </>
          )}
        </section>
      )}

      {pairShade && pairSun && !heroPair && (
        <>
          <div className="eyebrow" style={{ marginTop: 48 }}>Try it</div>
          <h2 style={{ marginTop: 8 }}>Drag the sun across it</h2>
          <div style={{ maxWidth: 560 }}><ShadeSun shade={fileUrl(pairShade.key)} sun={fileUrl(pairSun.key)} alt={c.title} /></div>
        </>
      )}
      <div className="grid" style={{ marginTop: 24 }}>
        {mockups.map((m) => <img key={m.id} className="art" src={thumbUrl(m.key)} loading="lazy" decoding="async" alt={`${c.title} ${m.view}`} />)}
      </div>

      {!missed && (
        <section className="goals">
          <div className="eyebrow">Goals</div>
          <h2 style={{ marginTop: 8 }}>{c.fundedAt ? "The more people back it, the more it unlocks" : `${c.goal} pre-orders and it's printed`}</h2>
          <ol className="goal-track">
            {/* Until it's funded, only the goal that matters: far-off stretch goals with nobody near them read as empty. */}
            {goals.filter((g, i) => c.fundedAt || i === 0).map((g, i) => {
              const done = stats.pledged >= g;
              return (
                <li key={g} className={done ? "done" : stats.pledged >= (goals[i - 1] ?? 0) ? "next" : ""}>
                  <span className="goal-num">{g}</span>
                  <span>
                    <strong>{i === 0 ? "It gets printed" : STRETCH_REWARDS[g] ?? "Stretch goal"}</strong>
                    <span className="small muted">{done ? " · unlocked" : ` · ${g - stats.pledged} to go`}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {more.length > 0 && (
        <section className="more-designs">
          <div className="eyebrow">Also close to its goal</div>
          <h2 style={{ marginTop: 8 }}>More from the community</h2>
          <div className="grid">
            {more.map((m) => (
              <Link key={m.c.id} href={`/c/${m.c.slug}`} className="tile">
                <div className="tile-art">
                  {m.lineArt && <img className="art" src={thumbUrl(m.lineArt, 320)} alt="" loading="lazy" decoding="async" />}
                  {m.art && <img className="art tile-sun" src={thumbUrl(m.art, 320)} alt={m.c.title} loading="lazy" decoding="async" />}
                </div>
                <div className="name">{m.c.title}</div>
                <div className="meta">by {m.designer} · {Math.max(0, m.c.goal - m.backed)} to go</div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* The referral offer, for people who've already got a link (backers); everyone else gets one quiet line, so the
          product page stays about the product. */}
      {open && !(fan && referrals) && (
        <p className="small muted share-line">
          Friends who use your link get {FRIEND_DISCOUNT_PERCENT}% off, and every {REFERRALS_PER_REWARD} who back it earn you a free tee. <Link href="/me">Get your link</Link>
        </p>
      )}
      {open && fan && referrals && (
        <section className="card fan-link">
          <div>
            <div className="eyebrow">Share it</div>
            <h2 style={{ margin: "8px 0" }}>Bring {REFERRALS_PER_REWARD} friends, your tee is free</h2>
            <p className="small">They get {FRIEND_DISCOUNT_PERCENT}% off their pre-order with your link.</p>
            <p className="small muted">
              Every {REFERRALS_PER_REWARD} pre-orders that come through your link earn you a free Truecolors tee once the
              designs are funded. Your own orders don&apos;t count.
            </p>
          </div>
          {fan && referrals ? (
            <div>
              <ShareKit url={`${pageUrl}?ref=${fan.referralCode}`} text={`This shirt changes colour in the sun. Help get it printed:`} />
              <div className="ref-progress">
                <div className="progress"><div style={{ "--w": `${((referrals.charged % REFERRALS_PER_REWARD) / REFERRALS_PER_REWARD) * 100}%` } as React.CSSProperties} /></div>
                <span className="small muted">
                  {referrals.charged + referrals.pending} through your link
                  {referrals.pending > 0 && ` (${referrals.pending} not charged yet)`} · {referrals.rewards.length} free tee{referrals.rewards.length === 1 ? "" : "s"} earned
                </span>
              </div>
            </div>
          ) : (
            <ActionForm action={fanEmailAction} submit="Get my link" className="inline-form">
              <input type="hidden" name="next" value={`/c/${c.slug}`} />
              <input type="hidden" name="why" value="referral" />
              <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
            </ActionForm>
          )}
        </section>
      )}

      <section className="card follow camp-designer">
        <div>
          <div className="eyebrow">Designer</div>
          <DesignerChip
            handle={designer.handle} name={designer.name} avatarKey={designer.avatarKey} location={designer.location} size="md"
            meta={designerLive > 1 ? `${designerLive} designs live` : undefined}
          />
          <p className="small muted">Get an email when {designer.name.split(" ")[0]} launches a new design.</p>
        </div>
        <ActionForm action={waitlistAction} submit="Follow" className="inline-form">
          <input type="hidden" name="target" value={designerTarget(designer.id)} />
          <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
        </ActionForm>
      </section>

    </>
  );
}

// Other live designs, nearest their goal first, so a visitor who isn't sold on this one finds the next.
async function moreDesigns(id: string) {
  const d = await db();
  const rows = await d
    .select({ c: campaigns, designer: users.name, lineArt: designs.lineArtKey, art: designs.compositeKey })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(and(eq(campaigns.status, "live"), ne(campaigns.id, id)))
    .limit(12);
  const withCounts = await Promise.all(rows.map(async (r) => ({ ...r, backed: (await campaignStats(r.c.id)).pledged })));
  return withCounts.sort((a, b) => (a.c.goal - a.backed) - (b.c.goal - b.backed)).slice(0, 3);
}
