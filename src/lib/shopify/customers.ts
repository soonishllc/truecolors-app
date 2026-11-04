import { config } from "../config";
import { admin, gid } from "./client";

export type StoreCustomer = { id: string; email: string; firstName: string | null };

// Store customers the local demo signs in as, standing in for real store accounts.
export const DEMO_CUSTOMERS: Record<string, { email: string; firstName: string; label: string }> = {
  "9101": { email: "designer@demo.example", firstName: "Maya", label: "Maya · designer" },
  "9102": { email: "stockist@demo.example", firstName: "Sara", label: "Sara · stockist" },
  "9103": { email: "partner@demo.example", firstName: "Lucía", label: "Lucía · display partner" },
  // A store customer who isn't a designer yet, to try joining the studio (invite code DEMO-INVITE).
  "9104": { email: "noor@demo.example", firstName: "Noor", label: "Noor · shopper, joining as a designer" },
};

// The signed-in store customer behind an app proxy request, by the id Shopify signed.
export async function storeCustomer(id: string): Promise<StoreCustomer | undefined> {
  if (config().WHOLESALE_DEMO) {
    const demo = DEMO_CUSTOMERS[id];
    return demo && { id, email: demo.email, firstName: demo.firstName };
  }
  const res = await admin<{ customer: { email: string | null; firstName: string | null } | null }>(
    `query($id: ID!) { customer(id: $id) { email firstName } }`,
    { id: gid("Customer", id) },
  );
  const c = res.customer;
  return c?.email ? { id, email: c.email.toLowerCase(), firstName: c.firstName } : undefined;
}
