import Anthropic from "@anthropic-ai/sdk";
import { config } from "../src/lib/config";
import { accessToken, fedexReady } from "../src/lib/fedex/client";
import { gorgias } from "../src/lib/gorgias/client";
import { CURRENCY_COUNTRY, PARTNER_PRICE, SHIP_FROM, WHOLESALE_CURRENCIES } from "../src/lib/rules";
import { admin } from "../src/lib/shopify/client";
import { locationStock, variantPrices, wholesaleCatalog } from "../src/lib/shopify/wholesale";

// Checks everything the wholesale bot, portal and orders depend on, before the broader test. It only reads:
// nothing is created in Shopify, Gorgias, FedEx or Anthropic. Run it after each round of setup.

let failed = 0;
const pass = (what: string, detail = "") => console.log(`  ✓ ${what}${detail ? `: ${detail}` : ""}`);
const fail = (what: string, detail: string) => {
  failed++;
  console.log(`  ✗ ${what}: ${detail}`);
};
async function check(what: string, fn: () => Promise<string | void>) {
  try {
    pass(what, (await fn()) ?? "");
  } catch (e) {
    fail(what, (e as Error).message);
  }
}
const need = (value: unknown, what: string) => {
  if (!value) throw new Error(`${what} is blank`);
};

async function main() {
  const c = config();

  console.log("\nSettings");
  for (const [key, why] of [
    ["ANTHROPIC_API_KEY", "the bot"], ["GORGIAS_DOMAIN", "WhatsApp"], ["GORGIAS_USERNAME", "WhatsApp"], ["GORGIAS_API_KEY", "WhatsApp"],
    ["GORGIAS_WEBHOOK_SECRET", "WhatsApp"], ["SHOPIFY_ADMIN_TOKEN", "everything"], ["SHOPIFY_WEBHOOK_SECRET", "paid orders"],
    ["SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID", "portal sign-in"], ["SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET", "portal sign-in"],
    ["WHOLESALE_LOCATION_ID", "Cancún stock, stockist orders and display restocks"],
    ["WHOLESALE_BANK_DETAILS", "bank transfers"], ["FEDEX_API_KEY", "shipping"], ["FEDEX_SECRET_KEY", "shipping"], ["FEDEX_ACCOUNT_NUMBER", "shipping"],
  ] as const) {
    if (c[key]) pass(key);
    else fail(key, `blank (needed for ${why})`);
  }
  if (!c.APP_URL.startsWith("https://")) fail("APP_URL", `${c.APP_URL}: Gorgias, Shopify and FedEx need a public https address`);
  else pass("APP_URL", c.APP_URL);
  if (c.FEDEX_SANDBOX) pass("FEDEX_SANDBOX", "on (test shipments)");
  else fail("FEDEX_SANDBOX", "off: shipments will be real");

  console.log("\nBusiness rules (src/lib/rules.ts)");
  const shipFromMissing = (["street", "postalCode", "phone"] as const).filter((k) => !SHIP_FROM[k]);
  if (shipFromMissing.length) fail("SHIP_FROM", `missing ${shipFromMissing.join(", ")}: FedEx booking stays off`);
  else pass("SHIP_FROM", `${SHIP_FROM.street}, ${SHIP_FROM.city}`);
  for (const cur of WHOLESALE_CURRENCIES) {
    if (PARTNER_PRICE[cur] !== undefined) pass(`Partner price ${cur}`, String(PARTNER_PRICE[cur]));
    else fail(`Partner price ${cur}`, "not set: settlements in this currency wait for a price");
  }

  console.log("\nShopify");
  const catalog = await wholesaleCatalog().catch((e) => {
    fail("Wholesale catalog", (e as Error).message);
    return undefined;
  });
  if (catalog?.length) {
    const skus = catalog.flatMap((p) => p.sizes);
    pass("Wholesale catalog", `${catalog.length} designs, ${skus.length} SKUs, ${catalog.filter((p) => p.exclusiveTo).length} exclusive`);
    const noSku = skus.filter((s) => !s.sku);
    if (noSku.length) fail("SKUs", `${noSku.length} variants have no SKU; the bot orders by SKU`);
    for (const cur of WHOLESALE_CURRENCIES) {
      await check(`Retail prices in ${cur}`, async () => {
        const prices = await variantPrices(skus.map((s) => s.variantId), CURRENCY_COUNTRY[cur]);
        const wrong = skus.filter((s) => prices.get(s.variantId)?.currency !== cur);
        if (wrong.length) throw new Error(`${wrong.length} of ${skus.length} SKUs have no ${cur} price in the ${CURRENCY_COUNTRY[cur]} market`);
        return `${skus.length} SKUs`;
      });
    }
  } else if (catalog) {
    fail("Wholesale catalog", `no active products in the "${c.WHOLESALE_COLLECTION_HANDLE}" collection`);
  }
  for (const [label, id] of [["Cancún", c.WHOLESALE_LOCATION_ID]] as const) {
    if (!id) continue;
    await check(`${label} location ${id}`, async () => {
      const lines = await locationStock(id);
      return `${lines.reduce((s, l) => s + l.available, 0)} shirts available across ${lines.length} SKUs`;
    });
  }
  await check("Webhook for paid orders", async () => {
    const data = await admin<{ webhookSubscriptions: { nodes: { topic: string; endpoint: { __typename: string; callbackUrl?: string } }[] } }>(
      `{ webhookSubscriptions(first: 50) { nodes { topic endpoint { __typename ... on WebhookHttpEndpoint { callbackUrl } } } } }`,
    );
    const want = `${c.APP_URL}/api/webhooks/shopify`;
    const hit = data.webhookSubscriptions.nodes.find((n) => n.topic === "ORDERS_CREATE" && n.endpoint.callbackUrl === want);
    if (!hit) throw new Error(`no ORDERS_CREATE subscription to ${want}; run npm run shopify:webhooks`);
    return want;
  });
  await check("Customer account sign-in", async () => {
    const r = await fetch(`https://${c.SHOPIFY_STORE_DOMAIN}/.well-known/openid-configuration`);
    if (!r.ok) throw new Error(`discovery answered ${r.status}; turn on new customer accounts`);
    return "discovery found";
  });

  console.log("\nGorgias");
  await check("API access and WhatsApp", async () => {
    need(c.GORGIAS_DOMAIN, "GORGIAS_DOMAIN");
    const res = await gorgias<{ data: { type: string; name: string; http?: { url?: string } }[] }>("/integrations?limit=100");
    const types = res.data.map((i) => i.type);
    if (!types.includes("whatsapp")) throw new Error("no WhatsApp integration connected");
    const hook = res.data.find((i) => i.type === "http" && i.http?.url?.startsWith(`${c.APP_URL}/api/gorgias`));
    if (!hook) throw new Error(`WhatsApp is connected, but no HTTP integration posts to ${c.APP_URL}/api/gorgias`);
    return `WhatsApp connected; HTTP integration "${hook.name}"`;
  });

  console.log("\nFedEx");
  await check("API sign-in", async () => {
    need(c.FEDEX_API_KEY, "FEDEX_API_KEY");
    await accessToken();
    return `${c.FEDEX_SANDBOX ? "sandbox" : "live"}; booking ${fedexReady() ? "ready" : "still off until SHIP_FROM is filled in"}`;
  });

  console.log("\nClaude");
  await check(`Model ${c.BOT_MODEL}`, async () => {
    need(c.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY");
    const m = await new Anthropic({ apiKey: c.ANTHROPIC_API_KEY }).models.retrieve(c.BOT_MODEL);
    return m.display_name;
  });

  console.log(failed ? `\n${failed} to fix before the broader test.` : "\nEverything's ready for the broader test.");
}

main().then(() => process.exit(failed ? 1 : 0), (e) => { console.error(e); process.exit(1); });
