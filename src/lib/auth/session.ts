import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config, isAdminEmail } from "../config";
import { db } from "../db/client";
import { identities, invites, loginTokens, users } from "../db/schema";
import { UserError } from "../design/service";
import { sendEmail } from "../email";
import { STARTING_CREDITS } from "../rules";
import type { Handshake, Profile, Provider } from "./oauth";

// Invite-only sign-up, email login links and social sign-in. Login links are emailed (see lib/email), and
// also shown on screen in development.

const COOKIE = "tc_session";
const HANDSHAKE_COOKIE = "tc_oauth";
const PENDING_COOKIE = "tc_pending";
const STORE_COOKIE = "tc_store";
const SESSION_DAYS = 30;
const LINK_MINUTES = 30;

const sign = (value: string) => createHmac("sha256", config().SESSION_SECRET).update(value).digest("base64url");
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export function sessionValue(userId: string, now = Date.now()) {
  const body = `${userId}.${now + SESSION_DAYS * 86_400_000}`;
  return `${body}.${sign(body)}`;
}

export function readSessionValue(value: string | undefined, now = Date.now()): string | undefined {
  if (!value) return;
  const [userId, expires, mac] = value.split(".");
  if (!userId || !expires || !mac) return;
  const want = Buffer.from(sign(`${userId}.${expires}`));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got) || Number(expires) < now) return;
  return userId;
}

// A small signed value kept in a cookie, for state that has to survive a round trip to a sign-in provider.
export function seal(data: object, minutes: number, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ data, exp: now + minutes * 60_000 })).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function unseal<T>(value: string | undefined, now = Date.now()): T | undefined {
  const [body, mac] = value?.split(".") ?? [];
  if (!body || !mac) return;
  const want = Buffer.from(sign(body));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return;
  const { data, exp } = JSON.parse(Buffer.from(body, "base64url").toString());
  return exp < now ? undefined : data;
}

const secure = () => config().APP_URL.startsWith("https");

async function startSession(userId: string) {
  (await cookies()).set(COOKIE, sessionValue(userId), {
    httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: SESSION_DAYS * 86_400,
  });
}

// Who is signed in to the store, as Shopify told us. Kept so someone who isn't a designer yet can join with
// that same account, without a second email to confirm.
export type StoreIdentity = { email: string; name: string | null };

// Inside the store, the store's signed-in customer is the designer with the same email, if there is one; anyone
// else is signed out of the studio. Callers must have verified the customer came from Shopify.
export async function signInStoreCustomer(customer: StoreIdentity | undefined) {
  const jar = await cookies();
  if (customer) {
    jar.set(STORE_COOKIE, seal({ email: customer.email.toLowerCase(), name: customer.name } satisfies StoreIdentity, SESSION_DAYS * 1440), {
      httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: SESSION_DAYS * 86_400,
    });
  } else {
    jar.delete(STORE_COOKIE);
  }
  const d = await db();
  const [user] = customer ? await d.select().from(users).where(eq(users.email, customer.email.toLowerCase())) : [];
  if (user) await startSession(user.id);
  else await signOut();
}

export async function storeIdentity() {
  return unseal<StoreIdentity>((await cookies()).get(STORE_COOKIE)?.value);
}

// The local demo signs in as a demo designer or the admin directly, since there's no email to click.
export async function signInAsDemoUser(email: string) {
  if (!config().WHOLESALE_DEMO) throw new Error("Demo sign-in is only for the local demo");
  const d = await db();
  const [user] = await d.select().from(users).where(eq(users.email, email));
  if (!user) throw new Error(`No demo user ${email}`);
  await startSession(user.id);
}

export async function currentUser() {
  const userId = readSessionValue((await cookies()).get(COOKIE)?.value);
  if (!userId) return;
  const d = await db();
  const [user] = await d.select().from(users).where(eq(users.id, userId));
  return user && { ...user, isAdmin: isAdminEmail(user.email) };
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user.isAdmin) redirect("/studio");
  return user;
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}

const handleOf = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 20) || "designer";

// Someone back from a sign-in provider whose account isn't linked to a designer yet: they finish signing up on /join.
export type PendingSignUp = { provider: Provider; profile: Profile };

export async function pendingSignUp() {
  return unseal<PendingSignUp>((await cookies()).get(PENDING_COOKIE)?.value);
}

export async function clearPendingSignUp() {
  (await cookies()).delete(PENDING_COOKIE);
}

