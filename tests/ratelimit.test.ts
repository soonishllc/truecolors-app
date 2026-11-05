import { describe, expect, it, vi } from "vitest";

let forwarded: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => new Headers(forwarded) }));

const { EMAIL_RULES, clientIp, createLimiter, emailChecks, throttleEmail } = await import("../src/lib/ratelimit");
const { UserError } = await import("../src/lib/design/service");

const MIN = 60_000;

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

describe("sliding-window limiter", () => {
  it("allows 3 emails to one address per 15 minutes, then frees up as old ones age out", () => {
    const c = clock();
    const l = createLimiter(c.now);
    const take = () => l.take(emailChecks("Fan@Example.com", undefined));
    expect(take()).toBe(true); // 0 min
    c.advance(5 * MIN);
    expect(take()).toBe(true); // 5 min
    c.advance(5 * MIN);
    expect(take()).toBe(true); // 10 min
    expect(take()).toBe(false);
    c.advance(5 * MIN + 1); // the first has aged out, the others haven't
    expect(take()).toBe(true);
    expect(take()).toBe(false);
  });

  it("normalises the address so case and spaces don't get around it", () => {
    const l = createLimiter(clock().now);
    for (const e of ["a@x.com", " A@X.com", "a@X.COM "]) expect(l.take(emailChecks(e, undefined))).toBe(true);
    expect(l.take(emailChecks("a@x.com", undefined))).toBe(false);
  });

  it("caps one IP at 10 emails per 15 minutes across different addresses", () => {
    const c = clock();
    const l = createLimiter(c.now);
    for (let i = 0; i < EMAIL_RULES.perIp.limit; i++) expect(l.take(emailChecks(`p${i}@x.com`, "1.2.3.4"))).toBe(true);
    expect(l.take(emailChecks("new@x.com", "1.2.3.4"))).toBe(false);
    expect(l.take(emailChecks("new@x.com", "5.6.7.8"))).toBe(true);
    c.advance(15 * MIN + 1);
    expect(l.take(emailChecks("again@x.com", "1.2.3.4"))).toBe(true);
  });

  it("doesn't count a refused request against the other keys", () => {
    const l = createLimiter(clock().now);
    for (let i = 0; i < 3; i++) l.take(emailChecks("a@x.com", "1.1.1.1"));
    expect(l.take(emailChecks("a@x.com", "1.1.1.1"))).toBe(false);
    // The IP has 3 recorded hits, not 4, so 7 more go through.
    for (let i = 0; i < 7; i++) expect(l.take(emailChecks(`b${i}@x.com`, "1.1.1.1"))).toBe(true);
    expect(l.take(emailChecks("c@x.com", "1.1.1.1"))).toBe(false);
  });
});

describe("throttleEmail", () => {
  it("reads the client IP from x-forwarded-for, then x-real-ip", async () => {
    forwarded = { "x-forwarded-for": "9.9.9.9, 10.0.0.1" };
    expect(await clientIp()).toBe("9.9.9.9");
    forwarded = { "x-real-ip": "8.8.8.8" };
    expect(await clientIp()).toBe("8.8.8.8");
    forwarded = {};
    expect(await clientIp()).toBeUndefined();
  });

  it("throws a friendly UserError once the limit is hit", async () => {
    forwarded = { "x-forwarded-for": "7.7.7.7" };
    const l = createLimiter(clock().now);
    for (let i = 0; i < 3; i++) await throttleEmail("z@x.com", l);
    const err = await throttleEmail("z@x.com", l).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err.message).toBe("Too many emails to that address. Try again in a few minutes.");
  });
});
