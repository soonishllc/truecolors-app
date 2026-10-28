// Business rules agreed in the product spec. Change them here, not in the code that uses them.

export const SIZES = ["S", "M", "L", "XL"] as const;
export type Size = (typeof SIZES)[number];

export const MARKET = "US" as const;
export const CURRENCY = "USD" as const;

export const PRICE_CENTS = 3600;
export const COMPARE_AT_CENTS = 4500;

export const FUNDING_GOAL = 100;
export const STRETCH_GOALS = [250, 500];
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

export const STARTING_CREDITS = 30;
export const CREDIT_COST = { line_art: 1, colour: 1, refine: 1 } as const;

// Cancún print limits. The black line art counts as one colour until Cancún says otherwise.
export const PRINT = {
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
