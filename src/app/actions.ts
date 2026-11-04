"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  acceptAgreement, clearPendingSignUp, createInvite, pendingSignUp, requireAdmin, requireUser, sendLoginLink, signUp,
} from "@/lib/auth/session";
import {
  clearAttention, relaunchCampaign, reviewCampaign, submitCampaign, tick,
} from "@/lib/campaigns/service";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { colourDesign, createDesign, refineDesign, renderMedia, UserError } from "@/lib/design/service";
import { createBatch, markBatch } from "@/lib/production/batch";
import { markPayoutPaid, preparePayouts } from "@/lib/royalties/ledger";
import { eq, sql } from "drizzle-orm";
import { currentFan, joinWaitlist, leaveWaitlist, sendFanLink, signOutFan } from "@/lib/fans";
import { createChallenge, enterChallenge, toggleVote } from "@/lib/challenges";
import { savePayoutMethod } from "@/lib/payouts/methods";
import { activateWholesaler, addContact, addOutlet, createWholesaler, updateOutletSettings } from "@/lib/wholesale/accounts";
import {
  confirmSalesReport, decideRestock, invoiceSettlement, markRestockSent, markSettlementPaid, recordStockCount, reportSales, requestRestock,
} from "@/lib/wholesale/consignment";
import { handBackToBot } from "@/lib/wholesale/bot";
import { markBankTransferPaid, placeOrder, quoteOrder, shipOrder } from "@/lib/wholesale/orders";
import { currentWholesaler } from "@/lib/wholesale/portal-auth";

export type FormState = { error?: string; message?: string; link?: string } | undefined;

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

// Turns expected failures into a message on the form; anything else is a real error.
async function attempt(fn: () => Promise<FormState | void>): Promise<FormState> {
  try {
    return (await fn()) ?? undefined;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}

export async function joinAction(_: FormState, f: FormData): Promise<FormState> {
  // Someone who came back from Google, Apple, X or Instagram is logged straight in.
  const via = await pendingSignUp();
  let joined = false;
  const res = await attempt(async () => {
    const link = await signUp({
      email: via?.profile.email ?? text(f, "email"), name: text(f, "name"), invite: text(f, "invite"),
      acceptAgreement: f.get("agree") === "on", via,
    });
    if (via) joined = true;
    else return { message: "Account created. We've sent you a login link.", link };
  });
  if (joined) redirect("/studio?welcome=1");
  return res;
}

export async function cancelSocialJoinAction() {
  await clearPendingSignUp();
  redirect("/join");
}

export async function loginAction(_: FormState, f: FormData): Promise<FormState> {
  const link = await sendLoginLink(text(f, "email"));
  return { message: "If that email has an account, a login link is on its way.", link };
}

export async function acceptAgreementAction() {
  const user = await requireUser();
  await acceptAgreement(user.id);
  revalidatePath("/studio");
}

export async function createDesignAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  let id = "";
  const res = await attempt(async () => {
    const file = f.get("sketch");
    const sketch = file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : undefined;
    const design = await createDesign(user.id, { title: text(f, "title"), presetId: text(f, "preset"), idea: text(f, "idea"), sketch });
    id = design.id;
  });
  if (id) redirect(`/studio/designs/${id}`);
  return res;
}

export async function designStepAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const designId = text(f, "designId");
  const step = text(f, "step");
  const res = await attempt(async () => {
    if (step === "refine") await refineDesign(user.id, designId, text(f, "instruction"));
    else if (step === "colour") await colourDesign(user.id, designId);
    else if (step === "media") await renderMedia(user.id, designId);
    else if (step === "launch") {
      await submitCampaign(user.id, designId, { title: text(f, "title"), story: text(f, "story") });
      return { message: "Sent for review. Truecolors will approve it before it goes live." };
    }
  });
  revalidatePath(`/studio/designs/${designId}`);
  return res;
}

export async function relaunchAction(f: FormData) {
  const user = await requireUser();
  await attempt(async () => {
    await relaunchCampaign(user.id, text(f, "campaignId"));
  });
  revalidatePath("/studio");
}

