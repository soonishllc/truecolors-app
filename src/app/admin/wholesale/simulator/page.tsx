import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { config } from "@/lib/config";
import { demoTicket, ensureDemoAccounts, startDemoTicket } from "@/lib/wholesale/demo";
import { Chat } from "./Chat";
import { PERSONAS, type Persona } from "./personas";
import { simAgentAction, simNewChatAction, simSendAction } from "./actions";

export const dynamic = "force-dynamic";

// Stands in for WhatsApp in the local demo: chat as a new business, the demo stockist or the demo display
// partner, and see the bot's real replies, the tools it used and when it hands over to the team.

export default async function Simulator({ searchParams }: { searchParams: Promise<{ as?: string; t?: string }> }) {
  if (!config().WHOLESALE_DEMO) notFound();
  await ensureDemoAccounts();
  const q = await searchParams;
  const as: Persona = q.as && q.as in PERSONAS ? (q.as as Persona) : "stockist";
  if (!q.t || !demoTicket(q.t)) redirect(`/admin/wholesale/simulator?as=${as}&t=${startDemoTicket(q.t)}`);
  const ticket = demoTicket(q.t)!;
  const persona = PERSONAS[as];
  // Each new-business chat gets its own number, so it starts as a stranger.
  const phone = as === "new" ? `${persona.phone}${ticket.id.slice(-3)}` : persona.phone;
  const keyMissing = !config().ANTHROPIC_API_KEY;
  const handedOver = ticket.notes.length > 0;

  return (
    <div className="sim-page">
      <p className="small"><Link href="/admin/wholesale">← Wholesale admin</Link></p>
      <div className="eyebrow">Local demo · not WhatsApp yet</div>
      <h1>Wholesale bot simulator</h1>
      <p className="muted">
        The real bot and real Claude, with sample stock and orders instead of Shopify. Paying a link marks the order paid and
        books a demo FedEx label.
      </p>
      {keyMissing && (
        <p className="notice">Add ANTHROPIC_API_KEY to .env.local and restart the demo; the bot can&apos;t reply without it.</p>
      )}

      <nav className="sim-personas" aria-label="Who you're chatting as">
        {(Object.keys(PERSONAS) as Persona[]).map((p) => (
          <form key={p} action={simNewChatAction}>
            <input type="hidden" name="as" value={p} />
            <button className={p === as ? "" : "secondary"} aria-pressed={p === as}>{PERSONAS[p].label}</button>
          </form>
        ))}
      </nav>

      <div className="sim">
        <Chat
          ticket={ticket} phone={phone} title="Truecolors Wholesale" subtitle={`You: ${persona.label} (+${phone})`}
          empty="Say hello, or pick a message on the right."
        />

        <aside className="sim-side">
          <h2>{persona.label}</h2>
          <p className="small muted">{persona.who}</p>
          <h3>Try saying</h3>
          <div className="stack">
            {persona.tries.map((t) => (
              <form key={t} action={simSendAction}>
                <input type="hidden" name="ticket" value={ticket.id} />
                <input type="hidden" name="phone" value={phone} />
                <input type="hidden" name="text" value={t} />
                <button className="secondary sim-try">{t}</button>
              </form>
            ))}
          </div>

          <h3>Reply as the team</h3>
          <p className="small muted">
            {handedOver ? "The bot has handed this chat over and stays quiet." : "Once a person replies, the bot steps back."}
          </p>
          <form action={simAgentAction} className="row">
            <input type="hidden" name="ticket" value={ticket.id} />
            <input name="text" placeholder="Hi, it's the Truecolors team…" aria-label="Team reply" />
            <button className="secondary">Send as team</button>
          </form>

          <h3>See the other side</h3>
          <ul className="small">
            <li><Link href="/admin/wholesale">Wholesale admin</Link>: orders, restocks, settlements, chats</li>
            <li><a href="/wholesale/demo-login?as=stockist">Portal as Sara</a> · <a href="/wholesale/demo-login?as=partner">Portal as Lucía</a></li>
          </ul>
        </aside>
      </div>
    </div>
  );
}
