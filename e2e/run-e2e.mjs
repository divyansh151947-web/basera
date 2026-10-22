// Basera E2E orchestrator: isolated DB + FRESH server process per run.
//
// Why this exists: the app's abuse protection (src/lib/rate-limit.ts) uses
// process-local in-memory buckets when Redis is not configured. Running the
// browser suite more than once against the same long-lived dev server
// accumulates login/chat budget across runs (per-account login limit is 10
// per 15 minutes), which produced intermittent auth failures that looked like
// product defects. Starting a brand-new server for every run resets that
// state, and seeding a brand-new temp SQLite DB guarantees fixture isolation.
//
// The spawned server ALSO neutralizes all paid external integrations (AI
// providers, Resend, SMTP) by pinning their credential env vars to "" so a
// routine QA run can never call a paid API or send a real email, even when
// the developer's .env has live keys. Real environment variables take
// precedence over .env files in Next.js, so the empty values win.
//
// Usage:
//   node e2e/run-e2e.mjs                 # full suite
//   node e2e/run-e2e.mjs --port=3121     # custom port
//   node e2e/run-e2e.mjs --keep-db       # keep the temp DB dir for inspection
// Any other --key=value args are forwarded to e2e/qa.mjs.
import { spawn, spawnSync } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rawArgs = process.argv.slice(2);
const forwarded = [];
let PORT = 3120;
let KEEP_DB = false;
for (const a of rawArgs) {
  const m = a.match(/^--port=(\d+)$/);
  if (m) PORT = Number(m[1]);
  else if (a === "--keep-db") KEEP_DB = true;
  else forwarded.push(a);
}

function log(msg) {
  console.log(`[e2e-runner] ${msg}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: "127.0.0.1" });
    sock.once("connect", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => resolve(true));
    sock.setTimeout(1500, () => {
      sock.destroy();
      resolve(true);
    });
  });
}

async function waitForHealth(base, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/healthz`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) return true;
      lastErr = `status=${res.status}`;
    } catch (e) {
      lastErr = String(e).slice(0, 120);
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`server not healthy within ${timeoutMs}ms (last: ${lastErr})`);
}

// Pre-compile the hot routes so the FIRST browser navigation of each check
// isn't paying a cold dev-compile tax (this was a source of timing flakes).
// The dev server compiles on demand; a route first hit by a live browser can
// serve HTML before its client chunks are ready, which intermittently left
// forms un-hydrated. Warming every route the suite touches avoids that.
async function warmUp(base) {
  const routes = [
    "/login",
    "/explore",
    "/",
    "/buyer/login",
    "/buyer/signup",
    "/api/auth/providers",
    "/dashboard",
    "/leads",
    "/properties",
    "/appointments",
    "/conversations",
    "/team",
    "/analytics",
    "/settings",
    "/buyer",
    "/buyer/profile",
    "/buyer/explore",
    "/buyer/saved",
    // API routes the suite drives directly. Warming these compiles the route
    // module (dev compiles per-route on first hit); without it the FIRST
    // authenticated POST/DELETE in a check can take seconds — measured 3.05s
    // cold vs ~0.2s warm for /api/buyer/saved — blowing past the checks'
    // response waits. The 401/403 a warm-up fetch gets back is fine: the
    // compile already happened, and no state is touched.
    "/api/buyer/saved",
    "/api/buyer/comparisons",
    "/api/buyer/preferences",
    "/api/buyer/visits",
    "/api/public/chat",
    "/api/public/properties",
    "/buyer/compare",
    "/buyer/visits",
    "/tour",
    "/voice",
  ];
  // Sequentially: concurrent cold compiles on a small machine wedge each other.
  for (const p of routes) {
    try {
      await fetch(`${base}${p}`, { signal: AbortSignal.timeout(90000) });
    } catch {
      // Warm-up is best-effort; the checks themselves decide pass/fail.
    }
  }
}