// ---- Admin -------------------------------------------------------------------------------------------

export async function reviewAction(_: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const res = await attempt(async () => {
    await reviewCampaign(admin.email, text(f, "campaignId"), text(f, "decision") === "approve", text(f, "note"));
  });
  revalidatePath("/admin");
  return res;
}

export async function inviteAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const code = await createInvite(text(f, "note"));
  revalidatePath("/admin");
  return { message: `Invite code: ${code}` };
}

export async function grantCreditsAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const amount = Number(text(f, "amount"));
  if (!Number.isInteger(amount) || amount <= 0) return { error: "Enter a whole number of credits." };
  const d = await db();
  const rows = await d
    .update(users)
    .set({ credits: sql`${users.credits} + ${amount}` })
    .where(eq(users.email, text(f, "email").toLowerCase()))
    .returning();
  return rows.length ? { message: `Added ${amount} credits.` } : { error: "No designer with that email." };
}

export async function tickAction(): Promise<FormState> {
  await requireAdmin();
  const log = await tick();
  revalidatePath("/admin");
  return { message: log.length ? log.join(" · ") : "Nothing to do." };
}

export async function batchAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    await createBatch(f.getAll("campaignId").map(String), text(f, "note"));
  });
  revalidatePath("/admin");
  return res;
}

export async function markBatchAction(f: FormData) {
  await requireAdmin();
  await markBatch(text(f, "batchId"), text(f, "status") as "sent" | "received");
  revalidatePath("/admin");
}

export async function preparePayoutsAction(): Promise<FormState> {
  await requireAdmin();
  const made = await preparePayouts();
  revalidatePath("/admin");
  return { message: made.length ? `${made.length} payouts ready to pay.` : "No earnings are payable yet." };
}

export async function payoutPaidAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(() => markPayoutPaid(text(f, "payoutId"), text(f, "reference")));
  revalidatePath("/admin");
  return res;
}

export async function clearAttentionAction(f: FormData) {
  await requireAdmin();
  await clearAttention(text(f, "pledgeId"));
  revalidatePath("/admin");
}

// ---- Admin: wholesale ----------------------------------------------------------------------------------

const checked = (f: FormData, k: string) => f.get(k) === "on";

export async function createWholesalerAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    const w = await createWholesaler({
      name: text(f, "name"), currency: text(f, "currency"), shopifyCustomerId: text(f, "shopifyCustomerId"),
      stockist: checked(f, "stockist"), displayPartner: checked(f, "displayPartner"),
      contactName: text(f, "contactName"), phone: text(f, "phone"), email: text(f, "email"),
    });
    return { message: `${w.name} is set up.` };
  });
  revalidatePath("/admin/wholesale");
  return res;
}

export async function activateWholesalerAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    await activateWholesaler({
      wholesalerId: text(f, "wholesalerId"), currency: text(f, "currency"), shopifyCustomerId: text(f, "shopifyCustomerId"),
      stockist: checked(f, "stockist"), displayPartner: checked(f, "displayPartner"),
    });
  });
  revalidatePath("/admin/wholesale");
  return res;
}

export async function addContactAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(() =>
    addContact({
      wholesalerId: text(f, "wholesalerId"), name: text(f, "name"), phone: text(f, "phone"),
      email: text(f, "email"), role: text(f, "role"),
    }),
  );
  revalidatePath("/admin/wholesale");
  return res;
}

export async function addOutletAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(() =>
    addOutlet({
      wholesalerId: text(f, "wholesalerId"), name: text(f, "name"), city: text(f, "city"), country: text(f, "country"),
      shopifyLocationId: text(f, "shopifyLocationId"), supplyRoute: text(f, "supplyRoute"),
      parPerSku: Number(text(f, "parPerSku") || 6), settlementDays: Number(text(f, "settlementDays") || 15),
    }),
  );
  revalidatePath("/admin/wholesale");
  return res;
}

export async function handBackToBotAction(f: FormData) {
  await requireAdmin();
  await handBackToBot(text(f, "conversationId"));
  revalidatePath("/admin/wholesale");
}

