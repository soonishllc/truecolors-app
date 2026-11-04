import {
  portalDesignRequestAction, portalDesignResponseAction, portalFaultAction, portalRestockAction, portalSalesAction,
} from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { CONTACT } from "@/lib/brand";
import { date, money } from "@/lib/format";
import { customerOrders, locationStock, type OrderSummary, type StockLine } from "@/lib/shopify/wholesale";
import { fileUrl } from "@/lib/storage";
import { outletSummary } from "@/lib/wholesale/consignment";
import { briefsFor } from "@/lib/wholesale/designs";
import { displaysAt, faultsFor } from "@/lib/wholesale/service";
import { ordersFor, showMoney } from "@/lib/wholesale/orders";
import { currentWholesaler, portalSignInReady } from "@/lib/wholesale/portal-auth";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  expired: "That sign-in took too long. Try again.",
  cancelled: "Sign-in was cancelled.",
  failed: "Sign-in didn't work. Try again.",
  off: "Portal sign-in isn't switched on yet.",
};

const status = (s: string) => s.toLowerCase().replace(/_/g, " ");

// Shopify lookups fail when it isn't configured (local development); the page still shows the account.
async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.error("[wholesale portal]", (e as Error).message);
  }
}

export default async function WholesalePortal({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const me = await currentWholesaler();

  if (!("wholesaler" in me) || !me.wholesaler) {
    return (
      <div className="auth">
        <div className="eyebrow">Wholesale</div>
        <h1>Wholesale portal</h1>
        {error && <p className="error">{ERRORS[error] ?? ERRORS.failed}</p>}
        {me.email ? (
          <>
            <p className="notice">
              {me.email} isn&apos;t linked to a wholesale account yet. Message us on WhatsApp at{" "}
              <a href={CONTACT.whatsapp.href}>{CONTACT.whatsapp.label}</a> and we&apos;ll set you up.
            </p>
            <form action="/wholesale/logout" method="post"><button className="secondary">Sign out</button></form>
          </>
        ) : (
          <>
            <p className="muted">Orders, invoices, payments and your displays, in one place.</p>
            {portalSignInReady() ? (
              <a className="button" href="/wholesale/login">Sign in with your Truecolors account</a>
            ) : (
              <p className="notice">{ERRORS.off}</p>
            )}
            <p className="small muted">
              Not a wholesaler yet? Message us on WhatsApp at <a href={CONTACT.whatsapp.href}>{CONTACT.whatsapp.label}</a>.
            </p>
          </>
        )}
      </div>
    );
  }

  const { contact, wholesaler: w } = me;
  const orders = w.shopifyCustomerId ? await attempt(() => customerOrders(w.shopifyCustomerId!, 20)) : [];
  const stock = w.displayPartner
    ? await Promise.all(
        me.outlets.map(async (o) => ({
          outlet: o,
          lines: o.shopifyLocationId ? await attempt(() => locationStock(o.shopifyLocationId!)) : [],
          summary: await outletSummary(o.id),
          displays: await displaysAt(o.id),
          faults: (await faultsFor(o.id)).filter((t) => t.status === "open"),
        })),
      )
    : [];
  const kinds = [w.stockist && "Stockist", w.displayPartner && "Display partner"].filter(Boolean).join(" · ");
  const briefs = await briefsFor(w.id);
  const open = (await ordersFor(w.id)).filter(
    (o) => (o.status === "quoted" && o.expiresAt > new Date()) || o.status === "awaiting_payment",
  );

  return (
    <>
      <div className="eyebrow">Wholesale · {kinds}</div>
      <h1>{w.name}</h1>
      <p className="muted">
        Signed in as {contact.name} ({me.email}). To order, restock or ask anything, message us on WhatsApp at{" "}
        <a href={CONTACT.whatsapp.href}>{CONTACT.whatsapp.label}</a>.
      </p>

      {w.stockist && (
        <>
          <p><a className="button" href="/wholesale/order">New order</a></p>
          {open.length > 0 && (
            <>
              <h2>Waiting on you</h2>
              <table>
                <thead><tr><th>Order</th><th>Shirts</th><th>Total</th><th>Next step</th></tr></thead>
                <tbody>
                  {open.map((o) => (
                    <tr key={o.id}>
                      <td>{o.shopifyOrderName ?? o.ref}</td>
                      <td>{o.units}</td>
                      <td>{showMoney(o.subtotal, o.currency)}</td>
                      <td>
                        {o.status === "quoted" && <a href={`/wholesale/order?quote=${o.ref}`}>Review and pay</a>}
                        {o.status === "awaiting_payment" && o.payUrl && <a href={o.payUrl}>Pay by card</a>}
                        {o.status === "awaiting_payment" && !o.payUrl && <a href={`/wholesale/order?placed=${o.ref}`}>Bank transfer details</a>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}

      <h2>Orders</h2>
      <Orders orders={orders} />

      {w.displayPartner && (
        <>
          <h2>Your displays</h2>
          {stock.length === 0 && <p className="muted">No outlets set up yet.</p>}
          {stock.map(({ outlet, lines, summary: s, displays, faults }) => (
            <div key={outlet.id} className="card stack">
              <h3>{outlet.name} · {outlet.city}</h3>
              <p className="small">
                This period ends {date(s.periodEnds)}. Sold so far: {s.soldThisPeriod} shirts
                {s.owedSoFar !== undefined && <>, {showMoney(s.owedSoFar, s.currency)} owed so far</>}.
                {s.overdue && <strong> Please send your sales for the period that ended.</strong>}
              </p>
              {s.restocksPaused && <p className="notice small">Restocks are paused until the last period&apos;s sales are in.</p>}
              <Stock lines={lines} />

              {lines && lines.length > 0 && (
                <details>
                  <summary>Report sales</summary>
                  <ActionForm action={portalSalesAction} submit="Confirm these sales" pendingText="Recording…">
                    <input type="hidden" name="outletId" value={outlet.id} />
                    <table>
                      <thead><tr><th>Design</th><th>Size</th><th>Sold</th></tr></thead>
                      <tbody>
                        {lines.filter((l) => l.available > 0).map((l) => (
                          <tr key={l.sku}>
                            <td>{l.product}</td><td>{l.size}</td>
                            <td><input name={`qty:${l.sku}`} type="number" min={0} max={l.available} placeholder="0" style={{ width: 72 }} aria-label={`${l.product} ${l.size} sold`} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ActionForm>
                </details>
              )}

              {s.openRestock ? (
                <p className="small muted">Restock of {s.openRestock.units} shirts {s.openRestock.status === "approved" ? "approved, being prepared" : "requested"}.</p>
              ) : (
                !s.restocksPaused && (
                  <ActionForm action={portalRestockAction} className="row" submit="Request a restock">
                    <input type="hidden" name="outletId" value={outlet.id} />
                    <input name="note" placeholder="Anything we should know (optional)" />
                  </ActionForm>
                )
              )}

              <details>
                <summary>Report a problem with a display</summary>
                <ActionForm action={portalFaultAction} submit="Report it">
                  <input type="hidden" name="outletId" value={outlet.id} />
                  {displays.length > 1 && (
                    <label>Display
                      <select name="display">{displays.map((x) => <option key={x.id} value={x.serial}>{x.kind} {x.serial}</option>)}</select>
                    </label>
                  )}
                  <label>What&apos;s wrong<textarea name="problem" rows={3} required placeholder="The UV light doesn't come on when the button is pressed." /></label>
                </ActionForm>
              </details>
              {faults.map((t) => <p key={t.id} className="small notice">Reported {t.ref}: {t.problem}. The service team is on it.</p>)}

              {s.settlements.length > 0 && (
                <table>
                  <thead><tr><th>Period</th><th>Shirts</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {s.settlements.map((x) => (
                      <tr key={x.id}>
                        <td>{date(x.periodStart)} – {date(x.periodEnd)}</td>
                        <td>{x.reportedUnits + x.missingUnits}</td>
                        <td>{x.amount ? showMoney(x.amount, x.currency) : "being checked"}</td>
                        <td>{x.status === "invoiced" && x.payUrl ? <a href={x.payUrl}>Pay now</a> : x.status === "paid" ? "paid" : "being checked"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </>
      )}

      <h2 id="designs">Designs for your location</h2>
      <p className="muted small">
        A design around your city, resort or landmark, drawn by our designers. Once you approve it, only you can order it.
      </p>
      <div className="grid">
        {briefs.map(({ b, design }) => (
          <div key={b.id} className="card stack">
            <div className="eyebrow">{b.ref}</div>
            <p className="small">{b.brief}</p>
            {b.status === "in_review" && design ? (
              <>
                <div className="pair">
                  <figure><img className="art" src={fileUrl(design.lineArtKey!)} alt="In the shade" /><figcaption className="small muted">Shade</figcaption></figure>
                  <figure><img className="art" src={fileUrl(design.compositeKey!)} alt="In the sun" /><figcaption className="small muted">Sun</figcaption></figure>
                </div>
                <p><strong>{design.title}</strong></p>
                <ActionForm action={portalDesignResponseAction} submit="Approve this design">
                  <input type="hidden" name="ref" value={b.ref} />
                  <input type="hidden" name="decision" value="approve" />
                </ActionForm>
                <ActionForm action={portalDesignResponseAction} submit="Ask for changes">
                  <input type="hidden" name="ref" value={b.ref} />
                  <input type="hidden" name="decision" value="changes" />
                  <textarea name="feedback" rows={2} placeholder="What should change?" />
                </ActionForm>
              </>
            ) : (
              <p className="small muted">
                {{
                  open: "Waiting for a designer.", assigned: "Being designed.", changes_requested: "Being changed.",
                  approved: "Approved; going into your catalog.", live: "In your catalog.", in_review: "Ready to review.", declined: "Declined.",
                }[b.status]}
              </p>
            )}
          </div>
        ))}
      </div>
      <ActionForm action={portalDesignRequestAction} submit="Request a design">
        <label>What would you like?
          <textarea name="brief" rows={3} required placeholder="Our beach at sunset with the hotel's palm-lined pool, in warm pinks and oranges." />
        </label>
      </ActionForm>

      <form action="/wholesale/logout" method="post"><button className="secondary">Sign out</button></form>
    </>
  );
}

function Orders({ orders }: { orders: OrderSummary[] | undefined }) {
  if (!orders) return <p className="notice">Orders couldn&apos;t be loaded right now.</p>;
  if (!orders.length) return <p className="muted">No orders yet.</p>;
  return (
    <table>
      <thead><tr><th>Order</th><th>Date</th><th>Payment</th><th>Delivery</th><th>Total</th><th>Tracking</th></tr></thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.name}>
            <td><a href={o.statusUrl}>{o.name}</a></td>
            <td>{date(new Date(o.createdAt))}</td>
            <td>{status(o.paid)}</td>
            <td>{status(o.fulfilment)}</td>
            <td>{money(Math.round(Number(o.total) * 100), o.currency)}</td>
            <td>
              {o.tracking.map((t, i) =>
                t.url ? <a key={i} href={t.url}>{t.company ?? "Track"} {t.number}</a> : <span key={i}>{t.number}</span>,
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Stock({ lines }: { lines: StockLine[] | undefined }) {
  if (!lines) return <p className="notice">Stock couldn&apos;t be loaded right now.</p>;
  if (!lines.length) return <p className="muted">No stock recorded at this outlet.</p>;
  return (
    <table>
      <thead><tr><th>Design</th><th>Size</th><th>On the display</th></tr></thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.sku || `${l.product}-${l.size}`}><td>{l.product}</td><td>{l.size}</td><td>{l.available}</td></tr>
        ))}
      </tbody>
    </table>
  );
}
