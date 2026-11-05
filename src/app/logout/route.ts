import { config } from "@/lib/config";
import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth/session";

export async function POST(req: Request) {
  await signOut();
  return NextResponse.redirect(new URL("/", config().APP_URL), 303);
}
