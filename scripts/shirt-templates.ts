import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import sharp from "sharp";
import { config } from "../src/lib/config";

// Makes the blank-shirt photos that designs are printed onto, with the OpenAI image model.
//   npm run shirt:templates                 makes all of them
//   npm run shirt:templates -- split-square remakes just the ones named
// Each photo is one paid image-model call. After making one, set its print box in templates/templates.json.

const BLANK =
  "A plain, completely blank white cotton crew-neck t-shirt with no print, no logo, no label showing and no text. " +
  "Real soft, lightweight cotton jersey that lies relaxed with natural soft folds, slight creases from wear and visible fabric texture. " +
  "Photorealistic product photo for a premium clothing brand, shot on a full-frame camera, sharp focus on the shirt.";

const SHOTS: { id: string; size: "1024x1024"; out: [number, number]; prompt: string }[] = [
  {
    id: "flat-square",
    size: "1024x1024",
    out: [1080, 1080],
    prompt:
      `${BLANK} Overhead flat lay, the shirt laid out neatly and centred, front facing up, sleeves relaxed, filling ` +
      "about three quarters of the frame, on a warm light oak table. Soft, even daylight from a big window, no direct " +
      "sun on the shirt, gentle shadows in the folds.",
  },
  {
    id: "split-square",
    size: "1024x1024",
    out: [1080, 1080],
    prompt:
      `${BLANK} Overhead flat lay, the shirt laid out neatly and centred, front facing up, filling about three ` +
      "quarters of the frame, on a warm light oak table in a room in cool shade. A single sharp-edged beam of bright, " +
      "warm direct sunlight from a window falls diagonally across the shirt: it lights the lower-right half of the " +
      "chest and body brightly, while the upper-left half of the shirt stays in cool, clearly darker shade. The edge " +
      "of the light is a clean diagonal running from the upper right to the lower left, crossing the middle of the chest.",
  },
];

async function main() {
  const { OPENAI_API_KEY, OPENAI_IMAGE_MODEL } = config();
  if (!OPENAI_API_KEY) throw new Error("Set OPENAI_API_KEY in .env.local first");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY, timeout: 15 * 60_000, maxRetries: 3 });
  const named = new Set(process.argv.slice(2));
  const dir = path.join(process.cwd(), "templates");
  mkdirSync(dir, { recursive: true });

  for (const shot of SHOTS.filter((s) => !named.size || named.has(s.id))) {
    process.stdout.write(`${shot.id}… `);
    const res = await client.images.generate({
      model: OPENAI_IMAGE_MODEL, prompt: shot.prompt, size: shot.size, quality: "high", output_format: "png",
    });
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error(`The image model returned no image for ${shot.id}`);
    const [w, h] = shot.out;
    const jpg = await sharp(Buffer.from(b64, "base64")).resize(w, h, { fit: "cover" }).jpeg({ quality: 92 }).toBuffer();
    writeFileSync(path.join(dir, `${shot.id}.jpg`), jpg);
    console.log(`saved templates/${shot.id}.jpg`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
