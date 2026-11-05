import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { makeBrief, tidyIdea, tidyInstruction } from "../ai/brief";
import { colourPrompt, lineArtPrompt, preset, promptFlags, refinePrompt, sketchPrompt } from "../ai/presets";
import { imageProvider } from "../ai/provider";
import { db } from "../db/client";
import { campaigns, designs, generations, media, users, type DesignOptions, type Placement } from "../db/schema";
import { renderMockup, templates } from "../media/mockups";
import { fadeVideo, revealVideo } from "../media/video";
import { CREDIT_COST, PRINT } from "../rules";
import { get, put } from "../storage";
import { BACKDROP, cleanLineArt, colourLines, composite, fillColourLimit, printFiles, shadeView } from "./layers";

export class UserError extends Error {}

// Photos of real Truecolors shirts in the sun, shown to the AI as the colour style to match: fully and boldly
// coloured, every shape filled.
const STYLE_REFS = ["camel-sun.jpg", "emirati-sun.jpg", "beach-sun.jpg"].map((f) => path.join(process.cwd(), "templates", "style", f));

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

// One AI job per designer at a time. A second tap (or a second tab) while one is running is refused instead of
// starting, and charging for, another image; and a colour can't be made from line art that's being redrawn.
// The lock lapses on its own after a few minutes in case a server dies mid-job.
const AI_LOCK_MS = 3 * 60_000;

async function withAiLock<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const d = await db();
  const now = new Date();
  const got = await d
    .update(users)
    .set({ aiBusyUntil: new Date(now.getTime() + AI_LOCK_MS) })
    .where(and(eq(users.id, userId), or(isNull(users.aiBusyUntil), lt(users.aiBusyUntil, now))))
    .returning({ id: users.id });
  if (!got.length) throw new UserError("Your last drawing is still being made. It'll be ready in a moment: refresh to see it.");
  try {
    return await fn();
  } finally {
    await d.update(users).set({ aiBusyUntil: null }).where(eq(users.id, userId));
  }
}

// A design in a campaign is what backers are buying: it can't be redrawn or recoloured any more.
const LOCKED: ("in_review" | "live" | "closing" | "funded" | "in_production" | "shipped")[] = ["in_review", "live", "closing", "funded", "in_production", "shipped"];

async function assertEditable(designId: string) {
  const d = await db();
  const [c] = await d.select({ id: campaigns.id }).from(campaigns).where(and(eq(campaigns.designId, designId), inArray(campaigns.status, LOCKED)));
  if (c) throw new UserError("This design is in a campaign, so it can't be changed now.");
}

const PLACEMENTS: Placement[] = ["front", "back", "chest"];

// The choices made on the new-design form, checked.
export function designOptions(input: { text?: string; placement?: string; detail?: string }): DesignOptions {
  const text = input.text?.trim().replace(/\s+/g, " ");
  if (text && text.length > 60) throw new UserError("Keep the words on the shirt to 60 characters.");
  return {
    ...(text ? { text } : {}),
    placement: PLACEMENTS.includes(input.placement as Placement) ? (input.placement as Placement) : "front",
    detail: input.detail === "detailed" ? "detailed" : "bold",
  };
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

// The image model refuses some prompts outright (real people, brands). That's the designer's to fix, not a crash.
async function imageCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if ((e as { code?: string }).code === "moderation_blocked") {
      throw new UserError("The image model refused that idea. If it names a real person, brand or character, describe it without the name.");
    }
    throw e;
  }
}

async function checkImage(png: Buffer) {
  const m = await imageProvider().moderateImage(png);
  if (m.flagged) throw new UserError("The result was blocked by moderation. Try a different idea.");
}

// A photo or scan of a drawing, upright, on white and small enough for the image model.
async function readSketch(upload: Buffer) {
  try {
    // A small file can still unpack to a huge image; 40 megapixels is far more than any phone photo.
    return await sharp(upload, { limitInputPixels: 40_000_000 }).rotate().resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).png().toBuffer();
  } catch {
    throw new UserError("That sketch couldn't be opened. Upload a JPG or PNG photo of it.");
  }
}

// From a written idea, or from the designer's own sketch, which the AI redraws as print-ready line art.
export async function createDesign(
  userId: string, input: { title: string; presetId: string; idea: string; sketch?: Buffer; options?: DesignOptions },
) {
  return withAiLock(userId, () => drawDesign(userId, input));
}

