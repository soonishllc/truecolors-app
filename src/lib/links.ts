import { cookies } from "next/headers";
import { config } from "./config";
import type { PreorderMarket } from "./rules";

// Every public page lives inside the store (STORE_URL), so links people follow (shares, emails, the bot, sign-in
// returns) go there, never to the app's own address.

// The public address of an app page: e.g. /c/beach-day → www.truecolors.global/apps/truecolors/c/beach-day.
export const publicUrl = (appPath: string) => {
  const { STORE_URL, PROXY_PATH } = config();
  return `${STORE_URL.replace(/\/$/, "")}${PROXY_PATH}${appPath.startsWith("/explore") ? appPath.slice("/explore".length) : appPath}`;
};

// The store in a market: the UAE is the store's root, the USA its /en-us subfolder.
export const storefront = (market: PreorderMarket = "AE") =>
  `${config().STORE_URL.replace(/\/$/, "")}${market === "US" ? config().STORE_US_PATH : ""}`;

// A redirect target from a query string or form, kept on this site: a plain path only, nothing that a browser
// would read as another host ("//x", "/\x").
export function safePath(next: string | null | undefined, fallback: string) {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  const base = "http://app.invalid";
  const url = new URL(next, base);
  return url.origin === base ? url.pathname + url.search + url.hash : fallback;
}

// The store's own addresses, the only pages allowed to frame the app: STORE_URL, the same domain with or without
// www, and the myshopify address.
export function storeOrigins() {
  const store = new URL(config().STORE_URL);
  const bare = store.hostname.replace(/^www\./, "");
  return [...new Set([store.origin, `${store.protocol}//${bare}`, `${store.protocol}//www.${bare}`, `https://${config().SHOPIFY_STORE_DOMAIN}`])];
}

// Set when the app is opened from a store page, so emails and sign-in returns land back in the store.
export const IN_STORE_COOKIE = "tc_in_store";

export async function inStore() {
  return (await cookies()).get(IN_STORE_COOKIE)?.value === "1";
}

// Where to send someone after a redirect: the store page for that app page when they use the app inside the
// store, else the app page itself.
export async function landing(appPath: string) {
  return (await inStore()) ? publicUrl(appPath) : appPath;
}
