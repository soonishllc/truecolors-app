"use client";

import { useEffect, useRef, useState } from "react";

// The sun-sweep clip over a design tile: plays once on hover (or when scrolled into view on touch screens, or always
// with inView) and holds on its last, full-colour frame. Starts with no video loaded, so a grid of tiles costs
// nothing until used.
export function TileSweep({ src, inView = false }: { src: string; inView?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const video = ref.current;
    // Hovering anywhere on the card plays it, not just the picture.
    const tile = video?.closest("a") ?? video?.closest("article, li, .tile-art");
    if (!video || !tile || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const play = () => {
      if (!video.src) video.src = src;
      video.currentTime = 0;
      video.play().then(() => setOn(true)).catch(() => {});
    };
    const stop = () => {
      video.pause();
      setOn(false);
    };
    if (!inView && matchMedia("(hover: hover)").matches) {
      tile.addEventListener("mouseenter", play);
      tile.addEventListener("mouseleave", stop);
      return () => {
        tile.removeEventListener("mouseenter", play);
        tile.removeEventListener("mouseleave", stop);
      };
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? play() : stop()), { threshold: 0.6 });
    io.observe(video);
    return () => io.disconnect();
  }, [src, inView]);

  return <video ref={ref} className={`tile-sweep${on ? " on" : ""}`} muted playsInline preload="none" aria-hidden="true" />;
}
