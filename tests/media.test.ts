import { createHmac } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { mockProvider } from "../src/lib/ai/mock";
import { cleanLineArt, colourLines, composite, countColours, lineChecks, printFiles, shadeView, TONE_FLOOR } from "../src/lib/design/layers";
import { renderMockup, templates } from "../src/lib/media/mockups";
import { fadeVideo, revealVideo } from "../src/lib/media/video";
import { PRINT } from "../src/lib/rules";
import { verifyWebhook } from "../src/lib/shopify/webhooks";

// The H.264 profile in an MP4's avcC box: 100 is High (plays everywhere); 244 is High 4:4:4, which iPhones can't play.
const h264Profile = (mp4: Buffer) => mp4[mp4.indexOf("avcC") + 5];

async function art() {
  const lineArt = await cleanLineArt(await mockProvider.lineArt("palm trees at sunset", "u1"));
  const colour = await mockProvider.colour(lineArt, "colour it", "u1");
  return { lineArt, colour };
}

describe("shade and sun layers", () => {
  it("keeps the line art exactly in place in the sun view", async () => {
    const { lineArt, colour } = await art();
    const sun = await composite(lineArt, colour);
    const a = await sharp(lineArt).greyscale().raw().toBuffer();
    const b = await sharp(sun).greyscale().raw().toBuffer();
    let lines = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] < 110) {
        lines++;
        expect(b[i]).toBeLessThan(110);
      }
    }
    expect(lines).toBeGreaterThan(1000);
  });

  it("keeps colour inside the drawing, with an optional slim backdrop", async () => {
    const { lineArt, colour } = await art();
    // The AI painted the whole background red.
    const flooded = await sharp(colour).flatten({ background: "#ff0000" }).composite([{ input: Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="red"/></svg>'), blend: "dest-over" }]).png().toBuffer();
    const corner = async (png: Buffer) => [...(await sharp(png).extract({ left: 4, top: 4, width: 1, height: 1 }).removeAlpha().raw().toBuffer())];
    expect(await corner(await composite(lineArt, flooded, 0))).toEqual([255, 255, 255]);
    expect(await corner(await composite(lineArt, flooded, 0.025))).toEqual([255, 255, 255]);
  });

  it("keeps the gaps between separate shapes (letters) white unless a backdrop is asked for", async () => {
    // Two outlined boxes, like two letters, 16px apart; the AI painted everything orange, gap included.
    const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200">${body}</svg>`);
    const lineArt = await sharp(svg('<rect width="400" height="200" fill="white"/><rect x="60" y="50" width="120" height="100" fill="none" stroke="black" stroke-width="8"/><rect x="196" y="50" width="120" height="100" fill="none" stroke="black" stroke-width="8"/>')).png().toBuffer();
    const colour = await sharp(svg('<rect width="400" height="200" fill="#ff8800"/>')).png().toBuffer();
    const at = async (png: Buffer, left: number, top: number) => [...(await sharp(png).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer())];
    const inside = await composite(lineArt, colour, 0);
    expect(await at(inside, 188, 100)).toEqual([255, 255, 255]); // the gap between the boxes
    expect(await at(inside, 120, 100)).not.toEqual([255, 255, 255]); // inside a box
    // With a backdrop (the designer's "sun glow"), colour reaches into the gap.
    expect(await at(await composite(lineArt, colour), 188, 100)).not.toEqual([255, 255, 255]);
  });

  it("takes the shade lines from the colouring so they line up, and keeps colour inside the approved drawing", async () => {
    const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="white"/>${body}</svg>`);
    // The approved drawing, and the AI's colouring of it: its box drawn 6px to the right, filled orange, with navy text.
    const drawing = await sharp(svg('<rect x="60" y="50" width="200" height="100" fill="none" stroke="black" stroke-width="8"/>')).png().toBuffer();
    const colour = await sharp(svg('<rect x="66" y="50" width="200" height="100" fill="#ff8800" stroke="black" stroke-width="8"/><rect x="100" y="90" width="40" height="20" fill="#1a2350"/>')).png().toBuffer();
    const lines = await colourLines(colour);
    const at = async (png: Buffer, left: number, top: number) => [...(await sharp(png).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer())];
    expect(await at(lines, 66, 100)).toEqual([0, 0, 0]); // the colouring's own outline
    expect(await at(lines, 60, 100)).toEqual([255, 255, 255]); // not the approved one, 6px away
    expect(await at(lines, 120, 100)).toEqual([0, 0, 0]); // very dark navy counts as ink
    const sun = await composite(lines, colour, 0, drawing);
    expect(await at(sun, 150, 70)).not.toEqual([255, 255, 255]); // coloured inside
    expect(await at(sun, 340, 100)).toEqual([255, 255, 255]); // nothing outside the drawing
  });

  it("shades the black layer in grey from the colouring: darker colour, deeper grey; none outside the drawing", async () => {
    const svg = (body: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200"><rect width="400" height="200" fill="white"/>${body}</svg>`);
    const drawing = await sharp(svg('<rect x="40" y="40" width="320" height="120" fill="none" stroke="black" stroke-width="8"/>')).png().toBuffer();
    // Left half pale yellow, right half dark green.
    const colour = await sharp(svg('<rect x="40" y="40" width="160" height="120" fill="#ffe680"/><rect x="200" y="40" width="160" height="120" fill="#2f6b2f"/><rect x="40" y="40" width="320" height="120" fill="none" stroke="black" stroke-width="8"/>')).png().toBuffer();
    const lines = await colourLines(colour);
    const grey = async (png: Buffer, left: number, top: number) => (await sharp(png).extract({ left, top, width: 1, height: 1 }).greyscale().raw().toBuffer())[0];
    const shade = await shadeView(lines, colour, 0, drawing);
    const light = await grey(shade, 100, 100), dark = await grey(shade, 300, 100);
    expect(light).toBe(255); // pale yellow's grey would be a dot too small to hold on the screen, so there's none
    expect(dark).toBeLessThan(250); // a grey where it's dark green
    expect(dark).toBeGreaterThan(160); // but still light: at most about 34% before dot gain
    expect(await grey(shade, 20, 20)).toBe(255); // nothing outside the drawing
    expect(await grey(shade, 40, 100)).toBeLessThan(40); // the line stays black
    const print = await printFiles(lines, colour, 0, drawing);
    const ink = await sharp(print.line).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
    const alphaAt = (fx: number, fy: number) => ink.data[(Math.round(fy * ink.info.height) * ink.info.width + Math.round(fx * ink.info.width)) * 4 + 3];
    expect(alphaAt(0.75, 0.5)).toBeGreaterThanOrEqual(Math.round(TONE_FLOOR * 255)); // the print's black layer carries the grey too
    expect(alphaAt(0.25, 0.5)).toBe(0);
    // No dot anywhere is below the smallest that holds.
    for (let i = 3; i < ink.data.length; i += 4) if (ink.data[i]) expect(ink.data[i]).toBeGreaterThanOrEqual(Math.round(TONE_FLOOR * 255));
  });

  it("keeps the painted shading in full-colour print files", async () => {
    const { lineArt, colour } = await art();
    const shaded = await sharp(colour).blur(12).png().toBuffer();
    const files = await printFiles(lineArt, shaded);
    expect(PRINT.fullColour).toBe(true);
    expect(files.report.ok).toBe(true);
    expect(files.report.colours).toBeGreaterThan(7);
  });

  it("makes spot-colour print files within Cancún's limits at 300 dpi", async () => {
    const { lineArt, colour } = await art();
    PRINT.fullColour = false;
    const files = await printFiles(lineArt, colour).finally(() => (PRINT.fullColour = true));
    expect(files.report.ok).toBe(true);
    expect(files.report.colours).toBeLessThanOrEqual(7);
    expect(files.report.widthPx).toBeLessThanOrEqual(14 * 300);
    expect(files.report.heightPx).toBeLessThanOrEqual(16 * 300);
    const raw = await sharp(files.colour).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(countColours({ data: raw.data, width: raw.info.width, height: raw.info.height })).toBeLessThanOrEqual(6);
  });
});

