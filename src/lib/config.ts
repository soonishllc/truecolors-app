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
