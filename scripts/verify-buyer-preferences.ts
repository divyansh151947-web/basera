import Database from "better-sqlite3";
import path from "path";

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "dev.db");
const sqlite = new Database(dbPath);

const tables = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='buyer_preferences'").all();
console.log("Tables:", JSON.stringify(tables));

const indexes = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='buyer_preferences'").all();
console.log("Indexes:", JSON.stringify(indexes));

sqlite.close();