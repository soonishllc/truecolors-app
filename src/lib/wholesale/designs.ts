import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { campaigns, designBriefs, designs, royaltyEntries, users, wholesalers } from "../db/schema";
import { UserError } from "../design/service";
import { sendEmail } from "../email";
import { PAYOUT_BUFFER_DAYS, RETURN_WINDOW_DAYS, royaltyCents, SHARE_BPS } from "../rules";
import { fileUrl } from "../storage";
import { wholesaleOps } from "./ops";
import { notify } from "./orders";
import { publicUrl } from "../links";

// Location designs: a wholesaler asks for a design around their city, resort or landmark; the team assigns
// a studio designer; the designer submits one of their finished designs; the wholesaler approves the shade
// and sun mockups in the portal; and it becomes a wholesale product only they can order. Truecolors owns
// it unless agreed otherwise, and the designer earns their usual share on every wholesale and display sale.

export type Brief = typeof designBriefs.$inferSelect;

const DAY = 86_400_000;
const OPEN_FOR_DESIGNER = ["assigned", "changes_requested"] as const;

const newRef = () => {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `B-${[...randomBytes(5)].map((b) => alphabet[b % alphabet.length]).join("")}`;
};

const absolute = (key: string) => `${config().APP_URL}${fileUrl(key)}`;

async function brief(id: string) {
  const d = await db();
  const [b] = await d.select().from(designBriefs).where(eq(designBriefs.id, id));
  if (!b) throw new UserError("No such design brief.");
  const [w] = await d.select().from(wholesalers).where(eq(wholesalers.id, b.wholesalerId));
  return { b, w };
}

export async function requestDesign(wholesalerId: string, contactId: string | null, text: string): Promise<Brief> {
  if (text.trim().length < 10) throw new UserError("Tell us a little about the design: the place, the landmark, the feel.");
  const d = await db();
  const [w] = await d.select().from(wholesalers).where(eq(wholesalers.id, wholesalerId));
  if (w?.status !== "active") throw new UserError("Location designs are for active wholesale accounts.");
  const [b] = await d
    .insert(designBriefs)
    .values({ ref: newRef(), wholesalerId: w.id, requestedBy: contactId, brief: text.trim() })
    .returning();
  return b;
}

// From the Admin page: give the brief to a designer, who sees it in their studio.
export async function assignBrief(briefId: string, designerEmail: string) {
  const d = await db();
  const [designer] = await d.select().from(users).where(eq(users.email, designerEmail.trim().toLowerCase()));
  if (!designer) throw new UserError("No designer with that email.");
  const { b, w } = await brief(briefId);
  if (!["open", "assigned", "changes_requested"].includes(b.status)) throw new UserError("That brief is past the design stage.");
  await d
    .update(designBriefs)
    .set({ designerId: designer.id, status: b.designId ? "changes_requested" : "assigned", updatedAt: new Date() })
    .where(eq(designBriefs.id, b.id));
  await sendEmail({
    to: designer.email,
    subject: `A location design brief for you: ${w.name}`,
    body: `Hi ${designer.name},\n\n${w.name} would like a design:\n\n"${b.brief}"\n\nMake it in your studio as usual, then submit it from the brief at ${publicUrl("/studio#briefs")}. Truecolors owns location designs; you earn your usual ${SHARE_BPS / 100}% on every shirt sold.`,
    key: `brief-assigned:${b.id}:${designer.id}`,
  });
}

export async function briefsForDesigner(userId: string) {
  const d = await db();
  return d
    .select({ b: designBriefs, w: wholesalers })
    .from(designBriefs)
    .innerJoin(wholesalers, eq(wholesalers.id, designBriefs.wholesalerId))
    .where(and(eq(designBriefs.designerId, userId), inArray(designBriefs.status, [...OPEN_FOR_DESIGNER, "in_review", "approved", "live"])))
    .orderBy(desc(designBriefs.updatedAt));
}

