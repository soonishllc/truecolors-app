import { config } from "../config";

export type UserErrors = { field?: string[] | null; message: string; code?: string | null }[];

export class ShopifyError extends Error {}

// The Admin API token: from the Dev Dashboard app's client ID and secret (valid 24 hours, renewed an hour early),
// or a fixed SHOPIFY_ADMIN_TOKEN.
let token: { value: string; until: number } | undefined;

async function accessToken(): Promise<string> {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET, SHOPIFY_ADMIN_TOKEN } = config();
  if (!SHOPIFY_CLIENT_ID || !SHOPIFY_CLIENT_SECRET) {
    if (!SHOPIFY_ADMIN_TOKEN) throw new ShopifyError("Set SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (or SHOPIFY_ADMIN_TOKEN)");
    return SHOPIFY_ADMIN_TOKEN;
  }
  if (token && token.until > Date.now()) return token.value;
  const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: SHOPIFY_CLIENT_ID, client_secret: SHOPIFY_CLIENT_SECRET }),
  });
  if (!res.ok) throw new ShopifyError(`Shopify token ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: body.access_token, until: Date.now() + (body.expires_in - 3600) * 1000 };
  return token.value;
}

export async function admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_API_VERSION } = config();
  const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": await accessToken() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) token = undefined;
  if (!res.ok) throw new ShopifyError(`Shopify ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new ShopifyError(body.errors.map((e) => e.message).join("; "));
  return body.data as T;
}

// Throws on mutation userErrors so callers only handle the happy path.
export function ok<T extends { userErrors: UserErrors }>(payload: T, what: string): T {
  if (payload.userErrors.length) {
    throw new ShopifyError(`${what}: ${payload.userErrors.map((e) => e.message).join("; ")}`);
  }
  return payload;
}

export const gid = (type: string, id: string | number) =>
  String(id).startsWith("gid://") ? String(id) : `gid://shopify/${type}/${id}`;

export const numericId = (g: string) => g.split("/").pop()!;
