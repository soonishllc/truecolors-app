import { config } from "../config";
import { PRICE_CENTS, SIZES, sku } from "../rules";
import { admin, gid, numericId, ok, type UserErrors } from "./client";

// Shopify calls for wholesale: catalog, orders and stock lookups for the bot and portal, and the draft
// orders, payments and fulfilments behind stockist orders. Mutation shapes follow the Admin GraphQL API;
// run them against a development store before the first live wholesale order.

export type CatalogItem = {
  title: string;
  handle: string;
  // Set on location designs: the only wholesaler who can order it.
  exclusiveTo?: string;
  retailPrice: string;
  currency: string;
  sizes: { size: string; sku: string; variantId: string; inventoryItemId: string; available: number }[];
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
            exclusive: { value: string } | null;
            variants: {
              nodes: { id: string; title: string; sku: string | null; price: string; inventoryQuantity: number | null; inventoryItem: { id: string } }[];
            };
          }[];
        };
      }[];
    };
  }>(
    `query($q: String!) {
      shop { currencyCode }
      collections(first: 1, query: $q) {
        nodes { products(first: 100) { nodes { title handle status
          exclusive: metafield(namespace: "truecolors", key: "exclusive_to") { value }
          variants(first: 20) { nodes { id title sku price inventoryQuantity inventoryItem { id } } } } } }
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
      exclusiveTo: p.exclusive?.value || undefined,
      retailPrice: p.variants.nodes[0]?.price ?? "",
      currency: data.shop.currencyCode,
      sizes: p.variants.nodes.map((v) => ({
        size: v.title, sku: v.sku ?? "", variantId: v.id, inventoryItemId: v.inventoryItem.id,
        available: Math.max(0, v.inventoryQuantity ?? 0),
      })),
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

// The retail price each variant sells for in a country's market, in that market's currency.
export async function variantPrices(variantIds: string[], country: string): Promise<Map<string, { amount: string; currency: string }>> {
  const data = await admin<{
    nodes: ({ id: string; contextualPricing: { price: { amount: string; currencyCode: string } } } | null)[];
  }>(
    `query($ids: [ID!]!, $country: CountryCode!) {
      nodes(ids: $ids) { ... on ProductVariant { id contextualPricing(context: { country: $country }) { price { amount currencyCode } } } }
    }`,
    { ids: variantIds, country },
  );
  return new Map(
    data.nodes.filter((n) => n?.contextualPricing).map((n) => [n!.id, { amount: n!.contextualPricing.price.amount, currency: n!.contextualPricing.price.currencyCode }]),
  );
}

export type DraftOrder = { id: string; name: string; invoiceUrl: string };

// A draft order at the quoted prices, in the stockist's currency, holding the stock until the quote lapses.
export async function createWholesaleDraftOrder(input: {
  shopifyCustomerId: string;
  currency: string;
  lines: { variantId: string; quantity: number; unit: string }[];
  tags: string[];
  note: string;
  reserveUntil: Date;
}): Promise<DraftOrder> {
  const res = await admin<{ draftOrderCreate: { draftOrder: DraftOrder | null; userErrors: UserErrors } }>(
    `mutation($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) { draftOrder { id name invoiceUrl } userErrors { field message } }
    }`,
    {
      input: {
        purchasingEntity: { customerId: gid("Customer", input.shopifyCustomerId) },
        useCustomerDefaultAddress: true,
        presentmentCurrencyCode: input.currency,
        lineItems: input.lines.map((l) => ({
          variantId: l.variantId,
          quantity: l.quantity,
          priceOverride: { amount: l.unit, currencyCode: input.currency },
        })),
        tags: input.tags,
        note: input.note,
        reserveInventoryUntil: input.reserveUntil.toISOString(),
      },
    },
  );
  return ok(res.draftOrderCreate, "draftOrderCreate").draftOrder!;
}

// Turns a draft into an order: awaiting payment for stockists paying by bank transfer, or already paid
// when the team records a transfer against an invoice.
export async function completeDraftAsPending(draftOrderId: string, paymentPending = true): Promise<{ orderId: string; orderName: string }> {
  const res = await admin<{
    draftOrderComplete: { draftOrder: { order: { id: string; name: string } | null } | null; userErrors: UserErrors };
  }>(
    `mutation($id: ID!, $pending: Boolean) {
      draftOrderComplete(id: $id, paymentPending: $pending) { draftOrder { order { id name } } userErrors { field message } }
    }`,
    { id: draftOrderId, pending: paymentPending },
  );
  const order = ok(res.draftOrderComplete, "draftOrderComplete").draftOrder?.order;
  if (!order) throw new Error(`Draft order ${draftOrderId} didn't become an order`);
  return { orderId: numericId(order.id), orderName: order.name };
}

