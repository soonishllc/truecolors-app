"use client";

import { useState } from "react";

// Everything a designer needs to push a campaign: their own link (which pays them 15%), one-tap posts, and the
// reveal video and image to upload to Instagram or TikTok, which don't take links from other sites.
export function ShareKit({ url, text, video, image }: { url: string; text: string; video?: string; image?: string }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  const nativeShare = () => navigator.share?.({ title: text, text, url }).catch(() => {});

  return (
    <div className="share-kit">
      <div className="share-link">
        <code>{url.replace(/^https?:\/\//, "")}</code>
        <button type="button" className="small" onClick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
      </div>
      <div className="share-buttons">
        <a className="chip" target="_blank" rel="noreferrer" href={`https://x.com/intent/post?text=${enc(text)}&url=${enc(url)}`}>Post on X</a>
        <a className="chip" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${enc(`${text} ${url}`)}`}>WhatsApp</a>
        <a className="chip" target="_blank" rel="noreferrer" href={`https://www.facebook.com/sharer/sharer.php?u=${enc(url)}`}>Facebook</a>
        <button type="button" className="chip mobile-only" onClick={nativeShare}>Share…</button>
        {video && <a className="chip" href={video} download>↓ Reveal video</a>}
        {image && <a className="chip" href={image} download>↓ Post image</a>}
      </div>
    </div>
  );
}
