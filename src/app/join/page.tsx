import Link from "next/link";
import { redirect } from "next/navigation";
import { cancelSocialJoinAction, joinAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProviderIcon, SocialButtons } from "@/components/SocialButtons";
import { StoreSignIn } from "@/components/StoreSignIn";
import { providerLabel } from "@/lib/auth/oauth";
import { currentUser, pendingSignUp, storeIdentity } from "@/lib/auth/session";
import { publicUrl, safePath } from "@/lib/links";
import { desc, eq, inArray } from "drizzle-orm";
import { TileSweep } from "@/components/TileSweep";
import { db } from "@/lib/db/client";
import { campaigns, designs, users } from "@/lib/db/schema";
import { money } from "@/lib/format";
import { onShirts } from "@/lib/media/shots";
import { CAMPAIGN_DAYS, FUNDING_GOAL, PAYOUT_BUFFER_DAYS, PREORDER_PRICE, RELAUNCHES_ALLOWED, RETURN_WINDOW_DAYS, SHARE_BPS, SHARE_OWN_LINK_BPS, STARTING_CREDITS, royaltyCents } from "@/lib/rules";
import { fileUrl, thumbUrl } from "@/lib/storage";
import { IdeaBox, IdeaCarry } from "./IdeaBox";
import { PRESETS } from "@/lib/ai/presets";
import { pendingSketchUrl } from "@/lib/design/pending-sketch";
import "./create.css";

// The example strip: a real idea, the line art the AI drew for it and its sun colours (public/examples).
const EXAMPLE = {
  idea: "An iguana holding a taco beside Mayan ruins and a cenote pool",
  lineArt: "/examples/iguana-line-art.webp",
  sun: "/examples/iguana-sun.webp",
};
const pct = (bps: number) => `${bps / 100}%`;
// "AED 1,290" rather than "AED 1,290.00" for round amounts.
const whole = (cents: number, currency: string) => money(cents, currency).replace(/\.00$/, "");

export const metadata = { title: "Design your own shirt · Truecolors" };

