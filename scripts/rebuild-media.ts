import { isNotNull } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { designs } from "../src/lib/db/schema";
import { renderMedia } from "../src/lib/design/service";

// Remakes every coloured design's mockups and reveal video, e.g. after changing the shirt photos in templates/.
// Free: no AI. Stop the dev server first if you use the built-in database.
async function main() {
  const d = await db();
  const list = await d.select({ id: designs.id, userId: designs.userId, title: designs.title }).from(designs).where(isNotNull(designs.compositeKey));
  for (const x of list) {
    process.stdout.write(`${x.title}… `);
    await renderMedia(x.userId, x.id);
    console.log("done");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
