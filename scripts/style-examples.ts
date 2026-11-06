import { mkdirSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { imageProvider } from "../src/lib/ai/provider";
import { db } from "../src/lib/db/client";
import { designs, users } from "../src/lib/db/schema";
import { colourDesign, createDesign } from "../src/lib/design/service";
import { get } from "../src/lib/storage";

// The Create page's "One idea, every style": one idea drawn and coloured by the studio in several styles, the
// way a designer would make them, saved as public/examples/styles/<style>-shade.webp and -sun.webp.
// Uses the image AI: 2 images per style. Usage:
//   PGLITE_DIR=<a scratch folder> AI_PROVIDER=openai npx tsx --env-file=.env.local scripts/style-examples.ts [style ...]
export const STYLE_IDEA = "A falcon over the dunes at sunset";
export const STYLE_EXAMPLES = ["classic", "badge", "tattoo", "mascot"];

async function main() {
  if (imageProvider().name === "mock") throw new Error("Run with AI_PROVIDER=openai: the mock would draw placeholders");
  const styles = process.argv.slice(2).length ? process.argv.slice(2) : STYLE_EXAMPLES;
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
  for (const style of styles) {
    process.stdout.write(`${style}: drawing… `);
    const design = await createDesign(user.id, { title: STYLE_IDEA, presetId: style, idea: STYLE_IDEA });
    process.stdout.write("colouring… ");
    await colourDesign(user.id, design.id, { palette: "sunset" });
    const [done] = await d.select().from(designs).where(eq(designs.id, design.id));
    await save(done.outlineKey ?? done.lineArtKey!, `${style}-shade.webp`);
    await save(done.compositeKey!, `${style}-sun.webp`);
    console.log("saved");
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
