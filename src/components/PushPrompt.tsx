"use client";

import { useEffect, useState } from "react";

type Native = { postMessage(message: string): void };

// In the phone app only: turning on notifications for backers, milestones and the result. The app asks the phone
// for permission and registers itself with `ticket` (lib/push.ts). The page usually sits in the store's frame, so
// the request goes up to the store page, which hands it to the app (lib/proxy/shell.ts).
export function PushPrompt({ ticket, store }: { ticket: string; store: string }) {
  const [inApp, setInApp] = useState(false);
  const [asked, setAsked] = useState(false);
  useEffect(() => setInApp(/TruecolorsApp/.test(navigator.userAgent)), []);
  if (!inApp) return null;
  const ask = () => {
    const msg = { type: "push-enable", ticket };
    const rn = (window as unknown as { ReactNativeWebView?: Native }).ReactNativeWebView;
    if (rn && window.self === window.top) rn.postMessage(JSON.stringify(msg));
    else window.parent.postMessage({ type: "tc-frame", native: msg }, store);
    setAsked(true);
  };
  return (
    <div className="notice push-prompt" role="region" aria-label="Notifications">
      {asked ? (
        <span>Done. You&apos;ll hear the moment someone backs your designs.</span>
      ) : (
        <>
          <span><b>Know the moment someone backs you.</b> Get a notification for each backer, daily tallies and the result.</span>
          <button type="button" className="button small" onClick={ask}>Turn on notifications</button>
        </>
      )}
    </div>
  );
}
