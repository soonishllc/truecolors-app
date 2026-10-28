"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export function ActionForm({
  action, children, className = "stack", submit, pendingText = "Working…",
}: { action: Action; children?: React.ReactNode; className?: string; submit: string; pendingText?: string }) {
  const [state, run] = useActionState(action, undefined);
  return (
    <form action={run} className={className}>
      {children}
      <Submit label={submit} pending={pendingText} />
      {state?.error && <p className="error">{state.error}</p>}
      {state?.message && <p className="good">{state.message}</p>}
      {state?.link && (
        <p className="small">Dev login link: <a href={state.link}>{state.link}</a></p>
      )}
    </form>
  );
}

function Submit({ label, pending }: { label: string; pending: string }) {
  const status = useFormStatus();
  return <button disabled={status.pending}>{status.pending ? pending : label}</button>;
}
