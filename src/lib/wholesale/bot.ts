import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { config } from "../config";
import { db } from "../db/client";
import { botConversations, botMessages } from "../db/schema";
import type { Ticket } from "../gorgias/client";
import { wholesaleOps } from "./ops";
import { identifySender, toolsFor, type RunState, type Sender } from "./tools";

// The wholesale bot: answers WhatsApp messages that arrive as Gorgias tickets. It replies until it hands
// the chat to the team, or until someone on the team writes in the ticket; after that it stays quiet.

const MAX_ROUNDS = 6;

const SYSTEM = `You are the Truecolors wholesale assistant on WhatsApp. Truecolors makes colour-changing tees: \
grey line art in the shade that bursts into full colour in sunlight. They're made in Cancún, Mexico.

Two kinds of wholesale customer:
- Stockists buy shirts outright at a wholesale price, tiered by quantity above a minimum order, and pay upfront by card or bank transfer. Orders ship by FedEx from Cancún, duties paid by Truecolors.
- Display partners (hotel boutiques, airports, attractions) take a Truecolors display on consignment: Sunbox (countertop, one demo shirt), Prism (three-sided floor stand with a screen, no stock) or Tower (floor shop-in-shop, about 340 shirts). They sell on their own till, pay Truecolors a fixed price per shirt sold, and settle every 15 days.

How to answer:
- Reply in the language the customer writes in: English, Arabic or Spanish.
- Write short WhatsApp messages: a few lines, plain text, no markdown headings or tables.
- Take prices, stock, terms and order details only from your tools. If a tool doesn't give you something, say the team will confirm it rather than guessing.
- Stockists can order with you: build the basket from get_catalog SKUs, price it with quote_order, show them the quote, and only after they clearly confirm it and choose card or bank transfer, place it with place_order. Send the payment link or bank details exactly as the tool returns them.
- You can't change or cancel orders or arrange display restocks yet. For those, and for anything else you can't answer, use hand_to_person.
- If someone new wants to stock Truecolors or take a display, find out their name, business, city and type of venue, then save them with record_lead and tell them the wholesale team will be in touch.`;

function describeSender(s: Sender): string {
  if (!s.contact || !s.wholesaler) return "The sender's number isn't linked to a wholesale account. Treat them as a possible new wholesaler.";
  const w = s.wholesaler;
  const kinds = [w.stockist && "stockist", w.displayPartner && "display partner"].filter(Boolean).join(" and ") || "not set up yet";
  const where = s.outlets.map((o) => `${o.name} (${o.city})`).join(", ");
  return (
    `The sender is ${s.contact.name} (${s.contact.role}) at ${w.name}. Account status: ${w.status}; ${kinds}; ` +
    `currency ${w.currency}.${where ? ` Outlets: ${where}.` : ""}`
  );
}

// The ticket so far as a conversation: the customer's messages as user turns, ours and the team's as assistant.
function history(ticket: Ticket): Anthropic.Beta.BetaMessageParam[] {
  const turns: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of ticket.messages) {
    if (!m.body) continue;
    const role = m.fromAgent ? "assistant" : "user";
    const prev = turns.at(-1);
    if (prev?.role === role) prev.content = `${prev.content}\n\n${m.body}`;
    else turns.push({ role, content: m.body });
  }
  while (turns[0]?.role === "assistant") turns.shift();
  return turns;
}

