/* eslint-disable no-console */
/** One-off: verifies webglcontextlost → cinematic still → "Resume 3D tour"
 *  re-initializes IN PLACE (no reload, no duplicate canvas). */
import { chromium } from "playwright-core";

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto("http://localhost:3007/tour", { waitUntil: "domcontentloaded", timeout: 60000 });
// Wait for the tour to boot.
await page.waitForFunction(() => document.querySelectorAll("canvas").length > 0, { timeout: 30000 });
// Skip the cinematic if present, then wait until the door hero (poster is
// captured once we're in the door/tour phase with >10 rendered frames).
await page
  .getByRole("button", { name: /skip intro/i })
  .first()
  .click({ timeout: 10000 })
  .catch(() => {});
await page.waitForFunction(() => /ENTER PROPERTY/i.test(document.body.innerText), { timeout: 30000 });
await page.waitForTimeout(3500);
const before = await page.evaluate(() => ({
  canvases: document.querySelectorAll("canvas").length,
  href: location.href,
}));

// Force a real GPU context loss on the live canvas.
await page.evaluate(() => {
  const c = document.querySelector("canvas");
  const gl = c.getContext("webgl2") || c.getContext("webgl");
  gl.getExtension("WEBGL_lose_context")?.loseContext();
});
await page.waitForTimeout(1200);
const lostState = await page.evaluate(() => ({
  stillVisible: /cinematic still/i.test(document.body.innerText),
  resumeBtn: Array.from(document.querySelectorAll("button")).some((b) => /resume 3d tour/i.test(b.textContent || "")),
}));

// Click "Resume 3D tour" — must re-init in place.
await page.getByRole("button", { name: /resume 3d tour/i }).first().click({ timeout: 5000 }).catch(() => {});
await page.waitForTimeout(6000);
const after = await page.evaluate(() => ({
  canvases: document.querySelectorAll("canvas").length,
  href: location.href,
  sceneBack: /ENTER PROPERTY|CINEMATIC TOUR|BASERA/i.test(document.body.innerText),
  stillVisible: /cinematic still/i.test(document.body.innerText),
}));

console.log(JSON.stringify({ before, lostState, after, samePage: before.href === after.href, errors }, null, 2));
await browser.close();