async function drawDesign(
  userId: string, input: { title: string; presetId: string; idea: string; sketch?: Buffer; options?: DesignOptions },
) {
  const p = preset(input.presetId);
  const options: DesignOptions = { ...input.options };
  await checkText(`${input.title}\n${input.idea}\n${options.text ?? ""}`);
  const sketch = input.sketch && (await readSketch(input.sketch));
  if (sketch) await checkImage(sketch);
  const ai = imageProvider();
  // Whatever was typed becomes a drawable, printable brief; words it settles on are kept with the design, so a
  // redraw letters the same words.
  const brief = await makeBrief({ presetId: p.id, idea: input.idea, options: input.options, sketch: Boolean(sketch) }, userId);
  if (brief.words && !options.text) options.text = brief.words;
  const prompt = sketch ? sketchPrompt(p, brief.subject, options) : lineArtPrompt(p, brief.subject, options);

  const lineArt = await withCredits(userId, CREDIT_COST.line_art, async () => {
    const raw = await imageCall(() => (sketch ? ai.fromSketch(sketch, prompt, userId) : ai.lineArt(prompt, userId, p.refs)));
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
      options,
      flags: promptFlags(`${input.title} ${input.idea} ${options.text ?? ""}`),
    })
    .returning();
  await d.insert(generations).values({
    designId: design.id, userId, kind: "line_art", prompt, provider: ai.name, credits: CREDIT_COST.line_art, outputKey: key,
  });
  return design;
}

// A new version of the line art. Any colour, print files and media made from the old one are dropped.
export async function refineDesign(userId: string, designId: string, instruction: string) {
  return withAiLock(userId, () => redraw(userId, designId, instruction));
}

async function redraw(userId: string, designId: string, instruction: string) {
  const design = await ownedDesign(designId, userId);
  await assertEditable(designId);
  await checkText(instruction);
  const ai = imageProvider();
  const prompt = refinePrompt(tidyInstruction(instruction).text, design.options);
  const lineArt = await withCredits(userId, CREDIT_COST.refine, async () => {
    // From the drawing as approved, not the lines taken from its colouring.
    const raw = await imageCall(async () => ai.refine(await get(design.outlineKey ?? design.lineArtKey!), prompt, userId));
    await checkImage(raw);
    return cleanLineArt(raw);
  });
  const key = await put("designs", "png", lineArt);
  const d = await db();
  await d.delete(media).where(eq(media.designId, designId));
  await d
    .update(designs)
    .set({
      lineArtKey: key, outlineKey: null, colourKey: null, compositeKey: null, printLineKey: null, printColourKey: null, printReport: null,
      flags: [...new Set([...design.flags, ...promptFlags(instruction)])], updatedAt: new Date(),
    })
    .where(eq(designs.id, designId));
  await d.insert(generations).values({
    designId, userId, kind: "refine", prompt, provider: ai.name, credits: CREDIT_COST.refine, outputKey: key,
  });
}

// The backdrop margin for a design: none unless the designer asked for a glow behind it (and the style allows one).
const backdropFor = (design: { preset: string; options: DesignOptions }) =>
  design.options.glow ? preset(design.preset).backdrop ?? BACKDROP : 0;

// What the drawing is of, for the colouring: the brief's subject from the prompt that drew it, else the tidied idea.
async function subjectOf(designId: string, idea: string) {
  const d = await db();
  const [g] = await d.select({ prompt: generations.prompt }).from(generations)
    .where(and(eq(generations.designId, designId), eq(generations.kind, "line_art"))).orderBy(desc(generations.createdAt)).limit(1);
  return g?.prompt.match(/^Subject: (.+)\.$/m)?.[1] || tidyIdea(idea).text || "the drawing";
}

// `choice` is what the designer picked for this colouring: a palette, and whether to paint a glow behind.
export async function colourDesign(userId: string, designId: string, choice: { palette?: string; glow?: boolean } = {}) {
  return withAiLock(userId, () => paint(userId, designId, choice));
}

async function paint(userId: string, designId: string, choice: { palette?: string; glow?: boolean }) {
  const found = await ownedDesign(designId, userId);
  await assertEditable(designId);
  const options: DesignOptions = { ...found.options, ...(choice.palette ? { palette: choice.palette } : {}), glow: Boolean(choice.glow) };
  const design = { ...found, options };
  const ai = imageProvider();
  const refs = PRINT.fullColour ? STYLE_REFS.map((f) => readFileSync(f)) : [];
  const backdrop = backdropFor(design);
  const prompt = colourPrompt(await subjectOf(design.id, design.prompt), PRINT.fullColour ? null : fillColourLimit(), refs.length > 0, backdrop > 0, options.palette);
  // A recolour starts from the approved drawing again, not the lines taken from the last colouring.
  const outlineKey = design.outlineKey ?? design.lineArtKey!;
  const drawing = await get(outlineKey);
  const colour = await withCredits(userId, CREDIT_COST.colour, async () => {
    const raw = await imageCall(() => ai.colour(drawing, prompt, userId, refs));
    await checkImage(raw);
    return raw;
  });
  const colourKey = await put("designs", "png", colour);
  const d = await db();
  await d.update(designs).set({ options, outlineKey }).where(eq(designs.id, designId));
  const report = await layDown(designId, drawing, colour, colourKey, backdrop, options.placement);
  await d.insert(generations).values({
    designId, userId, kind: "colour", prompt, provider: ai.name, credits: CREDIT_COST.colour, outputKey: colourKey,
  });
  return report;
}

