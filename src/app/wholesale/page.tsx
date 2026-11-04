import { CONTACT } from "@/lib/brand";
import { date, money } from "@/lib/format";
import { customerOrders, locationStock, type OrderSummary, type StockLine } from "@/lib/shopify/wholesale";
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
        })),
      )
    : [];
  const kinds = [w.stockist && "Stockist", w.displayPartner && "Display partner"].filter(Boolean).join(" · ");
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
          {stock.map(({ outlet, lines }) => (
            <div key={outlet.id} className="card">
              <h3>{outlet.name} · {outlet.city}</h3>
              <Stock lines={lines} />
            </div>
          ))}
        </>
      )}

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
