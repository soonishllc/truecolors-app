import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

// Mockups are plain image compositing onto fixed photo templates: no AI, same result every time.
// Real templates come from Truecolors' model photos: put the file in templates/ and its print box in
// templates/templates.json. Until then a drawn placeholder tee is used.

export type Template = {
  id: string;
  label: string;
  file?: string;
  width: number;
  height: number;
  // Where the chest print sits on the photo, in pixels.
  print: { x: number; y: number; w: number; h: number };
  // Half-shade/half-sun diagonal shot: shade art on the top-left, sun art on the bottom-right.
  split?: boolean;
};

const DIR = path.join(process.cwd(), "templates");

const PLACEHOLDERS: Template[] = [
  { id: "flat-square", label: "Flat front", width: 1080, height: 1080, print: { x: 380, y: 300, w: 320, h: 366 } },
  { id: "flat-story", label: "Flat front, story", width: 1080, height: 1920, print: { x: 360, y: 700, w: 360, h: 411 } },
  { id: "split-square", label: "Half shade, half sun", width: 1080, height: 1080, print: { x: 380, y: 300, w: 320, h: 366 }, split: true },
];

export function templates(): Template[] {
  const file = path.join(DIR, "templates.json");
  if (!existsSync(file)) return PLACEHOLDERS;
  return JSON.parse(readFileSync(file, "utf8")) as Template[];
}

function placeholderShirt(t: Template): Buffer {
  const { width: W, height: H } = t;
  const cx = W / 2;
  const top = t.print.y - t.print.h * 0.45;
  const sw = t.print.w * 2.1;
  const body = t.print.h * 2.2;
  const shirt = [
    `M${cx - sw * 0.18} ${top}`,
    `L${cx - sw / 2} ${top + sw * 0.08} L${cx - sw * 0.68} ${top + sw * 0.34} L${cx - sw * 0.5} ${top + sw * 0.42}`,
    `L${cx - sw * 0.42} ${top + sw * 0.32} L${cx - sw * 0.42} ${top + body} L${cx + sw * 0.42} ${top + body}`,
    `L${cx + sw * 0.42} ${top + sw * 0.32} L${cx + sw * 0.5} ${top + sw * 0.42} L${cx + sw * 0.68} ${top + sw * 0.34}`,
    `L${cx + sw / 2} ${top + sw * 0.08} L${cx + sw * 0.18} ${top}`,
    `Q${cx} ${top + sw * 0.12} ${cx - sw * 0.18} ${top} Z`,
  ].join(" ");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<rect width="100%" height="100%" fill="#e9e4dc"/>` +
      `<path d="${shirt}" fill="#fbfbf9" stroke="#d6d1c8" stroke-width="4"/></svg>`,
  );
}

async function base(t: Template): Promise<Buffer> {
  if (t.file) return sharp(path.join(DIR, t.file)).resize(t.width, t.height, { fit: "cover" }).png().toBuffer();
  return sharp(placeholderShirt(t)).png().toBuffer();
}

async function placed(t: Template, art: Buffer): Promise<OverlayOptions> {
  const input = await sharp(art).resize(t.print.w, t.print.h, { fit: "contain", background: "#ffffff" }).png().toBuffer();
  // Multiply lets the fabric's folds and shadows show through the print, and white disappears.
  return { input, left: t.print.x, top: t.print.y, blend: "multiply" };
}

function diagonalMask(t: Template): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${t.width}" height="${t.height}">` +
      `<polygon points="${t.width},0 ${t.width},${t.height} 0,${t.height}" fill="white"/></svg>`,
  );
}

export async function renderMockup(t: Template, shadeArt: Buffer, sunArt: Buffer, view: "shade" | "sun"): Promise<Buffer> {
  const photo = await base(t);
  const shade = await sharp(photo).composite([await placed(t, shadeArt)]).png().toBuffer();
  if (!t.split && view === "shade") return shade;
  const sun = await sharp(photo).composite([await placed(t, sunArt)]).png().toBuffer();
  if (!t.split) return sun;
  const sunHalf = await sharp(sun)
    .composite([{ input: await sharp(diagonalMask(t)).png().toBuffer(), blend: "dest-in" }])
    .png()
    .toBuffer();
  return sharp(shade).composite([{ input: sunHalf }]).png().toBuffer();
}
