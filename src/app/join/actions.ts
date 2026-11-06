"use server";

import { redirect } from "next/navigation";
import { PRESETS } from "@/lib/ai/presets";
import { currentUser } from "@/lib/auth/session";
import { savePendingSketch } from "@/lib/design/pending-sketch";
import { UserError } from "@/lib/design/service";

export type IdeaState = { error?: string } | undefined;

// The Create page's idea box: the idea, a style and (optionally) a sketch. Signed-in designers go straight to a new
// design with all three filled in; everyone else to the sign-up card with them kept (the sketch in a cookie).
export async function startIdeaAction(_: IdeaState, f: FormData): Promise<IdeaState> {
  const idea = String(f.get("idea") ?? "").trim().slice(0, 600);
  const style = String(f.get("style") ?? "");
  const file = f.get("sketch");
  const hasSketch = file instanceof File && file.size > 0;
  if (!idea && !hasSketch) return { error: "Describe your idea, or add a sketch." };
  try {
    if (hasSketch) await savePendingSketch(file);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  const q = new URLSearchParams();
  if (idea) q.set("idea", idea);
  if (PRESETS.some((p) => p.id === style)) q.set("style", style);
  redirect((await currentUser()) ? `/studio/new?${q}` : `/join?${q}#start`);
}
