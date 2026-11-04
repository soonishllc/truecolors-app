import { NextResponse } from "next/server";
import { verifyFan } from "@/lib/fans";
import { publicUrl } from "@/lib/links";

// From the confirmation email: back to the page they were on, in the store.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = await verifyFan(url.searchParams.get("token") ?? "");
  return NextResponse.redirect(publicUrl(next ? `${next}${next.includes("?") ? "&" : "?"}confirmed=1` : "/me?expired=1"));
}
