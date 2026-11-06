import Link from "next/link";
import { thumbUrl } from "@/lib/storage";

// A designer's face and name, linking to their page. Purely presentational: pass what the query already has.
// Styles live in src/app/designers/designers.css (imported by the pages that use it; import it too if you use the
// chip elsewhere).

export type DesignerChipProps = {
  handle: string;
  name: string;
  avatarKey?: string | null;
  location?: string | null;
  // A second line, e.g. "3 designs". Shown before the location.
  meta?: string;
  size?: "sm" | "md";
};

export function DesignerAvatar({ name, avatarKey, size = "md" }: { name: string; avatarKey?: string | null; size?: "sm" | "md" | "lg" }) {
  const initial = [...name.trim()][0]?.toUpperCase() ?? "?";
  return avatarKey ? (
    <img className={`dz-avatar dz-avatar-${size}`} src={thumbUrl(avatarKey, 320)} alt="" loading="lazy" decoding="async" />
  ) : (
    <span className={`dz-avatar dz-avatar-${size} dz-avatar-initial`} aria-hidden="true">{initial}</span>
  );
}

export function DesignerChip({ handle, name, avatarKey, location, meta, size = "sm" }: DesignerChipProps) {
  const sub = [meta, location].filter(Boolean).join(" · ");
  return (
    <Link href={`/d/${handle}`} className={`dz-chip dz-chip-${size}`}>
      <DesignerAvatar name={name} avatarKey={avatarKey} size={size} />
      <span className="dz-chip-text">
        <span className="dz-chip-name">{name}</span>
        {sub && <span className="dz-chip-sub">{sub}</span>}
      </span>
    </Link>
  );
}
