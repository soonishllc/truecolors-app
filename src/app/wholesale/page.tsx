import Link from "next/link";
import {
  portalDesignRequestAction, portalDesignResponseAction, portalFaultAction, portalRestockAction, portalSalesAction,
} from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { CONTACT } from "@/lib/brand";
import { PARTNER_MSRP_MULTIPLE, PARTNER_PRICE, SIZES } from "@/lib/rules";
import { config } from "@/lib/config";
import { StoreSignIn } from "@/components/StoreSignIn";
import { date, money } from "@/lib/format";
import type { OrderSummary, StockLine } from "@/lib/shopify/wholesale";
import { wholesaleOps } from "@/lib/wholesale/ops";
import { fileUrl } from "@/lib/storage";
import { outletSummary } from "@/lib/wholesale/consignment";
import { briefsFor } from "@/lib/wholesale/designs";
import { displaysAt, faultsFor } from "@/lib/wholesale/service";
import { ordersFor, showMoney } from "@/lib/wholesale/orders";
import { currentWholesaler, portalSignInReady } from "@/lib/wholesale/portal-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Wholesale · Truecolors" };

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
              <a href={CONTACT.whatsapp.href} target="_blank" rel="noreferrer">{CONTACT.whatsapp.label}</a> and we&apos;ll set you up.
            </p>
            <form action="/wholesale/logout" method="post" className="site-only"><button className="secondary">Sign out</button></form>
          </>
        ) : (
          <>
            <p className="muted">Orders, invoices, payments and your displays, in one place.</p>
            <StoreSignIn back="/wholesale" />
            <div className="site-only">
              {config().WHOLESALE_DEMO ? (
                <div className="row">
                  <a className="button" href="/wholesale/demo-login?as=stockist">Sign in as Sara (stockist)</a>
                  <a className="button secondary" href="/wholesale/demo-login?as=partner">Sign in as Lucía (display partner)</a>
                </div>
              ) : portalSignInReady() ? (
                <a className="button" href="/wholesale/login">Sign in with your Truecolors account</a>
              ) : (
                <p className="notice">{ERRORS.off}</p>
              )}
            </div>
            {/* Not a partner yet: the two ways to become one, the display first because it's the easy yes. */}
            <h2 className="join-ways-title">Not a partner yet?</h2>
            <Link href="/wholesale/displays" className="ways-card displays-way">
              <img src="/displays/tc-display-tower-card.jpg" alt="" />
              <span>
                <span className="eyebrow">Hotels · airports · attractions</span>
                <b>Host a display</b>
                <span className="muted">It brings its own sun, so guests watch the shirts change. No upfront cost.</span>
                <span className="ways-go">See the displays →</span>
              </span>
            </Link>
            <a href={`${config().STORE_URL.replace(/\/$/, "")}/pages/wholesale`} target="_parent" className="ways-card">
              <span>
                <span className="eyebrow">Shops and resellers</span>
                <b>Stock our shirts</b>
                <span className="muted">Custom designs for your location, or picks from our catalogue. Terms agreed with you.</span>
                <span className="ways-go">See wholesale →</span>
              </span>
            </a>
            <p className="small muted">
              Or message us on WhatsApp at <a href={CONTACT.whatsapp.href} target="_blank" rel="noreferrer">{CONTACT.whatsapp.label}</a>.
            </p>
          </>
        )}
      </div>
    );
  }

  const { contact, wholesaler: w } = me;
  const orders = w.shopifyCustomerId ? await attempt(() => wholesaleOps().customerOrders(w.shopifyCustomerId!, 20)) : [];
  const stock = w.displayPartner
    ? await Promise.all(
        me.outlets.map(async (o) => ({
          outlet: o,
          lines: o.shopifyLocationId ? await attempt(() => wholesaleOps().locationStock(o.shopifyLocationId!)) : [],
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
        Signed in as {contact.name} ({me.email}). Our wholesale assistant on WhatsApp takes orders, restocks, sales
        reports and design requests any time, and hands you to the team for anything else.
      </p>
      <p className="row">
        <a className="button" href={`${CONTACT.whatsapp.href}?text=${encodeURIComponent(`Hi, it's ${contact.name} from ${w.name}`)}`} target="_blank" rel="noreferrer">
          Chat on WhatsApp
        </a>
        {config().WHOLESALE_DEMO && <a className="button secondary" href="/app" target="_blank" rel="noreferrer">Try the bot (demo)</a>}
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
                        {o.status === "awaiting_payment" && o.payUrl && <a href={o.payUrl} target="_parent">Pay by card</a>}
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

      {/* Display partners don't order: their shirts arrive as restocks, below. */}
      {w.stockist && (
        <>
          <h2>Orders</h2>
          <Orders orders={orders} />
        </>
      )}

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
                {PARTNER_PRICE[s.currency] !== undefined && (
                  <> Shelf price {showMoney(String(PARTNER_PRICE[s.currency]! * PARTNER_MSRP_MULTIPLE), s.currency)}, you pay {showMoney(String(PARTNER_PRICE[s.currency]), s.currency)} a shirt sold.</>
                )}
                {s.overdue && <strong> Please send your sales for the period that ended.</strong>}
              </p>
              {s.restocksPaused && <p className="notice small">Restocks are paused until the last period&apos;s sales are in.</p>}
              <Stock lines={lines} />

              {lines && lines.length > 0 && (
                <details>
                  <summary>Report sales</summary>
                  <ActionForm action={portalSalesAction} submit="Confirm these sales" pendingText="Recording…">
                    <input type="hidden" name="outletId" value={outlet.id} />
                    <SizeGrid lines={lines} cell={(l) => l.available > 0
                      ? <input name={`qty:${l.sku}`} type="number" min={0} max={l.available} placeholder="0" style={{ width: 64 }} aria-label={`${l.product} ${l.size} sold`} />
                      : <span className="muted">–</span>} />
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
                        <td>{x.status === "invoiced" && x.payUrl ? <a href={x.payUrl} target="_parent">Pay now</a> : x.status === "paid" ? "paid" : "being checked"}</td>
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

      {/* Inside the store, signing out is the store's: it signs out of everything. */}
      <form action="/wholesale/logout" method="post" className="site-only"><button className="secondary">Sign out</button></form>
      <p className="store-only"><a className="button secondary" href={`${config().STORE_URL.replace(/\/$/, "")}/account/logout`} target="_parent">Sign out</a></p>
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
            <td>{o.statusUrl && o.statusUrl !== "#" ? <a href={o.statusUrl} target="_blank" rel="noreferrer">{o.name}</a> : o.name}</td>
            <td>{date(new Date(o.createdAt))}</td>
            <td>{status(o.paid)}</td>
            <td>{status(o.fulfilment)}</td>
            <td>{money(Math.round(Number(o.total) * 100), o.currency)}</td>
            <td>
              {o.tracking.map((t, i) =>
                t.url ? <a key={i} href={t.url} target="_blank" rel="noreferrer">{t.company ?? "Track"} {t.number}</a> : <span key={i}>{t.number}</span>,
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
  return <SizeGrid lines={lines} cell={(l) => <span className={l.available <= 1 ? "warn" : undefined}>{l.available}</span>} />;
}

// One row per design, one column per size, as the shirts sit on the display.
function SizeGrid({ lines, cell }: { lines: StockLine[]; cell: (l: StockLine) => React.ReactNode }) {
  const order = (size: string) => ((SIZES as readonly string[]).indexOf(size) + 1 || 99);
  const sizes = [...new Set(lines.map((l) => l.size))].sort((a, b) => order(a) - order(b));
  const designs = [...new Set(lines.map((l) => l.product))];
  const at = new Map(lines.map((l) => [`${l.product}|${l.size}`, l]));
  return (
    <table className="size-grid">
      <thead><tr><th>Design</th>{sizes.map((s) => <th key={s}>{s}</th>)}</tr></thead>
      <tbody>
        {designs.map((d) => (
          <tr key={d}>
            <td>{d}</td>
            {sizes.map((s) => {
              const l = at.get(`${d}|${s}`);
              return <td key={s}>{l ? cell(l) : <span className="muted">–</span>}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
