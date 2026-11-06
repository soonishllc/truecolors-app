import { eq } from "drizzle-orm";
import {
  recordCancelledOrder, recordFulfillment, recordOrder, recordRefund, settleCharges,
} from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { verifyWebhook, type OrderPayload } from "@/lib/shopify/webhooks";
import { trackOrder } from "@/lib/analytics";
import { recordSettlementPayment } from "@/lib/wholesale/consignment";
import { recordWholesaleShopifyOrder } from "@/lib/wholesale/orders";
import { syncMarketRedirects } from "@/lib/shopify/market-redirects";

const HANDLERS: Record<string, (body: never) => Promise<void>> = {
  // Campaign pre-orders, wholesale orders and settlement payments all arrive here; each handler ignores the rest.
  "orders/create": async (order: OrderPayload) => {
    await recordOrder(order);
    await trackOrder(order);
    await recordWholesaleShopifyOrder(order);
    await recordSettlementPayment(order);
  },
  // A pre-order's card charge went through: count it now rather than at the next tick.
  "orders/paid": async (order: OrderPayload) => {
    await settleCharges(new Date(), String(order.id));
  },
  "orders/cancelled": recordCancelledOrder,
  "refunds/create": recordRefund,
  "fulfillments/create": recordFulfillment,
  // A product added or changed: its link in the store that doesn't sell it goes to the one that does.
  "products/create": async () => void (await syncMarketRedirects()),
  "products/update": async () => void (await syncMarketRedirects([], 60_000)),
};

export async function POST(req: Request) {
  const secret = config().SHOPIFY_WEBHOOK_SECRET;
  const raw = await req.text();
  if (!secret || !verifyWebhook(raw, req.headers.get("x-shopify-hmac-sha256"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const topic = req.headers.get("x-shopify-topic") ?? "";
  const eventId = req.headers.get("x-shopify-event-id") ?? req.headers.get("x-shopify-webhook-id");
  const handler = HANDLERS[topic];
  if (!handler) return new Response("Ignored");

  const d = await db();
  if (eventId) {
    const seen = await d.select().from(webhookEvents).where(eq(webhookEvents.id, eventId));
    if (seen.length) return new Response("Duplicate");
  }
  await handler(JSON.parse(raw) as never);
  // Recorded only after success, so a failure is retried by Shopify. Handlers are safe to repeat.
  if (eventId) await d.insert(webhookEvents).values({ id: eventId, topic }).onConflictDoNothing();
  return new Response("OK");
}
