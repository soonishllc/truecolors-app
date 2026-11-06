import { eq } from "drizzle-orm";
import sharp from "sharp";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { UserError } from "@/lib/design/service";
import { put } from "@/lib/storage";

// A designer's public profile: what shows on /d/[handle], the designers directory and every DesignerChip.

export const BIO_MAX = 280;
export const NAME_MAX = 60;
export const LOCATION_MAX = 60;
export const AVATAR_SIZE = 400;
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;
// iPhones hand HEIC photos to a form as JPEG when the input accepts only these, so HEIC arrives as JPEG.
const AVATAR_FORMATS = new Set(["jpeg", "png", "webp"]);

export type ProfileInput = { name: string; bio: string; location: string; instagram: string };
export type Profile = { name: string; bio: string | null; location: string | null; instagram: string | null };

// "@maya.draws", "maya.draws" or "https://www.instagram.com/maya.draws/?hl=en" all become "maya.draws".
// Empty means no Instagram. Anything else that isn't a valid handle is an error, not silently dropped.
export function normalizeInstagram(input: string): string | null {
  let v = input.trim();
  if (!v) return null;
  const url = v.match(/^(?:https?:\/\/)?(?:www\.)?(?:instagram\.com|instagr\.am)\/([^/?#]+)/i);
  if (url) v = url[1];
  v = v.replace(/^@/, "").toLowerCase();
  if (!/^[a-z0-9._]{1,30}$/.test(v) || v.startsWith(".") || v.endsWith(".") || v.includes("..")) {
    throw new UserError("That Instagram handle doesn't look right. Use letters, numbers, dots and underscores, like @maya.draws.");
  }
  return v;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

export function validateProfile(input: ProfileInput): Profile {
  const name = oneLine(input.name);
  if (!name) throw new UserError("Add the name people will see on your designs.");
  if ([...name].length > NAME_MAX) throw new UserError(`Keep your name to ${NAME_MAX} characters.`);
  // Paragraph breaks are kept; runs of blank lines are not.
  const bio = input.bio.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if ([...bio].length > BIO_MAX) throw new UserError(`Keep your bio to ${BIO_MAX} characters (it's ${[...bio].length} now).`);
  const location = oneLine(input.location);
  if ([...location].length > LOCATION_MAX) throw new UserError(`Keep the location short, like "Dubai" or "Cancún, Mexico".`);
  return { name, bio: bio || null, location: location || null, instagram: normalizeInstagram(input.instagram) };
}

// A square 400x400 WebP, cropped to the middle and turned upright.
export async function readAvatar(upload: Buffer): Promise<Buffer> {
  if (upload.length > AVATAR_MAX_BYTES) throw new UserError("That photo is too big. Pick one under 10 MB.");
  const bad = () => new UserError("That photo couldn't be opened. Upload a JPG, PNG or WebP image.");
  let format: string | undefined;
  try {
    // A small file can still unpack to a huge image; 40 megapixels is far more than any phone photo.
    format = (await sharp(upload, { limitInputPixels: 40_000_000 }).metadata()).format;
  } catch {
    throw bad();
  }
  if (!format || !AVATAR_FORMATS.has(format)) throw bad();
  try {
    return await sharp(upload, { limitInputPixels: 40_000_000 }).rotate()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 82 }).toBuffer();
  } catch {
    throw bad();
  }
}

export async function saveProfile(userId: string, input: ProfileInput, avatar?: Buffer) {
  const profile = validateProfile(input);
  const avatarKey = avatar ? await put("avatars", "webp", await readAvatar(avatar)) : undefined;
  const d = await db();
  const [user] = await d
    .update(users)
    .set({ ...profile, ...(avatarKey && { avatarKey }) })
    .where(eq(users.id, userId))
    .returning();
  return user;
}

export async function removeAvatar(userId: string) {
  const d = await db();
  await d.update(users).set({ avatarKey: null }).where(eq(users.id, userId));
}
