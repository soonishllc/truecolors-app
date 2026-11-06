import { cookies } from "next/headers";
import sharp from "sharp";
import { seal, unseal } from "../auth/session";
import { config } from "../config";
import { fileUrl, get, put } from "../storage";
import { UserError } from "./service";

// A sketch added on the Create page before signing up. It's kept in storage under a random name and remembered for
// two hours in a sealed cookie, so it survives sign-up and is waiting in the Studio's new-design form. The drawing
// itself is cleaned up when the design is made (readSketch), as for any upload.

const COOKIE = "tc_pending_sketch";
const HOURS = 2;
const MAX_BYTES = 12 * 1024 * 1024;

export async function savePendingSketch(file: File): Promise<void> {
  if (file.size > MAX_BYTES) throw new UserError("That photo is over 12 MB. Try a smaller one, or a screenshot of it.");
  let jpeg: Buffer;
  try {
    // Upright and at most 3000px, so what's kept is a reasonable size; a small file can still unpack huge.
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 40_000_000 })
      .rotate().resize(3000, 3000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch {
    throw new UserError("That sketch couldn't be opened. Upload a JPG or PNG photo of it.");
  }
  const key = await put("pending", "jpg", jpeg);
  (await cookies()).set(COOKIE, seal({ key }, HOURS * 60), { httpOnly: true, sameSite: "lax", secure: config().APP_URL.startsWith("https:"), path: "/", maxAge: HOURS * 3600 });
}

// The sketch's storage key, if one is waiting.
export async function pendingSketchKey(): Promise<string | undefined> {
  const v = unseal<{ key: string }>((await cookies()).get(COOKIE)?.value);
  return v?.key?.startsWith("pending/") ? v.key : undefined;
}

export async function pendingSketchUrl() {
  const key = await pendingSketchKey();
  return key && fileUrl(key);
}

export async function takePendingSketch(): Promise<Buffer | undefined> {
  const key = await pendingSketchKey();
  return key ? get(key).catch(() => undefined) : undefined;
}

export async function clearPendingSketch() {
  (await cookies()).delete(COOKIE);
}
