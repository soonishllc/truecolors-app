import { eq } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { outlets, wholesaleContacts, wholesalers } from "../src/lib/db/schema";
import { addOutlet, createWholesaler } from "../src/lib/wholesale/accounts";
import { addDisplay } from "../src/lib/wholesale/service";

// Sets up the two test wholesale accounts for the broader test: a stockist and a display partner with one
// outlet and a Tower. Safe to run again; existing accounts are left as they are. Settings, from .env.local:
//   TEST_STOCKIST_PHONE, TEST_STOCKIST_EMAIL    the phone and email you'll test the stockist side with
//   TEST_PARTNER_PHONE, TEST_PARTNER_EMAIL      a second phone and email for the display partner side
//   TEST_SHOPIFY_CUSTOMER_ID                    a test customer in the dev store, used by both
//   TEST_OUTLET_LOCATION_ID                     a dev-store location standing in for the partner's outlet

const env = (k: string) => process.env[k]?.trim() ?? "";

async function ensure(name: string, input: Parameters<typeof createWholesaler>[0]) {
  const d = await db();
  const [existing] = await d.select().from(wholesalers).where(eq(wholesalers.name, name));
  if (existing) {
    console.log(`= ${name} already exists`);
    return existing;
  }
  const w = await createWholesaler(input);
  console.log(`+ ${name}`);
  return w;
}

async function main() {
  const customer = env("TEST_SHOPIFY_CUSTOMER_ID");
  if (!customer) console.warn("! TEST_SHOPIFY_CUSTOMER_ID is blank: orders and settlements will refuse until it's set.");

  await ensure("Test Stockist", {
    name: "Test Stockist", currency: "USD", shopifyCustomerId: customer, stockist: true, displayPartner: false,
    contactName: "Test Stockist", phone: env("TEST_STOCKIST_PHONE"), email: env("TEST_STOCKIST_EMAIL") || "stockist@example.com",
  });
  const partner = await ensure("Test Display Partner", {
    name: "Test Display Partner", currency: "MXN", shopifyCustomerId: customer, stockist: false, displayPartner: true,
    contactName: "Test Partner", phone: env("TEST_PARTNER_PHONE"), email: env("TEST_PARTNER_EMAIL") || "partner@example.com",
  });

  const d = await db();
  const [outlet] = await d.select().from(outlets).where(eq(outlets.wholesalerId, partner.id));
  if (outlet) {
    console.log(`= outlet ${outlet.name} already exists`);
  } else {
    await addOutlet({
      wholesalerId: partner.id, name: "Test Lobby Shop", city: "Cancún", country: "MX",
      shopifyLocationId: env("TEST_OUTLET_LOCATION_ID"), parPerSku: 6, settlementDays: 15,
    });
    const [created] = await d.select().from(outlets).where(eq(outlets.wholesalerId, partner.id));
    await addDisplay({ outletId: created.id, kind: "tower", serial: "TEST-TOWER-1", installedAt: "" });
    console.log("+ outlet Test Lobby Shop with Tower TEST-TOWER-1");
  }

  const contacts = await d.select().from(wholesaleContacts);
  console.log("\nContacts the bot and portal will recognise:");
  for (const c of contacts) console.log(`  ${c.name}: ${c.phone ? `+${c.phone}` : "no phone"} · ${c.email ?? "no email"}`);
}

main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
