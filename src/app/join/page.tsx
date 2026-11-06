import Link from "next/link";
import { redirect } from "next/navigation";
import { cancelSocialJoinAction, joinAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProviderIcon, SocialButtons } from "@/components/SocialButtons";
import { StoreSignIn } from "@/components/StoreSignIn";
import { providerLabel } from "@/lib/auth/oauth";
import { currentUser, pendingSignUp, storeIdentity } from "@/lib/auth/session";
import { publicUrl } from "@/lib/links";
import { FUNDING_GOAL, STARTING_CREDITS } from "@/lib/rules";

export const metadata = { title: "Design your own shirt · Truecolors" };

// Where "Design your own" leads: what designing here is, in four steps, and one way to start. Anyone can sign up;
// every design is reviewed before it goes on pre-order.
export default async function Join() {
  // Already a designer: straight to a new design.
  if (await currentUser()) redirect("/studio/new");
  const via = await pendingSignUp();
  const store = via ? undefined : await storeIdentity();
  const who = via && (via.profile.username ? `@${via.profile.username}` : via.profile.name ?? via.profile.email);
  const ready = Boolean(store || via);
  return (
    <div className="design-own">
      <div className="eyebrow">Design your own</div>
      <h1>Your idea, on a shirt that changes in the sun</h1>
      <p className="lede">
        Describe it, or snap a sketch. Our AI draws it as print-ready line art and colours it for the sun. If {FUNDING_GOAL} people
        pre-order it, we print it, and you earn on every sale.
      </p>
      <p><a className="button sun-button start-jump" href="#start">Start designing, free</a></p>

      {/* Designing, not wearing: a sketch, the AI's line art on the laptop, and the printed shirt (the Designs page's
          hero shows the shirt in the sun). */}
      <div className="design-own-art">
        <video src="/site/step-design.mp4" poster="/site/step-design.webp" autoPlay muted loop playsInline preload="metadata"
          aria-label="A sketch of a falcon, the AI's line art of it on a laptop, and the printed shirt" />
      </div>

      <ol className="how-steps">
        <li><b>Describe your idea</b><span>A place, a joke, a memory. Add a sketch if you have one.</span></li>
        <li><b>The AI draws it</b><span>Clean line art that shows in the shade. Ask for changes in plain words.</span></li>
        <li><b>Colour it for the sun</b><span>See the colours appear, plus mockups and a reveal video to share.</span></li>
        <li><b>Launch and earn</b><span>We review it, then it goes on pre-order. You earn 10% of sales, 15% through your own link.</span></li>
      </ol>

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