export async function markWholesalePaidAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    await markBankTransferPaid(text(f, "orderId"));
    return { message: "Marked paid. Shipping is booked if FedEx is set up." };
  });
  revalidatePath("/admin/wholesale");
  return res;
}

export async function retryShippingAction(f: FormData) {
  await requireAdmin();
  await shipOrder(text(f, "orderId"), { retry: true });
  revalidatePath("/admin/wholesale");
}

export async function outletSettingsAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    await updateOutletSettings({
      outletId: text(f, "outletId"), parPerSku: Number(text(f, "parPerSku")), settlementDays: Number(text(f, "settlementDays")),
      shopifyLocationId: text(f, "shopifyLocationId"),
    });
    return { message: "Saved." };
  });
  revalidatePath("/admin/wholesale");
  return res;
}

export async function decideRestockAction(f: FormData) {
  await requireAdmin();
  await decideRestock(text(f, "restockId"), text(f, "decision") === "approve");
  revalidatePath("/admin/wholesale");
}

export async function sendRestockAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    await markRestockSent(text(f, "restockId"));
    return { message: "Stock moved onto the display." };
  });
  revalidatePath("/admin/wholesale");
  return res;
}

export async function invoiceSettlementAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    await invoiceSettlement(text(f, "settlementId"));
    return { message: "Invoiced and emailed." };
  });
  revalidatePath("/admin/wholesale");
  return res;
}

export async function settlementPaidAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  const res = await attempt(async () => {
    await markSettlementPaid(text(f, "settlementId"));
    return { message: "Marked paid." };
  });
  revalidatePath("/admin/wholesale");
  return res;
}

// Counts are typed one per line: "TC-HAB-WHT-M 4". Anything on the display that isn't listed was not found.
export async function stockCountAction(_: FormState, f: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const counted = text(f, "counts")
    .split(/\n+/)
    .map((line) => line.trim().split(/[\s,=:]+/))
    .filter((parts) => parts[0])
    .map(([sku, qty]) => ({ sku, quantity: Number(qty) }));
  const res = await attempt(async () => {
    const c = await recordStockCount(text(f, "outletId"), counted, admin.email);
    return { message: c.missingUnits ? `${c.missingUnits} shirts missing; they go on the next settlement.` : "Count matches what was expected." };
  });
  revalidatePath("/admin/wholesale");
  return res;
}

// ---- Wholesaler portal --------------------------------------------------------------------------------

async function portalStockist() {
  const me = await currentWholesaler();
  if (!("wholesaler" in me) || !me.wholesaler) redirect("/wholesale");
  return me.wholesaler;
}

async function portalOutlet(outletId: string) {
  const me = await currentWholesaler();
  if (!("wholesaler" in me) || !me.wholesaler) redirect("/wholesale");
  const outlet = me.outlets.find((o) => o.id === outletId);
  if (!outlet) redirect("/wholesale");
  return { contact: me.contact, outlet };
}

export async function portalRestockAction(_: FormState, f: FormData): Promise<FormState> {
  const { contact, outlet } = await portalOutlet(text(f, "outletId"));
  const res = await attempt(async () => {
    const r = await requestRestock(outlet.id, contact.id, text(f, "note"));
    return { message: `Restock of ${r.units} shirts requested. We'll confirm when it's on its way.` };
  });
  revalidatePath("/wholesale");
  return res;
}

// Submitting the form is the partner confirming their numbers, so the report is confirmed straight away.
export async function portalSalesAction(_: FormState, f: FormData): Promise<FormState> {
  const { outlet } = await portalOutlet(text(f, "outletId"));
  const lines = [...f.entries()]
    .filter(([k, v]) => k.startsWith("qty:") && String(v).trim() !== "")
    .map(([k, v]) => ({ sku: k.slice(4), quantity: Number(v) }));
  const res = await attempt(async () => {
    const draft = await reportSales(outlet.id, lines, "portal");
    await confirmSalesReport(outlet.id, draft.ref);
    return { message: `Thanks: ${draft.units} shirts recorded (${draft.ref}).` };
  });
  revalidatePath("/wholesale");
  return res;
}

