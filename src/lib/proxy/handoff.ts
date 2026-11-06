import { randomBytes } from "node:crypto";
import { seal, signInStoreCustomer, unseal } from "../auth/session";
import { signInStoreFan } from "../fans";
import { storeCustomer } from "../shopify/customers";
import { signInToPortal, signOutOfPortal } from "../wholesale/portal-auth";

// The store page (served by app proxy, so it knows the signed-in customer from Shopify's signature) hands that
// customer to the app it embeds with a sealed token. The app then signs in as the same person, or signs out when
// nobody is signed in to the store, so the store's login is the only one. The token sits in the frame's address,
// which can end up in logs and history, so it works once and only for a minute.

type Handoff = { customerId: string; nonce: string };

const HANDOFF_MINUTES = 1;
// Tokens already used, until they'd have expired anyway. In memory: the site runs as one process (render.yaml).
const used = new Map<string, number>();

export const makeHandoff = (customerId: string) =>
  seal({ customerId, nonce: randomBytes(12).toString("base64url") } satisfies Handoff, HANDOFF_MINUTES);

// Returns false when the token is missing, forged, expired or already used.
export async function takeHandoff(token: string | null, now = Date.now()): Promise<boolean> {
  const h = unseal<Handoff>(token ?? undefined, now);
  if (!h?.nonce) return false;
  for (const [n, until] of used) if (until < now) used.delete(n);
  if (used.has(h.nonce)) return false;
  used.set(h.nonce, now + HANDOFF_MINUTES * 60_000);
  const customer = h.customerId ? await storeCustomer(h.customerId) : undefined;
  await signInStoreCustomer(customer && { email: customer.email, name: customer.firstName });
  await signInStoreFan(customer?.email);
  if (customer) await signInToPortal(customer.email);
  else await signOutOfPortal();
  return true;
}
