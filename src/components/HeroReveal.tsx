"use client";

import { useEffect, useState } from "react";

// A dark banner with a photo on the right. Given a shade and a sun version of the photo, it opens in the
// shade and the sunlight sweeps in a moment later, the way the shirts behave; the button switches back and forth.
export function HeroReveal({
  sun, shade, short, children,
}: { sun?: string; shade?: string; short?: boolean; children: React.ReactNode }) {
  const [inSun, setInSun] = useState(!shade);
  useEffect(() => {
    if (!shade || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setInSun(true);
    const t = setTimeout(() => setInSun(true), 900);
    return () => clearTimeout(t);
  }, [shade]);

  const cls = ["hero", sun && "photo", short && "short"].filter(Boolean).join(" ");
  return (
    <section className={cls}>
      {sun && (
        <div className="hero-bg" aria-hidden="true">
          {shade && <img src={shade} alt="" />}
          <img src={sun} alt="" className={shade ? (inSun ? "hero-sun on" : "hero-sun") : undefined} />
        </div>
      )}
      <div className="hero-content">
        {children}
        {sun && shade && (
          <button type="button" className="sun-toggle" onClick={() => setInSun(!inSun)} aria-pressed={inSun}>
            {inSun ? "☁ Back to the shade" : "☀ Step into the sun"}
          </button>
        )}
      </div>
    </section>
  );
}
