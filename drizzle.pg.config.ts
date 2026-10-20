import type { Config } from "drizzle-kit";

// PostgreSQL migration config (production). The default drizzle.config.ts
// remains SQLite (local dev). Usage:
//   npx drizzle-kit generate --config=drizzle.pg.config.ts
export default {
  schema: "./src/db/schema-pg.ts",
  out: "./drizzle/pg",
  dialect: "postgresql",
} satisfies Config;
