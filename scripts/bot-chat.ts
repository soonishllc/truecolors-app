import { createInterface } from "node:readline/promises";
import type { Ticket, TicketMessage } from "../src/lib/gorgias/client";
import { digits } from "../src/lib/gorgias/client";
import { handleTicket } from "../src/lib/wholesale/bot";
import { useWholesaleOps, wholesaleOps } from "../src/lib/wholesale/ops";

// Talk to the wholesale bot in the terminal as if from WhatsApp, before Gorgias is wired up. Gorgias is
// replaced by this terminal; Claude, Shopify, FedEx and the database are real. Use a development store:
// placing an order creates a real draft order.
//
//   npm run wholesale:chat -- +971501234567        chat as that number (unknown numbers are treated as new)
//   Start a line with "photo:<url>" to send a photo, e.g. a till report, along with the text after it.
//   Type "agent: <text>" to reply as a person on the team, which stops the bot. Ctrl+D or "quit" to end.

const phone = digits(process.argv[2] ?? "");
if (!phone) {
  console.error("Give the WhatsApp number to chat as: npm run wholesale:chat -- +971501234567");
  process.exit(1);
}

const ticket: Ticket = { id: String(Date.now()), channel: "whatsapp", messages: [] };
let seq = 0;
const add = (m: Omit<TicketMessage, "id" | "createdAt">) =>
  ticket.messages.push({ ...m, id: `local-${ticket.id}-${++seq}`, createdAt: new Date(Date.now() + seq).toISOString() });

const live = wholesaleOps();
useWholesaleOps({
  ...live,
  getTicket: async () => ticket,
  replyOnTicket: async (_t, text) => {
    add({ fromAgent: true, via: "api", body: text, images: [] });
    console.log(`\nbot › ${text}\n`);
    return ticket.messages.at(-1)!.id;
  },
  handOverTicket: async (_id, reason, tags) => {
    console.log(`  [handed to the team: ${reason} · tags ${tags.join(", ")}]\n`);
  },
});

async function main() {
  console.log(`Chatting as +${phone} on local ticket ${ticket.id}. Ctrl+D to end.\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  for (;;) {
    let line: string;
    try {
      line = (await rl.question("you › ")).trim();
    } catch {
      break;
    }
    if (!line) continue;
    if (line === "quit") break;
    if (line.startsWith("agent:")) {
      add({ fromAgent: true, via: "helpdesk", body: line.slice(6).trim(), images: [] });
    } else {
      const photo = line.match(/^photo:(\S+)\s*(.*)$/);
      add({
        fromAgent: false, via: "whatsapp", body: photo ? photo[2] : line, images: photo ? [photo[1]] : [],
        customerPhone: phone, ourAddress: "+0000000000",
      });
    }
    try {
      await handleTicket(ticket.id);
    } catch (e) {
      console.error(`  [error: ${(e as Error).message}]`);
    }
  }
  rl.close();
}

main().then(() => process.exit(0));
