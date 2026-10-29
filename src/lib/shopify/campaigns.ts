import { config } from "../config";
import { COMPARE_AT_CENTS, SIZES, sku } from "../rules";
import { admin, gid, numericId, ok, type UserErrors } from "./client";

// Everything the app does to Shopify for a campaign. Mutation shapes follow the Admin GraphQL API;
// run them against a development store before the first live campaign (see README, "Verify on a dev store").

const dollars = (cents: number) => (cents / 100).toFixed(2);

export type CampaignProduct = {
  productId: string;
  handle: string;
  variantIds: Record<string, string>;
  sellingPlanGroupId: string;
};

export async function createCampaignProduct(input: {
  campaignId: string;
  title: string;
  descriptionHtml: string;
  designCode: string;
  designerName: string;
  priceCents: number;
  endsAt: Date;
  imageUrls: string[];
}): Promise<CampaignProduct> {
  const created = await admin<{
    productCreate: { product: { id: string; handle: string } | null; userErrors: UserErrors };
  }>(
    `mutation($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) { product { id handle } userErrors { field message } }
    }`,
    {
      product: {
        title: input.title,
        descriptionHtml: input.descriptionHtml,
        vendor: "Truecolors",
        productType: "T-Shirt",
        status: "ACTIVE",
        tags: ["tc-campaign", `designer:${input.designerName}`],
        requiresSellingPlan: true,
        productOptions: [{ name: "Size", values: SIZES.map((name) => ({ name })) }],
        metafields: [
          { namespace: "truecolors", key: "campaign_id", type: "single_line_text_field", value: input.campaignId },
          { namespace: "truecolors", key: "designer", type: "single_line_text_field", value: input.designerName },
        ],
      },
      media: input.imageUrls.map((originalSource) => ({ originalSource, mediaContentType: "IMAGE" })),
    },
  );
  const product = ok(created.productCreate, "productCreate").product!;

  const variants = await admin<{
    productVariantsBulkCreate: {
      productVariants: { id: string; selectedOptions: { value: string }[] }[];
      userErrors: UserErrors;
    };
  }>(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
        productVariants { id selectedOptions { value } } userErrors { field message }
      }
    }`,
    {
      productId: product.id,
      variants: SIZES.map((size) => ({
        optionValues: [{ optionName: "Size", name: size }],
        price: dollars(input.priceCents),
        compareAtPrice: dollars(COMPARE_AT_CENTS),
        inventoryPolicy: "CONTINUE",
        inventoryItem: { sku: sku(input.designCode, size), tracked: false, requiresShipping: true },
      })),
    },
  );
  const variantIds = Object.fromEntries(
    ok(variants.productVariantsBulkCreate, "productVariantsBulkCreate").productVariants.map((v) => [
      v.selectedOptions[0].value,
      v.id,
    ]),
  );

  // Pre-order with nothing charged at checkout: Shopify saves the card and the app charges it once the
  // goal is reached. The balance trigger is a backstop only; the app charges or cancels long before it.
  const backstop = new Date(input.endsAt.getTime() + 30 * 24 * 3600 * 1000);
  const plan = await admin<{
    sellingPlanGroupCreate: { sellingPlanGroup: { id: string } | null; userErrors: UserErrors };
  }>(
    `mutation($input: SellingPlanGroupInput!, $resources: SellingPlanGroupResourceInput) {
      sellingPlanGroupCreate(input: $input, resources: $resources) { sellingPlanGroup { id } userErrors { field message } }
    }`,
    {
      input: {
        name: "Pre-order",
        merchantCode: `tc-campaign-${input.designCode}`,
        options: ["Pre-order"],
        sellingPlansToCreate: [
          {
            name: "Pre-order: you're only charged if this design reaches its goal",
            category: "PRE_ORDER",
            options: ["Pre-order"],
            billingPolicy: {
              fixed: {
                checkoutCharge: { type: "PERCENTAGE", value: { percentage: 0 } },
                remainingBalanceChargeTrigger: "EXACT_TIME",
                remainingBalanceChargeExactTime: backstop.toISOString(),
              },
            },
            deliveryPolicy: { fixed: { fulfillmentTrigger: "UNKNOWN" } },
            inventoryPolicy: { reserve: "ON_FULFILLMENT" },
          },
        ],
      },
      resources: { productIds: [product.id] },
    },
  );
  const sellingPlanGroupId = ok(plan.sellingPlanGroupCreate, "sellingPlanGroupCreate").sellingPlanGroup!.id;

  const publicationId = config().SHOPIFY_US_PUBLICATION_ID;
  if (publicationId) {
    const pub = await admin<{ publishablePublish: { userErrors: UserErrors } }>(
      `mutation($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { field message } }
      }`,
      { id: product.id, input: [{ publicationId: gid("Publication", publicationId) }] },
    );
    ok(pub.publishablePublish, "publishablePublish");
  }

  return { productId: numericId(product.id), handle: product.handle, variantIds, sellingPlanGroupId };
}

export type ChargeResult = { ok: true; reference: string } | { ok: false; error: string };

// Charges the card Shopify saved at checkout. amountCents undefined = the order's whole outstanding balance.
export async function chargeOrder(orderId: string, idempotencyKey: string, amountCents?: number): Promise<ChargeResult> {
  const found = await admin<{
    order: { paymentCollectionDetails: { vaultedPaymentMethods: { id: string }[] | null } } | null;
  }>(
    `query($id: ID!) { order(id: $id) { paymentCollectionDetails { vaultedPaymentMethods { id } } } }`,
    { id: gid("Order", orderId) },
  );
  const mandateId = found.order?.paymentCollectionDetails.vaultedPaymentMethods?.[0]?.id;
  if (!mandateId) return { ok: false, error: "No saved card on this order" };

  const res = await admin<{
    orderCreateMandatePayment: { paymentReferenceId: string | null; userErrors: UserErrors };
  }>(
    `mutation($id: ID!, $mandateId: ID!, $idempotencyKey: String!, $amount: MoneyInput) {
      orderCreateMandatePayment(id: $id, mandateId: $mandateId, idempotencyKey: $idempotencyKey, amount: $amount, autoCapture: true) {
        paymentReferenceId userErrors { field message }
      }
    }`,
    {
      id: gid("Order", orderId),
      mandateId,
      idempotencyKey,
      amount: amountCents === undefined ? null : { amount: dollars(amountCents), currencyCode: "USD" },
    },
  );
  const p = res.orderCreateMandatePayment;
  if (p.userErrors.length || !p.paymentReferenceId) {
    return { ok: false, error: p.userErrors.map((e) => e.message).join("; ") || "Charge not accepted" };
  }
  return { ok: true, reference: p.paymentReferenceId };
}

// Cancels a whole order, refunding anything already charged to the original card.
export async function cancelOrder(orderId: string, staffNote: string) {
  const res = await admin<{ orderCancel: { userErrors: UserErrors } }>(
    `mutation($orderId: ID!, $staffNote: String) {
      orderCancel(orderId: $orderId, reason: OTHER, refundMethod: { originalPaymentMethodsRefund: true },
        restock: false, notifyCustomer: true, staffNote: $staffNote) { userErrors { field message } }
    }`,
    { orderId: gid("Order", orderId), staffNote },
  );
  ok(res.orderCancel, "orderCancel");
}

// A single-use code worth one tee, for a fan whose link brought in enough pre-orders.
export async function createRewardCode(code: string, valueCents: number) {
  const res = await admin<{ discountCodeBasicCreate: { userErrors: UserErrors } }>(
    `mutation($input: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $input) { userErrors { field message } }
    }`,
    {
      input: {
        title: `Fan reward ${code}`,
        code,
        startsAt: new Date().toISOString(),
        usageLimit: 1,
        appliesOncePerCustomer: true,
        customerSelection: { all: true },
        customerGets: { value: { discountAmount: { amount: dollars(valueCents), appliesOnEachItem: false } }, items: { all: true } },
      },
    },
  );
  ok(res.discountCodeBasicCreate, "discountCodeBasicCreate");
}

export function productUrl(handle: string, ref?: string) {
  const url = new URL(`${config().SHOPIFY_STOREFRONT_URL.replace(/\/$/, "")}/products/${handle}`);
  if (ref) url.searchParams.set("ref", ref);
  return url.toString();
}
