import { describe, expect, it } from "vitest";
import { planRedirects, wantedRedirects } from "../src/lib/shopify/market-redirects";

describe("market redirects", () => {
  it("sends a product's link in the store that doesn't sell it to the store that does", () => {
    expect(wantedRedirects([
      { handle: "habibi", ae: true, us: false },
      { handle: "nyc", ae: false, us: true },
      { handle: "both", ae: true, us: true },
      { handle: "neither", ae: false, us: false },
    ])).toEqual([
      { path: "/en-us/products/habibi", target: "/products/habibi" },
      { path: "/products/nyc", target: "/en-us/products/nyc" },
    ]);
  });

  it("adds what's missing, removes what no longer applies, and leaves other redirects alone", () => {
    const plan = planRedirects(
      [{ handle: "habibi", ae: true, us: false }, { handle: "now-both", ae: true, us: true }, { handle: "new", ae: false, us: true }],
      [
        { id: "1", path: "/en-us/products/habibi", target: "/products/habibi" },
        { id: "2", path: "/en-us/products/now-both", target: "/products/now-both" },
        { id: "3", path: "/products/old-name", target: "/products/new-name" },
        { id: "4", path: "/pages/about", target: "/pages/our-story" },
      ],
    );
    expect(plan.create).toEqual([{ path: "/products/new", target: "/en-us/products/new" }]);
    expect(plan.remove).toEqual(["2"]);
  });

  it("does nothing when everything is in step", () => {
    const plan = planRedirects([{ handle: "nyc", ae: false, us: true }], [{ id: "1", path: "/products/nyc", target: "/en-us/products/nyc" }]);
    expect(plan).toEqual({ create: [], remove: [] });
  });
});
