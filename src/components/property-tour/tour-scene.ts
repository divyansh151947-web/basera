import * as THREE from "three";

/**
 * Basera Aurum Villa — cinematic NIGHT architectural world.
 *
 * One world, two renderings: the cinematic intro dolly AND the realtime tour
 * share these exact builders/materials/lights/palette, so the "film" and the
 * interactive 3D are visibly the same property (same villa, same pool, same
 * garden, same city, same moon direction, same grade).
 *
 * Visual target: dark blue/black night, black steel + floor-to-ceiling glass
 * villa, warm amber interiors, reflective pool, landscaped garden.
 *
 * Pure scene-builder module (no React). Every builder is a drop-in seam: a
 * future GLB can replace any builder without touching camera, hotspot, or UI
 * code. Room specs in tour-types describe THIS scene, never a live listing.
 *
 * LIGHT BUDGET (desktop): hemi + moon directional (shadow) + entry wash +
 * interior spot (shadow) + pool/terrace points. Simplified (mobile):
 * hemi + moon + interior spot, shadows off, fewer trees/cars/lights.
 */

export interface TourRefs {
  doorLeft: THREE.Object3D;
  doorRight: THREE.Object3D;
  handleLeft: THREE.Object3D;
  entryGlow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[];
  poolWater: THREE.Mesh;
  floorSlab: THREE.Mesh;
  towerGroup: THREE.Group;
  interiorSpot: THREE.SpotLight;
  clouds: THREE.Mesh[];
  roomAccents: Partial<Record<string, THREE.MeshStandardMaterial[]>>;
  movingCars: THREE.Group[];
  sunLight: THREE.DirectionalLight;
  porchZone: THREE.Mesh;
}

export interface TourWorld {
  refs: TourRefs;
}

// Premium cinematic palette — golden hour to blue hour luxury real estate
const AMBER = 0xffc98a;
const AMBER_DEEP = 0xff9e57;
const AMBER_HOT = 0xffe2b0;
const AMBER_GLOW = 0xffd4a3;
const GLASS_TINT = 0x1a2a3a;
const GLASS_TINT_WARM = 0x2a3a4a;
const STEEL = 0x0d0f14;
const STEEL_SOFT = 0x181c24;
const STEEL_WARM = 0x242830;
const PLASTER_NIGHT = 0x4a443c;
const STONE_DARK = 0x2a2622;
const STONE_WARM = 0x3d3832;
const TEAK = 0x5d4228;
const TEAK_DARK = 0x352518;
const TEAK_RICH = 0x4a3422;
const BRONZE = 0xc9974f;
const BRONZE_DARK = 0x9a753a;
const LEAF = 0x1a3a20;
const LEAF_DEEP = 0x122816;
const LEAF_MID = 0x204a28;
const WATER = 0x0a2a3a;
const WATER_DEEP = 0x061822;
const FABRIC = 0x7a5c48;
const FABRIC_BLUE = 0x324058;
const FABRIC_CREAM = 0xe8ddd0;
const FABRIC_WARM = 0xd4b896;
const MARBLE_WARM = 0xc8c0b0;
const MARBLE_COOL = 0xb0b8c0;

// Enhanced material palette for premium finish
const PREMIUM_STONE = 0x2d2a26;
const PREMIUM_STONE_WARM = 0x3d3832;
const PREMIUM_CONCRETE = 0x3a3632;
const PREMIUM_WOOD_DARK = 0x352518;
const PREMIUM_WOOD_RICH = 0x4a3422;
const PREMIUM_GLASS_REFLECTIVE = 0x0d1a2a;
const PREMIUM_GLASS_WARM = 0x2a3a4a;
const PREMIUM_BRONZE = 0xbfa56e;
const PREMIUM_BRONZE_DARK = 0x9a753a;
const PREMIUM_LEAF = 0x1a3a20;
const PREMIUM_LEAF_DEEP = 0x122816;
const PREMIUM_PLASTER = 0x4e4a44;
const PREMIUM_PLASTER_NIGHT = 0x4a443c;   // added
const PREMIUM_WATER = 0x0a2a3a;
const PREMIUM_FABRIC = 0x7a5c48;
const PREMIUM_FABRIC_CREAM = 0xe8ddd0;
const PREMIUM_FABRIC_BLUE = 0x324058;       // added

// Architectural accent colors
const ACCENT_WARM_STONE = 0x5a5248;
const ACCENT_CHARCOAL = 0x1a1d22;
const ACCENT_GLASS_FRAME = 0x15181e;
const PREMIUM_STEEL = 0x0f111a;              // added
const PREMIUM_STEEL_SOFT = 0x1c202a;         // added

// Material cache: identical (color, roughness, metalness) params share one
// instance — fewer GL state changes and less memory for pixel-identical
// output. Dedicated animated materials (room accents, water, glass) bypass
// this cache so per-material animation stays independent.
const matCache = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, roughness = 0.85, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}|${roughness}|${metalness}`;
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  matCache.set(key, m);
  return m;
}

function glassMat(opacity = 0.3, warm = false): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: warm ? GLASS_TINT_WARM : GLASS_TINT,
    roughness: 0.03,
    metalness: 0.1,
    transparent: true,
    opacity,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.8,
    transmission: 0.85,
    thickness: 0.01,
    ior: 1.52,
    side: THREE.DoubleSide,
  });
}

function glassMatInterior(opacity = 0.4): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: GLASS_TINT_WARM,
    roughness: 0.05,
    metalness: 0.05,
    transparent: true,
    opacity,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    envMapIntensity: 1.4,
    transmission: 0.7,
    thickness: 0.008,
    ior: 1.5,
    side: THREE.DoubleSide,
  });
}

function box(w: number, h: number, d: number, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedBox(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function cyl(rt: number, rb: number, h: number, material: THREE.Material, x = 0, y = 0, z = 0, seg = 16): THREE.Mesh {
  const mesh = new THREE.Mesh(sharedCyl(rt, rb, h, seg), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Shared geometry cache: repeated props with identical dimensions (road
 * dashes, lamp dots, balcony slabs, pine cones, loungers) reuse ONE GPU
 * geometry instead of uploading hundreds of duplicates. Pixel-identical
 * output — only duplicate VRAM uploads are removed. Disposal stays safe:
 * disposeTourWorld dedupes shared instances (three.js re-uploads
 * automatically if a shared geometry renders again afterwards).
 */
const geoCache = new Map<string, THREE.BufferGeometry>();
function r3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function sharedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key);
  if (hit) return hit as T;
  const g = make();
  geoCache.set(key, g);
  return g;
}
function sharedBox(w: number, h: number, d: number): THREE.BoxGeometry {
  return sharedGeo(`box|${r3(w)}|${r3(h)}|${r3(d)}`, () => new THREE.BoxGeometry(w, h, d));
}
function sharedCyl(rt: number, rb: number, h: number, seg: number): THREE.CylinderGeometry {
  return sharedGeo(`cyl|${r3(rt)}|${r3(rb)}|${r3(h)}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
}
function sharedPlane(w: number, h: number): THREE.PlaneGeometry {
  return sharedGeo(`plane|${r3(w)}|${r3(h)}`, () => new THREE.PlaneGeometry(w, h));
}
function sharedSphere(r: number, ws: number, hs: number): THREE.SphereGeometry {
  return sharedGeo(`sphere|${r3(r)}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
}
function sharedCone(r: number, h: number, seg: number): THREE.ConeGeometry {
  return sharedGeo(`cone|${r3(r)}|${r3(h)}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));
}

function emissivePlane(w: number, h: number, color: number, intensity: number): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: intensity })
  );
}

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, rx = 1, ry = 1): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function seededRand(seedStart: number): () => number {
  let seed = seedStart;
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

let HI_RES = true;
function heroSize(): number {
  return HI_RES ? 512 : 256;
}

/** Dark stone cladding with subtle course variation — premium. */
function stoneTexture(): THREE.CanvasTexture {
  return canvasTex(heroSize(), (ctx, s) => {
    ctx.fillStyle = "#2d2a26";
    ctx.fillRect(0, 0, s, s);
    const rand = seededRand(33);
    const rows = 8;
    const rh = s / rows;
    const bw = s / 5;
    for (let row = 0; row < rows; row += 1) {
      const y = row * rh;
      const offset = row % 2 === 0 ? 0 : bw * 0.5;
      for (let x = -bw; x < s + bw; x += bw) {
        const shade = 0.88 + rand() * 0.22;
        const baseR = 52, baseG = 49, baseB = 44;
        ctx.fillStyle = `rgb(${Math.round(baseR * shade)},${Math.round(baseG * shade)},${Math.round(baseB * shade)})`;
        ctx.fillRect(x + offset + 1, y + 1, bw - 2, rh - 2);
      }
    }
    // Mortar lines
    ctx.fillStyle = "rgba(8,8,8,0.45)";
    for (let row = 0; row <= rows; row += 1) ctx.fillRect(0, row * rh, s, 1.5);
    for (let col = 0; col <= 5; col += 1) {
      const x = col * (s / 5);
      ctx.fillRect(x, 0, 1.5, s);
    }
    // Subtle surface variation
    for (let i = 0; i < 200; i += 1) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.03)";
      ctx.fillRect(Math.floor(rand() * s), Math.floor(rand() * s), 1, 1);
    }
  }, 3, 1.5);
}

