import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeEach, describe, expect, it } from "vitest";
import { campaigns, pledges, users } from "../src/lib/db/schema";
import type { CampaignStatus } from "../src/lib/db/schema";
import { UserError } from "../src/lib/design/service";
import { normalizeInstagram, readAvatar, saveProfile, validateProfile, BIO_MAX } from "../src/app/studio/profile/profile";
import { listDesigners } from "../src/app/designers/query";
import { freshDb, readyDesigner } from "./helpers";

const base = { name: "Maya Haddad", bio: "", location: "", instagram: "" };

describe("profile validation", () => {
  it("accepts a bio up to 280 characters and refuses one longer", () => {
    expect(validateProfile({ ...base, bio: "a".repeat(BIO_MAX) }).bio).toHaveLength(BIO_MAX);
    expect(() => validateProfile({ ...base, bio: "a".repeat(BIO_MAX + 1) })).toThrow(UserError);
    expect(() => validateProfile({ ...base, bio: "a".repeat(BIO_MAX + 1) })).toThrow(/280/);
  });

  it("counts emoji as one character each, trims and blanks empty fields", () => {
    expect(validateProfile({ ...base, bio: "☀️".repeat(100) }).bio).toBeTruthy();
    const p = validateProfile({ name: "  Maya   Haddad ", bio: "  ", location: " Dubai ", instagram: "" });
    expect(p).toEqual({ name: "Maya Haddad", bio: null, location: "Dubai", instagram: null });
  });

  it("needs a name", () => {
    expect(() => validateProfile({ ...base, name: "   " })).toThrow(UserError);
    expect(() => validateProfile({ ...base, name: "x".repeat(61) })).toThrow(UserError);
  });

  it("takes an Instagram handle in any of the usual shapes", () => {
    expect(normalizeInstagram("maya.draws")).toBe("maya.draws");
    expect(normalizeInstagram("@Maya_Draws")).toBe("maya_draws");
    expect(normalizeInstagram("https://www.instagram.com/maya.draws/?hl=en")).toBe("maya.draws");
    expect(normalizeInstagram("instagram.com/maya")).toBe("maya");
    expect(normalizeInstagram("  ")).toBeNull();
  });

  it("refuses handles Instagram wouldn't allow", () => {
    for (const bad of ["maya draws", "maya!", ".maya", "maya.", "ma..ya", "a".repeat(31), "@", "<script>"]) {
      expect(() => normalizeInstagram(bad), bad).toThrow(UserError);
    }
  });
});

describe("avatar", () => {
  it("turns a photo into a 400x400 WebP", async () => {
    const jpg = await sharp({ create: { width: 900, height: 600, channels: 3, background: "#e8762a" } }).jpeg().toBuffer();
    const out = await sharp(await readAvatar(jpg)).metadata();
    expect(out).toMatchObject({ format: "webp", width: 400, height: 400 });
  });

  it("refuses files that aren't JPG, PNG or WebP", async () => {
    await expect(readAvatar(Buffer.from("not an image"))).rejects.toThrow(UserError);
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).gif().toBuffer();
    await expect(readAvatar(gif)).rejects.toThrow(UserError);
  });
});

describe("designers directory", () => {
  beforeEach(async () => {
    await freshDb();
  });

  let seq = 0;
  async function campaign(userId: string, designId: string, status: CampaignStatus, backed = 0, createdAt = new Date()) {
    const d = await (await import("../src/lib/db/client")).db();
    const n = ++seq;
    const [c] = await d.insert(campaigns).values({
      slug: `c-${n}`, designCode: `TC${n}`, designId, userId, title: `Design ${n}`, market: "US", status, goal: 30,
      stretchGoals: [], priceCents: 3600, currency: "USD", createdAt,
    }).returning();
    if (backed) {
      await d.insert(pledges).values({
        campaignId: c.id, shopifyOrderId: `o${n}`, orderName: `#${n}`, lineItemId: `l${n}`, size: "M", quantity: backed, netCents: 3600 * backed,
      });
    }
    return c;
  }

  it("is empty until someone has a public campaign", async () => {
    const { user, design } = await readyDesigner("maya");
    expect(await listDesigners()).toEqual([]);
    await campaign(user.id, design.id, "rejected");
    expect(await listDesigners()).toEqual([]);
  });

  it("lists designers with public campaigns, by shirts pre-ordered or by newest", async () => {
    const maya = await readyDesigner("maya");
    const omar = await readyDesigner("omar");
    const lena = await readyDesigner("lena");
    await campaign(maya.user.id, maya.design.id, "live", 4, new Date("2026-10-01"));
    await campaign(maya.user.id, maya.design.id, "funded", 40, new Date("2026-09-01"));
    await campaign(omar.user.id, omar.design.id, "live", 12, new Date("2026-11-01"));
    await campaign(lena.user.id, lena.design.id, "in_review", 0);

    await saveProfile(maya.user.id, { name: "Maya H", bio: "Skylines.", location: "Dubai", instagram: "@maya.draws" });

    const popular = await listDesigners();
    expect(popular.map((p) => p.handle)).toEqual(["maya", "omar"]);
    expect(popular[0]).toMatchObject({ name: "Maya H", location: "Dubai", stats: { launched: 2, preordered: 44, funded: 1, live: 1 } });
    // Live first on their card.
    expect(popular[0].thumbs[0].c.status).toBe("live");

    const fresh = await listDesigners("new");
    expect(fresh.map((p) => p.handle)).toEqual(["omar", "maya"]);

    const d = await (await import("../src/lib/db/client")).db();
    const [saved] = await d.select().from(users).where(eq(users.id, maya.user.id));
    expect(saved.instagram).toBe("maya.draws");
  });
});
