import { db } from "../src/lib/db/client";

// Opening the database runs any pending migrations.
db().then(() => {
  console.log("Database is up to date.");
  process.exit(0);
});
