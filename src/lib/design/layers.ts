import sharp, { type Sharp } from "sharp";
import type { PrintReport } from "../db/schema";
import { PRINT } from "../rules";

// Every design is two layers that must line up exactly:
//   line art - black ink, always visible (the "shade" look)
//   colour   - SolarShift ink, only visible in the sun
// The colour image comes from an AI edit of the line art, so it can drift a little. We never trust its
// lines: the original line art is always laid back on top, and line pixels are cut out of the colour layer.

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

// Black line art on white, cleaned up. Used for the shade view and as the AI colouring input.
export async function cleanLineArt(png: Buffer): Promise<Buffer> {
  const line = lineMask(await rgba(png));
  return sharp(await toPng(line)).flatten({ background: "#ffffff" }).png().toBuffer();
}

// The sun view: colour fill with the original line art on top, at the line art's size.
export async function composite(lineArtPng: Buffer, colourPng: Buffer): Promise<Buffer> {
  const line = await rgba(lineArtPng);
  const colour = await rgba(colourPng, line.width, line.height);
  const fill = quantise(colourFill(colour, lineMask(line)), fillColourLimit());
  return sharp(await toPng(fill))
    .flatten({ background: "#ffffff" })
    .composite([{ input: await toPng(lineMask(line)) }])
    .png()
    .toBuffer();
}

export type PrintFiles = { line: Buffer; colour: Buffer; report: PrintReport };

// Print-ready layers at the full print area, transparent where there is no ink.
export async function printFiles(lineArtPng: Buffer, colourPng: Buffer): Promise<PrintFiles> {
  const boxW = PRINT.widthIn * PRINT.dpi;
  const boxH = PRINT.heightIn * PRINT.dpi;
  const meta = await sharp(lineArtPng).metadata();
  const scale = Math.min(boxW / meta.width!, boxH / meta.height!);
  const width = Math.round(meta.width! * scale);
  const height = Math.round(meta.height! * scale);

  const line = lineMask(await rgba(lineArtPng, width, height));
  const colour = await rgba(colourPng, width, height);
  const fill = quantise(colourFill(colour, line), fillColourLimit());

  const fillColours = countColours(fill);
  const colours = fillColours + (PRINT.lineArtCountsAsColour ? 1 : 0);
  const problems: string[] = [];
  if (colours > PRINT.maxColours) problems.push(`${colours} colours; Cancún prints at most ${PRINT.maxColours}.`);
  if (fillColours === 0) problems.push("The colour layer is empty, so nothing changes in the sun.");
  if (scale > 4.5) problems.push("The artwork is small for the print area; check edges are still sharp.");

  const dpi = { density: PRINT.dpi };
  return {
    line: await sharp(await toPng(line)).withMetadata(dpi).png().toBuffer(),
    colour: await sharp(await toPng(fill)).withMetadata(dpi).png().toBuffer(),
    report: {
      ok: problems.length === 0,
      colours,
      maxColours: PRINT.maxColours,
      widthPx: width,
      heightPx: height,
      problems,
    },
  };
}
