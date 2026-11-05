import { createHmac, timingSafeEqual } from "node:crypto";

// The session token a checkout or customer account UI extension sends (shopify.sessionToken.get()): a JWT signed
// HS256 with the app's client secret. `dest` is the shop it was issued for; `sub`, when there is one, the customer.

export type SessionToken = { dest: string; aud: string; sub?: string; exp: number; nbf?: number; iat?: number };

const b64 = (s: string) => Buffer.from(s, "base64url");
const b64Json = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");

export const signSessionToken = (claims: object, secret: string) => {
  const head = b64Json({ alg: "HS256", typ: "JWT" });
  const body = b64Json(claims);
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
};

// The token's claims when it's signed with `secret`, in date, and issued for `shop` (the myshopify domain).
export function verifySessionToken(token: string | undefined, secret: string, shop: string, now = Date.now()) {
  const [head, body, mac] = token?.split(".") ?? [];
  if (!head || !body || !mac) return;
  const want = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  const got = b64(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return;
  let claims: SessionToken;
  try {
    if (JSON.parse(b64(head).toString()).alg !== "HS256") return;
    claims = JSON.parse(b64(body).toString());
  } catch {
    return;
  }
  // A few seconds' grace for the shop's clock and ours.
  const t = now / 1000;
  if (typeof claims.exp !== "number" || claims.exp < t - 5) return;
  if (typeof claims.nbf === "number" && claims.nbf > t + 5) return;
  if (String(claims.dest ?? "").replace(/^https:\/\//, "") !== shop) return;
  return claims;
}
