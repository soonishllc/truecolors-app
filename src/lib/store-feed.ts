import { desc, eq, inArray } from "drizzle-orm";
import { cardStats } from "@/lib/campaign-card";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { campaigns, designs, users } from "@/lib/db/schema";
import { onShirts } from "@/lib/media/shots";
import { PREORDER_PRICE } from "@/lib/rules";
import { storeOriginals } from "@/lib/shopify/originals";
import { thumbUrl } from "@/lib/storage";
import { tickerItems } from "@/lib/ticker";

// What the store's own pages show of the community, read by the theme's scripts from /apps/truecolors/feed.json:
// the designs closest to printing (for the band on the store home), the ticker's lines, and each Original's shade
// and sun photos (for the product page's "step into the sun" toggle).
export async function storeFeed() {
  const app = config().APP_URL.replace(/\/$/, "");
  const d = await db();
  const live = (await onShirts(await d
    .select({ c: campaigns, designer: users.name, lineArt: designs.lineArtKey, art: designs.compositeKey, ...cardStats })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(inArray(campaigns.status, ["live"]))
    .orderBy(desc(campaigns.startsAt))
    .limit(24), (x) => x.c.designId))
    .sort((a, b) => b.backed / b.c.goal - a.backed / a.c.goal)
    .slice(0, 4);
  const originals = await storeOriginals(12);
  return {
    price: { AED: PREORDER_PRICE.AE.cents / 100, USD: PREORDER_PRICE.US.cents / 100 },
    designs: live.map(({ c, designer, lineArt, art, backed, today }) => ({
      slug: c.slug,
      title: c.title,
      designer,
      shade: lineArt ? `${app}${thumbUrl(lineArt, 640)}` : null,
      sun: art ? `${app}${thumbUrl(art, 640)}` : null,
      backed,
      today,
      goal: c.goal,
      endsAt: c.endsAt?.toISOString() ?? null,
    })),
    ticker: await tickerItems(),
    pairs: Object.fromEntries(originals.filter((o) => o.hover).map((o) => [o.handle, { shade: o.image, sun: o.hover }])),
  };
}
