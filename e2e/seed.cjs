// E2E seed: isolated temp SQLite DB for browser QA. NEVER touches dev.db.
// Prints DB_PATH=<path> and MEDIA_ROOT=<path> on stdout.
//
// Media: the seeded showcase property gets REAL media files (the repo's own
// demo MP4 + poster + a tiny PNG, copied into the temp media root under the
// same content-addressed names the app's uploader writes). This lets the
// homepage property-driven video showcase and the buyer listing pages be
// verified end-to-end without any network access. The media root lives in
// the temp dir (run-e2e.mjs points MEDIA_STORAGE_DIR at it), so nothing is
// written into the repo's .uploads.
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "basera-e2e-"));
  const dbPath = path.join(tmp, "e2e.db");
  const mediaRoot = path.join(tmp, "uploads");
  const Database = require("better-sqlite3");
  const { drizzle } = require("drizzle-orm/better-sqlite3");
  const { migrate } = require("drizzle-orm/better-sqlite3/migrator");
  const bcrypt = require("bcryptjs");

  // ---- Content-addressed media fixtures (same naming the app uses) --------
  const ROOT_DIR = path.resolve(__dirname, "..");
  function plantMedia(relPathInRepo, ext) {
    const src = path.join(ROOT_DIR, relPathInRepo);
    if (!fs.existsSync(src)) return null; // fixture absent → caller degrades
    const bytes = fs.readFileSync(src);
    const hash = crypto.createHash("sha256").update(bytes).digest("hex");
    const dir = path.join(mediaRoot, "properties", "e2e-org");
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${hash}.${ext}`;
    fs.writeFileSync(path.join(dir, filename), bytes);
    return `/api/media/properties/e2e-org/${filename}`;
  }
  const seededVideoUrl = plantMedia(path.join("public", "videos", "basera-property-showcase.mp4"), "mp4");
  const seededPosterUrl = plantMedia(path.join("public", "videos", "basera-property-showcase-poster.jpg"), "jpg");
  // 1x1 PNG generated locally — a real image file with a real content hash.
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );
  const tinyPngDir = path.join(mediaRoot, "properties", "e2e-org");
  fs.mkdirSync(tinyPngDir, { recursive: true });
  const tinyPngName = `${crypto.createHash("sha256").update(tinyPng).digest("hex")}.png`;
  fs.writeFileSync(path.join(tinyPngDir, tinyPngName), tinyPng);
  const seededImageUrl = `/api/media/properties/e2e-org/${tinyPngName}`;

  const handle = new Database(dbPath);
  migrate(drizzle(handle), { migrationsFolder: "./drizzle" });
  // Same additive ensure the app runtime applies (src/db/client.ts): the
  // SQLite migration history predates the property-media columns, so they
  // are added here idempotently. Strictly additive; never touches rows.
  const colNames = new Set(
    handle.prepare("PRAGMA table_info(properties)").all().map((c) => c.name)
  );
  if (!colNames.has("video_url")) handle.exec("ALTER TABLE properties ADD COLUMN video_url TEXT");
  if (!colNames.has("video_poster_url")) handle.exec("ALTER TABLE properties ADD COLUMN video_poster_url TEXT");

  const now = new Date().toISOString();
  const pw = async (s) => bcrypt.hash(s, 4);
  const staffHash = await pw("StaffE2e123!");
  const buyerHash = await pw("BuyerE2e123!");

  const orgId = "e2e-org";
  const foreignOrgId = "e2e-foreign-org";
  handle.prepare("INSERT INTO organizations (id, name, slug, is_demo, created_at, updated_at) VALUES (?,?,?,?,?,?)")
    .run(orgId, "E2E Estates", "basera", 1, now, now);
  handle.prepare("INSERT INTO organizations (id, name, slug, is_demo, created_at, updated_at) VALUES (?,?,?,?,?,?)")
    .run(foreignOrgId, "Foreign Brokerage", "foreign-brokerage", 0, now, now);

  const user = (id, org, name, email, hash, role) =>
    handle.prepare("INSERT INTO users (id, organization_id, name, email, password_hash, role, is_active, email_verified_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, org, name, email, hash, role, 1, now, now, now);
  user("e2e-staff", orgId, "E2E Staff", "staff-e2e@example.com", staffHash, "BUSINESS_ADMIN");
  user("e2e-agent", orgId, "E2E Agent", "agent-e2e@example.com", staffHash, "SALES_AGENT");
  user("e2e-buyer1", null, "E2E Buyer", "buyer1-e2e@example.com", buyerHash, "BUYER");
  user("e2e-buyer2", null, "E2E Buyer Two", "buyer2-e2e@example.com", buyerHash, "BUYER");

  const prop = (id, org, name, locality, extra = {}) => {
    const row = { id, organizationId: org, projectName: name, propertyType: "APARTMENT", city: "Jaipur", locality, priceMinInr: 5000000, priceMaxInr: 7000000, availability: "AVAILABLE", isArchived: 0, createdAt: now, updatedAt: now, ...extra };
    const cols = Object.keys(row);
    const snake = { organizationId: "organization_id", projectName: "project_name", propertyType: "property_type", priceMinInr: "price_min_inr", priceMaxInr: "price_max_inr", isArchived: "is_archived", createdAt: "created_at", updatedAt: "updated_at", videoUrl: "video_url", videoPosterUrl: "video_poster_url", imagesJson: "images_json" };
    const dbCols = cols.map((c) => snake[c] || c);
    handle.prepare(`INSERT INTO properties (${dbCols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => row[c]));
    return id;
  };
  // Fixed, distinct createdAt values so the homepage showcase fallback is
  // deterministic in tests: newest-with-video wins (tie-break is id asc).
  // e2e-prop-a (Jaipur, Malviya Nagar) is NEWEST and has the seeded video.
  // e2e-prop-ggn (Gurugram, Sector 54) is OLDER and has its own video, so
  // city/locality priority can be tested against the newer Jaipur pick.
  const seededImagesJson = JSON.stringify(seededImageUrl ? [seededImageUrl] : []);
  prop("e2e-prop-a", orgId, "E2E Heights A", "Malviya Nagar", {
    createdAt: "2026-01-03T00:00:00.000Z",
    videoUrl: seededVideoUrl,
    videoPosterUrl: seededPosterUrl,
    imagesJson: seededImagesJson,
  });
  prop("e2e-prop-ggn", orgId, "E2E Gurugram Golf Homes", "Sector 54", {
    city: "Gurugram",
    createdAt: "2026-01-02T00:00:00.000Z",
    videoUrl: seededVideoUrl,
    videoPosterUrl: seededPosterUrl,
    imagesJson: seededImagesJson,
  });
  prop("e2e-prop-b", orgId, "E2E Heights B", "Tonk Road");
  prop("e2e-prop-arch", orgId, "E2E Archived", "Old Town", { isArchived: 1 });
  prop("e2e-prop-sold", orgId, "E2E Sold", "Old Town", { availability: "SOLD_OUT" });
  prop("e2e-prop-foreign", foreignOrgId, "Foreign Villa", "Abroad");

  handle.prepare("INSERT INTO leads (id, organization_id, name, source, score, temperature, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("e2e-lead-1", orgId, "E2E Lead", "MANUAL", 10, "COLD", "NEW", now, now);
  handle.prepare("INSERT INTO conversations (id, organization_id, lead_id, channel, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)")
    .run("e2e-convo-1", orgId, "e2e-lead-1", "WEBSITE_CHAT", "AI_HANDLING", now, now);
  handle.prepare("INSERT INTO messages (id, conversation_id, sender, content, created_at) VALUES (?,?,?,?,?)")
    .run("e2e-msg-1", "e2e-convo-1", "LEAD", "Hello, I need a 2 BHK", now);
  handle.close();
  console.log("DB_PATH=" + dbPath);
  console.log("MEDIA_ROOT=" + mediaRoot);
})().catch((e) => { console.error("SEED FAILED:", e.message); process.exit(1); });
