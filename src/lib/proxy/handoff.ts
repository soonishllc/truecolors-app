import { seal, signInStoreCustomer, unseal } from "../auth/session";
import { signInStoreFan } from "../fans";
import { storeCustomer } from "../shopify/customers";
import { signInToPortal, signOutOfPortal } from "../wholesale/portal-auth";

// The store page (served by app proxy, so it knows the signed-in customer from Shopify's signature) hands that
// customer to the app it embeds with a short-lived sealed token. The app then signs in as the same person, or
// signs out when nobody is signed in to the store, so the store's login is the only one.

type Handoff = { customerId: string };

export const makeHandoff = (customerId: string) => seal({ customerId } satisfies Handoff, 5);

// Returns false when the token is missing, forged or expired.
export async function takeHandoff(token: string | null): Promise<boolean> {
  const h = unseal<Handoff>(token ?? undefined);
  if (!h) return false;
  const customer = h.customerId ? await storeCustomer(h.customerId) : undefined;
  await signInStoreCustomer(customer && { email: customer.email, name: customer.firstName });
  await signInStoreFan(customer?.email);
  if (customer) await signInToPortal(customer.email);
  else await signOutOfPortal();
  return true;
}
