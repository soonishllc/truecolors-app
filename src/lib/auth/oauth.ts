import { createHash, createSign, randomBytes } from "node:crypto";
import { config } from "../config";

// Sign in with Google, Apple, X, Instagram or TikTok: the OAuth code flow, by hand, for each provider.
// Each provider hands back who the person is and, for the social ones, how many followers they have.
// The studio keeps no tokens, so it can't post for them.

export type Provider = "google" | "apple" | "x" | "instagram" | "tiktok";
export type Profile = { subject: string; name?: string; username?: string; email?: string; followers?: number };

type Tokens = { access_token: string; id_token?: string; user_id?: string | number; open_id?: string };

type Spec = {
  label: string;
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  pkce: boolean;
  // Apple posts the result back as a form, and only sends the person's name that first time.
  formPost?: boolean;
  // X wants the client credentials in a Basic header; the others take them in the body.
  basicAuth?: boolean;
  // TikTok calls the client id "client_key".
  clientIdParam?: string;
  credentials(): { id?: string; secret?: string };
  profile(tokens: Tokens, form: URLSearchParams): Promise<Profile>;
};

// The id token comes straight from the provider over TLS in exchange for our code, so its claims can be read as is.
const claims = (jwt?: string): Record<string, unknown> => {
  if (!jwt) throw new Error("The provider sent no id token");
  return JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
};

const getJson = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}: ${await res.text()}`);
  return res.json();
};

// Apple's client secret is a short-lived JWT signed with the team's Sign in with Apple key.
function appleSecret(): string {
  const { APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = config();
  const now = Math.floor(Date.now() / 1000);
  const part = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${part({ alg: "ES256", kid: APPLE_KEY_ID })}.${part({
    iss: APPLE_TEAM_ID, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: APPLE_CLIENT_ID,
  })}`;
  const sig = createSign("SHA256").update(body).sign({ key: APPLE_PRIVATE_KEY!.replace(/\\n/g, "\n"), dsaEncoding: "ieee-p1363" });
  return `${body}.${sig.toString("base64url")}`;
}

const PROVIDERS: Record<Provider, Spec> = {
  google: {
    label: "Google",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email profile",
    pkce: true,
    credentials: () => ({ id: config().GOOGLE_CLIENT_ID, secret: config().GOOGLE_CLIENT_SECRET }),
    async profile(t) {
      const c = claims(t.id_token);
      return { subject: String(c.sub), name: c.name as string, email: c.email_verified ? (c.email as string) : undefined };
    },
  },
  apple: {
    label: "Apple",
    authorizeUrl: "https://appleid.apple.com/auth/authorize",
    tokenUrl: "https://appleid.apple.com/auth/token",
    scope: "name email",
    pkce: false,
    formPost: true,
    credentials: () => {
      const c = config();
      const ready = c.APPLE_CLIENT_ID && c.APPLE_TEAM_ID && c.APPLE_KEY_ID && c.APPLE_PRIVATE_KEY;
      return { id: c.APPLE_CLIENT_ID, secret: ready ? appleSecret() : undefined };
    },
    async profile(t, form) {
      const c = claims(t.id_token);
      const user = form.get("user");
      const n = user ? (JSON.parse(user).name ?? {}) : {};
      const name = [n.firstName, n.lastName].filter(Boolean).join(" ") || undefined;
      return { subject: String(c.sub), name, email: c.email as string | undefined };
    },
  },
  x: {
    label: "X",
    authorizeUrl: "https://x.com/i/oauth2/authorize",
    tokenUrl: "https://api.x.com/2/oauth2/token",
    scope: "users.read tweet.read",
    pkce: true,
    basicAuth: true,
    credentials: () => ({ id: config().X_CLIENT_ID, secret: config().X_CLIENT_SECRET }),
    async profile(t) {
      const { data } = await getJson("https://api.x.com/2/users/me?user.fields=public_metrics", {
        headers: { Authorization: `Bearer ${t.access_token}` },
      });
      return { subject: data.id, name: data.name, username: data.username, followers: data.public_metrics?.followers_count };
    },
  },
  instagram: {
    label: "Instagram",
    authorizeUrl: "https://www.instagram.com/oauth/authorize",
    tokenUrl: "https://api.instagram.com/oauth/access_token",
    scope: "instagram_business_basic",
    pkce: false,
    credentials: () => ({ id: config().INSTAGRAM_CLIENT_ID, secret: config().INSTAGRAM_CLIENT_SECRET }),
    async profile(t) {
      const me = await getJson(
        `https://graph.instagram.com/me?fields=user_id,username,name,followers_count&access_token=${t.access_token}`,
      );
      return { subject: String(me.user_id ?? t.user_id), name: me.name, username: me.username, followers: me.followers_count };
    },
  },
  tiktok: {
    label: "TikTok",
    authorizeUrl: "https://www.tiktok.com/v2/auth/authorize/",
    tokenUrl: "https://open.tiktokapis.com/v2/oauth/token/",
    scope: "user.info.basic,user.info.profile,user.info.stats",
    pkce: true,
    clientIdParam: "client_key",
    credentials: () => ({ id: config().TIKTOK_CLIENT_KEY, secret: config().TIKTOK_CLIENT_SECRET }),
    async profile(t) {
      const { data } = await getJson(
        "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username,follower_count",
        { headers: { Authorization: `Bearer ${t.access_token}` } },
      );
      const u = data.user;
      return { subject: u.open_id ?? t.open_id, name: u.display_name, username: u.username, followers: u.follower_count };
    },
  },
};

