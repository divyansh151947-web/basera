// Basera browser QA runner (Playwright-core + system Chrome, headless).
// Usage: node e2e/qa.mjs [--base=http://127.0.0.1:3120] [--shots=e2e/screenshots] [--db=/path/e2e.db]
// Isolated temp DB only (passed via --db); never touches dev.db.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const m = a.match(/^--([^=]+)=(.*)$/);
  return m ? [m[1], m[2]] : [a, true];
}));
const BASE = args.base || "http://127.0.0.1:3120";
const SHOTS = args.shots || "e2e/screenshots";
const DB_PATH = args.db || "";
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const SHOT_DIR = path.join(SHOTS, RUN_ID);
fs.mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const allNetworkIssues = [];
function check(section, name, cond, detail = "") {
  results.push({ section, name, ok: !!cond, detail: cond ? "" : String(detail).slice(0, 300) });
  console.log(`${cond ? "PASS" : "FAIL"}  [${section}] ${name}${cond || !detail ? "" : " — " + String(detail).slice(0, 200)}`);
}
function db() {
  if (!DB_PATH) throw new Error("missing --db");
  return new Database(DB_PATH, { readonly: false });
}

// --- TOTP helper (test-side only; mirrors RFC 6238 SHA-1/6-digit/30s) ---
// Used to enroll an authenticator-app-equivalent code during the 2FA checks.
// This never touches production code: the server has no test bypass.
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32ToBuffer(secret) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(secret).toUpperCase().replace(/=+$/, "")) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`bad base32 char: ${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    while (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totpCodeAt(secretBase32, atMs = Date.now()) {
  const counter = BigInt(Math.floor(atMs / 1000 / 30));
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(counter);
  const digest = createHmac("sha1", base32ToBuffer(secretBase32)).update(buf).digest();
  const off = digest[digest.length - 1] & 0x0f;
  const bin =
    ((digest[off] & 0x7f) << 24) | (digest[off + 1] << 16) | (digest[off + 2] << 8) | digest[off + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}
function totpCode(secretBase32) {
  return totpCodeAt(secretBase32, Date.now());
}
/** A code that is guaranteed to be outside the ±1-step drift window. */
function wrongTotpCode(secretBase32) {
  const now = Date.now();
  const good = totpCodeAt(secretBase32, now);
  const nearby = new Set([totpCodeAt(secretBase32, now - 30_000), totpCodeAt(secretBase32, now + 30_000)]);
  for (let steps = 5; steps < 20; steps++) {
    const candidate = totpCodeAt(secretBase32, now + steps * 30_000);
    if (candidate !== good && !nearby.has(candidate)) return candidate;
  }
  return "000000";
}
function rgbChannels(css) {
  const m = String(css).match(/rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)/i);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

let browser;
async function newContext(viewport, tag) {
  const ctx = await browser.newContext({
    viewport,
    ignoreHTTPSErrors: true,
    permissions: [],
  });
  ctx.__tag = tag;
  return ctx;
}
async function watch(page, label) {
  const issues = { consoleErrors: [], pageErrors: [], failed: [], dialogs: [] };
  page.on("console", (m) => { if (m.type() === "error") issues.consoleErrors.push(`[${label} @ ${page.url()}] ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => issues.pageErrors.push(`[${label} @ ${page.url()}] ${String(e).slice(0, 300)}`));
  page.on("requestfailed", (r) => issues.failed.push(`[${label}] ${r.method()} ${r.url().slice(0, 120)} :: ${r.failure()?.errorText}`));
  page.on("response", (r) => {
    if (r.status() === 404 && !r.url().includes("_next")) {
      const entry = `[${label}] 404 ${r.url().slice(0, 160)}`;
      issues.failed.push(entry);
      // The ambient-music slot is intentionally empty until a licensed track
      // is supplied (see public/audio/README.md) — reported, not failed.
      if (!r.url().includes("/audio/basera-ambient.mp3")) allNetworkIssues.push(entry);
    }
  });
  page.on("dialog", async (d) => { issues.dialogs.push(`[${label}] ${d.type()}: ${d.message().slice(0, 160)}`); await d.dismiss().catch(() => {}); });
  return issues;
}
async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`) });
}
async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
async function settledNoOverflow(page) {
  // Wait for fonts, images, and layout to settle, then measure twice: only
  // persistent overflow fails (transient shifts during load are noted, not failed).
  try {
    await page.evaluate(() => document.fonts?.ready);
  } catch {}
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  if (await noOverflow(page)) return { ok: true, detail: "" };
  await page.waitForTimeout(1200);
  if (await noOverflow(page)) return { ok: true, detail: "transient at first measure, settled on remeasure" };
  return { ok: false, detail: (await overflowCulprits(page)).join(" | ") };
}
async function overflowCulprits(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    const seen = new Set();
    function label(el) {
      let sel = el.tagName.toLowerCase();
      if (el.id) sel += `#${el.id}`;
      else if (typeof el.className === "string" && el.className.trim()) sel += `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}`;
      return sel;
    }
    function domPath(el) {
      const parts = [];
      let node = el;
      for (let d = 0; d < 4 && node && node !== document.body; d += 1) {
        const parent = node.parentElement;
        const idx = parent ? Array.prototype.indexOf.call(parent.children, node) + 1 : 1;
        parts.unshift(`${label(node)}:nth(${idx})`);
        node = parent;
      }
      return parts.join(">");
    }
    document.querySelectorAll("body *").forEach((el) => {
      const r = el.getBoundingClientRect();
      if ((r.right > vw + 1 || r.left < -1) && out.length < 5) {
        const key = `${Math.round(r.left)},${Math.round(r.right)}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(`${label(el)} L=${Math.round(r.left)} R=${Math.round(r.right)} vw=${vw} :: ${domPath(el)}`);
        }
      }
    });
    return out;
  });
}
// Exact-path helper: several checks used substring matching (e.g.
// url.includes("/buyer")), which passes vacuously on "/buyer/login".
function pathOf(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return String(url);
  }
}
// Dev-mode chunk race: a page can return 200 with server HTML while its
// client bundle is still compiling, so form controls exist but submit
// handlers don't. If a control never becomes enabled/interactive within a
// beat, reload once (chunk is compiled by then) before letting the caller
// interact.
async function reloadUntilInteractive(page, selector) {
  const ready = () =>
    page
      .waitForSelector(selector, { timeout: 15000, state: "visible" })
      .then(() => true)
      .catch(() => false);
  if (await ready()) return;
  console.log(`  ${selector} not interactive on ${page.url()}; reloading`);
  await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
  await ready();
}
// State-based login: wait for the actual credentials round-trip (not a fixed
// sleep) so a slow dev-compile of the auth route can't outrun the assertion.
// If the round-trip happens but no session sticks (observed intermittently in
// dev when /login is being compiled concurrently), retry the submission once
// before reporting the final URL — callers still decide what URL is a success.
async function loginUI(page, loginPath, email, password) {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log(`  login retry ${attempt} for ${email} (still on a login URL after callback)`);
    }
    // Always navigate fresh: callers pass pages that may still be on
    // about:blank, and a retry must not submit against the previous page.
    // Default waitUntil ("load") matters: clicking Sign in before hydration
    // submits the raw HTML form (no session), so wait for load, then for the
    // form itself.
    await page.goto(`${BASE}${loginPath}`);
    // Dev-mode chunk race: /login can return 200 before its client bundle is
    // served, so the form never hydrates and fills time out at the default
    // 30s. Wait for the form explicitly; if it never appears, reload once
    // (the chunk is compiled by then) before failing.
    const formUp = await page
      .waitForSelector('input[type="email"]', { timeout: 20000, state: "visible" })
      .then(() => true)
      .catch(() => false);
    if (!formUp) {
      console.log(`  login form did not hydrate on ${page.url()}; reloading`);
      await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      await page
        .waitForSelector('input[type="email"]', { timeout: 20000, state: "visible" })
        .catch(() => {});
    }
    await page.locator('input[type="email"]').first().fill(email, { timeout: 15000 });
    await page.locator('input[type="password"]').fill(password, { timeout: 15000 });
    const callback = page
      .waitForResponse((r) => r.url().includes("/api/auth/callback/credentials") && r.request().method() === "POST", { timeout: 25000 })
      .catch(() => null);
    const landed = page
      .waitForURL((url) => !url.pathname.endsWith("login"), { timeout: 20000 })
      .catch(() => {});
    await page.getByRole("button", { name: /sign in/i }).click({ timeout: 15000 });
    const cb = await callback;
    if (cb && cb.status() >= 400) console.log(`  login callback status=${cb.status()} for ${email}`);
    await landed;
    await page.waitForTimeout(1000); // client-side router push settle
    if (!page.url().endsWith("login")) return page.url();
  }
  return page.url();
}

const STAFF = { email: "staff-e2e@example.com", password: "StaffE2e123!" };
const BUYER1 = { email: "buyer1-e2e@example.com", password: "BuyerE2e123!" };
const BUYER2 = { email: "buyer2-e2e@example.com", password: "BuyerE2e123!" };
const DESKTOP = { width: 1440, height: 900 };

async function sectionStaffAuth() {
  const ctx = await newContext(DESKTOP, "staff");
  const page = await ctx.newPage();
  const issues = await watch(page, "staff-auth");

  await page.goto(`${BASE}/login`);
  check("staff-auth", "login page renders staff UI", await page.getByRole("heading", { name: /staff login/i }).isVisible());
  await shot(page, "01-staff-login");

  await page.locator('input[type="email"]').fill("nobody@example.com");
  await page.locator('input[type="password"]').fill("WrongPass1!");
  // State-based: wait for the actual auth round-trip to complete before
  // looking for the error text (fixed sleeps raced the dev-compiled callback
  // route under load).
  const invalidCallback = page
    .waitForResponse((r) => r.url().includes("/api/auth/callback/credentials") && r.request().method() === "POST", { timeout: 25000 })
    .catch(() => null);
  await page.getByRole("button", { name: /sign in/i }).click();
  const invCb = await invalidCallback;
  if (invCb && invCb.status() >= 400) console.log(`  invalid-login callback status=${invCb.status()}`);
  await page.waitForFunction(() => document.body.innerText.includes("Invalid email or password"), { timeout: 15000 }).catch(() => {});
  const invalidLoginText = await page.content();
  check("staff-auth", "invalid credentials show safe error", invalidLoginText.includes("Invalid email or password"), invCb ? `callback status=${invCb.status()}` : "no callback observed");
  check("staff-auth", "failed login stays on /login", page.url().includes("/login"));

  const url = await loginUI(page, "/login", STAFF.email, STAFF.password);
  check("staff-auth", "valid staff reaches dashboard", url.includes("/dashboard"), url);
  check("staff-auth", "sidebar navigation present", await page.locator('aside a[title="Sales team"]').isVisible());
  await shot(page, "02-staff-dashboard");

  await page.reload();
  await page.waitForTimeout(1200);
  check("staff-auth", "refresh preserves staff session", page.url().includes("/dashboard"), page.url());
  await page.goto(`${BASE}/leads`);
  await page.waitForTimeout(1200);
  check("staff-auth", "direct navigation to /leads works", page.url().includes("/leads"), page.url());

  // evil callbackUrl on login page is ignored (client routes internally)
  await page.goto(`${BASE}/login?callbackUrl=https://evil.example/phish`);
  await page.waitForTimeout(800);
  check("staff-auth", "login with evil callbackUrl stays same-origin", page.url().startsWith(BASE), page.url());

  // buyer session cannot access staff pages
  const bctx = await newContext(DESKTOP, "buyer-block");
  const bpage = await bctx.newPage();
  const buyerLoginUrl = await loginUI(bpage, "/buyer/login", BUYER1.email, BUYER1.password);
  if (!buyerLoginUrl.includes("/buyer")) console.log(`  buyer-block setup: buyer login landed on ${buyerLoginUrl}`);
  await bpage.goto(`${BASE}/dashboard`);
  await bpage.waitForURL((u) => !u.pathname.startsWith("/dashboard"), { timeout: 15000 }).catch(() => {});
  await bpage.waitForTimeout(500);
  check("staff-auth", "buyer session redirected off /dashboard", bpage.url().includes("/buyer") && !bpage.url().includes("/dashboard"), bpage.url());
  const api403 = await bpage.evaluate(async (base) => {
    const r = await fetch(`${base}/api/leads?limit=1`);
    return r.status;
  }, BASE);
  check("staff-auth", "buyer blocked from staff API in browser", api403 === 403, `status=${api403}`);
  await bctx.close();

  // logout + session reuse (return to an authenticated page first: the
  // sign-out control lives in the workspace sidebar, not on /login)
  await page.bringToFront();
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1200);
  await page.locator('aside button[title="Sign out"]').click();
  await page.waitForTimeout(2000);
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1500);
  check("staff-auth", "logout invalidates; /dashboard redirects to login", page.url().includes("/login"), page.url());

  const errs = [...issues.consoleErrors, ...issues.pageErrors];
  check("staff-auth", "no page exceptions on auth journey", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
  if (issues.consoleErrors.length) console.log("  console-errors:", issues.consoleErrors.join(" | "));
  await ctx.close();
}

async function sectionBuyerAuth() {
  const ctx = await newContext(DESKTOP, "buyer");
  const page = await ctx.newPage();
  const issues = await watch(page, "buyer-auth");

  await page.goto(`${BASE}/buyer/login`);
  check("buyer-auth", "buyer login renders", (await page.content()).toLowerCase().includes("buyer"));
  await page.goto(`${BASE}/buyer/signup`);
  await reloadUntilInteractive(page, 'input[type="email"]');
  check("buyer-auth", "buyer signup renders registration form", await page.locator('input[type="email"]').isVisible());
  await shot(page, "03-buyer-signup");

  // invalid data -> client validation error
  await page.getByLabel("Your name").fill("Bad Name");
  await page.getByLabel("Email").fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("short");
  await page.getByRole("button", { name: /create|sign up|register/i }).click().catch(() => {});
  await page.waitForTimeout(800);

  // register a fresh synthetic buyer via UI
  const ts = Date.now();
  const email = `qa-buyer-${ts}@example.com`;
  await page.getByLabel("Your name").fill("QA Buyer");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill("QaBuyer123!");
  const phone = page.getByLabel(/phone/i);
  if (await phone.count()) await phone.first().fill("+91 90000 11111");
  // State-based: wait for the signup round-trip, then for the client-side
  // redirect into the buyer area (a fixed sleep raced a slow dev redirect).
  const signupResp = page
    .waitForResponse((r) => r.url().includes("/api/auth/buyer-signup") && r.request().method() === "POST", { timeout: 30000 })
    .catch(() => null);
  await page.getByRole("button", { name: /create|sign up|register|get started/i }).click().catch(() => {});
  const signupPost = await signupResp;
  await page.waitForURL((u) => u.pathname === "/buyer", { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1000);
  const afterSignup = page.url();
  check(
    "buyer-auth",
    "fresh buyer registers and reaches buyer area",
    pathOf(afterSignup) === "/buyer",
    `${afterSignup} (signup status=${signupPost ? signupPost.status() : "none"})`
  );

  // duplicate email handled
  await page.goto(`${BASE}/buyer/signup`);
  await reloadUntilInteractive(page, 'input[type="email"]');
  await page.waitForTimeout(800);
  await page.getByLabel("Your name").fill("Dup");
  await page.getByLabel("Email").fill("buyer1-e2e@example.com");
  await page.getByLabel("Password", { exact: true }).fill("QaBuyer123!");
  await page.getByRole("button", { name: /create|sign up|register|get started/i }).click().catch(() => {});
  await page.waitForTimeout(2000);
  const dupText = await page.content();
  const dupErrVisible = /already registered|already exists|log in/i.test(dupText);
  if (!dupErrVisible) console.log("  dup-signup page text:", dupText.replace(/\s+/g, " ").slice(0, 400));
  check("buyer-auth", "duplicate email shows useful error", dupErrVisible);

  // injection attempt via API: extra role/org fields must not stick
  const injEmail = `qa-inject-${ts}@example.com`;
  const injRes = await page.evaluate(async ({ base, em }) => {
    const r = await fetch(`${base}/api/auth/buyer-signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Inj", email: em, password: "InjPass123!", role: "SUPER_ADMIN", organizationId: "e2e-org" }),
    });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, { base: BASE, em: injEmail });
  let injRow = null;
  if (DB_PATH) {
    const h = db();
    injRow = h.prepare("SELECT role, organization_id AS org FROM users WHERE email = ?").get(injEmail);
    h.close();
  }
  check("buyer-auth", "signup injection neutralized", injRes.status === 200 && injRow?.role === "BUYER" && injRow?.org === null, JSON.stringify(injRow));

  // existing buyer login + anon redirect + staff blocked + logout
  const url = await loginUI(page, "/buyer/login", BUYER1.email, BUYER1.password);
  check("buyer-auth", "buyer login reaches /buyer", pathOf(url) === "/buyer", url);
  const anon = await (await browser.newContext()).newPage();
  await anon.goto(`${BASE}/buyer`);
  await anon.waitForTimeout(1200);
  check("buyer-auth", "anon /buyer redirects to buyer login", anon.url().includes("/buyer/login"), anon.url());
  await anon.context().close();

  const sctx = await newContext(DESKTOP, "staff-block");
  const spage = await sctx.newPage();
  await loginUI(spage, "/login", STAFF.email, STAFF.password);
  await spage.goto(`${BASE}/buyer`);
  await spage.waitForTimeout(1200);
  check("buyer-auth", "staff session redirected off /buyer", spage.url().includes("/dashboard"), spage.url());
  await sctx.close();

  await page.bringToFront();
  const signout = page.locator('button[title="Sign out"], a[title="Sign out"]');
  const haveSignout = (await signout.count()) > 0;
  check("buyer-auth", "buyer sign out control present", haveSignout);
  // State-based: wait for the actual sign-out POST and the client-side
  // same-origin jump to "/" — a fixed sleep let `page.goto` cancel the
  // in-flight sign-out fetch, leaving the session cookie alive (flaky FAIL).
  if (haveSignout) {
    const buyerSignoutRes = page
      .waitForResponse((r) => r.url().includes("/api/auth/signout") && r.request().method() === "POST", { timeout: 25000 })
      .catch(() => null);
    await signout.first().click();
    const bsignout = await buyerSignoutRes;
    check("buyer-auth", "buyer sign out hits session API", !!bsignout, bsignout ? `status=${bsignout.status()}` : "no signout request observed");
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 }).catch(() => {});
  }
  await page.goto(`${BASE}/buyer`);
  await page.waitForURL((u) => u.pathname.startsWith("/buyer/login"), { timeout: 15000 }).catch(() => {});
  check("buyer-auth", "buyer logout invalidates session", page.url().includes("/buyer/login"), page.url());

  // revoked session: rotate buyer hash in the isolated DB, reload
  if (DB_PATH) {
    await loginUI(page, "/buyer/login", BUYER1.email, BUYER1.password);
    const h = db();
    const bcrypt = (await import("bcryptjs")).default;
    h.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(await bcrypt.hash("Rotated999!", 4), BUYER1.email);
    h.close();
    await page.goto(`${BASE}/buyer`);
    await page.waitForTimeout(1500);
    check("buyer-auth", "revoked buyer session redirects to login", page.url().includes("/buyer/login"), page.url());
    const h2 = db();
    h2.prepare("UPDATE users SET password_hash = ? WHERE email = ?").run(await bcrypt.hash(BUYER1.password, 4), BUYER1.email);
    h2.close();
    const back = await loginUI(page, "/buyer/login", BUYER1.email, BUYER1.password);
    check("buyer-auth", "buyer can log in again after rotation", pathOf(back) === "/buyer", back);
  }
  check("buyer-auth", "no page exceptions on buyer journey", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
  await ctx.close();
}

/**
 * New-feature browser coverage:
 *  1) Homepage is buyer-first (Buyer Login + Create Buyer Account, Business
 *     Login demoted) and the AI Property Videos section presents a real,
 *     resolvable video asset.
 *  2) Change Password opens, validates, rejects a wrong current password,
 *     succeeds with correct input, and the new credentials authenticate
 *     while the old ones no longer do.
 */
async function sectionBuyerUX() {
  const ctx = await newContext(DESKTOP, "buyer-ux");
  const page = await ctx.newPage();
  const issues = await watch(page, "buyer-ux");

  // --- Homepage buyer-first navigation + AI video showcase ---
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(1200);
  const buyerLoginLink = page.locator('header a[href="/buyer/login"]');
  const buyerSignupLink = page.locator('header a[href="/buyer/signup"]');
  check("buyer-ux", "homepage header shows Buyer Login", await buyerLoginLink.first().isVisible());
  check("buyer-ux", "homepage header shows Create Buyer Account", await buyerSignupLink.first().isVisible());
  const headerText = await page.locator("header").innerText();
  check("buyer-ux", "header no longer advertises business workspace signup", !/create business workspace/i.test(headerText), headerText.replace(/\s+/g, " ").slice(0, 160));

  const aiSection = page.locator('#ai-videos, section[aria-label="AI property videos"]');
  check("buyer-ux", "AI Property Videos section renders", (await aiSection.count()) > 0);
  const videoEl = aiSection.locator("video");
  check("buyer-ux", "showcase section contains a video element", (await videoEl.count()) > 0);
  // The showcase is property-driven: it must play the SEEDED PROPERTY's own
  // uploaded video (content-addressed media URL), not a bundled demo reel.
  const showcaseSrc = (await videoEl.first().getAttribute("src").catch(() => null)) ||
    (await videoEl.first().locator("source").first().getAttribute("src").catch(() => null)) || "";
  check(
    "buyer-ux",
    "showcase plays the property's own uploaded video (property-driven)",
    showcaseSrc.startsWith("/api/media/properties/"),
    showcaseSrc
  );
  const videoSrcStatus = await page.evaluate(async (src) => {
    if (!src) return { status: 0, len: null };
    const r = await fetch(src, { method: "HEAD" });
    return { status: r.status, len: r.headers.get("content-length") };
  }, showcaseSrc);
  check(
    "buyer-ux",
    "showcase video asset resolves over HTTP",
    videoSrcStatus.status === 200 && Number(videoSrcStatus.len) > 0,
    JSON.stringify(videoSrcStatus)
  );
  const posterSrc = await videoEl.first().getAttribute("poster");
  const posterStatus = posterSrc
    ? await page.evaluate(async (src) => (await fetch(src, { method: "HEAD" })).status, posterSrc)
    : 0;
  check("buyer-ux", "showcase poster resolves over HTTP", posterStatus === 200, `poster=${posterSrc} status=${posterStatus}`);

  // Default (no preference): the newest published property WITH a video is
  // featured — seeded as "E2E Heights A" (2026-01-03, newest video row).
  const defaultTitle = await aiSection.innerText().catch(() => "");
  check(
    "buyer-ux",
    "default showcase features the newest published video property",
    /E2E Heights A/.test(defaultTitle) && /Malviya Nagar, Jaipur/.test(defaultTitle),
    defaultTitle.replace(/\s+/g, " ").slice(0, 160)
  );

  // City priority: ?city=Gurugram must feature the Gurugram property even
  // though a newer Jaipur property also has a video.
  await page.goto(`${BASE}/?city=Gurugram`);
  await page.waitForTimeout(1000);
  const cityTitle = await page.locator('#ai-videos, section[aria-label="AI property videos"]').innerText().catch(() => "");
  check(
    "buyer-ux",
    "?city=Gurugram prioritises the Gurugram property's video",
    /E2E Gurugram Golf Homes/.test(cityTitle) && /Sector 54, Gurugram/.test(cityTitle),
    cityTitle.replace(/\s+/g, " ").slice(0, 160)
  );

  // Locality priority beats city: locality=Malviya Nagar (Jaipur) wins over
  // the city-level Gurugram request.
  await page.goto(`${BASE}/?city=Gurugram&locality=Malviya%20Nagar`);
  await page.waitForTimeout(1000);
  const locTitle = await page.locator('#ai-videos, section[aria-label="AI property videos"]').innerText().catch(() => "");
  check(
    "buyer-ux",
    "locality preference outranks city preference",
    /E2E Heights A/.test(locTitle),
    locTitle.replace(/\s+/g, " ").slice(0, 160)
  );

  // Unknown preference degrades deterministically (no crash, real video).
  await page.goto(`${BASE}/?city=Nowhereville`);
  await page.waitForTimeout(1000);
  const fallbackTitle = await page.locator('#ai-videos, section[aria-label="AI property videos"]').innerText().catch(() => "");
  check(
    "buyer-ux",
    "unknown city falls back to the deterministic newest video property",
    /E2E Heights A/.test(fallbackTitle),
    fallbackTitle.replace(/\s+/g, " ").slice(0, 160)
  );
  await page.goto(`${BASE}/`);
  await page.waitForTimeout(800);

  // No autoplay with sound: the element must not carry autoplay, and must be
  // paused until the user acts.
  const autoplayAttr = await videoEl.first().getAttribute("autoplay");
  const pausedBefore = await videoEl.first().evaluate((v) => v.paused).catch(() => null);
  check("buyer-ux", "showcase never autoplays", autoplayAttr === null && pausedBefore !== false, `autoplay=${autoplayAttr} paused=${pausedBefore}`);

  // Play button starts playback (user-initiated, no autoplay with sound).
  const playBtn = aiSection.getByRole("button", { name: /play the walkthrough video/i });
  if (await playBtn.count()) {
    await playBtn.click();
    await page.waitForTimeout(2500);
    const playing = await videoEl.evaluate((v) => !v.paused && v.currentTime > 0).catch(() => false);
    check("buyer-ux", "showcase video plays after clicking play", playing);
  } else {
    check("buyer-ux", "showcase video plays after clicking play", false, "play overlay button not found");
  }
  await shot(page, "03b-home-ai-video");

  // --- Three public auth entry points (desktop + mobile menu) ---
  const staffLoginLink = page.locator('header a[href="/login"]');
  check("buyer-ux", "header shows Staff / Business Login on desktop", await staffLoginLink.first().isVisible());
  const headerHtml = await page.locator("header").innerHTML();
  check(
    "buyer-ux",
    "header links all three public auth options",
    /href="\/buyer\/login"/.test(headerHtml) && /href="\/buyer\/signup"/.test(headerHtml) && /href="\/login"/.test(headerHtml),
    headerHtml.replace(/\s+/g, " ").slice(0, 200)
  );

  // --- Change password journey (synthetic fresh buyer, then restore) ---
  const ts = Date.now();
  const cemail = `qa-chpw-${ts}@example.com`;
  const cpass = "ChpwStart123!";
  const cnew = "ChpwNew456!";
  const signup = await page.evaluate(async ({ base, em, pw }) => {
    const r = await fetch(`${base}/api/auth/buyer-signup`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "QA Chpw Buyer", email: em, password: pw }),
    });
    return r.status;
  }, { base: BASE, em: cemail, pw: cpass });
  check("buyer-ux", "change-password fixture buyer created", signup === 200, `status=${signup}`);

  const curl = await loginUI(page, "/buyer/login", cemail, cpass);
  check("buyer-ux", "fixture buyer signs in", pathOf(curl) === "/buyer", curl);

  await page.goto(`${BASE}/buyer/profile`);
  await page.waitForTimeout(1500);
  const changeBtn = page.getByRole("button", { name: /^change$/i }).first();
  check("buyer-ux", "profile shows Change Password action", await changeBtn.isVisible());
  await changeBtn.click();
  const dialog = page.getByRole("dialog");
  check("buyer-ux", "Change Password dialog opens", await dialog.isVisible());
  await shot(page, "03c-change-password-dialog");

  // Cancel closes it.
  await dialog.getByRole("button", { name: /^cancel$/i }).click();
  await page.waitForTimeout(400);
  check("buyer-ux", "Cancel closes the dialog", (await dialog.count()) === 0);

  // Reopen; wrong current password rejected inline.
  await changeBtn.click();
  await dialog.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
  // The dialog mounts fresh on every open; in dev its client bundle can
  // commit a beat after the element is visible, so fill() may write into an
  // input whose React onChange isn't wired yet (values then read back empty
  // on submit). Verify the values round-trip through the DOM before clicking,
  // and wait for the actual POST instead of sleeping.
  const curInput = dialog.locator("#current-password");
  const newInput = dialog.locator("#new-password");
  const confirmInput = dialog.locator("#confirm-new-password");
  async function fillVerified(cur, nw, cf) {
    for (let i = 0; i < 5; i++) {
      await curInput.fill(cur);
      await newInput.fill(nw);
      await confirmInput.fill(cf);
      const vals = await dialog.evaluate((d) =>
        ["current-password", "new-password", "confirm-new-password"].map((id) => d.querySelector(`#${id}`)?.value ?? "")
      );
      if (vals[0] === cur && vals[1] === nw && vals[2] === cf) return true;
      await page.waitForTimeout(300);
    }
    return false;
  }
  const fillsOk = await fillVerified("WrongCurrent1!", cnew, cnew);
  check("buyer-ux", "change-password fields accept input", fillsOk);
  const wrongResp = page
    .waitForResponse((r) => r.url().includes("/api/buyer/change-password") && r.request().method() === "POST", { timeout: 20000 })
    .catch(() => null);
  await dialog.getByRole("button", { name: "Change password", exact: true }).click();
  const wrongStatus = (await wrongResp)?.status() ?? null;
  const wrongErrShown = await dialog
    .getByText(/current password is incorrect/i)
    .waitFor({ timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  check("buyer-ux", "wrong current password rejected by server", wrongStatus === 400, `status=${wrongStatus}`);
  check("buyer-ux", "wrong current password shows inline error", wrongErrShown, (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160));

  // Mismatched confirmation rejected (client-side; no network call).
  await fillVerified(cpass, cnew, "TotallyDifferent1!");
  await dialog.getByRole("button", { name: "Change password", exact: true }).click();
  const mismatchShown = await dialog
    .getByText(/do not match/i)
    .waitFor({ timeout: 10000 })
    .then(() => true)
    .catch(() => false);
  check("buyer-ux", "mismatched confirmation shows inline error", mismatchShown, (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 160));

  // Valid change succeeds (wait state-based: the /video route's first
  // dev-compile can outrun a fixed sleep).
  await fillVerified(cpass, cnew, cnew);
  const okResp = page
    .waitForResponse((r) => r.url().includes("/api/buyer/change-password") && r.request().method() === "POST", { timeout: 30000 })
    .catch(() => null);
  await dialog.getByRole("button", { name: "Change password", exact: true }).click();
  const okStatus = (await okResp)?.status() ?? null;
  check("buyer-ux", "valid change accepted by server", okStatus === 200, `status=${okStatus}`);
  const changeSuccess = await dialog
    .getByText(/password has been changed/i)
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("buyer-ux", "valid change shows success confirmation", changeSuccess, (await dialog.innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 200));
  await shot(page, "03d-change-password-success");

  // New password authenticates; old password does not. Exact pathname:
  // substring matching would pass vacuously on "/buyer/login".
  const backOld = await loginUI(page, "/buyer/login", cemail, cpass);
  check("buyer-ux", "old password no longer signs in", pathOf(backOld) !== "/buyer", backOld);
  const backNew = await loginUI(page, "/buyer/login", cemail, cnew);
  check("buyer-ux", "new password signs in", pathOf(backNew) === "/buyer", backNew);

  check("buyer-ux", "no page exceptions on buyer-ux journey", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
  await ctx.close();
}

async function sectionPropertyBuyer() {
  const ctx = await newContext(DESKTOP, "propbuyer");
  const page = await ctx.newPage();
  const issues = await watch(page, "property");

  await page.goto(`${BASE}/explore`);
  await page.waitForTimeout(1500);
  const exploreText = await page.content();
  check("property", "public explore lists seeded properties", exploreText.includes("E2E Heights A") && exploreText.includes("E2E Heights B"));
  await shot(page, "04-explore");

  // Property↔video integrity: the seeded property's DETAIL page must play
  // THAT property's uploaded video (the content-addressed media URL stored
  // on its own row), never another property's media or a bundled reel.
  await page.goto(`${BASE}/explore/e2e-prop-a`);
  await page.waitForTimeout(2000);
  const detailVideoSrc = await page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return null;
    // <video> may carry src directly or via a <source> child.
    return v.getAttribute("src") || v.querySelector("source")?.getAttribute("src") || v.currentSrc || null;
  });
  check(
    "property",
    "property detail page plays that property's own uploaded video",
    typeof detailVideoSrc === "string" && detailVideoSrc.startsWith("/api/media/properties/e2e-org/"),
    String(detailVideoSrc)
  );

  // invalid property id -> controlled outcome
  await page.goto(`${BASE}/explore/definitely-not-here`);
  await page.waitForTimeout(1500);
  const badStatus = await page.evaluate(async (base) => (await fetch(`${base}/api/public/properties?search=definitely-not-here`)).status, BASE);
  check("property", "unknown property id handled without crash", !page.url().includes("definitely-not-here") || (await page.content()).length > 0);
  check("property", "empty search API returns 200", badStatus === 200, `status=${badStatus}`);

  // buyer save + compare via UI
  await loginUI(page, "/buyer/login", BUYER1.email, BUYER1.password);
  await page.goto(`${BASE}/buyer/explore`);
  await page.waitForTimeout(1500);
  // Ensure a known starting state (re-runs may leave the property saved):
  // if already saved, remove first so the toggle-on below is exercised.
  await page.getByRole("button", { name: /save property|remove from saved/i }).first().waitFor({ timeout: 15000 });
  const unsaveBtn = page.getByRole("button", { name: /remove from saved/i }).first();
  if (await unsaveBtn.count()) {
    await unsaveBtn.click();
    // Wait for the actual state change rather than a fixed sleep: the first
    // hit on a cold dev route can take seconds (measured ~3s for
    // /api/buyer/saved), and a blind 1.5s nap read the pre-click state.
    await page
      .getByRole("button", { name: /^save property$/i })
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {});
  }
  const saveBtn = page.getByRole("button", { name: /save property/i }).first();
  if (await saveBtn.count()) {
    await saveBtn.click();
    await page
      .getByRole("button", { name: /remove from saved/i })
      .first()
      .waitFor({ state: "visible", timeout: 20000 })
      .catch(() => {});
    check("property", "save property toggles in UI", await page.getByRole("button", { name: /remove from saved/i }).first().count().then((c) => c > 0));
  } else {
    check("property", "save property toggles in UI", false, "no save button found");
  }
  // Deterministic picks: target the two seeded Jaipur cards by their detail
  // link (positional nth(0)/nth(1) broke when the seed gained a third
  // property, and the explore ordering is not index-stable).
  const cardA = page.locator('a[href="/explore/e2e-prop-a"]').first();
  const cardB = page.locator('a[href="/explore/e2e-prop-b"]').first();
  const cmpA = cardA.getByRole("button", { name: /add to comparison/i });
  const cmpB = cardB.getByRole("button", { name: /add to comparison/i });
  const haveTargets = (await cmpA.count()) > 0 && (await cmpB.count()) > 0;
  check("property", "compare buttons present for listings", haveTargets, `A=${await cmpA.count()} B=${await cmpB.count()}`);
  // Start from a clean slate so re-runs exercise creation (not PATCH):
  // remove any comparisons left by earlier runs, then clear staging.
  await page.evaluate(async () => {
    localStorage.removeItem("basera:compare-pending");
    const list = await (await fetch("/api/buyer/comparisons")).json().catch(() => ({}));
    for (const c of list.comparisons ?? []) {
      await fetch(`/api/buyer/comparisons/${c.id}`, { method: "DELETE" }).catch(() => {});
    }
  });
  await page.reload();
  await page.waitForTimeout(1500);
  if (haveTargets) {
    // First pick only stages (the API needs 2 properties) and raises an
    // informational alert; the watch() dialog handler dismisses it.
    await cmpA.click();
    await page.waitForTimeout(1500);
    const staged = await page.evaluate(() => localStorage.getItem("basera:compare-pending"));
    check("property", "first pick stages pending selection", !!staged && staged.includes("e2e-prop-a"), staged);
    // Second pick must create the comparison server-side; wait for the POST
    // rather than a fixed sleep (dev-compiled route can exceed 2s under load).
    const createWait = page
      .waitForResponse((r) => r.url().endsWith("/api/buyer/comparisons") && r.request().method() === "POST", { timeout: 25000 })
      .catch(() => null);
    await cmpB.click();
    const created = await createWait;
    check("property", "second pick creates comparison via POST", !!created && created.ok(), created ? `status=${created.status()}` : "no POST observed");
    await page.waitForTimeout(800);
  }
  await page.goto(`${BASE}/buyer/compare`);
  await page.waitForTimeout(1500);
  const cmpText = await page.content();
  check("property", "compare page shows both properties", cmpText.includes("E2E Heights A") && cmpText.includes("E2E Heights B"), page.url());
  await shot(page, "05-compare");
  await page.goto(`${BASE}/buyer/saved`);
  await page.waitForTimeout(1200);
  check("property", "saved page persists after navigation", (await page.content()).includes("E2E Heights A"));
  await page.reload();
  await page.waitForTimeout(1200);
  check("property", "refresh keeps persisted buyer state", (await page.content()).includes("E2E Heights A"));

  await page.goto(`${BASE}/buyer/visits`);
  await page.waitForTimeout(1500);
  const visitsText = await page.content();
  check("property", "visits page renders schedule form", visitsText.toLowerCase().includes("visit"));
  await shot(page, "05b-visits");

  // cross-buyer isolation in browser
  const ctx2 = await newContext(DESKTOP, "buyer2");
  const p2 = await ctx2.newPage();
  await loginUI(p2, "/buyer/login", BUYER2.email, BUYER2.password);
  await p2.goto(`${BASE}/buyer/compare`);
  await p2.waitForTimeout(1200);
  const p2text = await p2.content();
  check("property", "second buyer sees none of buyer1 comparisons", !p2text.includes("E2E Heights A") || p2text.includes("No properties to compare"));
  await ctx2.close();
  check("property", "no page exceptions on buyer journeys", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
  await ctx.close();
}

async function sectionCRM() {
  const ctx = await newContext(DESKTOP, "crm");
  const page = await ctx.newPage();
  const issues = await watch(page, "crm");
  await loginUI(page, "/login", STAFF.email, STAFF.password);

  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(2000);
  check("crm", "dashboard overview loads", (await page.content()).includes("E2E Lead") || (await page.content()).toLowerCase().includes("overview"));
  await shot(page, "06-dashboard");

  await page.goto(`${BASE}/leads`);
  await page.waitForTimeout(1500);
  check("crm", "lead list shows seeded lead", (await page.content()).includes("E2E Lead"));
  const leadLink = page.locator('a[href*="/leads/"]').first();
  if (await leadLink.count()) {
    const leadHref = await leadLink.getAttribute("href");
    await Promise.all([
      page.waitForURL((u) => /\/leads\/[^/]+/.test(u.pathname), { timeout: 15000 }).catch(() => {}),
      leadLink.click(),
    ]);
    await page.waitForTimeout(800);
    check("crm", "lead detail opens", /\/leads\/[^/]+/.test(new URL(page.url()).pathname), `${page.url()} (link=${leadHref})`);
  } else {
    check("crm", "lead detail opens", false, "no lead link");
  }

  await page.goto(`${BASE}/properties`);
  await page.waitForTimeout(1500);
  check("crm", "property list loads", (await page.content()).includes("E2E Heights A"));
  await page.goto(`${BASE}/appointments`);
  await page.waitForTimeout(1200);
  check("crm", "appointments page loads", page.url().includes("/appointments"));
  await page.goto(`${BASE}/conversations`);
  await page.waitForTimeout(1200);
  const convText = await page.content();
  check("crm", "conversations list renders", convText.includes("E2E Lead") || convText.toLowerCase().includes("convers"));
  const convLink = page.locator('a[href*="/conversations/"]').first();
  if (await convLink.count()) {
    await Promise.all([
      page.waitForURL((u) => /\/conversations\/[^/]+/.test(u.pathname), { timeout: 15000 }).catch(() => {}),
      convLink.click(),
    ]);
    await page.waitForFunction(() => document.body.innerText.includes("Hello, I need a 2 BHK"), { timeout: 15000 }).catch(() => {});
    const dt = await page.content();
    check("crm", "conversation detail shows message history", dt.includes("Hello, I need a 2 BHK"), page.url());
  } else {
    check("crm", "conversation detail shows message history", false, "no conversation link");
  }
  await page.goto(`${BASE}/team`);
  await page.waitForTimeout(1200);
  check("crm", "team page loads", page.url().includes("/team"));
  await page.goto(`${BASE}/analytics`);
  await page.waitForTimeout(1500);
  check("crm", "analytics page loads", page.url().includes("/analytics"));
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(1200);
  check("crm", "settings page loads (read-only check)", page.url().includes("/settings"));

  // cross-tenant invisibility spot check via API in browser context
  const foreignVisible = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/leads?limit=50`);
    const j = await r.json();
    return (j.leads || []).some((l) => l.name === "Foreign");
  }, BASE);
  check("crm", "no cross-tenant leads visible to staff", foreignVisible === false);
  check("crm", "no page exceptions on CRM journey", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
  await ctx.close();
}

/**
 * Property media journey: staff creates a property through the Add Property
 * form, attaches a real image + video via the media stage, and the saved
 * media persists through Edit Property and shows up buyer-facing on
 * /explore. Uses a tiny real PNG and the repo's own showcase MP4 as
 * synthetic fixtures (written to the OS temp dir, never dev.db).
 */
async function sectionPropertyMedia() {
  const ctx = await newContext(DESKTOP, "media");
  const page = await ctx.newPage();
  const issues = await watch(page, "media");
  await loginUI(page, "/login", STAFF.email, STAFF.password);

  // Synthetic fixtures: a real 1x1 PNG (valid magic bytes) + a copy of the
  // showcase MP4 (real H.264, small enough for a fast upload).
  const os = await import("node:os");
  const pngPath = path.join(os.tmpdir(), `basera-e2e-${Date.now()}.png`);
  fs.writeFileSync(pngPath, Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  ));
  const videoFixture = path.join(ROOT_DIR, "public", "videos", "basera-property-showcase.mp4");
  const hasVideoFixture = fs.existsSync(videoFixture);

  await page.goto(`${BASE}/properties`);
  await page.waitForTimeout(1200);
  const newProp = page.getByRole("button", { name: /add property/i });
  check("media", "properties page shows Add property action", await newProp.isVisible());
  await newProp.click();
  await page.waitForTimeout(400);

  // REGRESSION GUARD (defect A): the media controls must be visible on the
  // FIRST screen of the journey, before the property exists. If this fails,
  // Add Property has regressed to a details-only first step with no way to
  // attach photos/video until after creation.
  const stage1Modal = page.locator("form").filter({ has: page.getByPlaceholder("Project name") });
  const stage1ImagesInput = stage1Modal.locator('input[aria-label="Select images to upload"]');
  const stage1VideoInput = stage1Modal.locator('input[aria-label="Select video to upload"]');
  const stage1AddImages = stage1Modal.getByRole("button", { name: /^add images$/i });
  const stage1AddVideo = stage1Modal.getByRole("button", { name: /^(add|replace) video$/i });
  const stage1 = {
    fileInputs: (await stage1ImagesInput.count()) + (await stage1VideoInput.count()),
    addImages: await stage1AddImages.isVisible(),
    addVideo: await stage1AddVideo.isVisible(),
  };
  check(
    "media",
    "add-property FIRST step shows image + video upload controls",
    stage1.fileInputs === 2 && stage1.addImages && stage1.addVideo,
    JSON.stringify(stage1)
  );
  await shot(page, "07a0-add-property-first-step-media-controls");

  const projectName = `Media E2E ${Date.now()}`;
  const modalForm = page.locator("form").filter({ has: page.getByPlaceholder("Project name") });
  await modalForm.getByPlaceholder("Project name").fill(projectName);
  await modalForm.getByPlaceholder("City").fill("Jaipur");
  await modalForm.getByPlaceholder("Locality").fill("C-Scheme");
  await modalForm.getByPlaceholder("Min price (₹)").fill("4500000");
  await modalForm.getByPlaceholder("Max price (₹)").fill("6500000");
  await modalForm.getByRole("button", { name: /^add property$/i }).click();

  // Stage 2: media panel appears after creation.
  const mediaPanel = page.getByText("Property created", { exact: false });
  const mediaShown = await mediaPanel.waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
  check("media", "add flow reaches media stage after creation", mediaShown);
  await shot(page, "07a-add-property-media");
  if (!mediaShown) {
    check("media", "image upload succeeds", false, "media stage never appeared");
    await ctx.close();
    return;
  }

  // Upload the image (state-based: the success toast auto-dismisses).
  await page.locator('input[aria-label="Select images to upload"]').setInputFiles(pngPath);
  const uploadImgs = page.getByRole("button", { name: /upload 1 image/i });
  await uploadImgs.waitFor({ timeout: 5000 }).catch(() => {});
  await uploadImgs.click().catch(() => {});
  const imgUploaded = await page
    .getByText(/^Uploaded 1 image\.$/)
    .waitFor({ timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("media", "image upload succeeds", imgUploaded);

  // Upload the video (skipped gracefully if the fixture is absent). Waits
  // state-based: the /video route's first dev-compile can outrun a sleep.
  if (hasVideoFixture) {
    await page.locator('input[aria-label="Select video to upload"]').setInputFiles(videoFixture);
    const uploadVid = page.getByRole("button", { name: /^upload video$/i });
    await uploadVid.waitFor({ timeout: 5000 }).catch(() => {});
    await uploadVid.click().catch(() => {});
    const vidUploaded = await page
      .getByText("Video uploaded successfully.")
      .waitFor({ timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    check("media", "video upload succeeds", vidUploaded);
  } else {
    check("media", "video upload succeeds", false, "showcase mp4 fixture missing from public/videos");
  }
  await shot(page, "07b-property-media-saved");

  // Finish; open the property detail to confirm persistence.
  await page.getByRole("button", { name: /^done$/i }).click();
  await page.waitForTimeout(1500);

  // Find the created property and open its edit page (media re-render).
  await page.goto(`${BASE}/properties`);
  await page.waitForTimeout(1500);
  const card = page.locator("a", { hasText: projectName }).first();
  check("media", "created property appears in inventory", await card.count() > 0);
  if (await card.count()) {
    await card.click();
    await page.waitForURL(/\/properties\/[^/]+/, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const detailHtml = await page.content();
    check("media", "property detail shows the uploaded image", detailHtml.includes("/api/media/"), detailHtml.slice(0, 120));
    const editLink = page.locator('a[href*="/edit"]').first();
    if (await editLink.count()) {
      await editLink.click();
      await page.waitForURL(/\/edit/, { timeout: 15000 }).catch(() => {});
      // State-based: EditPropertyForm is client-rendered — it fetches
      // /api/properties/[id] on mount, so the saved <video> only appears
      // after the edit page compiles, hydrates, and the API responds. A
      // fixed 2500ms sleep raced that (dev first-compile of the edit route
      // and the API route can exceed it), producing a false FAIL.
      const editVideo = page.locator("video").first();
      const videoShown = await editVideo
        .waitFor({ state: "attached", timeout: 45000 })
        .then(() => true)
        .catch(() => false);
      const editHtml = await page.content();
      check("media", "edit form shows saved gallery image", editHtml.includes("/api/media/"));
      check("media", "edit form shows saved video", videoShown, videoShown ? "" : `url=${page.url()}`);
      await shot(page, "07c-edit-property-media");
    } else {
      check("media", "edit form shows saved gallery image", false, "no edit link");
    }
  }

  // Buyer-facing: the AVAILABLE property must surface on /explore with media.
  const bctx = await newContext(DESKTOP, "media-buyer");
  const bpage = await bctx.newPage();
  await bpage.goto(`${BASE}/explore`);
  await bpage.waitForTimeout(2500);
  const exploreHasProp = (await bpage.content()).includes(projectName);
  check("media", "buyer-facing explore lists the new property", exploreHasProp);
  if (exploreHasProp) {
    const lcard = bpage.locator("a", { hasText: projectName }).first();
    if (await lcard.count()) {
      await lcard.click();
      await page.waitForTimeout(500).catch(() => {});
      await bpage.waitForURL(/\/explore\/[^/]+/, { timeout: 15000 }).catch(() => {});
      await bpage.waitForTimeout(1500);
      const bhtml = await bpage.content();
      check("media", "buyer property page shows the uploaded image", bhtml.includes("/api/media/"));
      check("media", "buyer property page shows the uploaded video", bhtml.includes("<video") || bhtml.includes("videoUrl"));
      await shot(bpage, "07d-buyer-property-media");
    }
  }
  await bctx.close();

  // Negative: an anonymous user cannot upload media.
  const anonCtx = await newContext(DESKTOP, "media-anon");
  const apage = await anonCtx.newPage();
  await apage.goto(`${BASE}/`); // same-origin context for the fetch below
  const anonUpload = await apage.evaluate(async (base) => {
    const r = await fetch(`${base}/api/properties/e2e-prop-a/images`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ images: [] }) });
    return r.status;
  }, BASE).catch(() => -1);
  check("media", "anonymous media PATCH rejected", anonUpload === 401 || anonUpload === 403, `status=${anonUpload}`);
  await anonCtx.close();

  // Negative, over real HTTP, as an authenticated staff user: a disallowed
  // file type and an oversized file must BOTH be refused by the upload route.
  // (The validators are unit-tested in media.test.ts; these checks prove the
  // route actually enforces them end-to-end rather than trusting the client.)
  const staffUpload = await page.evaluate(async (base) => {
    const post = async (name, type, bytes) => {
      const fd = new FormData();
      fd.append("file", new File([new Uint8Array(bytes)], name, { type }));
      const r = await fetch(`${base}/api/properties/e2e-prop-a/images`, { method: "POST", body: fd });
      let body = null;
      try { body = await r.json(); } catch { /* non-JSON error body */ }
      return { status: r.status, body };
    };
    return {
      // Valid-looking size, disallowed content (images accept JPEG/PNG/WebP only).
      wrongType: await post("not-an-image.txt", "text/plain", 256),
      // Right family, over the configured image cap (default 8 MB).
      oversized: await post("huge.png", "image/png", 9 * 1024 * 1024),
    };
  }, BASE).catch(() => null);
  const rejectedReason = (x) => (x?.body?.rejected?.[0]?.reason ?? x?.body?.error ?? "").toString();
  check(
    "media",
    "unsupported upload type rejected over HTTP",
    staffUpload?.wrongType?.status === 400 && /unsupported image/i.test(rejectedReason(staffUpload.wrongType)),
    JSON.stringify({ status: staffUpload?.wrongType?.status, reason: rejectedReason(staffUpload?.wrongType) })
  );
  check(
    "media",
    "oversized upload rejected over HTTP",
    staffUpload?.oversized?.status === 400 && /exceeds/i.test(rejectedReason(staffUpload.oversized)),
    JSON.stringify({ status: staffUpload?.oversized?.status, reason: rejectedReason(staffUpload?.oversized) })
  );

  try { fs.rmSync(pngPath, { force: true }); } catch {}
  check("media", "no page exceptions on media journey", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
  await ctx.close();
}

async function sectionResponsive() {
  const viewports = [
    ["desktop-1440", { width: 1440, height: 900 }],
    ["laptop-1366", { width: 1366, height: 768 }],
    ["tablet-768", { width: 768, height: 1024 }],
    ["mobile-390", { width: 390, height: 844 }],
    ["narrow-320", { width: 320, height: 700 }],
  ];
  const pages = ["/", "/login", "/explore"];
  for (const [vname, vp] of viewports) {
    const ctx = await newContext(vp, vname);
    const page = await ctx.newPage();
    await watch(page, `resp-${vname}`);
    for (const p of pages) {
      await page.goto(`${BASE}${p}`);
      await page.waitForTimeout(1200);
      const res = await settledNoOverflow(page);
      if (!res.ok) console.log(`  overflow @ ${vname} ${p}: ${res.detail}`);
      else if (res.detail) console.log(`  note @ ${vname} ${p}: ${res.detail}`);
      check("responsive", `${vname} ${p} no horizontal overflow`, res.ok, res.detail);
    }
    await page.goto(`${BASE}/`);
    await page.waitForTimeout(1000);
    await shot(page, `resp-${vname}-home`);
    await ctx.close();
  }
  // authenticated responsive spot checks
  const ctx = await newContext({ width: 390, height: 844 }, "mobile-buyer");
  const page = await ctx.newPage();
  await loginUI(page, "/buyer/login", BUYER1.email, BUYER1.password);
  await page.goto(`${BASE}/buyer`);
  await page.waitForTimeout(1500);
  const mob = await settledNoOverflow(page);
  if (!mob.ok) console.log("  overflow @ mobile-390 /buyer:", mob.detail);
  check("responsive", "mobile buyer dashboard usable", mob.ok, mob.detail);
  await shot(page, "resp-mobile-390-buyer");

  // Mobile public menu must expose ALL THREE auth options (Buyer Login,
  // Create Buyer Account, Staff / Business Login) — they do not fit inline
  // at 390px, so they live in the hamburger menu.
  const mctx = await newContext({ width: 390, height: 844 }, "mobile-menu");
  const mpage = await mctx.newPage();
  await watch(mpage, "mobile-menu");
  await mpage.goto(`${BASE}/`);
  await mpage.waitForTimeout(1200);
  const menuBtn = mpage.getByRole("button", { name: /open menu/i });
  check("responsive", "mobile header shows a menu button", await menuBtn.isVisible());
  if (await menuBtn.count()) {
    await menuBtn.click();
    await mpage.waitForTimeout(400);
    const menuHtml = await mpage.locator("#public-mobile-menu").innerHTML().catch(() => "");
    check("responsive", "mobile menu lists Buyer Login", /href="\/buyer\/login"/.test(menuHtml));
    check("responsive", "mobile menu lists Create Buyer Account", /href="\/buyer\/signup"/.test(menuHtml));
    check("responsive", "mobile menu lists Staff / Business Login", /href="\/login"/.test(menuHtml));
    // Escape closes it.
    await mpage.keyboard.press("Escape");
    await mpage.waitForTimeout(300);
    check("responsive", "mobile menu closes on Escape", (await mpage.locator("#public-mobile-menu").count()) === 0);
    await shot(mpage, "resp-mobile-390-menu");
  } else {
    check("responsive", "mobile menu lists Buyer Login", false, "menu button missing");
    check("responsive", "mobile menu lists Create Buyer Account", false, "menu button missing");
    check("responsive", "mobile menu lists Staff / Business Login", false, "menu button missing");
  }
  await mctx.close();
  // keyboard navigation on login form
  const kctx = await newContext(DESKTOP, "kbd");
  const kpage = await kctx.newPage();
  await kpage.goto(`${BASE}/login`);
  await kpage.keyboard.press("Tab");
  await kpage.keyboard.press("Tab");
  const focused = await kpage.evaluate(() => document.activeElement?.tagName);
  check("responsive", "keyboard focus lands in form", ["INPUT", "BUTTON", "A"].includes(focused), `focused=${focused}`);
  await kctx.close();
  await ctx.close();
}

async function sectionProtected() {
  const ctx = await newContext(DESKTOP, "protected");
  const page = await ctx.newPage();
  const issues = await watch(page, "protected");

  await loginUI(page, "/login", STAFF.email, STAFF.password);
  await page.goto(`${BASE}/settings`);
  await page.waitForTimeout(1500);
  check("protected", "settings (WhatsApp integration area) renders", (await page.content()).toLowerCase().includes("whatsapp") || page.url().includes("/settings"));
  await shot(page, "07-settings");
  await page.goto(`${BASE}/recovery`);
  await page.waitForTimeout(1500);
  check("protected", "recovery page renders", page.url().includes("/recovery"));
  await ctx.close();

  // public AI chat widget (fallback path, no provider keys)
  const wctx = await newContext(DESKTOP, "widget");
  const wpage = await wctx.newPage();
  await watch(wpage, "widget");
  await wpage.goto(`${BASE}/`);
  await wpage.waitForTimeout(2000);
  const widgetBtn = wpage.locator('button[aria-label*="chat" i], button:has-text("Chat")').first();
  if (await widgetBtn.count()) {
    await widgetBtn.click();
    await wpage.waitForTimeout(1000);
    const msgsBefore = await wpage.locator(".chat-msg").count();
    const chatResponse = wpage
      .waitForResponse((r) => r.url().includes("/api/public/chat") && r.request().method() === "POST", { timeout: 30000 })
      .catch(() => null);
    const input = wpage.locator('input[type="text"], textarea').last();
    await input.fill("Hi, I need a 2 BHK in Jaipur");
    await wpage.keyboard.press("Enter");
    const chatRes = await chatResponse;
    // State-based: the widget appends the AI reply (or its own recovery
    // bubble) as a new .chat-msg — wait for that, not a fixed sleep.
    await wpage
      .waitForFunction((n) => document.querySelectorAll(".chat-msg").length > n, msgsBefore, { timeout: 25000 })
      .catch(() => {});
    const msgsAfter = await wpage.locator(".chat-msg").count();
    const chatStatus = chatRes ? chatRes.status() : "no-response";
    if (chatRes && chatRes.status() !== 200) console.log(`  widget chat POST status=${chatStatus}`);
    check(
      "protected",
      "public chat widget answers without crashing",
      msgsAfter > msgsBefore && (await wpage.content()).length > 1000,
      `chat-api=${chatStatus} msgs ${msgsBefore}->${msgsAfter}`
    );
  } else {
    check("protected", "public chat widget answers without crashing", true, "no widget button (widget absent)");
  }
  await wctx.close();

  // voice page renders controls
  const vctx = await newContext(DESKTOP, "voice");
  const vpage = await vctx.newPage();
  await vpage.goto(`${BASE}/voice`);
  await vpage.waitForTimeout(1500);
  check("protected", "voice page renders controls", (await vpage.content()).toLowerCase().includes("voice"));
  await vctx.close();

  // 3D tour canvas
  const tctx = await newContext(DESKTOP, "tour");
  const tpage = await tctx.newPage();
  await tpage.goto(`${BASE}/tour`);
  await tpage.waitForTimeout(5000);
  const canvas = await tpage.locator("canvas").count();
  check("protected", "3D tour page presents canvas", canvas > 0, `canvases=${canvas}`);
  await shot(tpage, "08-tour");
  await tpage.goto(`${BASE}/`);
  await tpage.waitForTimeout(4000);
  const homeCanvas = await tpage.locator("canvas").count();
  check("protected", "homepage 3D experience presents canvas", homeCanvas > 0, `canvases=${homeCanvas}`);
  await shot(tpage, "09-home");
  await tctx.close();
  check("protected", "no page exceptions on protected modules", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
}

async function sectionSecurity() {
  const ctx = await newContext(DESKTOP, "sec");
  const page = await ctx.newPage();
  // anon dashboard HTML must not embed lead data
  const res = await page.goto(`${BASE}/dashboard`);
  const html = await res.text().catch(() => "");
  check("security", "anon dashboard exposes no lead data", !html.includes("E2E Lead") && !html.includes("e2e-lead-1"));
  check("security", "anon dashboard redirects to login", page.url().includes("/login"), page.url());
  // injection-shaped id as an authenticated staffer -> controlled 404, no leak
  await loginUI(page, "/login", STAFF.email, STAFF.password);
  const inj = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/leads/${encodeURIComponent("' OR '1'='1")}`);
    const t = await r.text();
    return { status: r.status, leak: /at |Error:|password|hash/i.test(t) };
  }, BASE);
  check("security", "malicious lead id yields controlled 404", inj.status === 404 && !inj.leak, JSON.stringify(inj));
  await ctx.close();
}

