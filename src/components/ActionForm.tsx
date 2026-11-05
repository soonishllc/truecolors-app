"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { FormState } from "@/app/actions";

type Action = (state: FormState, form: FormData) => Promise<FormState>;

// `busy`: for slow jobs (the AI drawing), a card in the middle of the screen while it runs, so the wait is visible
// wherever the button was.
export function ActionForm({
  action, children, className = "stack", submit, pendingText = "Working…", busy,
}: { action: Action; children?: React.ReactNode; className?: string; submit: string; pendingText?: string; busy?: string }) {
  const [state, run] = useActionState(action, undefined);
  return (
    <form action={run} className={className}>
      {children}
      <Submit label={submit} pending={pendingText} busy={busy} />
      {state?.error && <p className="error">{state.error}</p>}
      {state?.message && <p className="good">{state.message}</p>}
      {state?.link && (
        <p className="small">Dev login link: <a href={state.link}>{state.link}</a></p>
      )}
    </form>
  );
}

function Submit({ label, pending, busy }: { label: string; pending: string; busy?: string }) {
  const status = useFormStatus();
  return (
    <>
      <button disabled={status.pending}>{status.pending ? pending : label}</button>
      {busy && status.pending && (
        <div className="busy-screen" role="status" aria-live="polite">
          <div className="busy-card">
            <span className="busy-sun" aria-hidden="true" />
            <b>{busy}</b>
            <span className="small muted">Usually under a minute. Keep this page open: it moves on by itself.</span>
          </div>
        </div>
      )}
    </>
  );
}
