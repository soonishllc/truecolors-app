// Plausible: completed orders, with revenue, from Shopify's checkout (which runs no theme code, so the theme's
// Plausible script can't see it). Paste this whole file into Shopify admin → Settings → Customer events →
// Add custom pixel, name it "Plausible purchases", set Permission to "Not required" (Plausible sets no cookies
// and keeps no personal data), Save, then Connect.
// In Plausible, add a goal: Custom event "Purchase", with revenue tracking on. Plausible converts AED and USD orders
// to the goal's currency, so both stores add up in one figure.

analytics.subscribe("checkout_completed", (event) => {
  const checkout = event.data.checkout;
  const total = checkout.totalPrice;
  fetch("https://plausible.io/api/event", {
    method: "POST",
    keepalive: true,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Purchase",
      domain: "truecolors.global",
      url: event.context.document.location.href,
      referrer: event.context.document.referrer,
      revenue: { currency: total.currencyCode, amount: Number(total.amount) },
      props: {
        // Which store the order came from, and how many shirts were in it.
        market: total.currencyCode === "USD" ? "US" : "UAE",
        items: String(checkout.lineItems.reduce((n, l) => n + l.quantity, 0)),
      },
    }),
  });
});