// Anyone can sign up and start designing; every design is reviewed before it goes on pre-order. An invite code is
// optional (the team's own outreach), and is marked used when given. Returns the link in dev so it can be shown on
// screen. Signing up through a provider, or with the store account (whose email Shopify has already confirmed),
// logs straight in instead.
export async function signUp(input: {
  email: string; name: string; invite?: string; acceptAgreement: boolean; via?: PendingSignUp; fromStore?: boolean;
}): Promise<string | undefined> {
  if (!input.acceptAgreement) throw new UserError("Accept the designer agreement to continue.");
  const d = await db();
  const email = input.email.trim().toLowerCase();
  const [existing] = await d.select().from(users).where(eq(users.email, email));
  if (existing) throw new UserError("That email already has an account. Log in instead.");
  if (!input.name.trim()) throw new UserError("Enter your name.");
  const code = input.invite?.trim();
  const [invite] = code ? await d.select().from(invites).where(and(eq(invites.code, code), isNull(invites.usedBy))) : [];
  if (code && !invite) throw new UserError("That invite code isn't valid or has been used.");

  let handle = handleOf(input.name);
  for (let n = 2; (await d.select().from(users).where(eq(users.handle, handle))).length; n++) {
    handle = `${handleOf(input.name)}${n}`;
  }
  const agreement = config().DESIGNER_AGREEMENT_VERSION;
  const [user] = await d
    .insert(users)
    .values({
      email, name: input.name.trim(), handle, credits: STARTING_CREDITS,
      agreementVersion: agreement || "draft", agreementAcceptedAt: new Date(),
    })
    .returning();
  if (invite) await d.update(invites).set({ usedBy: user.id, usedAt: new Date() }).where(eq(invites.code, invite.code));
  if (input.fromStore) return void (await startSession(user.id));
  if (!input.via) return sendLoginLink(email);
  await linkIdentity(user.id, input.via.provider, input.via.profile);
  await clearPendingSignUp();
  await startSession(user.id);
}

export async function acceptAgreement(userId: string) {
  const d = await db();
  await d
    .update(users)
    .set({ agreementVersion: config().DESIGNER_AGREEMENT_VERSION || "draft", agreementAcceptedAt: new Date() })
    .where(eq(users.id, userId));
}

// Returns the link in dev so it can be shown on screen.
export async function sendLoginLink(emailInput: string): Promise<string | undefined> {
  const d = await db();
  const email = emailInput.trim().toLowerCase();
  const [user] = await d.select().from(users).where(eq(users.email, email));
  if (!user) return; // Same response whether or not the account exists.
  const token = randomBytes(24).toString("base64url");
  await d.insert(loginTokens).values({
    tokenHash: hash(token), userId: user.id, expiresAt: new Date(Date.now() + LINK_MINUTES * 60_000),
  });
  const link = `${config().APP_URL}/auth/verify?token=${token}`;
  // Server logs aren't private: only print the link where it's needed to log in locally.
  if (process.env.NODE_ENV !== "production") console.log(`[login link] ${email}: ${link}`);
  await sendEmail({
    to: email,
    subject: "Your Truecolors login link",
    body: `Tap to log in to your studio:\n${link}\n\nThe link works once, for ${LINK_MINUTES} minutes.`,
  });
  return config().DEV_SHOW_LOGIN_LINKS ? link : undefined;
}

export async function verifyLoginToken(token: string) {
  const d = await db();
  const [row] = await d
    .update(loginTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(loginTokens.tokenHash, hash(token)), isNull(loginTokens.usedAt), gt(loginTokens.expiresAt, new Date())))
    .returning();
  if (!row) return false;
  await startSession(row.userId);
  return true;
}

// Apple posts its answer back from its own site, so this cookie has to be sent on a cross-site POST.
export async function saveHandshake(h: Handshake) {
  (await cookies()).set(HANDSHAKE_COOKIE, seal(h, 10), {
    httpOnly: true, path: "/auth", maxAge: 600,
    ...(h.provider === "apple" ? { sameSite: "none", secure: true } : { sameSite: "lax", secure: secure() }),
  });
}

export async function takeHandshake() {
  const jar = await cookies();
  const h = unseal<Handshake>(jar.get(HANDSHAKE_COOKIE)?.value);
  jar.delete({ name: HANDSHAKE_COOKIE, path: "/auth" });
  return h;
}

// One account per provider per designer; connecting again replaces the old one.
async function linkIdentity(userId: string, provider: Provider, profile: Profile) {
  const d = await db();
  await d.delete(identities).where(and(eq(identities.userId, userId), eq(identities.provider, provider)));
  await d.insert(identities).values({
    userId, provider, subject: profile.subject, username: profile.username ?? null, followers: profile.followers ?? null,
  });
}

// Where to send someone who's just come back from a provider. Logged in: connect the account. Known account:
// log in. A verified email that matches a designer: link and log in. Otherwise they need an invite to join.
export async function completeSocialSignIn(provider: Provider, profile: Profile): Promise<string> {
  const d = await db();
  const [known] = await d
    .select()
    .from(identities)
    .where(and(eq(identities.provider, provider), eq(identities.subject, profile.subject)));
  const me = await currentUser();
  if (me) {
    if (known && known.userId !== me.id) return "/studio?connect=taken";
    await linkIdentity(me.id, provider, profile);
    return `/studio?connected=${provider}`;
  }
  if (known) {
    await d
      .update(identities)
      .set({ username: profile.username ?? known.username, followers: profile.followers ?? known.followers })
      .where(eq(identities.id, known.id));
    await startSession(known.userId);
    return "/studio";
  }
  const [byEmail] = profile.email
    ? await d.select().from(users).where(eq(users.email, profile.email.toLowerCase()))
    : [];
  if (byEmail) {
    await linkIdentity(byEmail.id, provider, profile);
    await startSession(byEmail.id);
    return "/studio";
  }
  (await cookies()).set(PENDING_COOKIE, seal({ provider, profile } satisfies PendingSignUp, 30), {
    httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: 1800,
  });
  return "/join";
}

export async function connectedAccounts(userId: string) {
  const d = await db();
  return d.select().from(identities).where(eq(identities.userId, userId));
}

export async function createInvite(note: string) {
  const d = await db();
  const code = randomBytes(5).toString("hex").toUpperCase();
  await d.insert(invites).values({ code, note });
  return code;
}
