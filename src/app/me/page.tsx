import type { Metadata } from "next";
import Link from "next/link";
import { fanEmailAction, fanSignOutAction, unfollowAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { StoreSignIn } from "@/components/StoreSignIn";
import { ShareKit } from "@/components/ShareKit";
import { campaignStats } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { currentFan, fanFollowing, fanPreorders, fanVotes, referralStats } from "@/lib/fans";
import { date, daysLeft } from "@/lib/format";
import { REFERRALS_PER_REWARD } from "@/lib/rules";
import { onShirts } from "@/lib/media/shots";
import { fileUrl } from "@/lib/storage";
import { publicUrl } from "@/lib/links";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My pre-orders · Truecolors" };

// What a pre-order's status means to the person who placed it.
function stateOf(p: { status: string }, c: { status: string; goal: number }, backed: number) {
  if (p.status === "refunded") return { label: "Refunded", tone: "missed" };
  if (p.status === "cancelled") return c.status === "missed" ? { label: "Not charged: goal missed", tone: "missed" } : { label: "Cancelled", tone: "missed" };
  if (c.status === "shipped") return { label: "Shipped", tone: "funded" };
  if (c.status === "in_production") return { label: "Being printed", tone: "funded" };
  if (p.status === "charged") return { label: c.status === "funded" ? "Funded, going to print" : "Charged, goal reached", tone: "funded" };
  if (p.status === "charge_failed") return { label: "Card declined: update it on your order", tone: "missed" };
  return { label: `Waiting for ${c.goal - backed} more`, tone: "live" };
}

export default async function Me({ searchParams }: { searchParams: Promise<{ confirmed?: string }> }) {
  const fan = await currentFan();
  if (!fan) {
    return (
      <div className="narrow">
        <div className="eyebrow">Fans</div>
        <h1>My pre-orders</h1>
        <StoreSignIn back="/me">
          <p className="muted">Sign in to see your pre-orders, edition numbers, referral link and votes.</p>
        </StoreSignIn>
        <p className="muted site-only">
          Enter the email you used at checkout. We&apos;ll send a link that opens your pre-orders, your edition numbers,
          your referral link and your votes. No password needed.
        </p>
        <div className="card site-only">
          <ActionForm action={fanEmailAction} submit="Email me a link" className="inline-form">
            <input type="hidden" name="next" value="/me" />
            <input type="hidden" name="why" value="orders" />
            <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" autoComplete="email" />
          </ActionForm>
        </div>
      </div>
    );
  }

  const q = await searchParams;
  const [orders, votes, following, referrals] = await Promise.all([
    fanPreorders(fan).then((o) => onShirts(o, (x) => x.c.designId)), fanVotes(fan.id), fanFollowing(fan.email), referralStats(fan),
  ]);
  const backedBy = new Map(await Promise.all(
    [...new Set(orders.map((o) => o.c.id))].map(async (id) => [id, (await campaignStats(id)).pledged] as const),
  ));
  const live = [...new Map(orders.filter((o) => o.c.status === "live").map((o) => [o.c.id, o.c])).values()];
  const shirts = orders.filter((o) => ["pledged", "charged", "charge_failed"].includes(o.p.status)).reduce((s, o) => s + o.p.quantity, 0);
  const toNext = REFERRALS_PER_REWARD - (referrals.charged % REFERRALS_PER_REWARD);

  return (
    <div className="fan-page">
      <section className="fan-head">
        <div>
          <div className="eyebrow">Fans</div>
          <h1>My pre-orders</h1>
          <p className="small muted">{fan.email}</p>
        </div>
        <div className="kpis fan-kpis">
          <div className="kpi"><div className="eyebrow">Shirts</div><div className="kpi-num">{shirts}</div></div>
          <div className="kpi"><div className="eyebrow">Through your link</div><div className="kpi-num">{referrals.charged + referrals.pending}</div></div>
          <div className="kpi"><div className="eyebrow">Free tees</div><div className="kpi-num">{referrals.rewards.length}</div></div>
          <div className="kpi"><div className="eyebrow">Votes</div><div className="kpi-num">{votes.length}</div></div>
        </div>
      </section>
      {q.confirmed && <p className="notice good-notice">You&apos;re in. This page remembers you on this device.</p>}

      <h2>Pre-orders</h2>
      {orders.length === 0 && (
        <div className="card empty">
          <p>No pre-orders with this email yet. If you used a different email at checkout, sign out and use that one.</p>
          <p style={{ marginTop: 12 }}><Link className="button small" href="/explore">Explore designs</Link></p>
        </div>
      )}
      <div className="orders">
        {orders.map(({ p, c, lineArt, art, designer, editions }) => {
          const backed = backedBy.get(c.id) ?? 0;
          const state = stateOf(p, c, backed);
          return (
            <article key={p.id} className="card order">
              <Link href={`/c/${c.slug}`} className="tile-art order-art">
                {lineArt && <img className="art" src={fileUrl(lineArt)} alt="" />}
                {art && <img className="art tile-sun" src={fileUrl(art)} alt="" />}
              </Link>
              <div className="order-body">
                <div className="order-top">
                  <div>
                    <Link href={`/c/${c.slug}`} className="campaign-title">{c.title}</Link>
                    <div className="small muted">by {designer} · {p.quantity > 1 ? `${p.quantity}× ` : ""}{p.size} · order {p.orderName} · {date(p.createdAt)}</div>
                  </div>
                  <span className={`badge status-${state.tone}`}>{state.label}</span>
                </div>
                {editions.length > 0 ? (
                  <div className="edition-numbers">
                    {editions.map((n) => <span key={n} className="edition-no">#{n}<small> of {c.editionSize}</small></span>)}
                  </div>
                ) : c.status === "live" && ["pledged", "charged", "charge_failed"].includes(p.status) ? (
                  <>
                    <div className="progress"><div style={{ "--w": `${Math.min(100, (backed / c.goal) * 100)}%` } as React.CSSProperties} /></div>
                    <p className="small muted" style={{ margin: "6px 0 0" }}>
                      {backed} of {c.goal} · {daysLeft(c.endsAt)} days left · your edition number arrives when it closes
                    </p>
                  </>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      <div className="pair fan-cols">
        <section>
          <h2>Your link</h2>
          <div className="card">
            <p className="small muted" style={{ marginTop: 0 }}>
              Every {REFERRALS_PER_REWARD} pre-orders that come through your link earn you a free tee once they&apos;re charged.
              {referrals.charged > 0 && ` ${toNext} more for the next one.`}
            </p>
            <div className="progress"><div style={{ "--w": `${((referrals.charged % REFERRALS_PER_REWARD) / REFERRALS_PER_REWARD) * 100}%` } as React.CSSProperties} /></div>
            <p className="small muted">
              {referrals.charged} charged{referrals.pending > 0 && `, ${referrals.pending} waiting for their goal`}
            </p>
            {referrals.rewards.length > 0 && (
              <div className="reward-codes">
                {referrals.rewards.map((r) => <code key={r.id}>{r.code}</code>)}
                <p className="small muted">Use a code at checkout on the store for a free tee.</p>
              </div>
            )}
            {live.length > 0 ? live.map((c) => (
              <div key={c.id} className="fan-share">
                <div className="small"><strong>{c.title}</strong></div>
                <ShareKit url={publicUrl(`/c/${c.slug}?ref=${fan.referralCode}`)} text={`This shirt changes colour in the sun. Help get "${c.title}" printed:`} />
              </div>
            )) : (
              <p className="small">Your code is <code>{fan.referralCode}</code>. Open any live design from <Link href="/explore">Explore</Link> to get its link.</p>
            )}
          </div>
        </section>

        <section>
          <h2>Your votes</h2>
          <div className="card">
            {votes.length === 0 ? <p className="small muted" style={{ margin: 0 }}>No votes yet. <Link href="/challenges">See the challenges</Link>.</p> : (
              <ul className="mini-list">
                {votes.map((v, i) => (
                  <li key={i}>
                    {v.art && <img src={fileUrl(v.art)} alt="" />}
                    <span><strong>{v.title}</strong><span className="small muted"> in <Link href={`/challenges/${v.slug}`}>{v.challenge}</Link></span></span>
                    <span className="small muted">♥</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <h2>Following</h2>
          <div className="card">
            {following.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Follow a designer from their page to hear when they launch.</p> : (
              <ul className="mini-list">
                {following.map((f) => (
                  <li key={f.target}>
                    <span>{f.href ? <Link href={f.href}>{f.label}</Link> : f.label}</span>
                    <form action={unfollowAction}>
                      <input type="hidden" name="target" value={f.target} />
                      <button className="link small">Stop</button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <form action={fanSignOutAction} style={{ marginTop: 32 }}><button className="secondary small">Sign out on this device</button></form>
    </div>
  );
}
