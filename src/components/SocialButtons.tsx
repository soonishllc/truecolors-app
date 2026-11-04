import { config } from "@/lib/config";
import { enabledProviders, providerLabel, type Provider } from "@/lib/auth/oauth";

const ICONS: Record<Provider, React.ReactNode> = {
  google: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h6a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-2 3.2-4.8 3.2-8.1z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.4-2.7l-3.6-2.8c-1 .7-2.3 1.1-3.8 1.1-2.9 0-5.4-2-6.3-4.6H2v2.9A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.7 14a6.6 6.6 0 0 1 0-4.2V7H2a11 11 0 0 0 0 9.9l3.7-2.9z" />
      <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2 7l3.7 2.9C6.6 7.3 9.1 5.4 12 5.4z" />
    </svg>
  ),
  apple: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M16.4 12.6c0-2.5 2-3.7 2.1-3.8a4.6 4.6 0 0 0-3.6-2c-1.5-.2-3 .9-3.7.9-.8 0-2-.9-3.2-.8a4.8 4.8 0 0 0-4.1 2.5c-1.8 3.1-.5 7.6 1.2 10.1.8 1.2 1.8 2.6 3.1 2.5 1.2 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4a10 10 0 0 0 1.4-2.8 4.3 4.3 0 0 1-2.6-4.2zM14 5.2A4.3 4.3 0 0 0 15 2a4.4 4.4 0 0 0-2.9 1.5 4.1 4.1 0 0 0-1 3.1c1.1 0 2.2-.6 2.9-1.4z" />
    </svg>
  ),
  x: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M17.8 2.5h3.1l-6.7 7.7 7.9 10.4h-6.2l-4.8-6.3-5.5 6.3H2.5l7.2-8.2L2.1 2.5h6.3l4.4 5.8 5-5.8zm-1.1 16.3h1.7L7.4 4.2H5.6l11.1 14.6z" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id="ig" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#feda75" /><stop offset=".35" stopColor="#fa7e1e" />
          <stop offset=".65" stopColor="#d62976" /><stop offset="1" stopColor="#4f5bd5" />
        </linearGradient>
      </defs>
      <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" fill="none" stroke="url(#ig)" strokeWidth="2.2" />
      <circle cx="12" cy="12" r="4.3" fill="none" stroke="url(#ig)" strokeWidth="2.2" />
      <circle cx="17.4" cy="6.6" r="1.3" fill="#d62976" />
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#25F4EE" d="M9.4 9.7v-1A7 7 0 0 0 2.6 15a7 7 0 0 0 9.2 6.2 7 7 0 0 1-2.4-11.5z" opacity=".9" />
      <path fill="#FE2C55" d="M16.6 2.5h-3.2v13.2a2.9 2.9 0 1 1-2-2.8V9.6a6.2 6.2 0 1 0 5.2 6.1V9a8 8 0 0 0 4.7 1.5V7.3a4.7 4.7 0 0 1-4.7-4.8z" opacity=".9" />
      <path fill="currentColor" d="M15.8 2h-3.2v13.2a2.9 2.9 0 1 1-2-2.8V9.1a6.2 6.2 0 1 0 5.2 6.1V8.5a8 8 0 0 0 4.7 1.5V6.8A4.7 4.7 0 0 1 15.8 2z" />
    </svg>
  ),
};

export const ProviderIcon = ({ provider }: { provider: Provider }) => <span className="provider-icon">{ICONS[provider]}</span>;

// One button per provider whose keys are set. In development the rest show greyed out, so the layout can be seen.
export function SocialButtons({ verb }: { verb: string }) {
  const on = enabledProviders();
  const all: Provider[] = ["google", "apple", "instagram", "tiktok", "x"];
  const shown = config().DEV_SHOW_LOGIN_LINKS ? all : on;
  if (!shown.length) return null;
  return (
    <div className="social">
      {shown.map((p) =>
        on.includes(p) ? (
          // The whole window: sign-in providers refuse to be shown inside the store's frame.
          <a key={p} className="social-button" href={`/auth/${p}`} target="_parent">
            <ProviderIcon provider={p} />{verb} with {providerLabel(p)}
          </a>
        ) : (
          <span key={p} className="social-button off" title="Add this provider's keys to .env.local to switch it on">
            <ProviderIcon provider={p} />{verb} with {providerLabel(p)}
          </span>
        ),
      )}
    </div>
  );
}
