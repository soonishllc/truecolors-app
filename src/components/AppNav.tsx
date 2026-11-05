"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Inside the store, under its header: the app's own pages, one tap apart, whichever one you're on. The store's
// menu has Shop, Design and Wholesale; this is what's inside Design and Wholesale.
export function AppNav({ designer }: { designer: boolean }) {
  const path = usePathname();
  // The team's admin and the local demo's own pages aren't store pages.
  if (/^\/(admin|app|dev)(\/|$)/.test(path)) return null;
  // On a design's own page, the shopper is deciding: one way back, nothing else to wander off to.
  if (path.startsWith("/c/")) {
    return (
      <nav className="app-nav app-nav-back store-only" aria-label="Truecolors">
        <Link href="/explore">← All designs</Link>
      </nav>
    );
  }
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
  // The two things people come for, browsing and designing, side by side; wholesale, which most don't need, apart
  // at the end.
  const shop = [
    { href: "/explore", label: "Designs", on: path === "/explore" || path.startsWith("/c/") || path.startsWith("/d/") },
    designer
      ? { href: "/studio", label: "Studio", on: path.startsWith("/studio") }
      : { href: "/join", label: "Design your own", on: path === "/join" || path === "/login", cls: "nav-design" },
    { href: "/challenges", label: "Challenges", on: path.startsWith("/challenges") },
    { href: "/me", label: "My pre-orders", on: path === "/me" },
  ];
  const more = [{ href: "/wholesale", label: "Wholesale portal", on: false }];
  return (
    <nav className="app-nav store-only" aria-label="Truecolors">
      {shop.map(link)}
      <span className="app-nav-more">{more.map(link)}</span>
    </nav>
  );
}
