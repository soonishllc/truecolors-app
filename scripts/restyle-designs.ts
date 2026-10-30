import { and, asc, eq, inArray } from "drizzle-orm";
import { lineArtPrompt, preset } from "../src/lib/ai/presets";
import { imageProvider } from "../src/lib/ai/provider";
import { db } from "../src/lib/db/client";
import { campaigns, designs, generations } from "../src/lib/db/schema";
import { cleanLineArt } from "../src/lib/design/layers";
import { colourDesign, recomposeDesign, renderMedia } from "../src/lib/design/service";
import { put } from "../src/lib/storage";

// Redraws campaign designs from their original idea and preset with the current house style (line art, colour,
// mockups and reveal video), keeping the campaigns as they are. Uses the image AI: about 2 images per design.
// --keep-lines recolours without redrawing; --first-lines goes back to the design's first line art, then recolours;
// --recompose only re-trims the existing colour to the current backdrop rules (no AI).
// Usage: AI_PROVIDER=openai npm run designs:restyle -- <campaign-slug> [...more] [--keep-lines | --first-lines].
// Stop the dev server first if you use the built-in database.
async function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const slugs = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  // The mock would swap real artwork for placeholder circles.
  if (imageProvider().name === "mock" && !flags.includes("--recompose")) throw new Error("Run with AI_PROVIDER=openai: the mock provider would replace the artwork");
  if (!slugs.length) throw new Error("Usage: npm run designs:restyle -- <campaign-slug> [...more]");
  const d = await db();
  const rows = await d.select({ c: campaigns, design: designs }).from(campaigns)
    .innerJoin(designs, eq(designs.id, campaigns.designId)).where(inArray(campaigns.slug, slugs));
  const ai = imageProvider();
  for (const { c, design } of rows) {
    if (flags.includes("--recompose")) {
      process.stdout.write(`${c.title}: re-trim… `);
      await recomposeDesign(design.userId, design.id);
      process.stdout.write("mockups… ");
      await renderMedia(design.userId, design.id);
      console.log("done");
      continue;
    }
    if (flags.includes("--first-lines")) {
      const [first] = await d.select().from(generations)
        .where(and(eq(generations.designId, design.id), eq(generations.kind, "line_art"))).orderBy(asc(generations.createdAt)).limit(1);
      if (!first?.outputKey) throw new Error(`${c.title}: no original line art on record`);
      process.stdout.write(`${c.title}: original line art… `);
      await d.update(designs).set({ lineArtKey: first.outputKey, updatedAt: new Date() }).where(eq(designs.id, design.id));
    } else if (!flags.includes("--keep-lines")) {
      process.stdout.write(`${c.title}: line art… `);
      const p = preset(design.preset);
      const lineArt = await cleanLineArt(await ai.lineArt(lineArtPrompt(p, design.prompt), design.userId, p.refs));
      await d.update(designs).set({ lineArtKey: await put("designs", "png", lineArt), updatedAt: new Date() }).where(eq(designs.id, design.id));
    }
    process.stdout.write("colour… ");
    await colourDesign(design.userId, design.id);
    process.stdout.write("mockups… ");
    await renderMedia(design.userId, design.id);
    console.log("done");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
