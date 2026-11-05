import { tick } from "@/lib/campaigns/service";
import { timingSafeEqual } from "node:crypto";
import { config } from "@/lib/config";

// Call every 15 minutes with: Authorization: Bearer <CRON_SECRET>
export async function POST(req: Request) {
  if (!sameSecret(req.headers.get("authorization") ?? "", `Bearer ${config().CRON_SECRET}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ log: await tick() });
}

// Compared in constant time, so the secret can't be guessed a character at a time from response timings.
function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
