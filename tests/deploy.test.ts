import { beforeEach, describe, expect, it } from "vitest";

const { tick } = await import("../src/lib/campaigns/service");
const { config, productionProblems, resetConfig } = await import("../src/lib/config");
const { freshDb } = await import("./helpers");

const secret = "x".repeat(40);
const good = {
  APP_URL: "https://truecolors.design", DATABASE_URL: "postgres://db", S3_BUCKET: "files",
  S3_ACCESS_KEY_ID: "id", S3_SECRET_ACCESS_KEY: "key", SESSION_SECRET: secret, CRON_SECRET: secret,
  PAYOUT_ENCRYPTION_KEY: secret, DEV_SHOW_LOGIN_LINKS: false,
};

describe("production settings", () => {
  it("accepts a complete production setup", () => {
    expect(productionProblems({ ...config(), ...good })).toEqual([]);
  });

  it("refuses local defaults", () => {
    resetConfig();
    const problems = productionProblems({ ...config(), DATABASE_URL: undefined, S3_BUCKET: undefined, DEV_SHOW_LOGIN_LINKS: true });
    expect(problems.join("\n")).toMatch(/APP_URL/);
    expect(problems.join("\n")).toMatch(/DATABASE_URL/);
    expect(problems.join("\n")).toMatch(/S3_BUCKET/);
    expect(problems.join("\n")).toMatch(/CRON_SECRET/);
    expect(problems.join("\n")).toMatch(/DEV_SHOW_LOGIN_LINKS/);
  });
});

describe("cron tick", () => {
  beforeEach(freshDb);

  it("skips a run that starts while another is still going", async () => {
    const [first, second] = await Promise.all([tick(), tick()]);
    expect(first).toEqual([]);
    expect(second).toEqual(["Already running, skipped."]);
    expect(await tick()).toEqual([]);
  });
});
