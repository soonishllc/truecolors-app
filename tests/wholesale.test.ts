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
const { quoteOrder, placeOrder, recordWholesaleShopifyOrder, markBankTransferPaid, shipOrder } = await import("../src/lib/wholesale/orders");
const { wholesaleOrders, emails } = await import("../src/lib/db/schema");
const { cartons, shipmentRequest } = await import("../src/lib/fedex/client");
const consignment = await import("../src/lib/wholesale/consignment");
const { outlets, restocks, salesReports, settlements } = await import("../src/lib/db/schema");

type Ticket = import("../src/lib/gorgias/client").Ticket;
type Msg = Ticket["messages"][number];
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type WholesaleOps = import("../src/lib/wholesale/ops").WholesaleOps;

const PHONE = "971501234567";

let seq = 1;
const customer = (body: string, phone = PHONE): Msg => ({
  id: String(seq++), fromAgent: false, via: "whatsapp", body, customerPhone: phone,
  ourAddress: "+15558763944", integrationId: 7, images: [], createdAt: new Date(Date.UTC(2026, 10, 4, 10, 0, seq)).toISOString(),
});
const agent = (body: string): Msg => ({
  id: String(seq++), fromAgent: true, via: "helpdesk", body, images: [], createdAt: new Date(Date.UTC(2026, 10, 4, 10, 0, seq)).toISOString(),
});