describe("print checks", () => {
  const svg = (body: string, size = 1024) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" fill="white"/>${body}</svg>`)).png().toBuffer();
  // Fine hatching: 1 px lines 3 px apart, like an engraved drawing.
  const hatching = Array.from({ length: 120 }, (_, i) => `<line x1="${200 + i * 5}" y1="200" x2="${200 + i * 5}" y2="800" stroke="black" stroke-width="1.2"/>`).join("");
  const bold = '<circle cx="512" cy="512" r="300" fill="none" stroke="black" stroke-width="14"/><circle cx="512" cy="512" r="150" fill="none" stroke="black" stroke-width="10"/>';

  it("passes bold line work at every placement, and fine detail at front size only", async () => {
    expect(await lineChecks(await svg(bold), "chest")).toEqual([]);
    expect(await lineChecks(await svg(hatching), "front")).toEqual([]);
    const chest = await lineChecks(await svg(hatching), "chest");
    expect(chest.join(" ")).toMatch(/finer than|narrower than/);
  });

  it("makes a left-chest print file at chest size", async () => {
    const drawing = await svg(bold);
    const colour = await svg(`<circle cx="512" cy="512" r="300" fill="#ff8800"/>${bold}`);
    const files = await printFiles(drawing, colour, 0, undefined, "chest");
    expect(files.report.widthPx).toBe(4 * PRINT.dpi);
    expect(files.report.ok).toBe(true);
  });

  it("flags a drawing cut off at the edge", async () => {
    const problems = await lineChecks(await svg('<circle cx="512" cy="512" r="560" fill="none" stroke="black" stroke-width="16"/>'));
    expect(problems.join(" ")).toMatch(/off the edge/);
  });

  it("flags a colouring whose dark paint would print as solid black", async () => {
    const drawing = await svg(bold);
    const colour = await svg(`<circle cx="512" cy="512" r="300" fill="#10142a"/>${bold}`);
    const files = await printFiles(await colourLines(colour), colour, 0, drawing);
    expect(files.report.problems.join(" ")).toMatch(/solid black/);
  });

  it("spreads the colour under the black lines so a slightly off screen leaves no white gap", async () => {
    const drawing = await svg(bold);
    const colour = await svg(`<circle cx="512" cy="512" r="300" fill="#ff8800"/>${bold}`);
    const files = await printFiles(drawing, colour, 0);
    const raw = await sharp(files.colour).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const s = raw.info.width / 1024;
    // The outer ring's line runs from x = 205 to 219 at the middle row; the orange starts at its inner edge.
    const y = Math.round(512 * s), inner = Math.round(219 * s);
    expect(raw.data[(y * raw.info.width + inner - 3) * 4 + 3]).toBe(255); // under the line, next to the colour
    expect(raw.data[(y * raw.info.width + Math.round(212 * s)) * 4 + 3]).toBe(0); // the middle of the line: not needed
    // And not out onto bare shirt beyond the line.
    const out = Math.round((205 - 12) * s);
    expect(raw.data[(y * raw.info.width + out) * 4 + 3]).toBe(0);
  });
});

