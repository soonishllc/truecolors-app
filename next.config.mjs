// Plain JavaScript, not TypeScript: the production image has no TypeScript, and Next.js would try to install it
// on start to read a .ts config.
/** @type {import("next").NextConfig} */
const nextConfig = {
  // Shopify's app proxy asks for /proxy/ with a trailing slash; Next.js would answer with a redirect to /proxy,
  // which Shopify hands to the shopper's browser on the store's domain, where /proxy doesn't exist.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ["sharp", "ffmpeg-static", "@electric-sql/pglite"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
  // Only the store may frame the app (its design and wholesale pages are store pages that embed it).
  async headers() {
    // The store's addresses: www, the bare domain and the myshopify one (as lib/links.ts storeOrigins).
    const store = new URL(process.env.STORE_URL ?? "https://www.truecolors.global");
    const bare = store.hostname.replace(/^www\./, "");
    const shop = process.env.SHOPIFY_STORE_DOMAIN ?? "cjfxb1-ex.myshopify.com";
    const allowed = [...new Set([store.origin, `${store.protocol}//${bare}`, `${store.protocol}//www.${bare}`, `https://${shop}`])];
    return [{ source: "/:path*", headers: [{ key: "Content-Security-Policy", value: `frame-ancestors 'self' ${allowed.join(" ")}` }] }];
  },
};

export default nextConfig;
