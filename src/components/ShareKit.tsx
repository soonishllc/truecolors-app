"use client";

import { useState } from "react";
import { withUtm } from "@/lib/share";

// Everything a designer needs to push a campaign: their own link (which pays them 15%), one-tap posts, and the
// reveal video and image to upload to Instagram or TikTok, which don't take links from other sites.
export function ShareKit({ url, text, video, image }: { url: string; text: string; video?: string; image?: string }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const copy = async () => {
    await navigator.clipboard.writeText(withUtm(url, "copy"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const nativeShare = () => navigator.share?.({ title: text, text, url: withUtm(url, "native") }).catch(() => {});

  return (
    <div className="share-kit">
      <div className="share-link">
        <code>{url.replace(/^https?:\/\//, "")}</code>
        <button type="button" className="small" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
      </div>
      <div className="share-buttons">
        <a className="chip" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${enc(text)}&url=${enc(withUtm(url, "x"))}`}>Post on X</a>
        <a className="chip" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${enc(`${text} ${withUtm(url, "whatsapp")}`)}`}>WhatsApp</a>
        <a className="chip" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${enc(withUtm(url, "facebook"))}`}>Facebook</a>
        <button type="button" className="chip mobile-only" onClick={nativeShare}>Share…</button>
        {video && <a className="chip" href={video} download>↓ Reveal video</a>}
        {image && <a className="chip" href={image} download>↓ Post image</a>}
      </div>
    </div>
  );
}
