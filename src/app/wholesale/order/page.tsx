import Link from "next/link";
import { redirect } from "next/navigation";
import { portalPlaceAction, portalQuoteAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { config } from "@/lib/config";
import { CURRENCY_COUNTRY, WHOLESALE_MIN_UNITS, WHOLESALE_TIERS } from "@/lib/rules";
import { catalogFor } from "@/lib/shopify/wholesale";
import { wholesaleOps } from "@/lib/wholesale/ops";
import { quoteFor, showMoney, type WholesaleOrder } from "@/lib/wholesale/orders";
import { currentWholesaler } from "@/lib/wholesale/portal-auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "New wholesale order · Truecolors" };

// Stockists build a basket, see the quote at their tier, then pay by card or bank transfer.
export default async function WholesaleOrder({ searchParams }: { searchParams: Promise<{ quote?: string; placed?: string }> }) {
  const me = await currentWholesaler();
  if (!("wholesaler" in me) || !me.wholesaler) redirect("/wholesale");
  const w = me.wholesaler;
  if (!w.stockist) redirect("/wholesale");
  const { quote, placed } = await searchParams;

  if (placed) {
    const o = await quoteFor(w.id, placed);
    if (!o) redirect("/wholesale/order");
    return (
      <>
        <p className="small"><Link href="/wholesale">← Wholesale</Link></p>
        <h1>Order {o.shopifyOrderName ?? o.ref} is placed</h1>
        {o.payUrl ? (
          <>
            <p>Pay by card to confirm it. Checkout opens in the store; afterwards, come back to Wholesale to follow the order.</p>
            {o.paidAt
              ? <p className="good">Paid. Thank you.</p>
              : <p><a className="button" href={o.payUrl} target="_parent">Pay {showMoney(o.subtotal, o.currency)} by card</a></p>}
          </>
        ) : (
          <>
            <p>Pay by bank transfer, quoting <strong>{o.shopifyOrderName ?? o.ref}</strong> as the reference:</p>
            <pre className="card">{config().WHOLESALE_BANK_DETAILS.replace(/\\n/g, "\n")}</pre>
          </>
        )}
        <p className="muted">It ships from Cancún by FedEx, duties paid, as soon as the payment arrives. We&apos;ve emailed you these details too.</p>
      </>
    );
  }

  if (quote) {
    const o = await quoteFor(w.id, quote);
    if (!o || o.status !== "quoted") redirect("/wholesale/order");
    return (
      <>
        <p className="small"><Link href="/wholesale/order">← Change the order</Link></p>
        <h1>Quote {o.ref}</h1>
        <QuoteTable o={o} />
        <p className="muted small">Prices hold until {o.expiresAt.toUTCString()}. Shipping from Cancún by FedEx, duties paid.</p>
        <div className="pair">
          <ActionForm action={portalPlaceAction} submit="Pay by card">
            <input type="hidden" name="quote" value={o.ref} />
            <input type="hidden" name="payment" value="card" />
          </ActionForm>
          {config().WHOLESALE_BANK_DETAILS && (
            <ActionForm action={portalPlaceAction} submit="Pay by bank transfer" pendingText="Placing…">
              <input type="hidden" name="quote" value={o.ref} />
              <input type="hidden" name="payment" value="bank_transfer" />
            </ActionForm>
          )}
        </div>
      </>
    );
  }

  let catalog: Awaited<ReturnType<ReturnType<typeof wholesaleOps>["wholesaleCatalog"]>> = [];
  let prices = new Map<string, { amount: string; currency: string }>();
  try {
    catalog = catalogFor(await wholesaleOps().wholesaleCatalog(), w.id);
    prices = await wholesaleOps().variantPrices(catalog.flatMap((p) => p.sizes.map((s) => s.variantId)), CURRENCY_COUNTRY[w.currency]);
    // Stockist orders ship from Cancún, so show what's there, as the quote counts it.
    const hub = config().WHOLESALE_LOCATION_ID;
    if (hub) {
      const there = new Map((await wholesaleOps().locationStock(hub)).map((l) => [l.sku.toUpperCase(), l.available]));
      catalog = catalog.map((p) => ({ ...p, sizes: p.sizes.map((s) => ({ ...s, available: there.get(s.sku.toUpperCase()) ?? 0 })) }));
    }
  } catch (e) {
    console.error("[wholesale order]", (e as Error).message);
  }

  return (
    <>
      <p className="small"><Link href="/wholesale">← Wholesale</Link></p>
      <h1>New order</h1>
      <p className="muted">
        Minimum {WHOLESALE_MIN_UNITS} shirts. Off retail:{" "}
        {WHOLESALE_TIERS.map((t) => `${t.discountBps / 100}% from ${t.fromUnits}`).join(", ")}. Prices in {w.currency}.
      </p>
      {catalog.length === 0 ? (
        <p className="notice">The catalog couldn&apos;t be loaded right now.</p>
      ) : (
        <ActionForm action={portalQuoteAction} submit="Get my quote" pendingText="Pricing…">
          <table>
            <thead><tr><th>Design</th><th>Retail</th>{catalog[0].sizes.map((s) => <th key={s.size}>{s.size}</th>)}</tr></thead>
            <tbody>
              {catalog.map((p) => {
                const price = prices.get(p.sizes[0]?.variantId);
                return (
                  <tr key={p.handle}>
                    <td>{p.title}</td>
                    <td>{price ? showMoney(price.amount, price.currency) : "—"}</td>
                    {p.sizes.map((s) => (
                      <td key={s.sku}>
                        <input name={`qty:${s.sku}`} type="number" min={0} max={s.available} placeholder="0" aria-label={`${p.title} ${s.size}`} style={{ width: 72 }} />
                        <div className="small muted">{s.available} left</div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ActionForm>
      )}
    </>
  );
}

function QuoteTable({ o }: { o: WholesaleOrder }) {
  return (
    <table>
      <thead><tr><th>Design</th><th>Size</th><th>Qty</th><th>Retail</th><th>Your price</th><th>Line</th></tr></thead>
      <tbody>
        {o.lines.map((l) => (
          <tr key={l.sku}>
            <td>{l.title}</td><td>{l.size}</td><td>{l.quantity}</td>
            <td>{showMoney(l.retail, o.currency)}</td><td>{showMoney(l.unit, o.currency)}</td>
            <td>{showMoney((Number(l.unit) * l.quantity).toFixed(2), o.currency)}</td>
          </tr>
        ))}
        <tr><td colSpan={2}><strong>{o.units} shirts · {o.discountBps / 100}% off</strong></td><td colSpan={3} /><td><strong>{showMoney(o.subtotal, o.currency)}</strong></td></tr>
      </tbody>
    </table>
  );
}
