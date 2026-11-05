import "@shopify/ui-extensions/preact";
import { useEffect, useState } from "preact/hooks";

// The app (the APP_URL it runs at): answers /api/checkout/backer for this card.
const APP_URL = "https://app.truecolors.global";
// The order's webhook can land a few seconds after the Thank you page opens, so ask again while it's pending.
const TRIES = 6;
const WAIT_MS = 2500;
// As FRIEND_DISCOUNT_PERCENT in the app's src/lib/rules.ts.
const FRIEND_PERCENT = 10;

type Backing = { slug: string; title: string; numbers: number[]; url: string };

const no = (n: number) => `#${String(n).padStart(3, "0")}`;

// Shown when the order has a community pre-order (a tc-campaign product): the backer's edition numbers and a button
// back to the design's page in the store, with their share link ready. Shows nothing for any other order.
export function BackerCard({ orderId, productIds }: { orderId: string | undefined; productIds: string[] }) {
  const [backings, setBackings] = useState<Backing[]>([]);
  const products = productIds.join(",");

  useEffect(() => {
    if (!orderId) return;
    let stopped = false;
    (async () => {
      for (let i = 0; i < TRIES && !stopped; i++) {
        if (i) await new Promise((r) => setTimeout(r, WAIT_MS));
        try {
          const token = await shopify.sessionToken.get();
          const q = new URLSearchParams({ order: orderId, products });
          const res = await fetch(`${APP_URL}/api/checkout/backer?${q}`, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return;
          const body: { backings: Backing[]; pending: boolean } = await res.json();
          if (stopped) return;
          setBackings(body.backings);
          if (!body.pending) return;
        } catch {
          // Offline or the app is down: the backer still gets the email.
        }
      }
    })();
    return () => {
      stopped = true;
    };
  }, [orderId, products]);

  if (!backings.length) return null;
  return (
    <s-stack gap="base">
      {backings.map((b) => (
        <s-section key={b.slug} heading={`You're in, ${b.numbers.map(no).join(" · ")}`}>
          <s-stack gap="base">
            <s-text>
              {b.title}: your edition {b.numbers.length > 1 ? "numbers are" : "number is"} printed inside the shirt.
            </s-text>
            <s-text>Friends get {FRIEND_PERCENT}% off with your link.</s-text>
            <s-button variant="primary" href={b.url}>
              Share your design
            </s-button>
          </s-stack>
        </s-section>
      ))}
    </s-stack>
  );
}
