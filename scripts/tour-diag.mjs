/* eslint-disable no-console */
/**
 * Headless 3D-tour diagnostics (evidence tool, not product code).
 *
 * Usage:
 *   node scripts/tour-diag.mjs <url> [outDir] [width] [height] [timeoutMs] [extraChromeArgs...]
 *   node scripts/tour-diag.mjs http://localhost:3000/tour tour-diag-out 1280 800 20000
 *
 * Extra args (after timeoutMs, comma or space separated):
 *   --webgl=off         launch Chrome with WebGL disabled (tests the fallback path)
 *   --quality=balanced  click the quality button until the given preference is shown
 *   --room=Dining       click the "Dining" hotspot and screenshot the camera flight
 *
 * Prints a JSON summary (canvases, scene ready, renderer info, FPS, quality,
 * hotspot positions) and writes boot + post-interaction screenshots.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright-core";

const [
  url = "http://localhost:3000/tour",
  outDir = "tour-diag-out",
  width = "1280",
  height = "800",
  timeoutMs = "20000",
  ...rest
] = process.argv.slice(2);

const extraFlags = rest.join(" ");
const disableWebGL = /--webgl=off/.test(extraFlags);
const qualityTarget = /--quality=(\w+)/.exec(extraFlags)?.[1] ?? "";
const roomTarget = /--room=([\w ]+)/.exec(extraFlags)?.[1]?.trim() ?? "";
const viewport = { width: Number(width), height: Number(height) };

const browser = await chromium.launch({
  headless: true,
  channel: "chrome",
  args: disableWebGL ? ["--disable-webgl", "--disable-webgl2"] : [],
});

const page = await browser.newPage({ viewport });
const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 220));
});
page.on("pageerror", (err) => pageErrors.push(String(err).slice(0, 300)));

const t0 = Date.now();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

const probePage = () =>
  page.evaluate(() => {
    const canvases = Array.from(document.querySelectorAll("canvas")).map((c) => ({
      w: c.width,
      h: c.height,
      visible: Boolean(c.offsetWidth || c.offsetHeight || c.getClientRects().length),
    }));
    const text = (document.querySelector("main") || document.body).innerText || "";
    const perf = window.__baseraPerf
      ? {
          fpsEMA: window.__baseraPerf.fpsEMA || 0,
          drawCalls: window.__baseraPerf.drawCalls || 0,
          triangles: window.__baseraPerf.triangles || 0,
          geometries: window.__baseraPerf.geometries || 0,
          textures: window.__baseraPerf.textures || 0,
          lights: window.__baseraPerf.lights || 0,
          quality: window.__baseraPerf.quality || "?",
          qualityPref: window.__baseraPerf.qualityPref || "?",
          pixelRatio: window.__baseraPerf.pixelRatio || 0,
        }
      : null;
    const hotspots = Array.from(document.querySelectorAll("[data-hotspot-name]"))
      .filter((h) => getComputedStyle(h).display !== "none" && (h.offsetWidth > 0 || h.getClientRects().length > 0))
      .map((h) => {
        const r = h.getBoundingClientRect();
        return { label: h.getAttribute("data-hotspot-name"), x: Math.round(r.x), y: Math.round(r.y) };
      });
    const qualityBtn = Array.from(document.querySelectorAll('button[aria-label^="Graphics quality"]'))[0];
    return {
      canvases,
      perf,
      hotspots,
      stage: /LIGHTING THE VILLA|LOADING THE RESIDENCE/i.test(text)
        ? (text.match(/LIGHTING THE VILLA|LOADING THE RESIDENCE/i) || [""])[0]
        : null,
      intro: /ENTER PROPERTY/i.test(text),
      inTour: hotspots.length > 0 || Boolean(qualityBtn),
      ready3d:
        /ENTER PROPERTY|CINEMATIC TOUR|WELCOME TO BASEERA|PAUSE AUTO-TOUR|Resume 3D tour/i.test(text) ||
        Boolean(qualityBtn),
      blockedFallback: /BLOCKED/i.test(text),
      errorFallback: /3D RENDERER UNAVAILABLE/i.test(text),
      qualityButton: qualityBtn ? (qualityBtn.textContent || "").trim().slice(0, 40) : null,
    };
  });

const deadline = Date.now() + Number(timeoutMs);
let probe;
let bootMs = null;
while (Date.now() < deadline) {
  probe = await probePage();
  if (probe.ready3d || probe.errorFallback || probe.blockedFallback) {
    bootMs = Date.now() - t0;
    break;
  }
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1500);
probe = await probePage();

await mkdir(outDir, { recursive: true });
const suffix = [
  disableWebGL ? "nowebgl" : `${viewport.width}x${viewport.height}`,
  qualityTarget || null,
  roomTarget ? `room-${roomTarget.replace(/\s+/g, "-")}` : null,
]
  .filter(Boolean)
  .join("-");

await page.screenshot({ path: join(outDir, `boot-${suffix}.png`), fullPage: false });

const interactions = {};
// Step through the intro: the cine overlay's "Enter property" skips to the
// door hero, and the door hero's "Enter Property" starts the door dolly
// (~4.5 s) into the tour. Click until tour UI (hotspots) appears.
for (let i = 0; i < 3; i += 1) {
  const enterBtn = page.getByRole("button", { name: /enter property/i }).first();
  if (!(await enterBtn.count())) break;
  await enterBtn.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(3600);
  probe = await probePage();
  if (probe.hotspots.length > 0) break;
}
if (probe.inTour && qualityTarget) {
  let clicked = false;
  for (let i = 0; i < 6 && !clicked; i += 1) {
    const btn = page.locator('button[aria-label^="Graphics quality"]').first();
    if (!(await btn.count())) break;
    const label = ((await btn.textContent()) || "").trim().toLowerCase();
    if (label.includes(qualityTarget)) {
      clicked = true;
      break;
    }
    await btn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500);
  const after = await page
    .locator('button[aria-label^="Graphics quality"]')
    .first()
    .textContent()
    .catch(() => null);
  interactions.qualityCycle = { clicked, after: after?.trim() ?? null };
}
if (probe.inTour && roomTarget) {
  // Accept a hotspot id ("hs-living") or a human label ("Living Room").
  const spot = page
    .locator(`[data-hotspot-name="${roomTarget}"], [data-hotspot-name] >> text="${roomTarget}"`)
    .first();
  const clicked = (await spot.count()) > 0;
  if (clicked) await spot.click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2200);
  interactions.roomClick = { clicked };
  await page.screenshot({ path: join(outDir, `room-${suffix}.png`), fullPage: false });
}
// Optional: pause control only exists in some builds — treat absence as fine.
const pauseBtn = page.getByRole("button", { name: /pause auto-?tour/i }).first();
if (await pauseBtn.count()) {
  await pauseBtn
    .click({ timeout: 3000 })
    .then(() => {
      interactions.pause = { done: true };
    })
    .catch(() => {
      interactions.pause = { done: false };
    });
  await page.waitForTimeout(400);
} else {
  interactions.pause = { done: null, note: "no pause control in this build" };
}

probe = await probePage();

const summary = {
  url,
  viewport,
  disableWebGL,
  bootMs,
  elapsedMs: Date.now() - t0,
  ...probe,
  interactions,
  consoleErrors: consoleErrors.slice(0, 10),
  pageErrors,
  screenshots: [
    join(outDir, `boot-${suffix}.png`),
    ...(interactions.roomClick ? [join(outDir, `room-${suffix}.png`)] : []),
  ],
};
console.log(JSON.stringify(summary, null, 2));
await writeFile(join(outDir, `summary-${suffix}.json`), JSON.stringify(summary, null, 2));
await browser.close();
