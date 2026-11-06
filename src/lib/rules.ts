// Business rules agreed in the product spec. Change them here, not in the code that uses them.

export const SIZES = ["S", "M", "L", "XL"] as const;
export type Size = (typeof SIZES)[number];

// Shown under "Size, fabric & care" on campaign pages. Each line is hidden until it's filled in, so only
// confirmed details from the blank-tee supplier go live. Size chart rows: { label: "Chest (in)", S: "36", ... }.
export const GARMENT: {
  fabric?: string;
  fit?: string;
  care?: string;
  sizeChart?: ({ label: string } & Record<Size, string>)[];
} = {
  fabric: "100% cotton",
  // American Cotton's men's crew neck (style TCOMADC), from its size guide. Chest is measured flat across, armpit
  // to armpit; the guide's tolerance is ±1.9 cm across and ±2.5 cm in length.
  fit: "Classic unisex crew neck, true to size. Between sizes, or want it relaxed? Go one up.",
  care: "Wash it like any cotton tee. The print lasts as long as the shirt does.",
  sizeChart: [
    { label: "Chest, flat (cm)", S: "47", M: "51", L: "56", XL: "61" },
    { label: "Length (cm)", S: "70", M: "73", L: "76", XL: "78" },
    { label: "Chest, flat (in)", S: "18", M: "20", L: "22", XL: "24" },
    { label: "Length (in)", S: "27¾", M: "28¾", L: "29¾", XL: "30¾" },
  ],
};

// Delivery as set in the store's shipping settings (Shopify: General profile), shown next to prices. UAE orders go
// out next day from Dubai; the USA's rate is set in AED in Shopify (AED 36.69, free from AED 250), shown in dollars.
export const SHIPPING = {
  AE: "Next-day UAE delivery: AED 25, free over AED 200. Gulf: AED 99 with customs included",
  US: "US shipping from Las Vegas: $9.99, free over $68",
} as const;

// Pre-orders sell in both of the store's markets, as one campaign with one goal counted across both. The UAE pays
// the store's base price in AED; the USA pays from its own price list in USD. Compare-at is the "later" price
// shown struck through: $45, and AED 165 as its placeholder equivalent until Truecolors confirms it.
export const PREORDER_MARKETS = ["AE", "US"] as const;
export type PreorderMarket = (typeof PREORDER_MARKETS)[number];
export const PREORDER_PRICE: Record<PreorderMarket, { currency: "AED" | "USD"; cents: number; compareAtCents: number; label: string }> = {
  AE: { currency: "AED", cents: 12900, compareAtCents: 16500, label: "UAE" },
  US: { currency: "USD", cents: 3600, compareAtCents: 4500, label: "USA" },
};
// Visitors in the UAE and the rest of the GCC see the UAE store; everyone else sees the USA store. The same list is in theme/snippets/tc-market-from-location.liquid; the Shopify markets need these
// countries too, or checkout won't ship to them.
export const UAE_MARKET_COUNTRIES = ["AE", "SA", "KW", "QA", "BH", "OM"] as const;
export const marketForCountry = (country: string | null | undefined): PreorderMarket =>
  country && (UAE_MARKET_COUNTRIES as readonly string[]).includes(country.toUpperCase()) ? "AE" : "US";

// The store's base currency is AED, so the UAE price is what goes on the product itself.
export const BASE_MARKET: PreorderMarket = "AE";
export const MARKET = PREORDER_MARKETS.join(",");
export const CURRENCY = PREORDER_PRICE[BASE_MARKET].currency;
export const PRICE_CENTS = PREORDER_PRICE[BASE_MARKET].cents;

export const FUNDING_GOAL = 100;
export const STRETCH_GOALS = [250, 500];
// What each stretch goal unlocks for every backer. Placeholders: Truecolors to confirm.
export const STRETCH_REWARDS: Record<number, string> = {
  250: "Every shirt ships with a numbered certificate card signed by the designer",
  500: "Every backer gets the design as a free sticker sheet",
};
export const CAMPAIGN_DAYS = 21;
export const MAX_LIVE_CAMPAIGNS_PER_DESIGNER = 2;
export const RELAUNCHES_ALLOWED = 1;

// Designer share in basis points of net sales (price minus discounts, before tax and shipping).
export const SHARE_BPS = 1000;
export const SHARE_OWN_LINK_BPS = 1500;

// Failed cards are retried for this long after the first attempt, then the order is cancelled.
export const CHARGE_RETRY_HOURS = 72;
export const CHARGE_RETRY_EVERY_HOURS = 12;

