import { config } from "@/lib/config";
import { NextResponse } from "next/server";
import { currentUser, verifyLoginToken } from "@/lib/auth/session";
import { publicUrl } from "@/lib/links";

// From a login email: designers to their studio in the store; the team to the admin, which isn't in the store.
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!(await verifyLoginToken(url.searchParams.get("token") ?? ""))) return NextResponse.redirect(new URL("/login?expired=1", config().APP_URL));
  const user = await currentUser();
  return NextResponse.redirect(user?.isAdmin ? new URL("/admin", config().APP_URL) : publicUrl("/studio"));
}
