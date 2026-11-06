import Link from "next/link";
import { Countdown } from "@/components/Countdown";
import { DesignerChip } from "@/components/DesignerChip";
import { TileSweep } from "@/components/TileSweep";
import type { campaigns } from "@/lib/db/schema";
import { daysLeft } from "@/lib/format";
import { fileUrl, thumbUrl } from "@/lib/storage";

export type CardRow = {
  c: typeof campaigns.$inferSelect;
  designer: string;
  handle: string;
  avatarKey?: string | null;
  lineArt: string | null;
  art: string | null;
  sweep?: string;
  // From cardStats (lib/campaign-card.ts).
  backed: number;
  today?: number;
  lastCity?: string | null;
  lastAt?: string | null;
};

const DAY = 86_400_000;

function ago(at: string) {
  const mins = Math.max(1, Math.round((Date.now() - new Date(at).getTime()) / 60_000));
  return mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.round(mins / 60)}h ago` : `${Math.round(mins / 1440)}d ago`;
}

// A design as a card, made to be scrolled past slowly: the shirt big, with what's happening on it on the picture
// itself (the time running out, how close it is) and, under it, who made it, how many to go and the latest backer.
// Hovering (or scrolling it into view on a phone) sweeps the sun across it.
export function CampaignCard({ row, price, width = 640 }: { row: CardRow; price?: string; width?: 320 | 640 }) {
  const { c, backed: n } = row;
  const live = c.status === "live" || c.status === "closing";
  const left = c.endsAt ? c.endsAt.getTime() - Date.now() : Infinity;
  const pct = Math.min(100, Math.round((n / c.goal) * 100));
  const fresh = c.startsAt && Date.now() - c.startsAt.getTime() < 3 * DAY;
  const status = c.status === "shipped" ? "Shipped" : c.status === "in_production" ? "Printing" : c.status === "funded" ? "Funded ✓" : c.status === "missed" ? "Bring it back" : undefined;
  // The one thing that matters most right now, on the picture: time running out, then nearly there, then new.
  const badge = live && c.endsAt && left < 2 * DAY ? <span className="ccard-badge hot">⏱ <Countdown endsAt={c.endsAt.toISOString()} /></span>
    : live && pct >= 75 ? <span className="ccard-badge hot">Almost there</span>
    : live && daysLeft(c.endsAt) <= 7 ? <span className="ccard-badge">Ends in {daysLeft(c.endsAt)}d</span>
    : live && fresh ? <span className="ccard-badge">New</span>
    : status ? <span className="ccard-badge">{status}</span> : null;
  const href = `/c/${c.slug}`;
  return (
    <article className={`ccard${live ? " live" : ""}`}>
      <Link href={href} className="tile-art ccard-art" aria-label={c.title}>
        {row.lineArt && <img className="art" src={thumbUrl(row.lineArt, width)} loading="lazy" decoding="async" alt="" />}
        {row.art && <img className="art tile-sun" src={thumbUrl(row.art, width)} loading="lazy" decoding="async" alt={c.title} />}
        {row.sweep && <TileSweep src={fileUrl(row.sweep)} />}
        <span className="ccard-glint" aria-hidden="true" />
        {badge}
        {c.editionSize && <span className="ccard-edition">Edition of {c.editionSize}</span>}
        {live && (
          <span className="ccard-ring" style={{ "--p": pct } as React.CSSProperties} aria-label={`${n} of ${c.goal} pre-ordered`}>
            <b>{n}</b><i>/{c.goal}</i>
          </span>
        )}
      </Link>
      <div className="ccard-body">
        <Link href={href} className="ccard-title">{c.title}</Link>
        <DesignerChip handle={row.handle} name={row.designer} avatarKey={row.avatarKey} size="sm" />
        {live ? (
          <>
            <div className={`progress${n === 0 ? " empty" : ""}`}><div style={{ "--w": `${pct}%` } as React.CSSProperties} /></div>
            <div className="ccard-line">
              <span>{n === 0 ? <b>Be #001</b> : <><b>{c.goal - n > 0 ? c.goal - n : 0}</b> to go</>}</span>
              {price && <span className="ccard-price">{price}</span>}
            </div>
            {/* Somebody else was here: the day's backers, or the latest one's city. */}
            {(row.today ?? 0) > 0 ? <p className="ccard-proof"><span className="ccard-pulse" aria-hidden="true" />{row.today} backed in the last day</p>
              : row.lastAt ? <p className="ccard-proof">Last backed {row.lastCity ? `from ${row.lastCity} ` : ""}{ago(row.lastAt)}</p>
              : <p className="ccard-proof">Nobody yet: the first backer gets shirt #001</p>}
          </>
        ) : (
          <div className="ccard-line"><span>{c.status === "missed" ? `${n} of ${c.goal} · ask for it back` : `${n} backed`}</span></div>
        )}
      </div>
    </article>
  );
}
