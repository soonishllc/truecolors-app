"use client";

import Link from "next/link";

// Any Studio page that fails to load: a way back, never a raw error. A finished drawing is saved before the page
// moves on, so it's waiting in the studio; a failed AI call gives its credit back.
export default function StudioError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="design-flow">
      <h1>That didn&apos;t load</h1>
      <p className="muted">
        Your designs are safe. If a drawing was finishing, it&apos;s saved in your studio; if it didn&apos;t finish, its credit
        is given back.
      </p>
      <p className="row">
        <button type="button" onClick={reset}>Try again</button>
        <Link className="button secondary" href="/studio">Go to your studio</Link>
      </p>
    </div>
  );
}