export const providerLabel = (p: Provider) => PROVIDERS[p].label;

export const isProvider = (p: string): p is Provider => p in PROVIDERS;

// The providers whose keys are set, in the order the buttons show.
export function enabledProviders(): Provider[] {
  const c = config();
  const on: Record<Provider, unknown> = {
    google: c.GOOGLE_CLIENT_ID && c.GOOGLE_CLIENT_SECRET,
    apple: c.APPLE_CLIENT_ID && c.APPLE_TEAM_ID && c.APPLE_KEY_ID && c.APPLE_PRIVATE_KEY,
    x: c.X_CLIENT_ID && c.X_CLIENT_SECRET,
    instagram: c.INSTAGRAM_CLIENT_ID && c.INSTAGRAM_CLIENT_SECRET,
    tiktok: c.TIKTOK_CLIENT_KEY && c.TIKTOK_CLIENT_SECRET,
  };
  return (Object.keys(PROVIDERS) as Provider[]).filter((p) => on[p]);
}

export const callbackUrl = (p: Provider) => `${config().APP_URL}/auth/${p}/callback`;

// What we remember between sending the person to the provider and them coming back.
export type Handshake = { provider: Provider; state: string; verifier?: string };

export function authorizeUrl(p: Provider): { url: string; handshake: Handshake } {
  const spec = PROVIDERS[p];
  const state = randomBytes(16).toString("base64url");
  const verifier = spec.pkce ? randomBytes(32).toString("base64url") : undefined;
  const url = new URL(spec.authorizeUrl);
  url.search = new URLSearchParams({
    [spec.clientIdParam ?? "client_id"]: spec.credentials().id!,
    redirect_uri: callbackUrl(p),
    response_type: "code",
    scope: spec.scope,
    state,
    ...(spec.formPost && { response_mode: "form_post" }),
    ...(verifier && {
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
    }),
  }).toString();
  return { url: url.toString(), handshake: { provider: p, state, verifier } };
}

export const isFormPost = (p: Provider) => !!PROVIDERS[p].formPost;

// Swaps the code for tokens and reads who signed in. `params` is the callback's query or posted form.
export async function finishAuthorize(p: Provider, params: URLSearchParams, handshake: Handshake): Promise<Profile> {
  const spec = PROVIDERS[p];
  if (handshake.provider !== p || params.get("state") !== handshake.state) throw new Error("Sign-in state didn't match");
  const code = params.get("code");
  if (!code) throw new Error(`Sign-in was cancelled (${params.get("error") ?? "no code"})`);
  const { id, secret } = spec.credentials();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(p),
    ...(handshake.verifier && { code_verifier: handshake.verifier }),
    [spec.clientIdParam ?? "client_id"]: id!,
    ...(!spec.basicAuth && { client_secret: secret! }),
  });
  const headers: Record<string, string> = { "Content-Type": "application/x-www-form-urlencoded" };
  if (spec.basicAuth) headers.Authorization = `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`;
  const tokens: Tokens = await getJson(spec.tokenUrl, { method: "POST", headers, body });
  return spec.profile(tokens, params);
}
