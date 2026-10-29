import Link from "next/link";
import { COMPANY, CONTACT, LEGAL_UPDATED } from "@/lib/brand";

const PAGES = [
  { href: "/terms", label: "Terms of use" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/pre-orders", label: "Pre-orders, shipping and returns" },
  { href: "/designer-agreement", label: "Designer agreement" },
];

// Shared frame for the legal pages: title, date, the operator, links between the pages, and how to reach us.
export function LegalPage({ title, updated = LEGAL_UPDATED, children }: { title: string; updated?: string; children: React.ReactNode }) {
  return (
    <article className="legal">
      <div className="eyebrow">Legal</div>
      <h1>{title}</h1>
      <p className="muted small">
        Last updated {updated} · {COMPANY.name}, {COMPANY.address}
      </p>
      {children}
      <h2>Contact</h2>
      <p>
        Questions about this page: <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a> or WhatsApp{" "}
        <a href={CONTACT.whatsapp.href}>{CONTACT.whatsapp.label}</a>.
      </p>
      <nav className="legal-nav" aria-label="Legal pages">
        {PAGES.map((p) => <Link key={p.href} href={p.href}>{p.label}</Link>)}
      </nav>
    </article>
  );
}