/** Rich dark wood grain for premium teak. */
function woodTexture(): THREE.CanvasTexture {
  return canvasTex(heroSize(), (ctx, s) => {
    ctx.fillStyle = "#3d2818";
    ctx.fillRect(0, 0, s, s);
    const rand = seededRand(11);
    // Base grain layers
    for (let row = 0; row < 12; row += 1) {
      const y = (row * s) / 12;
      const h = s / 12;
      const shade = 0.85 + rand() * 0.25;
      ctx.fillStyle = `rgb(${Math.round(78 * shade)},${Math.round(52 * shade)},${Math.round(32 * shade)})`;
      ctx.fillRect(0, y, s, h - 1);
    }
    // Fine grain lines
    ctx.strokeStyle = "rgba(20,14,8,0.6)";
    ctx.lineWidth = 0.8;
    for (let g = 0; g < 60; g += 1) {
      ctx.beginPath();
      const gy = rand() * s;
      const amp = 8 + rand() * 12;
      const freq = 0.008 + rand() * 0.006;
      ctx.moveTo(0, gy);
      for (let x = 0; x <= s; x += 4) {
        const oy = Math.sin(x * freq + rand() * Math.PI) * amp;
        ctx.lineTo(x, gy + oy);
      }
      ctx.stroke();
    }
    // Occasional knots
    for (let k = 0; k < 4; k += 1) {
      const kx = rand() * s;
      const ky = rand() * s;
      const kr = 8 + rand() * 12;
      const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      grad.addColorStop(0, "rgba(40,24,12,0.5)");
      grad.addColorStop(0.5, "rgba(30,18,8,0.3)");
      grad.addColorStop(1, "rgba(20,12,6,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(kx, ky, kr, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 3, 3);
}

/** Premium dark travertine/concrete with realistic mottling. */
function concreteTexture(base = "#3a3632"): THREE.CanvasTexture {
  return canvasTex(heroSize(), (ctx, s) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, s, s);
    const rand = seededRand(21);
    // Large scale mottling
    for (let i = 0; i < 120; i += 1) {
      const x = rand() * s;
      const y = rand() * s;
      const r = 15 + rand() * 40;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rand() < 0.5 ? "rgba(10,10,10,0.15)" : "rgba(180,170,155,0.08)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Fine noise
    for (let i = 0; i < 3000; i += 1) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(5,5,5,0.1)" : "rgba(200,190,175,0.05)";
      ctx.fillRect(Math.floor(rand() * s), Math.floor(rand() * s), 1, 1);
    }
  }, 3, 3);
}

/** Night lawn — rich dark green with subtle mow stripes. */
function grassTexture(): THREE.CanvasTexture {
  return canvasTex(heroSize(), (ctx, s) => {
    ctx.fillStyle = "#0f1f14";
    ctx.fillRect(0, 0, s, s);
    // Mow stripes
    for (let i = 0; i < 12; i += 1) {
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.015)" : "rgba(0,0,0,0.08)";
      ctx.fillRect(0, (i * s) / 12, s, s / 12);
    }
    const rand = seededRand(55);
    // Grass blades suggestion
    for (let i = 0; i < 4000; i += 1) {
      ctx.fillStyle = rand() < 0.5 ? "rgba(6,25,12,0.4)" : "rgba(45,75,45,0.1)";
      ctx.fillRect(Math.floor(rand() * s), Math.floor(rand() * s), 1, 2);
    }
  }, 12, 12);
}

/** Warm light marble for kitchen/bath — glows under interior light. */
function marbleTexture(): THREE.CanvasTexture {
  return canvasTex(heroSize(), (ctx, s) => {
    ctx.fillStyle = "#c4bcac";
    ctx.fillRect(0, 0, s, s);
    const rand = seededRand(77);
    // Primary veins
    for (let i = 0; i < 8; i += 1) {
      ctx.strokeStyle = "rgba(85,78,68,0.45)";
      ctx.lineWidth = 0.6 + rand() * 1.2;
      ctx.beginPath();
      let x = rand() * s;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < s) {
        y += 25 + rand() * 45;
        x += rand() * 60 - 30;
        x = Math.max(10, Math.min(s - 10, x));
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Secondary fine veins
    ctx.strokeStyle = "rgba(100,92,80,0.2)";
    ctx.lineWidth = 0.4;
    for (let i = 0; i < 15; i += 1) {
      ctx.beginPath();
      let x = rand() * s;
      let y = 0;
      ctx.moveTo(x, y);
      while (y < s) {
        y += 15 + rand() * 30;
        x += rand() * 30 - 15;
        x = Math.max(5, Math.min(s - 5, x));
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, 1.5, 1.5);
}

function rugTexture(c1 = "#4a3428", c2 = "#8a7050"): THREE.CanvasTexture {
  return canvasTex(256, (ctx) => {
    ctx.fillStyle = c1;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = c2;
    ctx.lineWidth = 5;
    ctx.strokeRect(18, 18, 220, 220);
    ctx.lineWidth = 2;
    ctx.strokeRect(34, 34, 188, 188);
    ctx.fillStyle = c2;
    for (let x = 48; x < 220; x += 28) for (let y = 48; y < 220; y += 28) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }
  }, 1, 1);
}

function puffTexture(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 32, 4, 64, 32, 60);
  grad.addColorStop(0, "rgba(70,90,130,0.4)");
  grad.addColorStop(1, "rgba(70,90,130,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Shared warm-glow sprite (read-only texture — safe to reuse everywhere). */
let glowTexCache: THREE.CanvasTexture | null = null;
function glowSpriteTexture(): THREE.CanvasTexture {
  const cached = glowTexCache;
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 2, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,205,140,1)");
  grad.addColorStop(0.35, "rgba(255,170,95,0.5)");
  grad.addColorStop(1, "rgba(255,150,80,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  glowTexCache = tex;
  return tex;
}

/** Lit-window grid for distant towers. */
function windowTexture(litRatio: number, warm: number): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#0a0d14";
  ctx.fillRect(0, 0, 64, 128);
  const rand = seededRand(Math.floor(litRatio * 100) + 5);
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 8; x += 1) {
      const lit = rand() < litRatio;
      ctx.fillStyle = lit ? (rand() < warm ? "#ffbe6e" : "#8aa8cc") : "#141a26";
      ctx.fillRect(x * 8 + 1, y * 8 + 1, 6, 6);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft contact-shadow blob (fake AO grounding masses). */
let aoTexCache: THREE.CanvasTexture | null = null;
function aoTexture(): THREE.CanvasTexture {
  if (aoTexCache) return aoTexCache;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.55)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.3)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  aoTexCache = new THREE.CanvasTexture(canvas);
  aoTexCache.colorSpace = THREE.SRGBColorSpace;
  return aoTexCache;
}

function aoDisc(scene: THREE.Scene, x: number, y: number, z: number, w: number, d: number, opacity = 1): void {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: aoTexture(), transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y, z);
  m.renderOrder = 1;
  scene.add(m);
}

function buildContactShadows(scene: THREE.Scene): void {
  aoDisc(scene, -4.9, 0.045, -7.2, 4.6, 4.4, 0.9);
  aoDisc(scene, -4.6, 0.045, -15.4, 3.6, 4.2, 0.9);
  aoDisc(scene, 4.5, 0.045, -5.7, 3.0, 2.2, 0.85);
  aoDisc(scene, 5.6, 0.045, -8.4, 4.4, 2.0, 0.7);
  aoDisc(scene, 0, 0.115, 2.2, 5.2, 3.4, 0.8);
  aoDisc(scene, -15, 0.115, 0.5, 5.4, 3.2, 0.85);
  aoDisc(scene, 15, 0.155, 2.1, 4.6, 2.0, 0.6);
  aoDisc(scene, -4.5, 0.02, 6.2, 1.8, 1.8, 0.7);
  aoDisc(scene, 4.5, 0.02, 6.2, 1.8, 1.8, 0.7);
}

// ---------------------------------------------------------------- sky ---

function buildSky(scene: THREE.Scene, refs: Partial<TourRefs>): void {
  scene.background = new THREE.Color(0x06080e);
  scene.fog = new THREE.Fog(0x0a1018, 50, 200);
  // Cinematic golden-hour to blue-hour gradient sky dome
  const skyCanvas = document.createElement("canvas");
  skyCanvas.width = 4;
  skyCanvas.height = 512;
  const sctx = skyCanvas.getContext("2d")!;
  const grad = sctx.createLinearGradient(0, 512, 0, 0);
  grad.addColorStop(0.00, "#0f1a2e");  // deep navy upper sky
  grad.addColorStop(0.15, "#142238");  // dark blue
  grad.addColorStop(0.30, "#1a2a42");  // mid blue
  grad.addColorStop(0.45, "#243040");  // blue-purple transition
  grad.addColorStop(0.55, "#2e3840");  // horizon transition
  grad.addColorStop(0.65, "#3a362e");  // warm horizon
  grad.addColorStop(0.75, "#4a3e28");  // golden hour glow
  grad.addColorStop(0.85, "#3d3424");  // warm fade
  grad.addColorStop(1.00, "#2a241e");  // near horizon warmth
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 4, 512);
  // Horizon glow band
  const horizonGrad = sctx.createLinearGradient(0, 440, 0, 512);
  horizonGrad.addColorStop(0, "rgba(80,60,35,0)");
  horizonGrad.addColorStop(0.4, "rgba(100,75,40,0.25)");
  horizonGrad.addColorStop(1, "rgba(120,90,45,0.45)");
  sctx.fillStyle = horizonGrad;
  sctx.fillRect(0, 440, 4, 72);
  const skyTex = new THREE.CanvasTexture(skyCanvas);
  skyTex.colorSpace = THREE.SRGBColorSpace;
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(200, 32, 24),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false })
  );
  dome.position.y = 15;
  scene.add(dome);

  // Sun/Moon disc - warm golden hour sun
  const glowTex = glowSpriteTexture();
  const corona = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 56),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.22, depthWrite: false, fog: false, color: 0xffcc88, blending: THREE.AdditiveBlending })
  );
  corona.position.set(-70, 32, -120);
  corona.lookAt(0, 4, 0);
  scene.add(corona);
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(32, 32),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.55, depthWrite: false, fog: false, color: 0xffdd99 })
  );
  halo.position.set(-70, 32, -119.5);
  halo.lookAt(0, 4, 0);
  scene.add(halo);
  const sun = new THREE.Mesh(new THREE.CircleGeometry(4.0, 48), new THREE.MeshBasicMaterial({ color: 0xfff0d0, fog: false }));
  sun.position.set(-70, 32, -119);
  sun.lookAt(0, 4, 0);
  scene.add(sun);

  // Premium starfield — subtle, only upper sky
  const starGeo = new THREE.BufferGeometry();
  const starCount = 200;
  const positions = new Float32Array(starCount * 3);
  const sizes = new Float32Array(starCount);
  const alphas = new Float32Array(starCount);
  const rand = seededRand(9);
  for (let i = 0; i < starCount; i += 1) {
    const r = 90 + rand() * 60;
    const theta = rand() * Math.PI * 2;
    const phi = rand() * Math.PI * 0.35;  // only upper hemisphere
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.cos(phi) + 8;
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    sizes[i] = 0.4 + rand() * 1.2;
    alphas[i] = 0.2 + rand() * 0.4;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  starGeo.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
  starGeo.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));
  const starMat = new THREE.PointsMaterial({
    color: 0xe8eef8,
    size: 1,
    transparent: true,
    opacity: 1,
    fog: false,
    vertexColors: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(starGeo, starMat));

  // Slow atmospheric clouds — golden hour tinted
  const puff = puffTexture();
  const clouds: THREE.Mesh[] = [];
  const defs: Array<[number, number, number, number, number]> = [
    [-55, 35, -100, 38, 0.22], [15, 42, -105, 45, 0.18], [65, 34, -98, 32, 0.24], [-20, 28, -90, 24, 0.16],
    [-70, 30, -85, 28, 0.14], [80, 38, -92, 35, 0.16], [0, 45, -110, 50, 0.12],
  ];
  for (const [x, y, z, s, o] of defs) {
    const cloud = new THREE.Mesh(
      new THREE.PlaneGeometry(s, s * 0.35),
      new THREE.MeshBasicMaterial({ map: puff, transparent: true, opacity: o, depthWrite: false, fog: false })
    );
    cloud.position.set(x, y, z);
    cloud.lookAt(0, 5, 0);
    clouds.push(cloud);
    scene.add(cloud);
  }
  refs.clouds = clouds;
}

// -------------------------------------------------------------- ground ---

function buildGround(scene: THREE.Scene): void {
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(280, 280), new THREE.MeshStandardMaterial({ map: grassTexture(), roughness: 1 }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.02;
  lawn.receiveShadow = true;
  scene.add(lawn);

  // Stone arrival court + stepping path — premium stone.
  const court = box(11, 0.12, 8.5, new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.55, metalness: 0.05 }), 0, 0.06, 9.5);
  court.castShadow = false;
  scene.add(court);
  const pathMat = new THREE.MeshStandardMaterial({ map: concreteTexture("#38352f"), roughness: 0.75 });
  for (let i = 0; i < 5; i += 1) {
    const stone = box(1.9, 0.1, 1.3, pathMat, 0, 0.08, 5.2 - i * 1.5);
    stone.castShadow = false;
    scene.add(stone);
  }

  // Road + sidewalk with lane dashes.
  const road = box(110, 0.1, 8, new THREE.MeshStandardMaterial({ color: 0x101218, roughness: 0.4, metalness: 0.3 }), 0, 0.05, 18);
  road.castShadow = false;
  scene.add(road);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x7a6a48 });
  for (let x = -50; x <= 50; x += 6) {
    const dash = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.2), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.11, 18);
    scene.add(dash);
  }
  const walk = box(110, 0.11, 2.2, new THREE.MeshStandardMaterial({ map: concreteTexture("#2e2c27"), roughness: 0.9 }), 0, 0.055, 13.5);
  walk.castShadow = false;
  scene.add(walk);

  // Subtle contact shadows for grounding.
  buildContactShadows(scene);
}

// --------------------------------------------------------------- villa ---

