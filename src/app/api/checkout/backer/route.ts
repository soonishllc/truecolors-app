import { inArray } from "drizzle-orm";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { campaigns } from "@/lib/db/schema";
import { orderBackings } from "@/lib/fans";
import { verifySessionToken } from "@/lib/shopify/session-token";

export const dynamic = "force-dynamic";

// For the backer share card on the Thank you and Order status pages (extensions/backer-share-card):
//   GET /api/checkout/backer?order=<order gid>&products=<product gid>,…   Authorization: Bearer <session token>
// answers { backings: [{ slug, title, numbers, url }], pending }. `pending` means the order has a pre-order product
// but its orders/create webhook hasn't been recorded yet, so the card should ask again in a moment.
//
// The token is the extension's own, signed with the app's secret, so only this store's checkout can ask. It doesn't
// prove the asker placed the order; what comes back is what the order's own backer link shows (edition numbers and
// a share link), never a name or an email.

// The extension runs in a Shopify-hosted worker, on another origin.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization",
  "Access-Control-Allow-Methods": "GET",
};

// gid://shopify/Order/123 (Order status), gid://shopify/OrderIdentity/123 (Thank you) or 123 → 123.
const idOf = (gid: string | null) => gid?.trim().split("/").pop() || undefined;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export async function GET(req: Request) {
  const secret = config().SHOPIFY_PROXY_SECRET;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || !verifySessionToken(token, secret, config().SHOPIFY_STORE_DOMAIN)) {
    return Response.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }
  const url = new URL(req.url);
  const orderId = idOf(url.searchParams.get("order"));
  if (!orderId) return Response.json({ error: "Missing order" }, { status: 400, headers: CORS });

  const backings = await orderBackings(orderId);
  let pending = false;
  if (!backings.length) {
    const productIds = (url.searchParams.get("products") ?? "").split(",").map(idOf).filter((id): id is string => !!id);
    if (productIds.length) {
      const d = await db();
      pending = (await d.select({ id: campaigns.id }).from(campaigns).where(inArray(campaigns.shopifyProductId, productIds))).length > 0;
    }
  }
  return Response.json({ backings, pending }, { headers: { ...CORS, "Cache-Control": "no-store" } });
}
