"use client";

import { useEffect, useRef, useState } from "react";

// A dark banner with a photo on the right. Given a shade and a sun version of the photo, it opens in the
// shade and the sunlight sweeps in a moment later, the way the shirts behave; the button switches back and forth.
// With a video (shade to sun in one take), the video plays instead and the button replays it or rewinds it.
export function HeroReveal({
  sun, shade, video, short, children,
}: { sun?: string; shade?: string; video?: string; short?: boolean; children: React.ReactNode }) {
  const [inSun, setInSun] = useState(!shade);
  const [motion, setMotion] = useState(false);
  const clip = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (!shade || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setInSun(true);
    setMotion(true);
    const t = setTimeout(() => setInSun(true), 900);
    return () => clearTimeout(t);
  }, [shade]);

  useEffect(() => {
    const v = clip.current;
    if (!v) return;
    v.currentTime = 0;
    if (inSun) v.play().catch(() => {});
    else v.pause();
  }, [inSun, motion]);

  const playing = Boolean(video && motion);
  const cls = ["hero", sun && "photo", short && "short"].filter(Boolean).join(" ");
  return (
    <section className={cls}>
      {sun && (
        <div className="hero-bg" aria-hidden="true">
          {playing ? (
            <video ref={clip} src={video} poster={shade} muted playsInline preload="metadata" />
          ) : (
            <>
              {shade && <img src={shade} alt="" />}
              <img src={sun} alt="" className={shade ? (inSun ? "hero-sun on" : "hero-sun") : undefined} />
            </>
          )}
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
