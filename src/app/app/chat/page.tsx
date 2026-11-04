import { notFound, redirect } from "next/navigation";
import { Chat } from "@/app/admin/wholesale/simulator/Chat";
import { PERSONAS, type Persona } from "@/app/admin/wholesale/simulator/personas";
import { simSendAction } from "@/app/admin/wholesale/simulator/actions";
import { config } from "@/lib/config";
import { DEMO_PHONES, demoTicket, ensureDemoAccounts, startDemoTicket } from "@/lib/wholesale/demo";
import { currentWholesaler } from "@/lib/wholesale/portal-auth";

export const dynamic = "force-dynamic";

// The app preview's Chat tab: the wholesale bot, as whoever is signed in to the Wholesale tab (or a new business
// when nobody is). In the real app this tab opens the same conversation in WhatsApp.
export default async function AppChat({ searchParams }: { searchParams: Promise<{ as?: string; t?: string }> }) {
  if (!config().WHOLESALE_DEMO) notFound();
  await ensureDemoAccounts();
  const q = await searchParams;
  const me = await currentWholesaler();
  const signedIn: Persona =
    "contact" in me && me.contact?.phone === DEMO_PHONES.partner ? "partner" : "contact" in me && me.contact ? "stockist" : "new";
  const as: Persona = q.as && q.as in PERSONAS ? (q.as as Persona) : signedIn;
  if (!q.t || !demoTicket(q.t)) redirect(`/app/chat?as=${as}&t=${startDemoTicket(q.t)}`);
  const ticket = demoTicket(q.t)!;
  const persona = PERSONAS[as];
  const phone = as === "new" ? `${persona.phone}${ticket.id.slice(-3)}` : persona.phone;

  return (
    <div className="app-chat">
      {!config().ANTHROPIC_API_KEY && <p className="notice small">The bot needs ANTHROPIC_API_KEY in .env.local to reply.</p>}
      <Chat
        ticket={ticket} phone={phone} title="Truecolors" subtitle={as === "new" ? "Wholesale · usually replies at once" : `Wholesale · ${persona.label}`}
        empty="Ask about prices, orders, displays or a design for your location."
      />
      <div className="app-tries" aria-label="Try saying">
        {persona.tries.map((t) => (
          <form key={t} action={simSendAction}>
            <input type="hidden" name="ticket" value={ticket.id} />
            <input type="hidden" name="phone" value={phone} />
            <input type="hidden" name="text" value={t} />
            <button className="secondary sim-try">{t}</button>
          </form>
        ))}
      </div>
    </div>
  );
}
