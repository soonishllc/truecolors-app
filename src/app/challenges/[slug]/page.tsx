import { and, eq, isNotNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import Link from "next/link";
import { enterChallengeAction, fanEmailAction, voteAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ShadeSun } from "@/components/ShadeSun";
import { currentUser } from "@/lib/auth/session";
import { challengeBySlug, entries, phase } from "@/lib/challenges";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { designs } from "@/lib/db/schema";
import { currentFan } from "@/lib/fans";
import { date, daysLeft } from "@/lib/format";
import { ShareKit } from "@/components/ShareKit";
import { onShirts } from "@/lib/media/shots";
import { fileUrl, thumbUrl } from "@/lib/storage";
import { publicUrl } from "@/lib/links";

export const dynamic = "force-dynamic";

export default async function ChallengePage({
  params, searchParams,
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ vote?: string; confirmed?: string }> }) {
  const ch = await challengeBySlug((await params).slug);
  if (!ch) notFound();
  const q = await searchParams;
  const p = phase(ch);
  const fan = await currentFan();
  const user = await currentUser();
  const list = await onShirts(await entries(ch.id, fan?.id), (e) => e.designId);
  const total = list.reduce((s, e) => s + e.votes, 0);
  const mine = user && p === "open"
    ? await (await db()).select().from(designs).where(and(eq(designs.userId, user.id), isNotNull(designs.compositeKey)))
    : [];
  const url = publicUrl(`/challenges/${ch.slug}`);

  return (
    <>
      <section className="challenge-head">
        <div className="eyebrow">Design challenge · {p === "open" ? "taking entries" : p === "voting" ? "voting" : "finished"}</div>
        <h1>{ch.title}</h1>
        <p className="lead">{ch.brief}</p>
        <div className="row">
          <span className="pill-stat light"><b>Prize</b> {ch.prize}</span>
          {p === "open" && <span className="pill-stat light">Entries close in <b>{daysLeft(ch.submitBy)}</b> days</span>}
          {p !== "closed" && <span className="pill-stat light">Voting closes in <b>{daysLeft(ch.voteBy)}</b> days</span>}
          {p === "closed" && <span className="pill-stat light">Ended {date(ch.voteBy)}</span>}
          <span className="pill-stat light"><b>{total}</b> votes</span>
        </div>
      </section>

      {p !== "closed" && !fan && (
        <div className={`card vote-gate${q.vote ? " flash" : ""}`}>
          <p><strong>Confirm your email to vote.</strong> One tap from your inbox, then you can vote for as many designs as you like, once each.</p>
          <ActionForm action={fanEmailAction} submit="Email me a link" className="inline-form">
            <input type="hidden" name="next" value={`/challenges/${ch.slug}`} />
            <input type="hidden" name="why" value="vote" />
            <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
          </ActionForm>
        </div>
      )}
      {q.confirmed && fan && <p className="notice good-notice">You&apos;re confirmed. Tap ♥ on the designs you want made.</p>}

      {mine.length > 0 && (
        <div className="card enter">
          <div className="eyebrow">Designers</div>
          <ActionForm action={enterChallengeAction} submit="Enter this design" className="inline-form">
            <input type="hidden" name="challengeId" value={ch.id} />
            <input type="hidden" name="slug" value={ch.slug} />
            <select name="designId" aria-label="Design">{mine.map((m) => <option key={m.id} value={m.id}>{m.title}</option>)}</select>
          </ActionForm>
        </div>
      )}

      <div className="section-head">
        <h2>{p === "closed" ? "Results" : "Entries"}</h2>
        <span className="small muted">{list.length} design{list.length === 1 ? "" : "s"}</span>
      </div>
      {list.length === 0 && <p className="muted">No entries yet.</p>}
      <div className="grid entries">
        {list.map((e, i) => (
          <div key={e.id} className={`entry${p === "closed" && i === 0 && e.votes > 0 ? " winner" : ""}`}>
            <a href={`#entry-${e.id}`} className="tile-art" aria-label={`See ${e.title} up close`}>
              {e.lineArt && <img className="art" src={thumbUrl(e.lineArt, 320)} loading="lazy" decoding="async" alt="" />}
              {e.art && <img className="art tile-sun" src={thumbUrl(e.art, 320)} loading="lazy" decoding="async" alt="" />}
              {p === "closed" && i === 0 && e.votes > 0 && <span className="winner-badge">☀ Winner</span>}
            </a>
            {/* Opens over the page when its link is followed (CSS :target), so it works without any script. */}
            <div id={`entry-${e.id}`} className="entry-zoom" role="dialog" aria-label={e.title}>
              <a href="#" className="entry-zoom-backdrop" aria-label="Close" />
              <div className="entry-zoom-card">
                <a href="#" className="entry-zoom-close" aria-label="Close">×</a>
                {e.lineArt && e.art
                  ? <ShadeSun shade={fileUrl(e.lineArt)} sun={fileUrl(e.art)} alt={e.title} />
                  : e.art && <img className="art" src={thumbUrl(e.art, 320)} loading="lazy" decoding="async" alt={e.title} />}
                <div className="entry-row">
                  <div>
                    <div className="name">{e.title}</div>
                    <div className="meta">by <Link href={`/d/${e.handle}`}>{e.designer}</Link></div>
                  </div>
                  <form action={voteAction}>
                    <input type="hidden" name="entryId" value={e.id} />
                    <input type="hidden" name="slug" value={ch.slug} />
                    <button className={`vote${e.mine ? " on" : ""}`} disabled={p === "closed"} aria-pressed={e.mine} aria-label={`Vote for ${e.title}`}>
                      <span aria-hidden="true">{e.mine ? "♥" : "♡"}</span> {e.votes}
                    </button>
                  </form>
                </div>
                {e.campaignSlug && (
                  <Link href={`/c/${e.campaignSlug}`} className="button entry-buy">
                    {e.campaignLive ? "Pre-order this design" : "See the campaign"}
                  </Link>
                )}
              </div>
            </div>
            <div className="entry-row">
              <div>
                <a href={`#entry-${e.id}`} className="name entry-name">{e.title}</a>
                <div className="meta">by <Link href={`/d/${e.handle}`}>{e.designer}</Link></div>
                {e.campaignSlug && (
                  <Link href={`/c/${e.campaignSlug}`} className="entry-campaign">{e.campaignLive ? "Pre-order →" : "See campaign →"}</Link>
                )}
              </div>
              <form action={voteAction}>
                <input type="hidden" name="entryId" value={e.id} />
                <input type="hidden" name="slug" value={ch.slug} />
                <button className={`vote${e.mine ? " on" : ""}`} disabled={p === "closed"} aria-pressed={e.mine} aria-label={`Vote for ${e.title}`}>
                  <span aria-hidden="true">{e.mine ? "♥" : "♡"}</span> {e.votes}
                </button>
              </form>
            </div>
            {total > 0 && <div className="vote-bar"><div style={{ width: `${(e.votes / Math.max(...list.map((x) => x.votes), 1)) * 100}%` }} /></div>}
          </div>
        ))}
      </div>

      {p !== "closed" && (
        <section className="card" style={{ marginTop: 32 }}>
          <div className="eyebrow">Share the challenge</div>
          <ShareKit url={url} text={`Vote for the next Truecolors shirt: ${ch.title}`} />
        </section>
      )}
    </>
  );
}
