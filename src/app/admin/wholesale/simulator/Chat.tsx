import type { demoTicket } from "@/lib/wholesale/demo";
import { SendButton } from "./SendButton";
import { simSendAction } from "./actions";

type Ticket = NonNullable<ReturnType<typeof demoTicket>>;

// The WhatsApp-style chat window, shared by the simulator and the app preview's Chat tab.
export function Chat({ ticket, phone, title, subtitle, empty }: { ticket: Ticket; phone: string; title: string; subtitle: string; empty: string }) {
  return (
    <section className="sim-phone" aria-label="Chat">
      <header className="sim-head">
        <strong>{title}</strong>
        <span className="small">{subtitle}</span>
      </header>
      <div className="sim-chat">
        {ticket.messages.length === 0 && <p className="sim-note">{empty}</p>}
        {ticket.messages.map((m, i) => (
          <div key={m.id} className="sim-row">
            {ticket.activity.filter((a) => a.after === i).map((a, j) => (
              <p key={j} className="sim-tool">bot used: {a.tools.join(", ")}</p>
            ))}
            <div className={`bubble ${!m.fromAgent ? "me" : m.via === "api" ? "bot" : "team"}`}>
              {m.fromAgent && m.via !== "api" && <span className="bubble-who">Team</span>}
              {m.images.map((src) => <img key={src} src={src} alt="Photo sent" />)}
              {m.body}
            </div>
          </div>
        ))}
        {ticket.activity.filter((a) => a.after === ticket.messages.length).map((a, j) => (
          <p key={`end-${j}`} className="sim-tool">bot used: {a.tools.join(", ")}</p>
        ))}
        {ticket.notes.map((n) => <p key={n} className="sim-note">{n}</p>)}
        {ticket.tags.length > 0 && <p className="sim-note">Gorgias tags: {ticket.tags.join(", ")}</p>}
      </div>
      <form action={simSendAction} className="sim-input">
        <input type="hidden" name="ticket" value={ticket.id} />
        <input type="hidden" name="phone" value={phone} />
        <input name="text" placeholder="Message" autoComplete="off" aria-label="Message" />
        <SendButton />
        <details className="sim-photo">
          <summary className="small">Attach a photo</summary>
          <input name="image" type="url" placeholder="https://… link to an image, e.g. a till report" aria-label="Photo link" />
        </details>
      </form>
    </section>
  );
}
