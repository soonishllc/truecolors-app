import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { recordOrder, relaunchCampaign, reviewCampaign, submitCampaign, tick } = await import("../src/lib/campaigns/service");
const { db } = await import("../src/lib/db/client");
const { campaigns, designs, emails, fanRewards, pledges, waitlist } = await import("../src/lib/db/schema");
const fans = await import("../src/lib/fans");
const challenges = await import("../src/lib/challenges");
const payouts = await import("../src/lib/payouts/methods");
const { fakeShopify, freshDb, order, readyDesigner } = await import("./helpers");

const DAY = 86_400_000;
const start = new Date("2026-11-01T10:00:00Z");
const at = (ms: number) => new Date(start.getTime() + ms);
let shop: ReturnType<typeof fakeShopify>;

async function liveCampaign(handle = "maya") {
  const { user, design } = await readyDesigner(handle);
  const c = await submitCampaign(user.id, design.id, { title: "Marina Sunset", story: "" });
  await reviewCampaign("kevin@probablyfine.ae", c.id, true, "", start);
  const d = await db();
  return { user, c: (await d.select().from(campaigns).where(eq(campaigns.id, c.id)))[0] };
}

const sent = async (prefix: string) => {
  const d = await db();
  return (await d.select().from(emails)).filter((e) => e.key?.startsWith(prefix));
};

beforeEach(async () => {
  await freshDb();
  shop = fakeShopify();
});

describe("numbered editions", () => {
  it("numbers every shirt in pre-order order when a funded campaign closes, and tells each backer theirs", async () => {
    const { c } = await liveCampaign();
    await recordOrder(order(c.shopifyProductId!, 2, { email: "first@example.com" }));
    for (let i = 0; i < 99; i++) await recordOrder(order(c.shopifyProductId!, 1));
    await tick(at(DAY));
    await tick(at(21 * DAY));
    const d = await db();
    const [closed] = await d.select().from(campaigns).where(eq(campaigns.id, c.id));
    expect(closed.status).toBe("funded");
    expect(closed.editionSize).toBe(101);
    const [first] = await d.select().from(pledges).where(eq(pledges.email, "first@example.com"));
    expect(first.editionStart).toBe(1);
    const mail = (await sent("funded:")).find((e) => e.to === "first@example.com")!;
    expect(mail.subject).toContain("#1–2 of 101");
  });
});

describe("backer update emails", () => {
  it("sends each milestone once, only to people who'd pre-ordered by then", async () => {
    const { c } = await liveCampaign();
    for (let i = 0; i < 50; i++) await recordOrder(order(c.shopifyProductId!, 1));
    await tick(at(DAY));
    await tick(at(2 * DAY));
    expect(await sent("halfway:")).toHaveLength(50);
    await recordOrder(order(c.shopifyProductId!, 1, { email: "late@example.com" }));
    await tick(at(3 * DAY));
    expect((await sent("halfway:")).some((e) => e.to === "late@example.com")).toBe(false);
  });

  it("adds backers of a missed campaign to its comeback list, and emails the list when it relaunches", async () => {
    const { user, c } = await liveCampaign();
    await recordOrder(order(c.shopifyProductId!, 1, { email: "fan@example.com" }));
    await fans.joinWaitlist("stranger@example.com", fans.campaignTarget(c));
    await tick(at(21 * DAY));
    expect((await sent("missed:")).map((e) => e.to)).toEqual(["fan@example.com"]);

    const again = await relaunchCampaign(user.id, c.id);
    await reviewCampaign("kevin@probablyfine.ae", again.id, true, "", at(22 * DAY));
    const back = await sent(`waitlist:${again.id}`);
    expect(back.map((e) => e.to).sort()).toEqual(["fan@example.com", "stranger@example.com"]);
    expect(back[0].subject).toContain("is back");
  });

  it("emails a designer's followers when they launch", async () => {
    const { user, design } = await readyDesigner("omar");
    await fans.joinWaitlist("follower@example.com", fans.designerTarget(user.id));
    const c = await submitCampaign(user.id, design.id, { title: "Desert Rose", story: "" });
    await reviewCampaign("kevin@probablyfine.ae", c.id, true, "", start);
    const [mail] = await sent(`waitlist:${c.id}`);
    expect(mail.subject).toBe("omar just launched Desert Rose");
    const d = await db();
    expect((await d.select().from(waitlist))[0].notifiedAt).not.toBeNull();
  });
});

