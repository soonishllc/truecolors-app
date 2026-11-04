import { createHmac, timingSafeEqual } from "node:crypto";

// Shopify signs every app proxy request: each query parameter except `signature` as key=value (repeated keys
// joined with commas), sorted, concatenated with nothing between them, HMAC-SHA256 with the app's secret, in hex.

function message(params: URLSearchParams) {
  const keys = [...new Set([...params.keys()])].filter((k) => k !== "signature");
  return keys.map((k) => `${k}=${params.getAll(k).join(",")}`).sort().join("");
}

export const signProxyQuery = (params: URLSearchParams, secret: string) =>
  createHmac("sha256", secret).update(message(params)).digest("hex");

// True when the request came from Shopify within the last `maxAgeSeconds`.
export function verifyProxyQuery(params: URLSearchParams, secret: string, now = Date.now(), maxAgeSeconds = 300) {
  const given = params.get("signature") ?? "";
  const want = signProxyQuery(params, secret);
  if (given.length !== want.length || !timingSafeEqual(Buffer.from(given), Buffer.from(want))) return false;
  const ts = Number(params.get("timestamp"));
  return Number.isFinite(ts) && Math.abs(now / 1000 - ts) <= maxAgeSeconds;
}
