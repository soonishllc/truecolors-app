import { cancelOrder, chargeOrder, createCampaignProduct } from "../shopify/campaigns";

// The Shopify calls the campaign logic depends on, swappable in tests.
export type ShopifyOps = {
  createCampaignProduct: typeof createCampaignProduct;
  chargeOrder: typeof chargeOrder;
  cancelOrder: typeof cancelOrder;
};

let ops: ShopifyOps = { createCampaignProduct, chargeOrder, cancelOrder };

export const shopify = () => ops;

export function useShopify(next: ShopifyOps) {
  ops = next;
}
