"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Inside the store, under its header: the community's pages, one tap apart, whichever one you're on (a design's
// own page included, so the platform never disappears). The store's menu has Shop, Design and Wholesale; this is
// what's inside Design and Wholesale.
export function AppNav({ designer }: { designer: boolean }) {
  const path = usePathname();
  // The team's admin and the local demo's own pages aren't store pages.
  if (/^\/(admin|app|dev)(\/|$)/.test(path)) return null;
  const link = (i: { href: string; label: string; on: boolean; cls?: string }) => (
    <Link key={i.href} href={i.href} className={i.cls} aria-current={i.on ? "page" : undefined}>{i.label}</Link>
  );
  // Wholesale has its own menu: retailers aren't here for community designs.
  if (path.startsWith("/wholesale")) {
    return (
      <nav className="app-nav store-only on-wholesale" aria-label="Wholesale">
        {[
          { href: "/wholesale/displays", label: "Displays", on: path === "/wholesale/displays" },
          { href: "/wholesale", label: "Wholesale portal", on: path === "/wholesale" || path.startsWith("/wholesale/order") },
        ].map(link)}
      </nav>
    );
  }
  // The community's own menu: its home, every design, challenges, the people making them, and making your own
  // (the Studio once you design). Your pre-orders sit at the end as "You". Wholesale has its own menu above.
  const items = [
    { href: "/explore", label: "Home", on: path === "/explore" },
    { href: "/designs", label: "Designs", on: path === "/designs" || path.startsWith("/c/") },
    { href: "/challenges", label: "Challenges", on: path.startsWith("/challenges") },
    { href: "/designers", label: "Designers", on: path === "/designers" || path.startsWith("/d/") },
    designer
      ? { href: "/studio", label: "Studio", on: path.startsWith("/studio"), cls: "nav-design" }
      : { href: "/join", label: "Create", on: path === "/join" || path === "/login", cls: "nav-design" },
  ];
  return (
    <nav className="app-nav store-only" aria-label="Truecolors">
      {items.map(link)}
      <span className="app-nav-more">
        <Link href="/me" className="nav-you" aria-current={path === "/me" ? "page" : undefined} aria-label="You: your pre-orders and friend link">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          <span>You</span>
        </Link>
      </span>
    </nav>
  );
}
