// Regenerates the homepage showcase reel + poster from the repo's own hero
// image. Requires ffmpeg on PATH. See public/videos/README.md for details.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "public", "videos");
const OUT = path.join(OUT_DIR, "basera-property-showcase.mp4");
const POSTER = path.join(OUT_DIR, "basera-property-showcase-poster.jpg");
const SOURCE_IMG = path.join(ROOT, "public", "hero-villa.jpg");

fs.mkdirSync(OUT_DIR, { recursive: true });

function run(args) {
  const res = spawnSync("ffmpeg", args, { stdio: "inherit" });
  if (res.error) {
    console.error("ffmpeg not found on PATH. Install ffmpeg and retry.", res.error.message);
    process.exit(2);
  }
  if (res.status !== 0) {
    console.error(`ffmpeg exited with code ${res.status}`);
    process.exit(res.status ?? 2);
  }
}

run([
  "-y", "-loop", "1", "-i", SOURCE_IMG,
  "-filter_complex",
  "scale=2560:-2,zoompan=z='min(1+0.00045*on,1.18)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=600:s=1280x720:fps=30,format=yuv420p",
  "-t", "20", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
  "-profile:v", "high", "-movflags", "+faststart", "-an",
  OUT,
]);

run(["-y", "-i", OUT, "-vf", "select=eq(n\\,0)", "-frames:v", "1", "-q:v", "4", POSTER]);

console.log("Generated:");
console.log(`  ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  ${path.relative(ROOT, POSTER)} (${(fs.statSync(POSTER).size / 1024).toFixed(0)} KB)`);
