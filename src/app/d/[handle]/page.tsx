import { and, desc, eq, inArray } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { waitlistAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProviderIcon } from "@/components/SocialButtons";
import { campaignStats } from "@/lib/campaigns/service";
import { db } from "@/lib/db/client";
import { campaigns, designs, identities, users } from "@/lib/db/schema";
import { designerTarget, waitlistCount } from "@/lib/fans";
import { compact } from "@/lib/format";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

const SHOWN = ["live", "closing", "funded", "in_production", "shipped", "missed"] as const;
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
  return designer ? { title: `${designer.name} · Truecolors Design` } : {};
}

// A designer's public page: their campaigns, their socials and a way to hear about their next launch.
export default async function DesignerPage({ params }: { params: Promise<{ handle: string }> }) {
  const designer = await load((await params).handle);
  if (!designer) notFound();
  const d = await db();
  const list = await d
    .select({ c: campaigns, lineArt: designs.lineArtKey, art: designs.compositeKey })
    .from(campaigns)
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(and(eq(campaigns.userId, designer.id), inArray(campaigns.status, [...SHOWN])))
    .orderBy(desc(campaigns.createdAt));
  const stats = await Promise.all(list.map((x) => campaignStats(x.c.id)));
  const socials = (await d.select().from(identities).where(eq(identities.userId, designer.id)))
    .filter((i) => i.username && PROFILE_URL[i.provider]);
  const followers = await waitlistCount(designerTarget(designer.id));
  const backed = stats.reduce((s, x) => s + x.pledged, 0);

  return (
    <>
      <section className="profile-head">
        <div className="avatar" aria-hidden="true">{designer.name.slice(0, 1)}</div>
        <div>
          <div className="eyebrow">Truecolors designer</div>
          <h1>{designer.name}</h1>
          <div className="row small muted">
            <span>{list.length} design{list.length === 1 ? "" : "s"}</span>
            <span>{backed} pre-orders</span>
            {followers > 0 && <span>{followers} following</span>}
            {socials.map((s) => (
              <a key={s.id} className="social-link" href={PROFILE_URL[s.provider](s.username!)} target="_blank" rel="noreferrer">
                <ProviderIcon provider={s.provider} />@{s.username}{s.followers ? ` · ${compact(s.followers)}` : ""}
              </a>
            ))}
          </div>
        </div>
      </section>
      <section className="card follow">
        <p className="small">Get an email when {designer.name.split(" ")[0]} launches a new design.</p>
        <ActionForm action={waitlistAction} submit="Follow" className="inline-form">
          <input type="hidden" name="target" value={designerTarget(designer.id)} />
          <input name="email" type="email" required placeholder="you@example.com" aria-label="Email" />
        </ActionForm>
      </section>
      <h2>Designs</h2>
      {list.length === 0 && <p className="muted">No designs launched yet. Follow to hear about the first one.</p>}
      <div className="grid">
        {list.map(({ c, lineArt, art }, i) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="tile">
            <div className="tile-art">
              {lineArt && <img className="art" src={fileUrl(lineArt)} alt="" />}
              {art && <img className="art tile-sun" src={fileUrl(art)} alt="" />}
            </div>
            <div className="name">{c.title}</div>
            <div className="meta">
              {c.status === "live" ? `${stats[i].pledged} of ${c.goal} · live` : c.status === "missed" ? "ended · bring it back?" : `edition of ${c.editionSize ?? stats[i].pledged}`}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
