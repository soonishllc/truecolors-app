import type Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const { db } = await import("../src/lib/db/client");
const { botConversations, wholesaleContacts, wholesalers } = await import("../src/lib/db/schema");
const { handleTicket, handBackToBot } = await import("../src/lib/wholesale/bot");
const { useWholesaleOps } = await import("../src/lib/wholesale/ops");
const { addOutlet, createWholesaler, normalisePhone } = await import("../src/lib/wholesale/accounts");
const { resetConfig } = await import("../src/lib/config");
const { freshDb } = await import("./helpers");

type Ticket = import("../src/lib/gorgias/client").Ticket;
type Msg = Ticket["messages"][number];
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

const PHONE = "971501234567";

let seq = 1;
const customer = (body: string, phone = PHONE): Msg => ({
  id: String(seq++), fromAgent: false, via: "whatsapp", body, customerPhone: phone,
  ourAddress: "+15558763944", integrationId: 7, createdAt: new Date(Date.UTC(2026, 10, 4, 10, 0, seq)).toISOString(),
});
const agent = (body: string): Msg => ({
  id: String(seq++), fromAgent: true, via: "helpdesk", body, createdAt: new Date(Date.UTC(2026, 10, 4, 10, 0, seq)).toISOString(),
});

const message = (content: unknown[], stop_reason: string) =>
  ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: {} }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => message([{ type: "text", text: t }], "end_turn");
const call = (name: string, input: object = {}) => message([{ type: "tool_use", id: `tu_${seq++}`, name, input }], "tool_use");

// A fake Gorgias, Shopify and Claude. The model answers from a script, one response per call.
function fakes(ticket: Ticket, script: Anthropic.Beta.BetaMessage[]) {
  const seen = {
    calls: [] as Params[],
    replies: [] as string[],
    handovers: [] as { reason: string; tags: string[] }[],
    stockAsked: [] as string[],
  };
  useWholesaleOps({
    getTicket: async () => ticket,
    replyOnTicket: async (_t, reply) => {
      seen.replies.push(reply);
      return `sent-${seq++}`;
    },
    handOverTicket: async (_id, reason, tags) => {
      seen.handovers.push({ reason, tags });
    },
    wholesaleCatalog: async () => [
      { title: "Habibi", handle: "habibi", retailPrice: "36.00", currency: "USD", sizes: [{ size: "M", sku: "TC-HAB-WHT-M", available: 40 }] },
    ],
    customerOrders: async () => [],
    locationStock: async (id) => {
      seen.stockAsked.push(id);
      return [{ product: "Habibi", size: "M", sku: "TC-HAB-WHT-M", available: 6 }];
    },
    converse: async (params) => {
      seen.calls.push(structuredClone(params));
      const next = script.shift();
      if (!next) throw new Error("The model was called more times than scripted");
      return next;
    },
  });
  return seen;
}

const toolNames = (p: Params) => (p.tools ?? []).map((t) => (t as { name: string }).name).sort();

beforeEach(async () => {
  await freshDb();
});

