import Link from "next/link";
import {
  activateWholesalerAction, addContactAction, addOutletAction, createWholesalerAction, handBackToBotAction,
  markWholesalePaidAction, retryShippingAction,
} from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { requireAdmin } from "@/lib/auth/session";
import { ago } from "@/lib/format";
import { WHOLESALE_CURRENCIES } from "@/lib/rules";
import { fileUrl } from "@/lib/storage";
import { wholesaleOverview } from "@/lib/wholesale/accounts";
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
  const { wholesalers, chats } = await wholesaleOverview();
  const orders = (await adminOrders()).filter(({ o }) => o.status !== "quoted");
  const leads = wholesalers.filter(({ w }) => w.status === "lead");
  const active = wholesalers.filter(({ w }) => w.status === "active");

  return (
    <>
      <p className="small"><Link href="/admin">← Admin</Link></p>
      <h1>Wholesale</h1>

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
