import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { db } = await import("../src/lib/db/client");
const { campaigns, designs, users } = await import("../src/lib/db/schema");
const service = await import("../src/lib/design/service");
const { freshDb, readyDesigner } = await import("./helpers");

beforeEach(async () => {
  await freshDb();
});

const credits = async (id: string) => (await (await db()).select().from(users).where(eq(users.id, id)))[0].credits;

describe("AI jobs", () => {
  it("runs one at a time per designer, so a second tap can't start and charge another", async () => {
    const { user } = await readyDesigner();
    const input = { title: "Reef", presetId: "beach", idea: "a turtle", options: service.designOptions({}) };
    const results = await Promise.allSettled([service.createDesign(user.id, input), service.createDesign(user.id, input)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason.message).toMatch(/still being made/);
    expect(await credits(user.id)).toBe(9);
    // The lock is released afterwards: the next job runs.
    await service.createDesign(user.id, input);
    expect(await credits(user.id)).toBe(8);
  });

  it("saves the designer's choices and uses them", async () => {
    const { user } = await readyDesigner();
    const options = service.designOptions({ text: "  WAIT  FOR THE SUN ", placement: "chest", detail: "detailed" });
    expect(options).toEqual({ text: "WAIT FOR THE SUN", placement: "chest", detail: "detailed" });
    const design = await service.createDesign(user.id, { title: "Sun", presetId: "lettering", idea: "a slogan", options });
    expect(design.options).toEqual(options);
    await service.colourDesign(user.id, design.id, { palette: "sunset" });
    const [after] = await (await db()).select().from(designs).where(eq(designs.id, design.id));
    expect(after.options).toMatchObject({ palette: "sunset", glow: false, placement: "chest" });
  });

  it("checks the choices", () => {
    expect(service.designOptions({ placement: "sleeve", detail: "x" })).toEqual({ placement: "front", detail: "bold" });
    expect(() => service.designOptions({ text: "x".repeat(61) })).toThrow(/60 characters/);
  });

  it("won't redraw or recolour a design that's in a campaign", async () => {
    const { user } = await readyDesigner();
    const design = await service.createDesign(user.id, { title: "Reef", presetId: "beach", idea: "a turtle" });
    const d = await db();
    await d.insert(campaigns).values({
      slug: "reef", designCode: "REEF", designId: design.id, userId: user.id, title: "Reef", story: "", market: "US",
      status: "in_review", goal: 100, stretchGoals: [], priceCents: 3600, currency: "USD",
    });
    await expect(service.refineDesign(user.id, design.id, "bigger")).rejects.toThrow(/in a campaign/);
    await expect(service.colourDesign(user.id, design.id)).rejects.toThrow(/in a campaign/);
    expect(await credits(user.id)).toBe(9);
  });
});
