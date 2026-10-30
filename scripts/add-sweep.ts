import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db/client";
import { campaigns, media } from "../src/lib/db/schema";
import { put } from "../src/lib/storage";

// Attaches a sun-sweep clip (square MP4, made with Higgsfield from the design's flat-lay shade and sun mockups)
// to a campaign's design, replacing any earlier one. Usage: npm run sweep:add -- <campaign-slug> <clip.mp4>
// Stop the dev server first if you use the built-in database.
async function main() {
  const [slug, file] = process.argv.slice(2);
  if (!slug || !file) throw new Error("Usage: npm run sweep:add -- <campaign-slug> <clip.mp4>");
  const d = await db();
  const [c] = await d.select().from(campaigns).where(eq(campaigns.slug, slug));
  if (!c) throw new Error(`No campaign with slug ${slug}`);
  const key = await put("media", "mp4", readFileSync(file));
  await d.delete(media).where(and(eq(media.designId, c.designId), eq(media.kind, "sweep")));
  await d.insert(media).values({ designId: c.designId, kind: "sweep", template: "flat-square", view: "sun", key });
  console.log(`${c.title}: sweep clip added`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
