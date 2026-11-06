import Link from "next/link";
import type { TickerItem } from "@/lib/ticker";

// A band of lines running across the page, edge to edge. The lines are there twice so the loop is seamless (the
// track moves by half its width); the second copy is hidden from screen readers. Hovering pauses it.
export function Ticker({ items, label = "What's happening" }: { items: TickerItem[]; label?: string }) {
  if (items.length === 0) return null;
  // At least ten lines a copy, so one copy is always wider than the screen.
  const one = Array.from({ length: Math.ceil(10 / items.length) }, () => items).flat();
  return (
    <div className="ticker" role="region" aria-label={label}>
      <div className="ticker-track" style={{ "--dur": `${one.length * 4.5}s` } as React.CSSProperties}>
        {[0, 1].map((copy) => (
          <div key={copy} className="ticker-copy" aria-hidden={copy === 1 || undefined}>
            {one.map((it, i) => (
              <span key={i} className="ticker-item">
                {it.href ? <Link href={it.href} tabIndex={copy === 1 ? -1 : undefined}>{it.text}</Link> : it.text}
                <i aria-hidden="true">☀</i>
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
