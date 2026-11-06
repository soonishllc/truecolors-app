import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { acceptAgreementAction, relaunchAction, submitBriefAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ShareKit } from "@/components/ShareKit";
import { ProviderIcon } from "@/components/SocialButtons";
import { enabledProviders, providerLabel, type Provider } from "@/lib/auth/oauth";
import { connectedAccounts, requireUser } from "@/lib/auth/session";
import { campaignStats } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { campaigns, designs, media, pledges } from "@/lib/db/schema";
import { ago, compact, daysLeft, money, moneyEach, nextStretch } from "@/lib/format";
import { FUNDING_GOAL } from "@/lib/rules";
import { payoutMethod } from "@/lib/payouts/methods";
import { designerEarnings } from "@/lib/royalties/ledger";
import { siteImageUrl } from "@/lib/site-images";
import { fileUrl, thumbUrl } from "@/lib/storage";
import { briefsForDesigner } from "@/lib/wholesale/designs";
import { publicUrl } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio · Truecolors" };

const SPARK_DAYS = 14;
const SHOWN: Provider[] = ["instagram", "tiktok", "x", "google", "apple"];

// What to tell a designer about a live campaign right now, if anything.
function nudge(pledged: number, goal: number, days: number) {
  const left = goal - pledged;
  if (left <= 0) return;
  if (days <= 2) return `Last ${days <= 1 ? "day" : "48 hours"}: this is when most pre-orders land. Post again today.`;
  if (left <= 15) return `Only ${left} to go. Ask your followers to push it over the line.`;
  if (pledged < goal / 2 && days <= 10) return "Halfway is the hardest bit. Post the reveal video: the colour change sells it.";
}

function Ring({ value, goal }: { value: number; goal: number }) {
  const pct = Math.min(1, value / Math.max(goal, 1));
  const r = 34;
  const len = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 80 80" role="img" aria-label={`${value} of ${goal} pre-orders`}>
      <defs>
        <linearGradient id="ring-sun" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#c8336a" /><stop offset=".5" stopColor="#e8762a" /><stop offset="1" stopColor="#c4b200" />
        </linearGradient>
      </defs>
      <circle cx="40" cy="40" r={r} className="ring-track" />
      <circle
        cx="40" cy="40" r={r} className="ring-fill" stroke="url(#ring-sun)"
        style={{ "--len": len, "--off": len * (1 - pct) } as React.CSSProperties}
      />
      <text x="40" y="38" className="ring-num">{value}</text>
      <text x="40" y="53" className="ring-of">of {goal}</text>
    </svg>
  );
}

