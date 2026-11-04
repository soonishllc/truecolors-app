"use client";

import { useFormStatus } from "react-dom";

// Shows that the bot is replying while the message is being answered.
export function SendButton() {
  const { pending } = useFormStatus();
  return <button disabled={pending}>{pending ? "Bot is typing…" : "Send"}</button>;
}
