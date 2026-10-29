import { NextResponse } from "next/server";
import { verifyFan } from "@/lib/fans";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = await verifyFan(url.searchParams.get("token") ?? "");
  return NextResponse.redirect(new URL(next ? `${next}${next.includes("?") ? "&" : "?"}confirmed=1` : "/?expired=1", url));
}
