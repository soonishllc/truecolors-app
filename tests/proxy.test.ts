import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { appPathFor, proxyPathFor } from "../src/lib/proxy/shell";
import { verifyProxyQuery } from "../src/lib/proxy/signature";

const SECRET = "hush";
const now = Date.UTC(2026, 10, 4, 12);
const ts = String(Math.floor(now / 1000));

// Built by hand from Shopify's description, not with the code under test.
function signed(fields: [string, string][]) {
  const message = fields.map(([k, v]) => `${k}=${v}`).sort().join("");
  const q = new URLSearchParams(fields);
  q.set("signature", createHmac("sha256", SECRET).update(message).digest("hex"));
  return q;
}

describe("app proxy signature", () => {
  const base: [string, string][] = [
    ["shop", "truecolors.myshopify.com"], ["logged_in_customer_id", "9101"], ["path_prefix", "/apps/truecolors"], ["timestamp", ts],
  ];

  it("accepts Shopify's signature, including for a signed-out visitor", () => {
    expect(verifyProxyQuery(signed(base), SECRET, now)).toBe(true);
    expect(verifyProxyQuery(signed([...base.filter(([k]) => k !== "logged_in_customer_id"), ["logged_in_customer_id", ""]]), SECRET, now)).toBe(true);
  });

  it("rejects a changed customer, a wrong secret and an old request", () => {
    const q = signed(base);
    q.set("logged_in_customer_id", "9102");
    expect(verifyProxyQuery(q, SECRET, now)).toBe(false);
    expect(verifyProxyQuery(signed(base), "other", now)).toBe(false);
    expect(verifyProxyQuery(signed(base), SECRET, now + 10 * 60_000)).toBe(false);
  });
});

describe("store paths", () => {
  it("maps store pages to app pages and back, and nothing else", () => {
    expect(appPathFor("")).toBe("/explore");
    expect(appPathFor("studio/designs/1")).toBe("/studio/designs/1");
    expect(appPathFor("wholesale/")).toBe("/wholesale");
    expect(appPathFor("admin")).toBeUndefined();
    expect(appPathFor("api/files/x")).toBeUndefined();
    expect(proxyPathFor("/explore")).toBe("");
  });
});
