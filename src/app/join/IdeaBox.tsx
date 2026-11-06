"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SketchPicker } from "@/components/SketchPicker";
import { startIdeaAction, type IdeaState } from "./actions";

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

type Style = { id: string; label: string; hint: string; group: string };

// The first thing on /join: type an idea (or tap an example), pick a style, add a sketch if there is one, and
// "Draw it". Signed-out people land on the sign-up card below with all of it kept; once they're in, it opens
// /studio/new with everything already filled in.
export function IdeaBox({ initial, initialStyle, styles, sketchUrl }: {
  initial?: string; initialStyle?: string; styles: Style[]; sketchUrl?: string;
}) {
  const box = useRef<HTMLTextAreaElement>(null);
  const [state, action, pending] = useActionState<IdeaState, FormData>(startIdeaAction, undefined);
  const fill = (idea: string) => {
    if (!box.current) return;
    box.current.value = idea;
    box.current.focus();
  };
  const groups = [...new Set(styles.map((st) => st.group))];
  return (
    <form className="idea-box" action={action} onSubmit={() => remember(box.current?.value.trim() ?? "")}>
      <textarea
        id="join-idea" aria-label="Your idea" ref={box} name="idea" rows={3} maxLength={MAX} defaultValue={initial}
        placeholder="A falcon over the dunes at sunset"
      />
      <div className="idea-chips" role="group" aria-label="Example ideas">
        {IDEA_EXAMPLES.map((idea) => (
          <button key={idea} type="button" className="chip" onClick={() => fill(idea)}>{idea}</button>
        ))}
      </div>
      <label className="idea-style">
        <span className="small muted">Style</span>
        <select name="style" defaultValue={initialStyle ?? "classic"}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {styles.filter((st) => st.group === g).map((st) => <option key={st.id} value={st.id}>{st.label} · {st.hint}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      {sketchUrl ? (
        <p className="idea-sketch-kept small"><img src={sketchUrl} alt="" /> Your sketch is saved. Add another below to replace it.</p>
      ) : null}
      <SketchPicker />
      <p className="small muted idea-sketch-tip">Dark pen or marker on plain paper works best, photographed from straight above in daylight, with the page filling the screen.</p>
      {state?.error && <p className="error small" role="alert">{state.error}</p>}
      <button className="button sun-button" disabled={pending}>{pending ? "Saving…" : "Draw it"}</button>
    </form>
  );
}

// The sign-up form's way back to the idea: `next` for joinAction. The server passes the idea from the URL; after a
// Google/Apple/X/Instagram round trip the URL no longer has it, so it comes back from this tab's session storage.
export function IdeaCarry({ idea, style }: { idea?: string; style?: string }) {
  const [kept, setKept] = useState(idea);
  useEffect(() => {
    if (idea) { remember(idea); return; }
    try { setKept(sessionStorage.getItem(KEY) || undefined); } catch { /* nothing kept */ }
  }, [idea]);
  const q = new URLSearchParams();
  if (kept) q.set("idea", kept.slice(0, MAX));
  if (style) q.set("style", style);
  return q.size ? <input type="hidden" name="next" value={`/studio/new?${q}`} /> : null;
}
