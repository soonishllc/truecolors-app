import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { config, isAdminEmail } from "../config";
import { db } from "../db/client";
import { invites, loginTokens, users } from "../db/schema";
import { UserError } from "../design/service";
import { STARTING_CREDITS } from "../rules";

// Invite-only sign-up and email login links. Phase 1 sends no email itself: the link is logged (and shown
// in dev) so Truecolors can send it; plug a mail provider into sendLoginLink when one is chosen.

const COOKIE = "tc_session";
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

export async function signUp(input: { email: string; name: string; invite: string; acceptAgreement: boolean }) {
  if (!input.acceptAgreement) throw new UserError("Accept the designer agreement to continue.");
  const d = await db();
  const email = input.email.trim().toLowerCase();
  const [existing] = await d.select().from(users).where(eq(users.email, email));
  if (existing) throw new UserError("That email already has an account. Log in instead.");
  const [invite] = await d.select().from(invites).where(and(eq(invites.code, input.invite.trim()), isNull(invites.usedBy)));
  if (!invite) throw new UserError("That invite code isn't valid or has been used.");

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
  await d.update(invites).set({ usedBy: user.id, usedAt: new Date() }).where(eq(invites.code, invite.code));
  return sendLoginLink(email);
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
  console.log(`[login link] ${email}: ${link}`);
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
  (await cookies()).set(COOKIE, sessionValue(row.userId), {
    httpOnly: true, sameSite: "lax", secure: config().APP_URL.startsWith("https"), path: "/", maxAge: SESSION_DAYS * 86_400,
  });
  return true;
}

export async function createInvite(note: string) {
  const d = await db();
  const code = randomBytes(5).toString("hex").toUpperCase();
  await d.insert(invites).values({ code, note });
  return code;
}
