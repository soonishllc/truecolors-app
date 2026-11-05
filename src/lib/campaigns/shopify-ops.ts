import { cancelOrder, chargeOrder, chargeStatus, createCampaignProduct, createFriendCode, createRewardCode } from "../shopify/campaigns";

// The Shopify calls the campaign logic depends on, swappable in tests.
export type ShopifyOps = {
  createCampaignProduct: typeof createCampaignProduct;
  chargeOrder: typeof chargeOrder;
  chargeStatus: typeof chargeStatus;
  cancelOrder: typeof cancelOrder;
  createRewardCode: typeof createRewardCode;
  createFriendCode: typeof createFriendCode;
};

let ops: ShopifyOps = { createCampaignProduct, chargeOrder, chargeStatus, cancelOrder, createRewardCode, createFriendCode };

export const shopify = () => ops;

export function useShopify(next: ShopifyOps) {
  ops = next;
}
