import { joinAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export default function Join() {
  return (
    <>
      <h1>Join the studio</h1>
      <p className="muted">The studio is invite-only while we launch. Enter the code Truecolors sent you.</p>
      <ActionForm action={joinAction} submit="Create account">
        <label>Invite code<input name="invite" required autoComplete="off" /></label>
        <label>Name<input name="name" required /></label>
        <label>Email<input name="email" type="email" required /></label>
        <label className="check">
          <input type="checkbox" name="agree" />
          <span>
            I accept the designer agreement: I own or have the rights to what I create here, Truecolors gets an
            exclusive licence to sell it as a shirt, and I earn 10% of net sales (15% through my own link).
          </span>
        </label>
      </ActionForm>
    </>
  );
}
