import { and, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db/client";
import { campaigns, media } from "../src/lib/db/schema";
import { webVideo } from "../src/lib/media/video";
import { put } from "../src/lib/storage";

// Attaches a clip made outside the app to a campaign's design, replacing any earlier one. With --worn, an on-model
// clip (someone wearing the shirt walking into the sun, e.g. from Higgsfield), which leads the campaign page.
// Without it, a card sweep clip; note renderMedia makes its own and replaces this on the next re-render.
// Usage: npm run sweep:add -- <campaign-slug> <clip.mp4> [--worn]
// Stop the dev server first if you use the built-in database.
async function main() {
  const worn = process.argv.includes("--worn");
  const [slug, file] = process.argv.slice(2).filter((a) => a !== "--worn");
  const kind = worn ? "worn" : "sweep";
  if (!slug || !file) throw new Error("Usage: npm run sweep:add -- <campaign-slug> <clip.mp4>");
  const d = await db();
  const [c] = await d.select().from(campaigns).where(eq(campaigns.slug, slug));
  if (!c) throw new Error(`No campaign with slug ${slug}`);
  const key = await put("media", "mp4", await webVideo(readFileSync(file), worn ? 1080 : 720));
  await d.delete(media).where(and(eq(media.designId, c.designId), eq(media.kind, kind)));
  await d.insert(media).values({ designId: c.designId, kind, template: worn ? "worn" : "flat-square", view: "sun", key });
  console.log(`${c.title}: ${kind} clip added`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
