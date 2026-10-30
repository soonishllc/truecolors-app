import { createHmac } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { mockProvider } from "../src/lib/ai/mock";
import { cleanLineArt, composite, countColours, printFiles } from "../src/lib/design/layers";
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
