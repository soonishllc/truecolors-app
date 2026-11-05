import { and, eq, inArray, or } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { campaigns, media, users } from "../db/schema";
import { fileUrl } from "../storage";

export type ShareMeta = { title: string; description: string; image?: string };

const PUBLIC = ["live", "closing", "funded", "in_production", "shipped", "missed"] as const;

// What a link to a campaign shows when it's pasted into WhatsApp, Instagram or iMessage: the design and who made
// it, not the store's generic card. The store page is a frame, so crawlers only see what the proxy page sets.
export async function campaignShareMeta(slug: string): Promise<ShareMeta | undefined> {
  const d = await db();
  const [row] = await d
    .select({ title: campaigns.title, designId: campaigns.designId, designer: users.name })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .where(and(eq(campaigns.slug, slug), inArray(campaigns.status, [...PUBLIC])));
  if (!row) return;
  const files = await d.select().from(media)
    .where(and(eq(media.designId, row.designId), or(eq(media.template, "split-square"), eq(media.kind, "mockup"))));
  const image = files.find((m) => m.template === "split-square") ?? files[0];
  return {
    title: `${row.title} by ${row.designer} · Truecolors`,
    description: "Black-and-white indoors, full colour in the sun. A numbered limited run: pre-order it and help get it printed.",
    image: image && `${config().APP_URL}${fileUrl(image.key)}`,
  };
}
