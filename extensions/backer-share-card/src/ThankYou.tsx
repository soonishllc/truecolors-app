import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { BackerCard } from "./BackerCard";

// purchase.thank-you.block.render: the order is gid://shopify/OrderIdentity/<order id>.
export default async () => {
  render(<ThankYou />, document.body);
};

function ThankYou() {
  return (
    <BackerCard
      orderId={shopify.orderConfirmation.value.order.id}
      productIds={shopify.lines.value.map((l) => l.merchandise.product.id)}
    />
  );
}