async function converse(sender: Sender, ticket: Ticket, state: RunState): Promise<string | undefined> {
  const tools = toolsFor(sender);
  const messages = history(ticket);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await wholesaleOps().converse({
      model: config().BOT_MODEL,
      max_tokens: 16000,
      // Chat replies don't need deep reasoning; low effort keeps them quick.
      output_config: { effort: "low" },
      // If a safety classifier declines, the API retries on a model chosen for that case.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: [
        { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
        { type: "text", text: describeSender(sender) },
      ],
      tools: tools.map((t) => t.def),
      messages,
    });
    if (res.stop_reason === "refusal") {
      state.handover = "the assistant declined to answer";
      return;
    }
    messages.push({ role: "assistant", content: res.content });
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) {
      return res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
    }
    const results = await Promise.all(
      calls.map(async (call): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        const tool = tools.find((t) => t.def.name === call.name);
        try {
          if (!tool) throw new Error(`No tool called ${call.name}`);
          const out = await tool.run(call.input as Record<string, unknown>, sender, state);
          return { type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out) };
        } catch (e) {
          console.error(`[wholesale bot] ${call.name} failed:`, (e as Error).message);
          return { type: "tool_result", tool_use_id: call.id, content: "That lookup failed.", is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  state.handover = "the assistant couldn't finish an answer";
}

const LANGUAGE_TAGS: [RegExp, string][] = [
  [/[؀-ۿ]/, "lang-ar"],
  [/[ñáéíóú¿¡]|\b(hola|gracias|pedido|camisas)\b/i, "lang-es"],
];

const languageTag = (text: string) => LANGUAGE_TAGS.find(([re]) => re.test(text))?.[1] ?? "lang-en";

// Called for each "new message" webhook. Safe to repeat: each customer message is answered once.
export async function handleTicket(ticketId: string) {
  const ops = wholesaleOps();
  const ticket = await ops.getTicket(ticketId);
  if (ticket.channel !== "whatsapp") return;
  const phone = ticket.messages.find((m) => m.customerPhone)?.customerPhone;
  if (!phone) return;

  const d = await db();
  await d.insert(botConversations).values({ gorgiasTicketId: ticket.id, phone }).onConflictDoNothing();
  const [conv] = await d.select().from(botConversations).where(eq(botConversations.gorgiasTicketId, ticket.id));
  if (conv.status === "human") return;

  // Record what's new. A message from a person on the team means they've taken over.
  let fresh = false;
  for (const m of ticket.messages) {
    const role = !m.fromAgent ? "customer" : m.via === "api" ? "bot" : "agent";
    const [row] = await d
      .insert(botMessages)
      .values({ conversationId: conv.id, gorgiasMessageId: m.id, role, body: m.body })
      .onConflictDoNothing()
      .returning();
    if (!row) continue;
    if (role === "agent") {
      await d
        .update(botConversations)
        .set({ status: "human", handoverReason: "a team member replied", updatedAt: new Date() })
        .where(eq(botConversations.id, conv.id));
      return;
    }
    if (role === "customer") fresh = true;
  }
  // Only answer when the newest message is the customer's and we haven't seen it before.
  if (!fresh || ticket.messages.at(-1)?.fromAgent) return;

  const sender = await identifySender(phone);
  if (sender.contact && !conv.contactId) {
    await d.update(botConversations).set({ contactId: sender.contact.id }).where(eq(botConversations.id, conv.id));
  }
  const state: RunState = {};
  let reply: string | undefined;
  try {
    reply = await converse(sender, ticket, state);
  } catch (e) {
    console.error(`[wholesale bot] ticket ${ticket.id}:`, (e as Error).message);
    state.handover = "the assistant hit an error";
  }

  if (reply) {
    try {
      const sentId = await ops.replyOnTicket(ticket, reply);
      await d
        .insert(botMessages)
        .values({ conversationId: conv.id, gorgiasMessageId: sentId, role: "bot", body: reply })
        .onConflictDoNothing();
    } catch (e) {
      console.error(`[wholesale bot] reply on ticket ${ticket.id} failed:`, (e as Error).message);
      state.handover ??= "the bot's reply couldn't be sent";
    }
  }
  if (state.handover) {
    const lastCustomer = ticket.messages.filter((m) => !m.fromAgent).at(-1)?.body ?? "";
    await ops.handOverTicket(ticket.id, state.handover, ["bot-handover", "wholesale", languageTag(lastCustomer)]);
    await d
      .update(botConversations)
      .set({ status: "human", handoverReason: state.handover, updatedAt: new Date() })
      .where(and(eq(botConversations.id, conv.id), eq(botConversations.status, "bot")));
  } else {
    await d.update(botConversations).set({ updatedAt: new Date() }).where(eq(botConversations.id, conv.id));
  }
}

// From the Admin page: let the bot answer this conversation again.
export async function handBackToBot(conversationId: string) {
  const d = await db();
  await d
    .update(botConversations)
    .set({ status: "bot", handoverReason: null, updatedAt: new Date() })
    .where(eq(botConversations.id, conversationId));
}
