import { eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { campaigns, designs, invites, outlets, users, wholesalers } from "../db/schema";
import type { Ticket, TicketMessage } from "../gorgias/client";
import { CURRENCY as CAMPAIGN_CURRENCY, FUNDING_GOAL, MARKET, PRICE_CENTS, SIZES, STRETCH_GOALS, sku, type Size } from "../rules";
import type { CatalogItem, OrderSummary } from "../shopify/wholesale";
import { put } from "../storage";
import { addOutlet, createWholesaler } from "./accounts";
import type { WholesaleOps } from "./ops";
import { addDisplay } from "./service";

// The wholesale demo (WHOLESALE_DEMO=true, local only): everything outside the app except Claude is replaced
// with sample data held in memory, and WhatsApp is the simulator page. Paying a draft order goes through a
// demo checkout link that marks it paid, so an order can be followed all the way to its FedEx label.

export const DEMO_LOCATIONS = { cancun: "9001", quiqup: "9002", shipdudes: "9003", outlet: "9010" };
export const DEMO_CUSTOMER = "9100";
export const DEMO_PHONES = { stockist: "971500000001", partner: "529980000002" };

// The live store's own designs and SKU codes, so the demo matches what shoppers see in the Shop tab.
const DESIGNS = [
  ["HAB", "HABIBI Tee"], ["DUN", "Dune Bashing Tee"], ["ALL", "We're All Emirati Tee"], ["BCH", "Beach Tee"], ["FUG", "NYC Tee"],
] as const;
const RETAIL: Record<string, string> = { AE: "129.00", US: "36.00", MX: "300.00" };
const CURRENCY: Record<string, string> = { AE: "AED", US: "USD", MX: "MXN" };

export type Activity = { after: number; tools: string[] };

type Store = {
  tickets: Map<string, Ticket & { notes: string[]; tags: string[]; activity: Activity[] }>;
  // The ticket the simulator is answering right now, so tool calls can be shown against it.
  current?: string;
  stock: Map<string, Map<string, number>>;
  products: CatalogItem[];
  seq: number;
};

// Kept on globalThis so it survives hot reloads in development.
const g = globalThis as unknown as { __tcDemo?: Store };

function store(): Store {
  if (g.__tcDemo) return g.__tcDemo;
  const stock = new Map<string, Map<string, number>>();
  const fill = (loc: string, f: (code: string, size: string) => number) =>
    stock.set(loc, new Map(DESIGNS.flatMap(([code]) => SIZES.map((s) => [sku(code, s), f(code, s)] as const))));
  fill(DEMO_LOCATIONS.cancun, () => 120);
  fill(DEMO_LOCATIONS.quiqup, () => 40);
  fill(DEMO_LOCATIONS.shipdudes, () => 40);
  // The partner's Tower: a few of each, running low on the favourites.
  fill(DEMO_LOCATIONS.outlet, (code, s) => (code === "HAB" || code === "BCH" ? (s === "M" || s === "L" ? 1 : 3) : 4));
  g.__tcDemo = { tickets: new Map(), stock, products: [], seq: 1000 };
  return g.__tcDemo;
}

const variantId = (code: string, size: string) => `demo-v-${code}-${size}`;
const itemId = (code: string, size: string) => `demo-i-${code}-${size}`;
const codeOfItem = (id: string) => id.replace(/^demo-[vi]-/, "").split("-");

function catalog(): CatalogItem[] {
  const total = (s: string) => [...store().stock.values()].reduce((n, m) => n + (m.get(s) ?? 0), 0);
  const base = DESIGNS.map(([code, title]) => ({ code, title, exclusiveTo: undefined as string | undefined }));
  const extra = store().products.map((p) => ({ code: p.handle.toUpperCase(), title: p.title, exclusiveTo: p.exclusiveTo }));
  return [...base, ...extra].map(({ code, title, exclusiveTo }) => ({
    title, handle: code.toLowerCase(), exclusiveTo, retailPrice: RETAIL.US, currency: "USD",
    sizes: SIZES.map((size) => ({
      size, sku: sku(code, size), variantId: variantId(code, size), inventoryItemId: itemId(code, size), available: total(sku(code, size)),
    })),
  }));
}

const pay = (kind: "order" | "settlement", tags: string[]) => {
  const ref = tags.map((t) => t.split(":")).find(([k, v]) => v && (k === "wholesale-order" || k === "consignment-settlement"))?.[1];
  return `${config().APP_URL}/wholesale/demo-pay?${kind}=${ref}`;
};

const SAMPLE_ORDERS: OrderSummary[] = [
  {
    name: "#1042", createdAt: "2026-10-12T09:00:00Z", paid: "PAID", fulfilment: "FULFILLED", total: "1296.00", currency: "USD",
    statusUrl: "#", tracking: [{ company: "FedEx", number: "794600000042", url: "https://www.fedex.com/fedextrack/?trknbr=794600000042" }],
  },
];

export const demoOps = (live: WholesaleOps): WholesaleOps => ({
  ...live,
  converse: async (params) => {
    const res = await live.converse(params);
    const t = store().current ? store().tickets.get(store().current!) : undefined;
    const tools = res.content.flatMap((b) => (b.type === "tool_use" ? [b.name] : []));
    if (t && tools.length) t.activity.push({ after: t.messages.length, tools });
    return res;
  },
  getTicket: async (id) => {
    const t = store().tickets.get(id);
    if (!t) throw new Error(`No demo ticket ${id}`);
    return t;
  },
  replyOnTicket: async (ticket, text) => addMessage(ticket.id, { fromAgent: true, via: "api", body: text, images: [] }),
  handOverTicket: async (id, reason, tags) => {
    const t = store().tickets.get(id)!;
    t.notes.push(`Handed to the team: ${reason}`);
    t.tags.push(...tags.filter((x) => !t.tags.includes(x)));
  },
  wholesaleCatalog: async () => catalog(),
  customerOrders: async () => SAMPLE_ORDERS,
  locationStock: async (id) =>
    [...(store().stock.get(id) ?? new Map<string, number>())].map(([s, available]) => {
      const [code, size] = s.replace(/^TC-/, "").split("-WHT-");
      return { product: catalog().find((p) => p.handle === code.toLowerCase())?.title ?? code, size, sku: s, available };
    }),
  variantPrices: async (ids, country) => new Map(ids.map((id) => [id, { amount: RETAIL[country], currency: CURRENCY[country] }])),
  createWholesaleDraftOrder: async (input) => ({ id: `demo-draft-${++store().seq}`, name: `#D${store().seq}`, invoiceUrl: pay("order", input.tags) }),
  completeDraftAsPending: async () => ({ orderId: String(++store().seq), orderName: `#${store().seq}` }),
  markOrderPaid: async () => {},
  orderShipTo: async () => ({
    name: "Demo Buyer", company: "Demo Gift Shop", phone: "+971500000001", street: ["Shop 4, Marina Walk"], city: "Dubai", country: "AE",
  }),
  fulfilWithTracking: async () => {},
  bookShipment: async () => ({
    trackingNumber: `7946${String(++store().seq).padStart(8, "0")}`,
    documents: [{ kind: "label", pdf: Buffer.from("%PDF-1.4\n% Demo FedEx label\n").toString("base64") }],
  }),
  createInvoiceDraftOrder: async (input) => ({ id: `demo-draft-${++store().seq}`, name: `#D${store().seq}`, invoiceUrl: pay("settlement", input.tags) }),
  adjustStock: async (changes) => {
    for (const c of changes) {
      const [code, size] = codeOfItem(c.inventoryItemId) as [string, Size];
      const at = store().stock.get(c.locationId) ?? new Map<string, number>();
      at.set(sku(code, size), (at.get(sku(code, size)) ?? 0) + c.delta);
      store().stock.set(c.locationId, at);
    }
  },
  createLocationProduct: async (input) => {
    store().products.push({
      title: input.title, handle: input.designCode.toLowerCase(), exclusiveTo: input.exclusiveTo ?? undefined,
      retailPrice: RETAIL.US, currency: "USD", sizes: [],
    });
    for (const size of SIZES) store().stock.get(DEMO_LOCATIONS.cancun)!.set(sku(input.designCode, size), 60);
    return { productId: String(++store().seq) };
  },
});

// ---- The simulator's tickets ----------------------------------------------------------------------------

function addMessage(ticketId: string, m: Omit<TicketMessage, "id" | "createdAt">) {
  const t = store().tickets.get(ticketId)!;
  const id = `demo-${++store().seq}`;
  t.messages.push({ ...m, id, createdAt: new Date(Date.now() + store().seq).toISOString() });
  return Promise.resolve(id);
}

export function startDemoTicket(id = String(++store().seq)): string {
  store().tickets.set(id, { id, channel: "whatsapp", messages: [], notes: [], tags: [], activity: [] });
  return id;
}

export function demoTicket(id: string) {
  return store().tickets.get(id);
}

export async function sendAsCustomer(ticketId: string, phone: string, body: string, image?: string) {
  if (!store().tickets.has(ticketId)) startDemoTicket(ticketId);
  await addMessage(ticketId, {
    fromAgent: false, via: "whatsapp", body, images: image ? [image] : [], customerPhone: phone, ourAddress: "+15558763944",
  });
}

// Runs the bot on a simulator ticket, the way Gorgias' webhook would.
export async function answerDemoTicket(ticketId: string) {
  store().current = ticketId;
  try {
    const { handleTicket } = await import("./bot");
    await handleTicket(ticketId);
  } finally {
    store().current = undefined;
  }
}

export async function sendAsAgent(ticketId: string, body: string) {
  await addMessage(ticketId, { fromAgent: true, via: "helpdesk", body, images: [] });
}

// ---- Demo accounts ---------------------------------------------------------------------------------------

// Creates the demo stockist, display partner, designer and admin account the first time the demo runs.
export async function ensureDemoAccounts() {
  const d = await db();
  const [done] = await d.select().from(wholesalers).where(eq(wholesalers.name, "Demo Gift Shop"));
  await ensureDemoInvite();
  if (done) return seedDemoDesigns();
  await createWholesaler({
    name: "Demo Gift Shop", currency: "USD", shopifyCustomerId: DEMO_CUSTOMER, stockist: true, displayPartner: false,
    contactName: "Sara", phone: DEMO_PHONES.stockist, email: "stockist@demo.example",
  });
  const partner = await createWholesaler({
    name: "Demo Beach Resort", currency: "MXN", shopifyCustomerId: DEMO_CUSTOMER, stockist: false, displayPartner: true,
    contactName: "Lucía", phone: DEMO_PHONES.partner, email: "partner@demo.example",
  });
  await addOutlet({
    wholesalerId: partner.id, name: "Lobby Boutique", city: "Cancún", country: "MX", shopifyLocationId: DEMO_LOCATIONS.outlet,
    supplyRoute: "cancun", parPerSku: 6, settlementDays: 15,
  });
  const [outlet] = await d.select().from(outlets).where(eq(outlets.wholesalerId, partner.id));
  await addDisplay({ outletId: outlet.id, kind: "tower", serial: "DEMO-TOWER-1", installedAt: "2026-10-01" });
  const admin = config().ADMIN_EMAILS.split(",")[0]?.trim().toLowerCase();
  const people = [
    ...(admin ? [{ email: admin, name: "Admin", handle: "admin" }] : []),
    { email: "designer@demo.example", name: "Maya (demo designer)", handle: "maya" },
  ];
  for (const p of people) {
    await d.insert(users).values({ ...p, credits: 30, agreementVersion: "demo", agreementAcceptedAt: new Date() }).onConflictDoNothing();
  }
  await seedDemoDesigns();
}

// An invite code that always works in the demo, for trying the studio sign-up with a store account.
export const DEMO_INVITE = "DEMO-INVITE";

async function ensureDemoInvite() {
  const d = await db();
  const [used] = await d.select().from(invites).where(eq(invites.code, DEMO_INVITE));
  if (used?.usedBy) await d.update(invites).set({ code: `${DEMO_INVITE}-${Date.now()}` }).where(eq(invites.code, DEMO_INVITE));
  if (!used || used.usedBy) await d.insert(invites).values({ code: DEMO_INVITE, note: "demo" });
}

// Two finished designs for the demo designer, made from the live store's product photos, with the first one
// live for pre-orders, so the Design tab and the studio have something in them without any AI calls.
const SAMPLE_ART = [
  { title: "Beach Day", code: "DMBCH", src: "https://cdn.shopify.com/s/files/1/0819/7518/1554/files/beach_mixed.jpg", live: true },
  { title: "Desert Falcon", code: "DMFAL", src: "https://cdn.shopify.com/s/files/1/0819/7518/1554/files/uae_1.png", live: false },
];

async function seedDemoDesigns() {
  const d = await db();
  const [maya] = await d.select().from(users).where(eq(users.email, "designer@demo.example"));
  if (!maya || (await d.select({ id: designs.id }).from(designs).where(eq(designs.userId, maya.id)).limit(1)).length) return;
  for (const a of SAMPLE_ART) {
    const res = await fetch(a.src).catch(() => undefined);
    if (!res?.ok) continue;
    const key = await put("demo", a.src.endsWith(".png") ? "png" : "jpg", Buffer.from(await res.arrayBuffer()));
    const [design] = await d.insert(designs).values({
      userId: maya.id, title: a.title, preset: "demo", prompt: `Demo design: ${a.title}`,
      lineArtKey: key, colourKey: key, compositeKey: key, printLineKey: key, printColourKey: key,
      printReport: { ok: true, colours: 6, maxColours: 8, widthPx: 3600, heightPx: 4800, problems: [] },
    }).returning();
    if (!a.live) continue;
    const now = Date.now();
    await d.insert(campaigns).values({
      slug: a.title.toLowerCase().replace(/\W+/g, "-"), designCode: a.code, designId: design.id, userId: maya.id, title: a.title,
      story: "Sun-soaked and grey in the shade: a day at the beach that only shows its colours outside.", market: MARKET,
      status: "live", goal: FUNDING_GOAL, stretchGoals: STRETCH_GOALS, priceCents: PRICE_CENTS, currency: CAMPAIGN_CURRENCY,
      startsAt: new Date(now - 3 * 86_400_000), endsAt: new Date(now + 11 * 86_400_000),
    });
  }
}
