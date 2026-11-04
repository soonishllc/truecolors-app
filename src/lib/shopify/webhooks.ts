import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;
  const digest = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  const given = Buffer.from(hmacHeader, "base64");
  return given.length === digest.length && timingSafeEqual(given, digest);
}

// The parts of Shopify's REST-format webhook payloads the app reads.

// Amounts come in the shop's currency (AED) and, in `*_set.presentment_money`, in the currency the customer paid
// (AED in the UAE, USD in the USA). Pre-orders are recorded in the customer's currency.
type MoneySet = { presentment_money: { amount: string } };

export type OrderLine = {
  id: number;
  product_id: number | null;
  variant_title: string | null;
  quantity: number;
  price: string;
  price_set?: MoneySet;
  total_discount: string;
  total_discount_set?: MoneySet;
  discount_allocations?: { amount: string; amount_set?: MoneySet }[];
  tax_lines?: { price: string; price_set?: MoneySet }[];
};

export type OrderPayload = {
  id: number;
  name: string;
  currency: string;
  presentment_currency?: string;
  note_attributes?: { name: string; value: string }[];
  line_items: OrderLine[];
  email?: string | null;
  contact_email?: string | null;
  shipping_address?: { city?: string | null } | null;
  cancelled_at?: string | null;
  tags?: string;
  financial_status?: string;
};

export type RefundPayload = {
  id: number;
  order_id: number;
  refund_line_items: { line_item_id: number; quantity: number; subtotal: number | string; subtotal_set?: MoneySet }[];
};

export type FulfillmentPayload = {
  id: number;
  order_id: number;
  created_at: string;
  line_items: { id: number }[];
};

export const REF_ATTRIBUTE = "tc_ref";

export const cents = (v: string | number) => Math.round(Number(v) * 100);

// The customer's amount when Shopify sent it, else the shop's.
const paid = (shop: string | number, set?: MoneySet) => cents(set?.presentment_money.amount ?? shop);

// The currency the customer paid in.
export const orderCurrency = (order: OrderPayload) => order.presentment_currency ?? order.currency;

export function lineNetCents(line: OrderLine): number {
  const discounts = line.discount_allocations?.length
    ? line.discount_allocations.reduce((s, d) => s + paid(d.amount, d.amount_set), 0)
    : paid(line.total_discount, line.total_discount_set);
  return paid(line.price, line.price_set) * line.quantity - discounts;
}

export function lineTaxCents(line: OrderLine): number {
  return (line.tax_lines ?? []).reduce((s, t) => s + paid(t.price, t.price_set), 0);
}

export const refundSubtotalCents = (item: RefundPayload["refund_line_items"][number]) => paid(item.subtotal, item.subtotal_set);

export function refCode(order: OrderPayload): string | undefined {
  return order.note_attributes?.find((a) => a.name === REF_ATTRIBUTE)?.value?.trim().toLowerCase() || undefined;
}
