import type { Metadata } from "next";
import { Assistant, JetBrains_Mono, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import { Suspense } from "react";
import { AppNav } from "@/components/AppNav";
import { FrameBridge } from "@/components/FrameBridge";
import { Wordmark } from "@/components/Wordmark";
import { BRAND, COMPANY, CONTACT } from "@/lib/brand";
import { config } from "@/lib/config";
import { storeOrigins } from "@/lib/links";
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
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        {/* Inside the store (framed by a store page) or the mobile app, the store's own header, menu and footer replace the site's. */}
        <script dangerouslySetInnerHTML={{ __html: "if(self!==top||/TruecolorsApp/.test(navigator.userAgent))document.documentElement.classList.add('in-app')" }} />
      </head>
      <body>
        <Suspense><FrameBridge stores={storeOrigins()} /></Suspense>
        <header className="top">
          <Link href="/" className="brand" aria-label={BRAND}><Wordmark /></Link>
          <nav>
            <Link href="/explore">Explore</Link>
            <Link href="/challenges" className="wide-only">Challenges</Link>
            <Link href="/me">{user ? "Orders" : "My orders"}</Link>
            {user ? (
              <>
                <Link href="/studio">Studio</Link>
                {user.isAdmin && <Link href="/admin">Admin</Link>}
                <form action="/logout" method="post"><button className="link">Log out</button></form>
              </>
            ) : (
              <>
                <Link href="/login">Log in</Link>
                <Link href="/join" className="button small wide-only">Design your own</Link>
              </>
            )}
          </nav>
        </header>
        <main>
          <AppNav designer={Boolean(user)} />
          {children}
        </main>
        <footer className="foot">
          <div className="foot-grid">
            <div className="foot-brand">
              <Wordmark />
              <p>Shirts designed by our community that look grey in the shade and show their true colours in sunlight.</p>
            </div>
            <nav aria-label="Designs">
              <h3>Designs</h3>
              <Link href="/explore">Explore</Link>
              <Link href="/challenges">Challenges</Link>
              <Link href="/me">My pre-orders</Link>
              <a href={config().STORE_URL}>Shop the store</a>
            </nav>
            <nav aria-label="Designers">
              <h3>Designers</h3>
              <Link href="/join">Design your own</Link>
              <Link href="/login">Log in</Link>
              <Link href="/designer-agreement">Designer agreement</Link>
            </nav>
            <nav aria-label="Help">
              <h3>Help</h3>
              <Link href="/pre-orders">Pre-orders, shipping and returns</Link>
              <Link href="/terms">Terms of use</Link>
              <Link href="/privacy">Privacy policy</Link>
            </nav>
            <nav aria-label="Contact">
              <h3>Contact</h3>
              <a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a>
              <a href={CONTACT.whatsapp.href}>WhatsApp {CONTACT.whatsapp.label}</a>
              <a href={CONTACT.instagram.href}>Instagram · {CONTACT.instagram.label}</a>
              <a href={CONTACT.tiktok.href}>TikTok · {CONTACT.tiktok.label}</a>
            </nav>
          </div>
          <div className="foot-legal">
            <span>© {new Date().getFullYear()} {COMPANY.name}. All rights reserved.</span>
            <span>{COMPANY.trademark}</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
