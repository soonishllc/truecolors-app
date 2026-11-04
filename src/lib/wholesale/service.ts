import { randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { displays, outlets, serviceTickets, wholesalers } from "../db/schema";
import { UserError } from "../design/service";
import { notify } from "./orders";

// The displays out at partners' outlets, and the faults partners report on them. A fault takes the display
// out of service until the team resolves it.

const KINDS = ["sunbox", "prism", "tower"] as const;
type Kind = (typeof KINDS)[number];

const newRef = () => {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  return `F-${[...randomBytes(5)].map((b) => alphabet[b % alphabet.length]).join("")}`;
};

export async function addDisplay(input: { outletId: string; kind: string; serial: string; installedAt: string }) {
  if (!(KINDS as readonly string[]).includes(input.kind)) throw new UserError("Pick Sunbox, Prism or Tower.");
  if (!input.serial.trim()) throw new UserError("Enter the display's serial number.");
  const d = await db();
  const [taken] = await d.select().from(displays).where(eq(displays.serial, input.serial.trim().toUpperCase()));
  if (taken) throw new UserError("A display with that serial is already registered.");
  await d.insert(displays).values({
    outletId: input.outletId, kind: input.kind as Kind, serial: input.serial.trim().toUpperCase(),
    installedAt: input.installedAt ? new Date(input.installedAt) : new Date(),
  });
}

export async function displaysAt(outletId: string) {
  const d = await db();
  return d.select().from(displays).where(and(eq(displays.outletId, outletId)));
}

// Finds which display the partner means, from its kind or serial; undefined if it's unclear.
function pick(list: (typeof displays.$inferSelect)[], hint: string) {
  const live = list.filter((x) => x.status !== "removed");
  if (live.length === 1) return live[0];
  const h = hint.trim().toLowerCase();
  if (!h) return;
  const matches = live.filter((x) => x.serial.toLowerCase() === h || x.kind === h || h.includes(x.kind));
  return matches.length === 1 ? matches[0] : undefined;
}

export async function reportFault(input: {
  outletId: string; contactId: string | null; problem: string; display: string; photos: string[]; gorgiasTicketId?: string;
}) {
  if (input.problem.trim().length < 5) throw new UserError("Tell us what's wrong with the display.");
  const d = await db();
  const display = pick(await displaysAt(input.outletId), input.display);
  const [ticket] = await d
    .insert(serviceTickets)
    .values({
      ref: newRef(), outletId: input.outletId, displayId: display?.id ?? null, reportedBy: input.contactId,
      problem: input.problem.trim(), photos: input.photos, gorgiasTicketId: input.gorgiasTicketId ?? null,
    })
    .returning();
  if (display) await d.update(displays).set({ status: "in_service" }).where(eq(displays.id, display.id));
  return { ticket, display };
}

export async function resolveFault(ticketId: string, resolution: string) {
  if (!resolution.trim()) throw new UserError("Say what was done.");
  const d = await db();
  const [t] = await d
    .update(serviceTickets)
    .set({ status: "resolved", resolution: resolution.trim(), resolvedAt: new Date() })
    .where(and(eq(serviceTickets.id, ticketId), eq(serviceTickets.status, "open")))
    .returning();
  if (!t) throw new UserError("That fault is already resolved.");
  if (t.displayId) await d.update(displays).set({ status: "active" }).where(eq(displays.id, t.displayId));
  const [row] = await d
    .select({ outlet: outlets, wholesaler: wholesalers })
    .from(outlets)
    .innerJoin(wholesalers, eq(wholesalers.id, outlets.wholesalerId))
    .where(eq(outlets.id, t.outletId));
  await notify(row.wholesaler, `fault-resolved:${t.id}`, `Display at ${row.outlet.name}: fixed (${t.ref})`, [
    `You reported: "${t.problem}"`, `What we did: ${t.resolution}`,
  ]);
}

export async function openFaults() {
  const d = await db();
  return d
    .select({ t: serviceTickets, outlet: outlets, wholesaler: wholesalers, display: displays })
    .from(serviceTickets)
    .innerJoin(outlets, eq(outlets.id, serviceTickets.outletId))
    .innerJoin(wholesalers, eq(wholesalers.id, outlets.wholesalerId))
    .leftJoin(displays, eq(displays.id, serviceTickets.displayId))
    .where(eq(serviceTickets.status, "open"))
    .orderBy(desc(serviceTickets.createdAt));
}

export async function faultsFor(outletId: string) {
  const d = await db();
  return d.select().from(serviceTickets).where(eq(serviceTickets.outletId, outletId)).orderBy(desc(serviceTickets.createdAt)).limit(10);
}
