import sharp from "sharp";
import { admin } from "./client";

// The store's own tees ("Truecolors Originals"), for the community pages: real shirts that ship today, so the
// platform never looks empty. Campaign products are left out (they're tagged tc-campaign). Cached for ten minutes;
// when the store can't be reached (no Shopify credentials locally) there are simply none.
//
// Each product has a shade photo, a sun photo and often a half-and-half one, in no fixed order. The tile shows the
// shade one and the sun one on hover, told apart by how colourful the shirt (the middle of the photo) is.

export type Original = { handle: string; title: string; image: string; hover?: string };

const MINUTES = 10;
let cached: { at: number; list: Original[] } | undefined;

// "HABIBI UV-Activated Color-Change Tee" → "HABIBI": the names drop the product-type words for tiles.
const shortName = (t: string) =>
  t.replace(/\s*(UV|Sun)[- ]Activated.*$/i, "").replace(/\s*Colou?r[- ]Chang(e|ing)\s*(Tee|T-Shirt)?$/i, "").replace(/^Colou?r[- ]Changing\s*/i, "").trim() || t;

// Average colour saturation (0–255) in the middle of a photo, where the shirt's print is.
async function colourfulness(url: string): Promise<number | undefined> {
  try {
    const res = await fetch(`${url}${url.includes("?") ? "&" : "?"}width=160`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
      .resize(160, 160, { fit: "cover" }).extract({ left: 40, top: 30, width: 80, height: 100 })
      .removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let sum = 0;
    for (let i = 0; i < data.length; i += info.channels) {
      sum += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
    }
    return sum / (data.length / info.channels);
  } catch {
    return undefined;
  }
}

const sized = (url: string) => `${url}${url.includes("?") ? "&" : "?"}width=640`;

export async function storeOriginals(limit = 8): Promise<Original[]> {
  if (cached && Date.now() - cached.at < MINUTES * 60_000) return cached.list.slice(0, limit);
  try {
    const res = await admin<{
      products: { nodes: { handle: string; title: string; media: { nodes: ({ image?: { url: string } })[] } }[] };
    }>(
      `query { products(first: 12, query: "status:active -tag:tc-campaign", sortKey: CREATED_AT, reverse: true) {
        nodes { handle title media(first: 4) { nodes { ... on MediaImage { image { url } } } } }
      } }`,
    );
    const list = (await Promise.all(res.products.nodes.map(async (p): Promise<Original | undefined> => {
      const urls = p.media.nodes.map((m) => m.image?.url).filter((u): u is string => Boolean(u));
      if (!urls.length) return undefined;
      const scored = (await Promise.all(urls.map(async (url) => ({ url, colour: await colourfulness(url) }))))
        .filter((x) => x.colour !== undefined) as { url: string; colour: number }[];
      if (scored.length < 2) return { handle: p.handle, title: shortName(p.title), image: sized(urls[0]) };
      scored.sort((a, b) => a.colour - b.colour);
      const shade = scored[0], sun = scored[scored.length - 1];
      // Too close to call (one photo, or all in colour): show the first photo alone rather than guess.
      if (sun.colour - shade.colour < 3) return { handle: p.handle, title: shortName(p.title), image: sized(urls[0]) };
      return { handle: p.handle, title: shortName(p.title), image: sized(shade.url), hover: sized(sun.url) };
    }))).filter((p): p is Original => Boolean(p));
    cached = { at: Date.now(), list };
    return list.slice(0, limit);
  } catch {
    return [];
  }
}
