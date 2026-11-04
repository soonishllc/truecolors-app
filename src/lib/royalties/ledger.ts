import { and, desc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db/client";
import { campaigns, payouts, royaltyEntries, users } from "../db/schema";
import { UserError } from "../design/service";

// Phase 1 payouts are prepared by the app and paid by hand; automatic payouts come in Phase 2.

// A designer's earnings, one total per currency: pre-orders earn in the currency the backer paid (AED or USD),
// and wholesale designs in the wholesaler's currency, so they're never added together.
export async function designerEarnings(userId: string) {
  const d = await db();
  const rows = await d
    .select({
      currency: royaltyEntries.currency,
      earned: sql<number>`coalesce(sum(${royaltyEntries.amountCents}), 0)::int`,
      paid: sql<number>`coalesce(sum(${royaltyEntries.amountCents}) filter (where ${royaltyEntries.payoutId} is not null), 0)::int`,
      payable: sql<number>`coalesce(sum(${royaltyEntries.amountCents}) filter (where ${royaltyEntries.payoutId} is null and ${royaltyEntries.payableAfter} <= now()), 0)::int`,
    })
    .from(royaltyEntries)
    .where(eq(royaltyEntries.userId, userId))
    .groupBy(royaltyEntries.currency)
    .orderBy(royaltyEntries.currency);
  const totals = rows.map((t) => ({ ...t, held: t.earned - t.paid - t.payable }));
  const byCampaign = await d
    .select({
      title: campaigns.title,
      slug: campaigns.slug,
      currency: royaltyEntries.currency,
      amount: sql<number>`sum(${royaltyEntries.amountCents})::int`,
    })
    .from(royaltyEntries)
    .innerJoin(campaigns, eq(campaigns.id, royaltyEntries.campaignId))
    .where(eq(royaltyEntries.userId, userId))
    .groupBy(campaigns.title, campaigns.slug, royaltyEntries.currency);
  const history = await d.select().from(payouts).where(eq(payouts.userId, userId)).orderBy(desc(payouts.createdAt));
  return { totals, byCampaign, history };
}

// Groups every payable, unpaid entry into one pending payout per designer. Run monthly.
export async function preparePayouts(now = new Date()) {
  const d = await db();
  const due = await d
    .select({ userId: royaltyEntries.userId, currency: royaltyEntries.currency, total: sql<number>`sum(${royaltyEntries.amountCents})::int` })
    .from(royaltyEntries)
    .where(and(isNull(royaltyEntries.payoutId), lte(royaltyEntries.payableAfter, now)))
    .groupBy(royaltyEntries.userId, royaltyEntries.currency);

  const created = [];
  for (const row of due) {
    // A negative balance (refunds bigger than earnings) waits for future earnings.
    if (row.total <= 0) continue;
    const [p] = await d.insert(payouts).values({ userId: row.userId, totalCents: row.total, currency: row.currency }).returning();
    await d
      .update(royaltyEntries)
      .set({ payoutId: p.id })
      .where(
        and(
          eq(royaltyEntries.userId, row.userId),
          eq(royaltyEntries.currency, row.currency),
          isNull(royaltyEntries.payoutId),
          lte(royaltyEntries.payableAfter, now),
        ),
      );
    created.push(p);
  }
  return created;
}

export async function markPayoutPaid(payoutId: string, reference: string, now = new Date()) {
  if (!reference.trim()) throw new UserError("Add the payment reference.");
  const d = await db();
  const rows = await d
    .update(payouts)
    .set({ status: "paid", reference, paidAt: now })
    .where(and(eq(payouts.id, payoutId), eq(payouts.status, "pending")))
    .returning();
  if (!rows.length) throw new UserError("That payout is not pending.");
}

export async function pendingPayouts() {
  const d = await db();
  return d
    .select({ p: payouts, name: users.name, email: users.email })
    .from(payouts)
    .innerJoin(users, eq(users.id, payouts.userId))
    .where(eq(payouts.status, "pending"));
}
