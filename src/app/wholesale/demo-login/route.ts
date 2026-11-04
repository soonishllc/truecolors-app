import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { safePath } from "@/lib/links";
import { signInAsDemo } from "@/lib/wholesale/portal-auth";

// Local demo only: sign in to the portal as the demo stockist or display partner.
export async function GET(req: Request) {
  if (!config().WHOLESALE_DEMO) return new Response("Not found", { status: 404 });
  const q = new URL(req.url).searchParams;
  await signInAsDemo(q.get("as") === "partner" ? "partner@demo.example" : "stockist@demo.example");
  return NextResponse.redirect(new URL(safePath(q.get("next"), "/wholesale"), req.url), 303);
}
