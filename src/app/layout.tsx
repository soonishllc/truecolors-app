import type { Metadata } from "next";
import { Assistant, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { Wordmark } from "@/components/Wordmark";
import { BRAND } from "@/lib/brand";
import { config } from "@/lib/config";
import "./globals.css";

// The same three typefaces as the truecolors.global theme.
const display = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-space-grotesk" });
const body = Assistant({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-assistant" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "700"], variable: "--font-jetbrains-mono" });

export const metadata: Metadata = {
  title: BRAND,
  description: "Design a colour-changing shirt, pre-sell it, and earn on every sale.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <header className="top">
          <Link href="/" className="brand" aria-label={BRAND}><Wordmark /></Link>
          <nav>
            {user ? (
              <>
                <Link href="/studio">Studio</Link>
                {user.isAdmin && <Link href="/admin">Admin</Link>}
                <form action="/logout" method="post"><button className="link">Log out</button></form>
              </>
            ) : (
              <>
                <Link href="/login">Log in</Link>
                <Link href="/join" className="button small">Join with invite</Link>
              </>
            )}
          </nav>
        </header>
        <main>{children}</main>
        <footer className="foot">
          <span><Wordmark /> · colour-shifting shirts, designed by our community</span>
          <a href={config().SHOPIFY_STOREFRONT_URL}>Shop the store →</a>
        </footer>
      </body>
    </html>
  );
}
