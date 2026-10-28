import { desc, eq } from "drizzle-orm";
import Link from "next/link";
import { acceptAgreementAction, createDesignAction, relaunchAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { PRESETS } from "@/lib/ai/presets";
import { requireUser } from "@/lib/auth/session";
import { campaignStats } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { campaigns, designs } from "@/lib/db/schema";
import { money } from "@/lib/format";
import { designerEarnings } from "@/lib/royalties/ledger";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function Studio() {
  const user = await requireUser();
  const d = await db();
  const mine = await d.select().from(designs).where(eq(designs.userId, user.id)).orderBy(desc(designs.updatedAt));
  const myCampaigns = await d.select().from(campaigns).where(eq(campaigns.userId, user.id)).orderBy(desc(campaigns.createdAt));
  const stats = await Promise.all(myCampaigns.map((c) => campaignStats(c.id)));
  const earnings = await designerEarnings(user.id);
  const agreement = config().DESIGNER_AGREEMENT_VERSION;

  return (
    <>
      <h1>Your studio</h1>
      {agreement && user.agreementVersion !== agreement && (
        <form action={acceptAgreementAction} className="notice row">
          <span>The designer agreement has been updated. Accept it before your campaigns can go live.</span>
          <button>Accept agreement</button>
        </form>
      )}
      <p className="muted">
        {user.credits} credits left · your share link code is <strong>{user.handle}</strong>
      </p>

      <h2>New design</h2>
      <div className="card">
        <ActionForm action={createDesignAction} submit="Draw the line art (1 credit)" pendingText="Drawing… this takes up to a minute">
          <label>Title<input name="title" required maxLength={60} placeholder="Dubai Marina Sunset" /></label>
          <label>Style
            <select name="preset">{PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          </label>
          <label>Your idea<textarea name="idea" required maxLength={600} placeholder="A dhow sailing past the Burj Al Arab at sunset, with palm trees" /></label>
          <p className="small muted">No brands, logos, celebrities, real people or political figures.</p>
        </ActionForm>
      </div>

      <h2>Designs</h2>
      {mine.length === 0 && <p className="muted">Nothing yet. Start with an idea above.</p>}
      <div className="grid">
        {mine.map((x) => (
          <Link key={x.id} href={`/studio/designs/${x.id}`} className="card" style={{ textDecoration: "none" }}>
            {x.lineArtKey && <img className="art" src={fileUrl(x.compositeKey ?? x.lineArtKey)} alt="" />}
            <p><strong>{x.title}</strong></p>
          </Link>
        ))}
      </div>

      <h2>Campaigns</h2>
      {myCampaigns.length === 0 ? <p className="muted">No campaigns yet.</p> : (
        <table>
          <thead><tr><th>Design</th><th>Status</th><th>Pre-orders</th><th></th></tr></thead>
          <tbody>
            {myCampaigns.map((c, i) => (
              <tr key={c.id}>
                <td>{c.status === "live" ? <Link href={`/c/${c.slug}`}>{c.title}</Link> : c.title}</td>
                <td><span className="badge">{c.status.replace("_", " ")}</span>{c.reviewNote && <div className="small muted">{c.reviewNote}</div>}</td>
                <td>{stats[i].pledged} of {c.goal}</td>
                <td>
                  {c.status === "missed" && !c.relaunchOf && (
                    <form action={relaunchAction}><input type="hidden" name="campaignId" value={c.id} /><button className="secondary">Relaunch</button></form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Earnings</h2>
      <div className="row">
        <div className="card"><div className="muted small">Earned</div><strong>{money(earnings.earned)}</strong></div>
        <div className="card"><div className="muted small">Held until returns close</div><strong>{money(earnings.held)}</strong></div>
        <div className="card"><div className="muted small">Ready for next payout</div><strong>{money(earnings.payable)}</strong></div>
        <div className="card"><div className="muted small">Paid</div><strong>{money(earnings.paid)}</strong></div>
      </div>
    </>
  );
}
