import { config } from "@/lib/config";
import { NextResponse } from "next/server";
import { portalAuthorizeUrl, portalSignInReady } from "@/lib/wholesale/portal-auth";

// Sends the wholesaler to Shopify to sign in with their customer account.
export async function GET(req: Request) {
  if (!portalSignInReady()) return NextResponse.redirect(new URL("/wholesale?error=off", config().APP_URL), 303);
  return NextResponse.redirect(await portalAuthorizeUrl(), 303);
}
