import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { publicUrl } from "@/lib/links";
import { recordSettlementPayment } from "@/lib/wholesale/consignment";
import { recordWholesaleShopifyOrder } from "@/lib/wholesale/orders";

// Local demo only: stands in for Shopify checkout. Opening the link pays the order or settlement, the way
// Shopify's paid-order webhook would report it, so the order ships with a demo FedEx label.
export async function GET(req: Request) {
  if (!config().WHOLESALE_DEMO) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  const order = q.get("order");
  const settlement = q.get("settlement");
  const id = Date.now();
  if (order) {
    await recordWholesaleShopifyOrder({ id, name: `#${String(id).slice(-4)}`, currency: "USD", line_items: [], tags: `wholesale, wholesale-order:${order}`, financial_status: "paid" });
  }
  if (settlement) {
    await recordSettlementPayment({ id, name: `#${String(id).slice(-4)}`, currency: "MXN", line_items: [], tags: `consignment-settlement:${settlement}`, financial_status: "paid" });
  }
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Demo payment</title>
    <body style="font-family:system-ui;max-width:480px;margin:64px auto;padding:0 16px;line-height:1.5">
    <h1>Paid (demo)</h1><p>This stands in for Shopify checkout. ${order ? "The order has been booked with FedEx (demo) and marked shipped." : "The settlement is marked paid."}</p>
    <p><a href="${publicUrl("/wholesale")}"><strong>Back to Wholesale</strong></a> · <a href="/admin/wholesale">See it on the Admin page</a></p></body>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
