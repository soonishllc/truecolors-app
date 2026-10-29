import { and, eq, gte, sql } from "drizzle-orm";
import sharp from "sharp";
import { colourPrompt, lineArtPrompt, preset, promptFlags, refinePrompt, sketchPrompt } from "../ai/presets";
import { imageProvider } from "../ai/provider";
import { db } from "../db/client";
import { designs, generations, media, users } from "../db/schema";
import { renderMockup, templates } from "../media/mockups";
import { revealVideo } from "../media/video";
import { CREDIT_COST } from "../rules";
import { get, put } from "../storage";
import { cleanLineArt, composite, fillColourLimit, printFiles } from "./layers";

export class UserError extends Error {}

async function spendCredits(userId: string, amount: number) {
  const d = await db();
  const rows = await d
    .update(users)
    .set({ credits: sql`${users.credits} - ${amount}` })
    .where(and(eq(users.id, userId), gte(users.credits, amount)))
    .returning({ credits: users.credits });
  if (!rows.length) throw new UserError("Not enough credits. Ask Truecolors for more.");
}

async function refundCredits(userId: string, amount: number) {
  const d = await db();
  await d.update(users).set({ credits: sql`${users.credits} + ${amount}` }).where(eq(users.id, userId));
}

// Charges credits, and gives them back if the AI call fails.
async function withCredits<T>(userId: string, amount: number, fn: () => Promise<T>): Promise<T> {
  await spendCredits(userId, amount);
  try {
    return await fn();
  } catch (e) {
    await refundCredits(userId, amount);
    throw e;
  }
}

async function ownedDesign(designId: string, userId: string) {
  const d = await db();
  const [design] = await d.select().from(designs).where(and(eq(designs.id, designId), eq(designs.userId, userId)));
  if (!design) throw new UserError("Design not found.");
  return design;
}

async function checkText(text: string) {
  const m = await imageProvider().moderateText(text);
  if (m.flagged) throw new UserError("That idea can't be used. Try something else.");
}

async function checkImage(png: Buffer) {
  const m = await imageProvider().moderateImage(png);
  if (m.flagged) throw new UserError("The result was blocked by moderation. Try a different idea.");
}

// A photo or scan of a drawing, upright, on white and small enough for the image model.
async function readSketch(upload: Buffer) {
  try {
    return await sharp(upload).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).png().toBuffer();
  } catch {
    throw new UserError("That sketch couldn't be opened. Upload a JPG, PNG or HEIC photo of it.");
  }
}

// From a written idea, or from the designer's own sketch, which the AI redraws as print-ready line art.
export async function createDesign(
  userId: string, input: { title: string; presetId: string; idea: string; sketch?: Buffer },
) {
  const p = preset(input.presetId);
  await checkText(`${input.title}\n${input.idea}`);
  const sketch = input.sketch && (await readSketch(input.sketch));
  if (sketch) await checkImage(sketch);
  const ai = imageProvider();
  const prompt = sketch ? sketchPrompt(p, input.idea) : lineArtPrompt(p, input.idea);

  const lineArt = await withCredits(userId, CREDIT_COST.line_art, async () => {
    const raw = sketch ? await ai.fromSketch(sketch, prompt, userId) : await ai.lineArt(prompt, userId);
    await checkImage(raw);
    return cleanLineArt(raw);
  });
  const key = await put("designs", "png", lineArt);

  const d = await db();
  const [design] = await d
    .insert(designs)
    .values({
      userId,
      title: input.title,
      preset: p.id,
      prompt: input.idea,
      lineArtKey: key,
      flags: promptFlags(`${input.title} ${input.idea}`),
    })
    .returning();
  await d.insert(generations).values({
    designId: design.id, userId, kind: "line_art", prompt, provider: ai.name, credits: CREDIT_COST.line_art, outputKey: key,
  });
  return design;
}

// A new version of the line art. Any colour, print files and media made from the old one are dropped.
export async function refineDesign(userId: string, designId: string, instruction: string) {
  const design = await ownedDesign(designId, userId);
  await checkText(instruction);
  const ai = imageProvider();
  const prompt = refinePrompt(instruction);
  const lineArt = await withCredits(userId, CREDIT_COST.refine, async () => {
    const raw = await ai.refine(await get(design.lineArtKey!), prompt, userId);
    await checkImage(raw);
    return cleanLineArt(raw);
  });
  const key = await put("designs", "png", lineArt);
  const d = await db();
  await d.delete(media).where(eq(media.designId, designId));
  await d
    .update(designs)
    .set({
      lineArtKey: key, colourKey: null, compositeKey: null, printLineKey: null, printColourKey: null, printReport: null,
      flags: [...new Set([...design.flags, ...promptFlags(instruction)])], updatedAt: new Date(),
    })
    .where(eq(designs.id, designId));
  await d.insert(generations).values({
    designId, userId, kind: "refine", prompt, provider: ai.name, credits: CREDIT_COST.refine, outputKey: key,
  });
}

export async function colourDesign(userId: string, designId: string) {
  const design = await ownedDesign(designId, userId);
  const ai = imageProvider();
  const prompt = colourPrompt(design.prompt, fillColourLimit());
  const lineArt = await get(design.lineArtKey!);
  const colour = await withCredits(userId, CREDIT_COST.colour, async () => {
    const raw = await ai.colour(lineArt, prompt, userId);
    await checkImage(raw);
    return raw;
  });
  const sun = await composite(lineArt, colour);
  const print = await printFiles(lineArt, colour);
  const [colourKey, compositeKey, printLineKey, printColourKey] = await Promise.all([
    put("designs", "png", colour),
    put("designs", "png", sun),
    put("print", "png", print.line),
    put("print", "png", print.colour),
  ]);
  const d = await db();
  await d.delete(media).where(eq(media.designId, designId));
  await d
    .update(designs)
    .set({ colourKey, compositeKey, printLineKey, printColourKey, printReport: print.report, updatedAt: new Date() })
    .where(eq(designs.id, designId));
  await d.insert(generations).values({
    designId, userId, kind: "colour", prompt, provider: ai.name, credits: CREDIT_COST.colour, outputKey: colourKey,
  });
  return print.report;
}

// Mockups on every template plus the reveal video. Free: no AI involved.
export async function renderMedia(userId: string, designId: string) {
  const design = await ownedDesign(designId, userId);
  if (!design.compositeKey) throw new UserError("Colour the design before making mockups.");
  const shadeArt = await get(design.lineArtKey!);
  const sunArt = await get(design.compositeKey);
  const rows: (typeof media.$inferInsert)[] = [];
  let story: { shade?: Buffer; sun?: Buffer } = {};

  for (const t of templates()) {
    for (const view of t.split ? (["sun"] as const) : (["shade", "sun"] as const)) {
      const png = await renderMockup(t, shadeArt, sunArt, view);
      rows.push({ designId, kind: "mockup", template: t.id, view, key: await put("media", "png", png) });
      if (t.height > t.width && !t.split) story = { ...story, [view]: png };
    }
  }
  if (story.shade && story.sun) {
    const mp4 = await revealVideo(story.shade, story.sun);
    rows.push({ designId, kind: "video", template: "reveal", view: "reveal", key: await put("media", "mp4", mp4) });
  }

  const d = await db();
  await d.delete(media).where(eq(media.designId, designId));
  await d.insert(media).values(rows);
}
