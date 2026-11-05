"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Inside the store, under its header: the app's own pages, one tap apart, whichever one you're on. The store's
// menu has Shop, Design and Wholesale; this is what's inside Design and Wholesale.
export function AppNav({ designer }: { designer: boolean }) {
  const path = usePathname();
  // The team's admin and the local demo's own pages aren't store pages.
  if (/^\/(admin|app|dev)(\/|$)/.test(path)) return null;
  const link = (i: { href: string; label: string; on: boolean }) => (
    <Link key={i.href} href={i.href} aria-current={i.on ? "page" : undefined}>{i.label}</Link>
  );
  // Shopping first; making designs and wholesale, which most shoppers don't need, sit apart at the end.
  const shop = [
    { href: "/explore", label: "Community designs", on: path === "/explore" || path.startsWith("/c/") || path.startsWith("/d/") },
    { href: "/challenges", label: "Challenges", on: path.startsWith("/challenges") },
    { href: "/me", label: "My pre-orders", on: path === "/me" },
  ];
  const more = [
    designer
      ? { href: "/studio", label: "Studio", on: path.startsWith("/studio") }
      : { href: "/join", label: "Become a designer", on: path === "/join" || path === "/login" },
    { href: "/wholesale", label: "Wholesale", on: path.startsWith("/wholesale") },
  ];
  return (
    <nav className="app-nav store-only" aria-label="Truecolors">
      {shop.map(link)}
      <span className="app-nav-more">{more.map(link)}</span>
    </nav>
  );
}