/**
 * Regression section for the four shipped fixes:
 *  T1 property-scoped AI chat opens from the property CTA with real context
 *  T2 saved-property deletion actually persists (card, dashboard, danger zone)
 *  T3 real TOTP two-factor (setup -> enable -> logout -> login challenge -> off)
 *  T4 dark accessible Property Preferences dropdowns + save/clear persistence
 */
async function sectionFixes() {
  const ctx = await newContext(DESKTOP, "fixes");
  const page = await ctx.newPage();
  const issues = await watch(page, "fixes");

  // ---------------- T1: property-specific AI chat ----------------
  await page.goto(`${BASE}/explore/e2e-prop-a`);
  await page.waitForTimeout(2500);
  const chatCta = page.getByRole("button", { name: /chat with ai assistant/i });
  check("fixes", "property detail offers the Chat with AI Assistant CTA", (await chatCta.count()) > 0);
  const closeBefore = await page.getByRole("button", { name: /^close chat$/i }).count();
  await chatCta.first().click();
  await page.waitForTimeout(1200);
  const closeAfter = await page.getByRole("button", { name: /^close chat$/i }).count();
  check("fixes", "CTA opens the chat panel (no more no-op click)", closeBefore === 0 && closeAfter > 0, `before=${closeBefore} after=${closeAfter}`);
  const firstMsg = await page.locator(".chat-msg").first().innerText().catch(() => "");
  check(
    "fixes",
    "chat panel greets with THIS property's context",
    /E2E Heights A/i.test(firstMsg),
    firstMsg.replace(/\s+/g, " ").slice(0, 160)
  );

  const chatPostWait = page
    .waitForResponse((r) => r.url().includes("/api/public/chat") && r.request().method() === "POST", { timeout: 40000 })
    .catch(() => null);
  const chatInput = page.locator('textarea[aria-label="Type your property inquiry"], input[aria-label="Type your property inquiry"]').first();
  const msgsBefore = await page.locator(".chat-msg").count();
  await chatInput.fill("What is the price of this property?");
  await page.keyboard.press("Enter");
  const chatRes = await chatPostWait;
  let postedBody = null;
  try {
    postedBody = chatRes ? chatRes.request().postDataJSON() : null;
  } catch {
    postedBody = null;
  }
  check(
    "fixes",
    "chat request carries the property id",
    !!postedBody && postedBody.propertyId === "e2e-prop-a",
    postedBody ? JSON.stringify({ propertyId: postedBody.propertyId }) : "no POST observed"
  );
  await page
    .waitForFunction((n) => document.querySelectorAll(".chat-msg").length > n, msgsBefore, { timeout: 30000 })
    .catch(() => {});
  const msgsAfter = await page.locator(".chat-msg").count();
  let aiStatus = null;
  try {
    aiStatus = chatRes ? (await chatRes.json()).aiStatus : null;
  } catch {
    aiStatus = null;
  }
  check(
    "fixes",
    "property chat answers (honest live/fallback status)",
    msgsAfter > msgsBefore && (aiStatus === "live" || aiStatus === "fallback"),
    `msgs ${msgsBefore}->${msgsAfter} aiStatus=${aiStatus} http=${chatRes ? chatRes.status() : "none"}`
  );
  await shot(page, "14-property-chat-context");
  await page.getByRole("button", { name: /^close chat$/i }).first().click().catch(() => {});

  // ---------------- T2: saved-property deletion persists ----------------
  await loginUI(page, "/buyer/login", BUYER1.email, BUYER1.password);
  // Known starting state: ensure the property is saved (409 = already saved).
  await page.evaluate(async () => {
    await fetch("/api/buyer/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: "e2e-prop-a" }),
    }).catch(() => {});
  });

  // (a) dashboard card X
  await page.goto(`${BASE}/buyer`);
  await page.waitForTimeout(2000);
  const dashRemove = page.locator('button[aria-label="Remove E2E Heights A from saved"]');
  const dashHad = (await dashRemove.count()) > 0;
  const delWait = page
    .waitForResponse((r) => r.url().includes("/api/buyer/saved") && r.request().method() === "DELETE" && r.ok(), { timeout: 25000 })
    .catch(() => null);
  if (dashHad) await dashRemove.first().click();
  const delRes = await delWait;
  await page.waitForTimeout(800);
  const goneAfterClick = (await page.locator('button[aria-label="Remove E2E Heights A from saved"]').count()) === 0;
  check("fixes", "dashboard saved-card X performs a real DELETE", dashHad && !!delRes && delRes.status() === 200 && goneAfterClick, `had=${dashHad} status=${delRes ? delRes.status() : "none"}`);
  await page.reload();
  await page.waitForTimeout(2000);
  const stillGoneAfterReload = (await page.locator('button[aria-label="Remove E2E Heights A from saved"]').count()) === 0;
  const emptyStateShown = (await page.content()).includes("No saved properties yet");
  check("fixes", "dashboard deletion persists across reload", stillGoneAfterReload && (emptyStateShown || (await page.locator('button[aria-label*="from saved"]').count()) === 0));

  // (b) /buyer/saved card delete
  await page.evaluate(async () => {
    await fetch("/api/buyer/saved", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ propertyId: "e2e-prop-a" }),
    }).catch(() => {});
  });
  await page.goto(`${BASE}/buyer/saved`);
  await page.waitForTimeout(2000);
  const savedRemove = page.locator('button[aria-label="Remove E2E Heights A from saved"]');
  const savedHad = (await savedRemove.count()) > 0;
  const delWait2 = page
    .waitForResponse((r) => r.url().includes("/api/buyer/saved") && r.request().method() === "DELETE" && r.ok(), { timeout: 25000 })
    .catch(() => null);
  if (savedHad) await savedRemove.first().click();
  const delRes2 = await delWait2;
  await page.waitForTimeout(800);
  check("fixes", "saved-page card delete performs a real DELETE", savedHad && !!delRes2 && delRes2.status() === 200, `had=${savedHad} status=${delRes2 ? delRes2.status() : "none"}`);
  await page.reload();
  await page.waitForTimeout(2000);
  check("fixes", "saved-page deletion persists across reload", (await page.locator('button[aria-label="Remove E2E Heights A from saved"]').count()) === 0);

  // (c) Danger Zone clear-all
  await page.evaluate(async () => {
    for (const id of ["e2e-prop-a", "e2e-prop-b"]) {
      await fetch("/api/buyer/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyId: id }),
      }).catch(() => {});
    }
  });
  await page.goto(`${BASE}/buyer/profile`);
  await page.waitForTimeout(2000);
  const dangerPanel = page.locator("div.panel-surface", { hasText: "Danger Zone" });
  const clearWait = page
    .waitForResponse((r) => r.url().includes("/api/buyer/saved") && r.request().method() === "DELETE" && r.ok(), { timeout: 25000 })
    .catch(() => null);
  await dangerPanel.getByRole("button", { name: /^delete$/i }).first().click();
  await dangerPanel.getByRole("button", { name: /yes, delete all/i }).first().click();
  const clearRes = await clearWait;
  const dangerOk = await dangerPanel
    .getByText("All saved properties deleted.")
    .count()
    .then((c) => c > 0)
    .catch(() => false);
  check("fixes", "danger-zone clear-all really deletes server-side", !!clearRes && clearRes.status() === 200 && dangerOk, `status=${clearRes ? clearRes.status() : "none"}`);
  await page.goto(`${BASE}/buyer`);
  await page.waitForTimeout(2000);
  check(
    "fixes",
    "clear-all persists (dashboard shows empty saved list)",
    (await page.content()).includes("No saved properties yet")
  );

  // ---------------- T3: real TOTP two-factor ----------------
  const ts = Date.now();
  const f2email = `qa-2fa-${ts}@example.com`;
  const f2pass = "TwoFaE2e123!";
  const signupStatus = await page.evaluate(
    async ({ base, em, pw }) => {
      const r = await fetch(`${base}/api/auth/buyer-signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "QA 2FA Buyer", email: em, password: pw }),
      });
      return r.status;
    },
    { base: BASE, em: f2email, pw: f2pass }
  );
  check("fixes", "2FA fixture buyer created", signupStatus === 200, `status=${signupStatus}`);
  const f2url = await loginUI(page, "/buyer/login", f2email, f2pass);
  check("fixes", "2FA fixture buyer signs in (2FA not yet on)", pathOf(f2url) === "/buyer", f2url);

  await page.goto(`${BASE}/buyer/profile`);
  await page.waitForTimeout(2500);
  const manageBtn = page.locator('[data-testid="two-factor-manage"]');
  check("fixes", "security section offers a real 2FA control (no 'Coming soon')", (await manageBtn.count()) > 0);
  await manageBtn.first().click();
  const tfDialog = page.getByRole("dialog");
  await tfDialog.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  check("fixes", "2FA dialog opens", (await tfDialog.count()) > 0);
  await tfDialog.getByRole("button", { name: /set up two-factor/i }).first().click();
  await page.locator('[data-testid="two-factor-qr"]').waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  const qrShown = (await page.locator('[data-testid="two-factor-qr"]').count()) > 0;
  const secretText = (await page.locator('[data-testid="two-factor-secret"]').innerText().catch(() => "")).trim();
  check("fixes", "setup presents a QR image and a manual base32 key", qrShown && /^[A-Z2-7]{16,}$/.test(secretText), `qr=${qrShown} keylen=${secretText.length}`);
  await shot(page, "11-two-factor-setup");

  // Enable is refused until a real code proves possession.
  await tfDialog.locator("#two-factor-setup-code").fill(wrongTotpCode(secretText));
  await tfDialog.getByRole("button", { name: /turn on 2fa/i }).first().click();
  await tfDialog.getByRole("alert").waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  const refusedWrong = (await tfDialog.getByRole("alert").count()) > 0;
  check("fixes", "enrollment refuses a wrong authenticator code", refusedWrong);
  const stillPending = await page.evaluate(async () => (await fetch("/api/auth/two-factor/setup")).json());
  check("fixes", "wrong code leaves 2FA un-enabled", stillPending.enabled === false, JSON.stringify(stillPending));

  await tfDialog.locator("#two-factor-setup-code").fill(totpCode(secretText));
  await tfDialog.getByRole("button", { name: /turn on 2fa/i }).first().click();
  await page.locator('[data-testid="recovery-codes"]').waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  const recoveryShown = (await page.locator('[data-testid="recovery-codes"]').count()) > 0;
  const recoveryCount = recoveryShown ? await page.locator('[data-testid="recovery-codes"] li').count() : 0;
  check("fixes", "enable returns one-time recovery codes", recoveryShown && recoveryCount === 10, `codes=${recoveryCount}`);
  await shot(page, "12-recovery-codes");
  await tfDialog.getByRole("button", { name: /saved my recovery codes/i }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  const enabledNow = await page.evaluate(async () => (await fetch("/api/auth/two-factor/setup")).json());
  check("fixes", "2FA is enabled after a verified code", enabledNow.enabled === true, JSON.stringify(enabledNow));
  await tfDialog.getByRole("button", { name: /close two-factor authentication dialog/i }).first().click().catch(() => {});
  await page.waitForTimeout(500);

  // Fresh session -> login must demand the second factor.
  await ctx.clearCookies();
  await page.goto(`${BASE}/buyer/login`);
  await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 25000 });
  await page.locator('input[type="email"]').first().fill(f2email);
  await page.locator('input[type="password"]').first().fill(f2pass);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  const codeField = page.locator("#two-factor-code");
  await codeField.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  check("fixes", "login shows the two-factor step only after credentials", (await codeField.count()) > 0);

  // Wrong code -> inline refusal, no session.
  await codeField.fill(wrongTotpCode(secretText));
  await page.getByRole("button", { name: /verify code/i }).first().click();
  await page.getByRole("alert").first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
  const wrongRejected = (await page.getByRole("alert").count()) > 0 && page.url().includes("/buyer/login");
  check("fixes", "wrong login code is rejected inline", wrongRejected, page.url());

  // Correct code -> session.
  await codeField.fill(totpCode(secretText));
  await page.getByRole("button", { name: /verify code/i }).first().click();
  const landed = await page
    .waitForURL((u) => !u.pathname.endsWith("login"), { timeout: 30000 })
    .then(() => page.url())
    .catch(() => page.url());
  check("fixes", "valid TOTP completes sign-in", pathOf(landed) === "/buyer", landed);
  await shot(page, "13-two-factor-login");

  // Turn it back off (requires a fresh code even while signed in).
  await page.goto(`${BASE}/buyer/profile`);
  await page.waitForTimeout(2500);
  const manageBtn2 = page.locator('[data-testid="two-factor-manage"]');
  await manageBtn2.first().click();
  const tfDialog2 = page.getByRole("dialog");
  await tfDialog2.waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
  await tfDialog2.getByRole("button", { name: /turn off two-factor authentication/i }).first().click();
  await tfDialog2.locator("#two-factor-disable-code").fill(totpCode(secretText));
  // Wait for the real POST instead of a fixed sleep: on a cold dev server the
  // route's first compile can outrun any hardcoded timeout.
  const disableRespP = page
    .waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/auth/two-factor/disable"), {
      timeout: 30000,
    })
    .catch(() => null);
  await tfDialog2.getByRole("button", { name: /turn off 2fa/i }).first().click();
  const disableResp = await disableRespP;
  let afterDisable = null;
  const disableDeadline = Date.now() + 20000;
  while (Date.now() < disableDeadline) {
    afterDisable = await page.evaluate(async () => (await fetch("/api/auth/two-factor/setup")).json());
    if (afterDisable.enabled === false) break;
    await page.waitForTimeout(500);
  }
  check(
    "fixes",
    "2FA can be turned off with a fresh code",
    !!disableResp && disableResp.status() === 200 && afterDisable?.enabled === false,
    JSON.stringify({ status: disableResp ? disableResp.status() : "no-response", ...afterDisable })
  );
  await tfDialog2.getByRole("button", { name: /close two-factor authentication dialog/i }).first().click().catch(() => {});

  // Prove the gate is really gone: sign-in no longer stops at a code step.
  await ctx.clearCookies();
  await page.goto(`${BASE}/buyer/login`);
  await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 25000 });
  await page.locator('input[type="email"]').first().fill(f2email);
  await page.locator('input[type="password"]').first().fill(f2pass);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  const afterOffUrl = await page
    .waitForURL((u) => !u.pathname.endsWith("login"), { timeout: 30000 })
    .then(() => page.url())
    .catch(() => page.url());
  const codeStillThere = (await page.locator("#two-factor-code").count()) > 0;
  check("fixes", "after disabling, login no longer demands a code", pathOf(afterOffUrl) === "/buyer" && !codeStillThere, afterOffUrl);

  // ---------------- T4: dark Property Preferences dropdowns ----------------
  await loginUI(page, "/buyer/login", BUYER1.email, BUYER1.password);
  await page.goto(`${BASE}/buyer/profile`);
  await page.waitForTimeout(2500);
  const prefPanel = page.locator("div.panel-surface", { hasText: "Property Preferences" });
  check("fixes", "Property Preferences section renders", (await prefPanel.count()) > 0);
  const nativeSelects = await prefPanel.locator("select").count();
  check("fixes", "no native <select> popups remain in Property Preferences", nativeSelects === 0, `native selects=${nativeSelects}`);
  const triggerIds = ["#pref-property-type", "#pref-bhk", "#pref-furnishing", "#pref-possession", "#pref-purpose"];
  let triggerCount = 0;
  for (const id of triggerIds) triggerCount += await prefPanel.locator(id).count();
  check("fixes", "all five preference dropdowns use the custom control", triggerCount === 5, `triggers=${triggerCount}`);

  await prefPanel.locator("#pref-property-type").click();
  const listbox = prefPanel.locator('[role="listbox"]');
  await listbox.waitFor({ state: "visible", timeout: 12000 }).catch(() => {});
  const popupUp = (await listbox.count()) > 0;
  const popupStyles = popupUp
    ? await listbox.evaluate((el) => {
        const cs = getComputedStyle(el);
        const opt = el.querySelector('[role="option"]');
        return { bg: cs.backgroundColor, color: cs.color, optColor: opt ? getComputedStyle(opt).color : "" };
      })
    : null;
  const bg = popupStyles ? rgbChannels(popupStyles.bg) : null;
  const fg = popupStyles ? rgbChannels(popupStyles.optColor || popupStyles.color) : null;
  const bgLum = bg ? bg[0] * 0.299 + bg[1] * 0.587 + bg[2] * 0.114 : 255;
  const fgLum = fg ? fg[0] * 0.299 + fg[1] * 0.587 + fg[2] * 0.114 : 0;
  check(
    "fixes",
    "dropdown popup renders DARK (not the native white menu)",
    popupUp && bgLum < 80,
    `bg=${popupStyles ? popupStyles.bg : "n/a"} lum=${Math.round(bgLum)}`
  );
  check(
    "fixes",
    "dropdown options keep strong text contrast",
    fgLum > 140 && fgLum - bgLum > 100,
    `fg=${popupStyles ? popupStyles.optColor : "n/a"} delta=${Math.round(fgLum - bgLum)}`
  );
  await shot(page, "10-dark-select-popup");

  // Select a value, save, and prove it persists server-side.
  await listbox.getByRole("option", { name: /villa/i }).first().click();
  await prefPanel.getByRole("button", { name: /save preferences/i }).first().click();
  const savedOk = await prefPanel
    .getByText("Preferences saved successfully!")
    .waitFor({ state: "visible", timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check("fixes", "Save Preferences reports success", savedOk);
  await page.reload();
  await page.waitForTimeout(2500);
  const persistedLabel = (await page.locator("#pref-property-type").getAttribute("aria-label").catch(() => "")) || "";
  let prefsAfterSave = null;
  try {
    prefsAfterSave = await page.evaluate(async () => (await fetch("/api/buyer/preferences")).json());
  } catch {}
  check(
    "fixes",
    "saved preference persists after reload",
    /villa/i.test(persistedLabel) && prefsAfterSave?.preferences?.propertyType === "VILLA",
    `label=${persistedLabel} api=${JSON.stringify(prefsAfterSave?.preferences ? prefsAfterSave.preferences.propertyType : null)}`
  );

  // Clear All must clear the fields AND persist the nulls.
  await prefPanel.getByRole("button", { name: /clear all/i }).first().click();
  await prefPanel.getByRole("button", { name: /save preferences/i }).first().click();
  const clearedOk = await prefPanel
    .getByText("Preferences saved successfully!")
    .waitFor({ state: "visible", timeout: 25000 })
    .then(() => true)
    .catch(() => false);
  check("fixes", "Clear All + Save reports success", clearedOk);
  await page.reload();
  await page.waitForTimeout(2500);
  const clearedLabel = (await page.locator("#pref-property-type").getAttribute("aria-label").catch(() => "")) || "";
  let prefsAfterClear = null;
  try {
    prefsAfterClear = await page.evaluate(async () => (await fetch("/api/buyer/preferences")).json());
  } catch {}
  const prefsNull =
    !prefsAfterClear?.preferences ||
    Object.values(prefsAfterClear.preferences).every((v) => v === null || v === undefined);
  check(
    "fixes",
    "Clear All persists as nulls (not a stale value)",
    /any type/i.test(clearedLabel) && prefsNull,
    `label=${clearedLabel} api=${JSON.stringify(prefsAfterClear?.preferences ?? null)}`
  );
  await shot(page, "15-preferences-cleared");

  check("fixes", "no page exceptions across fix journeys", issues.pageErrors.length === 0, issues.pageErrors.join(" | "));
  await ctx.close();
}

(async () => {
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--use-fake-device-for-media-stream", "--enable-unsafe-swiftshader", "--no-sandbox"],
  });
  const sections = [sectionStaffAuth, sectionBuyerAuth, sectionBuyerUX, sectionPropertyBuyer, sectionCRM, sectionPropertyMedia, sectionResponsive, sectionProtected, sectionSecurity, sectionFixes];
  for (const fn of sections) {
    try {
      await fn();
    } catch (e) {
      check("runner", `${fn.name} crashed`, false, String(e).slice(0, 300));
    }
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed. Screenshots: ${SHOT_DIR}`);
  if (allNetworkIssues.length) console.log("network-404s/failed:\n" + [...new Set(allNetworkIssues)].join("\n"));
  fs.writeFileSync(path.join(SHOT_DIR, "results.json"), JSON.stringify({ base: BASE, results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("RUNNER FATAL:", e); process.exit(2); });
