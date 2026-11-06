import { and, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import sharp, { type OutputInfo, type Sharp } from "sharp";
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

// A customer's upload, made ready for the image model: a phone photo of a drawing becomes the drawing alone, upright,
// on clean white, cropped to it and centred on a square (the model draws on a square, so nothing gets squashed or
// cut). Paper colour, warm light, shadows and notebook rules are taken out here, so the model isn't tempted to
// draw them. A photo that isn't a drawing (a person, a pet, a place) is kept as it is and flagged, so the prompt
// can ask for it to be redrawn as line art. A page with no drawing on it is refused before any credits are spent.
export type Sketch = { png: Buffer; photo: boolean };

const SKETCH_PX = 1536;
const NO_DRAWING = "We couldn't find a drawing in that photo. Try a closer, brighter photo of it, from straight above.";

export async function readSketch(upload: Buffer): Promise<Sketch> {
  let px: { data: Buffer; info: OutputInfo };
  try {
    // A small file can still unpack to a huge image; 40 megapixels is far more than any phone photo. rotate() reads
    // the phone's EXIF orientation, so a portrait photo stored sideways comes out upright.
    px = await sharp(upload, { limitInputPixels: 40_000_000 }).rotate().resize(SKETCH_PX, SKETCH_PX, { fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch {
    throw new UserError("That sketch couldn't be opened. Upload a JPG or PNG photo of it.");
  }
  const { width: w, height: h } = px.info;
  const rgb = px.data;
  const asPng = (data: Buffer) => sharp(data, { raw: { width: w, height: h, channels: 3 } });

  // Paper is the brightest thing nearby, so each pixel is divided by its neighbourhood's brightest value: paper
  // comes out white under any light or shadow, and the light's colour cast goes with it.
  const paper = await paperLight(rgb, w, h);
  const flat = Buffer.alloc(rgb.length);
  const luma = new Float32Array(w * h);
  for (let k = 0, i = 0; k < w * h; k++, i += 3) {
    for (let c = 0; c < 3; c++) flat[i + c] = Math.min(255, (rgb[i + c] / Math.max(paper[i + c], 1)) * 255);
    luma[k] = (0.299 * flat[i] + 0.587 * flat[i + 1] + 0.114 * flat[i + 2]) / 255;
  }
  const sorted = Float32Array.from(luma).sort();
  const at = (q: number) => sorted[Math.floor(q * (sorted.length - 1))];

  // A drawing is mostly bare paper: white once flattened, under light that's nearly colourless. A photo of a person
  // or a place isn't (a big smooth sky flattens to white too, but it's blue). Photos go to the model as they are.
  const bare = luma.reduce((n, v) => n + (v > 0.85 ? 1 : 0), 0) / luma.length;
  // The colour is judged on the smoothed paper light, not the pixels: free of sensor noise in a dark photo, and
  // warm lamplight on paper stays well short of sky blue.
  let paperish = 0;
  for (let i = 0; i < rgb.length; i += 3) {
    const hi = Math.max(paper[i], paper[i + 1], paper[i + 2]), lo = Math.min(paper[i], paper[i + 1], paper[i + 2]);
    if (hi - lo < 0.4 * Math.max(hi, 1) && flat[i] > 200 && flat[i + 1] > 200 && flat[i + 2] > 200) paperish++;
  }
  if (bare < 0.5 || paperish / (w * h) < 0.35) {
    return { png: await square(asPng(rgb), { left: 0, top: 0, width: w, height: h }), photo: true };
  }
  // Around the paper: the table, a laptop, the paper's own edge. Whitened, so they're neither drawn nor cropped to.
  const onPaper = await paperArea(rgb, w, h);
  if (onPaper) {
    for (let k = 0; k < w * h; k++) if (!onPaper[k]) { flat[k * 3] = flat[k * 3 + 1] = flat[k * 3 + 2] = 255; luma[k] = 1; }
    sorted.set(luma);
    sorted.sort();
  }
  // Nothing clearly darker than the paper (a blank page, faint pencil, or a photo too dark to tell ink from noise).
  if (at(0.002) > 0.62) throw new UserError(NO_DRAWING);

  // Levels: paper and its grain to white, the darkest ink to black, pencil darkened to read as line.
  const lo = Math.min(at(0.001), 0.35), hi = 0.86;
  const out = Buffer.alloc(rgb.length);
  for (let k = 0, i = 0; k < w * h; k++, i += 3) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.round(255 * Math.min(1, Math.max(0, (flat[i + c] / 255 - lo) / (hi - lo))));
    luma[k] = (0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]) / 255;
  }
  removeRules(out, luma, w, h);

  // Crop to the drawing: rows and columns with a few ink pixels in them, ignoring specks. Light but strong colour
  // (a yellow crayon sun) is drawing too.
  const ink = (k: number) => luma[k] < 0.6 || Math.max(out[k * 3], out[k * 3 + 1], out[k * 3 + 2]) - Math.min(out[k * 3], out[k * 3 + 1], out[k * 3 + 2]) > 90;
  const rows = new Uint32Array(h), cols = new Uint32Array(w);
  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink(y * w + x)) { rows[y]++; cols[x]++; total++; }
  if (total < w * h * 0.002) throw new UserError(NO_DRAWING);
  const span = (counts: Uint32Array, len: number, min: number) => {
    let a = 0, b = len - 1;
    while (a < b && counts[a] < min) a++;
    while (b > a && counts[b] < min) b--;
    return [a, b];
  };
  const [top, bottom] = span(rows, h, Math.max(2, w * 0.004));
  const [left, right] = span(cols, w, Math.max(2, h * 0.004));
  // A 3px median takes out leftover specks of paper grain and sensor noise without thinning lines.
  const clean = sharp(await asPng(out).median(3).png().toBuffer());
  return { png: await square(clean, { left, top, width: right - left + 1, height: bottom - top + 1 }), photo: false };
}

// The paper's brightness under the light at each pixel, per colour: the brightest value within a window wider than
// any pen line (so lines don't count as paper), worked out small and blurred, as light changes slowly.
async function paperLight(rgb: Buffer, w: number, h: number): Promise<Buffer> {
  const scale = 8, sw = Math.max(1, Math.round(w / scale)), sh = Math.max(1, Math.round(h / scale));
  const small = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(sw, sh, { fit: "fill" }).raw().toBuffer();
  const r = Math.max(2, Math.round(Math.max(sw, sh) / 24));
  const max1 = Buffer.alloc(small.length), max2 = Buffer.alloc(small.length);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
    let m = 0;
    for (let d = Math.max(0, x - r); d <= Math.min(sw - 1, x + r); d++) m = Math.max(m, small[(y * sw + d) * 3 + c]);
    max1[(y * sw + x) * 3 + c] = m;
  }
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) for (let c = 0; c < 3; c++) {
    let m = 0;
    for (let d = Math.max(0, y - r); d <= Math.min(sh - 1, y + r); d++) m = Math.max(m, max1[(d * sw + x) * 3 + c]);
    max2[(y * sw + x) * 3 + c] = m;
  }
  return sharp(max2, { raw: { width: sw, height: sh, channels: 3 } }).blur(r / 2 + 0.3).resize(w, h, { fit: "fill" }).raw().toBuffer();
}

