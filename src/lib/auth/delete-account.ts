import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
  campaigns, challengeEntries, designBriefs, designs, emails, generations, identities, loginTokens, media, payoutMethods,
  payouts, pushTokens, royaltyEntries, users,
} from "../db/schema";

// A designer deleting their account (the App Store requires it, and anyone may ask). Their personal details go:
// name, email, bio, photo, location, Instagram, sign-in accounts, payout details, app tokens, the emails sent to
// them, and every draft that never launched. What the law keeps (earnings and payouts) and what customers bought
// (launched designs and their pages) stay, attached to an anonymous "Former designer" no one can sign in as.

// Reasons it has to wait: a pre-order still running or being made, or money still owed to them. Each one is said
// on the page, with how to sort it out.
export async function deletionBlockers(userId: string): Promise<string[]> {
  const d = await db();
  const reasons: string[] = [];
  const running = await d.select({ title: campaigns.title }).from(campaigns)
    .where(and(eq(campaigns.userId, userId), inArray(campaigns.status, ["live", "closing", "funded", "in_production"])));
  if (running.length) {
    reasons.push(`${running.length === 1 ? `“${running[0].title}” is` : `${running.length} of your designs are`} still on pre-order or being printed. Once ${running.length === 1 ? "it's" : "they've"} shipped or closed, you can delete your account.`);
  }
  const [owed] = await d.select({ cents: sql<number>`coalesce(sum(${royaltyEntries.amountCents}), 0)::int` }).from(royaltyEntries)
    .where(and(eq(royaltyEntries.userId, userId), isNull(royaltyEntries.payoutId)));
  const [pending] = await d.select({ n: sql<number>`count(*)::int` }).from(payouts)
    .where(and(eq(payouts.userId, userId), eq(payouts.status, "pending")));
  if (owed.cents > 0 || pending.n > 0) {
    reasons.push("You have earnings we haven't paid yet. Once they're paid out, you can delete your account, or write to us to give them up.");
  }
  return reasons;
}

export async function deleteAccount(userId: string) {
  const blockers = await deletionBlockers(userId);
  if (blockers.length) throw new Error(blockers[0]);
  const d = await db();
  const [user] = await d.select().from(users).where(eq(users.id, userId));
  if (!user || user.deletedAt) return;
  await d.transaction(async (tx) => {
    // Drafts: designs no campaign, challenge, earning or wholesale brief points to.
    const kept = [
      ...(await tx.select({ id: campaigns.designId }).from(campaigns).where(eq(campaigns.userId, userId))),
      ...(await tx.select({ id: challengeEntries.designId }).from(challengeEntries).where(eq(challengeEntries.userId, userId))),
      ...(await tx.select({ id: royaltyEntries.designId }).from(royaltyEntries).where(eq(royaltyEntries.userId, userId))),
      ...(await tx.select({ id: designBriefs.designId }).from(designBriefs).where(eq(designBriefs.designerId, userId))),
    ].map((r) => r.id).filter((id): id is string => Boolean(id));
    const drafts = (await tx.select({ id: designs.id }).from(designs)
      .where(kept.length ? and(eq(designs.userId, userId), notInArray(designs.id, kept)) : eq(designs.userId, userId))).map((r) => r.id);
    if (drafts.length) {
      await tx.delete(media).where(inArray(media.designId, drafts));
      await tx.delete(generations).where(inArray(generations.designId, drafts));
      await tx.delete(designs).where(inArray(designs.id, drafts));
    }
    await tx.delete(identities).where(eq(identities.userId, userId));
    await tx.delete(loginTokens).where(eq(loginTokens.userId, userId));
    await tx.delete(payoutMethods).where(eq(payoutMethods.userId, userId));
    await tx.delete(pushTokens).where(eq(pushTokens.userId, userId));
    await tx.delete(emails).where(eq(emails.to, user.email));
    const tag = userId.slice(0, 8);
    await tx.update(users).set({
      name: "Former designer", email: `deleted-${userId}@deleted.invalid`, handle: `deleted-${tag}`,
      bio: null, avatarKey: null, location: null, instagram: null, credits: 0,
      agreementVersion: null, agreementAcceptedAt: null, aiBusyUntil: null, deletedAt: new Date(),
    }).where(eq(users.id, userId));
  });
}
