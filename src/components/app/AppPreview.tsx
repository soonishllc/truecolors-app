"use client";

import { useRef, useState } from "react";

// The app preview: a phone running the store (the app is truecolors.global, wrapped by an app builder), with the
// app's tab bar under it and the walkthrough beside it. Each tab remembers where you were in it, as a native tab
// bar would. Store pages come from the local store preview (/dev/store); Chat stands in for WhatsApp.

export type Step = { who: string; what: string; url: string; staff?: boolean };

const TABS = [
  { id: "shop", label: "Shop", home: "/dev/store/collections/all", icon: "M6 8h12l-1 12H7L6 8Zm3 0a3 3 0 0 1 6 0" },
  { id: "design", label: "Design", home: "/dev/store/apps/truecolors", icon: "M4 20l4-1 10-10-3-3L5 16l-1 4Zm11-14 3 3" },
  { id: "chat", label: "Chat", home: "/app/chat", icon: "M4 5h16v11H9l-5 4V5Z" },
  { id: "wholesale", label: "Wholesale", home: "/dev/store/apps/truecolors/wholesale", icon: "M3 10h18M5 10v10h14V10M3 10l2-5h14l2 5M10 20v-5h4v5" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const tabOf = (path: string): TabId =>
  path.startsWith("/app/chat") ? "chat"
    : path.startsWith("/dev/store/apps/truecolors/wholesale") ? "wholesale"
    : path.startsWith("/dev/store/apps/truecolors") ? "design"
    : "shop";

export function AppPreview({ steps }: { steps: Step[] }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const last = useRef<Record<TabId, string>>(Object.fromEntries(TABS.map((t) => [t.id, t.home])) as Record<TabId, string>);
  const [tab, setTab] = useState<TabId>("shop");
  const [step, setStep] = useState<number>();

  const go = (url: string) => {
    if (frame.current) frame.current.src = url;
  };
  const loaded = () => {
    const loc = frame.current?.contentWindow?.location;
    if (!loc) return;
    const t = tabOf(loc.pathname);
    last.current[t] = loc.pathname + loc.search + loc.hash;
    setTab(t);
  };

  return (
    <div className="app-preview">
      <div className="app-device">
        <iframe ref={frame} src="/dev/store/collections/all" title="Truecolors app" onLoad={loaded} />
        <nav className="app-tabs" aria-label="App tabs">
          {TABS.map((t) => (
            <button
              key={t.id} type="button" className={t.id === tab ? "on" : ""} aria-current={t.id === tab ? "page" : undefined}
              onClick={() => go(t.id === tab ? t.home : last.current[t.id])}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d={t.icon} /></svg>
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      <aside className="app-flow">
        <div className="eyebrow">Local demo · app preview</div>
        <h1>One Truecolors app</h1>
        <p className="muted">
          The app is truecolors.global: the store, with community designs, wholesale and displays inside it and one
          store sign-in. Tap through it on the phone, or follow the flow from a shopper to a wholesaler to a designer.
        </p>
        <ol className="app-steps">
          {steps.map((s, i) => (
            <li key={i}>
              <button
                type="button" className={i === step ? "on" : ""}
                onClick={() => {
                  setStep(i);
                  if (s.staff) window.open(s.url, "_blank");
                  else go(s.url);
                }}
              >
                <span className="small muted">{s.who}{s.staff ? " · opens a new tab" : ""}</span>
                {s.what}
              </button>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
