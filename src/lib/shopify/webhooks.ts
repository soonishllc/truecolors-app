import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(hmacHeader, "base64");
  return given.length === digest.length && timingSafeEqual(given, digest);
}

// The parts of Shopify's REST-format webhook payloads the app reads.

export type OrderLine = {
  id: number;
  product_id: number | null;
  variant_title: string | null;
  quantity: number;
  price: string;
  total_discount: string;
  discount_allocations?: { amount: string }[];
  tax_lines?: { price: string }[];
};

export type OrderPayload = {
  id: number;
  name: string;
  currency: string;
  note_attributes?: { name: string; value: string }[];
  line_items: OrderLine[];
  cancelled_at?: string | null;
};

export type RefundPayload = {
  id: number;
  order_id: number;
  refund_line_items: { line_item_id: number; quantity: number; subtotal: number | string }[];
};

export type FulfillmentPayload = {
  id: number;
  order_id: number;
  created_at: string;
  line_items: { id: number }[];
};

export const REF_ATTRIBUTE = "tc_ref";

export const cents = (v: string | number) => Math.round(Number(v) * 100);

export function lineNetCents(line: OrderLine): number {
  const discounts = line.discount_allocations?.length
    ? line.discount_allocations.reduce((s, d) => s + cents(d.amount), 0)
    : cents(line.total_discount);
  return cents(line.price) * line.quantity - discounts;
}

export function lineTaxCents(line: OrderLine): number {
  return (line.tax_lines ?? []).reduce((s, t) => s + cents(t.price), 0);
}

export function refCode(order: OrderPayload): string | undefined {
  return order.note_attributes?.find((a) => a.name === REF_ATTRIBUTE)?.value?.trim().toLowerCase() || undefined;
}
