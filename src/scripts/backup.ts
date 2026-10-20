import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { isPostgresDatabaseUrl } from "../db/dialect";

/**
 * SQLite backup: WAL-checkpoint + timestamped file copy + verification.
 *
 * Usage: npm run db:backup [-- <db-path>]
 *
 * - Source defaults to DATABASE_URL (file:) or ./dev.db.
 * - Refuses PostgreSQL URLs: pg backups need pg_dump (see docs/BACKUP_RECOVERY.md).
 * - Verifies every copy with `PRAGMA integrity_check` and a table-count
 *   comparison before reporting success. Unverified copies are deleted.
 * - Retention: keeps the newest BACKUP_KEEP files (default 14), prunes older.
 * - Prints no secrets and never transmits data anywhere: the copy stays in
 *   ./backups on the same host. Restrict host/directory access accordingly.
 */
function resolveSourcePath(argPath: string | undefined): string {
  if (argPath) return path.resolve(argPath);
  const fromEnv = process.env.DATABASE_URL?.replace("file:", "");
  if (fromEnv) return path.resolve(fromEnv);
  return path.join(process.cwd(), "dev.db");
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function tableCount(dbPath: string): number {
  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all() as Array<{ c: number }>;
    return rows[0]?.c ?? 0;
  } finally {
    db.close();
  }
}

async function main() {
  if (isPostgresDatabaseUrl()) {
    console.error(
      "Refusing: DATABASE_URL is PostgreSQL. Use pg_dump for Postgres backups " +
        "(see docs/BACKUP_RECOVERY.md). This script only handles SQLite files."
    );
    process.exit(2);
  }

  const source = resolveSourcePath(process.argv[2]);
  if (!fs.existsSync(source)) {
    console.error(`Source database not found: ${source}`);
    process.exit(1);
  }

  const dir = path.join(process.cwd(), "backups");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `basera-${timestamp()}.db`);

  // Checkpoint WAL so the copy contains all committed transactions.
  {
    const db = new Database(source);
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      db.close();
    }
  }

  fs.copyFileSync(source, dest);

  // Verify before trusting: integrity check + table-count parity.
  let ok = false;
  {
    const copy = new Database(dest, { readonly: true });
    try {
      const check = copy.prepare("PRAGMA integrity_check").all() as Array<Record<string, string>>;
      const values = check.map((r) => Object.values(r)[0]);
      ok = values.length === 1 && values[0] === "ok";
    } finally {
      copy.close();
    }
  }
  const sameTables = ok && tableCount(source) === tableCount(dest) && tableCount(dest) > 0;
  if (!sameTables) {
    fs.rmSync(dest, { force: true });
    console.error("Backup verification failed; incomplete copy removed.");
    process.exit(1);
  }
  // Verification opens the copy in WAL mode; remove sidecar files so each
  // backup is a single self-contained file.
  fs.rmSync(`${dest}-shm`, { force: true });
  fs.rmSync(`${dest}-wal`, { force: true });

  // Retention pruning (newest kept).
  const keep = Math.max(1, Number(process.env.BACKUP_KEEP ?? 14) || 14);
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith("basera-") && f.endsWith(".db"))
    .sort()
    .reverse();
  for (const old of files.slice(keep)) {
    fs.rmSync(path.join(dir, old), { force: true });
    console.log(`Pruned old backup: ${old}`);
  }

  console.log(`Backup verified: ${dest}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
