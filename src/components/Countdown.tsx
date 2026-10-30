"use client";

import { useEffect, useState } from "react";

const H = 3_600_000;
const URGENT_HOURS = 48;

function parts(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const pad = (n: number) => String(n).padStart(2, "0");

// Time left in a campaign, ticking. Days and hours while there's plenty of time; minutes and seconds in the last 48h.
export function Countdown({ endsAt }: { endsAt: string }) {
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState(() => Date.now());
  const left = end - now;
  const urgent = left < URGENT_HOURS * H;

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), urgent ? 1000 : 30_000);
    return () => clearInterval(id);
  }, [urgent]);

  if (left <= 0) return <span className="countdown">Ending now</span>;
  const { d, h, m, s } = parts(left);
  return (
    <span className={`countdown${urgent ? " urgent" : ""}`} suppressHydrationWarning>
      {urgent ? `Ends in ${d * 24 + h}h ${pad(m)}m ${pad(s)}s` : `${d}d ${h}h left`}
    </span>
  );
}
