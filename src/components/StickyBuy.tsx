"use client";

import { useEffect, useState } from "react";

// Phones only (hidden by CSS on wider screens): a bar pinned to the bottom with the pre-order button, shown once
// the page's own button has scrolled out of view, so shoppers arriving from a shared link can always buy.
export function StickyBuy({ watch, href, price, progress, children }: {
  watch: string; href?: string; price: string; progress: string; children?: React.ReactNode;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = document.getElementById(watch);
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting && e.boundingClientRect.top < 0));
    io.observe(el);
    return () => io.disconnect();
  }, [watch]);

  return (
    <div className={`sticky-buy${show ? " on" : ""}`} aria-hidden={!show}>
      <div>
        <strong>{price}</strong>
        <span className="small">{progress}{children && <> · {children}</>}</span>
      </div>
      {href
        ? <a className="button" href={href} tabIndex={show ? 0 : -1}>Pre-order</a>
        : <span className="button" aria-disabled="true">Pre-order</span>}
    </div>
  );
}