// Trims the stored colour to the design's outline and backdrop again and remakes the sun view and print files.
// Free: no AI. Mockups need renderMedia afterwards.
export async function recomposeDesign(userId: string, designId: string) {
  const design = await ownedDesign(designId, userId);
  if (!design.colourKey) throw new UserError("Colour the design first.");
  await assertEditable(designId);
  const outlineKey = design.outlineKey ?? design.lineArtKey!;
  const d = await db();
  await d.update(designs).set({ outlineKey }).where(eq(designs.id, designId));
  return layDown(designId, await get(outlineKey), await get(design.colourKey), design.colourKey, backdropFor(design), design.options.placement);
}

// How much the AI's colour is lifted: the ink is vivid in the sun, and the AI tends to paint pale.
const SUN_SATURATION = 1.15;

// The shade lines, sun view and print files from the approved drawing and its colouring; saves them and drops the
// media made from the old ones. The visible lines come from the colouring itself so lines and colour line up; the
// approved drawing bounds where colour may go.
async function layDown(designId: string, drawing: Buffer, colour: Buffer, colourKey: string, backdrop: number, placement?: Placement) {
  const lifted = await sharp(colour).modulate({ saturation: SUN_SATURATION }).png().toBuffer();
  const lines = await colourLines(colour);
  // What shows indoors: the lines with grey shading worked out from the colour (see layers.tones).
  const shade = await shadeView(lines, colour, backdrop, drawing);
  const sun = await composite(lines, lifted, backdrop, drawing);
  const print = await printFiles(lines, lifted, backdrop, drawing, placement);
  const [lineArtKey, compositeKey, printLineKey, printColourKey] = await Promise.all([
    put("designs", "png", shade),
    put("designs", "png", sun),
    put("print", "png", print.line),
    put("print", "png", print.colour),
  ]);
  const d = await db();
  await d.delete(media).where(eq(media.designId, designId));
  await d
    .update(designs)
    .set({ lineArtKey, colourKey, compositeKey, printLineKey, printColourKey, printReport: print.report, updatedAt: new Date() })
    .where(eq(designs.id, designId));
  return print.report;
}

// Mockups on every template plus the reveal video. Free: no AI involved.
// Rendering is heavy (every mockup plus the videos), so it takes the same one-job-at-a-time lock as the AI, and
// a design in a campaign keeps the media its backers saw.
export async function renderMedia(userId: string, designId: string) {
  await assertEditable(designId);
  return withAiLock(userId, () => makeMedia(userId, designId));
}

async function makeMedia(userId: string, designId: string) {
  const design = await ownedDesign(designId, userId);
  if (!design.compositeKey) throw new UserError("Colour the design before making mockups.");
  const shadeArt = await get(design.lineArtKey!);
  const sunArt = await get(design.compositeKey);
  const rows: (typeof media.$inferInsert)[] = [];
  // The reveal video is made from the first plain (not half-and-half) shot.
  const revealFrom = templates().find((t) => !t.split)?.id;
  const reveal: { shade?: Buffer; sun?: Buffer } = {};
  const flat: { shade?: Buffer; sun?: Buffer } = {};

  for (const t of templates()) {
    for (const view of t.split ? (["sun"] as const) : (["shade", "sun"] as const)) {
      const png = await renderMockup(t, shadeArt, sunArt, view, design.options.placement);
      rows.push({ designId, kind: "mockup", template: t.id, view, key: await put("media", "png", png) });
      if (t.id === revealFrom) reveal[view] = png;
      if (t.id === "flat-square") flat[view] = png;
    }
  }
  // The card animation: the flat lay fading from shade to sun.
  if (flat.shade && flat.sun) {
    const mp4 = await fadeVideo(flat.shade, flat.sun);
    rows.push({ designId, kind: "sweep", template: "flat-square", view: "sun", key: await put("media", "mp4", mp4) });
  }
  if (reveal.shade && reveal.sun) {
    const mp4 = await revealVideo(reveal.shade, reveal.sun);
    rows.push({ designId, kind: "video", template: "reveal", view: "reveal", key: await put("media", "mp4", mp4) });
  }

  const d = await db();
  // Worn clips show the same artwork, so they survive a re-render; new artwork clears them with everything else.
  await d.delete(media).where(and(eq(media.designId, designId), ne(media.kind, "worn")));
  await d.insert(media).values(rows);
}
