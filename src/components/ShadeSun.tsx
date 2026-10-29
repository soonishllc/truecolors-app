"use client";

import { useState } from "react";

// Shows one design both ways: drag the handle to move the sunlight across it. The sun side is on the left.
export function ShadeSun({ shade, sun, alt }: { shade: string; sun: string; alt: string }) {
  const [pos, setPos] = useState(50);
  return (
    <div className="compare" style={{ "--pos": `${pos}%` } as React.CSSProperties}>
      <img className="art" src={shade} alt={`${alt}, in the shade`} />
      <img className="art compare-sun" src={sun} alt={`${alt}, in the sun`} />
      <div className="compare-handle" aria-hidden="true"><span>☀</span></div>
      <span className="compare-label sun">☀ Sun</span>
      <span className="compare-label shade">☁ Shade</span>
      <input
        type="range" min={0} max={100} value={pos} aria-label="Move the sunlight across the design"
        onChange={(e) => setPos(Number(e.target.value))}
      />
    </div>
  );
}