// The designer submits a finished, print-ready design for the brief; the wholesaler is asked to review it.
export async function submitBriefDesign(userId: string, briefId: string, designId: string) {
  const d = await db();
  const { b, w } = await brief(briefId);
  if (b.designerId !== userId || !(OPEN_FOR_DESIGNER as readonly string[]).includes(b.status)) {
    throw new UserError("That brief isn't waiting for a design from you.");
  }
  const [design] = await d.select().from(designs).where(and(eq(designs.id, designId), eq(designs.userId, userId)));
  if (!design) throw new UserError("Design not found.");
  if (!design.printReport?.ok || !design.lineArtKey || !design.compositeKey) {
    throw new UserError("Finish the design first: line art, colour and a passing print check.");
  }
  await d
    .update(designBriefs)
    .set({ designId: design.id, status: "in_review", feedback: null, updatedAt: new Date() })
    .where(eq(designBriefs.id, b.id));
  await notify(w, `brief-review:${b.id}:${design.id}`, `Your Truecolors design is ready to review (${b.ref})`, [
    `"${design.title}" for your brief:\n"${b.brief}"`,
    `See it in the shade and in the sun, and approve it or ask for changes:\n${publicUrl("/wholesale#designs")}`,
  ]);
}

export async function briefsFor(wholesalerId: string) {
  const d = await db();
  return d
    .select({ b: designBriefs, design: designs })
    .from(designBriefs)
    .leftJoin(designs, eq(designs.id, designBriefs.designId))
    .where(and(eq(designBriefs.wholesalerId, wholesalerId), inArray(designBriefs.status, ["open", "assigned", "in_review", "changes_requested", "approved", "live"])))
    .orderBy(desc(designBriefs.createdAt));
}

// The wholesaler's answer. Approving turns the design into their wholesale product.
export async function respondToDesign(wholesalerId: string, ref: string, approve: boolean, feedback = "") {
  const d = await db();
  const [b] = await d
    .select()
    .from(designBriefs)
    .where(and(eq(designBriefs.wholesalerId, wholesalerId), eq(designBriefs.ref, ref.trim().toUpperCase())));
  if (b?.status !== "in_review") throw new UserError(`Design ${ref} isn't waiting for your review.`);
  if (!approve && feedback.trim().length < 5) throw new UserError("Tell the designer what to change.");
  await d
    .update(designBriefs)
    .set({ status: approve ? "approved" : "changes_requested", feedback: approve ? null : feedback.trim(), updatedAt: new Date() })
    .where(eq(designBriefs.id, b.id));
  const [designer] = b.designerId ? await d.select().from(users).where(eq(users.id, b.designerId)) : [];
  if (designer) {
    await sendEmail({
      to: designer.email,
      subject: approve ? `Approved: your location design (${b.ref})` : `Changes requested on your location design (${b.ref})`,
      body: approve
        ? `Hi ${designer.name},\n\nThe wholesaler approved your design. It's going into their wholesale catalog, and you'll earn your share on every shirt sold.`
        : `Hi ${designer.name},\n\nThe wholesaler asked for changes:\n\n"${feedback.trim()}"\n\nUpdate the design in your studio and submit it again from the brief.`,
      key: `brief-${approve ? "approved" : "changes"}:${b.id}:${Date.now()}`,
    });
  }
  if (approve) await makeLocationProduct(b.id);
}

// A short design code for the SKU that clashes with no campaign or other location design.
async function uniqueDesignCode(title: string): Promise<string> {
  const d = await db();
  const letters = title.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 4) || "LOC";
  for (let n = 0; n < 50; n++) {
    const code = `L${letters}${n ? n + 1 : ""}`;
    const clash = [
      ...(await d.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.designCode, code))),
      ...(await d.select({ id: designBriefs.id }).from(designBriefs).where(eq(designBriefs.designCode, code))),
    ];
    if (!clash.length) return code;
  }
  throw new Error("Could not find a free design code");
}