function killServer(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

(async () => {
  if (!(await portFree(PORT))) {
    console.error(`[e2e-runner] port ${PORT} is already in use. Refusing to reuse an existing server:`);
    console.error("  a long-lived server accumulates in-memory rate-limit state and stale fixtures,");
    console.error("  which causes exactly the intermittent auth failures this runner prevents.");
    process.exit(2);
  }

  // 1) Fresh isolated DB (never dev.db).
  log("seeding isolated temp DB...");
  const seed = spawnSync(process.execPath, [path.join("e2e", "seed.cjs")], { cwd: ROOT, encoding: "utf8" });
  if (seed.status !== 0) {
    console.error(seed.stdout || "");
    console.error(seed.stderr || "");
    console.error("[e2e-runner] seed failed");
    process.exit(2);
  }
  const dbPath = (seed.stdout || "").match(/DB_PATH=(.+)/)?.[1]?.trim();
  if (!dbPath || !fs.existsSync(dbPath)) {
    console.error("[e2e-runner] seed did not report a usable DB_PATH:", seed.stdout);
    process.exit(2);
  }
  log(`DB: ${dbPath}`);
  // Seeded media fixtures (real MP4/JPG/PNG under content-addressed names)
  // live in the temp media root; point the server's media storage there so
  // the property-driven homepage showcase and buyer listing pages serve the
  // seeded files without touching the repo's .uploads.
  const mediaRoot = (seed.stdout || "").match(/MEDIA_ROOT=(.+)/)?.[1]?.trim();
  if (mediaRoot && !fs.existsSync(mediaRoot)) {
    console.error("[e2e-runner] seed reported a MEDIA_ROOT that does not exist:", mediaRoot);
    process.exit(2);
  }

  // 2) Fresh server with isolated DB + offline integrations.
  const base = `http://127.0.0.1:${PORT}`;
  const serverEnv = {
    ...process.env,
    DATABASE_URL: dbPath,
    // Match the seeded demo workspace so the public chat widget resolves
    // server-side (an unmatched slug is a controlled 404 by design).
    NEXT_PUBLIC_PUBLIC_ORG_SLUG: "basera",
    // Auth origin: never inherit a pinned NEXTAUTH_URL from the parent shell
    // (.env or the developer's terminal). A pinned origin makes next-auth
    // redirect login/logout to that stale port, which showed up as
    // intermittent 404/502s mid-suite. IMPORTANT: the variable must be
    // DELETED, not set to "" — next-auth's parseUrl("") throws
    // "Invalid URL" (empty string is defined-but-falsy, so it skips the
    // default and parses the empty string). With the variable absent,
    // AUTH_TRUST_HOST makes next-auth resolve the origin from the request
    // host — always this server's real port.
    AUTH_TRUST_HOST: "1",
    // Serve seeded media fixtures from the temp media root (never the repo's
    // .uploads), so the property-driven showcase plays a REAL uploaded file.
    ...(mediaRoot ? { MEDIA_STORAGE_DIR: mediaRoot } : {}),
    // Force offline mode: no paid AI call, no real email, ever.
    // VOICE_PROVIDER itself must be pinned (not just the credentials): a
    // developer .env value like VOICE_PROVIDER=gemini otherwise leaks into
    // this server, the blanked GEMINI_API_KEY makes that provider fail
    // closed (503 "not configured"), and the voice checks would report a
    // harness bug as a product bug. getVoiceProviderName maps "" -> mock,
    // the provider that exists exactly for offline QA.
    VOICE_PROVIDER: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    GEMINI_API_KEY: "",
    RESEND_API_KEY: "",
    SMTP_HOST: "",
  };
  // Belt-and-braces: drop any inherited NEXTAUTH_URL entirely (spread above
  // would carry a shell-level pin into the server). Must be absent, never "".
  delete serverEnv.NEXTAUTH_URL;
  log(`starting isolated dev server on ${base} ...`);
  // Invoke Next's bin directly with node — avoids shell:true (Windows .cmd
  // spawning quirks and the argv-concatenation deprecation warning).
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  const server = spawn(process.execPath, [nextBin, "dev", "--port", String(PORT)], {
    cwd: ROOT,
    env: serverEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLog = fs.createWriteStream(path.join(ROOT, "e2e-server.log"), { flags: "w" });
  server.stdout.pipe(serverLog);
  server.stderr.pipe(serverLog);
  server.on("exit", (code) => {
    if (code !== 0 && code !== null) log(`server exited early with code ${code} (see e2e-server.log)`);
  });

  let qaExit = 2;
  try {
    await waitForHealth(base, 180000);
    log("server healthy; warming up routes...");
    await warmUp(base);
    log("running browser checks...");
    qaExit = await new Promise((resolve) => {
      const qa = spawn(
        process.execPath,
        [path.join("e2e", "qa.mjs"), `--base=${base}`, `--db=${dbPath}`, ...forwarded],
        { cwd: ROOT, stdio: "inherit" }
      );
      qa.on("exit", (code) => resolve(code ?? 2));
    });
  } catch (e) {
    console.error("[e2e-runner]", String(e).slice(0, 300));
    log("tail of e2e-server.log:");
    try {
      console.error(fs.readFileSync(path.join(ROOT, "e2e-server.log"), "utf8").slice(-2000));
    } catch {}
  } finally {
    killServer(server);
  }

  // Publish the newest results to a stable path for CI/humans to read.
  try {
    const shotsRoot = path.join(ROOT, "e2e", "screenshots");
    const newest = fs
      .readdirSync(shotsRoot)
      .filter((d) => fs.existsSync(path.join(shotsRoot, d, "results.json")))
      .sort()
      .pop();
    if (newest) {
      fs.copyFileSync(path.join(shotsRoot, newest, "results.json"), path.join(ROOT, "e2e-results.json"));
      log(`results copied to e2e-results.json (run ${newest})`);
    }
  } catch {}

  if (!KEEP_DB) {
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
    } catch {}
  } else {
    log(`kept temp DB: ${dbPath}`);
  }
  log(`done: qa exit code ${qaExit}`);
  process.exit(qaExit);
})().catch((e) => {
  console.error("E2E RUNNER FATAL:", e);
  process.exit(2);
});
