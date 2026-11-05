"use client";

import { useEffect, useState } from "react";

// The campaign's hero: the shirt as it looks indoors, then the sun sweeps across it and it turns full colour, the
// way it does when you step outside, and back again, on a loop like a short clip until the visitor takes over with
// the button. Where the design has no separate shade picture yet (`grey`), the shade side is the colour picture in
// greyscale.
export function SunReveal({ shade, sun, alt, grey = false }: { shade: string; sun: string; alt: string; grey?: boolean }) {
  const [lit, setLit] = useState(false);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setLit(true);
    if (!auto) return;
    // In the sun a little longer than indoors, so the colour is what stays in the mind.
    let t = setTimeout(function step(on = true) {
      setLit(on);
      t = setTimeout(() => step(!on), on ? 3200 : 1600);
    }, 700);
    return () => clearTimeout(t);
  }, [auto]);

  return (
    <div className={`sun-reveal${lit ? " lit" : ""}`}>
      <img className={`art${grey ? " greyed" : ""}`} src={shade} alt={`${alt}, indoors`} />
      <img className="art sun-reveal-sun" src={sun} alt={`${alt}, in the sun`} aria-hidden={!lit} />
      <span className="compare-label shade">{lit ? "☀ In the sun" : "☁ Indoors"}</span>
      <button type="button" className="sun-toggle" onClick={() => { setAuto(false); setLit(!lit); }} aria-pressed={lit}>
        {lit ? "☁ Step inside" : "☀ Step into the sun"}
      </button>
    </div>
  );
}
