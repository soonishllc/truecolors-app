import Link from "next/link";
import {
  activateWholesalerAction, addContactAction, addOutletAction, createWholesalerAction, handBackToBotAction,
  markWholesalePaidAction, retryShippingAction, decideRestockAction, sendRestockAction, invoiceSettlementAction,
  settlementPaidAction, stockCountAction, outletSettingsAction, assignBriefAction, retryLocationProductAction, addDisplayAction,
  resolveFaultAction,
} from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { ensureDemoAccounts } from "@/lib/wholesale/demo";
import { ago, date } from "@/lib/format";
import { WHOLESALE_CURRENCIES } from "@/lib/rules";
import { fileUrl } from "@/lib/storage";
import { wholesaleOverview } from "@/lib/wholesale/accounts";
import { consignmentQueue } from "@/lib/wholesale/consignment";
import { adminBriefs } from "@/lib/wholesale/designs";
import { openFaults } from "@/lib/wholesale/service";
import { adminOrders, showMoney } from "@/lib/wholesale/orders";

export const dynamic = "force-dynamic";

function Kinds({ stockist = false, displayPartner = false }) {
  return (
    <>
      <label className="check"><input type="checkbox" name="stockist" defaultChecked={stockist} /> Stockist (buys outright)</label>
      <label className="check"><input type="checkbox" name="displayPartner" defaultChecked={displayPartner} /> Display partner (consignment)</label>
    </>
  );
}

