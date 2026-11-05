import { config } from "@/lib/config";
import { NextResponse } from "next/server";
import { saveHandshake } from "@/lib/auth/session";
import { authorizeUrl, enabledProviders, isProvider } from "@/lib/auth/oauth";

// Sends the person to Google, Apple, X or Instagram to sign in (or to connect the account when logged in).
export async function GET(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isProvider(provider) || !enabledProviders().includes(provider)) {
    return NextResponse.redirect(new URL("/login", config().APP_URL));
  }
  const { url, handshake } = authorizeUrl(provider);
  await saveHandshake(handshake);
  return NextResponse.redirect(url);
}
