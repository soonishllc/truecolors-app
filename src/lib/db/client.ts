import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { config } from "../config";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

let current: Promise<DB> | undefined;

// Postgres when DATABASE_URL is set, otherwise an embedded PGlite database on disk.
export function db(): Promise<DB> {
  current ??= open(config().DATABASE_URL);
  return current;
}

export function useDb(next: Promise<DB>) {
  current = next;
}

async function open(url: string | undefined): Promise<DB> {
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const d = drizzle(new Pool({ connectionString: url }), { schema });
    await migrate(d, { migrationsFolder: MIGRATIONS });
    return d;
  }
  return openPglite(path.join(process.cwd(), config().PGLITE_DIR));
}

// dataDir undefined = in memory (tests).
export async function openPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const d = drizzle(new PGlite(dataDir), { schema });
  await migrate(d, { migrationsFolder: MIGRATIONS });
  return d as unknown as DB;
}

export { schema };
