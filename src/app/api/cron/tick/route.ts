import { tick } from "@/lib/campaigns/service";
import { config } from "@/lib/config";

// Call every 15 minutes with: Authorization: Bearer <CRON_SECRET>
export async function POST(req: Request) {
  if (req.headers.get("authorization") !== `Bearer ${config().CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json({ log: await tick() });
}
