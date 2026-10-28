import { createHash } from "node:crypto";
import sharp from "sharp";
import type { ImageProvider } from "./provider";

// Draws simple placeholder art so the studio, print checks, mockups and video run without an API key.

const SIZE = 1024;
const PALETTE = ["#ff4d6d", "#ffb703", "#06d6a0", "#118ab2", "#8338ec", "#fb5607"];

function seed(text: string): number[] {
  return [...createHash("sha256").update(text).digest()];
}

function shapes(prompt: string) {
  const s = seed(prompt);
  return Array.from({ length: 5 }, (_, i) => ({
    cx: 220 + (s[i * 3] / 255) * 584,
    cy: 220 + (s[i * 3 + 1] / 255) * 584,
    r: 70 + (s[i * 3 + 2] / 255) * 110,
    fill: PALETTE[s[i + 20] % PALETTE.length],
  }));
}

function svg(prompt: string, coloured: boolean): Buffer {
  const circles = shapes(prompt)
    .map(
      (c) =>
        `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${coloured ? c.fill : "white"}" stroke="black" stroke-width="10"/>`,
    )
    .join("");
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="100%" height="100%" fill="white"/>${circles}</svg>`,
  );
}

// The mock keeps the prompt that drew the line art inside the PNG so colouring can match it.
async function render(prompt: string, coloured: boolean): Promise<Buffer> {
  return sharp(svg(prompt, coloured))
    .png()
    .withMetadata({ exif: { IFD0: { ImageDescription: prompt.slice(0, 200) } } })
    .toBuffer();
}

async function promptOf(png: Buffer): Promise<string> {
  const exif = (await sharp(png).metadata()).exif?.toString("latin1") ?? "";
  return exif.replace(/[^\x20-\x7e]/g, " ").trim() || "untitled";
}

export const mockProvider: ImageProvider = {
  name: "mock",
  lineArt: (prompt) => render(prompt, false),
  colour: async (lineArt) => render(await promptOf(lineArt), true),
  refine: async (lineArt, prompt) => render(`${await promptOf(lineArt)} ${prompt}`, false),
  moderateText: async (text) => ({
    flagged: /\b(nazi|gore|nsfw)\b/i.test(text),
    categories: [],
  }),
  moderateImage: async () => ({ flagged: false, categories: [] }),
};
