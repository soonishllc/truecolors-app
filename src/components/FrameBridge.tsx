"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { appPathFor } from "@/lib/proxy/paths";

// Inside a store page (see lib/proxy/shell.ts): tells the store page how tall this page is and which page it's
// on, so the frame fits and the store's address follows, and opens links that leave the app (the store's own
// pages, checkout) in the whole window instead of the frame. The frame is as tall as its page and never
// scrolls, so jumping to a section (#new, #designs) scrolls the store page instead.
// `stores` are the store's own addresses (www, bare domain, myshopify), the only pages that may frame the app.
export function FrameBridge({ stores }: { stores: string[] }) {
  const path = usePathname();
  const search = useSearchParams();

  useEffect(() => {
    if (window.self === window.top) return;
    const send = sender(stores);
    // A page that isn't one of the store's sections (the old standalone home, say): back to the design home. The
    // team's admin and the local demo's own pages (/app, /dev) can be framed by the demo and are left alone.
    if (!appPathFor(path.replace(/^\//, "")) && !/^\/(admin|app|dev)(\/|$)/.test(path)) return void location.replace("/explore");
    if (appPathFor(path.replace(/^\//, ""))) document.documentElement.classList.add("in-store-frame");
    // The store page's sign-in hand-off had expired (an old page from the back button): it fetches a fresh one.
    if (search.get("signin") === "expired") return void send({ reload: true });
    send({
      path, search: ownSearch(search), hash: location.hash, top: !location.hash,
      title: document.title.replace(/\s*·\s*Truecolors$/, ""),
    });
    // Rounded up, so the frame never has a fraction to scroll and doesn't catch the mouse wheel.
    const measure = () => send({ height: Math.ceil(document.documentElement.getBoundingClientRect().height) + 1 });
    // Sent again once everything has loaded, since the store page may still be settling the first time.
    const timers = [50, 600].map((ms) => setTimeout(() => toAnchor(send), ms));
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    measure();
    return () => {
      ro.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [path, search, stores]);

  useEffect(() => {
    if (window.self === window.top) return;
    const send = sender(stores);
    const click = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.href) return;
      const to = new URL(a.href, location.href);
      // Leaving the app (the store's own pages, checkout): the store page around it, unless it opens a new tab.
      // The parent rather than the top window, so the local phone preview keeps its frame.
      if (to.origin !== location.origin) {
        if (!a.target) a.target = "_parent";
      }
      // A link to a section of this page: the frame can't scroll to it, so the store page does.
      else if (to.hash && to.pathname === location.pathname && to.search === location.search) {
        e.preventDefault();
        history.replaceState(null, "", to.hash);
        toAnchor(send);
        send({ path, search: ownSearch(new URLSearchParams(location.search)), hash: to.hash });
      }
    };
    const hashchange = () => toAnchor(send);
    document.addEventListener("click", click, true);
    window.addEventListener("hashchange", hashchange);
    return () => {
      document.removeEventListener("click", click, true);
      window.removeEventListener("hashchange", hashchange);
    };
  }, [path, stores]);

  return null;
}

// Messages go only to the store page framing this one.
function sender(stores: string[]) {
  const parent = [location.ancestorOrigins?.[0], document.referrer && new URL(document.referrer).origin].find((o) => o && stores.includes(o));
  return (extra: object) => window.parent.postMessage({ type: "tc-frame", ...extra }, parent ?? stores[0]);
}

// The page's query without what the store page added for it.
function ownSearch(search: URLSearchParams) {
  const q = new URLSearchParams(search);
  q.delete("market");
  q.delete("signin");
  return q.size ? `?${q}` : "";
}

function toAnchor(send: (extra: object) => void) {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (target) send({ scrollTo: target.getBoundingClientRect().top + window.scrollY });
}
