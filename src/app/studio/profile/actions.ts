"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/app/actions";
import { deleteAccount } from "@/lib/auth/delete-account";
import { requireUser, signOut } from "@/lib/auth/session";
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

// Deleting the account: confirmed by typing DELETE, then signed out everywhere (lib/auth/delete-account.ts).
export async function deleteAccountAction(_: FormState, f: FormData): Promise<FormState> {
  const user = await requireUser();
  if (String(f.get("confirm") ?? "").trim().toUpperCase() !== "DELETE") return { error: "Type DELETE to confirm." };
  try {
    await deleteAccount(user.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  await signOut();
  redirect("/explore?deleted=1");
}
