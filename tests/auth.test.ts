import { eq } from "drizzle-orm";
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

const { authorizeUrl, finishAuthorize } = await import("../src/lib/auth/oauth");
const session = await import("../src/lib/auth/session");
const { resetConfig } = await import("../src/lib/config");
const { db } = await import("../src/lib/db/client");
const { identities, users } = await import("../src/lib/db/schema");
const { freshDb } = await import("./helpers");

const loggedInAs = () => session.readSessionValue(jar.get("tc_session"));

beforeEach(async () => {
  jar.clear();
  process.env.GOOGLE_CLIENT_ID = "google-id";
  process.env.GOOGLE_CLIENT_SECRET = "google-secret";
  resetConfig();
  await freshDb();
});

describe("sealed cookies", () => {
  it("round-trips, and rejects tampering and expiry", () => {
    const v = session.seal({ a: 1 }, 10, 0);
    expect(session.unseal(v, 1000)).toEqual({ a: 1 });
    expect(session.unseal(`${v.slice(0, -2)}xx`, 1000)).toBeUndefined();
    expect(session.unseal(v, 11 * 60_000)).toBeUndefined();
  });
});

describe("provider handshake", () => {
  it("sends Google a PKCE challenge and refuses a callback with the wrong state", async () => {
    const { url, handshake } = authorizeUrl("google");
    const u = new URL(url);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("state")).toBe(handshake.state);
    expect(u.searchParams.get("redirect_uri")).toBe("http://localhost:3000/auth/google/callback");
    await expect(finishAuthorize("google", new URLSearchParams({ state: "nope", code: "c" }), handshake)).rejects.toThrow(/state/);
  });
});

describe("social sign-in", () => {
  it("asks a new person for an invite, then signs them up and logs them straight in", async () => {
    const next = await session.completeSocialSignIn("x", { subject: "x-1", name: "Sara K", username: "sarak" });
    expect(next).toBe("/join");
    const via = await session.pendingSignUp();
    expect(via?.profile.username).toBe("sarak");

    const code = await session.createInvite("test");
    const link = await session.signUp({ email: "sara@example.com", name: "Sara K", invite: code, acceptAgreement: true, via });
    expect(link).toBeUndefined();
    const d = await db();
    const [user] = await d.select().from(users).where(eq(users.email, "sara@example.com"));
    expect(loggedInAs()).toBe(user.id);
    expect(await session.pendingSignUp()).toBeUndefined();

    jar.clear();
    expect(await session.completeSocialSignIn("x", { subject: "x-1", username: "sarak" })).toBe("/studio");
    expect(loggedInAs()).toBe(user.id);
  });

  it("links a Google account to the designer with the same verified email", async () => {
    const code = await session.createInvite("test");
    await session.signUp({ email: "omar@example.com", name: "Omar", invite: code, acceptAgreement: true });
    expect(await session.completeSocialSignIn("google", { subject: "g-9", email: "Omar@Example.com" })).toBe("/studio");
    const d = await db();
    const [user] = await d.select().from(users).where(eq(users.email, "omar@example.com"));
    expect(loggedInAs()).toBe(user.id);
    expect((await session.connectedAccounts(user.id)).map((a) => a.provider)).toEqual(["google"]);
  });

  it("connects an account to the logged-in designer, but never one that belongs to someone else", async () => {
    const d = await db();
    const [a] = await d.insert(users).values({ email: "a@example.com", name: "A", handle: "a" }).returning();
    const [b] = await d.insert(users).values({ email: "b@example.com", name: "B", handle: "b" }).returning();
    await d.insert(identities).values({ userId: b.id, provider: "instagram", subject: "ig-b" });
    jar.set("tc_session", session.sessionValue(a.id));

    expect(await session.completeSocialSignIn("instagram", { subject: "ig-a", username: "a.draws" })).toBe("/studio?connected=instagram");
    expect(await session.completeSocialSignIn("instagram", { subject: "ig-b" })).toBe("/studio?connect=taken");
    const mine = await session.connectedAccounts(a.id);
    expect(mine.map((x) => x.username)).toEqual(["a.draws"]);
  });
});
