import { desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { botConversations, outlets, wholesaleContacts, wholesalers } from "../db/schema";
import { UserError } from "../design/service";
import { digits } from "../gorgias/client";
import { WHOLESALE_CURRENCIES, type WholesaleCurrency } from "../rules";

// Setting up wholesale accounts from the Admin page. Leads the bot saved are activated here too.

type Kinds = { stockist: boolean; displayPartner: boolean };


function checkKinds(k: Kinds) {
  if (!k.stockist && !k.displayPartner) throw new UserError("Pick stockist, display partner or both.");
}

function checkCurrency(c: string): WholesaleCurrency {
  if (!(WHOLESALE_CURRENCIES as readonly string[]).includes(c)) throw new UserError("Pick AED, USD or MXN.");
  return c as WholesaleCurrency;
}

// Accepts +971 50 123 4567, 00971501234567 and the like; stores digits only, with the country code.
export function normalisePhone(input: string): string | null {
  const d = digits(input).replace(/^00/, "");
  if (!d) return null;
  if (d.length < 8 || d.length > 15) throw new UserError("Enter the WhatsApp number with its country code.");
  return d;
}

export async function createWholesaler(input: {
  name: string; currency: string; shopifyCustomerId: string;
  contactName: string; phone: string; email: string;
} & Kinds) {
  if (!input.name) throw new UserError("Enter the business name.");
  if (!input.contactName) throw new UserError("Enter the contact's name.");
  checkKinds(input);
  const currency = checkCurrency(input.currency);
  const phone = normalisePhone(input.phone);
  const email = input.email.toLowerCase() || null;
  if (!phone && !email) throw new UserError("Enter a WhatsApp number, an email, or both.");
  const d = await db();
  await taken(phone, email);
  const [w] = await d
    .insert(wholesalers)
    .values({
      name: input.name, status: "active", stockist: input.stockist, displayPartner: input.displayPartner, currency,
      shopifyCustomerId: input.shopifyCustomerId.replace(/\D/g, "") || null,
    })
    .returning();
  await d.insert(wholesaleContacts).values({ wholesalerId: w.id, name: input.contactName, phone, email, role: "owner" });
  return w;
}

async function taken(phone: string | null, email: string | null) {
  const d = await db();
  if (phone && (await d.select().from(wholesaleContacts).where(eq(wholesaleContacts.phone, phone))).length) {
    throw new UserError("That WhatsApp number already belongs to a wholesale contact.");
  }
  if (email && (await d.select().from(wholesaleContacts).where(eq(wholesaleContacts.email, email))).length) {
    throw new UserError("That email already belongs to a wholesale contact.");
  }
}

export async function addContact(input: { wholesalerId: string; name: string; phone: string; email: string; role: string }) {
  if (!input.name) throw new UserError("Enter the contact's name.");
  const phone = normalisePhone(input.phone);
  const email = input.email.toLowerCase() || null;
  if (!phone && !email) throw new UserError("Enter a WhatsApp number, an email, or both.");
  await taken(phone, email);
  const d = await db();
  await d.insert(wholesaleContacts).values({
    wholesalerId: input.wholesalerId, name: input.name, phone, email, role: input.role === "owner" ? "owner" : "staff",
  });
}

export async function activateWholesaler(input: { wholesalerId: string; currency: string; shopifyCustomerId: string } & Kinds) {
  checkKinds(input);
  const d = await db();
  await d
    .update(wholesalers)
    .set({
      status: "active", stockist: input.stockist, displayPartner: input.displayPartner, currency: checkCurrency(input.currency),
      shopifyCustomerId: input.shopifyCustomerId.replace(/\D/g, "") || null,
    })
    .where(eq(wholesalers.id, input.wholesalerId));
}

function checkOutletSettings(parPerSku: number, settlementDays: number) {
  if (!Number.isInteger(parPerSku) || parPerSku < 1) throw new UserError("The usual stock per design and size is a whole number, 1 or more.");
  if (settlementDays !== 15 && settlementDays !== 7) throw new UserError("Settle every 15 days, or weekly for busy outlets.");
}

export async function addOutlet(input: {
  wholesalerId: string; name: string; city: string; country: string; shopifyLocationId: string;
  parPerSku?: number; settlementDays?: number;
}) {
  if (!input.name || !input.city || !input.country) throw new UserError("Enter the outlet's name, city and country.");
  const parPerSku = input.parPerSku ?? 6;
  const settlementDays = input.settlementDays ?? 15;
  checkOutletSettings(parPerSku, settlementDays);
  const d = await db();
  const [w] = await d.select().from(wholesalers).where(eq(wholesalers.id, input.wholesalerId));
  if (!w?.displayPartner) throw new UserError("Outlets are for display partners.");
  await d.insert(outlets).values({
    wholesalerId: w.id, name: input.name, city: input.city, country: input.country,
    shopifyLocationId: input.shopifyLocationId.replace(/\D/g, "") || null,
    // All wholesale ships from the Cancún hub.
    supplyRoute: "cancun",
    parPerSku, settlementDays,
  });
}

export async function updateOutletSettings(input: { outletId: string; parPerSku: number; settlementDays: number; shopifyLocationId: string }) {
  checkOutletSettings(input.parPerSku, input.settlementDays);
  const d = await db();
  await d
    .update(outlets)
    .set({
      parPerSku: input.parPerSku, settlementDays: input.settlementDays,
      ...(input.shopifyLocationId && { shopifyLocationId: input.shopifyLocationId.replace(/\D/g, "") }),
    })
    .where(eq(outlets.id, input.outletId));
}

export async function wholesaleOverview() {
  const d = await db();
  const all = await d.select().from(wholesalers).orderBy(desc(wholesalers.createdAt));
  const contacts = await d.select().from(wholesaleContacts);
  const allOutlets = await d.select().from(outlets);
  const chats = await d
    .select({ c: botConversations, contact: wholesaleContacts })
    .from(botConversations)
    .leftJoin(wholesaleContacts, eq(wholesaleContacts.id, botConversations.contactId))
    .orderBy(desc(botConversations.updatedAt))
    .limit(30);
  return {
    wholesalers: all.map((w) => ({
      w,
      contacts: contacts.filter((c) => c.wholesalerId === w.id),
      outlets: allOutlets.filter((o) => o.wholesalerId === w.id),
    })),
    chats,
  };
}
