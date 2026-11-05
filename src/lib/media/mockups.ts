import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

// Mockups are plain image compositing onto fixed photo templates: no AI, same result every time.
// The photos are in templates/ (made by `npm run shirt:templates`, or swap in real product photos) with each
// one's print box in templates/templates.json. Without that file a drawn placeholder tee is used.

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

// How far, in pixels, the print is pushed around by the fabric's folds.
const FOLD_PX = 5;

// The print as it would look printed on this shirt: bent by the folds, softened slightly like ink in cotton,
// then multiplied in so the fabric's shading shows through and white disappears.
async function placed(t: Template, photo: Buffer, art: Buffer): Promise<OverlayOptions[]> {
  const { x, y, w, h } = t.print;
  const flat = await sharp(art).resize(w, h, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" })
    .blur(0.5).removeAlpha().raw().toBuffer();
  const region = sharp(photo).extract({ left: x, top: y, width: w, height: h });
  // Large-scale shading tells us where the folds are; its slope says which way the cloth bends there.
  const shading = await region.clone().greyscale().blur(6).raw().toBuffer();
  const bent = Buffer.alloc(w * h * 3, 255);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const at = (a: number, b: number) => shading[Math.min(h - 1, Math.max(0, b)) * w + Math.min(w - 1, Math.max(0, a))];
      const dx = ((at(i + 2, j) - at(i - 2, j)) / 255) * FOLD_PX * 4;
      const dy = ((at(i, j + 2) - at(i, j - 2)) / 255) * FOLD_PX * 4;
      const si = Math.round(i + dx);
      const sj = Math.round(j + dy);
      if (si < 0 || sj < 0 || si >= w || sj >= h) continue;
      flat.copy(bent, (j * w + i) * 3, (sj * w + si) * 3, (sj * w + si) * 3 + 3);
    }
  }
  const input = await sharp(bent, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
  // The weave's fine texture, laid back over the ink so it reads as printed into the cotton, not on top of it.
  // Only where there's ink, so bare fabric around the print is left exactly as photographed.
  const grey = await region.clone().greyscale().raw().toBuffer();
  const soft = await region.clone().greyscale().blur(3).raw().toBuffer();
  const weave = Buffer.alloc(w * h);
  for (let k = 0; k < weave.length; k++) {
    const ink = 1 - (bent[k * 3] + bent[k * 3 + 1] + bent[k * 3 + 2]) / 765;
    weave[k] = Math.max(0, Math.min(255, 128 + (grey[k] - soft[k]) * 2 * ink));
  }
  const texture = await sharp(weave, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
  return [
    { input, left: x, top: y, blend: "multiply" },
    { input: texture, left: x, top: y, blend: "soft-light" },
  ];
}

// The drawn placeholder has no real light, so its sun half is the bottom-right triangle.
function diagonalMask(t: Template): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${t.width}" height="${t.height}">` +
      `<polygon points="${t.width},0 ${t.width},${t.height} 0,${t.height}" fill="white"/></svg>`,
  );
}

// Where direct sun falls on a real photo: the bright side of its light edge, softened like a real shadow edge.
async function sunMask(t: Template, photo: Buffer): Promise<Buffer> {
  if (!t.file) return sharp(diagonalMask(t)).png().toBuffer();
  const { data, info } = await sharp(photo).greyscale().blur(8).raw().toBuffer({ resolveWithObject: true });
  const sorted = Uint8Array.from(data).sort();
  // Halfway between the shade and the sunlit parts of the shirt.
  const cut = (sorted[Math.floor(sorted.length * 0.3)] + sorted[Math.floor(sorted.length * 0.97)]) / 2;
  const mask = Buffer.alloc(data.length);
  for (let k = 0; k < data.length; k++) mask[k] = data[k] > cut ? 255 : 0;
  return sharp(mask, { raw: { width: info.width, height: info.height, channels: 1 } }).blur(4).toColourspace("b-w").png().toBuffer();
}

// UV ink in real sun prints a little softer than the file on screen (see templates/style/camel-sun.jpg).
const asInk = (art: Buffer) => sharp(art).modulate({ saturation: 0.9 }).png().toBuffer();

// Where on the template the art goes for each placement. Front and back use the whole print box (the templates are
// front views, so a back print is shown at its size on the same shirt); a left-chest emblem sits small on the
// wearer's left, the viewer's right.
function placedFor(t: Template, placement: "front" | "back" | "chest" = "front"): Template {
  if (placement !== "chest") return t;
  const { x, y, w, h } = t.print;
  const size = Math.round(w * 0.3);
  return { ...t, print: { x: Math.round(x + w * 0.62), y: Math.round(y + h * 0.04), w: size, h: size } };
}

export async function renderMockup(
  template: Template, shadeArt: Buffer, sunArt: Buffer, view: "shade" | "sun", placement?: "front" | "back" | "chest",
): Promise<Buffer> {
  const t = placedFor(template, placement);
  const photo = await base(t);
  sunArt = await asInk(sunArt);
  const shade = await sharp(photo).composite(await placed(t, photo, shadeArt)).png().toBuffer();
  if (!t.split && view === "shade") return shade;
  const sun = await sharp(photo).composite(await placed(t, photo, sunArt)).png().toBuffer();
  if (!t.split) return sun;
  // The sunlit copy, cut to where the light falls, laid over the shaded copy.
  // (Alpha is removed in its own step: in one pipeline sharp would strip the mask that joinChannel adds.)
  const opaque = await sharp(sun).removeAlpha().png().toBuffer();
  const mask = await sharp(await sunMask(t, photo)).greyscale().raw().toBuffer();
  const sunPart = await sharp(opaque).joinChannel(mask, { raw: { width: t.width, height: t.height, channels: 1 } }).png().toBuffer();
  return sharp(shade).composite([{ input: sunPart }]).png().toBuffer();
}