describe("wholesale bot", () => {
  it("saves a new business as a lead, and offers strangers no order or stock tools", async () => {
    const ticket: Ticket = { id: "100", channel: "whatsapp", messages: [customer("Hi, we run a gift shop in Abu Dhabi. Can we stock you?")] };
    const seen = fakes(ticket, [
      call("record_lead", {
        contact_name: "Sara", business_name: "Corniche Gifts", city: "Abu Dhabi", venue_type: "gift shop", interest: "stock", email: "",
      }),
      text("Thanks Sara! The wholesale team will be in touch."),
    ]);
    await handleTicket("100");

    expect(toolNames(seen.calls[0])).toEqual(["get_catalog", "hand_to_person", "record_lead"]);
    expect(seen.replies).toEqual(["Thanks Sara! The wholesale team will be in touch."]);
    const d = await db();
    const [lead] = await d.select().from(wholesalers);
    expect(lead).toMatchObject({ name: "Corniche Gifts", status: "lead" });
    const [contact] = await d.select().from(wholesaleContacts);
    expect(contact).toMatchObject({ phone: PHONE, wholesalerId: lead.id });
  });

  it("shows a display partner the stock at their own outlets only", async () => {
    const w = await createWholesaler({
      name: "Marina Resort Boutique", currency: "AED", shopifyCustomerId: "555", stockist: false, displayPartner: true,
      contactName: "Omar", phone: "+971 50 123 4567", email: "omar@marina.example",
    });
    await addOutlet({ wholesalerId: w.id, name: "Lobby shop", city: "Dubai", country: "AE", shopifyLocationId: "gid://shopify/Location/42", supplyRoute: "quiqup" });
    const other = await createWholesaler({
      name: "Other Hotel", currency: "AED", shopifyCustomerId: "", stockist: false, displayPartner: true,
      contactName: "Lina", phone: "+971 55 000 0000", email: "",
    });
    await addOutlet({ wholesalerId: other.id, name: "Pool bar", city: "Dubai", country: "AE", shopifyLocationId: "99", supplyRoute: "quiqup" });

    const ticket: Ticket = { id: "101", channel: "whatsapp", messages: [customer("How many M do we have left?")] };
    const seen = fakes(ticket, [call("get_display_stock"), text("You have 6 Habibi in M at the lobby shop.")]);
    await handleTicket("101");

    expect(toolNames(seen.calls[0])).toEqual(["get_catalog", "get_display_stock", "get_orders", "hand_to_person"]);
    expect(seen.stockAsked).toEqual(["42"]);
    expect(seen.calls[0].system).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining("Omar (owner) at Marina Resort Boutique") })]));
    expect(seen.replies).toHaveLength(1);
  });

  it("refuses a tool the sender doesn't have, even if the model asks for it", async () => {
    await createWholesaler({
      name: "Sunset Gifts", currency: "USD", shopifyCustomerId: "777", stockist: true, displayPartner: false,
      contactName: "Ana", phone: PHONE, email: "",
    });
    const ticket: Ticket = { id: "102", channel: "whatsapp", messages: [customer("Hola, ¿cuántas camisas hay en la vitrina?")] };
    const seen = fakes(ticket, [call("get_display_stock"), text("No tienes una vitrina con nosotros.")]);
    await handleTicket("102");

    expect(toolNames(seen.calls[0])).not.toContain("get_display_stock");
    const results = seen.calls[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results[0]).toMatchObject({ is_error: true });
    expect(seen.stockAsked).toEqual([]);
  });

  it("hands over to the team, tags the language, and then stays quiet", async () => {
    const ticket: Ticket = { id: "103", channel: "whatsapp", messages: [customer("أريد طلب ٥٠ قميصا")] };
    const seen = fakes(ticket, [call("hand_to_person", { reason: "wants to place an order" }), text("سيتواصل معك أحد أعضاء الفريق هنا.")]);
    await handleTicket("103");

    expect(seen.replies).toHaveLength(1);
    expect(seen.handovers).toEqual([{ reason: "wants to place an order", tags: ["bot-handover", "wholesale", "lang-ar"] }]);
    const d = await db();
    const [conv] = await d.select().from(botConversations);
    expect(conv.status).toBe("human");

    ticket.messages.push(customer("هل من أحد؟"));
    await handleTicket("103");
    expect(seen.calls).toHaveLength(2);
  });

  it("stops answering when someone on the team replies in the ticket, until handed back", async () => {
    const ticket: Ticket = { id: "104", channel: "whatsapp", messages: [customer("Hi")] };
    const seen = fakes(ticket, [text("Hello! How can I help?"), text("Happy to help again.")]);
    await handleTicket("104");
    ticket.messages.push(agent("Hi, it's Kevin from Truecolors."), customer("Thanks Kevin"));
    await handleTicket("104");
    expect(seen.calls).toHaveLength(1);

    const d = await db();
    const [conv] = await d.select().from(botConversations);
    expect(conv).toMatchObject({ status: "human", handoverReason: "a team member replied" });

    await handBackToBot(conv.id);
    ticket.messages.push(customer("One more question"));
    await handleTicket("104");
    expect(seen.calls).toHaveLength(2);
  });

  it("answers each customer message once when the webhook repeats", async () => {
    const ticket: Ticket = { id: "105", channel: "whatsapp", messages: [customer("Do you ship to Oman?")] };
    const seen = fakes(ticket, [text("Yes, we do.")]);
    await Promise.all([handleTicket("105"), handleTicket("105")]);
    await handleTicket("105");
    expect(seen.calls).toHaveLength(1);
    expect(seen.replies).toHaveLength(1);
  });

  it("hands over instead of replying when the model declines", async () => {
    const ticket: Ticket = { id: "106", channel: "whatsapp", messages: [customer("Hello")] };
    const seen = fakes(ticket, [message([], "refusal")]);
    await handleTicket("106");
    expect(seen.replies).toEqual([]);
    expect(seen.handovers[0].reason).toBe("the assistant declined to answer");
  });

  it("asks for the fallback beta and low effort on every call", async () => {
    const ticket: Ticket = { id: "107", channel: "whatsapp", messages: [customer("Hi")] };
    const seen = fakes(ticket, [text("Hello!")]);
    await handleTicket("107");
    expect(seen.calls[0]).toMatchObject({
      model: "claude-opus-5-5", fallbacks: "default", betas: ["server-side-fallback-2026-07-01"], output_config: { effort: "low" },
    });
  });

  it("ignores tickets from other channels", async () => {
    const ticket: Ticket = { id: "108", channel: "email", messages: [customer("Hi")] };
    const seen = fakes(ticket, []);
    await handleTicket("108");
    expect(seen.calls).toEqual([]);
  });
});