// Creates the wholesale product. Anything that stops it is kept on the brief for the Admin page to retry.
export async function makeLocationProduct(briefId: string) {
  const d = await db();
  const { b, w } = await brief(briefId);
  if (b.status !== "approved" || !b.designId) throw new UserError("Only approved briefs become products.");
  const [design] = await d.select().from(designs).where(eq(designs.id, b.designId));
  try {
    const designCode = b.designCode ?? (await uniqueDesignCode(design.title));
    await d.update(designBriefs).set({ designCode }).where(eq(designBriefs.id, b.id));
    const { productId } = await wholesaleOps().createLocationProduct({
      title: design.title,
      designCode,
      descriptionHtml: `<p>A Truecolors location design for ${w.name}. Grey line art in the shade, full colour in the sun.</p>`,
      imageUrls: [design.compositeKey!, design.lineArtKey!].map(absolute),
      exclusiveTo: b.exclusiveUntil && b.exclusiveUntil < new Date() ? null : w.id,
      designId: design.id,
    });
    await d
      .update(designBriefs)
      .set({ status: "live", shopifyProductId: productId, problem: null, updatedAt: new Date() })
      .where(eq(designBriefs.id, b.id));
    await notify(w, `brief-live:${b.id}`, `"${design.title}" is in your Truecolors catalog`, [
      "Your location design is ready to order. Only you can order it.",
      publicUrl("/wholesale"),
    ]);
  } catch (e) {
    console.error(`[location design] ${b.ref}:`, (e as Error).message);
    await d.update(designBriefs).set({ problem: (e as Error).message }).where(eq(designBriefs.id, b.id));
  }
}

export async function adminBriefs() {
  const d = await db();
  return d
    .select({ b: designBriefs, w: wholesalers, designer: users, design: designs })
    .from(designBriefs)
    .innerJoin(wholesalers, eq(wholesalers.id, designBriefs.wholesalerId))
    .leftJoin(users, eq(users.id, designBriefs.designerId))
    .leftJoin(designs, eq(designs.id, designBriefs.designId))
    .where(or(inArray(designBriefs.status, ["open", "assigned", "in_review", "changes_requested", "approved"]), isNotNull(designBriefs.problem)))
    .orderBy(desc(designBriefs.createdAt));
}

// Royalties on location designs. `lines` carry SKUs (TC-<code>-WHT-<size>); only SKUs of live location
// designs with a designer earn. Each source line earns once, however often this runs.
export async function recordLocationRoyalties(input: {
  source: string; currency: string; lines: { sku: string; quantity: number; unit: string }[]; payableAfter: Date;
}) {
  const d = await db();
  const live = await d
    .select()
    .from(designBriefs)
    .where(and(eq(designBriefs.status, "live"), isNotNull(designBriefs.designerId), isNotNull(designBriefs.designCode)));
  const byCode = new Map(live.map((b) => [b.designCode!, b]));
  for (const line of input.lines) {
    const code = line.sku.match(/^TC-(.+)-WHT-[^-]+$/)?.[1];
    const b = code ? byCode.get(code) : undefined;
    if (!b || line.quantity <= 0) continue;
    const baseCents = Math.round(Number(line.unit) * 100) * line.quantity;
    await d
      .insert(royaltyEntries)
      .values({
        userId: b.designerId!, designId: b.designId, kind: "earning", sourceRef: `${input.source}:${line.sku}`,
        rateBps: SHARE_BPS, baseCents, amountCents: royaltyCents(baseCents, SHARE_BPS), currency: input.currency,
        payableAfter: input.payableAfter,
      })
      .onConflictDoNothing();
  }
}

export const royaltyHold = (from: Date) => new Date(from.getTime() + (RETURN_WINDOW_DAYS + PAYOUT_BUFFER_DAYS) * DAY);
