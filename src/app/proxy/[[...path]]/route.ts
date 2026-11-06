import { config } from "@/lib/config";
import { makeHandoff } from "@/lib/proxy/handoff";
import { campaignShareMeta } from "@/lib/proxy/share-meta";
import { appPathFor, storeShell } from "@/lib/proxy/shell";
import { verifyProxyQuery } from "@/lib/proxy/signature";
import { storeFeed } from "@/lib/store-feed";

// Shopify's app proxy: www.truecolors.global/apps/truecolors/<path> arrives here as /proxy/<path>, signed. The
// answer is Liquid, so Shopify shows it inside the store's theme, with the store's header, menu and footer.
export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const url = new URL(req.url);
  const secret = config().SHOPIFY_PROXY_SECRET;
  if (!secret || !verifyProxyQuery(url.searchParams, secret)) return new Response("Not found", { status: 404 });
  const path = (await params).path?.join("/") ?? "";
  // The community, as data for the theme's own pages (lib/store-feed.ts). Not Liquid, so Shopify passes it as is.
  if (path === "feed.json") {
    return Response.json(await storeFeed(), { headers: { "Cache-Control": "public, max-age=60" } });
  }
  const appPath = appPathFor(path);
  if (!appPath) return notFound();

  // Only the store page's own query (a referral code, a filter) goes on to the app; Shopify's signed fields don't.
  const own = new URLSearchParams(url.searchParams);
  for (const k of ["shop", "logged_in_customer_id", "path_prefix", "timestamp", "signature"]) own.delete(k);
  const slug = /^\/c\/([^/]+)$/.exec(appPath)?.[1];
  const meta = slug ? await campaignShareMeta(slug).catch(() => undefined) : undefined;
  // A campaign that doesn't exist (or isn't public) is a real 404, so search engines don't index an empty page.
  if (slug && !meta) return notFound();
  const body = storeShell({
    meta,
    prefix: url.searchParams.get("path_prefix") || config().PROXY_PATH,
    appPath,
    query: own.toString(),
    handoff: makeHandoff(url.searchParams.get("logged_in_customer_id") ?? ""),
  });
  return new Response(body, { headers: { "Content-Type": "application/liquid", "Cache-Control": "no-store" } });
}

// Not found, inside the store's own header and footer, with a way on. Shopify's app proxy serves Liquid pages as 200
// whatever the status here, so tc_noindex tells the theme to mark the page noindex (layout/theme.liquid).
function notFound() {
  const body = `{% assign tc_noindex = true %}<section style="max-width:560px;margin:0 auto;padding:72px 20px 96px">
  <p style="font-family:var(--mono,monospace);font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.7">Not found</p>
  <h1 style="font-size:40px;line-height:1.05;margin:8px 0 14px">That page isn't here</h1>
  <p style="margin:0 0 24px">The design may have ended or moved.</p>
  <p><a class="btn-primary dark" href="{{ routes.root_url | append: '/' | replace: '//', '/' }}apps/truecolors">See the community designs</a></p>
</section>`;
  return new Response(body, { status: 404, headers: { "Content-Type": "application/liquid", "Cache-Control": "no-store" } });
}
