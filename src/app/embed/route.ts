import { config } from "@/lib/config";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { IN_STORE_COOKIE, safePath } from "@/lib/links";
import { MARKET_COOKIE } from "@/lib/markets";
import { takeHandoff } from "@/lib/proxy/handoff";

// The first page of the app inside a store page: signs in as the store's customer (or out, for a guest), then
// shows the page the store asked for, in the store's market.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const ok = await takeHandoff(q.get("t"));
  const to = new URL(safePath(q.get("next"), "/explore"), config().APP_URL);
  const jar = await cookies();
  // Remembered for the rest of the visit: pages opened from here are in the store, in the store's market.
  jar.set(IN_STORE_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure: to.protocol === "https:", path: "/" });
  const market = q.get("market") === "US" ? "US" : q.get("market") === "AE" ? "AE" : undefined;
  if (market) jar.set(MARKET_COOKIE, market, { httpOnly: true, sameSite: "lax", secure: to.protocol === "https:", path: "/" });
  const hash = q.get("hash");
  if (hash) to.hash = hash;
  if (!ok) to.searchParams.set("signin", "expired");
  return NextResponse.redirect(to, 303);
}
