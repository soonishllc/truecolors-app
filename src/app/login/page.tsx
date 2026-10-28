import { loginAction } from "@/app/actions";
import { ActionForm } from "@/components/ActionForm";

export default function Login() {
  return (
    <>
      <h1>Log in</h1>
      <ActionForm action={loginAction} submit="Email me a login link">
        <label>Email<input name="email" type="email" required /></label>
      </ActionForm>
    </>
  );
}
