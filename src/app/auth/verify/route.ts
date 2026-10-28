import { NextResponse } from "next/server";
import { verifyLoginToken } from "@/lib/auth/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const ok = await verifyLoginToken(url.searchParams.get("token") ?? "");
  return NextResponse.redirect(new URL(ok ? "/studio" : "/login?expired=1", url));
}
