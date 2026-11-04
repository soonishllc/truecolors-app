import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import {
  batchAction, clearAttentionAction, grantCreditsAction, inviteAction, markBatchAction,
  payoutPaidAction, preparePayoutsAction, reviewAction, tickAction, createChallengeAction,
} from "@/app/actions";
import { entries, listChallenges, phase } from "@/lib/challenges";
import { ActionForm } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth/session";
import { campaignStats, needsAttention } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { batches, campaigns, designs, emails, invites, users } from "@/lib/db/schema";
import { date, money } from "@/lib/format";
import { unbatchedFunded } from "@/lib/production/batch";
import { payoutDetailsForAdmin } from "@/lib/payouts/methods";
import { pendingPayouts } from "@/lib/royalties/ledger";
import { fileUrl } from "@/lib/storage";

export const dynamic = "force-dynamic";

export default async function Admin() {
  await requireAdmin();
  const d = await db();
  const queue = await d
    .select({ c: campaigns, design: designs, designer: users })
    .from(campaigns)
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .innerJoin(users, eq(users.id, campaigns.userId))
    .where(eq(campaigns.status, "in_review"));
  const active = await d
    .select()
    .from(campaigns)
    .where(inArray(campaigns.status, ["live", "closing", "funded", "in_production", "missed"]))
    .orderBy(desc(campaigns.createdAt));
  const activeStats = await Promise.all(active.map((c) => campaignStats(c.id)));
  const attention = await needsAttention();
  const funded = await unbatchedFunded();
  const allBatches = await d.select().from(batches).orderBy(desc(batches.createdAt));
  const payouts = await pendingPayouts();
  const payTo = await Promise.all(payouts.map(({ p }) => payoutDetailsForAdmin(p.userId)));
  const openInvites = await d.select().from(invites).orderBy(desc(invites.createdAt)).limit(20);
  const agreementReady = Boolean(config().DESIGNER_AGREEMENT_VERSION);
  const allChallenges = await listChallenges();
  const leaders = await Promise.all(allChallenges.map((ch) => entries(ch.id)));
  const outbox = await d.select().from(emails).orderBy(desc(emails.createdAt)).limit(15);

  return (
    <>
      <h1>Admin</h1>
      <p><Link href="/admin/wholesale">Wholesale: accounts and WhatsApp chats →</Link></p>
      {!agreementReady && (
        <p className="notice">The designer agreement isn&apos;t final (DESIGNER_AGREEMENT_VERSION is blank), so campaigns can&apos;t be approved yet.</p>
      )}

      <h2>Review queue ({queue.length})</h2>
      {queue.length === 0 && <p className="muted">Nothing waiting.</p>}
      <div className="grid">
        {queue.map(({ c, design, designer }) => (
          <div key={c.id} className="card">
            <div className="pair">
              <img className="art" src={fileUrl(design.lineArtKey!)} alt="shade" />
              <img className="art" src={fileUrl(design.compositeKey!)} alt="sun" />
            </div>
            <p><strong>{c.title}</strong> by {designer.name} ({designer.email})</p>
            <p className="small">{c.story}</p>
            <p className="small muted">Idea: {design.prompt}</p>
            {design.flags.length > 0 && <p className="small warn">Check: {design.flags.join(", ")}</p>}
            <p className="small">
              Print files: <a href={fileUrl(design.printLineKey!)}>line art</a> · <a href={fileUrl(design.printColourKey!)}>colour</a>
            </p>
            <ActionForm action={reviewAction} submit="Submit decision">
              <input type="hidden" name="campaignId" value={c.id} />
              <label>Decision
                <select name="decision"><option value="approve">Approve and go live</option><option value="reject">Reject</option></select>
              </label>
              <label>Note to designer<input name="note" /></label>
            </ActionForm>
          </div>
        ))}
      </div>

      <h2>Campaigns</h2>
      <ActionForm action={tickAction} className="row" submit="Run charging and closing now" pendingText="Running…" />
      <table>
        <thead><tr><th>Campaign</th><th>Status</th><th>Pledged</th><th>Charged</th><th>Ends</th></tr></thead>
        <tbody>
          {active.map((c, i) => (
            <tr key={c.id}>
              <td><Link href={`/c/${c.slug}`}>{c.title}</Link> <span className="muted small">{c.designCode}</span></td>
              <td><span className="badge">{c.status.replace("_", " ")}</span>{c.fundedAt && c.status === "live" && " funded"}</td>
              <td>{activeStats[i].pledged} / {c.goal}</td>
              <td>{activeStats[i].charged}</td>
              <td>{date(c.endsAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {attention.length > 0 && (
        <>
          <h2>Needs a person ({attention.length})</h2>
          <table>
            <tbody>
              {attention.map(({ p, slug }) => (
                <tr key={p.id}>
                  <td>{p.orderName}</td><td>{slug}</td><td>{p.needsAttention}</td>
                  <td><form action={clearAttentionAction}><input type="hidden" name="pledgeId" value={p.id} /><button className="secondary">Done</button></form></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <h2>Production</h2>
      {funded.length > 0 ? (
        <ActionForm action={batchAction} submit="Create batch for Cancún">
          {funded.map((c) => (
            <label key={c.id} className="check"><input type="checkbox" name="campaignId" value={c.id} defaultChecked /> {c.title} ({c.designCode})</label>
          ))}
          <label>Note<input name="note" placeholder="Ship with the November run" /></label>
        </ActionForm>
      ) : <p className="muted">No funded campaigns waiting for a batch.</p>}
      <table>
        <tbody>
          {allBatches.map((b) => (
            <tr key={b.id}>
              <td>{date(b.createdAt)} {b.note}</td>
              <td><span className="badge">{b.status}</span></td>
              <td>
                <a href={`/api/admin/batches/${b.id}/work-order`}>Work order CSV</a> ·{" "}
                <a href={`/api/admin/batches/${b.id}/inbound`}>Las Vegas inbound CSV</a> ·{" "}
                <a href={`/api/admin/batches/${b.id}/editions`}>Edition numbers CSV</a>
              </td>
              <td className="row">
                {b.status === "draft" && <form action={markBatchAction}><input type="hidden" name="batchId" value={b.id} /><input type="hidden" name="status" value="sent" /><button className="secondary">Sent to Cancún</button></form>}
                {b.status === "sent" && <form action={markBatchAction}><input type="hidden" name="batchId" value={b.id} /><input type="hidden" name="status" value="received" /><button className="secondary">Received in Las Vegas</button></form>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Payouts</h2>
      <ActionForm action={preparePayoutsAction} className="row" submit="Prepare this month's payouts" />
      <table>
        <tbody>
          {payouts.map(({ p, name, email }, i) => (
            <tr key={p.id}>
              <td>{name}<div className="small muted">{email}</div></td>
              <td>
                {money(p.totalCents, p.currency)}
                {payTo[i] ? (
                  <details className="small"><summary>{payTo[i]!.kind === "usdc" ? "USDC" : payTo[i]!.kind === "bank" ? "Bank transfer" : "PayPal"}</summary>
                    <pre style={{ whiteSpace: "pre-wrap" }}>{Object.entries(payTo[i]!.details).map(([k, v]) => `${k}: ${v}`).join("\n")}</pre>
                  </details>
                ) : <div className="small error">No payout details yet</div>}
              </td>
              <td>
                <ActionForm action={payoutPaidAction} className="row" submit="Mark paid">
                  <input type="hidden" name="payoutId" value={p.id} />
                  <input name="reference" placeholder="Payment reference" required />
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Designers</h2>
      <div className="pair">
        <div className="card">
          <ActionForm action={inviteAction} submit="Create invite code">
            <label>Who is it for?<input name="note" placeholder="Name or Instagram handle" /></label>
          </ActionForm>
          <table>
            <tbody>
              {openInvites.map((i) => (
                <tr key={i.code}><td><code>{i.code}</code></td><td>{i.note}</td><td>{i.usedAt ? `used ${date(i.usedAt)}` : "unused"}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <ActionForm action={grantCreditsAction} submit="Add credits">
            <label>Designer email<input name="email" type="email" required /></label>
            <label>Credits<input name="amount" type="number" min={1} defaultValue={20} required /></label>
          </ActionForm>
        </div>
      </div>

      <h2>Design challenges</h2>
      <div className="pair">
        <div className="card">
          <ActionForm action={createChallengeAction} submit="Create challenge">
            <label>Title<input name="title" required placeholder="Summer in the Emirates" /></label>
            <label>Brief<textarea name="brief" required placeholder="What should designers make?" /></label>
            <label>Prize<input name="prize" required defaultValue="The winning design launches as a featured campaign" /></label>
            <label>Entries close<input name="submitBy" type="datetime-local" required /></label>
            <label>Voting closes<input name="voteBy" type="datetime-local" required /></label>
          </ActionForm>
        </div>
        <div className="card">
          {allChallenges.length === 0 && <p className="muted small">No challenges yet.</p>}
          {allChallenges.map((ch, i) => (
            <div key={ch.id} style={{ marginBottom: 16 }}>
              <p><Link href={`/challenges/${ch.slug}`}><strong>{ch.title}</strong></Link> <span className="badge">{phase(ch)}</span></p>
              <ol className="small">
                {leaders[i].slice(0, 5).map((e) => <li key={e.id}>{e.title} by {e.designer}: {e.votes} votes</li>)}
              </ol>
            </div>
          ))}
        </div>
      </div>

      <h2>Emails</h2>
      <p className="small muted">
        {config().RESEND_API_KEY ? "Sent through Resend." : "No RESEND_API_KEY yet, so emails are only logged here, not sent."}
      </p>
      <div className="table-wrap">
        <table>
          <thead><tr><th>To</th><th>Subject</th><th>When</th></tr></thead>
          <tbody>
            {outbox.map((e) => (
              <tr key={e.id}>
                <td>{e.to}</td>
                <td>
                  <details><summary>{e.subject}</summary><pre className="small" style={{ whiteSpace: "pre-wrap" }}>{e.body}</pre></details>
                  {e.error && <div className="small error">{e.error}</div>}
                </td>
                <td className="small muted">{date(e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