function buildVilla(scene: THREE.Scene, refs: Partial<TourRefs>, simplified: boolean): void {
  const group = new THREE.Group();
  const steelMat = new THREE.MeshStandardMaterial({ color: PREMIUM_STEEL, roughness: 0.45, metalness: 0.75 });
  const steelSoft = new THREE.MeshStandardMaterial({ color: PREMIUM_STEEL_SOFT, roughness: 0.5, metalness: 0.6 });
  const stoneMat = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.9 });
  const teakMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.62 });
  const teakDark = new THREE.MeshStandardMaterial({ color: PREMIUM_WOOD_DARK, roughness: 0.65 });
  const bronzeMat = new THREE.MeshStandardMaterial({ color: PREMIUM_BRONZE, roughness: 0.3, metalness: 0.85 });
  const plasterMat = new THREE.MeshStandardMaterial({ color: PREMIUM_PLASTER_NIGHT, roughness: 0.9 });

  // Plinth grounding the composition with subtle course texture.
  group.add(box(18.5, 0.3, 10.6, stoneMat, 0, 0.15, -4.9));
  // Base plinth molding.
  group.add(box(18.5, 0.15, 0.4, steelMat, 0, 0.05, -5.15));
  group.add(box(18.5, 0.15, 0.4, steelMat, 0, 0.05, -4.45));

  // THREE STOREYS — staggered glass volumes with black steel frame.
  // Ground floor: stone-clad left wing, glass centre, stone right wing.
  group.add(box(5.4, 3.5, 9.5, stoneMat, -5.4, 2.05, -4.75));
  group.add(box(5.4, 3.5, 9.5, stoneMat, 5.4, 2.05, -4.75));
  const rearBase = box(17.0, 3.5, 0.5, plasterMat, 0, 2.05, -9.4);
  rearBase.castShadow = false;
  group.add(rearBase);

  // Steel corner columns + beams articulating each volume with architectural fins.
  // Front facade fins - vertical accent strips
  for (const x of [-8.15, -2.75, 2.75, 8.15]) {
    // Base columns
    group.add(box(0.32, 3.6, 0.32, steelMat, x, 2.0, 0.12));
    group.add(box(0.32, 2.9, 0.32, steelMat, x, 5.0, -0.9));
    group.add(box(0.32, 2.9, 0.32, steelMat, x, 8.0, -1.4));
    // NEW: Vertical architectural fins on front facade
    group.add(box(0.18, 4.2, 0.08, steelMat, x, 2.1, 1.55));   // ground floor
    group.add(box(0.18, 4.2, 0.08, steelMat, x, 5.1, -0.4));   // first floor
    group.add(box(0.18, 4.2, 0.08, steelMat, x, 8.1, -0.9));   // second floor
  }
  // Center spine beam
  group.add(box(17.2, 0.35, 0.4, steelMat, 0, 3.85, 0.1));
  group.add(box(17.2, 0.35, 0.4, steelMat, 0, 6.85, -0.9));
  group.add(box(17.2, 0.35, 0.4, steelMat, 0, 9.85, -1.4));

  // First + second floor slabs with deep cantilevered overhangs.
  // Ground floor: full width over front facade
  group.add(box(17.0, 2.9, 8.6, plasterMat, 0, 5.25, -5.2));
  // First floor: recessed with balcony depth
  group.add(box(16.4, 2.9, 8.0, plasterMat, 0.4, 8.25, -5.5));
  // Second floor: recessed further
  group.add(box(17.6, 0.32, 9.4, steelMat, 0, 6.85, -5.0)); // fascia L1
  group.add(box(17.0, 0.32, 8.6, steelMat, 0.4, 9.85, -5.4)); // fascia L2
  // Warm cove strips under each fascia — the reference's signature ceiling
  // glow lines. Emissive only (no light cost).
  const coveMat = new THREE.MeshBasicMaterial({ color: 0xffc98a });
  for (const [w, y, z] of [[17.4, 6.66, -0.32], [16.8, 9.66, -1.12], [17.0, 3.66, 0.32]] as const) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.05), coveMat);
    strip.position.set(0, y, z);
    group.add(strip);
  }
  group.add(box(10.5, 0.28, 6.0, steelMat, -2.5, 11.4, -6.0)); // roof crown
  group.add(box(17.2, 0.4, 9.0, plasterMat, 0, 3.62, -5.0)); // shadow gap band

  // Timber batten screen strip across first floor (instanced).
  {
    const step = simplified ? 1.1 : 0.55;
    const w = simplified ? 0.16 : 0.14;
    const list: { p: [number, number, number] }[] = [];
    for (let x = -7.6; x <= 7.61; x += step) list.push({ p: [x, 5.3, -0.72] });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(w, 2.4, 0.1), teakMat, list.length);
    const m4 = new THREE.Matrix4();
    list.forEach((t, i) => {
      m4.makeTranslation(t.p[0], t.p[1], t.p[2]);
      mesh.setMatrixAt(i, m4);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Floor-to-ceiling glass: ground + L1 + L2, with slim mullions and recessed frames.
  // Glass with warm tint for premium interior illumination effect.
  // Ground floor uses slightly cooler tint, upper floors use warm tint.
  const groundGlass = glassMat(0.28, false);   // cooler
  const upperGlass = glassMat(0.28, true);     // warm tinted
  const glassBays: Array<[number, number, number, number, number]> = [
    // cx, cy, w, h, z (z = distance from building center, negative = inside)
    [-4.6, 2.0, 4.0, 2.9, 0.02],      // ground floor left
    [4.6, 2.0, 4.0, 2.9, 0.02],       // ground floor right
    [-4.6, 5.3, 4.0, 2.5, -0.92],     // first floor left
    [4.6, 5.3, 4.0, 2.5, -0.92],      // first floor right
    [-3.0, 8.3, 3.4, 2.5, -1.65],     // second floor left
    [3.8, 8.3, 3.4, 2.5, -1.65],      // second floor right
  ];
  for (const [cx, cy, w, h, z] of glassBays) {
    // Use warm tint for upper floors (first + second), cooler for ground
    const glassTint = (cy >= 5) ? upperGlass : groundGlass;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassTint);
    pane.position.set(cx, cy, z);
    group.add(pane);
    // Deeper mullions - vertical + horizontal framing
    const nMull = Math.max(2, Math.round(w / 1.0));
    for (let k = 0; k <= nMull; k += 1) {
      const mx = cx - w / 2 + (k * w) / nMull;
      group.add(box(0.08, h, 0.07, steelMat, mx, cy, z));
    }
    group.add(box(w + 0.15, 0.1, 0.1, steelMat, cx, cy + h / 2, z)); // top mullion
    group.add(box(w + 0.15, 0.1, 0.1, steelMat, cx, cy - h / 2, z)); // bottom mullion
  }
  // Warm interior glow behind each glass band - varied by floor level.
  const glowBands: Array<[number, number, number, number, number, number]> = [ // added intensity param
    [-4.6, 2.0, 4.0, 2.9, -0.6, 0.38],   // ground floor - warmest
    [4.6, 2.0, 4.0, 2.9, -0.6, 0.38],   // ground floor - warmest
    [0, 5.3, 15.0, 2.1, -1.2, 0.34],    // first floor living
    [0, 8.3, 12.5, 2.1, -1.85, 0.32],   // second floor
  ];
  for (const [cx, cy, w, h, z, intensity] of glowBands) {
    const glow = emissivePlane(w, h, AMBER, intensity);
    glow.position.set(cx, cy, z);
    group.add(glow);
    (refs.entryGlow = refs.entryGlow ?? []).push(glow);
  }

  // Entrance: stone steps, premium porch, glass canopy, double door with architectural sidelights.
  // Stone plinth with course texture
  group.add(box(4.4, 0.22, 2.2, new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.7 }), 0, 0.11, 1.4));
  // Step risers
  for (let i = 0; i < 3; i += 1) {
    group.add(box(3.6 - i * 0.3, 0.16, 1.1, new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.75 }), 0, 0.07 + i * 0.16, 2.8 - i * 0.15));
  }
  // Porch slab with deeper profile
  group.add(box(4.0, 0.25, 2.6, steelMat, 0, 0.2, 1.8));
  // Glass canopy with structural frame
  const canopyGlass = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.6), glassMat(0.2));
  canopyGlass.rotation.x = -Math.PI / 2 + 0.05;
  canopyGlass.position.set(0, 3.5, 1.3);
  group.add(canopyGlass);
  // Corner columns flanking canopy
  for (const x of [-1.8, 1.8]) {
    group.add(box(0.12, 3.2, 0.12, steelMat, x, 1.6, 1.8));
    group.add(box(0.12, 2.8, 0.12, steelMat, x, 2.8, 1.8));
  }
  // Premium double door with vertical grain pattern + brass inlays.
  const doorMat = new THREE.MeshStandardMaterial({ color: 0x3d2a1a, roughness: 0.4, metalness: 0.2 });
  const panelGeo = new THREE.BoxGeometry(1.3, 3.0, 0.16);
  const pivotL = new THREE.Group();
  pivotL.position.set(-1.4, 0, 0);
  const panelL = new THREE.Mesh(panelGeo, doorMat);
  panelL.position.set(0.65, 1.65, 0);
  panelL.castShadow = true;
  pivotL.add(panelL);
  // Vertical brass inlay strips
  for (const dy of [-0.3, 0, 0.3, 0.6, 0.9, 1.2, 1.5]) {
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.6, 0.02), bronzeMat);
    inlay.position.set(0.72, 1.65 + dy, 0.09);
    pivotL.add(inlay);
  }
  const handleL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.0, 12), bronzeMat);
  handleL.position.set(1.2, 1.65, 0.2);
  pivotL.add(handleL);

  const pivotR = new THREE.Group();
  pivotR.position.set(1.4, 0, 0);
  const panelR = new THREE.Mesh(panelGeo, doorMat);
  panelR.position.set(-0.65, 1.65, 0);
  panelR.castShadow = true;
  pivotR.add(panelR);
  // Vertical brass inlay strips
  for (const dy of [-0.3, 0, 0.3, 0.6, 0.9, 1.2, 1.5]) {
    const inlay = new THREE.Mesh(new THREE.BoxGeometry(0.03, 2.6, 0.02), bronzeMat);
    inlay.position.set(-0.72, 1.65 + dy, 0.09);
    pivotR.add(inlay);
  }
  const handleR = handleL.clone();
  handleR.position.set(-1.2, 1.65, 0.2);
  pivotR.add(handleR);
  group.add(pivotL, pivotR);
  refs.doorLeft = pivotL;
  refs.doorRight = pivotR;
  refs.handleLeft = handleL;

  // Invisible porch hit zone — larger area for easier door clicking.
  const porchZone = new THREE.Mesh(
    new THREE.PlaneGeometry(5, 4),
    new THREE.MeshBasicMaterial({ visible: false })
  );
  porchZone.rotation.x = -Math.PI / 2;
  porchZone.position.set(0, 0.15, 2.5);
  group.add(porchZone);
  refs.porchZone = porchZone;

  // Interior glow behind the doorway (animated on open).
  const glow = emissivePlane(2.6, 3.0, AMBER, 0.0);
  glow.position.set(0, 1.6, -0.5);
  group.add(glow);
  (refs.entryGlow = refs.entryGlow ?? []).push(glow);

  // Sconces flanking the door.
  for (const x of [-2.7, 2.7]) {
    group.add(box(0.16, 0.5, 0.12, steelMat, x, 2.6, 0.32));
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 12), new THREE.MeshBasicMaterial({ color: AMBER }));
    bulb.position.set(x, 2.6, 0.42);
    group.add(bulb);
    if (!simplified) {
      const haloS = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: glowSpriteTexture(), transparent: true, opacity: 0.5, depthWrite: false }));
      haloS.position.set(x, 2.6, 0.45);
      group.add(haloS);
    }
  }

  // Balcony: first-floor front deck with deep glass balustrade and structural depth.
  group.add(box(9.8, 0.2, 2.0, new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.65 }), 0, 4.1, 0.5));
  // Deep glass balustrade with visible frame
  const balGlass = new THREE.Mesh(new THREE.PlaneGeometry(9.8, 1.1), glassMat(0.22));
  balGlass.position.set(0, 4.8, 1.3);
  group.add(balGlass);
  // Structural baluster posts with depth
  for (let x = -4.5; x <= 4.5; x += 2) {
    group.add(box(0.1, 1.2, 0.1, steelMat, x, 4.6, 1.55));
  }
  // Deep concrete floor band
  group.add(box(10.0, 0.15, 0.2, new THREE.MeshStandardMaterial({ color: STONE_DARK, roughness: 0.8 }), 0, 3.95, 0.6));
  // Teak loungers with better proportions
  const chairMat = mat(0x2a2e34, 0.6, 0.3);
  for (const x of [-2.2, 2.2]) {
    group.add(box(0.7, 0.5, 0.75, chairMat, x, 4.3, 0.4));
    group.add(box(0.7, 0.6, 0.15, chairMat, x, 4.7, 0.1));
  }
  group.add(box(1.3, 0.5, 0.5, mat(0x2e3a2c, 0.95), 3.8, 4.3, 0.4));
  // Potted feature shrub
  const shrub = new THREE.Mesh(new THREE.SphereGeometry(0.48, 12, 12), mat(LEAF, 0.95));
  shrub.position.set(3.8, 4.8, 0.4);
  group.add(shrub);

  // Second-floor side terrace with deeper depth and pergola.
  group.add(box(5.0, 0.18, 3.0, new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.65 }), 11.0, 7.1, -3.0));
  const tGlass = new THREE.Mesh(new THREE.PlaneGeometry(5.0, 1.0), glassMat(0.22));
  tGlass.position.set(11.0, 7.7, -2.3);
  group.add(tGlass);
  // Pergola with deeper slats
  for (const x of [-3.5, 0, 3.5]) {
    group.add(box(0.25, 3.2, 0.25, mat(TEAK_DARK, 0.65), x, 8.6, -14.2));
  }
  group.add(box(8.6, 0.18, 0.3, mat(TEAK_DARK, 0.65), 0, 9.65, -14.2));
  for (const dx of [-0.6, 0.6]) group.add(box(0.5, 0.4, 0.15, mat(FABRIC_CREAM, 0.9), -2.6 + dx, 7.6, -15.8));
  group.add(box(1.2, 0.35, 0.7, mat(TEAK_DARK, 0.65), 0.5, 7.2, -15.8));
  for (const [dx, dz] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]] as const) {
    group.add(box(0.45, 0.55, 0.45, mat(0x2e343b, 0.6), 3.8 + dx, 7.2, -15.2 + dz));
  }
  for (const x of [-6.5, 6.5]) {
    group.add(box(1.0, 0.5, 1.0, mat(STONE_DARK, 0.9), x, 7.2, -17.0));
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), mat(LEAF, 0.95));
    top.position.set(x, 7.7, -16.8);
    group.add(top);
    const top2 = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), mat(LEAF_DEEP, 0.95));
    top2.position.set(x + 0.4, 7.5, -16.6);
    group.add(top2);
  }

  scene.add(group);
}

