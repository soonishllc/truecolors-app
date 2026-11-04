import { NextResponse } from "next/server";
import { signOutOfPortal } from "@/lib/wholesale/portal-auth";

export async function POST(req: Request) {
  await signOutOfPortal();
  return NextResponse.redirect(new URL("/wholesale", req.url), 303);
}
