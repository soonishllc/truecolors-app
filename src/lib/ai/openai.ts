import OpenAI, { toFile } from "openai";
import sharp from "sharp";
import { config } from "../config";
import type { ImageProvider, Moderation } from "./provider";

const SIZE = "1024x1024";

// Style reference images are the same few store photos every time, so they're fetched once per process.
const references = new Map<string, Promise<Buffer>>();
function reference(url: string) {
  if (!references.has(url)) {
    references.set(url, (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Couldn't fetch style reference ${url}: ${res.status}`);
      return sharp(Buffer.from(await res.arrayBuffer())).png().toBuffer();
    })());
  }
  return references.get(url)!;
}

export function openaiProvider(): ImageProvider {
  const { OPENAI_API_KEY, OPENAI_IMAGE_MODEL } = config();
  if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey: OPENAI_API_KEY });

  const decode = (res: OpenAI.ImagesResponse) => {
    const b64 = res.data?.[0]?.b64_json;
    if (!b64) throw new Error("The image model returned no image");
    return Buffer.from(b64, "base64");
  };

  const edit = async (image: Buffer, prompt: string, userId: string) =>
    decode(
      await client.images.edit({
        model: OPENAI_IMAGE_MODEL,
        image: await toFile(image, "line-art.png", { type: "image/png" }),
        prompt,
        size: SIZE,
        output_format: "png",
        safety_identifier: userId,
      }),
    );

  const moderation = (res: OpenAI.ModerationCreateResponse): Moderation => {
    const r = res.results[0];
    const categories = Object.entries(r.categories)
      .filter(([, hit]) => hit)
      .map(([name]) => name);
    return { flagged: r.flagged, categories };
  };

  return {
    name: `openai:${OPENAI_IMAGE_MODEL}`,
    async lineArt(prompt, userId, refs) {
      if (refs?.length) {
        const images = await Promise.all(refs.map(async (url, i) => toFile(await reference(url), `style-${i}.png`, { type: "image/png" })));
        return decode(
          await client.images.edit({ model: OPENAI_IMAGE_MODEL, image: images, prompt, size: SIZE, output_format: "png", safety_identifier: userId }),
        );
      }
      return decode(
        await client.images.generate({
          model: OPENAI_IMAGE_MODEL,
          prompt,
          size: SIZE,
          background: "opaque",
          output_format: "png",
          safety_identifier: userId,
        }),
      );
    },
    fromSketch: edit,
    colour: edit,
    refine: edit,
    async moderateText(text) {
      return moderation(
        await client.moderations.create({ model: "omni-moderation-latest", input: text }),
      );
    },
    async moderateImage(png) {
      const url = `data:image/png;base64,${png.toString("base64")}`;
      return moderation(
        await client.moderations.create({
          model: "omni-moderation-latest",
          input: [{ type: "image_url", image_url: { url } }],
        }),
      );
    },
  };
}
