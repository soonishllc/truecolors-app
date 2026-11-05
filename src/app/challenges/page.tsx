import Link from "next/link";
import { listChallenges, phase } from "@/lib/challenges";
import { date, daysLeft } from "@/lib/format";

export const dynamic = "force-dynamic";

const LABEL = { open: "Taking entries", voting: "Voting", closed: "Finished" } as const;

export default async function Challenges() {
  const list = await listChallenges();
  return (
    <>
      <div className="eyebrow">Design challenges</div>
      <h1>Vote for what gets made</h1>
      <p className="muted" style={{ maxWidth: 560 }}>
        Each challenge has a theme. Designers enter, you vote, and the winning design launches as a campaign.
      </p>
      {list.length === 0 && (
        <div className="card empty-card">
          <div className="eyebrow">Coming soon</div>
          <h2 style={{ margin: "8px 0" }}>The first challenge drops soon</h2>
          <p className="muted">Until then, the community&apos;s designs are live now, and every one needs backers to get printed.</p>
          <Link href="/explore" className="button">Back a design</Link>
        </div>
      )}
      <div className="challenge-list">
        {list.map((ch) => {
          const p = phase(ch);
          return (
            <Link key={ch.id} href={`/challenges/${ch.slug}`} className={`card challenge-card ${p}`}>
              <span className={`badge phase-${p}`}>{LABEL[p]}</span>
              <h2>{ch.title}</h2>
              <p className="small muted">{ch.brief.slice(0, 160)}{ch.brief.length > 160 ? "…" : ""}</p>
              <p className="small">
                <strong>Prize:</strong> {ch.prize}<br />
                {p === "open" && <>Entries close in {daysLeft(ch.submitBy)} days</>}
                {p === "voting" && <>Voting closes in {daysLeft(ch.voteBy)} days</>}
                {p === "closed" && <>Ended {date(ch.voteBy)}</>}
              </p>
            </Link>
          );
        })}
      </div>
    </>
  );
}
