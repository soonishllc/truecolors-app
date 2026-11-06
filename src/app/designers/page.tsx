import type { Metadata } from "next";
import Link from "next/link";
import { DesignerChip } from "@/components/DesignerChip";
import { compact } from "@/lib/format";
import { thumbUrl } from "@/lib/storage";
import { listDesigners, type DirectorySort } from "./query";
import "./designers.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Designers · Truecolors", description: "The people behind every Truecolors shirt." };

const SORTS: Record<DirectorySort, string> = { popular: "Most pre-ordered", new: "New" };
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

// Everyone who has put a design out: their face, a few of their shirts and how they're doing.
export default async function Designers({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  const q = await searchParams;
  const sort: DirectorySort = q.sort === "new" ? "new" : "popular";
  const people = await listDesigners(sort);

  return (
    <div className="dz-page">
      <header className="dz-dir-head">
        <div className="eyebrow">Community</div>
        <h1>Designers</h1>
        <p className="muted">The people behind every shirt. Follow one to hear when they launch.</p>
      </header>

      {people.length === 0 ? (
        <section className="card dz-empty dz-cold">
          <span className="dz-empty-sun" aria-hidden="true" />
          <h2>The first designers are joining now</h2>
          <p className="muted">Describe an idea, the AI draws it, and fans pre-order it into being. You could be first on this page.</p>
          <Link href="/join" className="button">Design your own</Link>
        </section>
      ) : (
        <>
          <nav className="dz-sorts small" aria-label="Sort">
            {(Object.keys(SORTS) as DirectorySort[]).map((s) => (
              <Link key={s} href={s === "popular" ? "/designers" : "/designers?sort=new"} className={s === sort ? "on" : undefined} aria-current={s === sort ? "page" : undefined}>
                {SORTS[s]}
              </Link>
            ))}
          </nav>
          <ul className="dz-dir">
            {people.map((p) => (
              <li key={p.id} className="card dz-card">
                <DesignerChip handle={p.handle} name={p.name} avatarKey={p.avatarKey} location={p.location} meta={plural(p.stats.launched, "design")} size="md" />
                {p.bio && <p className="dz-card-bio">{p.bio}</p>}
                <div className="dz-thumbs">
                  {p.thumbs.map(({ c, lineArt, art }) => {
                    const key = art ?? lineArt;
                    return (
                      <Link key={c.id} href={`/c/${c.slug}`} className="dz-thumb" title={c.title}>
                        {key && <img src={thumbUrl(key, 320)} loading="lazy" decoding="async" alt={c.title} />}
                      </Link>
                    );
                  })}
                </div>
                <div className="dz-card-stats">
                  <span><b>{compact(p.stats.preordered)}</b> pre-ordered</span>
                  <span><b>{p.stats.funded}</b> funded</span>
                  {p.stats.live > 0 && <span className="dz-live"><b>{p.stats.live}</b> live now</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
