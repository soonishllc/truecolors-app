import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { BackerCard } from "./BackerCard";

// customer-account.order-status.block.render: the order is gid://shopify/Order/<order id>.
export default async () => {
  render(<OrderStatus />, document.body);
};

function OrderStatus() {
  return (
    <BackerCard
      orderId={shopify.order.value?.id}
      productIds={shopify.lines.value.map((l) => l.merchandise.product.id)}
    />
  );
}
