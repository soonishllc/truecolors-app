import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ActionForm";
import { requireUser } from "@/lib/auth/session";
import { thumbUrl } from "@/lib/storage";
import { deleteAccountAction, saveProfileAction } from "./actions";
import { deletionBlockers } from "@/lib/auth/delete-account";
import { CONTACT } from "@/lib/brand";
import { AvatarField, BioField } from "./Fields";
import { BIO_MAX, LOCATION_MAX, NAME_MAX } from "./profile";
import "@/app/designers/designers.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your profile · Truecolors" };

// What fans see on your page and next to every design you launch.
export default async function ProfilePage() {
  const user = await requireUser();
  const blockers = await deletionBlockers(user.id);
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

      {/* Deleting the account: what goes, what stays, and anything that has to be settled first. */}
      <section className="card stack dz-delete" aria-labelledby="delete-h">
        <h2 id="delete-h">Delete your account</h2>
        <p className="muted small">
          Your name, email, profile, sign-in accounts, payout details and unlaunched drafts are deleted, and you&apos;re signed out
          everywhere. Designs that launched stay on sale under &ldquo;Former designer&rdquo;, and we keep the earnings records the law
          requires. This can&apos;t be undone.
        </p>
        {blockers.length ? (
          <>
            {blockers.map((b) => <p key={b} className="notice small">{b}</p>)}
            <p className="small muted">Questions? Email <a href={`mailto:${CONTACT.email}?subject=${encodeURIComponent("Delete my account")}`}>{CONTACT.email}</a>.</p>
          </>
        ) : (
          <ActionForm action={deleteAccountAction} submit="Delete my account" pendingText="Deleting…" className="stack">
            <label>
              Type DELETE to confirm
              <input name="confirm" required autoComplete="off" autoCapitalize="characters" spellCheck={false} />
            </label>
          </ActionForm>
        )}
      </section>
    </div>
  );
}