describe("fan referrals", () => {
  it("earns a free-tee code for every 5 charged pre-orders through a fan's link, not counting their own", async () => {
    const { c } = await liveCampaign();
    const fan = await fans.ensureFan("sara@example.com");
    await recordOrder(order(c.shopifyProductId!, 1, { ref: fan.referralCode, email: "sara@example.com" }));
    for (let i = 0; i < 5; i++) await recordOrder(order(c.shopifyProductId!, 1, { ref: fan.referralCode }));
    for (let i = 0; i < 94; i++) await recordOrder(order(c.shopifyProductId!, 1));
    expect((await fans.referralStats(fan)).pending).toBe(5);
    await tick(at(DAY));
    expect(shop.rewardCodes).toHaveLength(1);
    const d = await db();
    expect(await d.select().from(fanRewards)).toHaveLength(1);
    await tick(at(2 * DAY));
    expect(shop.rewardCodes).toHaveLength(1);
    expect((await sent("reward:"))[0].to).toBe("sara@example.com");
  });
});

describe("design challenges", () => {
  it("takes coloured entries while open, counts one vote per fan, and stops voting when it closes", async () => {
    const { user, design } = await readyDesigner();
    const ch = await challenges.createChallenge({
      title: "Summer", brief: "Sun", prize: "Launch", submitBy: at(7 * DAY), voteBy: at(14 * DAY),
    });
    await challenges.enterChallenge(user.id, ch.id, design.id, start);
    const d = await db();
    const [draft] = await d.insert(designs).values({ userId: user.id, title: "Draft", preset: "beach", prompt: "x", lineArtKey: "l.png" }).returning();
    await expect(challenges.enterChallenge(user.id, ch.id, draft.id, start)).rejects.toThrow(/Colour/);

    const [entry] = await challenges.entries(ch.id);
    const a = await fans.ensureFan("a@example.com");
    const b = await fans.ensureFan("b@example.com");
    await challenges.toggleVote(a.id, entry.id, at(8 * DAY));
    await challenges.toggleVote(b.id, entry.id, at(8 * DAY));
    await challenges.toggleVote(b.id, entry.id, at(8 * DAY));
    const [counted] = await challenges.entries(ch.id, a.id);
    expect(counted.votes).toBe(1);
    expect(counted.mine).toBe(true);
    await expect(challenges.toggleVote(b.id, entry.id, at(15 * DAY))).rejects.toThrow(/closed/);
    await expect(challenges.enterChallenge(user.id, ch.id, design.id, at(8 * DAY))).rejects.toThrow(/entries/);
  });
});

describe("payout details", () => {
  it("checks IBANs, US accounts and wallet addresses, and only stores them encrypted", async () => {
    expect(payouts.validIban("GB82 WEST 1234 5698 7654 32")).toBe(true);
    expect(payouts.validIban("GB82 WEST 1234 5698 7654 33")).toBe(false);
    expect(() => payouts.parsePayoutMethod("usdc", { network: "base", address: "0x123" })).toThrow(/valid Base/);
    expect(payouts.parsePayoutMethod("bank", {
      holder: "Maya", country: "US", bankName: "Chase", accountNumber: "000123456789", routing: "021000021",
    }).summary).toBe("Bank · Chase •••• 6789");

    const { user } = await readyDesigner();
    const summary = await payouts.savePayoutMethod(user.id, "bank", {
      holder: "Maya", country: "GB", bankName: "Westpac", iban: "GB82WEST12345698765432", swift: "WESTGB2L",
    });
    expect(summary).toBe("Bank · Westpac GB •••• 5432");
    const d = await db();
    const [row] = await d.select().from((await import("../src/lib/db/schema")).payoutMethods);
    expect(row.details).not.toContain("GB82WEST");
    expect((await payouts.payoutDetailsForAdmin(user.id))?.details).toMatchObject({ iban: "GB82WEST12345698765432" });
  });
});

describe("a fan's own page", () => {
  it("lists their pre-orders with edition numbers, and what they follow", async () => {
    const { user, c } = await liveCampaign();
    await recordOrder(order(c.shopifyProductId!, 2, { email: "Sara@Example.com" }));
    for (let i = 0; i < 99; i++) await recordOrder(order(c.shopifyProductId!, 1));
    await tick(at(DAY));
    await tick(at(21 * DAY));
    const fan = await fans.ensureFan("sara@example.com");
    await fans.joinWaitlist("sara@example.com", fans.designerTarget(user.id));

    const [mine] = await fans.fanPreorders(fan);
    expect(mine.c.title).toBe("Marina Sunset");
    expect(mine.editions).toEqual([1, 2]);
    const following = await fans.fanFollowing(fan.email);
    expect(following).toEqual([{ target: fans.designerTarget(user.id), label: "maya's next launch", href: "/d/maya" }]);
    await fans.leaveWaitlist(fan.email, following[0].target);
    expect(await fans.fanFollowing(fan.email)).toEqual([]);
  });
});