function buildInteriorShell(scene: THREE.Scene, refs: Partial<TourRefs>, simplified: boolean): THREE.SpotLight {
  void simplified;
  const floorMat = new THREE.MeshStandardMaterial({ color: PREMIUM_WOOD_DARK, roughness: 0.5 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(17, 21), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.02, -10);
  floor.receiveShadow = true;
  scene.add(floor);

  const wallMat = new THREE.MeshStandardMaterial({ color: PREMIUM_STONE_WARM, roughness: 0.92 });
  const rear = box(17, 3.6, 0.35, wallMat, 0, 1.8, -20.2);
  rear.castShadow = false;
  const sideL = box(0.35, 3.6, 21, wallMat, -8.4, 1.8, -10);
  sideL.castShadow = false;
  const sideR = box(0.35, 3.6, 21, wallMat, 8.4, 1.8, -10);
  sideR.castShadow = false;
  scene.add(rear, sideL, sideR);

  // Ceiling with warm cove strip + recessed downlights.
  const ceil = box(17, 0.15, 21, new THREE.MeshStandardMaterial({ color: PREMIUM_PLASTER, roughness: 0.9 }), 0, 3.45, -10);
  ceil.castShadow = false;
  scene.add(ceil);
  const coveMat = new THREE.MeshStandardMaterial({ color: 0xffd9a0, emissive: 0xff9e57, emissiveIntensity: 1.2 });
  const cove = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.18), coveMat);
  cove.rotation.x = Math.PI / 2;
  cove.position.set(0, 3.36, -10);
  scene.add(cove);
  const downMat = new THREE.MeshBasicMaterial({ color: AMBER_HOT });
  for (const [x, z] of [[-4, -5], [0, -5], [4, -5], [-4, -10], [0, -10], [4, -10], [-4, -15], [0, -15], [4, -15]] as const) {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(0.09, 12), downMat);
    disc.rotation.x = Math.PI / 2;
    disc.position.set(x, 3.36, z);
    scene.add(disc);
  }

  // Runner + curtains.
  const runner = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 10), new THREE.MeshStandardMaterial({ map: rugTexture("#3a4a44", "#8a7050"), roughness: 0.95 }));
  runner.rotation.x = -Math.PI / 2;
  runner.position.set(0, 0.04, -7);
  runner.receiveShadow = true;
  scene.add(runner);
  const curtainMat = new THREE.MeshStandardMaterial({ color: PREMIUM_FABRIC, roughness: 0.95, side: THREE.DoubleSide });
  for (const x of [-6.2, -2.2, 2.2, 6.2]) {
    const cur = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.9), curtainMat);
    cur.position.set(x, 1.7, -0.5);
    cur.rotation.y = 0.15 * (x > 0 ? -1 : 1);
    scene.add(cur);
  }

  // Night city glow through bedroom rear glass.
  const cityGlow = emissivePlane(5.2, 1.9, 0x4a5a8a, 0.4);
  cityGlow.position.set(0, 1.9, -20.0);
  cityGlow.rotation.y = Math.PI;
  scene.add(cityGlow);
  (refs.entryGlow = refs.entryGlow ?? []).push(cityGlow);

  // Accent lamps: living floor lamps, kitchen pendants, bedroom bedside.
  const lampGlow = new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER_DEEP, emissiveIntensity: 1.1 });
  for (const [x, z] of [[-6.5, -5.5], [-6.5, -8.5]] as const) {
    scene.add(cyl(0.08, 0.12, 0.3, mat(0x1c1f24, 0.5, 0.5), x, 0.15, z));
    const shade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.28, 0.45, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER_DEEP, emissiveIntensity: 0.9, side: THREE.DoubleSide })
    );
    shade.position.set(x, 1.65, z);
    scene.add(shade);
  }
  for (const x of [4.2, 5.2]) {
    scene.add(cyl(0.012, 0.012, 1.0, mat(0x111111, 0.6), x, 2.8, -5.7, 6));
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.22, 14, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.35, metalness: 0.6, side: THREE.DoubleSide }));
    shade.position.set(x, 2.2, -5.7);
    scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 10), lampGlow);
    bulb.position.set(x, 2.1, -5.7);
    scene.add(bulb);
  }
  for (const x of [-6.0, -3.2]) {
    scene.add(cyl(0.06, 0.1, 0.12, mat(0x1c1f24, 0.5, 0.5), x, 0.55, -16.8));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), lampGlow);
    lamp.position.set(x, 0.68, -16.8);
    scene.add(lamp);
  }

  // Key interior spot (single shadow caster).
  const spot = new THREE.SpotLight(AMBER, 55, 30, Math.PI / 3.2, 0.5, 1.3);
  spot.position.set(0, 3.3, -6);
  spot.target.position.set(0, 0, -10);
  spot.castShadow = true;
  spot.shadow.mapSize.set(1024, 1024);
  spot.shadow.bias = -0.002;
  scene.add(spot, spot.target);
  return spot;
}

function buildLivingRoom(scene: THREE.Scene, refs: Partial<TourRefs>): void {
  const g = new THREE.Group();
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.2), new THREE.MeshStandardMaterial({ map: rugTexture(), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-4.6, 0.05, -6.4);
  rug.receiveShadow = true;
  g.add(rug);

  const sofaMat = new THREE.MeshStandardMaterial({ color: PREMIUM_FABRIC, roughness: 0.9 });
  const creamMat = new THREE.MeshStandardMaterial({ color: PREMIUM_FABRIC_CREAM, roughness: 0.9 });
  g.add(box(2.7, 0.55, 1.05, sofaMat, -4.9, 0.42, -8.0));
  g.add(box(2.7, 0.75, 0.32, sofaMat, -4.9, 0.95, -8.5));
  g.add(box(0.32, 0.55, 1.05, sofaMat, -6.35, 0.42, -8.0));
  g.add(box(0.32, 0.55, 1.05, sofaMat, -3.45, 0.42, -8.0));
  g.add(box(1.0, 0.5, 1.6, sofaMat, -6.0, 0.4, -6.6));
  for (const [x, c] of [[-5.6, creamMat], [-4.9, sofaMat], [-4.2, creamMat]] as const) {
    const cu = box(0.55, 0.45, 0.18, c, x, 0.95, -8.3);
    cu.rotation.x = -0.15;
    g.add(cu);
  }
  // Coffee table: teak + glass top + decor + books.
  g.add(box(1.3, 0.08, 0.7, mat(TEAK_DARK, 0.6), -4.9, 0.38, -6.4));
  for (const [dx, dz] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]] as const) {
    g.add(box(0.06, 0.34, 0.06, mat(TEAK_DARK, 0.6), -4.9 + dx, 0.17, -6.4 + dz));
  }
  const glassTop = new THREE.Mesh(new THREE.PlaneGeometry(1.34, 0.74), glassMat(0.3));
  glassTop.rotation.x = -Math.PI / 2;
  glassTop.position.set(-4.9, 0.43, -6.4);
  g.add(glassTop);
  g.add(box(0.3, 0.12, 0.22, mat(BRONZE, 0.35, 0.8), -5.1, 0.52, -6.4));
  const book = box(0.34, 0.06, 0.26, mat(0x2e4a6b, 0.8), -4.6, 0.49, -6.3);
  book.rotation.y = 0.3;
  g.add(book);
  const book2 = box(0.3, 0.05, 0.22, mat(0x6b3a2a, 0.8), -4.55, 0.54, -6.35);
  book2.rotation.y = -0.2;
  g.add(book2);

  // Media wall: console + glowing screen + soundbar + art.
  g.add(box(2.4, 0.5, 0.45, mat(TEAK_DARK, 0.65), -4.9, 0.27, -4.4));
  const tvCanvas = document.createElement("canvas");
  tvCanvas.width = 128;
  tvCanvas.height = 72;
  const tctx = tvCanvas.getContext("2d")!;
  const tgrad = tctx.createLinearGradient(0, 72, 0, 0);
  tgrad.addColorStop(0, "#c27a3a");
  tgrad.addColorStop(0.5, "#4a3a5a");
  tgrad.addColorStop(1, "#141c30");
  tctx.fillStyle = tgrad;
  tctx.fillRect(0, 0, 128, 72);
  const tvTex = new THREE.CanvasTexture(tvCanvas);
  tvTex.colorSpace = THREE.SRGBColorSpace;
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.05), new THREE.MeshBasicMaterial({ map: tvTex }));
  tv.position.set(-4.9, 1.55, -4.55);
  tv.rotation.y = Math.PI;
  g.add(tv);
  g.add(box(2.0, 0.12, 0.1, mat(0x14161a, 0.6), -4.9, 0.95, -4.5));
  const artGlow = new THREE.MeshStandardMaterial({ color: 0x8a5a34, emissive: 0x6b3d1e, emissiveIntensity: 0.5 });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.1), artGlow);
  art.position.set(-7.2, 1.8, -4.55);
  art.rotation.y = Math.PI;
  g.add(art);

  // Arc floor lamp with glowing shade + potted fig.
  g.add(cyl(0.035, 0.05, 1.7, mat(0x1d2126, 0.5, 0.6), -6.9, 0.85, -5.4));
  const shadeMat = new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER_DEEP, emissiveIntensity: 0.9, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.48, 14, 1, true), shadeMat);
  shade.position.set(-6.9, 1.85, -5.4);
  g.add(shade);
  g.add(cyl(0.22, 0.28, 0.4, mat(0x4a3a2c, 0.8), -3.0, 0.2, -4.8));
  const fig = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), mat(LEAF, 0.95));
  fig.position.set(-3.0, 0.95, -4.8);
  fig.scale.y = 1.3;
  g.add(fig);
  const fig2 = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), mat(LEAF_DEEP, 0.95));
  fig2.position.set(-2.6, 0.7, -4.5);
  g.add(fig2);

  refs.roomAccents = refs.roomAccents ?? {};
  (refs.roomAccents.living = refs.roomAccents.living ?? []).push(shadeMat);
  scene.add(g);
}

