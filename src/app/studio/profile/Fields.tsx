"use client";

import { useState } from "react";

// The bio box with a live count, so the 280 limit is never a surprise on save.
export function BioField({ defaultValue, max }: { defaultValue: string; max: number }) {
  const [n, setN] = useState([...defaultValue].length);
  return (
    <label>
      Bio
      <textarea name="bio" rows={4} defaultValue={defaultValue} maxLength={max} placeholder="What you draw, where you draw it, what the sun brings out."
        onChange={(e) => setN([...e.target.value].length)} aria-describedby="bio-count" />
      <span id="bio-count" className={`dz-count${n > max - 20 ? " near" : ""}`} aria-live="polite">{n} / {max}</span>
    </label>
  );
}

// The photo picker shows the new photo before it's saved. Only JPG, PNG and WebP: iPhones then send HEIC as JPEG.
export function AvatarField({ current, initial }: { current?: string; initial: string }) {
  const [preview, setPreview] = useState<string | undefined>(current);
  return (
    <div className="dz-avatar-field">
      {preview
        ? <img className="dz-avatar dz-avatar-lg" src={preview} alt="" />
        : <span className="dz-avatar dz-avatar-lg dz-avatar-initial" aria-hidden="true">{initial}</span>}
      <div className="stack">
        <label>
          Photo
          <input type="file" name="avatar" accept="image/jpeg,image/png,image/webp"
            onChange={(e) => { const f = e.target.files?.[0]; setPreview(f ? URL.createObjectURL(f) : current); }} />
        </label>
        <span className="small muted">A square crop of you or your work. JPG, PNG or WebP, under 10 MB.</span>
        {current && <label className="check small"><input type="checkbox" name="removeAvatar" /> Remove my photo</label>}
      </div>
    </div>
  );
}