export async function portalQuoteAction(_: FormState, f: FormData): Promise<FormState> {
  const w = await portalStockist();
  const lines = [...f.entries()]
    .filter(([k, v]) => k.startsWith("qty:") && String(v).trim() !== "")
    .map(([k, v]) => ({ sku: k.slice(4), quantity: Number(v) }));
  let ref = "";
  const res = await attempt(async () => {
    ref = (await quoteOrder(w.id, lines)).ref;
  });
  if (!ref) return res;
  redirect(`/wholesale/order?quote=${ref}`);
}

export async function portalPlaceAction(_: FormState, f: FormData): Promise<FormState> {
  const w = await portalStockist();
  let to = "";
  const res = await attempt(async () => {
    const placed = await placeOrder(w.id, text(f, "quote"), text(f, "payment") === "bank_transfer" ? "bank_transfer" : "card");
    to = placed.payUrl ?? `/wholesale/order?placed=${placed.order.ref}`;
  });
  if (!to) return res;
  revalidatePath("/wholesale");
  redirect(to);
}

// ---- Fans: waitlists, referral links, votes ---------------------------------------------------------

const TARGET = /^(designer|campaign):[0-9a-f-]{36}$/;

export async function waitlistAction(_: FormState, f: FormData): Promise<FormState> {
  return attempt(async () => {
    const target = text(f, "target");
    if (!TARGET.test(target)) throw new UserError("Something went wrong. Reload the page and try again.");
    await joinWaitlist(text(f, "email"), target);
    return { message: target.startsWith("designer:") ? "You're on the list. We'll email you when they launch." : "Done. If it comes back, you'll hear first." };
  });
}

// Fans confirm their email once; the link brings them back to the page they were on.
export async function fanEmailAction(_: FormState, f: FormData): Promise<FormState> {
  return attempt(async () => {
    const why = {
      vote: "vote for your favourite designs",
      orders: "see your pre-orders",
    }[text(f, "why")] ?? "get your own link";
    const link = await sendFanLink(text(f, "email"), text(f, "next"), why);
    return { message: "Check your email and tap the link to carry on.", link };
  });
}

// ---- Design challenges ------------------------------------------------------------------------------

export async function voteAction(f: FormData) {
  const fan = await currentFan();
  if (!fan) redirect(`/challenges/${text(f, "slug")}?vote=email`);
  const slug = await toggleVote(fan.id, text(f, "entryId"));
  revalidatePath(`/challenges/${slug}`);
}

export async function enterChallengeAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await attempt(async () => {
    await enterChallenge(user.id, text(f, "challengeId"), text(f, "designId"));
    return { message: "You're in. Share the challenge page so fans vote for it." };
  });
  revalidatePath(`/challenges/${text(f, "slug")}`);
  return res;
}

export async function createChallengeAction(_: FormState, f: FormData): Promise<FormState> {
  await requireAdmin();
  return attempt(async () => {
    const ch = await createChallenge({
      title: text(f, "title"), brief: text(f, "brief"), prize: text(f, "prize"),
      submitBy: new Date(text(f, "submitBy")), voteBy: new Date(text(f, "voteBy")),
    });
    revalidatePath("/admin");
    return { message: `Created: /challenges/${ch.slug}` };
  });
}

// ---- Payout details ----------------------------------------------------------------------------------

const PAYOUT_FIELDS = ["paypalEmail", "holder", "country", "bankName", "iban", "swift", "accountNumber", "routing", "network", "address"];

export async function payoutMethodAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await attempt(async () => {
    const summary = await savePayoutMethod(user.id, text(f, "kind"), Object.fromEntries(PAYOUT_FIELDS.map((k) => [k, text(f, k)])));
    return { message: `Saved. You'll be paid by ${summary}.` };
  });
  revalidatePath("/studio");
  return res;
}

export async function unfollowAction(f: FormData) {
  const fan = await currentFan();
  if (fan) await leaveWaitlist(fan.email, text(f, "target"));
  revalidatePath("/me");
}

export async function fanSignOutAction() {
  await signOutFan();
  redirect("/me");
}
