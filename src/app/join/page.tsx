import Link from "next/link";
import { cancelSocialJoinAction, joinAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProviderIcon, SocialButtons } from "@/components/SocialButtons";
import { StoreSignIn } from "@/components/StoreSignIn";
import { redirect } from "next/navigation";
import { currentUser, pendingSignUp, storeIdentity } from "@/lib/auth/session";
import { publicUrl } from "@/lib/links";
import { providerLabel } from "@/lib/auth/oauth";

export const metadata = { title: "Join the studio · Truecolors" };

export default async function Join() {
  // Already a designer: straight to the studio.
  if (await currentUser()) redirect("/studio");
  const via = await pendingSignUp();
  const store = via ? undefined : await storeIdentity();
  const who = via && (via.profile.username ? `@${via.profile.username}` : via.profile.name ?? via.profile.email);
  return (
    <div className="auth">
      <div className="eyebrow">Invite only</div>
      <h1>Join the studio</h1>
      <p className="muted">The studio is invite-only while we launch. Enter the code Truecolors sent you.</p>
      {store ? (
        <p className="muted">Joining with your Truecolors account, <strong>{store.email}</strong>.</p>
      ) : (
        <StoreSignIn back="/join">
          <p className="muted">Sign in to the store first: your studio uses the same Truecolors account.</p>
        </StoreSignIn>
      )}
      {store ? null : via ? (
        <form action={cancelSocialJoinAction} className="connected-as">
          <ProviderIcon provider={via.provider} />
          <span>Signed in with {providerLabel(via.provider)}{who && <> as <strong>{who}</strong></>}</span>
          <button className="link">Use something else</button>
        </form>
      ) : (
        <div className="site-only">
          <SocialButtons verb="Sign up" />
          <div className="or"><span>or sign up with your email</span></div>
        </div>
      )}
      {/* Inside the store, a guest signs in to the store first and then sees this form. */}
      <div className={store || via ? undefined : "site-only"}>
        <ActionForm action={joinAction} submit="Create account">
          <label>Invite code<input name="invite" required autoComplete="off" /></label>
          <label>Name<input name="name" required defaultValue={store?.name ?? via?.profile.name} /></label>
          {!store && !via?.profile.email && (
            <label>Email<input name="email" type="email" required />{via && <span className="small muted">For payouts and campaign news.</span>}</label>
          )}
          <label className="check">
            <input type="checkbox" name="agree" />
            <span>
              I accept the <a href={publicUrl("/designer-agreement")} target="_blank" rel="noreferrer">designer agreement</a> and{" "}
              <a href={publicUrl("/terms")} target="_blank" rel="noreferrer">terms of use</a>: I own or have the rights to what I create here,
              Truecolors gets an exclusive licence to sell it as a shirt, and I earn 10% of net sales (15% through my own
              link).
            </span>
          </label>
        </ActionForm>
      </div>
    </div>
  );
}