function buildKitchen(scene: THREE.Scene, refs: Partial<TourRefs>): void {
  const g = new THREE.Group();
  const cabMat = new THREE.MeshStandardMaterial({ color: PREMIUM_CONCRETE, roughness: 0.6 });
  const woodMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: PREMIUM_BRONZE, roughness: 0.3, metalness: 0.85 });

  // L-counters with marble tops, fridge + oven towers.
  g.add(box(3.6, 0.92, 0.7, cabMat, 5.4, 0.46, -8.7));
  g.add(box(3.7, 0.07, 0.78, new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.3 }), 5.4, 0.96, -8.7));
  g.add(box(0.7, 0.92, 2.4, cabMat, 7.3, 0.46, -7.2));
  g.add(box(3.6, 0.9, 0.25, new THREE.MeshStandardMaterial({ color: 0x35302a, roughness: 0.7 }), 5.4, 1.9, -8.95));
  // Under-cabinet strip light.
  const stripMat = new THREE.MeshStandardMaterial({ color: AMBER_HOT, emissive: AMBER_DEEP, emissiveIntensity: 1.3 });
  g.add(box(3.4, 0.04, 0.04, stripMat, 5.4, 1.44, -8.8));
  g.add(box(1.1, 2.1, 0.7, steelMat, 7.3, 1.05, -9.3));
  g.add(box(0.9, 1.1, 0.6, mat(0x1d2126, 0.5), 3.3, 1.0, -8.7));
  // Hob + sink + faucet.
  g.add(box(0.9, 0.03, 0.55, mat(0x14161a, 0.4), 5.0, 1.0, -8.7));
  for (const dx of [-0.2, 0.2]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 20), mat(0x0c0d0f, 0.6));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(5.0 + dx, 1.02, -8.7);
    g.add(ring);
  }
  g.add(box(0.7, 0.06, 0.45, steelMat, 6.1, 0.98, -8.7));
  g.add(cyl(0.04, 0.04, 0.35, steelMat, 6.1, 1.15, -8.9));

  // Island with waterfall marble top + 3 stools + pendants.
  g.add(box(1.9, 0.88, 1.0, woodMat, 4.5, 0.44, -5.7));
  g.add(box(2.05, 0.07, 1.12, new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.3 }), 4.5, 0.92, -5.7));
  for (const x of [3.9, 4.5, 5.1]) {
    g.add(cyl(0.19, 0.19, 0.08, mat(TEAK_DARK, 0.6), x, 0.62, -4.7));
    g.add(cyl(0.04, 0.04, 0.58, mat(0x1d2126, 0.5, 0.5), x, 0.31, -4.7));
  }
  const pendantMat = new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER_DEEP, emissiveIntensity: 1.1 });
  for (const x of [4.0, 5.0]) {
    g.add(cyl(0.015, 0.015, 1.0, mat(0x111111, 0.6), x, 2.9, -5.7, 6));
    const domeP = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.24, 14, 1, true), new THREE.MeshStandardMaterial({ color: 0x23282e, roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }));
    domeP.position.set(x, 2.35, -5.7);
    g.add(domeP);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 10), pendantMat);
    bulb.position.set(x, 2.24, -5.7);
    g.add(bulb);
  }
  // Fruit bowl.
  g.add(cyl(0.22, 0.14, 0.1, mat(TEAK_DARK, 0.6), 4.5, 1.0, -5.7));
  for (const [dx, c] of [[-0.08, 0xd97b4e], [0.06, 0xc2a24a], [0.0, 0x8ab45a]] as const) {
    const f = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), new THREE.MeshBasicMaterial({ color: c }));
    f.position.set(4.5 + dx, 1.1, -5.7);
    g.add(f);
  }
  // Wall art + herb pots.
  const kart = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.6), new THREE.MeshStandardMaterial({ color: 0x5a4a34, emissive: 0x3a2a1a, emissiveIntensity: 0.4 }));
  kart.position.set(5.4, 2.0, -8.8);
  kart.rotation.y = Math.PI;
  g.add(kart);
  refs.roomAccents = refs.roomAccents ?? {};
  (refs.roomAccents.kitchen = refs.roomAccents.kitchen ?? []).push(pendantMat);
  scene.add(g);
}

function buildBedroom(scene: THREE.Scene, refs: Partial<TourRefs>): void {
  const g = new THREE.Group();
  g.add(box(2.3, 0.4, 3.1, mat(PREMIUM_WOOD_DARK, 0.65), -4.6, 0.26, -15.4));
  g.add(box(2.2, 0.28, 3.0, new THREE.MeshStandardMaterial({ color: 0xcfc4b2, roughness: 0.9 }), -4.6, 0.58, -15.4));
  g.add(box(2.3, 1.15, 0.22, new THREE.MeshStandardMaterial({ color: PREMIUM_STONE_WARM, roughness: 0.85 }), -4.6, 0.85, -17.0));
  g.add(box(2.2, 0.07, 0.95, new THREE.MeshStandardMaterial({ color: PREMIUM_FABRIC_BLUE, roughness: 0.9 }), -4.6, 0.74, -14.6));
  const pillowMat = new THREE.MeshStandardMaterial({ color: 0xd8cfbc, roughness: 0.95 });
  for (const x of [-5.15, -4.05]) {
    const p = box(0.85, 0.2, 0.55, pillowMat, x, 0.8, -16.5);
    p.rotation.x = -0.18;
    g.add(p);
  }
  g.add(box(2.2, 0.05, 0.7, new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.9 }), -4.6, 0.72, -15.0));
  const lampMats: THREE.MeshStandardMaterial[] = [];
  for (const x of [-6.15, -3.05]) {
    g.add(box(0.52, 0.5, 0.52, mat(TEAK_DARK, 0.65), x, 0.25, -16.8));
    const lm = new THREE.MeshStandardMaterial({ color: AMBER, emissive: AMBER_DEEP, emissiveIntensity: 1.0 });
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 12), lm);
    lamp.position.set(x, 0.65, -16.8);
    g.add(lamp);
    g.add(cyl(0.05, 0.09, 0.12, mat(0x23282e, 0.5, 0.5), x, 0.55, -16.8));
    lampMats.push(lm);
    // Books on side tables.
    g.add(box(0.28, 0.05, 0.2, mat(0x3a4a5e, 0.8), x + 0.1, 0.53, -16.7));
  }
  // Wardrobe wall + rug + bench + art.
  g.add(box(2.6, 2.3, 0.6, new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 }), -7.6, 1.15, -14.5));
  for (const dz of [-14.7, -14.3]) g.add(box(0.03, 2.0, 0.02, mat(BRONZE, 0.35, 0.8), -7.28, 1.1, dz));
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), new THREE.MeshStandardMaterial({ map: rugTexture("#2e3a4e", "#8a7050"), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-4.6, 0.04, -13.2);
  rug.receiveShadow = true;
  g.add(rug);
  g.add(box(1.2, 0.4, 0.4, mat(TEAK_DARK, 0.65), -4.6, 0.2, -12.6));
  g.add(box(1.0, 0.1, 0.35, mat(FABRIC_BLUE, 0.9), -4.6, 0.45, -12.6));
  const art = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshBasicMaterial({ color: 0x8a5a34 }));
  art.position.set(-4.6, 2.0, -17.1);
  g.add(art);
  g.add(box(1.55, 1.05, 0.06, mat(TEAK_DARK, 0.6), -4.6, 2.0, -17.13));

  refs.roomAccents = refs.roomAccents ?? {};
  refs.roomAccents.bedroom = [...(refs.roomAccents.bedroom ?? []), ...lampMats];
  scene.add(g);
}

function buildBathroom(scene: THREE.Scene, refs: Partial<TourRefs>): void {
  const g = new THREE.Group();
  const tile = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 3.0), new THREE.MeshStandardMaterial({ map: concreteTexture("#565049"), roughness: 0.35 }));
  tile.rotation.x = -Math.PI / 2;
  tile.position.set(-6.5, 0.04, -18.4);
  tile.receiveShadow = true;
  g.add(tile);
  g.add(box(0.14, 2.6, 3.0, new THREE.MeshStandardMaterial({ color: PREMIUM_STONE_WARM, roughness: 0.9 }), -5.05, 1.3, -18.4));
  g.add(box(2.8, 2.6, 0.14, new THREE.MeshStandardMaterial({ color: PREMIUM_STONE_WARM, roughness: 0.7 }), -6.5, 1.3, -19.9));
  const porcelain = new THREE.MeshStandardMaterial({ color: 0xf5f0e8, roughness: 0.3 });
  // Tub with deck + brass filler.
  g.add(box(1.75, 0.55, 0.85, porcelain, -6.7, 0.3, -19.3));
  g.add(box(1.55, 0.1, 0.65, new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.25 }), -6.7, 0.6, -19.3));
  g.add(cyl(0.03, 0.03, 0.5, new THREE.MeshStandardMaterial({ color: BRONZE, roughness: 0.3, metalness: 0.85 }), -7.3, 0.85, -19.4));
  g.add(cyl(0.09, 0.09, 0.03, new THREE.MeshStandardMaterial({ color: BRONZE, roughness: 0.3, metalness: 0.85 }), -7.3, 1.1, -19.4));
  // Vanity + vessel basin + round mirror with halo.
  g.add(box(1.1, 0.8, 0.55, mat(PREMIUM_WOOD_DARK, 0.6), -5.7, 0.4, -17.4));
  g.add(box(1.15, 0.06, 0.6, new THREE.MeshStandardMaterial({ map: marbleTexture(), roughness: 0.3 }), -5.7, 0.83, -17.4));
  g.add(cyl(0.24, 0.18, 0.16, porcelain, -5.7, 0.94, -17.4, 16));
  g.add(cyl(0.025, 0.025, 0.2, new THREE.MeshStandardMaterial({ color: PREMIUM_BRONZE, roughness: 0.3, metalness: 0.85 }), -5.7, 1.0, -17.55));
  const mirror = new THREE.Mesh(new THREE.CircleGeometry(0.42, 24), new THREE.MeshStandardMaterial({ color: 0x8aa8bc, roughness: 0.05, metalness: 0.85 }));
  mirror.position.set(-5.7, 1.7, -17.62);
  mirror.rotation.y = Math.PI;
  g.add(mirror);
  const haloRing = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.025, 8, 28), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
  haloRing.position.set(-5.7, 1.7, -17.62);
  g.add(haloRing);
  // Glass shower screen + rain head + bench.
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.0), glassMat(0.2));
  screen.position.set(-7.4, 1.2, -17.6);
  screen.rotation.y = Math.PI / 2;
  g.add(screen);
  g.add(cyl(0.12, 0.12, 0.03, new THREE.MeshStandardMaterial({ color: PREMIUM_BRONZE, roughness: 0.3, metalness: 0.85 }), -7.4, 2.3, -17.9));
  g.add(box(0.5, 0.4, 0.3, mat(PREMIUM_WOOD_DARK, 0.65), -7.3, 0.2, -18.6));
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0xfff2dd, emissive: 0xffd9a0, emissiveIntensity: 0.9 });
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.8), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.set(-6.5, 2.7, -18.4);
  g.add(ceil);
  // Plant + towels.
  g.add(cyl(0.09, 0.12, 0.3, mat(0x4a3a2c, 0.8), -5.45, 1.0, -17.2));
  const sprig = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), mat(LEAF, 0.95));
  sprig.position.set(-5.45, 1.35, -17.2);
  sprig.scale.y = 1.5;
  g.add(sprig);
  g.add(box(0.35, 0.08, 0.25, mat(PREMIUM_FABRIC_CREAM, 0.95), -5.7, 0.5, -17.35));

  refs.roomAccents = refs.roomAccents ?? {};
  (refs.roomAccents.bathroom = refs.roomAccents.bathroom ?? []).push(ceilMat);
  scene.add(g);
}