// The sheet of paper in a photo of one on a table: the largest bright area (Otsu's threshold on a small grey copy),
// its holes filled (they're the drawing) and its rim trimmed off (the paper's edge and shadow). Null when the paper
// fills the frame (a scan or a close-up) or no clear sheet is found, and nothing is masked.
async function paperArea(rgb: Buffer, w: number, h: number): Promise<Uint8Array | null> {
  const sw = Math.max(8, Math.round(w / 8)), sh = Math.max(8, Math.round(h / 8)), n = sw * sh;
  const g = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(sw, sh, { fit: "fill" }).blur(1).greyscale().extractChannel(0).raw().toBuffer();
  const hist = new Array(256).fill(0);
  for (const v of g) hist[v]++;
  let sum = 0, sumB = 0, wB = 0, best = 0, t = 128;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB || wB === n) continue;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / (n - wB), between = wB * (n - wB) * (mB - mF) ** 2;
    if (between > best) { best = between; t = i; }
  }
  // Labels connected bright areas; keeps the biggest.
  const label = new Int32Array(n).fill(-1);
  let biggest = -1, biggestSize = 0;
  for (let s = 0; s < n; s++) {
    if (label[s] !== -1 || g[s] <= t) continue;
    const stack = [s];
    label[s] = s;
    let size = 0;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      const x = k % sw, y = (k / sw) | 0;
      for (const m of [x > 0 ? k - 1 : -1, x < sw - 1 ? k + 1 : -1, y > 0 ? k - sw : -1, y < sh - 1 ? k + sw : -1]) {
        if (m >= 0 && label[m] === -1 && g[m] > t) { label[m] = s; stack.push(m); }
      }
    }
    if (size > biggestSize) { biggestSize = size; biggest = s; }
  }
  if (biggestSize < n * 0.15) return null;
  // Fill holes: whatever isn't the paper and can't reach the frame's edge without crossing it.
  const outside = new Uint8Array(n), stack: number[] = [];
  for (let k = 0; k < n; k++) {
    const x = k % sw, y = (k / sw) | 0;
    if ((x === 0 || y === 0 || x === sw - 1 || y === sh - 1) && label[k] !== biggest) { outside[k] = 1; stack.push(k); }
  }
  while (stack.length) {
    const k = stack.pop()!, x = k % sw, y = (k / sw) | 0;
    for (const m of [x > 0 ? k - 1 : -1, x < sw - 1 ? k + 1 : -1, y > 0 ? k - sw : -1, y < sh - 1 ? k + sw : -1]) {
      if (m >= 0 && !outside[m] && label[m] !== biggest) { outside[m] = 1; stack.push(m); }
    }
  }
  const off = outside.reduce((a, v) => a + v, 0);
  if (off < n * 0.03) return null;
  // A real sheet has an edge: a sharp step in brightness along its outline. Light falling off across a page
  // that fills the frame also splits it in two, but gently, and there nothing may be masked (it's all drawing).
  let steps = 0, edge = 0;
  const inside: number[] = [];
  for (let k = 0; k < n; k++) if (!outside[k]) inside.push(g[k]);
  inside.sort((a, b) => a - b);
  const paperGrey = inside[inside.length >> 1] || 1;
  for (let k = 0; k < n; k++) {
    if (outside[k]) continue;
    const x = k % sw, y = (k / sw) | 0;
    if (!(x > 0 && outside[k - 1]) && !(x < sw - 1 && outside[k + 1]) && !(y > 0 && outside[k - sw]) && !(y < sh - 1 && outside[k + sw])) continue;
    // Inside against outside within a few pixels: a sheet is clearly brighter than the table it's lying on.
    let inSum = 0, inN = 0, outSum = 0, outN = 0;
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= sw || yy >= sh) continue;
      const m = yy * sw + xx;
      if (outside[m]) { outSum += g[m]; outN++; } else { inSum += g[m]; inN++; }
    }
    edge++;
    if (outN && (inSum / inN - outSum / outN) / paperGrey > 0.15) steps++;
  }
  // Most of it: paper meeting a white shirt or a bright laptop has no step there. Real sheets on a table measure
  // 78-100%; light falling off across a page, 35-50%.
  if (!edge || steps / edge < 0.65) return null;
  // Trimmed by two small pixels (about 16 px here) all round, so the paper's edge goes with the table.
  let keep = Uint8Array.from(outside, (v) => 1 - v);
  for (let pass = 0; pass < 2; pass++) {
    const next = Uint8Array.from(keep);
    for (let k = 0; k < n; k++) {
      const x = k % sw, y = (k / sw) | 0;
      if (keep[k] && (x === 0 || y === 0 || x === sw - 1 || y === sh - 1 || !keep[k - 1] || !keep[k + 1] || !keep[k - sw] || !keep[k + sw])) next[k] = 0;
    }
    keep = next;
  }
  const big = await sharp(Buffer.from(keep.map((v) => v * 255)), { raw: { width: sw, height: sh, channels: 1 } })
    .resize(w, h, { fit: "fill", kernel: "nearest" }).extractChannel(0).raw().toBuffer();
  return Uint8Array.from(big, (v) => (v > 127 ? 1 : 0));
}

