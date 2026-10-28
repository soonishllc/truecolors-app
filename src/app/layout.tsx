import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Truecolors Design Studio",
  description: "Design a colour-changing shirt, pre-sell it, and earn on every sale.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand">Truecolors <span>Studio</span></Link>
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
      </body>
    </html>
  );
}
