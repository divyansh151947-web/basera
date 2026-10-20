import Database from "better-sqlite3";
import path from "path";

const dbPath = process.env.DATABASE_URL?.replace("file:", "") || path.join(process.cwd(), "dev.db");
const sqlite = new Database(dbPath);

const columns = sqlite.prepare("PRAGMA table_info(buyer_preferences)").all();
console.log("Columns:", JSON.stringify(columns, null, 2));

sqlite.close();