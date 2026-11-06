import { admin } from "./client";

// The store's own tees ("Truecolors Originals"), for the community pages: real shirts that ship today, so the
// platform never looks empty. Campaign products are left out (they're tagged tc-campaign). Cached for ten minutes;
// when the store can't be reached (no Shopify credentials locally) there are simply none.

export type Original = { handle: string; title: string; image: string; hover?: string };

const MINUTES = 10;
let cached: { at: number; list: Original[] } | undefined;

// "HABIBI UV-Activated Color-Change Tee" → "HABIBI": the names drop the product-type words for tiles.
const shortName = (t: string) =>
  t.replace(/\s*(UV|Sun)[- ]Activated.*$/i, "").replace(/\s*Colou?r[- ]Chang(e|ing)\s*(Tee|T-Shirt)?$/i, "").replace(/^Colou?r[- ]Changing\s*/i, "").trim() || t;

const sized = (url: string) => `${url}${url.includes("?") ? "&" : "?"}width=640`;

export async function storeOriginals(limit = 8): Promise<Original[]> {
  if (cached && Date.now() - cached.at < MINUTES * 60_000) return cached.list.slice(0, limit);
  try {
    const res = await admin<{
      products: { nodes: { handle: string; title: string; media: { nodes: ({ image?: { url: string } })[] } }[] };
    }>(
      `query { products(first: 12, query: "status:active -tag:tc-campaign", sortKey: CREATED_AT, reverse: true) {
        nodes { handle title media(first: 2) { nodes { ... on MediaImage { image { url } } } } }
      } }`,
    );
    const list = res.products.nodes
      .flatMap((p): Original[] => {
        const [first, second] = p.media.nodes.map((m) => m.image?.url).filter((u): u is string => Boolean(u));
        return first ? [{ handle: p.handle, title: shortName(p.title), image: sized(first), hover: second ? sized(second) : undefined }] : [];
      });
    cached = { at: Date.now(), list };
    return list.slice(0, limit);
  } catch {
    return [];
  }
}
