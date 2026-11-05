"use client";

import { useEffect, useRef, useState } from "react";
import { onViewport, type Viewport } from "./FrameBridge";

// The campaign's buy block: pick a size, then one button straight to that size in the store's checkout. On phones
// a bar with the same button stays at the bottom of the screen whenever this block isn't on screen, including
// inside a store page, where the frame is as tall as the page and the store page does the scrolling.
export function BuyBox({ href, variants, sizes, price, progress, children }: {
  href?: string; variants?: Record<string, string> | null; sizes: readonly string[]; price: string; progress: string;
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<string>();
  const [nudge, setNudge] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Framed: the store page says which part of this page is on screen.
    if (window.self !== window.top) {
      return onViewport((vp: Viewport) => {
        const r = el.getBoundingClientRect();
        setShow(r.bottom < vp.top || r.top > vp.top + vp.height);
      });
    }
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const variant = size && variants?.[size]?.split("/").pop();
  const to = href && variant ? `${href}${href.includes("?") ? "&" : "?"}variant=${variant}` : href;
  const label = size ? `Pre-order ${size} · ${price}` : `Pre-order · ${price}`;
  // No size yet: the button asks for one rather than leaving for the store's product page.
  const pick = (e: React.MouseEvent) => {
    if (size) return;
    e.preventDefault();
    setNudge(false);
    requestAnimationFrame(() => setNudge(true));
    if (show) box.current?.scrollIntoView({ block: "center" });
  };

  const openGuide = () => {
    const guide = document.getElementById("size-guide");
    if (guide instanceof HTMLDetailsElement) guide.open = true;
  };

  return (
    <>
      <div id="buy" className="buy-box" ref={box}>
        <div className={`size-pick${nudge && !size ? " nudge" : ""}`} role="radiogroup" aria-label="Size">
          {sizes.map((s) => (
            <button key={s} type="button" role="radio" aria-checked={size === s} className={size === s ? "on" : undefined} onClick={() => setSize(s)}>
              {s}
            </button>
          ))}
          <a className="small size-help" href="#size-guide" onClick={openGuide}>Size guide</a>
        </div>
        {nudge && !size && <p className="small size-ask">Pick your size first.</p>}
        {to
          ? <a className="button buy-button" href={to} onClick={pick}>{label}</a>
          // Only the seeded demo campaigns have no store product.
          : <span className="button buy-button" aria-disabled="true">Pre-orders open soon</span>}
      </div>
      <div className={`sticky-buy${show ? " on" : ""}`} aria-hidden={!show}>
        <div>
          <strong>{size ? `${size} · ${price}` : price}</strong>
          <span className="small">{progress}{children && <> · {children}</>}</span>
        </div>
        {to
          ? <a className="button" href={size ? to : "#buy"} tabIndex={show ? 0 : -1}>{size ? "Pre-order" : "Choose size"}</a>
          : <span className="button" aria-disabled="true">Soon</span>}
      </div>
    </>
  );
}