// Notebook rules: five or more evenly spaced, light, straight lines across most of the page (at whatever slight angle
// the photo was taken). Their light pixels are whitened; ink crossing them is dark, so it stays. A single long line
// (a drawn horizon) isn't evenly spaced company, so it's kept. A margin line is taken only on ruled paper.
function removeRules(out: Buffer, luma: Float32Array, w: number, h: number) {
  const light = (k: number) => luma[k] > 0.4 && luma[k] < 0.95;
  const pts: number[] = [];
  for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) if (light(y * w + x)) pts.push(x, y);
  if (pts.length < 100) return;
  const ruled = (vertical: boolean, needLines: number, minCover: number) => {
    let best = { score: 0, angle: 0, bins: new Float64Array(0) };
    const tryAngle = (a: number) => {
      const t = (a * Math.PI) / 180, cos = Math.cos(t), sin = Math.sin(t);
      const len = w + h, bins = new Float64Array(len * 2);
      for (let i = 0; i < pts.length; i += 2) {
        const [x, y] = [pts[i], pts[i + 1]];
        bins[Math.round(vertical ? x * cos + y * sin : y * cos - x * sin) + len]++;
      }
      let score = 0;
      for (const b of bins) score += b * b;
      if (score > best.score) best = { score, angle: a, bins };
    };
    // Coarse, then fine: a line a quarter of a degree off smears over several pixels across the page.
    for (let a = -10; a <= 10; a += 0.5) tryAngle(a);
    const coarse = best.angle;
    for (let a = coarse - 0.45; a <= coarse + 0.45; a += 0.05) tryAngle(a);
    best.angle = (best.angle * Math.PI) / 180;
    // Sampled every other pixel both ways, so a line across the whole page counts about width / 2.
    const across = (vertical ? h : w) / 2, len = w + h;
    const lines: number[] = [];
    for (let i = 1; i < best.bins.length - 1; i++) {
      const v = best.bins[i - 1] + best.bins[i] + best.bins[i + 1];
      if (v <= across * minCover || best.bins[i] < best.bins[i - 1] || best.bins[i] <= best.bins[i + 1]) continue;
      // A thick rule can peak twice a pixel or two apart: one line.
      const last = lines[lines.length - 1];
      if (last !== undefined && i - len - last < 4) {
        if (best.bins[i] > best.bins[last + len]) lines[lines.length - 1] = i - len;
      } else lines.push(i - len);
    }
    if (lines.length < needLines) return null;
    if (needLines > 1) {
      const gaps = lines.slice(1).map((v, i) => v - lines[i]).sort((a, b) => a - b);
      const med = gaps[gaps.length >> 1];
      if (med < 6 || gaps.filter((g) => Math.abs(g - med) <= med * 0.2).length < gaps.length * 0.6) return null;
    }
    return { angle: best.angle, lines };
  };
  const wipe = (r: { angle: number; lines: number[] }, vertical: boolean) => {
    const cos = Math.cos(r.angle), sin = Math.sin(r.angle), on = new Set<number>();
    for (const l of r.lines) for (let d = -3; d <= 3; d++) on.add(l + d);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (light(k) && on.has(Math.round(vertical ? x * cos + y * sin : y * cos - x * sin))) {
        out[k * 3] = out[k * 3 + 1] = out[k * 3 + 2] = 255;
        luma[k] = 1;
      }
    }
  };
  const rules = ruled(false, 5, 0.45);
  if (!rules) return;
  wipe(rules, false);
  const margin = ruled(true, 1, 0.6);
  if (margin) wipe(margin, true);
}

