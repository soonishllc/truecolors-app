import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { BRAND, COMPANY, DOMAIN } from "@/lib/brand";
import { config } from "@/lib/config";
import { REFERRALS_PER_REWARD } from "@/lib/rules";

export const metadata: Metadata = { title: `Terms of use · ${BRAND}` };

export default function Terms() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms cover your use of {DOMAIN} (&ldquo;{BRAND}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), operated by{" "}
        {COMPANY.name}, licensed under a {COMPANY.licence}. By using the site you agree to them, to our{" "}
        <Link href="/privacy">privacy policy</Link> and to our <Link href="/pre-orders">pre-order, shipping and returns
        policy</Link>. If you don&rsquo;t agree, please don&rsquo;t use the site.
      </p>

      <h2>1. What the site does</h2>
      <p>
        {BRAND} is where invited designers create colour-changing shirt designs and run pre-order campaigns for them.
        Shirts are printed with UV-reactive ink that shows grey line art in the shade and full colour in direct sunlight.
        A design is only printed if enough people pre-order it before its campaign ends.
      </p>

      <h2>2. Buying a shirt</h2>
      <p>
        Pre-orders are placed and paid for through our store at{" "}
        <a href={config().STORE_URL}>{new URL(config().STORE_URL).host}</a>, which is
        covered by the store&rsquo;s own terms of service and refund policy. How pre-orders are charged, numbered,
        shipped and returned is set out in our <Link href="/pre-orders">pre-order policy</Link>. Colour intensity
        depends on the strength of the sunlight, and colours on screen are a guide only.
      </p>

      <h2>3. Fans: following, voting and your own link</h2>
      <p>
        You can follow designers, ask for missed designs to come back, vote in design challenges and get your own share
        link by confirming your email. One email is one person: votes or referrals made with multiple or fake emails,
        bots or paid traffic are removed, and we may cancel rewards earned that way. Every {REFERRALS_PER_REWARD}{" "}
        charged pre-orders that come through your link (not counting your own orders) earn you a single-use code for a
        free shirt in our store. Codes have no cash value and can&rsquo;t be exchanged or transferred.
      </p>

      <h2>4. Designers</h2>
      <p>
        Designer accounts are by invitation and are also governed by the{" "}
        <Link href="/designer-agreement">designer agreement</Link>, which takes priority over these terms where they
        differ. You&rsquo;re responsible for keeping access to your email and any connected social accounts secure.
      </p>

      <h2>5. What you may not do</h2>
      <ul>
        <li>Upload or create anything you don&rsquo;t have the rights to, including other people&rsquo;s artwork, logos, trademarks or likenesses.</li>
        <li>Create hateful, harassing, sexual, violent or illegal content, or content that targets a real person.</li>
        <li>Interfere with the site, scrape it, probe it for weaknesses or try to get around its limits.</li>
        <li>Use the site to mislead people, including fake campaigns, votes or reviews.</li>
      </ul>
      <p>We can remove content and suspend or close accounts that break these rules.</p>

      <h2>6. Our content</h2>
      <p>
        The Truecolors name and logo, the site&rsquo;s design and our photos belong to us or our licensors.{" "}
        {COMPANY.trademark} Designs belong to the designers who made them, licensed to us as the designer agreement
        describes.
      </p>

      <h2>7. AI tools</h2>
      <p>
        The design studio uses AI image models to turn prompts and sketches into artwork. AI output can be imperfect or
        resemble existing work, so every design is checked before its campaign goes live, and designers stay
        responsible for what they submit.
      </p>

      <h2>8. Availability and changes</h2>
      <p>
        We work to keep the site running but can&rsquo;t promise it will always be available or error-free. We may
        change or stop features, campaigns or challenges. When we change these terms we&rsquo;ll update the date above,
        and for significant changes we&rsquo;ll let account holders know by email.
      </p>

      <h2>9. Liability</h2>
      <p>
        To the extent the law allows, the site is provided &ldquo;as is&rdquo;, and our total liability to you for any
        claim about the site is limited to the amount you paid us for the order the claim relates to. Nothing in these
        terms limits rights you have as a consumer that can&rsquo;t be limited by law.
      </p>

      <h2>10. Law</h2>
      <p>
        These terms are governed by the laws of the United Arab Emirates as applied in the Emirate of Dubai, and disputes
        go to the courts of Dubai, unless the law of the country you live in gives you the right to bring a claim there.
      </p>
    </LegalPage>
  );
}
