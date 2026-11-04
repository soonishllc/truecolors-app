export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

// Amounts in several currencies, e.g. "AED 129.00 + $36.00", each kept apart; "$0.00" when there are none.
export const moneyEach = <K extends string>(totals: ({ currency: string } & Record<K, number>)[], key: K) =>
  totals.filter((t) => t[key] !== 0).map((t) => money(t[key], t.currency)).join(" + ") || money(0);

export const date = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "";

export function daysLeft(endsAt: Date | null, now = new Date()) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
}

export function nextStretch(count: number, goal: number, stretch: number[]) {
  return [goal, ...stretch].find((g) => g > count);
}

export function ago(d: Date, now = Date.now()) {
  const m = Math.round((now - d.getTime()) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

export const compact = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);