function buildStairs(scene: THREE.Scene): void {
  const g = new THREE.Group();
  const treadMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.6 });
  for (let i = 0; i < 10; i += 1) {
    g.add(box(2.0, 0.18, 0.6, treadMat, 6.9, 0.3 + i * 0.32, -2.6 - i * 0.6));
  }
  g.add(box(0.15, 3.6, 7.0, mat(0x2e2a24, 0.85), 8.0, 1.9, -5.3));
  const rail = new THREE.Mesh(new THREE.PlaneGeometry(6.8, 0.9), glassMat(0.2));
  rail.position.set(5.85, 2.0, -5.3);
  rail.rotation.y = Math.PI / 2;
  rail.rotation.z = -0.45;
  g.add(rail);
  const hand = box(0.08, 0.08, 7.2, mat(BRONZE, 0.35, 0.8), 5.85, 2.55, -5.3);
  hand.rotation.x = -0.45;
  g.add(hand);
  scene.add(g);
}

function buildTerrace(scene: THREE.Scene, simplified: boolean): void {
  const g = new THREE.Group();
  const deckMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 });
  g.add(box(16.5, 0.3, 6.5, deckMat, 0, 6.75, -14.5));
  const railGlass = new THREE.Mesh(new THREE.PlaneGeometry(16.5, 0.95), glassMat(0.22));
  railGlass.position.set(0, 7.4, -17.6);
  g.add(railGlass);
  g.add(box(16.5, 0.07, 0.07, mat(BRONZE, 0.35, 0.8), 0, 7.9, -17.6));
  for (let x = -8; x <= 8; x += 2) g.add(box(0.07, 0.95, 0.07, mat(STEEL, 0.5, 0.6), x, 7.4, -17.6));
  // Pergola with slats.
  for (const x of [-3.4, 0, 3.4]) g.add(box(0.2, 2.6, 0.2, mat(TEAK_DARK, 0.65), x, 8.2, -13.8));
  g.add(box(8.2, 0.18, 0.24, mat(TEAK_DARK, 0.65), 0, 9.55, -13.8));
  const slatCount = simplified ? 6 : 11;
  for (let i = 0; i < slatCount; i += 1) {
    const z = -15.6 + (i / (slatCount - 1)) * 3.4;
    g.add(box(8.2, 0.09, 0.22, new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.7 }), 0, 9.42, z));
  }
  // Lounge + dining + planters.
  const rust = mat(FABRIC, 0.9);
  g.add(box(2.4, 0.5, 1.05, rust, -2.6, 7.15, -15.8));
  g.add(box(2.4, 0.7, 0.3, rust, -2.6, 7.6, -16.3));
  for (const dx of [-0.5, 0.5]) g.add(box(0.5, 0.4, 0.15, mat(FABRIC_CREAM, 0.9), -2.6 + dx, 7.55, -16.1));
  g.add(box(1.15, 0.32, 0.62, mat(TEAK_DARK, 0.65), 0.3, 7.06, -15.6));
  g.add(box(1.6, 0.08, 1.0, mat(TEAK_DARK, 0.6), 3.8, 7.35, -15.2));
  for (const [dx, dz] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]] as const) {
    g.add(box(0.45, 0.55, 0.45, mat(0x2e343b, 0.6), 3.8 + dx, 7.2, -15.2 + dz));
  }
  for (const x of [-6.5, 6.5]) {
    g.add(box(0.9, 0.5, 0.9, mat(STONE_DARK, 0.9), x, 7.15, -16.6));
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 10), mat(LEAF, 0.95));
    top.position.set(x, 7.75, -16.6);
    g.add(top);
    const top2 = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), mat(LEAF_DEEP, 0.95));
    top2.position.set(x + 0.4, 7.5, -16.4);
    g.add(top2);
  }
  // String lights catenary.
  if (!simplified) {
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
    for (let i = 0; i <= 12; i += 1) {
      const t = i / 12;
      const x = -4 + t * 8;
      const y = 9.1 - Math.sin(t * Math.PI) * 0.5;
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), bulbMat);
      b.position.set(x, y, -14.2);
      g.add(b);
      if (i < 12) {
        const x2 = -4 + ((i + 1) / 12) * 8;
        const y2 = 9.1 - Math.sin(((i + 1) / 12) * Math.PI) * 0.5;
        const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, Math.hypot(x2 - x, y2 - y), 4), wireMat);
        wire.position.set((x + x2) / 2, (y + y2) / 2, -14.2);
        wire.rotation.z = Math.atan2(y2 - y, x2 - x) + Math.PI / 2;
        g.add(wire);
      }
    }
  }
  scene.add(g);
}

// -------------------------------------------------------------- exterior ---

function tree(scene: THREE.Scene, x: number, z: number, s: number, simplified: boolean): void {
  const trunkMat = mat(0x2a1e14, 0.95);
  const trunk = cyl(0.1 * s, 0.16 * s, 1.4 * s, trunkMat, x, 0.7 * s, z, 8);
  // Thin dark trunks contribute nothing visible to the night shadow map —
  // canopies keep casting, so silhouettes are unchanged.
  trunk.castShadow = false;
  scene.add(trunk);
  // Layered pine-like canopy (dark night silhouette with uplight rim).
  const layers = simplified ? 2 : 3;
  for (let i = 0; i < layers; i += 1) {
    const r = (0.95 - i * 0.22) * s;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(r, 0.9 * s, 10),
      i % 2 ? mat(LEAF, 0.95) : mat(LEAF_DEEP, 0.95)
    );
    cone.position.set(x + (i % 2 ? 0.08 : -0.06) * s, (1.5 + i * 0.62) * s, z);
    cone.castShadow = true;
    scene.add(cone);
  }
}

