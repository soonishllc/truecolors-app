import sharp, { type Sharp } from "sharp";
import type { PrintReport } from "../db/schema";
import { PRINT } from "../rules";

// Every design is two layers that must line up exactly:
//   line art - black ink, always visible (the "shade" look)
//   colour   - SolarShift ink, only visible in the sun
// The colour image comes from an AI edit of the line art, so it can drift a little. We never trust its
// lines: the original line art is always laid back on top, and line pixels are cut out of the colour layer.

// Default backdrop margin around a drawing, as a fraction of its width (see colourArea).
export const BACKDROP = 0.04;

const LINE_THRESHOLD = 110; // grey value below this counts as line
const WHITE_THRESHOLD = 235; // all channels above this count as bare shirt (no ink)

export type Raw = { data: Buffer; width: number; height: number };

async function rgba(input: Buffer | Sharp, width?: number, height?: number): Promise<Raw> {
  let img = Buffer.isBuffer(input) ? sharp(input) : input;
  if (width && height) img = img.resize(width, height, { fit: "fill", kernel: "lanczos3" });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

function toPng(raw: Raw): Promise<Buffer> {
  return sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
    .png()
    .toBuffer();
}

// Line art as black on transparent, from any black-on-white image.
function lineMask(src: Raw): Raw {
  const out = Buffer.alloc(src.data.length);
  for (let i = 0; i < src.data.length; i += 4) {
    const grey = 0.299 * src.data[i] + 0.587 * src.data[i + 1] + 0.114 * src.data[i + 2];
    if (grey < LINE_THRESHOLD && src.data[i + 3] > 127) out[i + 3] = 255;
  }
  return { ...src, data: out };
}

// Colour fill with line pixels and bare-shirt white removed.
function colourFill(colour: Raw, line: Raw): Raw {
  const out = Buffer.from(colour.data);
  for (let i = 0; i < out.length; i += 4) {
    const white = out[i] > WHITE_THRESHOLD && out[i + 1] > WHITE_THRESHOLD && out[i + 2] > WHITE_THRESHOLD;
    if (line.data[i + 3] || white) out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
    else out[i + 3] = 255;
  }
  return { ...colour, data: out };
}

export function countColours(raw: Raw): number {
  const seen = new Set<number>();
  for (let i = 0; i < raw.data.length; i += 4) {
    if (raw.data[i + 3] < 128) continue;
    seen.add((raw.data[i] << 16) | (raw.data[i + 1] << 8) | raw.data[i + 2]);
    if (seen.size > 256) break;
  }
  return seen.size;
}

// Reduces opaque pixels to at most `colours` flat colours (k-means seeded from the most common colours).
// Sharp's palette PNG can't go below 16 colours, so this is done by hand.
export function quantise(raw: Raw, colours: number): Raw {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  for (let i = 0; i < raw.data.length; i += 4) {
    if (raw.data[i + 3] < 128) continue;
    const [r, g, b] = [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
  }
  const points = [...buckets.values()].map((e) => ({ n: e.n, c: [e.r / e.n, e.g / e.n, e.b / e.n] }));
  points.sort((a, b) => b.n - a.n);
  const dist = (a: number[], b: number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  // Seeds: the most common colours that aren't near-duplicates of one already picked.
  let centres: number[][] = [];
  for (const p of points) {
    if (centres.length >= colours) break;
    if (centres.every((c) => dist(c, p.c) > 40 ** 2)) centres.push([...p.c]);
  }
  if (!centres.length) return raw;

  const nearest = (c: number[]) => {
    let best = 0;
    for (let k = 1; k < centres.length; k++) if (dist(c, centres[k]) < dist(c, centres[best])) best = k;
    return best;
  };
  for (let iter = 0; iter < 8; iter++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of points) {
      const s = sums[nearest(p.c)];
      s[0] += p.c[0] * p.n; s[1] += p.c[1] * p.n; s[2] += p.c[2] * p.n; s[3] += p.n;
    }
    centres = centres.map((c, k) => (sums[k][3] ? [sums[k][0] / sums[k][3], sums[k][1] / sums[k][3], sums[k][2] / sums[k][3]] : c));
  }
  centres = centres.map((c) => c.map(Math.round));

  const out = Buffer.from(raw.data);
  const cache = new Map<number, number[]>();
  for (let i = 0; i < out.length; i += 4) {
    if (out[i + 3] < 128) {
      out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      continue;
    }
    const key = (out[i] << 16) | (out[i + 1] << 8) | out[i + 2];
    let c = cache.get(key);
    if (!c) {
      c = centres[nearest([out[i], out[i + 1], out[i + 2]])];
      cache.set(key, c);
    }
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  }
  return { ...raw, data: out };
}

export function fillColourLimit(): number {
  return PRINT.maxColours - (PRINT.lineArtCountsAsColour ? 1 : 0);
}

// Where colour may go: inside the drawing's outer outline (flood-filled in from the image edges, with the lines
// thickened a little first so small gaps don't let it leak), plus a backdrop margin around it. `backdrop` is the
// margin as a fraction of the width: 0 keeps colour strictly inside the drawing.
async function colourArea(line: Raw, backdrop: number): Promise<Buffer> {
  // Worked out at up to 1600 px wide (print files are ~4200) and scaled back up.
  const scale = Math.min(1, 1600 / line.width);
  const w = Math.round(line.width * scale);
  const h = Math.round(line.height * scale);
  const alpha = Buffer.alloc(line.width * line.height);
  for (let k = 0; k < alpha.length; k++) alpha[k] = line.data[k * 4 + 3];
  const thick = await sharp(alpha, { raw: { width: line.width, height: line.height, channels: 1 } })
    .resize(w, h).blur(1.5).extractChannel(0).raw().toBuffer();
  const outside = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const push = (k: number) => { if (!outside[k] && thick[k] < 40) { outside[k] = 1; stack[top++] = k; } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (top) {
    const k = stack[--top];
    const x = k % w;
    if (x > 0) push(k - 1);
    if (x < w - 1) push(k + 1);
    if (k >= w) push(k - w);
    if (k < w * (h - 1)) push(k + w);
  }
  let area = sharp(Buffer.from(outside.map((o) => (o ? 0 : 255))), { raw: { width: w, height: h, channels: 1 } });
  // Grow the area by the margin: blur it out and keep anything the blur reaches.
  if (backdrop > 0) area = sharp(await area.blur(Math.max(0.3, (backdrop * w) / 2)).threshold(8).extractChannel(0).raw().toBuffer(), { raw: { width: w, height: h, channels: 1 } });
  return area.resize(line.width, line.height).threshold(128).extractChannel(0).raw().toBuffer();
}

// `outline`: the lines that bound the colour, when they aren't the visible ones (see colourLines).
async function limitColour(fill: Raw, line: Raw, backdrop: number, outline?: Raw): Promise<Raw> {
  const area = await colourArea(outline ?? line, backdrop);
  const out = Buffer.from(fill.data);
  for (let k = 0; k < area.length; k++) if (!area[k]) out[k * 4] = out[k * 4 + 1] = out[k * 4 + 2] = out[k * 4 + 3] = 0;
  return { ...fill, data: out };
}

// The black lines, taken from the coloured image itself. The AI repaints the drawing when it colours it, so its lines
// sit a few pixels off the approved line art; laying the approved lines over its colour gives doubled edges and
// colour across lines. Taking the lines from the same image as the colour keeps the two in register, like the
// store's own designs, whose shade and sun versions come from one artwork. Line = dark and neutral, or very dark
// whatever the hue (navy lettering is ink too). The approved line art still decides where colour may go.
const LINE_LUMA = 90, LINE_CHROMA = 45, DARK_LUMA = 55;

export async function colourLines(colourPng: Buffer): Promise<Buffer> {
  const src = await rgba(colourPng);
  const out: Raw = { ...src, data: Buffer.alloc(src.data.length) };
  for (let i = 0; i < src.data.length; i += 4) {
    const [r, g, b] = [src.data[i], src.data[i + 1], src.data[i + 2]];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    if (src.data[i + 3] > 127 && (y < DARK_LUMA || (y < LINE_LUMA && chroma < LINE_CHROMA))) out.data[i + 3] = 255;
  }
  return sharp(await toPng(out)).flatten({ background: "#ffffff" }).png().toBuffer();
}

// Spot-colour printing gets flat inks; full-colour printing keeps the painted shading.
const inks = (fill: Raw) => (PRINT.fullColour ? fill : quantise(fill, fillColourLimit()));

// Black line art on white, cleaned up. Used for the shade view and as the AI colouring input.
export async function cleanLineArt(png: Buffer): Promise<Buffer> {
  const line = lineMask(await rgba(png));
  return sharp(await toPng(line)).flatten({ background: "#ffffff" }).png().toBuffer();
}

// The sun view: colour fill with the original line art on top, at the line art's size. `backdrop`: see colourArea.
// Grey shading in the black ink layer, from the colouring: darker colours print a deeper grey, light ones a faint
// one, kept light (at most about 38%) so the shirt reads as a finished drawing indoors (like the store's and Magic Tees' shirts) without
// dulling the colour in the sun. Black with partial alpha, so it prints as a halftone of the black ink.
// The curve keeps middle tones light, so only genuinely dark colour reads as a noticeable grey.
// Cancún halftones the grey at 55 lines per inch, the same as the colour. A dot smaller than about 12% doesn't hold on the screen (it washes out of the emulsion or prints as random
// specks on cotton), so lighter tones are left off rather than printed unevenly: pale colour gets no grey. Dots also
// grow on cotton (about +15% in the midtones), so TONE_MAX is set below the grey wanted on the shirt.
const TONE_MIN = 0.04, TONE_MAX = 0.34, TONE_CURVE = 1.4;
export const TONE_FLOOR = 0.12;

function tones(fill: Raw): Raw {
  const out = Buffer.alloc(fill.data.length);
  for (let i = 0; i < fill.data.length; i += 4) {
    if (fill.data[i + 3] < 128) continue;
    const y = (0.299 * fill.data[i] + 0.587 * fill.data[i + 1] + 0.114 * fill.data[i + 2]) / 255;
    const t = TONE_MIN + (1 - y) ** TONE_CURVE * (TONE_MAX - TONE_MIN);
    out[i + 3] = t < TONE_FLOOR ? 0 : Math.round(255 * t);
  }
  return { ...fill, data: out };
}

// Black lines with the grey shading under them: the whole black ink layer.
function inkLayer(line: Raw, shade: Raw): Raw {
  const out = Buffer.from(shade.data);
  for (let i = 3; i < out.length; i += 4) if (line.data[i]) out[i] = 255;
  return { ...line, data: out };
}

// The shade view: the black ink layer (lines and grey shading) on a white shirt. Same arguments as composite.
export async function shadeView(lineArtPng: Buffer, colourPng: Buffer, backdrop = BACKDROP, outlinePng?: Buffer): Promise<Buffer> {
  const line = await rgba(lineArtPng);
  const colour = await rgba(colourPng, line.width, line.height);
  const mask = lineMask(line);
  const outline = outlinePng && lineMask(await rgba(outlinePng, line.width, line.height));
  const fill = await limitColour(colourFill(colour, mask), mask, backdrop, outline);
  return sharp(await toPng(inkLayer(mask, tones(fill)))).flatten({ background: "#ffffff" }).png().toBuffer();
}

// `outlinePng`: the approved line art, which bounds the colour when the visible lines come from colourLines.
export async function composite(lineArtPng: Buffer, colourPng: Buffer, backdrop = BACKDROP, outlinePng?: Buffer): Promise<Buffer> {
  const line = await rgba(lineArtPng);
  const colour = await rgba(colourPng, line.width, line.height);
  const mask = lineMask(line);
  const outline = outlinePng && lineMask(await rgba(outlinePng, line.width, line.height));
  const fill = inks(await limitColour(colourFill(colour, mask), mask, backdrop, outline));
  return sharp(await toPng(fill))
    .flatten({ background: "#ffffff" })
    .composite([{ input: await toPng(lineMask(line)) }])
    .png()
    .toBuffer();
}

export type PrintFiles = { line: Buffer; colour: Buffer; report: PrintReport };

type Placement = "front" | "back" | "chest";

// The largest each placement prints, in inches. Front and back fill Cancún's print area; a left-chest emblem is
// printed about 9-10 cm wide, so its file is made at that size and checked at it.
export const PRINT_BOX: Record<Placement, { widthIn: number; heightIn: number }> = {
  front: { widthIn: PRINT.widthIn, heightIn: PRINT.heightIn },
  back: { widthIn: PRINT.widthIn, heightIn: PRINT.heightIn },
  chest: { widthIn: 4, heightIn: 4 },
};

// What Cancún's screens hold in black plastisol on cotton: finer lines break up, narrower gaps fill in as the ink
// spreads. Cancún prints the black first and the sun colour over it, so the colour layer is spread a little onto
// the black lines (TRAP_MM): a slightly off screen then overlaps the line instead of leaving a white sliver.
export const MIN_LINE_MM = 0.3, MIN_GAP_MM = 0.4, TRAP_MM = 0.3;
// Share of the black ink that may be finer than MIN_LINE_MM, or of gaps narrower than MIN_GAP_MM, before it's
// flagged: a few fine strokes (hair, hatching tips) are fine, a drawing made of them isn't.
const MAX_THIN = 0.3, MAX_CLOSED = 0.25;
// The colouring's lines may carry this much more black than the approved drawing before it's flagged: more means
// the AI painted dark areas, which print as solid black and hide the sun colour.
const MAX_DARK_GROWTH = 0.6;

const mmToPx = (mm: number) => (mm / 25.4) * PRINT.dpi;

// Ink (alpha) as black-on-white single channel, which is what sharp's morphology works on.
const inkChannel = (raw: Raw) => {
  const out = Buffer.alloc(raw.width * raw.height, 255);
  for (let k = 0; k < out.length; k++) if (raw.data[k * 4 + 3] > 127) out[k] = 0;
  return out;
};
const dark = (buf: Buffer) => buf.reduce((n, v) => n + (v < 128 ? 1 : 0), 0);

// sharp's erode(k) removes black features up to 2k px wide; dilate(k) grows them back.
const radius = (px: number) => Math.max(1, Math.round((px - 1) / 2));
async function morph(buf: Buffer, w: number, h: number, ops: ["erode" | "dilate", number][]) {
  let out = buf;
  for (const [op, k] of ops) out = await sharp(out, { raw: { width: w, height: h, channels: 1 } })[op](k).extractChannel(0).raw().toBuffer();
  return out;
}

// Fine-line and fine-gap shares of a black layer at its print size (see MIN_LINE_MM, MIN_GAP_MM).
export async function fineness(line: Raw) {
  const ink = inkChannel(line);
  const total = dark(ink);
  if (!total) return { thin: 0, closed: 0 };
  const lineK = radius(mmToPx(MIN_LINE_MM)), gapK = radius(mmToPx(MIN_GAP_MM));
  const opened = await morph(ink, line.width, line.height, [["erode", lineK], ["dilate", lineK]]);
  const closed = await morph(ink, line.width, line.height, [["dilate", gapK], ["erode", gapK]]);
  return { thin: Math.max(0, total - dark(opened)) / total, closed: Math.max(0, dark(closed) - total) / total };
}

function cropped(line: Raw): boolean {
  // Ink along the very edge of the artwork means the AI ran the drawing off the canvas.
  const band = Math.max(2, Math.round(line.width * 0.004));
  let n = 0;
  for (let y = 0; y < line.height; y++) {
    for (let x = 0; x < line.width; x++) {
      if (x >= band && x < line.width - band && y >= band && y < line.height - band) { x = line.width - band - 1; continue; }
      if (line.data[(y * line.width + x) * 4 + 3]) n++;
    }
  }
  return n > band * line.width * 0.03;
}

// Spreads the colour a little onto the black lines (printed first, under it), so a slightly off screen doesn't
// leave white slivers between the colour and its outline. Only line pixels are filled; bare shirt stays bare.
async function trap(fill: Raw, line: Raw): Promise<Raw> {
  // A blur of the colour (sharp blurs with alpha premultiplied, so edge colours stay true) reaches about TRAP_MM
  // past its edge at this sigma and cut-off.
  const blurred = await sharp(await toPng(fill)).blur(Math.max(0.5, mmToPx(TRAP_MM))).ensureAlpha().raw().toBuffer();
  const out = Buffer.from(fill.data);
  for (let i = 0; i < out.length; i += 4) {
    if (!line.data[i + 3] || out[i + 3] || blurred[i + 3] < 16) continue;
    out[i] = blurred[i]; out[i + 1] = blurred[i + 1]; out[i + 2] = blurred[i + 2]; out[i + 3] = 255;
  }
  return { ...fill, data: out };
}

// The checks on line work alone, at a placement's print size: for a drawing before it's coloured.
export async function lineChecks(lineArtPng: Buffer, placement: Placement = "front"): Promise<string[]> {
  const { width, height } = await printSize(lineArtPng, placement);
  const line = lineMask(await rgba(lineArtPng, width, height));
  return lineProblems(line, placement);
}

async function lineProblems(line: Raw, placement: Placement): Promise<string[]> {
  const problems: string[] = [];
  const where = placement === "chest" ? "a left-chest print" : `a ${placement} print`;
  const { thin, closed } = await fineness(line);
  if (thin > MAX_THIN) problems.push(`${Math.round(thin * 100)}% of the black lines are finer than ${MIN_LINE_MM} mm at ${where}, so they'll break up: redraw it bolder.`);
  if (closed > MAX_CLOSED) problems.push(`Lots of the gaps between lines are narrower than ${MIN_GAP_MM} mm at ${where}, so the ink will fill them in: redraw it with less detail.`);
  if (cropped(line)) problems.push("The drawing runs off the edge of the artwork, so it'll print cut off: redraw it with a margin.");
  return problems;
}

async function printSize(png: Buffer, placement: Placement) {
  const box = PRINT_BOX[placement];
  const meta = await sharp(png).metadata();
  const scale = Math.min((box.widthIn * PRINT.dpi) / meta.width!, (box.heightIn * PRINT.dpi) / meta.height!);
  return { width: Math.round(meta.width! * scale), height: Math.round(meta.height! * scale), scale, sourcePx: meta.width! };
}

// Print-ready layers at the placement's print size, transparent where there is no ink.
export async function printFiles(
  lineArtPng: Buffer, colourPng: Buffer, backdrop = BACKDROP, outlinePng?: Buffer, placement: Placement = "front",
): Promise<PrintFiles> {
  const { width, height, scale, sourcePx } = await printSize(lineArtPng, placement);

  const line = lineMask(await rgba(lineArtPng, width, height));
  const colour = await rgba(colourPng, width, height);
  const outline = outlinePng && lineMask(await rgba(outlinePng, width, height));
  const painted = await limitColour(colourFill(colour, line), line, backdrop, outline);
  const fill = inks(await trap(painted, line));
  // With shading (once coloured from the colour image's own lines), the black layer carries the grey too.
  const ink = outlinePng ? inkLayer(line, tones(painted)) : line;

  const fillColours = countColours(fill);
  const colours = fillColours + (PRINT.lineArtCountsAsColour ? 1 : 0);
  const problems: string[] = [];
  if (!PRINT.fullColour && colours > PRINT.maxColours) problems.push(`${colours} colours; Cancún prints at most ${PRINT.maxColours}.`);
  if (fillColours === 0) problems.push("The colour layer is empty, so nothing changes in the sun.");
  if (scale > 4.5) problems.push("The artwork is small for the print area; check edges are still sharp.");
  problems.push(...(await lineProblems(line, placement)));
  if (outline) {
    const count = (r: Raw) => { let n = 0; for (let i = 3; i < r.data.length; i += 4) if (r.data[i]) n++; return n; };
    const before = count(outline), after = count(line);
    if (before && (after - before) / before > MAX_DARK_GROWTH) {
      problems.push("The colouring painted dark areas that print as solid black and hide the sun colour: colour it again.");
    }
  }

  const dpi = { density: PRINT.dpi };
  return {
    line: await sharp(await toPng(ink)).withMetadata(dpi).png().toBuffer(),
    colour: await sharp(await toPng(fill)).withMetadata(dpi).png().toBuffer(),
    report: {
      ok: problems.length === 0,
      colours,
      maxColours: PRINT.maxColours,
      widthPx: width,
      heightPx: height,
      sourcePx,
      problems,
    },
  };
}
