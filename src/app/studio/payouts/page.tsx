import Link from "next/link";
import { payoutMethodAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth/session";
import { money, moneyEach } from "@/lib/format";
import { payoutMethod, USDC_NETWORKS } from "@/lib/payouts/methods";
import { designerEarnings } from "@/lib/royalties/ledger";

export const dynamic = "force-dynamic";

const COUNTRIES: [string, string][] = [
  ["AE", "United Arab Emirates"], ["US", "United States"], ["GB", "United Kingdom"], ["SA", "Saudi Arabia"],
  ["MX", "Mexico"], ["DE", "Germany"], ["FR", "France"], ["ES", "Spain"], ["IT", "Italy"], ["NL", "Netherlands"],
  ["PT", "Portugal"], ["IE", "Ireland"], ["BH", "Bahrain"], ["QA", "Qatar"], ["KW", "Kuwait"], ["JO", "Jordan"],
  ["EG", "Egypt"], ["PK", "Pakistan"], ["TR", "Türkiye"], ["BR", "Brazil"], ["CH", "Switzerland"],
];

export default async function Payouts() {
  const user = await requireUser();
  const current = await payoutMethod(user.id);
  const earnings = await designerEarnings(user.id);

  return (
    <div className="narrow">
      <p className="small"><Link href="/studio">← Studio</Link></p>
      <div className="eyebrow">Payouts</div>
      <h1>How you get paid</h1>
      <p className="muted">
        Earnings become payable once the return window closes, and Truecolors pays out every month. Pick one way to
        be paid; you can change it any time before a payout.
      </p>
      <div className="stats" style={{ margin: "20px 0" }}>
        <div className="card"><div className="eyebrow">Ready for next payout</div><div className="stat">{moneyEach(earnings.totals, "payable")}</div></div>
        <div className="card"><div className="eyebrow">Paid so far</div><div className="stat">{moneyEach(earnings.totals, "paid")}</div></div>
      </div>
      {current && <p className="notice good-notice">Currently paid by <strong>{current.summary}</strong>.</p>}

      <div className="card">
        <ActionForm action={payoutMethodAction} submit="Save payout details" className="stack payout-form">
          <fieldset className="method-pick">
            <legend>Pay me by</legend>
            <label className="method"><input type="radio" name="kind" value="paypal" defaultChecked={!current || current.kind === "paypal"} />
              <span><strong>PayPal</strong><span className="small muted">Fastest to set up. Works in 200+ countries.</span></span></label>
            <label className="method"><input type="radio" name="kind" value="bank" defaultChecked={current?.kind === "bank"} />
              <span><strong>Bank transfer</strong><span className="small muted">IBAN, or account and routing number in the US.</span></span></label>
            <label className="method"><input type="radio" name="kind" value="usdc" defaultChecked={current?.kind === "usdc"} />
              <span><strong>USDC</strong><span className="small muted">A dollar stablecoin, sent to your own wallet.</span></span></label>
          </fieldset>

          <div className="fields f-paypal">
            <label>PayPal email<input name="paypalEmail" type="email" autoComplete="email" /></label>
          </div>
          <div className="fields f-bank">
            <label>Account holder<input name="holder" autoComplete="name" /></label>
            <label>Bank name<input name="bankName" /></label>
            <label>Country
              <select name="country" defaultValue="AE">{COUNTRIES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select>
            </label>
            <label>IBAN<input name="iban" autoComplete="off" placeholder="AE07 0331 2345 6789 0123 456" /><span className="small muted">Outside the US</span></label>
            <label>SWIFT / BIC<input name="swift" autoComplete="off" /></label>
            <label>US account number<input name="accountNumber" autoComplete="off" inputMode="numeric" /><span className="small muted">US banks only, with the routing number</span></label>
            <label>US routing number<input name="routing" autoComplete="off" inputMode="numeric" /></label>
          </div>
          <div className="fields f-usdc">
            <label>Network
              <select name="network" defaultValue="base">{Object.entries(USDC_NETWORKS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label>Wallet address<input name="address" autoComplete="off" spellCheck={false} /></label>
            <p className="small muted">
              Double-check the network: USDC sent to the wrong network or address can&apos;t be recovered. Use a wallet
              you control, not an exchange deposit address unless it supports this network.
            </p>
          </div>
        </ActionForm>
      </div>
      <p className="small muted">Your details are encrypted. Only the Truecolors payouts team can see them in full.</p>
    </div>
  );
}
