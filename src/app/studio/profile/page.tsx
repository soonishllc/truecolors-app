import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth/session";
import { thumbUrl } from "@/lib/storage";
import { saveProfileAction } from "./actions";
import { AvatarField, BioField } from "./Fields";
import { BIO_MAX, LOCATION_MAX, NAME_MAX } from "./profile";
import "@/app/designers/designers.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your profile · Truecolors" };

// What fans see on your page and next to every design you launch.
export default async function ProfilePage() {
  const user = await requireUser();
  return (
    <div className="dz-page dz-profile-edit">
      <div className="eyebrow"><Link href="/studio">Studio</Link> / Profile</div>
      <h1>Your profile</h1>
      <p className="muted">Fans see this on <Link href={`/d/${user.handle}`}>your page</Link>, in the designers list and next to every design you launch.</p>
      <ActionForm action={saveProfileAction} submit="Save profile" pendingText="Saving…" className="stack card">
        <AvatarField current={user.avatarKey ? thumbUrl(user.avatarKey, 320) : undefined} initial={[...user.name.trim()][0]?.toUpperCase() ?? "?"} />
        <label>
          Display name
          <input name="name" required maxLength={NAME_MAX} defaultValue={user.name} autoComplete="name" />
        </label>
        <BioField defaultValue={user.bio ?? ""} max={BIO_MAX} />
        <label>
          Location
          <input name="location" maxLength={LOCATION_MAX} defaultValue={user.location ?? ""} placeholder="Dubai" autoComplete="address-level2" />
        </label>
        <label>
          Instagram
          <input name="instagram" defaultValue={user.instagram ? `@${user.instagram}` : ""} placeholder="@yourhandle" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </label>
      </ActionForm>
    </div>
  );
}
