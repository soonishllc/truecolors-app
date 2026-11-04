import { z } from "zod";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

const schema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  SESSION_SECRET: z.string().min(16).default("dev-only-secret-change-me"),
  ADMIN_EMAILS: z.string().default(""),

  // Leave empty to run on an embedded Postgres (PGlite) stored in .pglite/.
  DATABASE_URL: z.string().optional(),
  STORAGE_DIR: z.string().default("./storage"),
  // S3-compatible file storage for production (Cloudflare R2: endpoint https://<account id>.r2.cloudflarestorage.com, region auto).
  S3_BUCKET: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default("auto"),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  // "mock" draws placeholder art locally so the whole flow runs without keys.
  AI_PROVIDER: z.enum(["openai", "mock"]).default("mock"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),

  SHOPIFY_STORE_DOMAIN: z.string().default("cjfxb1-ex.myshopify.com"),
  SHOPIFY_STOREFRONT_URL: z.string().url().default("https://truecolors.global/en-us"),
  SHOPIFY_ADMIN_TOKEN: z.string().optional(),
  SHOPIFY_API_VERSION: z.string().default("2026-10"),
  SHOPIFY_WEBHOOK_SECRET: z.string().optional(),
  // Plus can charge part of an order; without it, an order is only ever charged its whole balance.
  SHOPIFY_PLUS: bool,
  // Publication behind the "United States" market catalog.
  SHOPIFY_US_PUBLICATION_ID: z.string().optional(),

  // Blank until the lawyers sign off; campaigns cannot be approved while blank.
  DESIGNER_AGREEMENT_VERSION: z.string().default(""),

  // Social sign-in. Each button shows once its keys are set; redirect URLs are APP_URL/auth/<provider>/callback.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Apple: the Services ID, plus the Sign in with Apple key (.p8 contents, newlines as \n).
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_TEAM_ID: z.string().optional(),
  APPLE_KEY_ID: z.string().optional(),
  APPLE_PRIVATE_KEY: z.string().optional(),
  X_CLIENT_ID: z.string().optional(),
  X_CLIENT_SECRET: z.string().optional(),
  // Instagram API with Instagram Login: works for professional (creator or business) accounts only.
  INSTAGRAM_CLIENT_ID: z.string().optional(),
  INSTAGRAM_CLIENT_SECRET: z.string().optional(),
  // TikTok Login Kit (developers.tiktok.com), with the user.info.basic, .profile and .stats scopes.
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),

  // Email. With a Resend key, emails are sent; without one they're only logged (see Admin, Emails).
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Truecolors Design <hello@truecolors.design>"),

  // Encrypts designers' payout details. Production must set its own; changing it makes saved details unreadable.
  PAYOUT_ENCRYPTION_KEY: z.string().optional(),

  // Wholesale bot. WhatsApp runs through Gorgias: its HTTP integration posts each new ticket message to
  // APP_URL/api/gorgias with the header X-Truecolors-Secret, and the bot replies through Gorgias' REST API.
  ANTHROPIC_API_KEY: z.string().optional(),
  BOT_MODEL: z.string().default("claude-opus-5-5"),
  GORGIAS_DOMAIN: z.string().optional(),
  GORGIAS_USERNAME: z.string().optional(),
  GORGIAS_API_KEY: z.string().optional(),
  GORGIAS_WEBHOOK_SECRET: z.string().optional(),
  // The Shopify collection that holds what wholesalers can order.
  WHOLESALE_COLLECTION_HANDLE: z.string().default("wholesale-catalog"),
  // The Shopify location of the Cancún hub, which stockist orders ship from. Blank = stock across all locations.
  WHOLESALE_LOCATION_ID: z.string().optional(),
  // Wholesaler portal sign-in: a confidential client from Shopify's Customer Account API settings, with
  // APP_URL/wholesale/callback as its callback URL.
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: z.string().optional(),
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET: z.string().optional(),

  // Bank details sent to stockists who pay by transfer, as one block of text (newlines as \n).
  WHOLESALE_BANK_DETAILS: z.string().default(""),
  // FedEx Ship API for stockist orders from Cancún. FEDEX_SANDBOX=true uses FedEx's test environment.
  FEDEX_API_KEY: z.string().optional(),
  FEDEX_SECRET_KEY: z.string().optional(),
  FEDEX_ACCOUNT_NUMBER: z.string().optional(),
  FEDEX_SANDBOX: bool,
  FEDEX_SERVICE_TYPE: z.string().default("FEDEX_INTERNATIONAL_PRIORITY"),

  CRON_SECRET: z.string().default("dev-cron-secret"),
  DEV_SHOW_LOGIN_LINKS: bool,
});

export type Config = z.infer<typeof schema>;

let cached: Config | undefined;

export function config(): Config {
  cached ??= schema.parse(process.env);
  return cached;
}

// Tests change settings between cases.
export function resetConfig() {
  cached = undefined;
}

export function isAdminEmail(email: string): boolean {
  return config()
    .ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase());
}

// Run once when a production server starts: refuses to boot on settings that only make sense locally.
export function productionProblems(c: Config = config()): string[] {
  const problems: string[] = [];
  if (!c.APP_URL.startsWith("https://")) problems.push("APP_URL must be the https:// address of the site");
  if (!c.DATABASE_URL) problems.push("DATABASE_URL is required (the embedded database is for local use only)");
  if (!c.S3_BUCKET) problems.push("S3_BUCKET is required (local disk is wiped on every deploy)");
  if (c.S3_BUCKET && !(c.S3_ACCESS_KEY_ID && c.S3_SECRET_ACCESS_KEY)) problems.push("S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required");
  if (c.SESSION_SECRET.length < 32 || c.SESSION_SECRET.includes("change-me") || c.SESSION_SECRET.startsWith("dev-only"))
    problems.push("SESSION_SECRET must be 32+ random characters");
  if (c.CRON_SECRET.length < 32 || c.CRON_SECRET.includes("change-me") || c.CRON_SECRET.startsWith("dev-"))
    problems.push("CRON_SECRET must be 32+ random characters");
  if (!c.PAYOUT_ENCRYPTION_KEY || c.PAYOUT_ENCRYPTION_KEY.length < 32) problems.push("PAYOUT_ENCRYPTION_KEY must be 32+ random characters");
  if (c.DEV_SHOW_LOGIN_LINKS) problems.push("DEV_SHOW_LOGIN_LINKS must be off");
  return problems;
}
