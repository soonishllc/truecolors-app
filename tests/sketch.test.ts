import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";

// The text model is on, as in production, so the sketch brief is tested on the path that could invent a subject.
vi.mock("../src/lib/config", async (orig) => {
  const real = (await orig()) as { config: () => object };
  return { ...real, config: () => ({ ...real.config(), AI_PROVIDER: "openai", OPENAI_API_KEY: "test" }) };
});
const create = vi.fn(async () => { throw new Error("the text model shouldn't be asked"); });
vi.mock("openai", () => ({ default: class { chat = { completions: { create } }; } }));

const { readSketch, UserError } = await import("../src/lib/design/service");
const { makeBrief } = await import("../src/lib/ai/brief");
const { SKETCH_SUBJECT, preset, sketchPrompt } = await import("../src/lib/ai/presets");

const W = 1200, H = 1600;
const svg = (body: string, bg = "#f7f3e8") =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="${bg}"/>${body}</svg>`);
// A phone photo: warm light falling off to one corner, as a JPEG.
const photo = async (body: string, angle = 0) => {
  const light = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#a89880"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
  const lit = await sharp(svg(body)).composite([{ input: light, blend: "multiply" }]).png().toBuffer();
  return sharp(lit).rotate(angle, { background: "#e8e2d4" }).jpeg({ quality: 88 }).toBuffer();
};
const RULES = Array.from({ length: 24 }, (_, i) => `<line x1="0" x2="${W}" y1="${120 + i * 60}" y2="${120 + i * 60}" stroke="#8fb4e0" stroke-width="3"/>`).join("");
const DRAWING = `<circle cx="600" cy="700" r="220" fill="none" stroke="#1b2a8a" stroke-width="9"/><path d="M450 1000 L750 1150" stroke="#1b2a8a" stroke-width="9"/>`;

async function pixels(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let ink = 0, rule = 0;
  for (let i = 0; i < data.length; i += 3) {
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    const y = 0.299 * r + 0.587 * g + 0.114 * b;
    if (y < 110) ink++;
    else if (y < 235 && b - r > 25) rule++;
  }
  return { ink, rule, width: info.width, height: info.height };
}

// The ink's bounding box in an image, as width and height.
async function inkBox(png: Buffer) {
  const { data, info } = await sharp(png).greyscale().extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  let [x0, y0, x1, y1] = [info.width, info.height, 0, 0];
  for (let k = 0; k < data.length; k++) {
    if (data[k] > 110) continue;
    const x = k % info.width, y = (k / info.width) | 0;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  return { w: x1 - x0, h: y1 - y0 };
}

describe("reading a sketch upload", () => {
  it("takes notebook rules and warm light off the paper, keeping the drawing", async () => {
    const ruled = await readSketch(await photo(RULES + DRAWING, 3));
    const plain = await readSketch(await photo(DRAWING, 3));
    expect(ruled.photo).toBe(false);
    const a = await pixels(ruled.png), b = await pixels(plain.png);
    // The rules are gone: no more light blue than the same drawing on plain paper has (the pen's own soft edges),
    // give or take a few pixels of their ends…
    expect(a.rule).toBeLessThan(b.rule + a.width * a.height * 0.002);
    // …and the strokes are all there: about as much ink as the same drawing on plain paper.
    expect(a.ink).toBeGreaterThan(b.ink * 0.85);
    expect(a.width).toBe(a.height);
  });

  it("keeps a single long drawn line: it isn't notebook paper", async () => {
    const horizon = `<path d="M100 1300 L1100 1300" stroke="#2a9d3c" stroke-width="12"/>`;
    const out = await pixels((await readSketch(await photo(DRAWING + horizon))).png);
    const without = await pixels((await readSketch(await photo(DRAWING))).png);
    expect(out.ink + out.rule).toBeGreaterThan(without.ink);
  });

  it("refuses a blank or nearly blank page before anything is spent", async () => {
    await expect(readSketch(await photo(""))).rejects.toThrow(/couldn't find a drawing/);
    const faint = `<path d="M500 700 L640 690" stroke="#d6d2ca" stroke-width="4"/>`;
    await expect(readSketch(await photo(faint))).rejects.toBeInstanceOf(UserError);
  });

  it("turns a phone photo stored sideways upright, from its EXIF orientation", async () => {
    // A tall drawing: a standing figure.
    const tall = `<path d="M600 300 L600 1300 M450 600 L750 600 M600 1300 L480 1450 M600 1300 L720 1450" stroke="#111" stroke-width="12" fill="none"/>`;
    const upright = await photo(tall);
    const sideways = await sharp(upright).rotate(-90).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const box = await inkBox((await readSketch(sideways)).png);
    expect(box.h).toBeGreaterThan(box.w * 1.5);
  });

  it("lets a photo that isn't a drawing through, flagged, untouched", async () => {
    const shop = await sharp("public/site/home-hero-sun.webp").resize(1200).jpeg().toBuffer();
    const out = await readSketch(shop);
    expect(out.photo).toBe(true);
    expect(sketchPrompt(preset("classic"), SKETCH_SUBJECT, {}, { photo: true })).toMatch(/turn this photo into black ink line art[\s\S]*Subject: the main subject of the photo/);
  });

  it("says so when the file isn't an image", async () => {
    await expect(readSketch(Buffer.from("not an image"))).rejects.toThrow(/couldn't be opened/);
  });
});

describe("the brief for a sketch", () => {
  it("with no idea, names the sketch itself: no invented subject or words, and the text model isn't asked", async () => {
    for (const presetId of ["beach", "lettering", "classic"]) {
      for (const idea of ["", "   ", "asdf"]) {
        const b = await makeBrief({ presetId, idea, sketch: true }, "u1");
        expect(b.subject, `${presetId} "${idea}"`).toBe(SKETCH_SUBJECT);
        expect(b.words).toBeNull();
      }
    }
    expect(create).not.toHaveBeenCalled();
    const prompt = sketchPrompt(preset("lettering"), SKETCH_SUBJECT);
    expect(prompt).toMatch(/Subject: the subject of the sketch, as drawn\./);
    expect(prompt).toMatch(/Words: only the words written in the sketch/);
  });
});
