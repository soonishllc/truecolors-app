import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getTicket, handOverTicket, replyOnTicket } from "../gorgias/client";
import { bookShipment } from "../fedex/client";
import {
  adjustStock, completeDraftAsPending, createInvoiceDraftOrder, createLocationProduct, createWholesaleDraftOrder, customerOrders, fulfilWithTracking, locationStock, markOrderPaid,
  orderShipTo, variantPrices, wholesaleCatalog,
} from "../shopify/wholesale";

// Everything the wholesale bot calls outside the app, swappable in tests.
export type WholesaleOps = {
  getTicket: typeof getTicket;
  replyOnTicket: typeof replyOnTicket;
  handOverTicket: typeof handOverTicket;
  wholesaleCatalog: typeof wholesaleCatalog;
  customerOrders: typeof customerOrders;
  locationStock: typeof locationStock;
  variantPrices: typeof variantPrices;
  createWholesaleDraftOrder: typeof createWholesaleDraftOrder;
  completeDraftAsPending: typeof completeDraftAsPending;
  markOrderPaid: typeof markOrderPaid;
  orderShipTo: typeof orderShipTo;
  fulfilWithTracking: typeof fulfilWithTracking;
  bookShipment: typeof bookShipment;
  createInvoiceDraftOrder: typeof createInvoiceDraftOrder;
  adjustStock: typeof adjustStock;
  createLocationProduct: typeof createLocationProduct;
  converse(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<Anthropic.Beta.BetaMessage>;
};

let client: Anthropic | undefined;

const live: WholesaleOps = {
  getTicket,
  replyOnTicket,
  handOverTicket,
  wholesaleCatalog,
  customerOrders,
  locationStock,
  variantPrices,
  createWholesaleDraftOrder,
  completeDraftAsPending,
  markOrderPaid,
  orderShipTo,
  fulfilWithTracking,
  bookShipment,
  createInvoiceDraftOrder,
  adjustStock,
  createLocationProduct,
  converse: (params) => {
    client ??= new Anthropic({ apiKey: config().ANTHROPIC_API_KEY });
    return client.beta.messages.create(params);
  },
};

let ops: WholesaleOps = live;

export const wholesaleOps = () => ops;

export function useWholesaleOps(next: WholesaleOps) {
  ops = next;
}
