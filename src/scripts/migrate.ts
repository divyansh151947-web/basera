import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { migrate as migrateSqlite } from "drizzle-orm/better-sqlite3/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "path";
import { isPostgresDatabaseUrl } from "../db/dialect";

// Applies pending migrations for whichever dialect DATABASE_URL selects:
// SQLite -> ./drizzle, PostgreSQL -> ./drizzle/pg. Safe to re-run (drizzle
// tracks applied migrations); never deletes or rewrites data.
async function main() {
  if (isPostgresDatabaseUrl()) {
    const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });
    const db = drizzlePg(sql);
    await migratePg(db, { migrationsFolder: "./drizzle/pg" });
    console.log("PostgreSQL migrations applied.");
    await sql.end();
    return;
  }

  const dbPath = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "dev.db");
  const sqlite = new Database(dbPath);
  const db = drizzleSqlite(sqlite);
  migrateSqlite(db, { migrationsFolder: "./drizzle" });
  console.log("Migrations applied to", dbPath);
  sqlite.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
