import { NextResponse } from "next/server";
import { signInAsDemoUser } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { safePath } from "@/lib/links";
import { ensureDemoAccounts } from "@/lib/wholesale/demo";

// Local demo only: sign in to the studio as the demo designer, or as the admin, for the app preview's walkthrough.
export async function GET(req: Request) {
  if (!config().WHOLESALE_DEMO) return new Response("Not found", { status: 404 });
  await ensureDemoAccounts();
  const q = new URL(req.url).searchParams;
  const admin = config().ADMIN_EMAILS.split(",")[0]?.trim().toLowerCase();
  await signInAsDemoUser(q.get("as") === "admin" && admin ? admin : "designer@demo.example");
  return NextResponse.redirect(new URL(safePath(q.get("next"), "/studio"), config().APP_URL), 303);
}
