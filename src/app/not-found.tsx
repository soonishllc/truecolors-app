import Link from "next/link";

// Inside the store the app's own header is hidden, so a missing page offers the way back itself.
export default function NotFound() {
  return (
    <div className="auth">
      <div className="eyebrow">Not found</div>
      <h1>That page isn&apos;t here</h1>
      <p className="muted">It may have moved, or the link was mistyped.</p>
      <p className="row">
        <Link className="button" href="/explore">Community designs</Link>
        <Link className="button secondary" href="/wholesale">Wholesale</Link>
      </p>
    </div>
  );
}
