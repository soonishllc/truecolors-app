import Link from "next/link";
import { loginAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";
import { SocialButtons } from "@/components/SocialButtons";

const ERRORS: Record<string, string> = {
  expired: "That sign-in took too long. Try again.",
  failed: "Sign-in didn't work. Try again, or use your email.",
};

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="auth">
      <div className="eyebrow">Designers</div>
      <h1>Log in</h1>
      {error && <p className="error">{ERRORS[error] ?? ERRORS.failed}</p>}
      <SocialButtons verb="Continue" />
      <div className="or"><span>or use your email</span></div>
      <ActionForm action={loginAction} submit="Email me a login link">
        <label>Email<input name="email" type="email" required /></label>
      </ActionForm>
      <p className="small muted">New here? <Link href="/join">Join with your invite code</Link>.</p>
    </div>
  );
}
