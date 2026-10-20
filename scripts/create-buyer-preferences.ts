import Database from "better-sqlite3";
import path from "path";

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "dev.db");
const sqlite = new Database(dbPath);

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS buyer_preferences (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    budget_min_inr INTEGER,
    budget_max_inr INTEGER,
    preferred_city TEXT,
    preferred_locality TEXT,
    property_type TEXT,
    bhk INTEGER,
    min_area_sqft INTEGER,
    max_area_sqft INTEGER,
    furnishing TEXT,
    possession_timeline TEXT,
    purpose TEXT,
    created_at TEXT DEFAULT (current_timestamp) NOT NULL,
    updated_at TEXT DEFAULT (current_timestamp) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
  );
  CREATE UNIQUE INDEX IF NOT EXISTS bp_user_idx ON buyer_preferences (user_id);
`);

console.log('buyer_preferences table created successfully');
sqlite.close();