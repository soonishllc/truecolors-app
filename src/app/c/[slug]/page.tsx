import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShadeSun } from "@/components/ShadeSun";
import { campaignStats } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { campaigns, designs, media, users } from "@/lib/db/schema";
import { daysLeft, money, nextStretch } from "@/lib/format";
import { productUrl } from "@/lib/shopify/campaigns";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

const PUBLIC = ["live", "closing", "funded", "in_production", "shipped"];

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
}: { params: Promise<{ slug: string }>; searchParams: Promise<{ ref?: string }> }) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { c, designer, files, stats } = data;
  const ref = (await searchParams).ref ?? designer.handle;
  const video = files.find((m) => m.kind === "video");
  const mockups = files.filter((m) => m.kind === "mockup");
  const pairShade = mockups.find((m) => m.template === "flat-square" && m.view === "shade");
  const pairSun = mockups.find((m) => m.template === "flat-square" && m.view === "sun");
  const target = nextStretch(stats.pledged, c.goal, c.stretchGoals) ?? stats.pledged;
  const pct = Math.min(100, Math.round((stats.pledged / Math.max(target, 1)) * 100));
  const pageUrl = `${config().APP_URL}/c/${c.slug}?ref=${designer.handle}`;
  const share = encodeURIComponent(`${c.title}: a shirt that changes colour in the sun ${pageUrl}`);
  const open = c.status === "live";

  return (
    <>
      <div className="pair">
        <div>{video ? <video className="art" src={fileUrl(video.key)} autoPlay muted loop playsInline /> : null}</div>
        <div>
          <div className="eyebrow">Pre-order campaign</div>
          <h1>{c.title}</h1>
          <p className="muted">Designed by {designer.name}</p>
          <p>{c.story}</p>
          <p><span className="stat">{money(c.priceCents, c.currency)}</span> <span className="muted">· sizes S–XL · ships in the US</span></p>
          <div className="progress"><div style={{ "--w": `${pct}%` } as React.CSSProperties} /></div>
          <p>
            <strong>{stats.pledged} of {target}</strong> pre-orders
            {open && <> · {daysLeft(c.endsAt)} days left</>}
            {c.fundedAt && <> · <span className="good">Funded, going to print</span></>}
          </p>
          {open && c.shopifyHandle && (
            <a className="button" href={productUrl(c.shopifyHandle, ref)}>Pre-order now</a>
          )}
          <p className="small muted">
            You&apos;re only charged once this design reaches {c.goal} pre-orders. If it doesn&apos;t, nobody pays. Shirts
            ship about 3–4 weeks after the campaign closes.
          </p>
          <div className="row small">
            <a href={`https://wa.me/?text=${share}`}>WhatsApp</a>
            <a href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(pageUrl)}`}>Facebook</a>
            <a href={`https://twitter.com/intent/tweet?text=${share}`}>X</a>
            {video && <a href={fileUrl(video.key)} download>Download video</a>}
          </div>
        </div>
      </div>
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
    </>
  );
}
