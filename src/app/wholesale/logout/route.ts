import { config } from "@/lib/config";
import { NextResponse } from "next/server";
import { signOutOfPortal } from "@/lib/wholesale/portal-auth";

export async function POST(req: Request) {
  await signOutOfPortal();
  return NextResponse.redirect(new URL("/wholesale", config().APP_URL), 303);
}
