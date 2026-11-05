To: Shopify Partner Support (Partner Dashboard → Support → Contact us; topic "API / app development")
Subject: Approval request: pre-orders charged only when a design reaches its run size (truecolors.global)

Hi Shopify team,

We run truecolors.global (Advanced plan, Shopify Payments, UAE market in AED and US market in USD at /en-us). Before we launch a feature, we'd like your written confirmation that the way we use the pre-order APIs is allowed, and which kind of app we need.

**What we sell.** Our own t-shirts, printed by our factory in Cancún with a sun-reactive ink. Independent artists design for us. We, Truecolors, are the seller of every shirt: we set the price, take the payment, print, ship from our warehouses (Dubai and Las Vegas) and handle returns. The artist earns a royalty.

**How a design is sold.** Each new design is printed as a numbered, made-to-order run. It goes on pre-order for up to 21 days, and we only print it if at least 100 people order it, which is our minimum economical print run.

- At checkout the customer pre-orders through a selling plan (pre-order, remaining balance charged later). Their card is saved but not charged.
- If the run reaches 100, we charge the saved card with `orderCreateMandatePayment`, print and ship (about 3–4 weeks).
- If it doesn't reach 100 by the closing date, we cancel the order with `orderCancel` and the customer is never charged.
- The terms are on the product page, in the cart (selling plan name) and in the order confirmation: "You're only charged if this design reaches 100 pre-orders by <date>."

**Our questions**

1. Your guidance on pre-order apps says not to use selling plans or deferred payments for crowdfunding. We are not collecting money for a third party's project: we are the merchant, selling our own product, and the 100-unit threshold is our minimum print run. Is this use permitted? If not, what would make it compliant (for example, always printing and shipping once a pre-order is placed, or a different deadline or wording)?
2. The guidance also says custom apps created in the Shopify admin can't use pre-order APIs. Should this be a custom app created in the Dev Dashboard (or the Partner Dashboard) and installed only on our store? Which protected scopes do we need to request (`read_customer_payment_methods`, `write_payment_mandate`, anything else)?
3. Is there anything in the requirements for pre-order apps we must add? For example, we plan to let customers cancel their own pre-order from their account page before the run closes.

Happy to share a demo of the flow or screenshots. Thank you!

Kevin Murcko
Truecolors Trading LLC, Dubai
hello@truecolors.global
