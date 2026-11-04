import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config";
import { getTicket, handOverTicket, replyOnTicket } from "../gorgias/client";
import { customerOrders, locationStock, wholesaleCatalog } from "../shopify/wholesale";

// Everything the wholesale bot calls outside the app, swappable in tests.
export type WholesaleOps = {
  getTicket: typeof getTicket;
  replyOnTicket: typeof replyOnTicket;
  handOverTicket: typeof handOverTicket;
  wholesaleCatalog: typeof wholesaleCatalog;
  customerOrders: typeof customerOrders;
  locationStock: typeof locationStock;
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
