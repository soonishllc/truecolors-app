"use client";

import { useEffect, useState } from "react";

// Real studio output (public/examples/gallery): the idea as it was typed, its line art and its sun colours.
const SHOW = [
  { id: "axolotl", idea: "Un ajolote bailando en la playa de Cancún: “Cancún Mi Amor”" },
  { id: "dog", idea: "My dog with his collar tag, a sun and palm leaves behind him" },
  { id: "sun-mascot", idea: "A grinning sun in sunglasses with a surfboard" },
  { id: "iguana", idea: "An iguana holding a taco beside Mayan ruins and a cenote" },
];

type Stage = "type" | "shade" | "sun";

// The Create page's hero: the studio at work, on a loop. An idea types itself in, the AI's line art draws down
// the page, then the sun sweeps across it and it turns full colour, and on to the next idea.
export function IdeaShowcase() {
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState(0);
  const [stage, setStage] = useState<Stage>("type");

  useEffect(() => {
    const idea = SHOW[i].idea;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTyped(idea.length);
      setStage("sun");
      return;
    }
    setTyped(0);
    setStage("type");
    const per = 1300 / idea.length;
    const timers = [...idea].map((_, n) => setTimeout(() => setTyped(n + 1), (n + 1) * per));
    timers.push(setTimeout(() => setStage("shade"), 1700));
    timers.push(setTimeout(() => setStage("sun"), 3400));
    timers.push(setTimeout(() => setI((i + 1) % SHOW.length), 7600));
    return () => timers.forEach(clearTimeout);
  }, [i]);

  const show = SHOW[i];
  return (
    <figure className={`showcase ${stage}`} aria-label="Ideas the studio has drawn, from text to line art to full colour">
      <div className="showcase-prompt">
        <span className="showcase-label">Idea</span>
        <p>{show.idea.slice(0, typed)}<span className="showcase-caret" aria-hidden="true" /></p>
      </div>
      <div className="showcase-art">
        {SHOW.map((x, n) => (
          <div key={x.id} className={n === i ? "showcase-pair on" : "showcase-pair"} aria-hidden={n !== i}>
            <img className="showcase-shade" src={`/examples/gallery/${x.id}-shade.webp`} alt="" decoding="async" />
            <img className="showcase-sun" src={`/examples/gallery/${x.id}-sun.webp`} alt={n === i ? x.idea : ""} decoding="async" />
          </div>
        ))}
        <span className="showcase-badge">{stage === "sun" ? "☀ In the sun" : stage === "shade" ? "☁ Line art, indoors" : "Drawing…"}</span>
      </div>
      <div className="showcase-dots" aria-hidden="true">
        {SHOW.map((x, n) => <span key={x.id} className={n === i ? "on" : undefined} />)}
      </div>
    </figure>
  );
}
