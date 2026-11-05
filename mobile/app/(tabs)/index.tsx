import { WebScreen } from "@/components/WebScreen";
import { STORE } from "@/lib/site";

// The store: the shop, product pages, cart and Shopify checkout (Apple Pay and Google Pay included).
export default function Shop() {
  return <WebScreen url={STORE} tabRoot />;
}
