import { config } from "@/lib/config";
import { makeHandoff } from "@/lib/proxy/handoff";
import { appPathFor, storeShell } from "@/lib/proxy/shell";
import { verifyProxyQuery } from "@/lib/proxy/signature";

// Shopify's app proxy: www.truecolors.global/apps/truecolors/<path> arrives here as /proxy/<path>, signed. The
// answer is Liquid, so Shopify shows it inside the store's theme, with the store's header, menu and footer.
export async function GET(req: Request, { params }: { params: Promise<{ path?: string[] }> }) {
  const url = new URL(req.url);
  const secret = config().SHOPIFY_PROXY_SECRET;
  if (!secret || !verifyProxyQuery(url.searchParams, secret)) return new Response("Not found", { status: 404 });
  const appPath = appPathFor((await params).path?.join("/") ?? "");
  if (!appPath) return new Response("Not found", { status: 404 });

  // Only the store page's own query (a referral code, a filter) goes on to the app; Shopify's signed fields don't.
  const own = new URLSearchParams(url.searchParams);
  for (const k of ["shop", "logged_in_customer_id", "path_prefix", "timestamp", "signature"]) own.delete(k);
  const body = storeShell({
    prefix: url.searchParams.get("path_prefix") || config().PROXY_PATH,
    appPath,
    query: own.toString(),
    handoff: makeHandoff(url.searchParams.get("logged_in_customer_id") ?? ""),
  });
  return new Response(body, { headers: { "Content-Type": "application/liquid", "Cache-Control": "no-store" } });
}
