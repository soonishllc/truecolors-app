"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/app/actions";
import { requireUser } from "@/lib/auth/session";
import { UserError } from "@/lib/design/service";
import { removeAvatar, saveProfile } from "./profile";

const text = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function saveProfileAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  try {
    const file = f.get("avatar");
    const avatar = file instanceof File && file.size ? Buffer.from(await file.arrayBuffer()) : undefined;
    const saved = await saveProfile(user.id, { name: text(f, "name"), bio: text(f, "bio"), location: text(f, "location"), instagram: text(f, "instagram") }, avatar);
    if (f.get("removeAvatar") === "on" && !avatar) await removeAvatar(user.id);
    revalidatePath("/studio/profile");
    revalidatePath(`/d/${saved.handle}`);
    revalidatePath("/designers");
    return { message: "Saved. Your page is up to date." };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
}
