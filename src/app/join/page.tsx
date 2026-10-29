import Link from "next/link";
import { cancelSocialJoinAction, joinAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { ProviderIcon, SocialButtons } from "@/components/SocialButtons";
import { pendingSignUp } from "@/lib/auth/session";
import { providerLabel } from "@/lib/auth/oauth";

export default async function Join() {
  const via = await pendingSignUp();
  const who = via && (via.profile.username ? `@${via.profile.username}` : via.profile.name ?? via.profile.email);
  return (
    <div className="auth">
      <div className="eyebrow">Invite only</div>
      <h1>Join the studio</h1>
      <p className="muted">The studio is invite-only while we launch. Enter the code Truecolors sent you.</p>
      {via ? (
        <form action={cancelSocialJoinAction} className="connected-as">
          <ProviderIcon provider={via.provider} />
          <span>Signed in with {providerLabel(via.provider)}{who && <> as <strong>{who}</strong></>}</span>
          <button className="link">Use something else</button>
        </form>
      ) : (
        <>
          <SocialButtons verb="Sign up" />
          <div className="or"><span>or sign up with your email</span></div>
        </>
      )}
      <ActionForm action={joinAction} submit="Create account">
        <label>Invite code<input name="invite" required autoComplete="off" /></label>
        <label>Name<input name="name" required defaultValue={via?.profile.name} /></label>
        {!via?.profile.email && (
          <label>Email<input name="email" type="email" required />{via && <span className="small muted">For payouts and campaign news.</span>}</label>
        )}
        <label className="check">
          <input type="checkbox" name="agree" />
          <span>
            I accept the <Link href="/designer-agreement" target="_blank">designer agreement</Link> and{" "}
            <Link href="/terms" target="_blank">terms of use</Link>: I own or have the rights to what I create here,
            Truecolors gets an exclusive licence to sell it as a shirt, and I earn 10% of net sales (15% through my own
            link).
          </span>
        </label>
      </ActionForm>
    </div>
  );
}
