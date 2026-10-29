import { eq } from "drizzle-orm";
import { config } from "./config";
import { db } from "./db/client";
import { emails } from "./db/schema";

// Sends through Resend when RESEND_API_KEY is set, otherwise only logs. Every email is kept in the emails
// table, and a key makes sending idempotent: the same key is only ever sent once.
export async function sendEmail(input: { to: string; subject: string; body: string; key?: string }): Promise<boolean> {
  const { RESEND_API_KEY, EMAIL_FROM, APP_URL } = config();
  const d = await db();
  const body = `${input.body}\n\n—\nTruecolors Design · ${APP_URL.replace(/^https?:\/\//, "")}`;
  const [row] = await d
    .insert(emails)
    .values({ key: input.key, to: input.to, subject: input.subject, body, provider: RESEND_API_KEY ? "resend" : "log" })
    .onConflictDoNothing()
    .returning();
  if (!row) return false;
  if (!RESEND_API_KEY) {
    console.log(`[email] to ${input.to}: ${input.subject}`);
    return true;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: input.to, subject: input.subject, text: body }),
    });
    if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
  } catch (e) {
    await d.update(emails).set({ error: (e as Error).message }).where(eq(emails.id, row.id));
    console.error(`[email] failed to ${input.to}:`, (e as Error).message);
  }
  return true;
}
