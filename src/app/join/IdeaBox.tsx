"use client";

import { useEffect, useRef, useState } from "react";

const KEY = "tc-join-idea";
const MAX = 600;

export const IDEA_EXAMPLES = [
  "Camel in sunglasses",
  "Dubai skyline as a postcard",
  "Turtle over a coral reef",
  "Cancún sunset with palms",
  "Your city's landmark",
  "Your pet as a superhero",
];

const remember = (idea: string) => {
  try { sessionStorage.setItem(KEY, idea); } catch { /* private mode: the URL still carries it */ }
};

// The first thing on /join: type an idea (or tap an example) and "Draw it". Signed-out people land on the sign-up
// card below with the idea kept; once they're in, it opens /studio/new with the idea already filled in.
export function IdeaBox({ initial }: { initial?: string }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const fill = (idea: string) => {
    if (!box.current) return;
    box.current.value = idea;
    box.current.focus();
  };
  return (
    <form className="idea-box" method="get" action="/join#start" onSubmit={() => remember(box.current?.value.trim() ?? "")}>
      <textarea
        id="join-idea" aria-label="Your idea" ref={box} name="idea" rows={3} maxLength={MAX} required defaultValue={initial}
        placeholder="A falcon over the dunes at sunset"
      />
      <div className="idea-chips" role="group" aria-label="Example ideas">
        {IDEA_EXAMPLES.map((idea) => (
          <button key={idea} type="button" className="chip" onClick={() => fill(idea)}>{idea}</button>
        ))}
      </div>
      <button className="button sun-button">Draw it</button>
    </form>
  );
}

// The sign-up form's way back to the idea: `next` for joinAction. The server passes the idea from the URL; after a
// Google/Apple/X/Instagram round trip the URL no longer has it, so it comes back from this tab's session storage.
export function IdeaCarry({ idea }: { idea?: string }) {
  const [kept, setKept] = useState(idea);
  useEffect(() => {
    if (idea) { remember(idea); return; }
    try { setKept(sessionStorage.getItem(KEY) || undefined); } catch { /* nothing kept */ }
  }, [idea]);
  return kept ? <input type="hidden" name="next" value={`/studio/new?idea=${encodeURIComponent(kept.slice(0, MAX))}`} /> : null;
}
