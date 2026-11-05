import { config } from "@/lib/config";
import { NextResponse } from "next/server";
import { finishPortalSignIn } from "@/lib/wholesale/portal-auth";

export async function GET(req: Request) {
  try {
    return NextResponse.redirect(new URL(await finishPortalSignIn(new URL(req.url).searchParams), config().APP_URL), 303);
  } catch (e) {
    console.error("[wholesale sign in]", e instanceof Error ? e.message : e);
    return NextResponse.redirect(new URL("/wholesale?error=failed", config().APP_URL), 303);
  }
}
