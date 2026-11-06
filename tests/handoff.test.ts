import { beforeEach, describe, expect, it, vi } from "vitest";

// A cookie jar standing in for Next's request cookies.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (opts: string | { name: string }) => void jar.delete(typeof opts === "string" ? opts : opts.name),
  }),
}));

const { makeHandoff, takeHandoff } = await import("../src/lib/proxy/handoff");
const { freshDb } = await import("./helpers");

beforeEach(async () => {
  jar.clear();
  await freshDb();
});

describe("store sign-in handoff", () => {
  it("works once", async () => {
    const t = makeHandoff("");
    expect(await takeHandoff(t)).toBe(true);
    expect(await takeHandoff(t)).toBe(false);
  });

  it("expires after a minute", async () => {
    const t = makeHandoff("");
    expect(await takeHandoff(t, Date.now() + 61_000)).toBe(false);
  });

  it("refuses a forged token", async () => {
    expect(await takeHandoff(`${makeHandoff("")}x`)).toBe(false);
    expect(await takeHandoff(null)).toBe(false);
  });
});