describe("wholesale accounts", () => {
  it("stores WhatsApp numbers as digits with the country code and refuses duplicates", async () => {
    expect(normalisePhone("+971 50 123 4567")).toBe("971501234567");
    expect(normalisePhone("00971501234567")).toBe("971501234567");
    expect(normalisePhone("")).toBeNull();
    expect(() => normalisePhone("12345")).toThrow();

    const base = { currency: "USD", shopifyCustomerId: "", stockist: true, displayPartner: false, email: "" };
    await createWholesaler({ ...base, name: "A", contactName: "A", phone: "+971501234567" });
    await expect(createWholesaler({ ...base, name: "B", contactName: "B", phone: "00971 50 123 4567" })).rejects.toThrow(/already/);
    await expect(createWholesaler({ ...base, name: "C", contactName: "C", phone: "+44 7700 900123", stockist: false })).rejects.toThrow(/stockist/);
  });

  it("only gives outlets to display partners", async () => {
    const w = await createWholesaler({
      name: "Stockist", currency: "USD", shopifyCustomerId: "", stockist: true, displayPartner: false,
      contactName: "S", phone: "", email: "s@example.com",
    });
    await expect(
      addOutlet({ wholesalerId: w.id, name: "Shop", city: "Austin", country: "US", shopifyLocationId: "", supplyRoute: "shipdudes" }),
    ).rejects.toThrow(/display partners/);
  });
});

describe("Gorgias webhook", () => {
  it("rejects requests without the shared secret", async () => {
    process.env.GORGIAS_WEBHOOK_SECRET = "gorgias-test-secret";
    resetConfig();
    const { POST } = await import("../src/app/api/gorgias/route");
    const req = (secret: string, body: object) =>
      new Request("http://localhost/api/gorgias", {
        method: "POST", headers: { "x-truecolors-secret": secret, "content-type": "application/json" }, body: JSON.stringify(body),
      });
    expect((await POST(req("wrong", { ticket_id: 1 }))).status).toBe(401);
    expect((await POST(req("gorgias-test-secret", { ticket_id: "abc" }))).status).toBe(400);
    delete process.env.GORGIAS_WEBHOOK_SECRET;
    resetConfig();
  });
});

// Keep the conversation row's lookup honest: the bot finds conversations by ticket id.
it("keeps one conversation per ticket", async () => {
  const ticket: Ticket = { id: "109", channel: "whatsapp", messages: [customer("Hi")] };
  fakes(ticket, [text("Hello!"), text("Again!")]);
  await handleTicket("109");
  ticket.messages.push(customer("Hi again"));
  await handleTicket("109");
  const d = await db();
  expect(await d.select().from(botConversations).where(eq(botConversations.gorgiasTicketId, "109"))).toHaveLength(1);
});
