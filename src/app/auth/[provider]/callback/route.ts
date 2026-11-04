import { NextResponse } from "next/server";
import { completeSocialSignIn, takeHandshake } from "@/lib/auth/session";
import { finishAuthorize, isProvider } from "@/lib/auth/oauth";
import { landing } from "@/lib/links";

// Where the provider sends the person back: a GET with the code, or for Apple a POSTed form.
async function handle(req: Request, provider: string, params: URLSearchParams) {
  const handshake = await takeHandshake();
  if (!isProvider(provider) || !handshake) return NextResponse.redirect(new URL("/login?error=expired", req.url), 303);
  try {
    const profile = await finishAuthorize(provider, params, handshake);
    // Providers can't be shown in the store's frame, so this is the whole window: back to the store if they came from it.
    return NextResponse.redirect(new URL(await landing(await completeSocialSignIn(provider, profile)), req.url), 303);
  } catch (e) {
    console.error(`[sign in] ${provider}:`, e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/login?error=failed", req.url), 303);
  }
}

type Ctx = { params: Promise<{ provider: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return handle(req, (await params).provider, new URL(req.url).searchParams);
}

export async function POST(req: Request, { params }: Ctx) {
  return handle(req, (await params).provider, new URLSearchParams(await req.text()));
}
