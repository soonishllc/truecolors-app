import { config } from "../config";

// Gorgias owns the WhatsApp number. Its HTTP integration tells us a ticket has a new message; we read the
// ticket here and answer through the REST API, so the team sees every bot reply in the same thread.

export class GorgiasError extends Error {}

export type TicketMessage = {
  id: string;
  fromAgent: boolean;
  // "api" for messages sent through the REST API (the bot); "helpdesk" and others for people.
  via: string;
  body: string;
  // The customer's WhatsApp number on their messages, digits only.
  customerPhone?: string;
  // Our WhatsApp address and the integration it came in on, so the reply goes out the same way.
  ourAddress?: string;
  integrationId?: number;
  // Photos the customer sent, such as a till report.
  images: string[];
  createdAt: string;
};

export type Ticket = { id: string; channel: string; messages: TicketMessage[] };

export const digits = (phone: string) => phone.replace(/\D/g, "");

export async function gorgias<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { GORGIAS_DOMAIN, GORGIAS_USERNAME, GORGIAS_API_KEY } = config();
  if (!GORGIAS_DOMAIN || !GORGIAS_USERNAME || !GORGIAS_API_KEY) throw new GorgiasError("Gorgias isn't configured");
  const res = await fetch(`https://${GORGIAS_DOMAIN}/api${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${Buffer.from(`${GORGIAS_USERNAME}:${GORGIAS_API_KEY}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new GorgiasError(`Gorgias ${res.status} on ${path}: ${await res.text()}`);
  return res.json() as Promise<T>;
}

type RawMessage = {
  id: number;
  from_agent: boolean;
  via?: string;
  channel?: string;
  body_text?: string | null;
  stripped_text?: string | null;
  integration_id?: number | null;
  created_datetime: string;
  source?: { from?: { address?: string }; to?: { address?: string }[] };
  attachments?: { url: string; content_type?: string }[] | null;
};

export function toTicketMessage(m: RawMessage): TicketMessage {
  return {
    id: String(m.id),
    fromAgent: m.from_agent,
    via: m.via ?? "",
    body: (m.stripped_text || m.body_text || "").trim(),
    customerPhone: !m.from_agent && m.source?.from?.address ? digits(m.source.from.address) : undefined,
    ourAddress: !m.from_agent ? m.source?.to?.[0]?.address : undefined,
    integrationId: m.integration_id ?? undefined,
    images: (m.attachments ?? []).filter((a) => a.content_type?.startsWith("image/")).map((a) => a.url),
    createdAt: m.created_datetime,
  };
}

export async function getTicket(ticketId: string): Promise<Ticket> {
  const t = await gorgias<{ id: number; channel: string; messages?: RawMessage[] }>(`/tickets/${ticketId}`);
  const messages = (t.messages ?? []).map(toTicketMessage).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { id: String(t.id), channel: t.channel, messages };
}

// Sends a WhatsApp reply on the ticket, back to the number and integration the customer wrote in on.
export async function replyOnTicket(ticket: Ticket, text: string): Promise<string> {
  const last = ticket.messages.filter((m) => !m.fromAgent).at(-1);
  if (!last?.customerPhone) throw new GorgiasError(`Ticket ${ticket.id} has no customer number to reply to`);
  const sent = await gorgias<{ id: number }>(`/tickets/${ticket.id}/messages`, {
    method: "POST",
    body: JSON.stringify({
      channel: "whatsapp",
      via: "api",
      from_agent: true,
      body_text: text,
      integration_id: last.integrationId,
      source: {
        type: "whatsapp-message",
        from: { address: last.ourAddress },
        to: [{ address: `+${last.customerPhone}` }],
      },
    }),
  });
  return String(sent.id);
}

// Leaves the team a note on why the bot stepped back, and tags the ticket so a Gorgias rule can route it
// to the wholesale team by language.
export async function handOverTicket(ticketId: string, reason: string, tags: string[]) {
  await gorgias(`/tickets/${ticketId}/messages`, {
    method: "POST",
    body: JSON.stringify({ channel: "internal-note", via: "api", from_agent: true, body_text: `Bot handed over: ${reason}` }),
  });
  await gorgias(`/tickets/${ticketId}/tags`, { method: "POST", body: JSON.stringify({ names: tags }) });
}
