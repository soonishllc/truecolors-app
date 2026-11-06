import { mkdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { imageProvider } from "../src/lib/ai/provider";
import { db } from "../src/lib/db/client";
import { designs, users } from "../src/lib/db/schema";
import { colourDesign, createDesign } from "../src/lib/design/service";
import { get } from "../src/lib/storage";
import { STYLE_EXAMPLES, STYLE_IDEA } from "../src/lib/design/style-examples";

// The Create page's style examples: the idea drawn and coloured by the studio in each style and palette, the way a
// designer would make it, saved as public/examples/styles/<style>-shade.webp and -sun.webp.
// Uses the image AI: 2 images per style. Usage (a scratch database, so the dev server's is left alone):
//   PGLITE_DIR=.pglite-styles AI_PROVIDER=openai npx tsx --env-file=.env.local scripts/style-examples.ts [style ...]
async function main() {
  if (imageProvider().name === "mock") throw new Error("Run with AI_PROVIDER=openai: the mock would draw placeholders");
  const only = process.argv.slice(2);
  const examples = only.length ? STYLE_EXAMPLES.filter((x) => only.includes(x.style)) : STYLE_EXAMPLES;
  const out = path.join(process.cwd(), "public/examples/styles");
  mkdirSync(out, { recursive: true });
  const d = await db();
  const [user] = await d.insert(users)
    .values({ email: `styles-${Date.now()}@example.invalid`, name: "Style examples", handle: `styles${Date.now()}`, credits: 100 })
    .returning();
  // Line art and the sun view are drawn on transparent; the page shows them on white, like the studio does.
  const save = async (key: string, file: string) =>
    sharp(await get(key)).flatten({ background: "#ffffff" }).resize(640, 640, { fit: "contain", background: "#ffffff" })
      .webp({ quality: 82 }).toFile(path.join(out, file));
  for (const x of examples) {
    process.stdout.write(`${x.style}: drawing… `);
    const design = await createDesign(user.id, { title: STYLE_IDEA, presetId: x.style, idea: STYLE_IDEA });
    process.stdout.write("colouring… ");
    await colourDesign(user.id, design.id, { palette: x.palette });
    const [done] = await d.select().from(designs).where(eq(designs.id, design.id));
    await save(done.outlineKey ?? done.lineArtKey!, `${x.style}-shade.webp`);
    await save(done.compositeKey!, `${x.style}-sun.webp`);
    console.log("saved");
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
