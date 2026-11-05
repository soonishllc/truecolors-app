import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { BRAND, CONTACT } from "@/lib/brand";
import { storefront } from "@/lib/links";
import { money } from "@/lib/format";
import { GARMENT, CAMPAIGN_DAYS, CHARGE_RETRY_HOURS, FUNDING_GOAL, PREORDER_PRICE, RETURN_WINDOW_DAYS, SIZES } from "@/lib/rules";

export const metadata: Metadata = { title: `Pre-orders, shipping and returns · ${BRAND}` };

export default function PreOrders() {
  return (
    <LegalPage title="Pre-orders, shipping and returns">
      <p>
        Every design on {BRAND} is made to order in a numbered limited run. This page explains how that works. Orders
        are placed through our store, so its <a href={`${storefront()}/policies/refund-policy`}>refund
        policy</a> and <a href={`${storefront()}/policies/shipping-policy`}>shipping policy</a> also apply;
        where they differ for pre-orders, this page applies.
      </p>

      <h2>How a pre-order works</h2>
      <ol>
        <li>Each campaign runs for up to {CAMPAIGN_DAYS} days. Shirts are {money(PREORDER_PRICE.AE.cents, "AED")} in our UAE store and {money(PREORDER_PRICE.US.cents, "USD")} in our USA store, sizes {SIZES[0]}–{SIZES[SIZES.length - 1]}, plus shipping and any tax shown at checkout.</li>
        <li>At checkout your card is saved securely by the store but <strong>not charged</strong>.</li>
        <li>Pre-orders from both stores count towards the same goal. If the campaign reaches {FUNDING_GOAL} pre-orders, it&rsquo;s funded and your card is charged, usually within an hour. Pre-orders placed after that are charged straight away.</li>
        <li>If the campaign ends without reaching {FUNDING_GOAL}, nothing is printed and <strong>nobody is charged</strong>. Your pre-order is cancelled automatically and we email you.</li>
        <li>If your card can&rsquo;t be charged, we&rsquo;ll email you and try again for {CHARGE_RETRY_HOURS / 24} days. After that the pre-order is cancelled.</li>
      </ol>

      <h2>Numbered editions</h2>
      <p>
        When a funded campaign closes, every shirt gets its own edition number, in the order pre-orders were placed.
        We email you your number, and you can see it on <Link href="/me">My pre-orders</Link>. Funded designs
        aren&rsquo;t restocked; a design that missed its goal may come back once.
      </p>

      <h2>Changing or cancelling</h2>
      <p>
        You can cancel or change the size of a pre-order free of charge any time before your card is charged. Email{" "}
        <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> with your order number. Once charged, your shirt goes
        into production and the returns policy below applies.
      </p>

      <h2>Production and shipping</h2>
      <p>
        Every shirt is made in Canc&uacute;n, Mexico. Funded shirts are printed in batches and usually ship 3 to 4 weeks
        after the campaign closes. Our UAE store ships across the UAE and the Gulf from Dubai, and our USA store ships to
        US addresses from Las Vegas. Shipping cost and delivery time are
        shown at checkout, and you&rsquo;ll get tracking by email when your shirt ships. If production is delayed,
        we&rsquo;ll email you a new date; if the delay is more than 30 days, you can cancel for a full refund.
      </p>

      <h2>Returns and refunds</h2>
      <ul>
        <li><strong>Faulty, damaged or wrong item:</strong> contact us within {RETURN_WINDOW_DAYS} days of delivery with photos. We&rsquo;ll pay return shipping and send a replacement or refund you in full.</li>
        <li><strong>Change of mind:</strong> you can return an unworn, unwashed shirt with its tags within {RETURN_WINDOW_DAYS} days of delivery. Return shipping is at your cost, and we refund the shirt price once it arrives.</li>
        <li>Refunds go back to your original payment method, normally within 5 to 10 business days of approval.</li>
        <li>Because the colour change depends on sunlight strength, a lighter colour in weak or filtered sun isn&rsquo;t a fault. Prints are grey indoors and behind most glass.</li>
      </ul>

      <h2>Care</h2>
      <p>{GARMENT.care}</p>
    </LegalPage>
  );
}
