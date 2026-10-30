import { and, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { fanEmailAction, waitlistAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { Countdown } from "@/components/Countdown";
import { ShadeSun } from "@/components/ShadeSun";
import { ShareKit } from "@/components/ShareKit";
import { StickyBuy } from "@/components/StickyBuy";
import { TileSweep } from "@/components/TileSweep";
import { campaignStats } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { campaigns, designs, media, pledges, users } from "@/lib/db/schema";
import { campaignTarget, currentFan, designerTarget, referralStats, waitlistCount } from "@/lib/fans";
import { ago, money, nextStretch } from "@/lib/format";
import { GARMENT, REFERRALS_PER_REWARD, RETURN_WINDOW_DAYS, SIZES, STRETCH_REWARDS } from "@/lib/rules";
import { productUrl } from "@/lib/shopify/campaigns";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

const PUBLIC = ["live", "closing", "funded", "in_production", "shipped", "missed"];
const COUNTING = ["pledged", "charged", "charge_failed"] as const;

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
    description: `A colour-changing shirt that comes alive in the sun. ${data.stats.pledged} of ${data.c.goal} pre-orders.`,
    openGraph: image ? { images: [`${config().APP_URL}${fileUrl(image.key)}`] } : undefined,
  };
}

export default async function CampaignPage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string; confirmed?: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { c, designer, files, stats } = data;
  const q = await searchParams;
  const ref = q.ref ?? designer.handle;
  const d = await db();
  const recent = await d
    .select({ size: pledges.size, quantity: pledges.quantity, city: pledges.city, at: pledges.createdAt })
    .from(pledges)
    .where(and(eq(pledges.campaignId, c.id), inArray(pledges.status, [...COUNTING])))
    .orderBy(desc(pledges.createdAt))
    .limit(6);
  const fan = await currentFan();
  const referrals = fan && (await referralStats(fan));
  const video = files.find((m) => m.kind === "video");
  const mockups = files.filter((m) => m.kind === "mockup");
  const sweep = files.find((m) => m.kind === "sweep");
  const pairShade = mockups.find((m) => m.template === "flat-square" && m.view === "shade");
  const pairSun = mockups.find((m) => m.template === "flat-square" && m.view === "sun");
  const target = nextStretch(stats.pledged, c.goal, c.stretchGoals) ?? stats.pledged;
  const pct = Math.min(100, Math.round((stats.pledged / Math.max(target, 1)) * 100));
  const pageUrl = `${config().APP_URL}/c/${c.slug}`;
  const open = c.status === "live";
  const missed = c.status === "missed";
  const goals = [c.goal, ...c.stretchGoals];
  const toGo = c.goal - stats.pledged;
  const buyUrl = c.shopifyHandle ? productUrl(c.shopifyHandle, ref) : undefined;
  // Shares keep whichever link brought this visitor, so the designer or fan still gets the credit.
  const shareUrl = `${pageUrl}?ref=${ref}`;
  const share = encodeURIComponent(`${c.title}: a shirt that changes colour in the sun ${shareUrl}`);
  const comebackList = missed ? await waitlistCount(campaignTarget(c)) : 0;

  return (
    <>
      <div className="pair">
        <div>
          {sweep && pairShade ? (
            <div className="tile-art hero-sweep">
              <img className="art" src={fileUrl(pairShade.key)} alt={c.title} />
              <TileSweep src={fileUrl(sweep.key)} inView />
            </div>
          ) : video ? <video className="art" src={fileUrl(video.key)} autoPlay muted loop playsInline /> : null}
        </div>
        <div>
          <div className="eyebrow">{missed ? "Campaign ended" : "Pre-order campaign"}</div>
          <h1>{c.title}</h1>
          <p className="muted">Designed by <Link href={`/d/${designer.handle}`}>{designer.name}</Link></p>
          <p>{c.story}</p>
          <div className="edition-badge">
            {c.editionSize ? <>Numbered limited edition · <b>{c.editionSize}</b> made, never restocked</>
              : <>Numbered limited edition · every shirt gets its own number, no restocks</>}
          </div>
          {!missed && <p><span className="stat">{money(c.priceCents, c.currency)}</span> <span className="muted">· sizes S–XL · ships in the US</span></p>}

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
              <div className="progress"><div style={{ "--w": `${pct}%` } as React.CSSProperties} /></div>
              <p>
                <strong>{stats.pledged} of {target}</strong> pre-orders
                {open && !c.fundedAt && toGo > 0 && <> · <span className="to-go">{toGo} to go</span></>}
                {open && c.endsAt && <> · <Countdown endsAt={c.endsAt.toISOString()} /></>}
                {c.fundedAt && <> · <span className="good">Funded, going to print</span></>}
              </p>
              <div id="buy">
                {open && (buyUrl
                  ? <a className="button" href={buyUrl}>Pre-order now</a>
                  // Launch always creates the store product, so only seeded demo campaigns land here.
                  : <><span className="button" aria-disabled="true">Pre-order now</span>
                    <p className="small muted">Checkout opens once this campaign is linked to the store.</p></>)}
              </div>
              <ul className="promise">
                {c.fundedAt
                  ? <li><b>Funded.</b> Pre-orders are charged now and go straight to print.</li>
                  : <li><b>No risk.</b> You&apos;re only charged if it reaches {c.goal}. If it doesn&apos;t, nobody pays.</li>}
                <li><b>Numbered edition.</b> Ships about 3–4 weeks after the campaign closes, with tracking.</li>
                <li><b>Returns.</b> Within {RETURN_WINDOW_DAYS} days of delivery. <Link href="/pre-orders">How pre-orders work</Link></li>
              </ul>
              <details className="garment">
                <summary>Size, fabric &amp; care</summary>
                <ul>
                  <li><b>Sizes</b> {SIZES.join(", ")}, unisex.</li>
                  {GARMENT.fabric && <li><b>Fabric</b> {GARMENT.fabric}</li>}
                  {GARMENT.fit && <li><b>Fit</b> {GARMENT.fit}</li>}
                  <li><b>The colour change</b> Grey line art indoors and in shade. In direct sun the print turns full colour in seconds, and fades back once you&apos;re out of the sun. On cloudy days it still changes, just lighter; most glass blocks the UV.</li>
                  <li><b>Care</b> Wash inside out in cold water and hang to dry out of direct sun. Don&apos;t bleach, tumble dry or iron the print.</li>
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
                <a className="chip" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`}>Facebook</a>
                <a className="chip" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${share}`}>X</a>
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
        <section className="goals">
          <div className="eyebrow">Goals</div>
          <h2 style={{ marginTop: 8 }}>The more people back it, the more it unlocks</h2>
          <ol className="goal-track">
            {goals.map((g, i) => {
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

      {open && (
        <section className="card fan-link">
          <div>
            <div className="eyebrow">Bring {REFERRALS_PER_REWARD} friends, get a free tee</div>
            <h2 style={{ margin: "8px 0" }}>Get your own link</h2>
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

      {pairShade && pairSun && (
        <>
          <div className="eyebrow" style={{ marginTop: 48 }}>Try it</div>
          <h2 style={{ marginTop: 8 }}>Drag the sun across it</h2>
          <div style={{ maxWidth: 560 }}><ShadeSun shade={fileUrl(pairShade.key)} sun={fileUrl(pairSun.key)} alt={c.title} /></div>
        </>
      )}
      <div className="grid" style={{ marginTop: 24 }}>
        {mockups.map((m) => <img key={m.id} className="art" src={fileUrl(m.key)} alt={`${c.title} ${m.view}`} />)}
      </div>

      <section className="card follow">
        <div>
          <div className="eyebrow">Designer</div>
          <h3><Link href={`/d/${designer.handle}`}>{designer.name}</Link></h3>
          <p className="small muted">Get an email when {designer.name.split(" ")[0]} launches a new design.</p>
        </div>
        <ActionForm action={waitlistAction} submit="Follow" className="inline-form">
          <input type="hidden" name="target" value={designerTarget(designer.id)} />
          <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
        </ActionForm>
      </section>

      {open && (
        <StickyBuy watch="buy" href={buyUrl} price={money(c.priceCents, c.currency)} progress={`${stats.pledged} of ${target}`}>
          {c.endsAt && <Countdown endsAt={c.endsAt.toISOString()} />}
        </StickyBuy>
      )}
    </>
  );
}
