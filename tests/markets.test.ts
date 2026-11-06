import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { UAE_MARKET_COUNTRIES, marketForCountry } from "../src/lib/rules";

describe("market by location", () => {
  it("shows the UAE store in the UAE and the GCC, and the USA store everywhere else", () => {
    for (const c of ["AE", "SA", "qa", "KW", "BH", "OM"]) expect(marketForCountry(c)).toBe("AE");
    for (const c of ["EG", "MA", "JO"]) expect(marketForCountry(c)).toBe("US");
    for (const c of ["US", "MX", "FR", "GB", "IN", "TR"]) expect(marketForCountry(c)).toBe("US");
    expect(marketForCountry(undefined)).toBe("US");
  });

  it("uses the same countries in the store theme as in the app", () => {
    const snippet = readFileSync("theme/snippets/tc-market-from-location.liquid", "utf8");
    const list = JSON.parse(snippet.match(/var UAE = (\[[^\]]*\])/)![1]) as string[];
    expect(list).toEqual([...UAE_MARKET_COUNTRIES]);
  });
});
