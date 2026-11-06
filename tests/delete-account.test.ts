import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteAccount, deletionBlockers } from "../src/lib/auth/delete-account";
import { campaigns, designs, identities, media, payoutMethods, pushTokens, royaltyEntries, users } from "../src/lib/db/schema";
import { freshDb, readyDesigner } from "./helpers";

const database = async () => (await import("../src/lib/db/client")).db();

async function campaign(userId: string, designId: string, status: "live" | "shipped") {
  const d = await database();
  const [c] = await d.insert(campaigns).values({
    slug: `c-${status}`, designCode: `TC${status}`, designId, userId, title: "Marina Sunset", market: "US", status, goal: 30,
    stretchGoals: [], priceCents: 3600, currency: "USD",
  }).returning();
  return c;
}

describe("deleting an account", () => {
  beforeEach(async () => {
    await freshDb();
  });

  it("waits while a pre-order is running or earnings are owed", async () => {
    const { user, design } = await readyDesigner("maya");
    const c = await campaign(user.id, design.id, "live");
    expect((await deletionBlockers(user.id))[0]).toMatch(/still on pre-order/);
    await expect(deleteAccount(user.id)).rejects.toThrow(/still on pre-order/);

    const d = await database();
    await d.update(campaigns).set({ status: "shipped" }).where(eq(campaigns.id, c.id));
    await d.insert(royaltyEntries).values({
      userId: user.id, campaignId: c.id, kind: "earning", sourceRef: "earning", rateBps: 1000, baseCents: 3600, amountCents: 360, currency: "USD",
    });
    expect((await deletionBlockers(user.id))[0]).toMatch(/earnings we haven't paid/);
  });

  it("clears personal details and drafts, keeps launched designs, and no session finds the account", async () => {
    const { user, design: launched } = await readyDesigner("maya");
    await campaign(user.id, launched.id, "shipped");
    const d = await database();
    const [draft] = await d.insert(designs).values({ userId: user.id, title: "Draft", preset: "classic", prompt: "my secret idea", lineArtKey: "x.png" }).returning();
    await d.insert(media).values({ designId: draft.id, kind: "mockup", template: "front", view: "sun", key: "m.png" });
    await d.insert(identities).values({ userId: user.id, provider: "google", subject: "g-1" });
    await d.insert(payoutMethods).values({ userId: user.id, kind: "paypal", details: "secret", summary: "m***@example.com" });
    await d.insert(pushTokens).values({ token: "ExponentPushToken[abc]", userId: user.id, platform: "ios" });

    await deleteAccount(user.id);

    const [after] = await d.select().from(users).where(eq(users.id, user.id));
    expect(after).toMatchObject({ name: "Former designer", bio: null, avatarKey: null, instagram: null, credits: 0 });
    expect(after.email).not.toContain("maya");
    expect(after.deletedAt).toBeTruthy();
    expect(await d.select().from(designs).where(eq(designs.id, draft.id))).toEqual([]);
    expect(await d.select().from(designs).where(eq(designs.id, launched.id))).toHaveLength(1);
    expect(await d.select().from(identities).where(eq(identities.userId, user.id))).toEqual([]);
    expect(await d.select().from(payoutMethods).where(eq(payoutMethods.userId, user.id))).toEqual([]);
    expect(await d.select().from(pushTokens).where(eq(pushTokens.userId, user.id))).toEqual([]);
  });
});
