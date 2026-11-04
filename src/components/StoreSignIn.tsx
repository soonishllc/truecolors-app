import { config } from "@/lib/config";

// Inside the store, everyone signs in with their truecolors.global account; this sends the whole window to the
// store's sign-in and back to `back` (a path inside the store's app pages) afterwards. Shown only in the store.
export function StoreSignIn({ back, children }: { back: string; children?: React.ReactNode }) {
  const { STORE_URL, PROXY_PATH } = config();
  const url = `${STORE_URL.replace(/\/$/, "")}/account/login?return_url=${encodeURIComponent(PROXY_PATH + back)}`;
  return (
    <div className="store-only stack">
      {children}
      <a className="button" href={url} target="_parent">Sign in with your Truecolors account</a>
    </div>
  );
}
