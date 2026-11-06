import Link from "next/link";
import { redirect } from "next/navigation";
import { cancelSocialJoinAction, joinAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProviderIcon, SocialButtons } from "@/components/SocialButtons";
import { StoreSignIn } from "@/components/StoreSignIn";
import { providerLabel } from "@/lib/auth/oauth";
import { currentUser, pendingSignUp, storeIdentity } from "@/lib/auth/session";
import { publicUrl } from "@/lib/links";
import { desc, eq, inArray } from "drizzle-orm";
import { TileSweep } from "@/components/TileSweep";
import { db } from "@/lib/db/client";
import { campaigns, designs, users } from "@/lib/db/schema";
import { money } from "@/lib/format";
import { onShirts } from "@/lib/media/shots";
import { FUNDING_GOAL, PREORDER_PRICE, STARTING_CREDITS } from "@/lib/rules";
import { siteImageUrl, siteVideoUrl } from "@/lib/site-images";
import { fileUrl, thumbUrl } from "@/lib/storage";

export const metadata = { title: "Design your own shirt · Truecolors" };

// Where "Design your own" leads: what designing here is, in three animated steps, shirts the community has made,
// and one way to start. Anyone can sign up; every design is reviewed before it goes on pre-order.
export default async function Join() {
  // Already a designer: straight to a new design.
  if (await currentUser()) redirect("/studio/new");
  const via = await pendingSignUp();
  const store = via ? undefined : await storeIdentity();
  const who = via && (via.profile.username ? `@${via.profile.username}` : via.profile.name ?? via.profile.email);
  const ready = Boolean(store || via);
  const steps = [
    { id: "step-design", title: "You design it", text: "Describe an idea or snap a sketch, and the AI studio turns it into print-ready art that changes colour in the sun." },
    { id: "step-preorder", title: "Fans pre-order", text: `Shoppers pre-order it for ${money(PREORDER_PRICE.AE.cents, "AED")} in the UAE or ${money(PREORDER_PRICE.US.cents, "USD")} in the USA. Nobody is charged unless it reaches ${FUNDING_GOAL}.` },
    { id: "step-print", title: `We print at ${FUNDING_GOAL}`, text: "Funded designs are printed in Cancún and shipped, and you earn 10% of every sale, 15% through your own link.", once: true },
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
      <p><a className="button sun-button start-jump" href="#start">Start designing, free</a></p>

      {/* How it works, in three animated photos: the design, the pre-orders, the print. */}
      <div className="eyebrow">How it works</div>
      <div className="steps">
        {steps.map((st, i) => {
          const img = siteImageUrl(st.id);
          const clip = siteVideoUrl(st.id);
          return (
            <div key={st.id}>
              {clip && img && st.once ? (
                // An action shot: plays once each time it scrolls into view and holds its last frame.
                <div className="tile-art"><img className="art" src={img} alt="" /><TileSweep src={clip} inView /></div>
              ) : clip ? <video className="art" src={clip} poster={img} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" />
                : img ? <img className="art" src={img} alt="" /> : <div className="art step-fallback"><span className="sun-text">{i + 1}</span></div>}
              <h3>{i + 1}. {st.title}</h3>
              <p className="muted small">{st.text}</p>
            </div>
          );
        })}
      </div>

      {/* Shirts the community has designed: what yours could be. */}
      {samples.length > 0 && (
        <>
          <div className="eyebrow">From the community</div>
          <div className="section-head">
            <h2 style={{ marginTop: 8 }}>Shirts designed here</h2>
            <Link href="/explore" className="button small secondary">See all designs →</Link>
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

      <section className="start-card" id="start">
        <h2>Start designing</h2>
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
            <StoreSignIn back="/join#start">
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
          <ActionForm action={joinAction} submit="Start designing">
            <label>Your name, as shoppers will see it<input name="name" required autoComplete="name" defaultValue={store?.name ?? via?.profile.name} /></label>
            {!store && !via?.profile.email && (
              <label>Email<input name="email" type="email" required autoComplete="email" /></label>
            )}
            <label className="check">
              <input type="checkbox" name="agree" required />
              <span className="small">
                I accept the <a href={publicUrl("/designer-agreement")} target="_blank" rel="noreferrer">designer agreement</a> and{" "}
                <a href={publicUrl("/terms")} target="_blank" rel="noreferrer">terms</a>: I own or have the rights to what I create here,
                Truecolors gets an exclusive licence to sell it as a shirt once it launches, and I earn 10% of net sales (15% through my own link).
              </span>
            </label>
          </ActionForm>
        </div>
        <p className="small muted">Already designing with us? <Link href="/login">Log in</Link></p>
      </section>
    </div>
  );
}