// Where "Design your own" leads: what designing here is, in three animated steps, shirts the community has made,
// and one way to start. Anyone can sign up; every design is reviewed before it goes on pre-order.
export default async function Join({ searchParams }: { searchParams: Promise<{ idea?: string; style?: string }> }) {
  const q = await searchParams;
  const idea = q.idea?.trim().slice(0, 600) || undefined;
  const style = PRESETS.some((p) => p.id === q.style) ? q.style : undefined;
  const sketchUrl = await pendingSketchUrl();
  // Where joining (or an existing designer) lands: a new design, with the idea typed here already in it.
  const carry = new URLSearchParams();
  if (idea) carry.set("idea", idea);
  if (style) carry.set("style", style);
  const next = safePath(carry.size ? `/studio/new?${carry}` : "/studio/new", "/studio/new");
  // Already a designer: straight to a new design.
  if (await currentUser()) redirect(next);
  const via = await pendingSignUp();
  const store = via ? undefined : await storeIdentity();
  const who = via && (via.profile.username ? `@${via.profile.username}` : via.profile.name ?? via.profile.email);
  const ready = Boolean(store || via);
  // The designer's side of it, from idea to getting paid (the community home shows the shopper's side in photos).
  const journey = [
    { title: "Describe it or sketch it", text: `Type an idea or snap a drawing and pick a style. The AI draws it as line art in about a minute. You start with ${STARTING_CREDITS} free credits; each drawing or colouring uses one.` },
    { title: "Make it yours", text: "Ask for changes in plain words, choose the sun's colours, and drag the sun across it to see the shirt in shade and in sun. We check every design prints cleanly." },
    { title: "Launch and share", text: `We review it, then it goes on pre-order for ${CAMPAIGN_DAYS} days with its own page, mockups and a reveal video to post. Nobody pays unless ${FUNDING_GOAL} people pre-order.` },
    { title: "Get paid", text: `At ${FUNDING_GOAL} it's printed in Cancún and shipped. You earn ${pct(SHARE_BPS)} of every sale, ${pct(SHARE_OWN_LINK_BPS)} through your own link, paid by PayPal, bank transfer or USDC.` },
  ];
  // The worked example: a design that just reaches its goal in the UAE store, at the pre-order price.
  const aed = PREORDER_PRICE.AE;
  const sales = aed.cents * FUNDING_GOAL;
  const earn = whole(royaltyCents(sales, SHARE_BPS), aed.currency);
  const earnOwn = whole(royaltyCents(sales, SHARE_OWN_LINK_BPS), aed.currency);
  const faq = [
    { q: "Who owns the design?", a: `You do. You confirm you own or have the rights to what you create here, and Truecolors gets an exclusive licence to sell it as a shirt once it launches. You keep the credit: your name is on the shirt's page.` },
    { q: "What does it cost?", a: `Nothing. You start with ${STARTING_CREDITS} free credits, about ${Math.floor(STARTING_CREDITS / 3)} designs, and no card. Launching a pre-order is free too: we print, ship and handle returns.` },
    { q: `What if it doesn't reach ${FUNDING_GOAL}?`, a: `Nobody is charged and nothing is printed. A pre-order runs ${CAMPAIGN_DAYS} days; if it ends short, you can refine the design and relaunch it ${RELAUNCHES_ALLOWED === 1 ? "once" : `${RELAUNCHES_ALLOWED} times`}.` },
    { q: "How do I get paid?", a: `You earn ${pct(SHARE_BPS)} of net sales, ${pct(SHARE_OWN_LINK_BPS)} on pre-orders through your own link. Earnings are paid out once the ${RETURN_WINDOW_DAYS}-day return window and a ${PAYOUT_BUFFER_DAYS}-day buffer have passed, to the payout method you add in your studio.` },
    { q: "What can't I design?", a: "No brands, logos, celebrities, real people or political figures, and nothing you don't have the rights to. Every design is reviewed before it goes on pre-order." },
  ];
  const d = await db();
  const samples = await onShirts(await d
    .select({ c: campaigns, name: users.name, art: designs.compositeKey, lineArt: designs.lineArtKey })
    .from(campaigns)
    .innerJoin(users, eq(users.id, campaigns.userId))
    .innerJoin(designs, eq(designs.id, campaigns.designId))
    .where(inArray(campaigns.status, ["live", "funded", "in_production", "shipped"]))
    .orderBy(desc(campaigns.startsAt))
    .limit(6), (x) => x.c.designId);
  return (
    <div className="design-own">
      <div className="eyebrow">Design your own</div>
      <h1>Your idea, on a shirt that changes in the sun</h1>
      <p className="lede">
        Describe it, or snap a sketch. Our AI draws it as print-ready line art and colours it for the sun. If {FUNDING_GOAL} people
        pre-order it, we print it, and you earn on every sale.
      </p>
      <IdeaBox initial={idea} initialStyle={style} styles={PRESETS.map(({ id, label, hint, group }) => ({ id, label, hint, group }))} sketchUrl={sketchUrl} />

      {/* What the AI actually makes, before anyone signs up: an idea, its line art, its sun colours. */}
      <section className="ai-strip" aria-labelledby="ai-strip-h">
        <div className="eyebrow">See what the AI makes</div>
        <h2 id="ai-strip-h">One sentence in, a shirt that changes in the sun out</h2>
        <ol className="ai-panels">
          <li className="ai-panel ai-idea">
            <span className="ai-step">1 · Your idea</span>
            <blockquote>&ldquo;{EXAMPLE.idea}&rdquo;</blockquote>
          </li>
          <li className="ai-panel">
            <span className="ai-step">2 · Line art, in the shade</span>
            <img src={EXAMPLE.lineArt} alt="The AI's black line art of the iguana" width={900} height={900} loading="lazy" decoding="async" />
          </li>
          <li className="ai-panel">
            <span className="ai-step">3 · Full colour, in the sun</span>
            <img src={EXAMPLE.sun} alt="The same iguana in full colour, as it looks in the sun" width={900} height={900} loading="lazy" decoding="async" />
          </li>
        </ol>
      </section>

      {/* What a designer earns, worked out from the real price and rates. */}
      <section className="earn-card" aria-labelledby="earn-h">
        <div className="eyebrow">What you earn</div>
        <h2 id="earn-h">{FUNDING_GOAL} shirts pre-ordered = <span className="sun-text">{earn}</span> to you</h2>
        <p>
          At the {whole(aed.cents, aed.currency)} pre-order price you earn {pct(SHARE_BPS)} of every sale: {earn} when {FUNDING_GOAL} people back it.
          Sell them through your own link and it&apos;s {pct(SHARE_OWN_LINK_BPS)}, <b>{earnOwn}</b>. Every shirt after the goal earns the same again.
        </p>
        <p className="small muted">Worked out on the UAE price before discounts; USA sales earn the same rates in dollars.</p>
      </section>

      {/* The designer's journey in four steps (not the community home's photo tiles). */}
      <section className="journey" aria-labelledby="journey-h">
        <div className="eyebrow">From idea to income</div>
        <h2 id="journey-h">How designing here works</h2>
        <ol className="journey-steps">
          {journey.map((st) => (
            <li key={st.title}>
              <b>{st.title}</b>
              <span>{st.text}</span>
            </li>
          ))}
        </ol>
      </section>

      {/* Shirts the community has designed: what yours could be. */}
      {samples.length > 0 && (
        <>
          <div className="eyebrow">From the community</div>
          <div className="section-head">
            <h2 style={{ marginTop: 8 }}>Shirts designed here</h2>
            <Link href="/designs" className="button small secondary">See all designs →</Link>
          </div>
          <div className="grid home-grid">
            {samples.map(({ c, name, art, lineArt, sweep }) => (
              <Link key={c.id} href={`/c/${c.slug}`} className="tile">
                {art && (
                  <div className="tile-art">
                    {lineArt && <img className="art" src={thumbUrl(lineArt, 640)} alt="" loading="lazy" decoding="async" />}
                    <img className="art tile-sun" src={thumbUrl(art, 640)} alt="" loading="lazy" decoding="async" />
                    {sweep && <TileSweep src={fileUrl(sweep)} />}
                  </div>
                )}
                <div>
                  <div className="name">{c.title}</div>
                  <div className="meta">by {name}</div>
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      <section className="join-faq" aria-labelledby="faq-h">
        <div className="eyebrow">Questions</div>
        <h2 id="faq-h">Before you start</h2>
        {faq.map((f) => (
          <details key={f.q}>
            <summary>{f.q}</summary>
            <p>{f.a}</p>
          </details>
        ))}
      </section>

      <section className="start-card" id="start">
        <h2>Start designing</h2>
        {idea && <p className="idea-kept">Your idea is saved: <q>{idea}</q> We&apos;ll draw it as soon as you&apos;re in.</p>}
        <p className="muted small">Free to start: {STARTING_CREDITS} credits, about {Math.floor(STARTING_CREDITS / 3)} designs. No card needed.</p>
        {store && <p className="small">Signed in as <strong>{store.email}</strong>.</p>}
        {via && (
          <form action={cancelSocialJoinAction} className="connected-as">
            <ProviderIcon provider={via.provider} />
            <span>Signed in with {providerLabel(via.provider)}{who && <> as <strong>{who}</strong></>}</span>
            <button className="link">Use something else</button>
          </form>
        )}
        {!ready && (
          <>
            <StoreSignIn back={idea ? `/join?idea=${encodeURIComponent(idea)}#start` : "/join#start"}>
              <p className="small muted">Use your Truecolors store account. New here? You can create one on the next screen.</p>
            </StoreSignIn>
            <div className="site-only">
              <SocialButtons verb="Sign up" />
              <div className="or"><span>or sign up with your email</span></div>
            </div>
          </>
        )}
        {/* Inside the store, a guest signs in to the store first and then sees this form. */}
        <div className={ready ? undefined : "site-only"}>
          <ActionForm action={joinAction} submit={idea ? "Sign up and draw it" : "Start designing"}>
            <IdeaCarry idea={idea} style={style} />
            <label>Your name, as shoppers will see it<input name="name" required autoComplete="name" defaultValue={store?.name ?? via?.profile.name} /></label>
            {!store && !via?.profile.email && (
              <label>Email<input name="email" type="email" required autoComplete="email" /></label>
            )}
            <label className="check">
              <input type="checkbox" name="agree" required />
              <span className="small">
                I accept the <a href={publicUrl("/designer-agreement")} target="_blank" rel="noreferrer">designer agreement</a> and{" "}
                <a href={publicUrl("/terms")} target="_blank" rel="noreferrer">terms</a>: I own or have the rights to what I create here,
                Truecolors gets an exclusive licence to sell it as a shirt once it launches, and I earn {pct(SHARE_BPS)} of net sales ({pct(SHARE_OWN_LINK_BPS)} through my own link).
              </span>
            </label>
          </ActionForm>
        </div>
        <p className="small muted">Already designing with us? <Link href="/login">Log in</Link></p>
      </section>
    </div>
  );
}
