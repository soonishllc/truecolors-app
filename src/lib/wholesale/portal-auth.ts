import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { seal, unseal } from "../auth/session";
import { config } from "../config";
import { db } from "../db/client";
import { outlets, wholesaleContacts, wholesalers } from "../db/schema";

// Wholesalers sign in to the portal with their Shopify customer account (Shopify emails them a code), and
// their verified email is matched to a wholesale contact. The portal keeps no Shopify tokens: orders are
// read with the app's own Admin API access, for that contact's wholesaler only.

const COOKIE = "tc_wholesale";
const HANDSHAKE_COOKIE = "tc_wholesale_oauth";
const SESSION_DAYS = 30;

type Discovery = { authorization_endpoint: string; token_endpoint: string; end_session_endpoint?: string };
type Handshake = { state: string; nonce: string };
// Who's signed in: always their email, and their contact when that email belongs to one.
type PortalSession = { email: string; contactId?: string };

let discovery: Promise<Discovery> | undefined;

function discover(): Promise<Discovery> {
  discovery ??= fetch(`https://${config().SHOPIFY_STORE_DOMAIN}/.well-known/openid-configuration`).then(async (r) => {
    if (!r.ok) throw new Error(`Shopify discovery answered ${r.status}`);
    return r.json() as Promise<Discovery>;
  });
  discovery.catch(() => (discovery = undefined));
  return discovery;
}

export const portalSignInReady = () =>
  Boolean(config().SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID && config().SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET);

const callbackUrl = () => `${config().APP_URL}/wholesale/callback`;
const secure = () => config().APP_URL.startsWith("https");

export async function portalAuthorizeUrl(): Promise<string> {
  const { authorization_endpoint } = await discover();
  const handshake: Handshake = { state: randomBytes(16).toString("base64url"), nonce: randomBytes(16).toString("base64url") };
  (await cookies()).set(HANDSHAKE_COOKIE, seal(handshake, 10), {
    httpOnly: true, sameSite: "lax", secure: secure(), path: "/wholesale", maxAge: 600,
  });
  const url = new URL(authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: config().SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID!,
    response_type: "code",
    redirect_uri: callbackUrl(),
    scope: "openid email customer-account-api:full",
    state: handshake.state,
    nonce: handshake.nonce,
  }).toString();
  return url.toString();
}

// Swaps the code for tokens, checks the id token is ours, and signs the person in. Returns where to go next.
export async function finishPortalSignIn(params: URLSearchParams): Promise<string> {
  const jar = await cookies();
  const handshake = unseal<Handshake>(jar.get(HANDSHAKE_COOKIE)?.value);
  jar.delete({ name: HANDSHAKE_COOKIE, path: "/wholesale" });
  if (!handshake || params.get("state") !== handshake.state) return "/wholesale?error=expired";
  const code = params.get("code");
  if (!code) return "/wholesale?error=cancelled";

  const { SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: id, SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET: secret } = config();
  const { token_endpoint } = await discover();
  const res = await fetch(token_endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: id!, redirect_uri: callbackUrl(), code }),
  });
  if (!res.ok) throw new Error(`Shopify token exchange answered ${res.status}: ${await res.text()}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error("Shopify sent no id token");
  // The id token came straight from Shopify over TLS in exchange for our code, so its claims can be read as is.
  const claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString()) as Record<string, unknown>;
  if (claims.nonce !== handshake.nonce || claims.aud !== id) return "/wholesale?error=failed";
  const email = String(claims.email ?? "").toLowerCase();
  if (!email) return "/wholesale?error=failed";

  const d = await db();
  const [contact] = await d.select().from(wholesaleContacts).where(eq(wholesaleContacts.email, email));
  jar.set(COOKIE, seal({ email, contactId: contact?.id } satisfies PortalSession, SESSION_DAYS * 1440), {
    httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: SESSION_DAYS * 86_400,
  });
  return "/wholesale";
}

// The local demo signs in as a demo contact directly, since there's no Shopify to sign in with.
export async function signInAsDemo(email: string) {
  if (!config().WHOLESALE_DEMO) throw new Error("Demo sign-in is only for the local demo");
  await signInToPortal(email);
}

// Signs in whoever the store says is signed in (inside the store, by app proxy): their email, and their wholesale
// contact when the email belongs to one. Callers must have verified the email came from Shopify.
export async function signInToPortal(email: string) {
  const d = await db();
  const [contact] = await d.select().from(wholesaleContacts).where(eq(wholesaleContacts.email, email));
  (await cookies()).set(COOKIE, seal({ email, contactId: contact?.id } satisfies PortalSession, SESSION_DAYS * 1440), {
    httpOnly: true, sameSite: "lax", secure: secure(), path: "/", maxAge: SESSION_DAYS * 86_400,
  });
}

export async function signOutOfPortal() {
  (await cookies()).delete(COOKIE);
}

// The signed-in wholesaler, if their account is active. `email` is set for anyone signed in, so the page
// can tell a stranger from a customer whose account isn't set up yet.
export async function currentWholesaler() {
  const session = unseal<PortalSession>((await cookies()).get(COOKIE)?.value);
  if (!session?.contactId) return { email: session?.email };
  const d = await db();
  const [row] = await d
    .select({ contact: wholesaleContacts, wholesaler: wholesalers })
    .from(wholesaleContacts)
    .innerJoin(wholesalers, eq(wholesalers.id, wholesaleContacts.wholesalerId))
    .where(and(eq(wholesaleContacts.id, session.contactId), eq(wholesalers.status, "active")));
  if (!row) return { email: session.email };
  const theirOutlets = await d.select().from(outlets).where(eq(outlets.wholesalerId, row.wholesaler.id));
  return { email: session.email, ...row, outlets: theirOutlets };
}
