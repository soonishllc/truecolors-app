import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/LegalPage";
import { BRAND, COMPANY } from "@/lib/brand";
import { config } from "@/lib/config";
import {
  CAMPAIGN_DAYS, CHALLENGE_ENTRIES_PER_DESIGNER, FUNDING_GOAL, MAX_LIVE_CAMPAIGNS_PER_DESIGNER, PAYOUT_BUFFER_DAYS,
  RETURN_WINDOW_DAYS, SHARE_BPS, SHARE_OWN_LINK_BPS,
} from "@/lib/rules";

export const metadata: Metadata = { title: `Designer agreement · ${BRAND}` };

const pct = (bps: number) => `${bps / 100}%`;

export default function DesignerAgreement() {
  const version = config().DESIGNER_AGREEMENT_VERSION;
  return (
    <LegalPage title="Designer agreement">
      <p className="notice">
        {version
          ? <>Version {version}. Designers accept this agreement when they join, and again whenever it changes.</>
          : <>This agreement takes effect when campaigns open. Designers will be asked to accept it before their first campaign goes live.</>}
      </p>
      <p>
        This agreement is between you, a designer on {BRAND}, and {COMPANY.name} (&ldquo;Truecolors&rdquo;). It sits
        alongside our <Link href="/terms">terms of use</Link> and <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>1. Joining</h2>
      <p>
        Designer accounts are by invitation. You must be at least 18 and able to enter a contract. One account per
        person; keep your sign-in details to yourself.
      </p>

      <h2>2. Your designs</h2>
      <ul>
        <li>You keep the copyright and other rights you hold in your designs.</li>
        <li>You confirm that each design you submit is your own work or that you have every right needed to use it, and that it doesn&rsquo;t include anyone else&rsquo;s artwork, trademarks, logos, characters or likeness without permission.</li>
        <li>Designs made with the studio&rsquo;s AI tools are still your responsibility: check them before you submit. AI-generated elements may not be protected by copyright in every country.</li>
        <li>Designs must follow the content rules in our terms of use.</li>
      </ul>

      <h2>3. The licence you give us</h2>
      <p>
        When you submit a design for a campaign, you give Truecolors an exclusive, worldwide licence to make, sell and
        promote it on clothing and related products. The licence starts when the campaign goes live and lasts while the
        campaign runs and for 24 months after a funded campaign closes, and it covers shirts already made after that.
        You may still show the design in your portfolio and on social media. If a campaign misses its goal and
        isn&rsquo;t relaunched, the licence ends when the campaign does. You also let us use your name, handle, photo
        and linked social profiles to promote your designs.
      </p>

      <h2>4. Campaigns</h2>
      <ul>
        <li>We review every design before its campaign goes live and may ask for changes or decline it.</li>
        <li>A campaign runs for up to {CAMPAIGN_DAYS} days and needs {FUNDING_GOAL} pre-orders to be printed. You can have up to {MAX_LIVE_CAMPAIGNS_PER_DESIGNER} live campaigns at a time, and a campaign that misses its goal can be relaunched once.</li>
        <li>You can enter up to {CHALLENGE_ENTRIES_PER_DESIGNER} designs in each design challenge.</li>
        <li>We set prices, production, shipping and customer service.</li>
      </ul>

      <h2>5. What you earn</h2>
      <ul>
        <li>{pct(SHARE_BPS)} of net sales of your designs, or {pct(SHARE_OWN_LINK_BPS)} on sales that come through your own share link. Net sales means the price paid for the shirt after discounts, not counting tax and shipping.</li>
        <li>Earnings count only for orders that are charged; refunded or returned orders are deducted.</li>
        <li>Earnings become payable {RETURN_WINDOW_DAYS + PAYOUT_BUFFER_DAYS} days after the shirts are delivered (the {RETURN_WINDOW_DAYS}-day return window plus {PAYOUT_BUFFER_DAYS} days) and are paid at least monthly to the PayPal account, bank account or USDC wallet you choose in the studio.</li>
        <li>You&rsquo;re responsible for your own taxes. We may ask for a tax form (for example a W-9 or W-8BEN) before paying you, and we may withhold where the law requires it.</li>
        <li>You&rsquo;re responsible for giving correct payout details. USDC payouts are final once sent to the address you gave.</li>
      </ul>

      <h2>6. Promotion</h2>
      <p>
        Share your campaigns freely, but be honest: no fake orders, votes or reviews, no paid bots and no spam. Follow
        each social network&rsquo;s rules on paid or sponsored posts. Orders or earnings gained by breaking these rules
        can be cancelled.
      </p>

      <h2>7. Problems and claims</h2>
      <p>
        If someone claims a design infringes their rights, we may pause its campaign while we look into it. If the claim
        stands because of what you submitted, you&rsquo;ll be responsible for the costs it causes us and earnings from
        that design may be withheld.
      </p>

      <h2>8. Ending this agreement</h2>
      <p>
        You can close your account at any time; live campaigns finish as planned and you&rsquo;re paid what you&rsquo;ve
        earned. We can suspend or close accounts that break this agreement. Sections 3, 5 and 7 continue after the
        agreement ends for designs already licensed.
      </p>

      <h2>9. Changes</h2>
      <p>
        If we change this agreement, we&rsquo;ll tell you and ask you to accept the new version in the studio. Changes
        don&rsquo;t affect campaigns that are already live, or earnings already made.
      </p>
    </LegalPage>
  );
}