function Currency({ value = "USD" }) {
  return (
    <label>Currency
      <select name="currency" defaultValue={value}>{WHOLESALE_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
    </label>
  );
}

export default async function WholesaleAdmin() {
  await requireAdmin();
  if (config().WHOLESALE_DEMO) await ensureDemoAccounts();
  const { wholesalers, chats } = await wholesaleOverview();
  const orders = (await adminOrders()).filter(({ o }) => o.status !== "quoted");
  const queue = await consignmentQueue();
  const briefs = await adminBriefs();
  const faults = await openFaults();
  const allOutlets = wholesalers.flatMap(({ w, outlets }) => outlets.map((o) => ({ o, w })));
  const leads = wholesalers.filter(({ w }) => w.status === "lead");
  const active = wholesalers.filter(({ w }) => w.status === "active");

  return (
    <>
      <p className="small"><Link href="/admin">← Admin</Link></p>
      <h1>Wholesale</h1>
      {config().WHOLESALE_DEMO && (
        <p className="notice">Local demo with sample data. <Link href="/admin/wholesale/simulator">Open the WhatsApp bot simulator →</Link></p>
      )}

      <h2>Stockist orders</h2>
      {orders.length === 0 && <p className="muted">No orders yet.</p>}
      <table>
        <thead><tr><th>Order</th><th>Stockist</th><th>Total</th><th>Status</th><th>Shipping</th><th></th></tr></thead>
        <tbody>
          {orders.map(({ o, w }) => (
            <tr key={o.id}>
              <td>{o.shopifyOrderName ?? "draft"} <span className="muted small">{o.ref}</span></td>
              <td>{w.name}</td>
              <td>{showMoney(o.subtotal, o.currency)}<br /><span className="small muted">{o.units} shirts · {o.paymentMethod === "bank_transfer" ? "bank transfer" : "card"}</span></td>
              <td><span className="badge">{o.status.replace("_", " ")}</span></td>
              <td className="small">
                {o.trackingNumber && <div>FedEx {o.trackingNumber}</div>}
                {o.documents.map((doc) => (
                  <div key={doc.key}><a href={fileUrl(doc.key)}>{doc.kind === "label" ? "Label" : "Commercial invoice"}</a></div>
                ))}
                {o.shippingProblem && <div className="warn">{o.shippingProblem}</div>}
              </td>
              <td>
                {o.status === "awaiting_payment" && o.paymentMethod === "bank_transfer" && (
                  <ActionForm action={markWholesalePaidAction} className="row" submit="Transfer received">
                    <input type="hidden" name="orderId" value={o.id} />
                  </ActionForm>
                )}
                {o.status === "paid" && (
                  <form action={retryShippingAction}>
                    <input type="hidden" name="orderId" value={o.id} />
                    <button className="secondary">Book FedEx again</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Displays</h2>
      {queue.overdue.length > 0 && (
        <p className="notice">
          Sales reports overdue, restocks paused:{" "}
          {queue.overdue.map(({ outlet, wholesaler }) => `${outlet.name} (${wholesaler.name}, ${outlet.remindersSent} reminders${outlet.remindersSent >= 2 ? ", needs a visit" : ""})`).join("; ")}
        </p>
      )}

      <h3>Restocks ({queue.restocks.length})</h3>
      {queue.restocks.length === 0 && <p className="muted">None waiting.</p>}
      <table>
        <tbody>
          {queue.restocks.map(({ r, outlet, wholesaler }) => (
            <tr key={r.id}>
              <td><strong>{outlet.name}</strong><br /><span className="small muted">{wholesaler.name} · from {outlet.supplyRoute}</span></td>
              <td className="small">{r.lines.map((l) => <div key={l.sku}>{l.quantity} × {l.title} {l.size}</div>)}{r.note && <div className="muted">“{r.note}”</div>}</td>
              <td>{r.units} shirts<br /><span className="badge">{r.status}</span></td>
              <td>
                {r.status === "requested" ? (
                  <form action={decideRestockAction} className="row">
                    <input type="hidden" name="restockId" value={r.id} />
                    <button name="decision" value="approve">Approve</button>
                    <button name="decision" value="decline" className="secondary">Decline</button>
                  </form>
                ) : (
                  <ActionForm action={sendRestockAction} className="row" submit="Mark sent">
                    <input type="hidden" name="restockId" value={r.id} />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Settlements ({queue.settlements.length})</h3>
      {queue.settlements.length === 0 && <p className="muted">None waiting.</p>}
      <table>
        <tbody>
          {queue.settlements.map(({ s, outlet, wholesaler }) => (
            <tr key={s.id}>
              <td><strong>{outlet.name}</strong><br /><span className="small muted">{wholesaler.name} · {date(s.periodStart)} – {date(s.periodEnd)}</span></td>
              <td>
                {s.reportedUnits} reported{s.missingUnits > 0 && <>, <span className="warn">{s.missingUnits} missing at count</span></>}
                <br />{s.amount ? showMoney(s.amount, s.currency) : <span className="warn">{s.problem}</span>}
              </td>
              <td><span className="badge">{s.status}</span></td>
              <td>
                {s.status === "review" && (
                  <ActionForm action={invoiceSettlementAction} className="row" submit="Send invoice">
                    <input type="hidden" name="settlementId" value={s.id} />
                  </ActionForm>
                )}
                {s.status === "invoiced" && (
                  <ActionForm action={settlementPaidAction} className="row" submit="Transfer received">
                    <input type="hidden" name="settlementId" value={s.id} />
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pair">
        <div>
          <h3>Record a stock count</h3>
          <ActionForm action={stockCountAction} submit="Save count">
            <label>Outlet
              <select name="outletId">{allOutlets.map(({ o, w }) => <option key={o.id} value={o.id}>{o.name} ({w.name})</option>)}</select>
            </label>
            <label>What&apos;s on the display, one per line: SKU and quantity
              <textarea name="counts" rows={6} placeholder={"TC-HAB-WHT-M 4\nTC-HAB-WHT-L 6"} />
            </label>
            <p className="small muted">Anything on the display that isn&apos;t listed counts as not found.</p>
          </ActionForm>
        </div>
        <div>
          <h3>Outlet settings</h3>
          <ActionForm action={outletSettingsAction} submit="Save">
            <label>Outlet
              <select name="outletId">{allOutlets.map(({ o, w }) => <option key={o.id} value={o.id}>{o.name} ({w.name}) · {o.parPerSku} per size, {o.settlementDays} days</option>)}</select>
            </label>
            <label>Usual stock per design and size<input name="parPerSku" type="number" min={1} defaultValue={6} /></label>
            <label>Settle every<select name="settlementDays"><option value="15">15 days</option><option value="7">week (busy outlets)</option></select></label>
            <label>Shopify location ID (leave blank to keep)<input name="shopifyLocationId" /></label>
          </ActionForm>
        </div>
      </div>

      <h3>Display faults ({faults.length})</h3>
      {faults.length === 0 && <p className="muted">None open.</p>}
      <table>
        <tbody>
          {faults.map(({ t, outlet, wholesaler, display }) => (
            <tr key={t.id}>
              <td><strong>{outlet.name}</strong><br /><span className="small muted">{wholesaler.name} · {display ? `${display.kind} ${display.serial}` : "display not identified"} · {t.ref}</span></td>
              <td className="small">{t.problem}{t.photos.map((p, i) => <div key={p}><a href={p}>Photo {i + 1}</a></div>)}</td>
              <td>
                <ActionForm action={resolveFaultAction} submit="Resolved">
                  <input type="hidden" name="ticketId" value={t.id} />
                  <input name="resolution" placeholder="What was done" required />
                </ActionForm>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Add a display</h3>
      <ActionForm action={addDisplayAction} className="row" submit="Add display">
        <select name="outletId">{allOutlets.map(({ o, w }) => <option key={o.id} value={o.id}>{o.name} ({w.name})</option>)}</select>
        <select name="kind"><option value="sunbox">Sunbox</option><option value="prism">Prism</option><option value="tower">Tower</option></select>
        <input name="serial" placeholder="Serial" required />
        <input name="installedAt" type="date" />
      </ActionForm>

      <h2>Location designs ({briefs.length})</h2>
      {briefs.length === 0 && <p className="muted">No requests.</p>}
      <table>
        <tbody>
          {briefs.map(({ b, w, designer, design }) => (
            <tr key={b.id}>
              <td><strong>{w.name}</strong> <span className="muted small">{b.ref}</span><br /><span className="small">{b.brief}</span></td>
              <td className="small">
                <span className="badge">{b.status.replace("_", " ")}</span>
                {designer && <div>{designer.name}</div>}
                {design && <div className="muted">{design.title}</div>}
                {b.feedback && <div className="muted">“{b.feedback}”</div>}
                {b.problem && <div className="warn">{b.problem}</div>}
              </td>
              <td>
                {["open", "assigned", "changes_requested"].includes(b.status) && (
                  <ActionForm action={assignBriefAction} className="row" submit={designer ? "Reassign" : "Assign"}>
                    <input type="hidden" name="briefId" value={b.id} />
                    <input name="designerEmail" type="email" placeholder="Designer's email" required />
                  </ActionForm>
                )}
                {b.status === "approved" && (
                  <form action={retryLocationProductAction}>
                    <input type="hidden" name="briefId" value={b.id} />
                    <button className="secondary">Create the product again</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>WhatsApp chats</h2>
      {chats.length === 0 && <p className="muted">No chats yet.</p>}
      <table>
        <thead><tr><th>From</th><th>Who</th><th>Answering</th><th>Last activity</th><th></th></tr></thead>
        <tbody>
          {chats.map(({ c, contact }) => (
            <tr key={c.id}>
              <td>+{c.phone}</td>
              <td>{contact?.name ?? <span className="muted">unknown</span>}</td>
              <td>
                {c.status === "bot" ? "Bot" : <>Team<span className="muted small"> · {c.handoverReason}</span></>}
              </td>
              <td>{ago(c.updatedAt)}</td>
              <td>
                {c.status === "human" && (
                  <form action={handBackToBotAction}>
                    <input type="hidden" name="conversationId" value={c.id} />
                    <button className="secondary">Hand back to bot</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted">The full thread is the ticket in Gorgias. The bot stops answering once a person replies there.</p>

      <h2>New leads ({leads.length})</h2>
      {leads.length === 0 && <p className="muted">None waiting.</p>}
      <div className="grid">
        {leads.map(({ w, contacts }) => (
          <div key={w.id} className="card">
            <p><strong>{w.name}</strong></p>
            <p className="small muted">{w.notes}</p>
            {contacts.map((c) => <p key={c.id} className="small">{c.name} · {c.phone && `+${c.phone}`} {c.email}</p>)}
            <ActionForm action={activateWholesalerAction} submit="Set up as wholesaler">
              <input type="hidden" name="wholesalerId" value={w.id} />
              <Kinds />
              <Currency />
              <label>Shopify customer ID<input name="shopifyCustomerId" /></label>
            </ActionForm>
          </div>
        ))}
      </div>

      <h2>Wholesalers ({active.length})</h2>
      <table>
        <thead><tr><th>Business</th><th>Type</th><th>Contacts</th><th>Outlets</th></tr></thead>
        <tbody>
          {active.map(({ w, contacts, outlets }) => (
            <tr key={w.id}>
              <td><strong>{w.name}</strong><br /><span className="small muted">{w.currency}{w.shopifyCustomerId ? ` · customer ${w.shopifyCustomerId}` : " · no Shopify customer"}</span></td>
              <td>{[w.stockist && "Stockist", w.displayPartner && "Display partner"].filter(Boolean).join(", ")}</td>
              <td className="small">{contacts.map((c) => <div key={c.id}>{c.name} ({c.role}) {c.phone && `+${c.phone}`} {c.email}</div>)}</td>
              <td className="small">{outlets.map((o) => <div key={o.id}>{o.name}, {o.city} · {o.supplyRoute}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="pair">
        <div>
          <h2>Add a wholesaler</h2>
          <ActionForm action={createWholesalerAction} submit="Add wholesaler">
            <label>Business name<input name="name" required /></label>
            <Kinds />
            <Currency />
            <label>Shopify customer ID<input name="shopifyCustomerId" /></label>
            <label>Contact name<input name="contactName" required /></label>
            <label>WhatsApp number, with country code<input name="phone" placeholder="+971 50 123 4567" /></label>
            <label>Email (signs in to the portal)<input name="email" type="email" /></label>
          </ActionForm>
        </div>
        <div>
          <h2>Add a contact</h2>
          <ActionForm action={addContactAction} submit="Add contact">
            <label>Wholesaler
              <select name="wholesalerId">{active.map(({ w }) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
            </label>
            <label>Name<input name="name" required /></label>
            <label>WhatsApp number<input name="phone" /></label>
            <label>Email<input name="email" type="email" /></label>
            <label>Role<select name="role"><option value="staff">Staff</option><option value="owner">Owner</option></select></label>
          </ActionForm>
          <h2>Add an outlet</h2>
          <ActionForm action={addOutletAction} submit="Add outlet">
            <label>Display partner
              <select name="wholesalerId">
                {active.filter(({ w }) => w.displayPartner).map(({ w }) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </label>
            <label>Outlet name<input name="name" required /></label>
            <label>City<input name="city" required /></label>
            <label>Country<input name="country" required /></label>
            <label>Shopify location ID<input name="shopifyLocationId" /></label>
            <label>Usual stock per design and size<input name="parPerSku" type="number" min={1} defaultValue={6} /></label>
            <label>Settle every<select name="settlementDays"><option value="15">15 days</option><option value="7">week (busy outlets)</option></select></label>
            <label>Restocks come from
              <select name="supplyRoute">
                <option value="quiqup">Quiqup (UAE, GCC)</option>
                <option value="shipdudes">Shipdudes (US, Canada, islands)</option>
                <option value="cancun">Cancún by FedEx</option>
              </select>
            </label>
          </ActionForm>
        </div>
      </div>
    </>
  );
}
