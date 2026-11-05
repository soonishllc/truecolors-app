import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// A cookie jar the fan cookie can land in, so a confirmed fan is remembered within a test.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name) } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { recordOrder, relaunchCampaign, reviewCampaign, submitCampaign, tick } = await import("../src/lib/campaigns/service");
const { db } = await import("../src/lib/db/client");
const { campaigns, designs, emails, fanRewards, fans: fansTable, pledges, waitlist } = await import("../src/lib/db/schema");
const fans = await import("../src/lib/fans");
const challenges = await import("../src/lib/challenges");
const payouts = await import("../src/lib/payouts/methods");
const { fakeShopify, freshDb, order, readyDesigner } = await import("./helpers");
const { resetRateLimits } = await import("../src/lib/ratelimit");

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
  jar.clear();
  resetRateLimits();
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

describe("waitlist double opt-in", () => {
  it("emails a confirmation link instead of joining, and joins once the link is opened", async () => {
    const { user } = await readyDesigner("lina");
    const target = fans.designerTarget(user.id);
    const res = await fans.requestWaitlist("Someone@Example.com", target, "/d/lina");
    expect(res.joined).toBe(false);
    const d = await db();
    expect(await d.select().from(waitlist)).toHaveLength(0);

    const [mail] = (await d.select().from(emails)).filter((e) => e.to === "someone@example.com");
    expect(mail.subject).toBe("Confirm your email for Truecolors");
    const token = decodeURIComponent(mail.body.match(/token=([^\s]+)/)![1]);
    expect(await fans.verifyFan(token)).toBe("/d/lina");
    const rows = await d.select().from(waitlist);
    expect(rows.map((r) => [r.email, r.target])).toEqual([["someone@example.com", target]]);

    // Now confirmed in this browser: following another list joins straight away, with no email.
    const other = await readyDesigner("sami");
    const before = (await d.select().from(emails)).length;
    expect((await fans.requestWaitlist("someone@example.com", fans.designerTarget(other.user.id), "/me")).joined).toBe(true);
    expect(await d.select().from(waitlist)).toHaveLength(2);
    expect(await d.select().from(emails)).toHaveLength(before);

    // A different address typed in the same browser still has to confirm.
    expect((await fans.requestWaitlist("victim@example.com", target, "/me")).joined).toBe(false);
    expect(await d.select().from(waitlist)).toHaveLength(2);
  });

  it("refuses targets that aren't a campaign or designer list, and throttles repeat confirmations", async () => {
    await expect(fans.requestWaitlist("a@example.com", "designer:../../x", "/me")).rejects.toThrow(/Reload/);
    const { user } = await readyDesigner("noor");
    const target = fans.designerTarget(user.id);
    for (let i = 0; i < 3; i++) await fans.requestWaitlist("spam@example.com", target, "/me");
    await expect(fans.requestWaitlist("spam@example.com", target, "/me")).rejects.toThrow(/Too many emails/);
  });
});

describe("fan referrals", () => {
  it("earns a free-tee code for every 3 charged pre-orders through a fan's link, not counting their own", async () => {
    const { c } = await liveCampaign();
    const fan = await fans.ensureFan("sara@example.com");
    await recordOrder(order(c.shopifyProductId!, 1, { ref: fan.referralCode, email: "sara@example.com" }));
    for (let i = 0; i < 4; i++) await recordOrder(order(c.shopifyProductId!, 1, { ref: fan.referralCode }));
    for (let i = 0; i < 95; i++) await recordOrder(order(c.shopifyProductId!, 1));
    expect((await fans.referralStats(fan)).pending).toBe(4);
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

describe("friend codes", () => {
  it("makes one friend code per confirmed fan and live designer, and credits the link from the code on the order", async () => {
    const { c } = await liveCampaign();
    const fan = await fans.ensureFan("sara@example.com");
    const unconfirmed = await fans.ensureFan("lurker@example.com");
    const d = await db();
    await d.update(fansTable).set({ verifiedAt: start }).where(eq(fansTable.id, fan.id));
    await tick(at(DAY));
    expect(shop.friendCodes.sort()).toEqual([`FRIEND-${fan.referralCode.toUpperCase()}`, "FRIEND-MAYA"].sort());
    expect(shop.friendCodes).not.toContain(`FRIEND-${unconfirmed.referralCode.toUpperCase()}`);
    expect(await fans.friendCodeFor(fan.referralCode)).toBe(`FRIEND-${fan.referralCode.toUpperCase()}`);
    await tick(at(2 * DAY));
    expect(shop.friendCodes).toHaveLength(2);

    // Straight to checkout skips the product page, so the only sign of the link is the friend code.
    await recordOrder(order(c.shopifyProductId!, 1, { discountCode: `FRIEND-${fan.referralCode.toUpperCase()}` }));
    expect((await fans.referralStats(fan)).pending).toBe(1);
    await recordOrder(order(c.shopifyProductId!, 1, { discountCode: "FRIEND-MAYA" }));
    const viaDesigner = await d.select().from(pledges).where(eq(pledges.viaDesignerLink, true));
    expect(viaDesigner).toHaveLength(1);
  });
});

describe("after checkout", () => {
  it("emails each new backer their numbers and a link back to the design, once per order", async () => {
    const { c } = await liveCampaign();
    await recordOrder(order(c.shopifyProductId!, 1, { email: "first@example.com" }));
    const pair = order(c.shopifyProductId!, 2, { email: "pair@example.com" });
    await recordOrder(pair);
    await recordOrder(pair);
    const [mail] = await sent(`backed:${pair.id}:`);
    expect(await sent(`backed:${pair.id}:`)).toHaveLength(1);
    expect(mail.to).toBe("pair@example.com");
    expect(mail.subject).toBe("You're #002 to #003: Marina Sunset");
    expect(mail.body).toContain("?backed=");
    const fan = (await db()).select().from(fansTable).where(eq(fansTable.email, "pair@example.com"));
    expect((await fan)[0].verifiedAt).not.toBeNull();
    expect(await fans.backerNumbers(c.id, "pair@example.com")).toEqual([2, 3]);
  });
});
