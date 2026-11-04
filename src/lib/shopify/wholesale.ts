import { config } from "../config";
import { admin, gid } from "./client";

// Read-only Shopify lookups for the wholesale bot and portal. Writes (draft orders, transfers) come in
// phase 2, behind payment or team approval.

export type CatalogItem = {
  title: string;
  handle: string;
  retailPrice: string;
  currency: string;
  sizes: { size: string; sku: string; available: number }[];
};

export type OrderSummary = {
  name: string;
  createdAt: string;
  paid: string;
  fulfilment: string;
  total: string;
  currency: string;
  statusUrl: string;
  tracking: { company?: string; number?: string; url?: string }[];
};

export type StockLine = { product: string; size: string; sku: string; available: number };

export async function wholesaleCatalog(): Promise<CatalogItem[]> {
  const data = await admin<{
    shop: { currencyCode: string };
    collections: {
      nodes: {
        products: {
          nodes: {
            title: string;
            handle: string;
            status: string;
            variants: { nodes: { title: string; sku: string | null; price: string; inventoryQuantity: number | null }[] };
          }[];
        };
      }[];
    };
  }>(
    `query($q: String!) {
      shop { currencyCode }
      collections(first: 1, query: $q) {
        nodes { products(first: 100) { nodes { title handle status
          variants(first: 20) { nodes { title sku price inventoryQuantity } } } } }
      }
    }`,
    { q: `handle:${config().WHOLESALE_COLLECTION_HANDLE}` },
  );
  const products = data.collections.nodes[0]?.products.nodes ?? [];
  return products
    .filter((p) => p.status === "ACTIVE")
    .map((p) => ({
      title: p.title,
      handle: p.handle,
      retailPrice: p.variants.nodes[0]?.price ?? "",
      currency: data.shop.currencyCode,
      sizes: p.variants.nodes.map((v) => ({ size: v.title, sku: v.sku ?? "", available: Math.max(0, v.inventoryQuantity ?? 0) })),
    }));
}

export async function customerOrders(shopifyCustomerId: string, first = 10): Promise<OrderSummary[]> {
  const data = await admin<{
    customer: {
      orders: {
        nodes: {
          name: string;
          createdAt: string;
          displayFinancialStatus: string | null;
          displayFulfillmentStatus: string;
          totalPriceSet: { presentmentMoney: { amount: string; currencyCode: string } };
          statusPageUrl: string;
          fulfillments: { trackingInfo: { company: string | null; number: string | null; url: string | null }[] }[];
        }[];
      };
    } | null;
  }>(
    `query($id: ID!, $first: Int!) {
      customer(id: $id) {
        orders(first: $first, sortKey: CREATED_AT, reverse: true) {
          nodes { name createdAt displayFinancialStatus displayFulfillmentStatus statusPageUrl
            totalPriceSet { presentmentMoney { amount currencyCode } }
            fulfillments(first: 5) { trackingInfo { company number url } } }
        }
      }
    }`,
    { id: gid("Customer", shopifyCustomerId), first },
  );
  return (data.customer?.orders.nodes ?? []).map((o) => ({
    name: o.name,
    createdAt: o.createdAt,
    paid: o.displayFinancialStatus ?? "PENDING",
    fulfilment: o.displayFulfillmentStatus,
    total: o.totalPriceSet.presentmentMoney.amount,
    currency: o.totalPriceSet.presentmentMoney.currencyCode,
    statusUrl: o.statusPageUrl,
    tracking: o.fulfillments.flatMap((f) =>
      f.trackingInfo.map((t) => ({ company: t.company ?? undefined, number: t.number ?? undefined, url: t.url ?? undefined })),
    ),
  }));
}

export async function locationStock(shopifyLocationId: string): Promise<StockLine[]> {
  const data = await admin<{
    location: {
      inventoryLevels: {
        nodes: {
          quantities: { name: string; quantity: number }[];
          item: { sku: string | null; variant: { title: string; product: { title: string } } | null };
        }[];
      };
    } | null;
  }>(
    `query($id: ID!) {
      location(id: $id) {
        inventoryLevels(first: 250) { nodes {
          quantities(names: ["available"]) { name quantity }
          item { sku variant { title product { title } } } } }
      }
    }`,
    { id: gid("Location", shopifyLocationId) },
  );
  return (data.location?.inventoryLevels.nodes ?? [])
    .filter((l) => l.item.variant)
    .map((l) => ({
      product: l.item.variant!.product.title,
      size: l.item.variant!.title,
      sku: l.item.sku ?? "",
      available: l.quantities.find((q) => q.name === "available")?.quantity ?? 0,
    }));
}
