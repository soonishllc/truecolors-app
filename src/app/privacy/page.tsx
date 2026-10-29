import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { BRAND, COMPANY, CONTACT, DOMAIN } from "@/lib/brand";

export const metadata: Metadata = { title: `Privacy policy · ${BRAND}` };

export default function Privacy() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        This policy explains what personal information {COMPANY.name} collects through {DOMAIN}, why, who we share it
        with and the choices you have. We follow the UAE Personal Data Protection Law (Federal Decree-Law No. 45 of
        2021) and give the same core rights to everyone who uses the site, wherever they live. Purchases made in our
        store are also covered by the store&rsquo;s own privacy policy.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Fans:</strong> your email when you follow a designer, ask for a design back, confirm your email to vote or get your own link; the votes you cast; and pre-orders that came through your link.</li>
        <li><strong>Pre-orders:</strong> from our store, the order details needed to run campaigns: order number, email, size, quantity, city, payment status and which link it came through. We never see or store your card details; the store&rsquo;s payment provider handles them.</li>
        <li><strong>Designers:</strong> your name, handle, email and invite; the prompts, sketches and designs you create; and campaign and earnings records.</li>
        <li><strong>Connected social accounts:</strong> if you sign in with or connect Google, Apple, X, Instagram or TikTok, your account ID, username, profile name and picture, and public follower count. We don&rsquo;t receive your passwords, don&rsquo;t keep access tokens after sign-in and can&rsquo;t post for you.</li>
        <li><strong>Payout details:</strong> the PayPal email, bank account or USDC wallet you choose for payouts, stored encrypted and shown only to the people who make payments.</li>
        <li><strong>Technical data:</strong> basic server logs (IP address, browser, pages requested) kept for security and troubleshooting.</li>
      </ul>

      <h2>Why we use it</h2>
      <ul>
        <li>To run campaigns: count pre-orders, charge them when a design is funded, number editions and ship shirts.</li>
        <li>To send the emails you asked for: sign-in links, campaign updates, launches from designers you follow and rewards. Every email relates to something you signed up for; we don&rsquo;t sell your email or send unrelated marketing from this site.</li>
        <li>To credit and pay designers and to issue fan rewards.</li>
        <li>To keep the site secure and stop fake votes, referrals and accounts.</li>
        <li>To meet legal, tax and accounting obligations.</li>
      </ul>

      <h2>Who we share it with</h2>
      <p>We share personal information only with service providers that help us run the site, under contracts that limit how they use it:</p>
      <ul>
        <li><strong>Shopify</strong>: our store, checkout and payments.</li>
        <li><strong>Resend</strong>: sending email.</li>
        <li><strong>OpenAI</strong>: generating artwork from designers&rsquo; prompts and sketches. We don&rsquo;t send fans&rsquo; information.</li>
        <li><strong>Render</strong> and <strong>Cloudflare</strong>: hosting the site, database and files.</li>
        <li><strong>PayPal</strong>, banks and blockchain networks: making designer payouts.</li>
        <li>Our print and fulfilment partners: the details needed to make and deliver your shirt.</li>
      </ul>
      <p>
        Public by design: a designer&rsquo;s name, handle, designs and linked social usernames are shown on their
        profile and campaigns. Backers appear on campaign pages only as &ldquo;Someone in [city]&rdquo;. We may disclose
        information if the law requires it, and it would pass to a buyer if the business were sold.
      </p>
      <p>
        Some providers are outside the UAE, including in the United States and the EU. Where information is transferred,
        we rely on the safeguards the law requires.
      </p>

      <h2>Cookies</h2>
      <p>We use only cookies needed for the site to work, so there&rsquo;s nothing to opt in to:</p>
      <ul>
        <li><code>tc_session</code>: keeps designers signed in.</li>
        <li><code>tc_fan</code>: remembers that you confirmed your email, for up to a year.</li>
        <li><code>tc_oauth</code> and <code>tc_pending</code>: short-lived cookies used during social sign-in.</li>
      </ul>
      <p>We don&rsquo;t use advertising or analytics cookies on this site.</p>

      <h2>How long we keep it</h2>
      <p>
        Order, payout and tax records are kept as long as the law requires, usually up to seven years. Designer accounts
        are kept while active; fan emails and follows until you remove them or ask us to delete them. Logs are kept for
        a short period for security.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask to see, correct, export or delete your information, object to how we use it or withdraw consent at
        any time. Fans can stop following designers from <Link href="/me">My pre-orders</Link>, and you can reply
        &ldquo;stop&rdquo; to any email to stop that kind of email. For anything else, email <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>.
        We&rsquo;ll reply within 30 days. If you live in California or the EU/UK, you have these rights under your local
        law as well; we don&rsquo;t sell or share personal information for targeted advertising. You may also complain
        to your local data protection authority.
      </p>

      <h2>Security</h2>
      <p>
        Data is encrypted in transit, payout details are encrypted at rest, and access is limited to people who need it.
        No system is perfectly secure; if a breach affects you, we&rsquo;ll tell you as the law requires.
      </p>

      <h2>Children</h2>
      <p>The site isn&rsquo;t meant for children under 16, and designers must be at least 18. We don&rsquo;t knowingly collect information from children.</p>

      <h2>Changes</h2>
      <p>When we change this policy we&rsquo;ll update the date above, and for significant changes we&rsquo;ll email account holders.</p>
    </LegalPage>
  );
}
