import { eq, ilike } from "drizzle-orm";
import { db } from "../src/lib/db/client";
import { outlets } from "../src/lib/db/schema";
import { settleOutlet } from "../src/lib/wholesale/consignment";

// For testing: ends an outlet's current settlement period now, instead of waiting 15 days, and runs what the
// cron would run: a settlement if sales were reported or counted, otherwise a reminder.
//   npm run wholesale:end-period -- "Test Lobby Shop"

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Give the outlet\'s name: npm run wholesale:end-period -- "Test Lobby Shop"');
  const d = await db();
  const [o] = await d.select().from(outlets).where(ilike(outlets.name, name));
  if (!o) throw new Error(`No outlet called ${name}`);
  const now = new Date();
  await d
    .update(outlets)
    .set({ periodStart: new Date(now.getTime() - o.settlementDays * 86_400_000 - 60_000) })
    .where(eq(outlets.id, o.id));
  const log: string[] = [];
  await settleOutlet(o.id, now, log);
  console.log(log.length ? log.join("\n") : "Period ended; nothing else to do.");
}

main().then(() => process.exit(0), (e) => { console.error(e.message ?? e); process.exit(1); });
