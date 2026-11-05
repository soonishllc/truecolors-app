import { headers } from "next/headers";
import { UserError } from "./design/service";

// Sliding-window limits kept in memory. The app runs as one server process (render.yaml: numInstances 1), so one
// map is the whole picture; a restart forgets it, which is fine for throttling.

export type Rule = { limit: number; windowMs: number };

const MINUTE = 60_000;
// Emails sent on someone's request (login links, fan links, waitlist confirmations).
export const EMAIL_RULES = {
  perEmail: { limit: 3, windowMs: 15 * MINUTE },
  perIp: { limit: 10, windowMs: 15 * MINUTE },
} satisfies Record<string, Rule>;

export function createLimiter(now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  let lastSweep = now();

  const recent = (key: string, windowMs: number, t: number) => (hits.get(key) ?? []).filter((at) => at > t - windowMs);

  // Drops keys with nothing recent so the map can't grow without bound.
  const sweep = (t: number) => {
    if (t - lastSweep < MINUTE) return;
    lastSweep = t;
    const longest = Math.max(...Object.values(EMAIL_RULES).map((r) => r.windowMs), 60 * MINUTE);
    for (const [key, list] of hits) if (!list.some((at) => at > t - longest)) hits.delete(key);
  };

  return {
    // Records one hit against every key only if all of them are under their limit; returns whether it was allowed.
    take(checks: { key: string; rule: Rule }[]): boolean {
      const t = now();
      sweep(t);
      const lists = checks.map(({ key, rule }) => recent(key, rule.windowMs, t));
      if (checks.some(({ rule }, i) => lists[i].length >= rule.limit)) return false;
      checks.forEach(({ key }, i) => hits.set(key, [...lists[i], t]));
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}

const limiter = createLimiter();
export const resetRateLimits = () => limiter.reset();

// The visitor's IP from the proxy headers (Render puts the client first in x-forwarded-for). Undefined outside a
// request, e.g. in scripts and tests.
export async function clientIp(): Promise<string | undefined> {
  try {
    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
    return ip || undefined;
  } catch {
    return undefined;
  }
}

export function emailChecks(email: string, ip: string | undefined) {
  const checks = [{ key: `email:${email.trim().toLowerCase()}`, rule: EMAIL_RULES.perEmail }];
  if (ip) checks.push({ key: `ip:${ip}`, rule: EMAIL_RULES.perIp });
  return checks;
}

// Call before sending an email someone asked for. Throws a UserError the form shows when they've asked too often.
export async function throttleEmail(email: string, l: Pick<ReturnType<typeof createLimiter>, "take"> = limiter) {
  if (!l.take(emailChecks(email, await clientIp()))) {
    throw new UserError("Too many emails to that address. Try again in a few minutes.");
  }
}