export async function markOrderPaid(shopifyOrderId: string) {
  const res = await admin<{ orderMarkAsPaid: { userErrors: UserErrors } }>(
    `mutation($input: OrderMarkAsPaidInput!) { orderMarkAsPaid(input: $input) { userErrors { field message } } }`,
    { input: { id: gid("Order", shopifyOrderId) } },
  );
  ok(res.orderMarkAsPaid, "orderMarkAsPaid");
}

export type ShipTo = {
  name: string; company?: string; phone?: string; email?: string;
  street: string[]; city: string; state?: string; postalCode?: string; country: string;
};

export async function orderShipTo(shopifyOrderId: string): Promise<ShipTo | undefined> {
  const data = await admin<{
    order: {
      email: string | null;
      shippingAddress: {
        name: string | null; company: string | null; phone: string | null; address1: string | null; address2: string | null;
        city: string | null; provinceCode: string | null; zip: string | null; countryCodeV2: string | null;
      } | null;
    } | null;
  }>(
    `query($id: ID!) { order(id: $id) { email shippingAddress {
      name company phone address1 address2 city provinceCode zip countryCodeV2 } } }`,
    { id: gid("Order", shopifyOrderId) },
  );
  const a = data.order?.shippingAddress;
  if (!a?.address1 || !a.city || !a.countryCodeV2) return;
  return {
    name: a.name ?? "", company: a.company ?? undefined, phone: a.phone ?? undefined, email: data.order?.email ?? undefined,
    street: [a.address1, a.address2].filter(Boolean) as string[], city: a.city, state: a.provinceCode ?? undefined,
    postalCode: a.zip ?? undefined, country: a.countryCodeV2,
  };
}

// Marks the whole order shipped with its FedEx tracking; Shopify emails the stockist its shipping confirmation.
export async function fulfilWithTracking(shopifyOrderId: string, trackingNumber: string) {
  const data = await admin<{ order: { fulfillmentOrders: { nodes: { id: string; status: string }[] } } | null }>(
    `query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 10) { nodes { id status } } } }`,
    { id: gid("Order", shopifyOrderId) },
  );
  const open = (data.order?.fulfillmentOrders.nodes ?? []).filter((f) => f.status === "OPEN" || f.status === "IN_PROGRESS");
  if (!open.length) throw new Error(`Order ${shopifyOrderId} has nothing left to fulfil`);
  const res = await admin<{ fulfillmentCreate: { userErrors: UserErrors } }>(
    `mutation($fulfillment: FulfillmentInput!) { fulfillmentCreate(fulfillment: $fulfillment) { userErrors { field message } } }`,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: open.map((f) => ({ fulfillmentOrderId: f.id })),
        trackingInfo: { company: "FedEx", number: trackingNumber, url: `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}` },
        notifyCustomer: true,
      },
    },
  );
  ok(res.fulfillmentCreate, "fulfillmentCreate");
}

// An invoice with custom lines (no products, so no stock moves), such as a display partner's settlement.
export async function createInvoiceDraftOrder(input: {
  shopifyCustomerId: string;
  currency: string;
  lines: { title: string; quantity: number; unit: string }[];
  tags: string[];
  note: string;
}): Promise<DraftOrder> {
  const res = await admin<{ draftOrderCreate: { draftOrder: DraftOrder | null; userErrors: UserErrors } }>(
    `mutation($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) { draftOrder { id name invoiceUrl } userErrors { field message } }
    }`,
    {
      input: {
        purchasingEntity: { customerId: gid("Customer", input.shopifyCustomerId) },
        presentmentCurrencyCode: input.currency,
        lineItems: input.lines.map((l) => ({
          title: l.title,
          quantity: l.quantity,
          requiresShipping: false,
          taxable: false,
          originalUnitPriceWithCurrency: { amount: l.unit, currencyCode: input.currency },
        })),
        tags: input.tags,
        note: input.note,
      },
    },
  );
  return ok(res.draftOrderCreate, "draftOrderCreate").draftOrder!;
}

