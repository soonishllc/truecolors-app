// Business rules agreed in the product spec. Change them here, not in the code that uses them.

export const SIZES = ["S", "M", "L", "XL"] as const;
export type Size = (typeof SIZES)[number];

// Shown under "Size, fabric & care" on campaign pages. Each line is hidden until it's filled in, so only
// confirmed details from the blank-tee supplier go live. Size chart rows: { label: "Chest (in)", S: "36", ... }.
export const GARMENT: {
  fabric?: string;
  fit?: string;
  sizeChart?: ({ label: string } & Record<Size, string>)[];
} = {};

export const MARKET = "US" as const;
export const CURRENCY = "USD" as const;

export const PRICE_CENTS = 3600;
export const COMPARE_AT_CENTS = 4500;

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
export const REFERRALS_PER_REWARD = 5;

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
