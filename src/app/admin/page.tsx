import { desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import {
  batchAction, clearAttentionAction, grantCreditsAction, inviteAction, markBatchAction,
  payoutPaidAction, preparePayoutsAction, quiqupInboundAction, reviewAction, tickAction, createChallengeAction,
} from "@/app/actions";
import { entries, listChallenges, phase } from "@/lib/challenges";
import { ActionForm } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth/session";
import { campaignStats, needsAttention } from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { batches, campaigns, designs, emails, invites, users } from "@/lib/db/schema";
import { date, money } from "@/lib/format";
import { batchDestinations, batchLines, DESTINATIONS, unbatchedFunded, type Destination } from "@/lib/production/batch";
import { formatCartons, quiqupReview, UAE_CONSIGNOR } from "@/lib/production/quiqup";
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
  const batchViews = await Promise.all(allBatches.map(async (b) => ({
    b,
    dests: await batchDestinations(b.id),
    lasVegasShirts: (await batchLines(b.id, "las_vegas")).reduce((n, l) => n + l.qty, 0),
    quiqup: await quiqupReview(b.id),
  })));
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
      <p><Link href="/admin/funnel">Funnel: drop-off and which links convert →</Link></p>
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
      <div className="stack">
        {batchViews.map(({ b, dests, lasVegasShirts, quiqup }) => (
          <div key={b.id} className="card stack">
            <div className="row">
              <strong>{date(b.createdAt)}</strong> {b.note} <span className="badge">{b.status}</span>
              {b.status === "draft" && <MarkBatch batchId={b.id} step="sent" label="Sent to Cancún" />}
            </div>
            <p className="small">
              <a href={`/api/admin/batches/${b.id}/work-order`}>Work order CSV</a> ·{" "}
              <a href={`/api/admin/batches/${b.id}/editions`}>Edition numbers CSV</a>
            </p>

            {dests.includes("las_vegas") && (
              <div className="stack">
                <h3>Las Vegas · ShipBob ({lasVegasShirts} shirts, USA store)</h3>
                <p className="small"><a href={`/api/admin/batches/${b.id}/las-vegas-inbound`}>Las Vegas inbound CSV</a></p>
                <Received batchId={b.id} sent={b.status !== "draft"} dest="las_vegas" at={b.lasVegasReceivedAt} />
              </div>
            )}

            {dests.includes("quiqup") && (
              <div className="stack">
                <h3>Dubai · Quiqup ({quiqup.shirts} shirts, UAE store)</h3>
                <p className="small">
                  <a href={`/api/admin/batches/${b.id}/quiqup-products`}>Product import CSV</a>
                  {quiqup.inbound && (
                    <>
                      {" "}· <a href={`/api/admin/batches/${b.id}/quiqup-packing-list`}>Packing list CSV</a>
                      {" "}· <a href={`/api/admin/batches/${b.id}/quiqup-invoice`} target="_blank">Commercial invoice</a>
                    </>
                  )}
                </p>
                {quiqup.inbound ? (
                  <>
                    <p className="notice">
                      Reply to Quiqup&apos;s inbound calendar invite with all three documents by{" "}
                      <strong>{dubaiTime(quiqup.deadline)}</strong> (48 hours before it arrives, {dubaiTime(new Date(quiqup.inbound.arrivesAt))} Dubai time).
                      {" "}{quiqup.shirts} shirts in {quiqup.inbound.cartons.length} cartons, {quiqup.kg} kg: these must match the FedEx master airbill.
                    </p>
                    {(quiqup.mixedBoxes.length > 0 || quiqup.splitSkus.length > 0) && (
                      <p className="notice">
                        Tell Federico at Quiqup before sending the documents:
                        {quiqup.mixedBoxes.length > 0 && <> {quiqup.mixedBoxes.join(", ")} {quiqup.mixedBoxes.length === 1 ? "holds" : "hold"} more than one SKU (ask whether segregation fees apply).</>}
                        {quiqup.splitSkus.length > 0 && <> {quiqup.splitSkus.join(", ")} {quiqup.splitSkus.length === 1 ? "is" : "are"} split across cartons.</>}
                      </p>
                    )}
                    {quiqup.differences.length > 0 && (
                      <p className="notice">
                        Packed counts differ from the pre-orders:{" "}
                        {quiqup.differences.map((x) => `${x.sku} ${x.packed} packed of ${x.ordered}`).join(" · ")}. Check Cancún&apos;s note.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="muted small">Once Cancún has packed the UAE cartons, enter them below for the packing list and commercial invoice.</p>
                )}
                <details>
                  <summary>{quiqup.inbound ? "Edit Quiqup cartons and invoice" : "Enter Quiqup cartons and invoice"}</summary>
                  <ActionForm action={quiqupInboundAction} submit="Save Quiqup details">
                    <input type="hidden" name="batchId" value={b.id} />
                    <label>Invoice number<input name="invoiceNo" defaultValue={quiqup.inbound?.invoiceNo} placeholder="TC-INB-008" required /></label>
                    <label>Consignor<input name="consignor" defaultValue={quiqup.inbound?.consignor ?? UAE_CONSIGNOR.name} required /></label>
                    <label>Consignor address<input name="consignorAddress" defaultValue={quiqup.inbound?.consignorAddress ?? UAE_CONSIGNOR.address} required /></label>
                    <label>Declared value per shirt (USD)<input name="unitValue" inputMode="decimal" defaultValue={quiqup.inbound ? (quiqup.inbound.unitValueCents / 100).toFixed(2) : ""} placeholder="3.50" required /></label>
                    <label>Arrives at Quiqup (Dubai time)<input type="datetime-local" name="arrivesAt" defaultValue={quiqup.inbound ? dubaiInput(quiqup.inbound.arrivesAt) : ""} required /></label>
                    <label>
                      Cartons, one per line: box | L x W x H cm | kg | SKU=qty, SKU=qty
                      <textarea name="cartons" rows={5} defaultValue={quiqup.inbound ? formatCartons(quiqup.inbound.cartons) : ""}
                        placeholder={`#BOX 1 | 49x49x34 | 16.03 | ${quiqup.items.slice(0, 2).map((i) => `${i.sku}=${i.ordered}`).join(", ")}`} required />
                    </label>
                  </ActionForm>
                </details>
                <Received batchId={b.id} sent={b.status !== "draft"} dest="quiqup" at={b.quiqupReceivedAt} />
              </div>
            )}
          </div>
        ))}
      </div>

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

function MarkBatch({ batchId, step, label }: { batchId: string; step: "sent" | Destination; label: string }) {
  return (
    <form action={markBatchAction}>
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="step" value={step} />
      <button className="secondary">{label}</button>
    </form>
  );
}

function Received({ batchId, sent, dest, at }: { batchId: string; sent: boolean; dest: Destination; at: Date | null }) {
  if (at) return <p className="small"><span className="badge">{DESTINATIONS[dest].received} {date(at)}</span></p>;
  return sent ? <MarkBatch batchId={batchId} step={dest} label={DESTINATIONS[dest].received} /> : null;
}

const DUBAI_MS = 4 * 3600_000;
const dubaiTime = (d: Date) => d.toLocaleString("en-US", { timeZone: "Asia/Dubai", dateStyle: "medium", timeStyle: "short" });
const dubaiInput = (iso: string) => new Date(new Date(iso).getTime() + DUBAI_MS).toISOString().slice(0, 16);
