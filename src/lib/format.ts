export const money = (cents: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export const date = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" }) : "";

export function daysLeft(endsAt: Date | null, now = new Date()) {
  if (!endsAt) return 0;
  return Math.max(0, Math.ceil((endsAt.getTime() - now.getTime()) / 86_400_000));
}

export function nextStretch(count: number, goal: number, stretch: number[]) {
  return [goal, ...stretch].find((g) => g > count);
}
