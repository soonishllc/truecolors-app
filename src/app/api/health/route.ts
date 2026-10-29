import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

// For the host's health check: up only once the database answers.
export async function GET() {
  await (await db()).execute(sql`select 1`);
  return Response.json({ ok: true });
}
