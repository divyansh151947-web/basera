// Single place that decides which database dialect is active. SQLite files
// (including bare paths) and empty values mean local SQLite; anything
// starting with postgres:// or postgresql:// means PostgreSQL.

export function isPostgresDatabaseUrl(url: string | undefined = process.env.DATABASE_URL): boolean {
  if (!url) return false;
  return /^\s*postgres(ql)?:\/\//i.test(url);
}

export function isSqliteDatabaseUrl(url: string | undefined = process.env.DATABASE_URL): boolean {
  return !isPostgresDatabaseUrl(url);
}
