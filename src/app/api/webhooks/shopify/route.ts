import { eq } from "drizzle-orm";
import {
  recordCancelledOrder, recordFulfillment, recordOrder, recordRefund,
} from "@/lib/campaigns/service";
import { config } from "@/lib/config";
import { db } from "@/lib/db/client";
import { webhookEvents } from "@/lib/db/schema";
import { verifyWebhook } from "@/lib/shopify/webhooks";

const HANDLERS: Record<string, (body: never) => Promise<void>> = {
  "orders/create": recordOrder,
  "orders/cancelled": recordCancelledOrder,
  "refunds/create": recordRefund,
  "fulfillments/create": recordFulfillment,
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
