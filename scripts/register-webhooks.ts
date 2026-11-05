import { config } from "../src/lib/config";
import { admin, ok, type UserErrors } from "../src/lib/shopify/client";

const TOPICS = ["ORDERS_CREATE", "ORDERS_PAID", "ORDERS_CANCELLED", "REFUNDS_CREATE", "FULFILLMENTS_CREATE"];

async function main() {
  const callbackUrl = `${config().APP_URL}/api/webhooks/shopify`;
  for (const topic of TOPICS) {
    const res = await admin<{ webhookSubscriptionCreate: { userErrors: UserErrors } }>(
      `mutation($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
        webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) { userErrors { field message } }
      }`,
      { topic, sub: { uri: callbackUrl, format: "JSON" } },
    );
    ok(res.webhookSubscriptionCreate, topic);
    console.log(`${topic} -> ${callbackUrl}`);
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