// Earnings become payable once the return window has closed, plus a buffer.
export const RETURN_WINDOW_DAYS = 7;
export const PAYOUT_BUFFER_DAYS = 7;

// A fan's own link: every this many pre-orders it brings in (once charged) earns them a free tee.
export const REFERRALS_PER_REWARD = 3;
// The friend who arrives on someone's link gets this much off their pre-order (a Shopify code per link). And two
// or more of the same design are this much off each (one automatic discount per campaign product). Placeholders
// until Truecolors confirms them; the two don't stack, the bigger applies.
export const FRIEND_DISCOUNT_PERCENT = 10;
export const TWO_PACK_PERCENT = 10;
export const friendCode = (ref: string) => `FRIEND-${ref.toUpperCase()}`;

// Design challenges: how many designs one designer can enter in a challenge.
export const CHALLENGE_ENTRIES_PER_DESIGNER = 2;

export const STARTING_CREDITS = 30;
export const CREDIT_COST = { line_art: 1, colour: 1, refine: 1 } as const;

// Cancún print limits. The black line art counts as one colour until Cancún says otherwise.
export const PRINT = {
  // The sun layer prints in full tone (shading and gradients), as on the shirts already made in Cancún, so the
  // colour image isn't reduced to spot colours. Set to false to go back to at most maxColours flat inks.
  fullColour: true,
  maxColours: 7,
  lineArtCountsAsColour: true,
  widthIn: 14,
  heightIn: 16,
  dpi: 300,
  // As Cancún confirmed: grey in the black layer and the sun colour are both halftoned at 55 lines per inch, and
  // the black prints first, with the sun colour over it.
  halftoneLpi: 55,
  blackFirst: true,
};

export function shareBps(viaDesignerLink: boolean): number {
  return viaDesignerLink ? SHARE_OWN_LINK_BPS : SHARE_BPS;
}

export function royaltyCents(netCents: number, bps: number): number {
  return Math.round((netCents * bps) / 10_000);
}

export function sku(designCode: string, size: Size): string {
  return `TC-${designCode}-WHT-${size}`;
}

// ---- Wholesale ---------------------------------------------------------------------------------------
// Stockists buy outright and pay upfront; display partners hold Truecolors stock on consignment.

export const WHOLESALE_CURRENCIES = ["AED", "USD", "MXN"] as const;
export type WholesaleCurrency = (typeof WHOLESALE_CURRENCIES)[number];

// Placeholders until Truecolors confirms the numbers: the minimum shirts per stockist order, and the
// discount off retail from each quantity up.
export const WHOLESALE_MIN_UNITS = 24;
export const WHOLESALE_TIERS: { fromUnits: number; discountBps: number }[] = [
  { fromUnits: 24, discountBps: 4000 },
  { fromUnits: 100, discountBps: 4500 },
  { fromUnits: 250, discountBps: 5000 },
];

// Display partners pay this per shirt sold; the MSRP guests pay is twice it, VAT included. AED and USD
// are still to be confirmed, so they're left out until they are.
export const PARTNER_PRICE: Partial<Record<WholesaleCurrency, number>> = { MXN: 150 };
export const PARTNER_MSRP_MULTIPLE = 2;

export const SETTLEMENT_DAYS = 15;
// Once a period ends without a sales report: a reminder a day, this many times, then the team visits to count.
export const SETTLEMENT_REMINDERS = 2;
export const REMINDER_HOURS = 24;

export function wholesaleDiscountBps(units: number): number | undefined {
  return WHOLESALE_TIERS.filter((t) => units >= t.fromUnits).at(-1)?.discountBps;
}

// Stockist prices follow the store's own retail price in the stockist's market, less their tier discount.
export const CURRENCY_COUNTRY: Record<WholesaleCurrency, string> = { AED: "AE", USD: "US", MXN: "MX" };

// A quote holds its prices, and the order holds its stock, this long before they lapse.
export const QUOTE_HOURS = 48;

// Stockist orders ship by FedEx from the Cancún hub, duties paid by Truecolors. The hub's address, carton
// sizes and customs details are placeholders until Truecolors confirms them; FedEx booking stays off until
// SHIP_FROM is filled in.
export const SHIP_FROM = {
  company: "Truecolors",
  person: "",
  phone: "",
  street: "",
  city: "Cancún",
  state: "QR",
  postalCode: "",
  country: "MX",
};
export const SHIRTS_PER_CARTON = 50;
export const SHIRT_KG = 0.22;
export const CARTON_KG = 0.6;
export const HS_CODE = "610910";
export const CUSTOMS_DESCRIPTION = "Cotton T-shirts, printed";
