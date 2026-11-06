import { admin, shopifyConfigured } from "./client";

// Each store sells its own products: the UAE store at /, the USA store at /en-us. A link to a product in the store
// that doesn't sell it (shared from the other one, or opened from abroad) would be Shopify's bare "Not Found", so
// the store keeps a URL redirect for every such product to the store that has it. Shopify only follows a redirect
// when the page would otherwise be missing, so a product sold in both needs none. This keeps them in step: on
// product webhooks and once an hour from the tick. Only redirects of exactly this shape are ever touched.

export type ProductMarkets = { handle: string; ae: boolean; us: boolean };
export type Redirect = { id: string; path: string; target: string };

const UAE = (h: string) => `/products/${h}`;
const USA = (h: string) => `/en-us/products/${h}`;
const OURS = /^(\/en-us)?\/products\/[^/]+$/;

// What should exist: a product in one store only gets a redirect from the other store's link to it.
export function wantedRedirects(products: ProductMarkets[]): Omit<Redirect, "id">[] {
  return products.flatMap((p) =>
    p.ae && !p.us ? [{ path: USA(p.handle), target: UAE(p.handle) }]
    : p.us && !p.ae ? [{ path: UAE(p.handle), target: USA(p.handle) }]
    : []);
}

// The changes to get from what exists to what's wanted. A redirect someone made by hand for another purpose
// (any other path or target shape) is left alone.
export function planRedirects(products: ProductMarkets[], existing: Redirect[]) {
  const wanted = wantedRedirects(products);
  const key = (r: { path: string; target: string }) => `${r.path} ${r.target}`;
  const ours = existing.filter((r) => OURS.test(r.path) && OURS.test(r.target) && r.path.replace(/^\/en-us/, "") === r.target.replace(/^\/en-us/, ""));
  const have = new Set(ours.map(key));
  const want = new Set(wanted.map(key));
  return {
    create: wanted.filter((r) => !have.has(key(r))),
    remove: ours.filter((r) => !want.has(key(r))).map((r) => r.id),
  };
}

let lastRun = 0;

// `ifOlderThanMs`: skip when it ran more recently than that (the tick runs every 15 minutes; once an hour is plenty).
export async function syncMarketRedirects(log: string[] = [], ifOlderThanMs = 0) {
  if (!shopifyConfigured() || (ifOlderThanMs && Date.now() - lastRun < ifOlderThanMs)) return log;
  lastRun = Date.now();
  const products: ProductMarkets[] = [];
  for (let after: string | null = null; ;) {
    const res: { products: { nodes: ProductMarkets[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await admin(
      `query($after: String) { products(first: 100, after: $after, query: "status:active") {
        nodes { handle ae: publishedInContext(context: { country: AE }) us: publishedInContext(context: { country: US }) }
        pageInfo { hasNextPage endCursor }
      } }`,
      { after },
    );
    products.push(...res.products.nodes);
    if (!res.products.pageInfo.hasNextPage) break;
    after = res.products.pageInfo.endCursor;
  }
  const existing: Redirect[] = [];
  for (let after: string | null = null; ;) {
    const res: { urlRedirects: { nodes: Redirect[]; pageInfo: { hasNextPage: boolean; endCursor: string } } } = await admin(
      `query($after: String) { urlRedirects(first: 250, after: $after) {
        nodes { id path target } pageInfo { hasNextPage endCursor }
      } }`,
      { after },
    );
    existing.push(...res.urlRedirects.nodes);
    if (!res.urlRedirects.pageInfo.hasNextPage) break;
    after = res.urlRedirects.pageInfo.endCursor;
  }
  const { create, remove } = planRedirects(products, existing);
  for (const r of create) {
    const res = await admin<{ urlRedirectCreate: { userErrors: { message: string }[] } }>(
      `mutation($r: UrlRedirectInput!) { urlRedirectCreate(urlRedirect: $r) { userErrors { message } } }`,
      { r },
    );
    const err = res.urlRedirectCreate.userErrors[0]?.message;
    log.push(err ? `redirect ${r.path}: ${err}` : `redirect ${r.path} → ${r.target}`);
  }
  for (const id of remove) {
    await admin(`mutation($id: ID!) { urlRedirectDelete(id: $id) { userErrors { message } } }`, { id });
    log.push(`redirect removed ${id}`);
  }
  return log;
}
