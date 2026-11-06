import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waitlistAction } from "@/app/actions";
import { designerStats, publicCampaigns } from "@/app/designers/query";
import { ActionForm } from "@/components/ActionForm";
import { DesignerAvatar } from "@/components/DesignerChip";
import { ProviderIcon } from "@/components/SocialButtons";
import { TileSweep } from "@/components/TileSweep";
import { currentUser } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { identities, users } from "@/lib/db/schema";
import { designerTarget, waitlistCount } from "@/lib/fans";
import { compact, daysLeft } from "@/lib/format";
import { fileUrl, thumbUrl } from "@/lib/storage";
import "@/app/designers/designers.css";

export const dynamic = "force-dynamic";

const PROFILE_URL: Record<string, (u: string) => string> = {
  instagram: (u) => `https://instagram.com/${u}`,
  tiktok: (u) => `https://www.tiktok.com/@${u}`,
  x: (u) => `https://x.com/${u}`,
};

async function load(handle: string) {
  const d = await db();
  const [designer] = await d.select().from(users).where(eq(users.handle, handle.toLowerCase()));
  return designer;
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const designer = await load((await params).handle);
  if (!designer) return {};
  return { title: `${designer.name} · Truecolors`, description: designer.bio ?? `Shirts designed by ${designer.name} on Truecolors.` };
}

// A designer's public page: who they are, what they've made and a way to hear about their next launch.
export default async function DesignerPage({ params }: { params: Promise<{ handle: string }> }) {
  const designer = await load((await params).handle);
  if (!designer) notFound();
  const d = await db();
  const [list, ids, followers, viewer] = await Promise.all([
    publicCampaigns([designer.id]),
    d.select().from(identities).where(eq(identities.userId, designer.id)),
    waitlistCount(designerTarget(designer.id)),
    currentUser(),
  ]);
  const stats = designerStats(list);
  // The Instagram they typed on their profile comes first; connected accounts add the rest (and follower counts).
  const socials = ids
    .filter((i) => i.username && PROFILE_URL[i.provider])
    .filter((i) => !(i.provider === "instagram" && designer.instagram && i.username!.toLowerCase() === designer.instagram));
  const firstName = designer.name.split(" ")[0];
  const own = viewer?.id === designer.id;

  return (
    <div className="dz-page">
      <section className="dz-head">
        <DesignerAvatar name={designer.name} avatarKey={designer.avatarKey} size="lg" />
        <div className="dz-head-text">
          <div className="eyebrow">Truecolors designer</div>
          <h1>{designer.name}</h1>
          {designer.location && <div className="dz-location">{designer.location}</div>}
          {designer.bio && <p className="dz-bio">{designer.bio}</p>}
          <div className="dz-links">
            {designer.instagram && (
              <a className="social-link" href={PROFILE_URL.instagram(designer.instagram)} target="_blank" rel="noreferrer">
                <ProviderIcon provider="instagram" />@{designer.instagram}
              </a>
            )}
            {socials.map((s) => (
              <a key={s.id} className="social-link" href={PROFILE_URL[s.provider](s.username!)} target="_blank" rel="noreferrer">
                <ProviderIcon provider={s.provider} />@{s.username}{s.followers ? ` · ${compact(s.followers)}` : ""}
              </a>
            ))}
            {own && <Link href="/studio/profile" className="dz-edit">Edit your profile</Link>}
          </div>
        </div>
      </section>

      <dl className="dz-stats">
        <div><dt>Designs launched</dt><dd>{stats.launched}</dd></div>
        <div><dt>Shirts pre-ordered</dt><dd>{compact(stats.preordered)}</dd></div>
        <div><dt>Funded</dt><dd>{stats.funded}</dd></div>
        {followers > 0 && <div><dt>Following</dt><dd>{compact(followers)}</dd></div>}
      </dl>

      <section className="card dz-follow">
        <p className="small">Get an email when {firstName} launches a new design.</p>
        <ActionForm action={waitlistAction} submit="Follow" className="inline-form">
          <input type="hidden" name="target" value={designerTarget(designer.id)} />
          <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
        </ActionForm>
      </section>

      <h2>Designs</h2>
      {list.length === 0 ? (
        <div className="card dz-empty">
          <span className="dz-empty-sun" aria-hidden="true" />
          <p>Designing now — follow to hear when the first one launches.</p>
        </div>
      ) : (
        <div className="grid">
          {list.map(({ c, lineArt, art, sweep, backed }) => {
            const days = daysLeft(c.endsAt);
            const pct = Math.min(100, (backed / c.goal) * 100);
            const live = c.status === "live" || c.status === "closing";
            return (
              <article key={c.id} className="tile">
                <Link href={`/c/${c.slug}`} className="tile-art">
                  {lineArt && <img className="art" src={thumbUrl(lineArt, 320)} loading="lazy" decoding="async" alt="" />}
                  {art && <img className="art tile-sun" src={thumbUrl(art, 320)} loading="lazy" decoding="async" alt={c.title} />}
                  {sweep && <TileSweep src={fileUrl(sweep)} />}
                  {live && days <= 7 && <span className="corner-badge">Ends in {days}d</span>}
                  {c.editionSize && <span className="corner-badge">Edition of {c.editionSize}</span>}
                </Link>
                <Link href={`/c/${c.slug}`} className="name">{c.title}</Link>
                {c.status !== "missed" && <div className={`progress${backed === 0 ? " empty" : ""}`}><div style={{ "--w": `${pct}%` } as React.CSSProperties} /></div>}
                <div className="meta">
                  {live ? `${backed} of ${c.goal} · ${days}d left`
                    : c.status === "missed" ? `${backed} of ${c.goal} · ask for it back`
                    : `${backed} backed · funded`}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
