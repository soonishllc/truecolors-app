import { cookies, headers } from "next/headers";
import { money } from "./format";
import { PREORDER_PRICE, marketForCountry, type PreorderMarket } from "./rules";

// The store's retail markets. Each has its own storefront address, currency and prices in Shopify, so a shopper
// sees one market at a time: the UAE (the store's root, AED) or the USA (/en-us, USD).
export const RETAIL_MARKETS = {
  AE: { label: "UAE", currency: "AED" },
  US: { label: "USA", currency: "USD" },
} as const;
export type RetailMarket = PreorderMarket;

export const retailMarket = (m: string | undefined): RetailMarket => (m && m.toUpperCase() in RETAIL_MARKETS ? (m.toUpperCase() as RetailMarket) : "AE");

// The store market the visitor is browsing, remembered when they open the app from a store page.
export const MARKET_COOKIE = "tc_market";

// The market to show a visitor: the one they picked, else the store's market they came from, else by where they
// are, from the country the host reports: the UAE store for the GCC and MENA, the USA store for everywhere else.
export async function visitorMarket(picked?: string): Promise<RetailMarket> {
  if (picked) return retailMarket(picked);
  const fromStore = (await cookies()).get(MARKET_COOKIE)?.value;
  if (fromStore) return retailMarket(fromStore);
  const h = await headers();
  return marketForCountry(h.get("x-vercel-ip-country") ?? h.get("cf-ipcountry"));
}

export const preorderPrice = (m: RetailMarket) => money(PREORDER_PRICE[m].cents, PREORDER_PRICE[m].currency);
