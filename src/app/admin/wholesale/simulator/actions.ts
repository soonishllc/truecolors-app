"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { config } from "@/lib/config";
import { answerDemoTicket, sendAsAgent, sendAsCustomer, startDemoTicket } from "@/lib/wholesale/demo";

// The simulator's buttons. Demo only: each refuses outside WHOLESALE_DEMO.

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function demoOnly() {
  if (!config().WHOLESALE_DEMO) throw new Error("The simulator only runs in the local demo");
}

export async function simSendAction(f: FormData) {
  demoOnly();
  const ticket = text(f, "ticket");
  const body = text(f, "text");
  const image = text(f, "image");
  if (!ticket || (!body && !image)) return;
  await sendAsCustomer(ticket, text(f, "phone"), body, image || undefined);
  await answerDemoTicket(ticket);
  revalidatePath("/admin/wholesale/simulator");
  revalidatePath("/app/chat");
}

export async function simAgentAction(f: FormData) {
  demoOnly();
  const ticket = text(f, "ticket");
  if (!ticket || !text(f, "text")) return;
  await sendAsAgent(ticket, text(f, "text"));
  await answerDemoTicket(ticket);
  revalidatePath("/admin/wholesale/simulator");
  revalidatePath("/app/chat");
}

export async function simNewChatAction(f: FormData) {
  demoOnly();
  redirect(`/admin/wholesale/simulator?as=${text(f, "as")}&t=${startDemoTicket()}`);
}
