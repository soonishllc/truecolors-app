import { eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { HeroReveal } from "@/components/HeroReveal";
import { campaignStats } from "@/lib/campaigns/service";
import { db } from "@/lib/db/client";
import { campaigns, designs, users } from "@/lib/db/schema";
import { daysLeft, money } from "@/lib/format";
import { FUNDING_GOAL, PRICE_CENTS } from "@/lib/rules";
import { siteImageUrl } from "@/lib/site-images";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function Home() {
  const d = await db();
  const live = await d
    .select({ c: campaigns, name: users.name, art: designs.compositeKey, lineArt: designs.lineArtKey })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(inArray(campaigns.status, ["live", "funded"]));
  const stats = await Promise.all(live.map((x) => campaignStats(x.c.id)));
  const steps = [
    { id: "step-design", title: "Designers create it", text: "Invited designers describe an idea or upload a sketch, and the AI studio turns it into print-ready colour-changing art." },
    { id: "step-preorder", title: "Fans pre-order", text: `Pre-order for ${money(PRICE_CENTS)}. Nobody is charged unless the design reaches ${FUNDING_GOAL}.` },
    { id: "step-print", title: `We print at ${FUNDING_GOAL}`, text: "Funded designs are printed and shipped in batches, and the designer earns on every sale." },
  ];

  return (
    <>
      <HeroReveal sun={siteImageUrl("home-hero-sun")} shade={siteImageUrl("home-hero-shade")}>
        <div className="eyebrow">truecolors.design</div>
        <h1>Designed by you.<br /><span className="sun-text">Funded by fans.</span></h1>
        <p>
          Shirts by our community that change colour in the sun. Pre-order the ones you love: when a design reaches
          100 pre-orders, we print it.
        </p>
      </HeroReveal>
      <div className="eyebrow">How it works</div>
      <div className="steps">
        {steps.map((st, i) => {
          const img = siteImageUrl(st.id);
          return (
            <div key={st.id}>
              {img ? <img className="art" src={img} alt="" /> : <div className="art step-fallback"><span className="sun-text">{i + 1}</span></div>}
              <h3>{i + 1}. {st.title}</h3>
              <p className="muted small">{st.text}</p>
            </div>
          );
        })}
      </div>
      <div className="eyebrow">Live campaigns</div>
      <div className="section-head">
        <h2 style={{ marginTop: 8 }}>Back a design</h2>
        <Link href="/explore" className="button small secondary">See all designs →</Link>
      </div>
      {live.length === 0 && <p className="muted">No live campaigns right now. Check back soon.</p>}
      <div className="grid">
        {live.map(({ c, name, art, lineArt }, i) => (
          <Link key={c.id} href={`/c/${c.slug}`} className="tile">
            {art && (
              <div className="tile-art">
                {lineArt && <img className="art" src={fileUrl(lineArt)} alt="" />}
                <img className="art tile-sun" src={fileUrl(art)} alt="" />
              </div>
            )}
            <div>
              <div className="name">{c.title}</div>
              <div className="meta">by {name}</div>
            </div>
            <div className="progress"><div style={{ "--w": `${Math.min(100, (stats[i].pledged / c.goal) * 100)}%` } as React.CSSProperties} /></div>
            <div className="meta">{stats[i].pledged} of {c.goal} · {c.status === "funded" ? "funded" : `${daysLeft(c.endsAt)} days left`}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
