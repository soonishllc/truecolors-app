"use client";

import { useEffect, useRef, useState } from "react";
import { onViewport, type Viewport } from "./FrameBridge";

// Straight into the store's cart on the campaign's pre-order plan, then on to checkout (a cart link can't carry a
// selling plan, so it's a form post). `returnTo` is where the store goes after adding: checkout, through the
// friend's code when there is one.
export type CartPost = { action: string; sellingPlan: string; returnTo: string; ref?: string };

// The campaign's buy block: one shirt or a two-pack, pick a size, then one button straight to checkout. On phones
// a bar with the sizes and the same button stays at the bottom of the screen whenever this block isn't on screen,
// so it's a tap for the size and a tap to pre-order, including inside a store page, where the frame is as tall as
// the page and the store page does the scrolling. Without a pre-order plan on record (older campaigns) it links to
// the store's product page instead.
export function BuyBox({ href, cart, variants, sizes, price, packPrice, packSave, progress, children }: {
  href?: string; cart?: CartPost; variants?: Record<string, string> | null; sizes: readonly string[];
  price: string; packPrice?: string; packSave?: string; progress: string; children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<string>();
  const [quantity, setQuantity] = useState(1);
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
  const canBuy = Boolean(cart ? variants : href);
  const total = quantity === 2 && packPrice ? packPrice : price;
  const label = size ? `Pre-order ${quantity === 2 ? `2 × ${size}` : size} · ${total}` : `Pre-order · ${total}`;
  // No size yet: the button asks for one rather than leaving for the store.
  const pick = (e: React.SyntheticEvent) => {
    if (size) return;
    e.preventDefault();
    setNudge(false);
    requestAnimationFrame(() => setNudge(true));
  };
  const sizeButtons = (className: string) => (
    <div className={`${className}${nudge && !size ? " nudge" : ""}`} role="radiogroup" aria-label="Size">
      {sizes.map((s) => (
        <button key={s} type="button" role="radio" aria-checked={size === s} disabled={!canBuy} className={size === s ? "on" : undefined} onClick={() => { setSize(s); navigator.vibrate?.(8); }}>
          {s}
        </button>
      ))}
    </div>
  );

  const openGuide = () => {
    const guide = document.getElementById("size-guide");
    if (guide instanceof HTMLDetailsElement) guide.open = true;
  };

  return (
    <>
      <div id="buy" className="buy-box" ref={box}>
        {cart && packPrice && (
          <div className="pack-pick" role="radiogroup" aria-label="How many">
            <button type="button" role="radio" aria-checked={quantity === 1} className={quantity === 1 ? "on" : undefined} onClick={() => setQuantity(1)}>
              <b>1 shirt</b><span>{price}</span>
            </button>
            <button type="button" role="radio" aria-checked={quantity === 2} className={quantity === 2 ? "on" : undefined} onClick={() => setQuantity(2)}>
              <b>2-pack</b><span>{packPrice} · save {packSave}</span>
            </button>
          </div>
        )}
        <div className="size-row">
          {sizeButtons("size-pick")}
          <a className="small size-help" href="#size-guide" onClick={openGuide}>Size guide</a>
        </div>
        {nudge && !size && <p className="small size-ask">Pick your size first.</p>}
        {cart && variants ? (
          <form id="buy-form" method="post" action={cart.action} target="_parent" onSubmit={pick}>
            <input type="hidden" name="id" value={variant || ""} />
            <input type="hidden" name="quantity" value={quantity} />
            <input type="hidden" name="selling_plan" value={cart.sellingPlan} />
            <input type="hidden" name="return_to" value={cart.returnTo} />
            {cart.ref && <input type="hidden" name="attributes[tc_ref]" value={cart.ref} />}
            <button type="submit" className="button buy-button">{label}</button>
          </form>
        ) : to ? (
          <a className="button buy-button" href={to} onClick={pick}>{label}</a>
        ) : (
          // Only the seeded demo campaigns have no store product.
          <span className="button buy-button" aria-disabled="true">Pre-orders open soon</span>
        )}
        {quantity === 2 && <p className="small muted pack-note">Two in the same size, each with its own number. One for a friend?</p>}
      </div>
      <div className={`sticky-buy${show ? " on" : ""}${canBuy ? "" : " soon"}`} aria-hidden={!show} inert={!show}>
        <span className="small sticky-note"><b>{total}</b> · pay only if printed · {progress}{children && <> · {children}</>}</span>
        {canBuy && sizeButtons("size-pick sticky-sizes")}
        {cart && variants
          ? <button type="submit" form="buy-form" className="button">{size ? `Pre-order ${size}` : "Pre-order"}</button>
          : to
            ? <a className="button" href={to} onClick={pick}>{size ? `Pre-order ${size}` : "Pre-order"}</a>
            : <span className="button" aria-disabled="true">Pre-orders open soon</span>}
      </div>
    </>
  );
}
