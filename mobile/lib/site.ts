// The store and the app the screens show. Everything a shopper, designer or wholesale partner does is on these
// live pages, so the app always matches the website.
export const STORE = "https://www.truecolors.global";
export const APP = `${STORE}/apps/truecolors`;
// Where the app registers for push notifications (the web app itself, not through the store).
export const PUSH_REGISTER = "https://app.truecolors.global/api/push/register";

// Pages that stay inside the app. Anything else (Instagram, WhatsApp, email, maps) opens in its own app.
const INSIDE = [
  "truecolors.global",
  "www.truecolors.global",
  "app.truecolors.global",
  "cjfxb1-ex.myshopify.com",
  "shopify.com",
  "checkout.shopify.com",
  "shop.app",
];

export function staysInside(url: string): boolean {
  if (url.startsWith("about:") || url.startsWith("data:") || url.startsWith("blob:")) return true;
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return INSIDE.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

export const COLORS = {
  bg: "#111111",
  bar: "#161514",
  ink: "#ffffff",
  muted: "#9a958f",
  line: "#2a2826",
  // The sun: magenta to orange to gold, as on the site.
  sun: ["#c8336a", "#e8762a", "#c4b200"] as const,
};