// Moves "available" stock: restocks out of a warehouse and onto a display, sales and counts off a display.
export async function adjustStock(changes: { inventoryItemId: string; locationId: string; delta: number }[], reference: string) {
  const res = await admin<{ inventoryAdjustQuantities: { userErrors: UserErrors } }>(
    `mutation($input: InventoryAdjustQuantitiesInput!) {
      inventoryAdjustQuantities(input: $input) { userErrors { field message } }
    }`,
    {
      input: {
        name: "available",
        reason: "correction",
        referenceDocumentUri: `truecolors://wholesale/${reference}`,
        changes: changes
          .filter((c) => c.delta !== 0)
          .map((c) => ({ inventoryItemId: c.inventoryItemId, locationId: gid("Location", c.locationId), delta: c.delta })),
      },
    },
  );
  ok(res.inventoryAdjustQuantities, "inventoryAdjustQuantities");
}

// What a wholesaler may see and order: everything, less other wholesalers' location designs.
export function catalogFor(items: CatalogItem[], wholesalerId: string | undefined): CatalogItem[] {
  return items.filter((p) => !p.exclusiveTo || p.exclusiveTo === wholesalerId);
}

// A location design as a wholesale product: in the wholesale collection, not published to the store, and
// marked with the one wholesaler who can order it. Stock is tracked, since it's printed in Cancún to order.
export async function createLocationProduct(input: {
  title: string; designCode: string; descriptionHtml: string; imageUrls: string[];
  exclusiveTo: string | null; designId: string;
}): Promise<{ productId: string }> {
  const created = await admin<{ productCreate: { product: { id: string } | null; userErrors: UserErrors } }>(
    `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) { product { id } userErrors { field message } }
    }`,
    {
      product: {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        vendor: "Truecolors",
        productType: "T-Shirt",
        status: "ACTIVE",
        tags: ["tc-location", "wholesale"],
        productOptions: [{ name: "Size", values: SIZES.map((name) => ({ name })) }],
        metafields: [
          { namespace: "truecolors", key: "design_id", type: "single_line_text_field", value: input.designId },
          ...(input.exclusiveTo ? [{ namespace: "truecolors", key: "exclusive_to", type: "single_line_text_field", value: input.exclusiveTo }] : []),
        ],
      },
      media: input.imageUrls.map((originalSource) => ({ originalSource, mediaContentType: "IMAGE" })),
    },
  );
  const product = ok(created.productCreate, "productCreate").product!;
  const variants = await admin<{ productVariantsBulkCreate: { userErrors: UserErrors } }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) { userErrors { field message } }
    }`,
    {
      productId: product.id,
      variants: SIZES.map((size) => ({
        optionValues: [{ optionName: "Size", name: size }],
        price: (PRICE_CENTS / 100).toFixed(2),
        inventoryPolicy: "DENY",
        inventoryItem: { sku: sku(input.designCode, size), tracked: true, requiresShipping: true },
      })),
    },
  );
  ok(variants.productVariantsBulkCreate, "productVariantsBulkCreate");
  const collection = await admin<{ collections: { nodes: { id: string }[] } }>(
    `query($q: String!) { collections(first: 1, query: $q) { nodes { id } } }`,
    { q: `handle:${config().WHOLESALE_COLLECTION_HANDLE}` },
  );
  const collectionId = collection.collections.nodes[0]?.id;
  if (!collectionId) throw new Error(`No Shopify collection with handle ${config().WHOLESALE_COLLECTION_HANDLE}`);
  const added = await admin<{ collectionAddProducts: { userErrors: UserErrors } }>(
    `mutation($id: ID!, $productIds: [ID!]!) { collectionAddProducts(id: $id, productIds: $productIds) { userErrors { field message } } }`,
    { id: collectionId, productIds: [product.id] },
  );
  ok(added.collectionAddProducts, "collectionAddProducts");
  return { productId: numericId(product.id) };
}
