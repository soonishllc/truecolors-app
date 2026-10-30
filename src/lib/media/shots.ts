import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import { media } from "../db/schema";

// Design tiles show the design printed on a real shirt (the flat-lay mockup) in the shade and in the sun, plus the
// sun-sweep clip where one has been made. Designs whose mockups haven't been made yet fall back to their bare artwork.
export async function shirtShots(designIds: string[]) {
  const shots = new Map<string, { shade?: string; sun?: string; sweep?: string }>();
  if (!designIds.length) return shots;
  const d = await db();
  const rows = await d
    .select({ designId: media.designId, kind: media.kind, view: media.view, key: media.key })
    .from(media)
    .where(and(inArray(media.designId, designIds), inArray(media.kind, ["mockup", "sweep"]), eq(media.template, "flat-square")));
  for (const r of rows) {
    const slot = r.kind === "sweep" ? "sweep" : r.view;
    if (slot !== "shade" && slot !== "sun" && slot !== "sweep") continue;
    shots.set(r.designId, { ...shots.get(r.designId), [slot]: r.key });
  }
  return shots;
}

// Swaps each row's bare artwork for its shirt photos, keeping the artwork where there are none yet.
export async function onShirts<T extends { lineArt: string | null; art: string | null }>(rows: T[], designId: (r: T) => string) {
  const shots = await shirtShots(rows.map(designId));
  return rows.map((r) => {
    const s = shots.get(designId(r));
    return { ...r, lineArt: s?.shade ?? r.lineArt, art: s?.sun ?? r.art, sweep: s?.sweep };
  });
}
