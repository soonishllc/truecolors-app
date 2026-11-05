import path from "node:path";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { config } from "../config";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;

const MIGRATIONS = path.join(process.cwd(), "drizzle");

// One database for the whole server process. Kept on globalThis because the dev server loads this module once per
// bundle (pages, server actions, route handlers): a module-level variable would open the PGlite folder several
// times at once, and two PGlite instances writing one folder corrupt it.
const g = globalThis as unknown as { __tcDb?: Promise<DB> };

// Postgres when DATABASE_URL is set, otherwise an embedded PGlite database on disk.
export function db(): Promise<DB> {
  // A failed open isn't kept, so the next request tries again.
  g.__tcDb ??= open(config().DATABASE_URL).catch((e) => {
    g.__tcDb = undefined;
    throw e;
  });
  return g.__tcDb;
}

export function useDb(next: Promise<DB>) {
  g.__tcDb = next;
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
