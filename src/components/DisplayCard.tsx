"use client";

import { useRef, useState } from "react";

// One display, the way a guest meets it: the clip rests on its first frame (UV off, the shirt grey), "Press for
// sun" plays it and it holds on the lit last frame. The render with its dimensions is a tap away under "Size".
export function DisplayCard({ name, where, image, clip, children }: {
  name: string; where: string; image: string; clip: string; children: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<"off" | "playing" | "lit">("off");
  const [view, setView] = useState<"clip" | "size">("clip");
  const press = () => {
    const v = video.current;
    if (!v) return;
    setView("clip");
    v.currentTime = 0;
    setState("playing");
    navigator.vibrate?.(10);
    v.play().catch(() => setState("off"));
  };
  return (
    <article className="display-card">
      <div className={`display-media ${view}`}>
        {/* #t=0.001 so phones show the first frame before playing. */}
        <video ref={video} src={`${clip}#t=0.001`} muted playsInline preload="metadata" onEnded={() => setState("lit")} aria-label={`${name}: a guest presses for sun`} />
        {view === "size" && <img src={image} alt={`${name} display, with its dimensions`} loading="lazy" />}
        <div className="display-tabs" role="tablist" aria-label={`${name} views`}>
          <button type="button" role="tab" aria-selected={view === "clip"} onClick={() => setView("clip")}>Display</button>
          <button type="button" role="tab" aria-selected={view === "size"} onClick={() => setView("size")}>Size</button>
        </div>
        {view === "clip" && state !== "playing" && (
          <button type="button" className="press-sun" onClick={press}>{state === "lit" ? "☀ Press again" : "☀ Press for sun"}</button>
        )}
      </div>
      <div className="display-body">
        <div className="eyebrow">{where}</div>
        <h3>{name}</h3>
        {children}
      </div>
    </article>
  );
}
