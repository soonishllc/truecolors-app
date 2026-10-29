import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { config } from "../src/lib/config";
import { SITE_DIR, SITE_IMAGES, siteImageFile, sitePrompt, styleRefs, type SiteImage } from "../src/lib/site-images";

// Makes the photos for the app's own pages with the OpenAI image model, styled on the store's product photos.
//   npm run site:images                  makes any that don't exist yet
//   npm run site:images -- home-hero-sun remakes just the ones named (and any made from them)
// Each image is one paid image-model call.

const file = (id: string) => path.join(SITE_DIR, siteImageFile(id));

async function main() {
  const { OPENAI_API_KEY, OPENAI_IMAGE_MODEL } = config();
  if (!OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY in .env.local first");
  // High-quality images with several references can take minutes, so allow longer than the default.
  const client = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 15 * 60_000, maxRetries: 3 });

  const named = new Set(process.argv.slice(2));
  // Remaking an image means remaking the ones edited from it, or they'd stop matching.
  for (const img of SITE_IMAGES) if (img.from && named.has(img.from)) named.add(img.id);
  const todo = SITE_IMAGES.filter((img) => (named.size ? named.has(img.id) : !existsSync(file(img.id))));
  if (!todo.length) return console.log("All site images exist. Name one to remake it, e.g. npm run site:images -- step-print");

  // Transparent logos go on black so the model sees them as they'd print on a dark tee.
  const fetched = new Map<string, Promise<Buffer>>();
  const fetchRef = (url: string) => {
    if (!fetched.has(url)) {
      fetched.set(url, (async () => {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Couldn't fetch style reference ${url}: ${res.status}`);
        return sharp(Buffer.from(await res.arrayBuffer())).flatten({ background: "#000000" }).png().toBuffer();
      })());
    }
    return fetched.get(url)!;
  };

  const inputs = async (img: SiteImage) => {
    if (img.from) {
      const png = await sharp(readFileSync(file(img.from))).png().toBuffer();
      return [await toFile(png, `${img.from}.png`, { type: "image/png" })];
    }
    return Promise.all(styleRefs(img).map(async (url, i) => toFile(await fetchRef(url), `reference-${i}.png`, { type: "image/png" })));
  };

  mkdirSync(SITE_DIR, { recursive: true });
  for (const img of todo) {
    process.stdout.write(`${img.id}… `);
    const res = await client.images.edit({
      model: OPENAI_IMAGE_MODEL,
      image: await inputs(img),
      prompt: sitePrompt(img),
      size: img.size,
      quality: "high",
      output_format: "png",
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error(`The image model returned no image for ${img.id}`);
    const png = Buffer.from(b64, "base64");
    writeFileSync(file(img.id), img.cutout ? await keyOutBlack(png) : await sharp(png).webp({ quality: 82 }).toBuffer());
    console.log(`saved public/site/${siteImageFile(img.id)}`);
  }
}

// gpt-image-2 can't draw on a transparent background, so logos come on black: each pixel's brightest channel
// becomes its opacity and its colour is scaled back up, which keeps soft edges and glows clean on any background.
async function keyOutBlack(png: Buffer) {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let i = 0, o = 0; i < data.length; i += 3, o += 4) {
    const a = Math.max(data[i], data[i + 1], data[i + 2]);
    const lift = a < 24 ? 0 : 255 / a; // near-black noise goes fully transparent
    out[o] = data[i] * lift;
    out[o + 1] = data[i + 1] * lift;
    out[o + 2] = data[i + 2] * lift;
    out[o + 3] = a < 24 ? 0 : a;
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).trim().png().toBuffer();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