// The crop, with a white margin, centred on a white square.
async function square(img: Sharp, box: { left: number; top: number; width: number; height: number }) {
  const pad = Math.round(Math.max(box.width, box.height) * 0.06);
  const side = Math.max(box.width, box.height) + 2 * pad;
  const crop = await img.extract(box).png().toBuffer();
  const sq = await sharp({ create: { width: side, height: side, channels: 3, background: "#ffffff" } })
    .composite([{ input: crop, left: Math.round((side - box.width) / 2), top: Math.round((side - box.height) / 2) }]).png().toBuffer();
  return sharp(sq).resize(Math.min(side, SKETCH_PX), Math.min(side, SKETCH_PX)).png().toBuffer();
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
  const upload = input.sketch && (await readSketch(input.sketch));
  const sketch = upload ? upload.png : undefined;
  if (sketch) await checkImage(sketch);
  const ai = imageProvider();
  // Whatever was typed becomes a drawable, printable brief; words it settles on are kept with the design, so a
  // redraw letters the same words.
  const brief = await makeBrief({ presetId: p.id, idea: input.idea, options: input.options, sketch: Boolean(sketch) }, userId);
  if (brief.words && !options.text) options.text = brief.words;
  const prompt = sketch ? sketchPrompt(p, brief.subject, options, { photo: Boolean(upload && upload.photo) }) : lineArtPrompt(p, brief.subject, options);

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
      // A photo redrawn may be of a real person or someone else's artwork: the reviewer should know.
      flags: [...promptFlags(`${input.title} ${input.idea} ${options.text ?? ""}`), ...(upload && upload.photo ? ["made from a photo, not a drawing"] : [])],
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