function Spark({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  const pts = counts.map((c, i) => `${(i / (counts.length - 1)) * 100},${28 - (c / max) * 26}`).join(" ");
  return (
    <svg className="spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={`0,30 ${pts} 100,30`} className="spark-area" />
      <polyline points={pts} className="spark-line" />
    </svg>
  );
}

export default async function Studio({ searchParams }: { searchParams: Promise<{ connected?: string; connect?: string; welcome?: string }> }) {
  const user = await requireUser();
  const q = await searchParams;
  const d = await db();
  const mine = await d.select().from(designs).where(eq(designs.userId, user.id)).orderBy(desc(designs.updatedAt));
  const myCampaigns = await d.select().from(campaigns).where(eq(campaigns.userId, user.id)).orderBy(desc(campaigns.createdAt));
  const stats = await Promise.all(myCampaigns.map((c) => campaignStats(c.id)));
  const earnings = await designerEarnings(user.id);
  const accounts = await connectedAccounts(user.id);
  const payout = await payoutMethod(user.id);
  const reach = accounts.reduce((sum, a) => sum + (a.followers ?? 0), 0);
  const agreement = config().DESIGNER_AGREEMENT_VERSION;
  const ids = myCampaigns.map((c) => c.id);
  const counted = inArray(pledges.status, ["pledged", "charge_pending", "charged", "charge_failed"]);

  const since = new Date(Date.now() - (SPARK_DAYS - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const [totals] = ids.length
    ? await d
        .select({
          all: sql<number>`coalesce(sum(${pledges.quantity}), 0)::int`,
          viaLink: sql<number>`coalesce(sum(${pledges.quantity}) filter (where ${pledges.viaDesignerLink}), 0)::int`,
        })
        .from(pledges)
        .where(and(inArray(pledges.campaignId, ids), counted))
    : [{ all: 0, viaLink: 0 }];
  const daily = ids.length
    ? await d
        .select({ day: sql<string>`to_char(${pledges.createdAt}, 'YYYY-MM-DD')`, n: sql<number>`sum(${pledges.quantity})::int` })
        .from(pledges)
        .where(and(inArray(pledges.campaignId, ids), counted, gte(pledges.createdAt, since)))
        .groupBy(sql`1`)
    : [];
  const spark = Array.from({ length: SPARK_DAYS }, (_, i) => {
    const day = new Date(since.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    return daily.find((x) => x.day === day)?.n ?? 0;
  });
  const recent = ids.length
    ? await d
        .select({ p: pledges, title: campaigns.title })
        .from(pledges)
        .innerJoin(campaigns, eq(campaigns.id, pledges.campaignId))
        .where(and(inArray(pledges.campaignId, ids), counted))
        .orderBy(desc(pledges.createdAt))
        .limit(8)
    : [];

  const live = myCampaigns.map((c, i) => ({ c, s: stats[i] })).filter(({ c }) => ["live", "closing", "funded"].includes(c.status));
  const liveMedia = live.length
    ? await d.select().from(media).where(inArray(media.designId, live.map(({ c }) => c.designId)))
    : [];
  const designOf = (id: string) => mine.find((x) => x.id === id);
  const firstName = user.name.split(" ")[0];
  const briefs = await briefsForDesigner(user.id);
  const finished = mine.filter((x) => x.printReport?.ok && x.compositeKey && x.lineArtKey);
  const banner = siteImageUrl("studio-hero");

  return (
    <div className="dashboard">
      <section className={banner ? "dash-head photo" : "dash-head"}>
        {banner && <img className="dash-head-bg" src={banner} alt="" />}
        <div className="dash-head-content">
          <div className="eyebrow">Studio</div>
          <h1>Hi, {firstName}<span className="sun-text">.</span></h1>
          <div className="row">
            <span className="pill-stat"><b>{user.credits}</b> credits</span>
            <Link className="pill-stat" href={`/d/${user.handle}`}>Your page <b>/d/{user.handle}</b></Link>
            <Link className="pill-stat" href="/studio/profile">Edit your profile</Link>
            <Link className="button small" href="/studio/new">＋ New design</Link>
          </div>
        </div>
      </section>

      {q.welcome && <p className="notice">Welcome to the studio. <Link href="/studio/new">Start your first design →</Link></p>}
      {q.connected && <p className="notice good-notice">Connected {providerLabel(q.connected as Provider)}.</p>}
      {q.connect === "taken" && <p className="notice">That account is already connected to another designer.</p>}
      {agreement && user.agreementVersion !== agreement && (
        <form action={acceptAgreementAction} className="notice row">
          <span>The designer agreement has been updated. Accept it before your campaigns can go live.</span>
          <button>Accept agreement</button>
        </form>
      )}

      {/* The numbers once there's something to count; before that they're four boxes of zeros. */}
      {myCampaigns.length > 0 && (
      <div className="kpis">
        <div className="kpi">
          <div className="eyebrow">Pre-orders</div>
          <div className="kpi-num">{totals.all}</div>
          <Spark counts={spark} />
          <div className="kpi-note">last {SPARK_DAYS} days</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">Through your link</div>
          <div className="kpi-num">{totals.all ? Math.round((totals.viaLink / totals.all) * 100) : 0}<small>%</small></div>
          <div className="kpi-note">{totals.viaLink} pre-orders earn you 15% instead of 10%</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">Earned</div>
          <div className="kpi-num">{moneyEach(earnings.totals, "earned")}</div>
          <div className="kpi-note">{moneyEach(earnings.totals, "payable")} ready for the next payout</div>
        </div>
        <div className="kpi">
          <div className="eyebrow">Live campaigns</div>
          <div className="kpi-num">{live.filter(({ c }) => c.status === "live").length}</div>
          <div className="kpi-note">{mine.length} design{mine.length === 1 ? "" : "s"} in your studio</div>
        </div>
      </div>
      )}

      <div className="dash">
        <div className="dash-main">
          {live.length > 0 && <div className="section-head"><h2>Live campaigns</h2></div>}
          {live.map(({ c, s }) => {
            const design = designOf(c.designId);
            const files = liveMedia.filter((m) => m.designId === c.designId);
            const video = files.find((m) => m.kind === "video");
            const image = files.find((m) => m.template === "split-square");
            const days = daysLeft(c.endsAt);
            const target = nextStretch(s.pledged, c.goal, c.stretchGoals) ?? s.pledged;
            const url = publicUrl(`/c/${c.slug}?ref=${user.handle}`);
            const tip = c.status === "live" ? nudge(s.pledged, c.goal, days) : undefined;
            return (
              <article key={c.id} className="campaign card">
                <div className="campaign-art tile-art">
                  {design?.lineArtKey && <img className="art" src={thumbUrl(design.lineArtKey, 320)} alt="" loading="lazy" decoding="async" width={320} height={320} />}
                  {design?.compositeKey && <img className="art tile-sun" src={thumbUrl(design.compositeKey, 320)} alt="" loading="lazy" decoding="async" width={320} height={320} />}
                </div>
                <div className="campaign-body">
                  <div className="campaign-top">
                    <div>
                      <Link href={`/c/${c.slug}`} className="campaign-title">{c.title}</Link>
                      <div className="row small muted">
                        <span className={`badge status-${c.status}`}>{c.status.replace("_", " ")}</span>
                        {c.status === "live" && <span className="countdown">⏱ {days} day{days === 1 ? "" : "s"} left</span>}
                        {s.pledged >= c.goal && <span>Next goal: {target}</span>}
                      </div>
                    </div>
                    <Ring value={s.pledged} goal={s.pledged >= c.goal ? target : c.goal} />
                  </div>
                  {tip && <p className="nudge">☀ {tip}</p>}
                  <ShareKit
                    url={url}
                    text={`My design "${c.title}" changes colour in the sun. Pre-order it before it's gone:`}
                    video={video && fileUrl(video.key)}
                    image={image && fileUrl(image.key)}
                  />
                </div>
              </article>
            );
          })}

          {briefs.length > 0 && (
            <>
              <div className="section-head" id="briefs"><h2>Location briefs</h2></div>
              <p className="small muted">
                Designs for a wholesaler&apos;s city, resort or landmark. Truecolors owns them; you earn your usual share on every shirt sold.
              </p>
              <div className="grid">
                {briefs.map(({ b, w }) => (
                  <div key={b.id} className="card stack">
                    <div className="eyebrow">{b.ref} · {w.name}</div>
                    <p>{b.brief}</p>
                    {b.feedback && b.status === "changes_requested" && <p className="notice small">They asked: “{b.feedback}”</p>}
                    {b.status === "in_review" && <p className="small muted">With the wholesaler for review.</p>}
                    {(b.status === "approved" || b.status === "live") && <p className="small good">Approved{b.status === "live" ? " and in their catalog" : ""}.</p>}
                    {(b.status === "assigned" || b.status === "changes_requested") &&
                      (finished.length ? (
                        <ActionForm action={submitBriefAction} submit="Send for review">
                          <input type="hidden" name="briefId" value={b.id} />
                          <label>Design
                            <select name="designId" defaultValue={b.designId ?? undefined}>
                              {finished.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
                            </select>
                          </label>
                        </ActionForm>
                      ) : (
                        <p className="small muted">Make the design below, colour it and pass the print check, then send it from here.</p>
                      ))}
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="section-head">
            <h2>Your designs</h2>
            <Link href="/studio/new" className="button small secondary">＋ New design</Link>
          </div>
          {mine.length === 0 && (
            <Link href="/studio/new" className="first-design">
              <b>Design your first shirt</b>
              <span className="muted">Describe an idea or snap a sketch. The AI draws it in under a minute.</span>
              <span className="button">Start →</span>
            </Link>
          )}
          <div className="grid designs">
            {mine.map((x) => (
              <Link key={x.id} href={`/studio/designs/${x.id}`} className="tile">
                <div className="tile-art">
                  {x.lineArtKey && <img className="art" src={thumbUrl(x.lineArtKey, 320)} alt="" loading="lazy" decoding="async" width={320} height={320} />}
                  {x.compositeKey && <img className="art tile-sun" src={thumbUrl(x.compositeKey, 320)} alt="" loading="lazy" decoding="async" width={320} height={320} />}
                </div>
                <div className="name">{x.title}</div>
                <div className="meta">
                  {myCampaigns.find((c) => c.designId === x.id)?.status.replace("_", " ") ?? (x.compositeKey ? "coloured" : "line art")}
                </div>
              </Link>
            ))}
          </div>

          {myCampaigns.length > 0 && (
            <>
              <h2>All campaigns</h2>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Design</th><th>Status</th><th>Pre-orders</th><th></th></tr></thead>
                  <tbody>
                    {myCampaigns.map((c, i) => (
                      <tr key={c.id}>
                        <td>{c.status === "live" ? <Link href={`/c/${c.slug}`}>{c.title}</Link> : c.title}</td>
                        <td><span className={`badge status-${c.status}`}>{c.status.replace("_", " ")}</span>{c.reviewNote && <div className="small muted">{c.reviewNote}</div>}</td>
                        <td>{stats[i].pledged} of {c.goal}</td>
                        <td>
                          {c.status === "missed" && !c.relaunchOf && (
                            <form action={relaunchAction}><input type="hidden" name="campaignId" value={c.id} /><button className="secondary small">Relaunch</button></form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <aside className="dash-rail">
          <div className="card rail-card">
            <div className="eyebrow">Activity</div>
            {recent.length === 0 ? <p className="small muted">Pre-orders show up here the moment they come in.</p> : (
              <ul className="feed">
                {recent.map(({ p, title }) => (
                  <li key={p.id}>
                    <span className="feed-dot" aria-hidden="true" />
                    <span>
                      <b>{p.quantity > 1 ? `${p.quantity}× ` : ""}{p.size}</b> pre-ordered · {title}
                      {p.viaDesignerLink && <span className="via"> via your link</span>}
                    </span>
                    <time className="muted">{ago(p.createdAt)}</time>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card rail-card">
            <div className="eyebrow">Earnings</div>
            <dl className="money">
              <div><dt>Earned</dt><dd>{moneyEach(earnings.totals, "earned")}</dd></div>
              <div><dt>Held until returns close</dt><dd>{moneyEach(earnings.totals, "held")}</dd></div>
              <div><dt>Ready for next payout</dt><dd>{moneyEach(earnings.totals, "payable")}</dd></div>
              <div><dt>Paid</dt><dd>{moneyEach(earnings.totals, "paid")}</dd></div>
            </dl>
            <Link href="/studio/payouts" className={payout ? "payout-line" : "payout-line missing"}>
              {payout ? <>Paid by {payout.summary}</> : <>Add how you&apos;d like to be paid →</>}
            </Link>
          </div>

          <div className="card rail-card">
            <div className="eyebrow">Your accounts</div>
            {reach > 0 ? <p className="reach"><b>{compact(reach)}</b> <span className="small muted">followers across your accounts</span></p>
              : <p className="small muted">Connect where your followers are: your reach shows here and on your public profile.</p>}
            <ul className="accounts">
              {SHOWN.map((p) => {
                const acct = accounts.find((a) => a.provider === p);
                const canConnect = enabledProviders().includes(p);
                return (
                  <li key={p}>
                    <ProviderIcon provider={p} />
                    <span>
                      {providerLabel(p)}{acct?.username && <span className="muted"> @{acct.username}</span>}
                      {acct?.followers != null && <span className="muted"> · {compact(acct.followers)}</span>}
                    </span>
                    {acct ? <span className="badge status-funded">Connected</span>
                      : canConnect ? <a className="button small secondary" href={`/auth/${p}`} target="_parent">Connect</a>
                      : <span className="small muted">Soon</span>}
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="card rail-card tips">
            <div className="eyebrow">Get to {FUNDING_GOAL} faster</div>
            <ol>
              <li>Share your own link: you earn 15% on those pre-orders, not 10%.</li>
              <li>Post the reveal video. Shade to sun is the hook.</li>
              <li>Post again at halfway and in the last 48 hours, when most pre-orders land.</li>
            </ol>
          </div>
        </aside>
      </div>
    </div>
  );
}
