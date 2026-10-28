import { createHmac } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { mockProvider } from "../src/lib/ai/mock";
import { cleanLineArt, composite, countColours, printFiles } from "../src/lib/design/layers";
import { renderMockup, templates } from "../src/lib/media/mockups";
import { revealVideo } from "../src/lib/media/video";
import { verifyWebhook } from "../src/lib/shopify/webhooks";

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

  it("makes print files within Cancún's limits at 300 dpi", async () => {
    const { lineArt, colour } = await art();
    const files = await printFiles(lineArt, colour);
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
    const story = templates().find((t) => t.id === "flat-story")!;
    const shade = await renderMockup(story, lineArt, sun, "shade");
    const mp4 = await revealVideo(shade, out["flat-story"]);
    expect(mp4.subarray(4, 8).toString()).toBe("ftyp");
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
