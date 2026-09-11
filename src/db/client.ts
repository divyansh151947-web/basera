import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import path from "path";

// Singleton pattern to avoid exhausting SQLite connections during Next.js
// hot-reload in dev. In production with Postgres, replace this file with a
// pooled `postgres-js` or `pg` client and keep the same `db` export shape.
const globalForDb = globalThis as unknown as { sqlite?: Database.Database };

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "dev.db");

const sqlite = globalForDb.sqlite ?? new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

if (process.env.NODE_ENV !== "production") globalForDb.sqlite = sqlite;

export const db = drizzle(sqlite, { schema });
export { sqlite };
