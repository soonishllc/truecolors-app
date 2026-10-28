import { config } from "../config";

export type UserErrors = { field?: string[] | null; message: string; code?: string | null }[];

export class ShopifyError extends Error {}

export async function admin<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const { SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_TOKEN, SHOPIFY_API_VERSION } = config();
  if (!SHOPIFY_ADMIN_TOKEN) throw new ShopifyError("SHOPIFY_ADMIN_TOKEN is not set");
  const res = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": SHOPIFY_ADMIN_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
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
