import Link from "next/link";
import { funnelReport } from "@/lib/analytics";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const rate = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "–");

export default async function Funnel() {
  await requireAdmin();
  const { days, steps, refs, sources } = await funnelReport(30);
  const designer = steps.slice(0, 5);
  const shopper = steps.slice(5);

  const Steps = ({ rows }: { rows: typeof steps }) => (
    <table>
      <thead><tr><th>Step</th><th>Count</th><th>Of previous</th></tr></thead>
      <tbody>
        {rows.map((s, i) => (
          <tr key={s.name}>
            <td>{s.label}</td>
            <td>{s.count}</td>
            <td className="muted">{i === 0 ? "" : rate(s.count, rows[i - 1].count)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  const Top = ({ title, rows }: { title: string; rows: typeof refs }) => (
    <>
      <h2>{title}</h2>
      {rows.length === 0 ? <p className="muted">Nothing yet.</p> : (
        <table>
          <thead><tr><th>{title.startsWith("Top refs") ? "Ref" : "utm_source"}</th><th>Views</th><th>Pre-orders</th><th>Conversion</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td><code>{r.key}</code></td>
                <td>{r.views}</td>
                <td>{r.preorders}</td>
                <td className="muted">{rate(r.preorders, r.views)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );

  return (
    <>
      <p><Link href="/admin">← Admin</Link></p>
      <h1>Funnel</h1>
      <p className="muted small">Last {days} days, from the app&apos;s own events table.</p>
      <h2>Designers</h2>
      <Steps rows={designer} />
      <h2>Shoppers</h2>
      <Steps rows={shopper} />
      <Top title="Top refs by pre-orders" rows={refs} />
      <Top title="Top sources by pre-orders" rows={sources} />
    </>
  );
}