function buildExterior(scene: THREE.Scene, refs: Partial<TourRefs>, simplified: boolean): void {
  const stoneMat = new THREE.MeshStandardMaterial({ map: concreteTexture("#35322c"), roughness: 0.55, metalness: 0.1 });
  const teakMat = new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.65 });

  // Pool court: stone deck, deep basin, mirror water, loungers, umbrella.
  const deck = box(12.5, 0.14, 9.5, stoneMat, 15, 0.07, -2);
  deck.castShadow = false;
  scene.add(deck);
  const basin = box(8.4, 0.55, 4.8, new THREE.MeshStandardMaterial({ color: 0x10222e, roughness: 0.4 }), 15, 0.12, -2);
  basin.castShadow = false;
  scene.add(basin);
  const waterMat = new THREE.MeshPhysicalMaterial({
    color: 0x0a1f2e,            // deeper ocean blue
    roughness: 0.02,            // very smooth water surface
    metalness: 0.45,            // slight metalness for water quality
    transparent: true,
    opacity: 0.96,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    emissive: 0x083048,         // deep blue glow
    emissiveIntensity: 0.45,
    envMapIntensity: 2.2,       // stronger environment reflections
    transmission: 0.9,          // clear water effect
    thickness: 0.02,
    ior: 1.33,                  // water index of refraction
    side: THREE.DoubleSide,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(8.0, 4.4), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(15, 0.36, -2);
  scene.add(water);
  refs.poolWater = water;
  refs.roomAccents = refs.roomAccents ?? {};
  (refs.roomAccents.pool = refs.roomAccents.pool ?? []).push(waterMat as unknown as THREE.MeshStandardMaterial);
  // Underwater glow strips.
  const uwMat = new THREE.MeshBasicMaterial({ color: 0x2e9fc4 });
  for (const dx of [-2.5, 0, 2.5]) {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.12), uwMat);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(15 + dx, 0.2, -2);
    scene.add(strip);
  }
  if (!simplified) {
    const poolLight = new THREE.PointLight(0x6ba8ea, 20, 16, 2.0);  // warmer cyan
    poolLight.position.set(15, 1.5, -2);
    poolLight.intensity = 20;
    scene.add(poolLight);
  }
  // Teak loungers with cushions + umbrella + side table.
  for (const [x, z] of [[11.6, 2.1], [18.4, 2.1]] as const) {
    scene.add(box(1.9, 0.28, 0.75, teakMat, x, 0.28, z));
    scene.add(box(1.7, 0.12, 0.65, mat(FABRIC_CREAM, 0.9), x, 0.48, z));
    scene.add(box(0.5, 0.35, 0.65, mat(FABRIC_CREAM, 0.9), x - 0.6, 0.62, z));
    scene.add(cyl(0.04, 0.04, 0.3, mat(0x1d2126, 0.5), x + 0.7, 0.2, z + 0.5));
  }
  scene.add(box(0.6, 0.4, 0.6, teakMat, 15, 0.28, 3.4));
  scene.add(cyl(0.05, 0.05, 2.4, mat(0x2e343b, 0.5, 0.5), 15, 1.2, 2.6));
  const umb = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.7, 12), new THREE.MeshStandardMaterial({ color: 0x8a7a62, roughness: 0.9, side: THREE.DoubleSide }));
  umb.position.set(15, 2.5, 2.6);
  umb.castShadow = true;
  scene.add(umb);
  // Ladder + waterline glow.
  const railMat = new THREE.MeshStandardMaterial({ color: 0xb9c2cc, roughness: 0.3, metalness: 0.9 });
  for (const dx of [-0.35, 0.35]) {
    scene.add(cyl(0.035, 0.035, 1.1, railMat, 11.1 + dx, 0.75, -2, 8));
  }
  const edge = new THREE.Mesh(new THREE.BoxGeometry(8.5, 0.05, 4.9), new THREE.MeshBasicMaterial({ color: 0x49b6dd }));
  edge.position.set(15, 0.33, -2);
  scene.add(edge);
  // Villa-light reflections on the water: elongated warm streaks on the
  // house side of the pool, like the reference's mirror water. Additive
  // glow planes just above the surface (no light cost).
  const streakMat = new THREE.MeshBasicMaterial({
    color: 0xffb36b, transparent: true, opacity: 0.22,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const streakMatDim = new THREE.MeshBasicMaterial({
    color: 0xff9e57, transparent: true, opacity: 0.13,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const streaks: Array<[number, number, number, number, THREE.MeshBasicMaterial]> = [
    [12.2, -1.4, 0.5, 3.4, streakMat],
    [13.8, -2.6, 0.7, 2.6, streakMatDim],
    [15.4, -1.2, 0.5, 3.0, streakMat],
    [17.0, -2.8, 0.6, 2.2, streakMatDim],
  ];
  for (const [x, z, w, l, m] of streaks) {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(w, l), m);
    s.rotation.x = -Math.PI / 2;
    s.position.set(x, 0.375, z);
    scene.add(s);
  }

  // Gardens: pines + topiary + blooms + grasses + bollards with uplights.
  // Intentional placement: symmetry, framing, and guided eye toward villa + pool.
  const treeDefs: Array<[number, number, number]> = simplified
    ? [[8, 5.5, 1], [-8, 5.5, 1.1], [20, 5.0, 1.2], [-20, 6.0, 1.0], [6, 8.5, 0.7], [-5, 9.0, 0.85]]
    : [
        // Frame-left trees
        [8, 5.5, 1], [11, 6.5, 0.8], [-8, 5.5, 1.1], [-11, 6.8, 0.9],
        // Far-left feature
        [20, 5.0, 1.2], [-20, 6.0, 1.0],
        // Right side grouping - staggered, not symmetric
        [6, 8.5, 0.7], [-5, 9.0, 0.85],
        // Additional infill (organically placed, not grid)
        [23, 0.5, 0.9], [-24, 1.5, 1.05],
        // Center-garden accent closer to villa
        [2, 10.2, 0.6], [-2, 10.4, 0.65],
        // Subtle far-right edge
        [18, 4.0, 0.5], [-18, 4.5, 0.7],
      ];
  for (const [x, z, s] of treeDefs) tree(scene, x, z, s, simplified);
  // Uplights at feature trees.
  if (!simplified) {
    const upMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
    for (const [x, z] of [[8, 5.5], [-8, 5.5], [20, 5.0]] as const) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), upMat);
      dot.position.set(x + 0.5, 0.08, z + 0.5);
      scene.add(dot);
    }
  }
  // Balanced topiary cubes at key positions.
  const topiaryMat = mat(LEAF_DEEP, 0.9);
  const topiaryPositions = simplified
    ? [[14, 1.0], [-14, 1.0]]
    : [[14, 1.0], [16, 1.3], [-14, 1.0], [-16, 1.3]];
  for (const [x, z] of topiaryPositions) {
    const topiary = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), topiaryMat);
    topiary.position.set(x, 0.6, z);
    topiary.castShadow = true;
    scene.add(topiary);
  }
  // Flower bed near pool deck - organized ring.
  const bed = new THREE.Mesh(new THREE.TorusGeometry(7.2, 0.4, 8, 32, Math.PI * 1.2), mat(0x1e1610, 0.95));
  bed.rotation.x = -Math.PI / 2;
  bed.rotation.z = Math.PI * 0.88;
  bed.position.set(15, 0.12, -2);
  scene.add(bed);
  const petalColors = [0x8a3a52, 0xa8823e, 0x7a4a80, 0x94522e, 0x9a917e];
  const bloomCount = simplified ? 8 : 16;
  const bloomGeo = sharedSphere(0.12, 8, 8);
  const bloomMats = petalColors.map((c) => new THREE.MeshBasicMaterial({ color: c }));
  for (let i = 0; i < bloomCount; i += 1) {
    const a = Math.PI * 0.88 + (i / bloomCount) * Math.PI * 1.25;
    const bloom = new THREE.Mesh(bloomGeo, bloomMats[i % bloomMats.length]);
    bloom.position.set(15 + Math.cos(a) * 7.2, 0.34, -2 + Math.sin(a) * 7.2);
    scene.add(bloom);
  }
  // Ornamental grasses in clustered groups.
  for (const [x, z] of [[-6.5, 4.2], [6.5, 4.2], [9.5, -6.5], [-9.5, -6.5]] as const) {
    for (let i = 0; i < (simplified ? 2 : 4); i += 1) {
      const blade = cyl(0.015, 0.03, 0.5 + (i % 2) * 0.3, mat(0x2e4a24, 0.95), x + (i - 1) * 0.15, 0.3, z, 4);
      blade.rotation.z = (i - 1) * 0.12;
      scene.add(blade);
    }
  }
  // Garden bollard lights with uplight halos.
  if (!simplified) {
    const bollardDotGeo = sharedSphere(0.08, 8, 8);
    const bollardDotMat = new THREE.MeshBasicMaterial({ color: AMBER_HOT });
    const haloGeo = sharedPlane(0.8, 0.8);
    const haloMat = new THREE.MeshBasicMaterial({ map: glowSpriteTexture(), transparent: true, opacity: 0.4, depthWrite: false });
    for (const [x, z] of [[-12, 6], [12, 6], [-12, 10], [12, 10]] as const) {
      scene.add(cyl(0.05, 0.08, 0.7, mat(0x23282e, 0.6), x, 0.4, z, 6));
      const dot = new THREE.Mesh(bollardDotGeo, bollardDotMat);
      dot.position.set(x, 0.8, z);
      scene.add(dot);
      const haloB = new THREE.Mesh(haloGeo, haloMat);
      haloB.position.set(x, 0.8, z + 0.02);
      scene.add(haloB);
    }
  }
  // Driveway to carport + bollard lights.
  const drive = box(4.4, 0.1, 15, new THREE.MeshStandardMaterial({ map: concreteTexture("#35322c"), roughness: 0.55, metalness: 0.12 }), -15, 0.05, 11.5);
  drive.castShadow = false;
  scene.add(drive);
  if (!simplified) {
    const bollardDotGeo = sharedSphere(0.09, 10, 10);
    const bollardDotMat = new THREE.MeshBasicMaterial({ color: AMBER });
    const bollardHaloGeo = sharedPlane(0.9, 0.9);
    for (const [x, z] of [[-12.4, 7.5], [-17.6, 7.5], [-12.4, 13.5], [-17.6, 13.5]] as const) {
      scene.add(cyl(0.06, 0.08, 0.85, mat(0x23282e, 0.6), x, 0.42, z, 8));
      const dot = new THREE.Mesh(bollardDotGeo, bollardDotMat);
      dot.position.set(x, 0.9, z);
      scene.add(dot);
      const haloB = new THREE.Mesh(bollardHaloGeo, new THREE.MeshBasicMaterial({ map: glowSpriteTexture(), transparent: true, opacity: 0.45, depthWrite: false }));
      haloB.position.set(x, 0.9, z + 0.02);
      scene.add(haloB);
    }
  }

  // Carport: steel posts + slat roof + SUV + EV charger.
  for (const [x, z] of [[-18.5, -2.5], [-11.5, -2.5], [-18.5, 3.5], [-11.5, 3.5]] as const) {
    scene.add(box(0.18, 3.2, 0.18, mat(STEEL, 0.5, 0.6), x, 1.6, z));
  }
  scene.add(box(8.2, 0.18, 7.2, mat(TEAK_DARK, 0.65), -15, 3.3, 0.5));
  for (let i = 0; i < 8; i += 1) scene.add(box(8.2, 0.06, 0.3, teakMat, -15, 3.42, -2.4 + i * 0.85));
  const asphalt = box(10, 0.1, 8, mat(0x14161c, 0.9), -15, 0.05, 0.5);
  asphalt.castShadow = false;
  scene.add(asphalt);
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x6a6e74 });
  for (const x of [-17.5, -15, -12.5]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 6.5), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.11, 0.5);
    scene.add(line);
  }
  const carPaint = new THREE.MeshPhysicalMaterial({ color: 0x1c2636, roughness: 0.3, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.1 });
  const car = new THREE.Group();
  const body = box(4.1, 0.62, 1.85, carPaint, 0, 0.66, 0);
  const hood = box(1.1, 0.42, 1.8, carPaint, 1.6, 0.85, 0);
  const cabin = box(2.0, 0.55, 1.65, new THREE.MeshPhysicalMaterial({ color: 0x0a0e14, roughness: 0.12, metalness: 0.4, clearcoat: 1 }), -0.2, 1.2, 0);
  car.add(body, hood, cabin);
  const wheelGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.26, 16);
  const wheelMat = mat(0x0c0d0f, 0.9);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ab, roughness: 0.3, metalness: 0.9 });
  for (const [x, z] of [[-1.35, 0.95], [1.35, 0.95], [-1.35, -0.95], [1.35, -0.95]] as const) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.35, z);
    car.add(wheel);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.28, 10), hubMat);
    hub.rotation.x = Math.PI / 2;
    hub.position.set(x, 0.35, z);
    car.add(hub);
  }
  for (const z of [0.55, -0.55]) {
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 10), new THREE.MeshBasicMaterial({ color: 0xffe6b0 }));
    lamp.position.set(2.12, 0.62, z);
    car.add(lamp);
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.9), new THREE.MeshBasicMaterial({ color: 0xffe6b0, transparent: true, opacity: 0.1, depthWrite: false }));
    beam.position.set(3.2, 0.5, z);
    beam.rotation.y = Math.PI / 2;
    car.add(beam);
  }
  const tailBar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 1.55), new THREE.MeshBasicMaterial({ color: 0x8a2a22 }));
  tailBar.position.set(-2.07, 0.7, 0);
  car.add(tailBar);
  car.position.set(-15, 0.05, 0.5);
  car.rotation.y = 0.05;
  scene.add(car);
  // EV charger + pole light.
  scene.add(box(0.5, 1.1, 0.35, mat(0x3a3630, 0.6), -11.2, 0.55, 2.8));
  const chargeDot = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0x5aa080 }));
  chargeDot.position.set(-11.2, 0.9, 3.0);
  scene.add(chargeDot);
  if (!simplified) {
    const poleLight = new THREE.PointLight(AMBER, 12, 15, 1.8);
    poleLight.position.set(-15, 4.4, 3.5);
    scene.add(poleLight);
    scene.add(cyl(0.06, 0.08, 4.4, mat(0x23282e, 0.6, 0.4), -15, 2.2, 3.5, 8));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), new THREE.MeshBasicMaterial({ color: AMBER }));
    head.position.set(-15, 4.45, 3.5);
    scene.add(head);
  }
  // Terrace accent.
  const terraceGlow = new THREE.PointLight(AMBER, 16, 17, 1.8);
  terraceGlow.position.set(0, 8.2, -14);
  scene.add(terraceGlow);
}

// ----------------------------------------------------------------- city ---

