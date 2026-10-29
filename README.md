# Truecolors Design

Phase 1 of the [product spec](https://claude.ai/artifact/X7K9eXduSTmgfecuxC6Cp5). Invited designers create a colour-changing shirt design with AI, pre-sell it to US buyers, and earn a share of every sale once it reaches 100 pre-orders.

## Run it locally

Node 22 is installed in `~/.local/node`, so add it to your PATH first:

```bash
export PATH=$HOME/.local/node/bin:$PATH
```

```bash
npm install
cp .env.example .env.local
npx tsx --env-file=.env.local scripts/seed.ts "Kevin"
npm run dev
```

The seed command prints an invite code. Open http://localhost:3000/join, sign up, and use the login link shown on the page (`DEV_SHOW_LOGIN_LINKS=true`). Emails in `ADMIN_EMAILS` also get the Admin page.

With the defaults, the app runs on an embedded Postgres in `.pglite/` and the `mock` AI provider, which draws placeholder art. You can go through the whole studio flow without any keys.

```bash
npm test
```

```bash
npm run typecheck
```

## What's in Phase 1

| Module | Where |
| --- | --- |
| Invite-only sign-up, email login links, credits | `src/lib/auth/session.ts` |
| Studio: house-style presets, line art, refine, moderation | `src/lib/design/service.ts`, `src/lib/ai/` |
| Shade and sun layers, print files (max 7 colours, 14×16 in at 300 dpi) | `src/lib/design/layers.ts` |
| Mockups on photo templates, shade-to-sun reveal video | `src/lib/media/` |
| Campaigns: review queue, Shopify pre-order product, US catalog | `src/lib/campaigns/service.ts`, `src/lib/shopify/campaigns.ts` |
| Charge when funded, 3-day card retries, cancel when missed | `tick()` in `src/lib/campaigns/service.ts` |
| Designer share link (`?ref=`) and 10% / 15% royalty ledger | `src/lib/royalties/ledger.ts`, `shopify-theme/tc-designer-ref.liquid` |
| Production batches: Cancún work order and Las Vegas inbound CSVs | `src/lib/production/batch.ts` |

Business rules (goal, prices, shares, retry window, print limits) all live in `src/lib/rules.ts`.

## How pre-sale payment works

1. **Checkout.** Campaign products use a Shopify pre-order selling plan that charges 0% at checkout, so Shopify saves the buyer's card.
2. **Goal reached.** Once pledges reach 100, `tick()` charges each saved card (`orderCreateMandatePayment`). Pledges that come in later are charged as they arrive.
3. **Failed cards.** A failed card is retried every 12 hours. After 3 days that order is cancelled.
4. **Goal missed.** If the campaign closes under 100, every order is cancelled and anything already charged is refunded. Nobody pays.
5. **Orders with other items.** Without Shopify Plus, Shopify can only charge an order's whole remaining balance. An order that holds pre-orders for more than one design is charged once every design in it has reached its goal. With `SHOPIFY_PLUS=true`, only the funded campaign's lines are charged. Anything that can't be charged or cancelled automatically goes to the "Needs a person" list on the Admin page.

`tick()` runs from `POST /api/cron/tick` (header `Authorization: Bearer $CRON_SECRET`). Run it every 15 minutes. You can also run it from the Admin page.

To see the studio dashboard with numbers in it, `npm run demo` (local database only) adds a demo designer with campaigns and pre-orders, drawn by the mock artist, and prints their login link.

## Before the first live campaign

- **Shopify custom app.**
  - Create a custom app on the store with these scopes:
    - `write_products`
    - `write_orders`
    - `read_orders`
    - `write_purchase_options`
    - `write_publications`
    - `read_customer_payment_methods`
    - `write_payment_mandate`
  - Set `SHOPIFY_ADMIN_TOKEN`, `SHOPIFY_WEBHOOK_SECRET`, and `SHOPIFY_US_PUBLICATION_ID` (the publication behind the United States catalog).
  - Run `npm run shopify:webhooks`.
- **Verify on a dev store.** The Shopify mutations follow the Admin GraphQL API but haven't been run against a store yet. On a development store, check all of the following:
  - `productCreate`
  - `productVariantsBulkCreate`
  - `sellingPlanGroupCreate` with a 0% deferred charge
  - `orderCreateMandatePayment`
  - `orderCancel` with a refund
  - the webhook payloads
- **Theme snippet.** Add `{% render 'tc-designer-ref' %}` to the live theme so share links credit the designer.
- **Designer agreement.** Set `DESIGNER_AGREEMENT_VERSION` once the lawyers sign off. Until then, the review queue refuses to approve campaigns.
- **Mockup templates.** Put the model photos in `templates/` and list them, with each photo's print box, in `templates/templates.json` (see `src/lib/media/mockups.ts`). Until then a drawn placeholder tee is used.
- **OpenAI.** Set `AI_PROVIDER=openai` and `OPENAI_API_KEY`.
- **Site photos and wordmark.** Run `npm run site:images` to make the Truecolors Design wordmark and the banner and "how it works" photos with the OpenAI image model, styled on the store's product photos and logo (7 images, one paid call each; the home banner is a shade and sun pair, made one from the other). They're saved in `public/site/`; commit them. To remake one, name it: `npm run site:images -- wordmark`. The prompts are in `src/lib/site-images.ts`. Until they exist, the pages use plain dark banners, numbered tiles and the store logo.
- **Social sign-in.** Designers can sign in with Google, Apple, X or Instagram, and connect those accounts in the studio. Each button switches on once its keys are in the environment (see `.env.example`); register `<APP_URL>/auth/<provider>/callback` as the redirect URL with each provider. Instagram sign-in only works for creator and business accounts. New people still need an invite code. The app keeps no tokens, so it can't post for designers; sharing is through their own link, one-tap posts and the downloadable reveal video.
- **Hosting.**
  - Postgres (`DATABASE_URL`).
  - A public `APP_URL`, `https://truecolors.design`: Shopify fetches product images from it.
  - Move file storage to S3-compatible storage (`src/lib/storage.ts`).
  - A mail provider for login links (`sendLoginLink`).

## Not in Phase 1

The following are left for later phases:
- buying credits
- AI-animated reveal videos
- editing a selected area of a design
- Ideogram for lettering
- automatic payouts (Phase 1 payouts are prepared by the app and marked paid by hand)
- B2B private mode
- posting straight to social platforms
- the UAE market