const message = (content: unknown[], stop_reason: string) =>
  ({ id: "msg", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, stop_sequence: null, usage: {} }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => message([{ type: "text", text: t }], "end_turn");
const call = (name: string, input: object = {}) => message([{ type: "tool_use", id: `tu_${seq++}`, name, input }], "tool_use");

// A fake Gorgias, Shopify, FedEx and Claude. The model answers from a script, one response per call.
function fakes(ticket: Ticket, script: Anthropic.Beta.BetaMessage[]) {
  const seen = {
    calls: [] as Params[],
    replies: [] as string[],
    handovers: [] as { reason: string; tags: string[] }[],
    stockAsked: [] as string[],
    drafts: [] as Parameters<WholesaleOps["createWholesaleDraftOrder"]>[0][],
    pending: [] as string[],
    markedPaid: [] as string[],
    shipments: [] as Parameters<WholesaleOps["bookShipment"]>[0][],
    fulfilled: [] as { orderId: string; tracking: string }[],
    fedexDown: false,
    // Stock by location id, then SKU. A location with nothing set holds 6 Habibi M.
    stock: new Map<string, Map<string, number>>(),
    adjustments: [] as { inventoryItemId: string; locationId: string; delta: number }[],
    invoices: [] as Parameters<WholesaleOps["createInvoiceDraftOrder"]>[0][],
    completed: [] as { id: string; pending: boolean }[],
  };
  const skuOf: Record<string, string> = { "inv-M": "TC-HAB-WHT-M", "inv-L": "TC-HAB-WHT-L" };
  const sizeOf = (sku: string) => sku.split("-").at(-1)!;
  const at = (id: string) => {
    if (!seen.stock.has(id)) seen.stock.set(id, new Map([["TC-HAB-WHT-M", 6]]));
    return seen.stock.get(id)!;
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
      {
        title: "Habibi", handle: "habibi", retailPrice: "36.00", currency: "USD",
        sizes: [
          { size: "M", sku: "TC-HAB-WHT-M", variantId: "gid://shopify/ProductVariant/1", inventoryItemId: "inv-M", available: 40 },
          { size: "L", sku: "TC-HAB-WHT-L", variantId: "gid://shopify/ProductVariant/2", inventoryItemId: "inv-L", available: 200 },
        ],
      },
    ],
    customerOrders: async () => [],
    locationStock: async (id) => {
      seen.stockAsked.push(id);
      return [...at(id)].map(([sku, available]) => ({ product: "Habibi", size: sizeOf(sku), sku, available }));
    },
    adjustStock: async (changes) => {
      for (const c of changes) {
        seen.adjustments.push(c);
        const here = at(c.locationId);
        const sku = skuOf[c.inventoryItemId];
        here.set(sku, (here.get(sku) ?? 0) + c.delta);
      }
    },
    createInvoiceDraftOrder: async (input) => {
      seen.invoices.push(input);
      return { id: "gid://shopify/DraftOrder/77", name: "#D77", invoiceUrl: "https://shop.example/invoices/settle" };
    },
    // AED retail is 135 in the UAE market; USD 36 elsewhere.
    variantPrices: async (ids, country) =>
      new Map(ids.map((id) => [id, country === "AE" ? { amount: "135.00", currency: "AED" } : { amount: "36.00", currency: "USD" }])),
    createWholesaleDraftOrder: async (input) => {
      seen.drafts.push(input);
      return { id: "gid://shopify/DraftOrder/9", name: "#D9", invoiceUrl: "https://shop.example/invoices/abc" };
    },
    completeDraftAsPending: async (id, pending = true) => {
      seen.completed.push({ id, pending });
      seen.pending.push(id);
      return { orderId: "5001", orderName: "#5001" };
    },
    markOrderPaid: async (id) => {
      seen.markedPaid.push(id);
    },
    orderShipTo: async () => ({
      name: "Ana Ruiz", company: "Sunset Gifts", phone: "+15125550100", email: "ana@sunset.example",
      street: ["1 Congress Ave"], city: "Austin", state: "TX", postalCode: "78701", country: "US",
    }),
    fulfilWithTracking: async (orderId, tracking) => {
      seen.fulfilled.push({ orderId, tracking });
    },
    bookShipment: async (input) => {
      if (seen.fedexDown) throw new Error("FedEx answered 503: try later");
      seen.shipments.push(input);
      return { trackingNumber: "794600000001", documents: [{ kind: "label", pdf: Buffer.from("%PDF label").toString("base64") }] };
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

    expect(toolNames(seen.calls[0])).toEqual([
      "confirm_sales_report", "get_catalog", "get_display_stock", "get_orders", "get_settlement", "hand_to_person", "report_sales", "request_restock",
    ]);
    expect(toolNames(seen.calls[0])).not.toContain("quote_order");
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

describe("stockist orders", () => {
  const none: Ticket = { id: "0", channel: "whatsapp", messages: [] };

  async function stockist(currency = "AED", customerId = "777") {
    return createWholesaler({
      name: "Sunset Gifts", currency, shopifyCustomerId: customerId, stockist: true, displayPartner: false,
      contactName: "Ana", phone: PHONE, email: "ana@sunset.example",
    });
  }
  const orderRow = async (ref: string) => {
    const d = await db();
    return (await d.select().from(wholesaleOrders).where(eq(wholesaleOrders.ref, ref)))[0];
  };
  const paidWebhook = (ref: string, financial_status = "paid") => ({
    id: 5001, name: "#5001", currency: "AED", line_items: [], tags: `wholesale, wholesale-order:${ref}`, financial_status,
  });

  it("prices a basket at the tier for its size, in the stockist's currency", async () => {
    fakes(none, []);
    const w = await stockist();
    const q = await quoteOrder(w.id, [{ sku: "tc-hab-wht-m", quantity: 20 }, { sku: "TC-HAB-WHT-L", quantity: 80 }]);
    expect(q).toMatchObject({ currency: "AED", units: 100, discountBps: 4500, status: "quoted" });
    // 135 AED retail, 45% off = 74.25 a shirt; 100 shirts.
    expect(q.lines.map((l) => [l.sku, l.quantity, l.unit])).toEqual([["TC-HAB-WHT-M", 20, "74.25"], ["TC-HAB-WHT-L", 80, "74.25"]]);
    expect(q.subtotal).toBe("7425.00");
  });

  it("refuses baskets under the minimum, with unknown SKUs or more than is in stock", async () => {
    fakes(none, []);
    const w = await stockist();
    await expect(quoteOrder(w.id, [{ sku: "TC-HAB-WHT-L", quantity: 10 }])).rejects.toThrow(/minimum order is 24/);
    await expect(quoteOrder(w.id, [{ sku: "TC-NOPE-WHT-L", quantity: 30 }])).rejects.toThrow(/Not in the wholesale catalog/);
    await expect(quoteOrder(w.id, [{ sku: "TC-HAB-WHT-M", quantity: 50 }])).rejects.toThrow(/Not enough stock.*40 left/);
  });

  it("only lets active stockists quote", async () => {
    fakes(none, []);
    const partner = await createWholesaler({
      name: "Resort", currency: "AED", shopifyCustomerId: "1", stockist: false, displayPartner: true, contactName: "O", phone: "", email: "o@r.example",
    });
    await expect(quoteOrder(partner.id, [{ sku: "TC-HAB-WHT-L", quantity: 30 }])).rejects.toThrow(/Only active stockists/);
  });

  it("places a quote as a draft order at the quoted prices, then ships it by FedEx once paid by card", async () => {
    const seen = fakes(none, []);
    const w = await stockist();
    const q = await quoteOrder(w.id, [{ sku: "TC-HAB-WHT-L", quantity: 30 }]);
    const placed = await placeOrder(w.id, q.ref, "card");

    expect(placed.payUrl).toBe("https://shop.example/invoices/abc");
    expect(seen.drafts[0]).toMatchObject({
      shopifyCustomerId: "777", currency: "AED", tags: ["wholesale", `wholesale-order:${q.ref}`],
      lines: [expect.objectContaining({ variantId: "gid://shopify/ProductVariant/2", quantity: 30, unit: "81.00" })],
    });
    await expect(placeOrder(w.id, q.ref, "card")).rejects.toThrow(/no open quote/);

    await recordWholesaleShopifyOrder(paidWebhook(q.ref));
    const shipped = await orderRow(q.ref);
    expect(shipped).toMatchObject({ status: "shipped", shopifyOrderId: "5001", trackingNumber: "794600000001", shippingProblem: null });
    expect(shipped.documents).toEqual([{ kind: "label", key: expect.stringContaining(`wholesale/${q.ref}/`) }]);
    expect(seen.shipments[0]).toMatchObject({ units: 30, currency: "AED", customsValue: "2430.00", reference: "#5001" });
    expect(seen.fulfilled).toEqual([{ orderId: "5001", tracking: "794600000001" }]);

    // A repeated webhook books nothing new.
    await recordWholesaleShopifyOrder(paidWebhook(q.ref));
    expect(seen.shipments).toHaveLength(1);

    const d = await db();
    const subjects = (await d.select().from(emails)).map((e) => e.subject);
    expect(subjects).toEqual([`Your Truecolors order ${q.ref}: how to pay`, "Your Truecolors order #5001 has shipped"]);
  });

  it("holds bank transfers as orders awaiting payment until the team marks them paid", async () => {
    process.env.WHOLESALE_BANK_DETAILS = "Bank: Example Bank\\nIBAN: AE00 0000";
    resetConfig();
    try {
      const seen = fakes(none, []);
      const w = await stockist();
      const q = await quoteOrder(w.id, [{ sku: "TC-HAB-WHT-L", quantity: 24 }]);
      const placed = await placeOrder(w.id, q.ref, "bank_transfer");
      expect(placed).toMatchObject({ reference: "#5001", bankDetails: "Bank: Example Bank\nIBAN: AE00 0000" });
      expect(seen.pending).toEqual(["gid://shopify/DraftOrder/9"]);

      await recordWholesaleShopifyOrder(paidWebhook(q.ref, "pending"));
      expect((await orderRow(q.ref)).status).toBe("awaiting_payment");
      expect(seen.shipments).toEqual([]);

      await markBankTransferPaid((await orderRow(q.ref)).id);
      expect(seen.markedPaid).toEqual(["5001"]);
      expect((await orderRow(q.ref)).status).toBe("shipped");
    } finally {
      delete process.env.WHOLESALE_BANK_DETAILS;
      resetConfig();
    }
  });

  it("keeps a FedEx failure on the order and ships on retry", async () => {
    const seen = fakes(none, []);
    const w = await stockist();
    const q = await quoteOrder(w.id, [{ sku: "TC-HAB-WHT-L", quantity: 24 }]);
    await placeOrder(w.id, q.ref, "card");
    seen.fedexDown = true;
    await recordWholesaleShopifyOrder(paidWebhook(q.ref));
    expect(await orderRow(q.ref)).toMatchObject({ status: "paid", shippingProblem: "FedEx answered 503: try later" });

    seen.fedexDown = false;
    await shipOrder((await orderRow(q.ref)).id, { retry: true });
    expect((await orderRow(q.ref)).status).toBe("shipped");
  });

  it("won't place a lapsed quote, or one from another account", async () => {
    fakes(none, []);
    const w = await stockist();
    const other = await createWholesaler({
      name: "Other", currency: "USD", shopifyCustomerId: "8", stockist: true, displayPartner: false, contactName: "X", phone: "", email: "x@o.example",
    });
    const q = await quoteOrder(w.id, [{ sku: "TC-HAB-WHT-L", quantity: 24 }], new Date(Date.now() - 49 * 3_600_000));
    await expect(placeOrder(other.id, q.ref, "card")).rejects.toThrow(/no open quote/);
    await expect(placeOrder(w.id, q.ref, "card")).rejects.toThrow(/lapsed/);
    expect((await orderRow(q.ref)).status).toBe("cancelled");
  });

  it("gives stockists the quote and order tools in WhatsApp, priced from our quote only", async () => {
    await stockist("USD");
    const ticket: Ticket = { id: "200", channel: "whatsapp", messages: [customer("30 Habibi in L please, card")] };
    const seen = fakes(ticket, [
      call("quote_order", { lines: [{ sku: "TC-HAB-WHT-L", quantity: 30 }] }),
      text("That's 30 shirts at $21.60, $648.00 in total. Shall I place it?"),
    ]);
    await handleTicket("200");
    expect(toolNames(seen.calls[0])).toEqual(["get_catalog", "get_orders", "hand_to_person", "place_order", "quote_order"]);
    const result = (seen.calls[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(JSON.parse(result.content as string)).toMatchObject({ total: "648.00", currency: "USD" });
    expect(seen.drafts).toEqual([]);
  });
});

describe("FedEx shipment request", () => {
  const shipTo = { name: "Ana", street: ["1 Congress Ave"], city: "Austin", state: "TX", postalCode: "78701", country: "US" };

  it("packs 50 shirts to a carton and bills duties to Truecolors on shipments abroad", () => {
    expect(cartons(120)).toEqual([50, 50, 20]);
    const req = shipmentRequest({ shipTo, units: 120, currency: "MXN", customsValue: "18000.00", reference: "#5001", date: new Date("2026-11-04") });
    const s = req.requestedShipment;
    expect(s.requestedPackageLineItems).toHaveLength(3);
    expect(s.shippingChargesPayment).toEqual({ paymentType: "SENDER" });
    expect(s.customsClearanceDetail?.dutiesPayment).toEqual({ paymentType: "SENDER" });
    expect(s.customsClearanceDetail?.commodities[0]).toMatchObject({ quantity: 120, customsValue: { amount: 18000, currency: "NMP" } });
  });

  it("leaves customs out of shipments within Mexico", () => {
    const req = shipmentRequest({ shipTo: { ...shipTo, country: "MX" }, units: 30, currency: "MXN", customsValue: "4500.00", reference: "#1", date: new Date() });
    expect(req.requestedShipment.customsClearanceDetail).toBeUndefined();
  });
});

describe("display partners", () => {
  const none: Ticket = { id: "0", channel: "whatsapp", messages: [] };
  const DAY = 86_400_000;
  const start = new Date("2026-11-01T08:00:00Z");

  async function partner(currency = "MXN") {
    const w = await createWholesaler({
      name: "Hotel Playa", currency, shopifyCustomerId: "321", stockist: false, displayPartner: true,
      contactName: "Lucía", phone: PHONE, email: "lucia@playa.example",
    });
    await addOutlet({
      wholesalerId: w.id, name: "Lobby shop", city: "Cancún", country: "MX", shopifyLocationId: "42", supplyRoute: "cancun", parPerSku: 6,
    });
    const d = await db();
    const [o] = await d.update(outlets).set({ periodStart: start }).where(eq(outlets.wholesalerId, w.id)).returning();
    return { w, o };
  }
  const outletRow = async (id: string) => (await (await db()).select().from(outlets).where(eq(outlets.id, id)))[0];
  const settlementRows = async () => (await db()).select().from(settlements);

  beforeEach(() => {
    process.env.WHOLESALE_LOCATION_ID = "900";
    resetConfig();
  });

  it("proposes a restock up to the usual level, and moves the stock once the team sends it", async () => {
    const seen = fakes(none, []);
    seen.stock.set("42", new Map([["TC-HAB-WHT-M", 2], ["TC-HAB-WHT-L", 6]]));
    seen.stock.set("900", new Map([["TC-HAB-WHT-M", 100], ["TC-HAB-WHT-L", 100]]));
    const { o } = await partner();

    const r = await consignment.requestRestock(o.id, null);
    expect(r.lines.map((l) => [l.sku, l.quantity])).toEqual([["TC-HAB-WHT-M", 4]]);
    await expect(consignment.markRestockSent(r.id)).rejects.toThrow(/approved/);
    await consignment.decideRestock(r.id, true);
    await consignment.markRestockSent(r.id);

    expect(seen.stock.get("42")!.get("TC-HAB-WHT-M")).toBe(6);
    expect(seen.stock.get("900")!.get("TC-HAB-WHT-M")).toBe(96);
    expect((await (await db()).select().from(restocks))[0].status).toBe("sent");
  });

  it("reads a till photo into a draft report and only takes the stock off once the partner confirms", async () => {
    const { o } = await partner();
    const photo = { ...customer("Here's this week's till"), images: ["https://uploads.gorgias.example/till.jpg"] };
    const ticket: Ticket = { id: "300", channel: "whatsapp", messages: [photo] };
    const seen = fakes(ticket, [
      call("report_sales", { outlet: "", lines: [{ sku: "TC-HAB-WHT-M", quantity: 4 }] }),
      text("I read 4 Habibi M. Is that right?"),
    ]);
    await handleTicket("300");

    const first = seen.calls[0].messages[0].content as Anthropic.Beta.BetaContentBlockParam[];
    expect(first[0]).toEqual({ type: "image", source: { type: "url", url: "https://uploads.gorgias.example/till.jpg" } });
    expect(seen.adjustments).toEqual([]);
    const [draft] = await (await db()).select().from(salesReports);
    expect(draft).toMatchObject({ status: "draft", units: 4, source: "whatsapp" });

    ticket.messages.push({ ...agent("I read 4 Habibi M. Is that right?"), via: "api" }, customer("Yes"));
    const script = [call("confirm_sales_report", { outlet: "", report: draft.ref }), text("Thanks, recorded.")];
    useWholesaleOps({ ...(await import("../src/lib/wholesale/ops")).wholesaleOps(), converse: async () => script.shift()! });
    await handleTicket("300");
    expect(seen.stock.get("42")!.get("TC-HAB-WHT-M")).toBe(2);
    expect((await (await db()).select().from(salesReports))[0].status).toBe("confirmed");
    expect(o.id).toBeTruthy();
  });

  it("won't record more sales than the display holds", async () => {
    fakes(none, []);
    const { o } = await partner();
    await expect(consignment.reportSales(o.id, [{ sku: "TC-HAB-WHT-M", quantity: 9 }], "portal")).rejects.toThrow(/6 on the display/);
  });

  it("settles a period at the partner price, invoices it in Shopify and records the card payment", async () => {
    const seen = fakes(none, []);
    const { o } = await partner();
    const r = await consignment.reportSales(o.id, [{ sku: "TC-HAB-WHT-M", quantity: 4 }], "portal");
    await consignment.confirmSalesReport(o.id, r.ref, new Date(start.getTime() + 10 * DAY));
    expect(await settlementRows()).toEqual([]);

    const log: string[] = [];
    await consignment.runSettlements(new Date(start.getTime() + 15 * DAY + 1000), log);
    const [s] = await settlementRows();
    expect(s).toMatchObject({ status: "review", reportedUnits: 4, missingUnits: 0, currency: "MXN", unitPrice: "150.00", amount: "600.00" });
    expect((await outletRow(o.id)).periodStart).toEqual(new Date(start.getTime() + 15 * DAY));

    await consignment.invoiceSettlement(s.id);
    expect(seen.invoices[0]).toMatchObject({
      shopifyCustomerId: "321", currency: "MXN", tags: ["consignment-settlement", `consignment-settlement:${s.id}`],
      lines: [{ title: "Habibi M, sold at Lobby shop", quantity: 4, unit: "150.00" }],
    });
    await consignment.recordSettlementPayment({
      id: 1, name: "#6001", currency: "MXN", line_items: [], tags: `consignment-settlement, consignment-settlement:${s.id}`, financial_status: "paid",
    });
    expect((await settlementRows())[0].status).toBe("paid");
  });

  it("pauses restocks and reminds twice when no report comes, then settles missing shirts from the team's count", async () => {
    const seen = fakes(none, []);
    const { o } = await partner();
    const after = (days: number) => new Date(start.getTime() + days * DAY + 1000);

    const log: string[] = [];
    await consignment.runSettlements(after(15), log);
    await consignment.runSettlements(after(15.5), log);
    await consignment.runSettlements(after(16), log);
    await consignment.runSettlements(after(17), log);
    expect(log).toEqual([
      "Lobby shop: sales reminder 1 sent", "Lobby shop: sales reminder 2 sent", "Lobby shop: no sales report, needs a visit to count",
    ]);
    const emailed = (await (await db()).select().from(emails)).filter((e) => e.subject.startsWith("Truecolors sales for Lobby shop"));
    expect(emailed).toHaveLength(2);
    await expect(consignment.requestRestock(o.id, null)).rejects.toThrow(/paused/);

    // On the visit, 1 of the 6 shirts is there.
    await consignment.recordStockCount(o.id, [{ sku: "TC-HAB-WHT-M", quantity: 1 }], "kevin@probablyfine.ae", after(17));
    expect(seen.stock.get("42")!.get("TC-HAB-WHT-M")).toBe(1);
    const [s] = await settlementRows();
    expect(s).toMatchObject({ reportedUnits: 0, missingUnits: 5, amount: "750.00", status: "review" });
    expect(await outletRow(o.id)).toMatchObject({ overdueSince: null, remindersSent: 0 });
  });

  it("holds a settlement for review when the partner price isn't set for its currency", async () => {
    fakes(none, []);
    const { o } = await partner("AED");
    const r = await consignment.reportSales(o.id, [{ sku: "TC-HAB-WHT-M", quantity: 2 }], "portal");
    await consignment.confirmSalesReport(o.id, r.ref, new Date(start.getTime() + 16 * DAY));
    const [s] = await settlementRows();
    expect(s).toMatchObject({ status: "review", amount: null, problem: "No partner price set for AED yet (rules.ts)." });
    await expect(consignment.invoiceSettlement(s.id)).rejects.toThrow(/No partner price/);
  });

  it("closes a period with nothing sold without an invoice, and marks bank transfers paid", async () => {
    const seen = fakes(none, []);
    const { o } = await partner();
    const zero = await consignment.reportSales(o.id, [{ sku: "TC-HAB-WHT-M", quantity: 0 }], "portal");
    await consignment.confirmSalesReport(o.id, zero.ref, new Date(start.getTime() + 15 * DAY + 1000));
    expect((await settlementRows())[0]).toMatchObject({ status: "paid", amount: "0.00" });
    expect(seen.invoices).toEqual([]);

    const sold = await consignment.reportSales(o.id, [{ sku: "TC-HAB-WHT-M", quantity: 1 }], "portal");
    await consignment.confirmSalesReport(o.id, sold.ref, new Date(start.getTime() + 31 * DAY));
    const open = (await settlementRows()).find((x) => x.status === "review")!;
    await consignment.invoiceSettlement(open.id);
    await consignment.markSettlementPaid(open.id);
    expect(seen.completed).toEqual([{ id: "gid://shopify/DraftOrder/77", pending: false }]);
  });
});