function buildCity(scene: THREE.Scene, refs: Partial<TourRefs>, simplified: boolean): void {
  const group = new THREE.Group();
  const rand = seededRand(123);
  // Varied night towers: massing jitter, lit-window grids, crowns, balconies.
  const towerCount = simplified ? 7 : 13;
  for (let i = 0; i < towerCount; i += 1) {
    const spread = simplified ? 16 : 13;
    // Stack buildings closer together for denser city feel
    const x = -50 + i * spread + (rand() - 0.5) * 4;
    // Varied widths with setbacks for depth
    const w = 6 + rand() * 8;
    const h = 12 + rand() * 25;
    const d = 6 + rand() * 5;
    // Some buildings set back for atmospheric perspective
    const setback = rand() < 0.4 ? 12 + rand() * 8 : 0;
    const z = -40 - rand() * 12 - setback;
    const lit = 0.3 + rand() * 0.4;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({
        color: 0x11151f, roughness: 0.75,
        emissive: 0xffffff, emissiveMap: windowTexture(lit, 0.7), emissiveIntensity: 0.7 + rand() * 0.3,
      })
    );
    body.position.set(x, h / 2, z);
    group.add(body);
    // Setback crown for skyline variety (only for buildings not too far back).
    if (setback < 20) {
      const crown = new THREE.Mesh(
        new THREE.BoxGeometry(w * (0.5 + rand() * 0.4), 1 + rand() * 1.2, d * (0.5 + rand() * 0.4)),
        new THREE.MeshStandardMaterial({ color: 0x0d1017, roughness: 0.85 })
      );
      crown.position.set(x + (rand() - 0.5) * w, h + 0.5, z);
      group.add(crown);
      const crownEdge = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.3, 0.3, d + 0.3),
        new THREE.MeshStandardMaterial({ color: AMBER_DEEP, emissive: AMBER_DEEP, emissiveIntensity: 0.4 + rand() * 0.2 })
      );
      crownEdge.position.set(x, h + 0.1, z);
      group.add(crownEdge);
    }
    // Balcony slabs on some floors for variety.
    if (!simplified && rand() < 0.5) {
      const balMat = mat(0x1a1e26, 0.8);
      const floorCount = Math.max(2, Math.floor(h / 4));
      for (let by = 4; by < Math.min(h - 2, floorCount * 4); by += 4) {
        group.add(box(w + 0.5, 0.2, 0.8, balMat, x, by, z + d / 2 + 0.1));
      }
    }
    // Retail glow at base - varied intensity.
    const retail = emissivePlane(Math.min(w * 0.6, 5), 1.2, AMBER, 0.3 + rand() * 0.2);
    retail.position.set(x, 0.6, z + d / 2 + 0.06);
    group.add(retail);
  }
  // Arterial road with lane light + street lamps.
  const road = new THREE.Mesh(new THREE.PlaneGeometry(150, 7), mat(0x101318, 1));
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0.03, -36);
  road.receiveShadow = true;
  group.add(road);
  const dashMat = new THREE.MeshBasicMaterial({ color: 0x8a7a52 });
  for (let x = -70; x <= 70; x += 6) {
    const dash = new THREE.Mesh(sharedPlane(2.0, 0.16), dashMat);
    dash.rotation.x = -Math.PI / 2;
    dash.position.set(x, 0.06, -36);
    group.add(dash);
  }
  const lampMat = mat(0x1c1f24, 0.6);
  const lampDotMat = new THREE.MeshBasicMaterial({ color: AMBER });
  const lampDotGeo = sharedSphere(0.14, 8, 8);
  const lampConeGeo = sharedGeo("lampCone", () => new THREE.ConeGeometry(1.6, 1.8, 12, 1, true));
  const lampConeMat = new THREE.MeshBasicMaterial({ color: 0xffc98a, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
  const lampStep = simplified ? 24 : 14;
  for (let x = -60; x <= 60; x += lampStep) {
    group.add(box(0.14, 5.2, 0.14, lampMat, x, 2.6, -32.2));
    const dot = new THREE.Mesh(lampDotGeo, lampDotMat);
    dot.position.set(x, 5.3, -32.2);
    group.add(dot);
    if (!simplified) {
      const cone = new THREE.Mesh(lampConeGeo, lampConeMat);
      cone.position.set(x, 4.3, -32.2);
      group.add(cone);
    }
  }
  // Street pines.
  const leafA = mat(LEAF_DEEP, 0.95);
  const trunkM = mat(0x241a12, 0.9);
  const pineConeGeo = sharedCone(0.9, 1.8, 8);
  for (let x = -55; x <= 55; x += (simplified ? 18 : 11)) {
    const t = cyl(0.09, 0.12, 0.9, trunkM, x, 0.45, -40.5, 7);
    group.add(t);
    const c = new THREE.Mesh(pineConeGeo, leafA);
    c.position.set(x, 1.9, -40.5);
    group.add(c);
  }
  // Moving traffic (animated in shell tick; hidden cost when simplified).
  const movingCars: THREE.Group[] = [];
  if (!simplified) {
    const carCols = [0x6a6e74, 0x4a5a70, 0x704a3a];
    for (let i = 0; i < 3; i += 1) {
      const c = new THREE.Group();
      c.add(box(2.2, 0.5, 1.0, mat(carCols[i], 0.4, 0.4), 0, 0.4, 0));
      c.add(box(1.2, 0.4, 0.9, mat(0x0a0e14, 0.3, 0.5), 0, 0.8, 0));
      const hl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffe6b0 }));
      hl.position.set(i % 2 ? 1.12 : -1.12, 0.4, 0.3);
      c.add(hl);
      const tl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: 0x8a2a22 }));
      tl.position.set(i % 2 ? -1.12 : 1.12, 0.4, -0.3);
      c.add(tl);
      c.position.set(-50 + i * 34, 0.1, -35 + (i % 2) * 2.2);
      c.rotation.y = i % 2 ? Math.PI : 0;
      movingCars.push(c);
      group.add(c);
    }
  }
  refs.movingCars = movingCars;

  // Floor highlight slab for tower/floor selection.
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(12.6, 0.35, 12.6),
    new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.35 })
  );
  slab.position.set(0, 8, -58);
  group.add(slab);
  refs.floorSlab = slab;
  scene.add(group);
  refs.towerGroup = group;
}

/** Build only the city/tower cluster (for RevenueTower ambient visual). */
export function buildCityOnly(scene: THREE.Scene, simplified: boolean): THREE.Group {
  const partialRefs: Partial<TourRefs> = { movingCars: [], floorSlab: null as any };
  buildCity(scene, partialRefs, simplified);
  return partialRefs.towerGroup!;
}

export function moveFloorSlab(refs: Pick<TourRefs, "floorSlab">, floorIndex: number): void {
  refs.floorSlab.position.y = 3 + floorIndex * 7;
}

/** Dispose a tour renderer + its scene GPU resources (call on unmount). */
export function disposeTourWorld(scene: THREE.Scene, renderer: THREE.WebGLRenderer): void {
  // Shared cached geometries/materials (see sharedGeo/mat caches) may appear
  // on many meshes — dispose each unique instance once. (three.js re-uploads
  // automatically if a shared instance renders again afterwards.)
  const deadGeos = new Set<THREE.BufferGeometry>();
  const deadMats = new Set<THREE.Material>();
  try {
    scene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      const geo = mesh.geometry as THREE.BufferGeometry | undefined;
      if (geo && typeof geo.dispose === "function" && !deadGeos.has(geo)) {
        deadGeos.add(geo);
        geo.dispose();
      }
      const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
      const kill = (x: THREE.Material) => {
        if (deadMats.has(x)) return;
        deadMats.add(x);
        const rec = x as unknown as Record<string, { dispose?: () => void } | undefined>;
        for (const key of ["map", "emissiveMap", "envMap"]) {
          try {
            rec[key]?.dispose?.();
          } catch {
            // Best-effort.
          }
        }
        x.dispose();
      };
      if (Array.isArray(m)) m.forEach(kill);
      else if (m) kill(m);
    });
  } catch {
    // Best-effort cleanup.
  }
  try {
    renderer.dispose();
  } catch {
    // Best-effort cleanup.
  }
}

export interface TourPerfStats {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  meshes: number;
  lights: number;
}

/** Snapshot of GPU scene cost (renderer.info + scene census) for perf reports. */
export function collectPerfStats(scene: THREE.Scene, renderer: THREE.WebGLRenderer): TourPerfStats {
  const info = renderer.info;
  let meshes = 0;
  let lights = 0;
  scene.traverse((obj) => {
    if ((obj as THREE.Mesh).isMesh) meshes += 1;
    if ((obj as THREE.Light).isLight) lights += 1;
  });
  return {
    drawCalls: info.render.calls,
    triangles: info.render.triangles,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    meshes,
    lights,
  };
}

/**
 * Night IBL without external assets: PMREM a tiny procedural night
 * environment (dark blue dome + warm window strip) so PBR glass/metal/water
 * pick up believable reflections. Safe no-op on failure.
 */
export async function enhanceWithEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Promise<void> {
  try {
    const envScene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(50, 16, 12);
    const envCanvas = document.createElement("canvas");
    envCanvas.width = 64;
    envCanvas.height = 32;
    const ectx = envCanvas.getContext("2d")!;
    const egrad = ectx.createLinearGradient(0, 32, 0, 0);
    egrad.addColorStop(0.0, "#3a2a1a");
    egrad.addColorStop(0.45, "#0a1020");
    egrad.addColorStop(1.0, "#02040a");
    ectx.fillStyle = egrad;
    ectx.fillRect(0, 0, 64, 32);
    // Warm window band for reflections.
    ectx.fillStyle = "#c8823a";
    ectx.fillRect(8, 15, 48, 4);
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.colorSpace = THREE.SRGBColorSpace;
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    const envMesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: envTex, side: THREE.BackSide }));
    envScene.add(envMesh);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(envScene, 0.06).texture;
    pmrem.dispose();
    envTex.dispose();
    geo.dispose();
    (envMesh.material as THREE.Material).dispose();
  } catch {
    // Lights-only PBR still reads premium under the night grade.
  }
}

/**
 * Assemble the full night world. `simplified` drops shadows/secondary lights
 * for mobile + fallback tiers.
 */
export function createTourWorld(scene: THREE.Scene, simplified: boolean): TourRefs {
  HI_RES = !simplified;
  const partial: Partial<TourRefs> = { entryGlow: [], roomAccents: {}, movingCars: [] };

  // Night key: dim blue sky fill + cool moonlight (shadow caster) + warm golden hour bounce.
  scene.add(new THREE.HemisphereLight(0x2a3a58, 0x0c0a08, 0.65));
  const moon = new THREE.DirectionalLight(0x8fa8d8, 0.85);
  moon.position.set(-28, 26, 14);
  moon.castShadow = !simplified;
  moon.shadow.mapSize.set(simplified ? 512 : 1024, simplified ? 512 : 1024);
  moon.shadow.camera.left = -32;
  moon.shadow.camera.right = 32;
  moon.shadow.camera.top = 28;
  moon.shadow.camera.bottom = -24;
  moon.shadow.camera.far = 120;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.02;
  scene.add(moon);
  partial.sunLight = moon;

  // Golden hour key light - warm, directional from upper-left to create depth.
  const keyLight = new THREE.DirectionalLight(0xffa500, 0.45); // warm golden
  keyLight.position.set(-15, 20, -10);
  keyLight.castShadow = !simplified;
  keyLight.shadow.mapSize.set(simplified ? 512 : 1024, simplified ? 512 : 1024);
  keyLight.shadow.camera.left = -32;
  keyLight.shadow.camera.right = 32;
  keyLight.shadow.camera.top = 28;
  keyLight.shadow.camera.bottom = -24;
  keyLight.shadow.camera.far = 120;
  keyLight.shadow.bias = -0.0008;
  keyLight.shadow.radius = 4;
  scene.add(keyLight);

  // Warm fill light to balance shadows without crushing them.
  const fill = new THREE.DirectionalLight(0xff8c00, 0.22); // warmer fill
  fill.position.set(18, 16, 16);
  scene.add(fill);

  // Subtle rim separation light - back/right to outline the villa.
  const rimLight = new THREE.DirectionalLight(0xffd9a0, 0.15); // warm rim
  rimLight.position.set(20, 12, -20);
  rimLight.castShadow = false;
  scene.add(rimLight);

  // Enhanced warm wash over the entrance facade so the door reads cinematically.
  const entryWash = new THREE.PointLight(AMBER, 36, 28, 1.8);
  entryWash.position.set(0, 3.8, 6.5);
  scene.add(entryWash);

  // Slightly stronger cool fill so shadow sides never crush to black.
  const coolFill = new THREE.DirectionalLight(0x5a6a8a, 0.28);
  coolFill.position.set(30, 22, 25);
  scene.add(coolFill);

  buildSky(scene, partial);
  buildGround(scene);
  buildVilla(scene, partial, simplified);
  const interiorSpot = buildInteriorShell(scene, partial, simplified);
  buildLivingRoom(scene, partial);
  buildKitchen(scene, partial);
  buildBedroom(scene, partial);
  buildBathroom(scene, partial);
  buildStairs(scene);
  buildTerrace(scene, simplified);
  buildExterior(scene, partial, simplified);
  buildCity(scene, partial, simplified);
  buildContactShadows(scene);

  if (simplified) {
    interiorSpot.intensity = 40;
  }

  return {
    doorLeft: partial.doorLeft!,
    doorRight: partial.doorRight!,
    handleLeft: partial.handleLeft!,
    entryGlow: partial.entryGlow!,
    poolWater: partial.poolWater!,
    floorSlab: partial.floorSlab!,
    towerGroup: partial.towerGroup!,
    interiorSpot,
    clouds: partial.clouds ?? [],
    roomAccents: partial.roomAccents ?? {},
    movingCars: partial.movingCars ?? [],
    sunLight: partial.sunLight!,
    porchZone: partial.porchZone!,
  };
}