describe("mockups and reveal video", () => {
  it("renders every template and a playable mp4", async () => {
    const { lineArt, colour } = await art();
    const sun = await composite(lineArt, colour);
    const out: Record<string, Buffer> = {};
    for (const t of templates()) {
      const png = await renderMockup(t, lineArt, sun, "sun");
      const meta = await sharp(png).metadata();
      expect([meta.width, meta.height]).toEqual([t.width, t.height]);
      out[t.id] = png;
    }
    const flat = templates().find((t) => t.id === "flat-square")!;
    const shade = await renderMockup(flat, lineArt, sun, "shade");
    const mp4 = await revealVideo(shade, out["flat-square"]);
    expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
    expect(h264Profile(mp4)).toBe(100);
    expect(h264Profile(await fadeVideo(shade, out["flat-square"]))).toBe(100);
  });
});

describe("Shopify webhooks", () => {
  it("accepts only correctly signed bodies", () => {
    const body = '{"id":1}';
    const sig = createHmac("sha256", "s3cret").update(body).digest("base64");
    expect(verifyWebhook(body, sig, "s3cret")).toBe(true);
    expect(verifyWebhook(body, sig, "other")).toBe(false);
    expect(verifyWebhook(body, null, "s3cret")).toBe(false);
  });
});
