import Link from "next/link";
import { loginAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { SocialButtons } from "@/components/SocialButtons";
import { StoreSignIn } from "@/components/StoreSignIn";
import { storeIdentity } from "@/lib/auth/session";

export const metadata = { title: "Sign in · Truecolors" };

const ERRORS: Record<string, string> = {
  expired: "That sign-in took too long. Try again.",
  failed: "Sign-in didn't work. Try again, or use your email.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const store = await storeIdentity();
  return (
    <div className="auth">
      <div className="eyebrow">Designers</div>
      <h1>{store ? "Not a designer yet" : "Log in"}</h1>
      {error && <p className="error">{ERRORS[error] ?? ERRORS.failed}</p>}
      {store ? (
        <div className="store-only stack">
          <p className="muted">
            You&apos;re signed in to the store as <strong>{store.email}</strong>, which isn&apos;t a designer account yet.
          </p>
          <Link className="button" href="/join">Start designing</Link>
        </div>
      ) : (
        <StoreSignIn back="/studio">
          <p className="muted">Designers use the same account as the Truecolors store.</p>
        </StoreSignIn>
      )}
      <div className="site-only">
      <SocialButtons verb="Continue" />
      <div className="or"><span>or use your email</span></div>
      <ActionForm action={loginAction} submit="Email me a login link">
        <label>Email<input name="email" type="email" required /></label>
      </ActionForm>
      </div>
      {!store && <p className="small muted">New here? <Link href="/join">Design your own shirt</Link>.</p>}
    </div>
  );
}
