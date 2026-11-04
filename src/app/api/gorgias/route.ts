import { timingSafeEqual } from "node:crypto";
import { after } from "next/server";
import { config } from "@/lib/config";
import { handleTicket } from "@/lib/wholesale/bot";

// Gorgias' HTTP integration posts {"ticket_id": ...} here whenever a ticket gets a new message. We answer
// at once and do the work after the response, so a slow reply never makes Gorgias retry.

function authorised(header: string | null): boolean {
  const secret = config().GORGIAS_WEBHOOK_SECRET;
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  if (!authorised(req.headers.get("x-truecolors-secret"))) return new Response("Unauthorized", { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { ticket_id?: string | number };
  const ticketId = String(body.ticket_id ?? "").trim();
  if (!/^\d+$/.test(ticketId)) return new Response("No ticket_id", { status: 400 });
  after(() =>
    handleTicket(ticketId).catch((e) => console.error(`[gorgias] ticket ${ticketId}:`, (e as Error).message)),
  );
  return new Response("OK");
}
