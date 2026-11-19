// The dungeon room: a real three.js scene. Pixelfx canvases are CanvasTextures (NearestFilter, no mipmaps) on planes
// that face the camera, so pixel art lives inside real 3D. three.js is imported dynamically from the pinned importmap;
// if the CDN or WebGL fails, createScene() resolves to null and the page shows the plain 2D layout.

import { PAL } from "../pixelfx/src/core/index.js";

const PX = 0.05; // world units per effect pixel
const HOME_Z = 7.4;
const hexNum = (s) => parseInt(s.slice(1), 16);

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const shade = (hex, k) => {
  const n = hexNum(hex);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
};

/** A small tileable stone texture drawn pixel by pixel. kind: "brick" | "flag" | "plinth" */
function stoneCanvas(kind, seed) {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  const rnd = mulberry(seed);
  const base = kind === "brick" ? "#241a30" : kind === "flag" ? "#2b2639" : "#5a2a9a";
  g.fillStyle = shade("#2a0a52", 0.8);
  g.fillRect(0, 0, S, S);
  const rowH = kind === "brick" ? 8 : 16;
  const colW = kind === "brick" ? 16 : 32;
  for (let ry = 0; ry < S / rowH; ry++) {
    const off = kind === "flag" ? 0 : ry % 2 ? colW / 2 : 0;
    for (let cx = -1; cx < S / colW + 1; cx++) {
      const x0 = cx * colW + off, y0 = ry * rowH;
      const tint = 0.82 + rnd() * 0.36;
      g.fillStyle = shade(base, tint);
      g.fillRect(x0 + 1, y0 + 1, colW - 1, rowH - 1);
      g.fillStyle = shade(base, tint * 1.35); // lit top edge
      g.fillRect(x0 + 1, y0 + 1, colW - 1, 1);
      g.fillStyle = shade(base, tint * 0.7); // shaded underside
      g.fillRect(x0 + 1, y0 + rowH - 1, colW - 1, 1);
      for (let i = 0; i < colW * rowH * 0.07; i++) {
        g.fillStyle = shade(base, tint * (0.6 + rnd() * 0.9));
        g.fillRect(x0 + 1 + Math.floor(rnd() * (colW - 2)), y0 + 1 + Math.floor(rnd() * (rowH - 2)), 1, 1);
      }
    }
  }
  return c;
}

const FLAME_W = 12, FLAME_H = 20;
const rgbOf = (hex) => [(hexNum(hex) >> 16) & 255, (hexNum(hex) >> 8) & 255, hexNum(hex) & 255];
const PINK_FLAME = ["#2a0630", "#6e0f6a", "#b0188f", "#ff2e93", "#ff7ac0", "#ffc2e4", "#ffffff"].map(rgbOf);
const TEAL_FLAME = ["#04182a", "#08405a", "#0c7a8a", "#19e3d1", "#6af5e6", "#c2fff8", "#ffffff"].map(rgbOf);
function drawFlame(ctx, img, t, ramp) {
  const d = img.data;
  d.fill(0);
  for (let y = 0; y < FLAME_H; y++) {
    const ny = y / (FLAME_H - 1); // 0 top .. 1 bottom
    const half = Math.sin(Math.PI * Math.pow(ny, 0.75)) * (FLAME_W / 2 - 1) * (0.55 + 0.45 * ny);
    for (let x = 0; x < FLAME_W; x++) {
      const dx = x + 0.5 - FLAME_W / 2 + Math.sin(t * 9 + y * 0.55) * (1 - ny) * 1.6;
      const edge = 1 - Math.abs(dx) / Math.max(0.5, half);
      if (edge <= 0) continue;
      const wob = 0.12 * Math.sin(t * 14 + x * 1.7 + y * 0.9);
      const v = Math.min(1, Math.max(0, edge * 1.1 + (ny - 0.5) * 0.5 + wob));
      const step = Math.min(ramp.length - 1, Math.floor(v * ramp.length));
      const [r, gg, b] = ramp[step];
      const i = (y * FLAME_W + x) * 4;
      d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

const SKY_W = 320, SKY_H = 120;
// gradient stops from the horizon (0) up to the zenith (1) for each phase: 0 day, 1 sunset, 2 night, 3 dawn
const SKY_STOPS = [
  [[0, "#ffd9b0"], [0.12, "#ff9ec7"], [0.28, "#7fd4ff"], [0.5, "#2fa8ff"], [1, "#1a6bff"]],
  [[0, "#ffc247"], [0.1, "#ff8a3d"], [0.2, "#ff4f6d"], [0.3, "#ff2e93"], [0.42, "#b02bd6"], [0.58, "#561a9e"], [0.8, "#2a0a52"], [1, "#12062b"]],
  [[0, "#6a1f9a"], [0.12, "#44137a"], [0.3, "#240b56"], [0.6, "#100538"], [1, "#07021c"]],
  [[0, "#ffcf8a"], [0.1, "#ff9a8b"], [0.22, "#e86bd0"], [0.4, "#8a55e0"], [0.65, "#3a2a9a"], [1, "#1a1060"]],
];
/** One phase of the sky gradient (banded, no sun: the sun and moon are separate sprites that travel across it). */
function skyGradCanvas(phase) {
  const c = document.createElement("canvas");
  c.width = SKY_W; c.height = SKY_H;
  const g = c.getContext("2d");
  const rnd = mulberry(77 + phase);
  const stops = SKY_STOPS[phase];
  const col = (t) => {
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
        const k = (t - t0) / (t1 - t0), A = rgbOf(c0), B = rgbOf(c1);
        return `rgb(${A.map((v, j) => Math.round(v + (B[j] - v) * k)).join(",")})`;
      }
    }
    return stops[stops.length - 1][1];
  };
  for (let y = 0; y < SKY_H; y += 3) { g.fillStyle = col((SKY_H - y) / SKY_H); g.fillRect(0, y, SKY_W, 3); }
  const stars = phase === 2 ? 70 : phase === 3 ? 16 : 0;
  g.fillStyle = "#ffffff";
  for (let i = 0; i < stars; i++) { g.globalAlpha = 0.35 + rnd() * 0.65; const big = rnd() > 0.92; g.fillRect(Math.floor(rnd() * SKY_W), Math.floor(rnd() * 62), big ? 2 : 1, big ? 2 : 1); }
  g.globalAlpha = 1;
  if (phase === 0) {                                   // pixel clouds
    for (const [x, y, w] of [[26, 70, 34], [118, 60, 44], [214, 74, 38], [270, 58, 30], [72, 88, 28]]) {
      g.fillStyle = "#ffe9f6"; g.fillRect(x, y, w, 4); g.fillRect(x + 4, y - 3, w - 12, 3); g.fillRect(x + 10, y - 6, Math.floor(w / 2), 3);
      g.fillStyle = "#ffb5da"; g.fillRect(x + 2, y + 4, w - 4, 2);
    }
  } else {                                             // streak clouds
    g.fillStyle = phase === 2 ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.2)";
    for (const [x, y, w] of [[30, 66, 54], [220, 60, 70], [90, 76, 40], [250, 82, 38]]) g.fillRect(x, y, w, 1);
  }
  return c;
}
/** The skyline in two matching layers: silhouettes, and the lit windows that glow at night. */
function skylineCanvases() {
  const mk = () => { const c = document.createElement("canvas"); c.width = SKY_W; c.height = SKY_H; return c; };
  const A = mk(), B = mk();
  const ga = A.getContext("2d"), gb = B.getContext("2d");
  const city = (base, color, lit, hMin, hMax, wMin, wMax, seed) => {
    const r = mulberry(seed);
    let x = -4;
    while (x < SKY_W) {
      const w = wMin + Math.floor(r() * (wMax - wMin)), hh = hMin + Math.floor(r() * (hMax - hMin));
      ga.fillStyle = color;
      ga.fillRect(x, base - hh, w, hh + 2);
      if (r() > 0.7) ga.fillRect(x + Math.floor(w / 2), base - hh - 4, 1, 4);
      for (let wy = base - hh + 3; wy < base - 2; wy += 3) for (let wx = x + 2; wx < x + w - 1; wx += 3) {
        if (r() > 0.78) { gb.fillStyle = lit[Math.floor(r() * lit.length)]; gb.fillRect(wx, wy, 1, 1); }
      }
      x += w + Math.floor(r() * 2);
    }
  };
  city(112, "#7a4ab5", ["#ff7ac8", "#8aa0ff"], 10, 24, 6, 12, 5);
  city(120, "#3d1a78", ["#ff2e93", "#19e3d1", "#ffd36b"], 6, 18, 8, 16, 9);
  return [A, B];
}
/** The striped sun, 44x44. */
function sunCanvas() {
  const S = 44, R = 21;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  for (let y = -R; y <= R; y++) {
    if (y > 1 && ((y + 40) % Math.max(2, 6 - Math.floor(y / 4))) < Math.floor(y / 3.2)) continue;
    const half = Math.floor(Math.sqrt(R * R - y * y));
    const t = (y + R) / (2 * R);
    g.fillStyle = t < 0.45 ? "#ffe86a" : t < 0.7 ? "#ffa23a" : "#ff3d86";
    g.fillRect(R - half + 1, R + y + 1, half * 2, 1);
  }
  return c;
}
/** A pale pixel moon with craters, 32x32. */
function moonCanvas() {
  const S = 32, R = 14;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  for (let y = -R; y <= R; y++) {
    const half = Math.floor(Math.sqrt(R * R - y * y));
    g.fillStyle = "#fff3d6"; g.fillRect(16 - half, 16 + y, half * 2, 1);
  }
  g.fillStyle = "#d9c6f0";
  for (const [x, y, w, h] of [[10, 10, 4, 3], [18, 17, 5, 4], [12, 20, 3, 3], [20, 9, 3, 2]]) g.fillRect(x, y, w, h);
  g.fillStyle = "rgba(255,46,147,0.35)";               // neon rim
  g.fillRect(2, 14, 1, 4); g.fillRect(29, 14, 1, 4);
  return c;
}

/** One tile of the neon road grid. */
function gridCanvas() {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.fillStyle = "#1b0645"; g.fillRect(0, 0, S, S);
  g.fillStyle = "#23085a"; g.fillRect(0, 0, S, S / 2);
  g.fillStyle = "#19e3d1"; g.globalAlpha = 0.55; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S); g.globalAlpha = 1;
  g.fillStyle = "#ff2e93"; g.fillRect(0, 0, S, 3); g.fillRect(0, 0, 3, S);
  g.fillStyle = "#ff9ad0"; g.fillRect(0, 0, S, 1); g.fillRect(0, 0, 1, S);
  return c;
}

/** A silhouette palm tree, 48x72. */
function palmCanvas(seed, color) {
  const W = 48, H = 72;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const rnd = mulberry(seed);
  g.fillStyle = color;
  const lean = rnd() > 0.5 ? 1 : -1;
  let tx = 24, ty = H;
  for (let y = H - 1; y > 24; y--) {            // trunk, bending
    tx = 24 + lean * Math.pow((H - y) / (H - 24), 2) * 4;
    g.fillRect(Math.round(tx), y, y > H - 10 ? 3 : 2, 1);
  }
  const hx = Math.round(tx), hy = 24;
  const fronds = [[-1, 1.0, 0.8], [-1, 0.6, 0.3], [-1, 0.9, -0.1], [1, 1.0, 0.8], [1, 0.6, 0.3], [1, 0.9, -0.1], [0, 0.5, 1.1]];
  for (const [dir, len, lift] of fronds) {
    const L = Math.round(20 * len);
    for (let k = 0; k <= L; k++) {
      const x = hx + dir * k, y = hy - lift * k * 0.55 + (k * k) / (L * 1.6);
      g.fillRect(Math.round(x), Math.round(y), 2, 2);
      if (k % 3 === 0 && k > 3) { g.fillRect(Math.round(x), Math.round(y) + 2, 1, 2 + (k % 2)); g.fillRect(Math.round(x), Math.round(y) - 1, 1, 1); } // leaflets
    }
  }
  g.fillRect(hx - 1, hy, 4, 3);                 // crown
  return c;
}

/** The cruiser: a pink convertible with two heads in it, 40x14, facing right. */
function carCanvas() {
  const W = 40, H = 14;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  const px = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
  px(5, 12, 30, 1, "rgba(25,227,209,0.55)");                 // underglow
  px(3, 7, 34, 4, "#ff2e93");                                // body
  px(3, 7, 34, 1, "#ff9ad0");
  px(3, 10, 34, 1, "#b0188f");
  px(28, 5, 7, 2, "#ff2e93");                                // hood rise
  px(23, 3, 1, 4, "#ffe86a");                                // windshield
  px(24, 3, 1, 1, "#ffffff");
  px(8, 5, 12, 2, "#7a1470");                                // seat back
  px(11, 1, 3, 3, "#ffd36b"); px(12, 2, 2, 1, "#1d0638");   // driver + shades
  px(16, 2, 3, 3, "#ff9ad0"); px(17, 3, 2, 1, "#1d0638");   // passenger + shades
  px(1, 8, 2, 2, "#ff2e3d"); px(0, 8, 1, 2, "rgba(255,46,61,0.45)");     // tail light + glow
  px(37, 8, 2, 2, "#ffffff"); px(39, 8, 1, 2, "rgba(255,240,160,0.6)");  // headlight
  for (const wx of [7, 28]) {
    px(wx, 10, 5, 4, "#12062b"); px(wx + 1, 11, 3, 2, "#4a1275"); px(wx + 2, 12, 1, 1, "#19e3d1");
  }
  return c;
}

export async function createScene(host, { reduced = false, narrow = false } = {}) {
  let THREE;
  try {
    THREE = await import("three");
  } catch {
    return null;
  }
  let renderer;
  const canvas = document.createElement("canvas");
  canvas.className = "scene3d";
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
    if (!renderer.getContext()) return null;
  } catch {
    return null;
  }
  renderer.setClearColor(0x12062b, 1);
  host.append(canvas);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12062b);
  scene.fog = new THREE.Fog(0x2a0a52, 8, 27);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 80);

  // ---------- the Leonida strip: sky, neon road, palms, neon torches ----------
  const px8 = (cnv) => {
    const t = new THREE.CanvasTexture(cnv);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const gridTex = new THREE.CanvasTexture(gridCanvas());
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
  gridTex.repeat.set(22, 22);
  gridTex.anisotropy = 8;
  gridTex.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(44, 44), new THREE.MeshBasicMaterial({ map: gridTex }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -4);
  scene.add(floor);
  // ---- the sky: four gradient layers crossfaded by the time of day, a sun and a moon on arcs, a skyline with windows ----
  const skyLayers = [0, 1, 2, 3].map((i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(88, 33), new THREE.MeshBasicMaterial({ map: px8(skyGradCanvas(i)), fog: false, transparent: true, depthWrite: false }));
    m.position.set(0, 16.5, -25);
    scene.add(m);
    return m;
  });
  const sunMesh = new THREE.Mesh(new THREE.PlaneGeometry(44 * 0.28, 44 * 0.28), new THREE.MeshBasicMaterial({ map: px8(sunCanvas()), fog: false, transparent: true, depthWrite: false }));
  sunMesh.position.set(0, 8, -24.9); sunMesh.renderOrder = -1; scene.add(sunMesh);
  const moonMesh = new THREE.Mesh(new THREE.PlaneGeometry(32 * 0.28, 32 * 0.28), new THREE.MeshBasicMaterial({ map: px8(moonCanvas()), fog: false, transparent: true, depthWrite: false }));
  moonMesh.position.set(0, -9, -24.9); moonMesh.renderOrder = -1; scene.add(moonMesh);
  const [lineA, lineB] = skylineCanvases();
  const skyline = new THREE.Mesh(new THREE.PlaneGeometry(88, 33), new THREE.MeshBasicMaterial({ map: px8(lineA), fog: false, transparent: true, depthWrite: false }));
  skyline.position.set(0, 16.5, -24.8); skyline.renderOrder = 0; scene.add(skyline);
  const windows = new THREE.Mesh(new THREE.PlaneGeometry(88, 33), new THREE.MeshBasicMaterial({ map: px8(lineB), fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
  windows.position.set(0, 16.5, -24.79); windows.renderOrder = 0; scene.add(windows);
  const sky = skyline; // (kept for the intro dimming list below)
  const swayers = [];
  const palm = (x, z, h, seed, flip) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(48 * 0.14 * h, 72 * 0.14 * h), new THREE.MeshBasicMaterial({ map: px8(palmCanvas(seed, "#0d0224")), transparent: true, depthWrite: false, fog: false }));
    m.position.set(x, 72 * 0.14 * h * 0.5 - 0.1, z);
    m.scale.x = flip ? -1 : 1;
    m.renderOrder = 0;
    m.userData.sway = seed;
    scene.add(m);
    swayers.push(m);
    return m;
  };
  const palms = [palm(-7.2, -6, 0.8, 11, false), palm(7.4, -6.6, 0.9, 12, true), palm(-11.5, -12, 1.2, 13, true), palm(12, -13, 1.25, 14, false), palm(-2.6, -17, 1.0, 15, false), palm(3.4, -19, 1.1, 16, true)];
  const carTex = px8(carCanvas());
  const car = new THREE.Mesh(new THREE.PlaneGeometry(40 * 0.085, 14 * 0.085), new THREE.MeshBasicMaterial({ map: carTex, transparent: true, depthWrite: false, fog: false }));
  car.position.set(-20, 14 * 0.085 * 0.5, -4.6);
  car.renderOrder = 1;
  scene.add(car);
  const carState = { x: -20, dir: 1, wait: 3, boost: 0 };
  const carHit = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.8), new THREE.MeshBasicMaterial({ visible: false }));
  carHit.position.set(-20, 0.9, -4.5);
  carHit.userData.pad = "car";
  scene.add(carHit);

  // ---------- lights ----------
  const ambient = new THREE.AmbientLight(0x8a5cff, 1.0);
  scene.add(ambient);
  const torchLights = [];
  const torchFlames = [];
  const flameDefs = [{ ramp: PINK_FLAME, color: 0xff2e93 }, { ramp: TEAL_FLAME, color: 0x19e3d1 }];
  for (const [i, sx] of [-1, 1].entries()) {
    const def = flameDefs[i];
    const cnv = document.createElement("canvas");
    cnv.width = FLAME_W; cnv.height = FLAME_H;
    const fctx = cnv.getContext("2d");
    const fimg = new ImageData(FLAME_W, FLAME_H);
    const ftex = new THREE.CanvasTexture(cnv);
    ftex.magFilter = ftex.minFilter = THREE.NearestFilter;
    ftex.generateMipmaps = false;
    ftex.colorSpace = THREE.SRGBColorSpace;
    const x = sx * 5.8;
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.7, 0.14), new THREE.MeshBasicMaterial({ color: def.color }));
    pole.position.set(x, 1.35, -8.8);
    scene.add(pole);
    const cup = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.34), new THREE.MeshBasicMaterial({ color: 0x1d0638 }));
    cup.position.set(x, 2.74, -8.8);
    scene.add(cup);
    const flame = new THREE.Mesh(new THREE.PlaneGeometry(FLAME_W * PX * 0.9, FLAME_H * PX * 0.9), new THREE.MeshBasicMaterial({ map: ftex, transparent: true, depthWrite: false, fog: false }));
    flame.position.set(x, 3.3, -8.7);
    flame.renderOrder = 1;
    scene.add(flame);
    torchFlames.push({ mesh: flame, fctx, fimg, ftex, ramp: def.ramp });
    const light = new THREE.PointLight(def.color, 50, 0, 2);
    light.position.set(x * 0.8, 3.2, -6.5);
    scene.add(light);
    torchLights.push(light);
  }
  // a pink-white fill from the camera side so the plinth fronts read
  const fill = new THREE.PointLight(0xffa0e0, 14, 0, 2);
  fill.position.set(0, 3.2, 6.5);
  scene.add(fill);
  const seamLight = new THREE.PointLight(0xffb400, 0, 0, 2);
  seamLight.position.set(0, 0.9, 1.0);
  scene.add(seamLight);

  // ---------- sprites on planes ----------
  const textures = new Map();
  const watched = [];
  function spriteMesh(sprite, { x = 0, y = 0, z = 0, px = PX, blending = THREE.NormalBlending, order = 2, fog = false } = {}) {
    const t = new THREE.CanvasTexture(sprite.canvas);
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, blending, fog });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sprite.w * px, sprite.h * px), mat);
    const [ox, oy] = sprite.meta.origin;
    mesh.position.set(x + (sprite.w / 2 - ox) * px, y + (oy - sprite.h / 2) * px, z);
    mesh.renderOrder = order;
    scene.add(mesh);
    textures.set(sprite, t);
    watched.push({ sprite, t, v: -1 });
    return mesh;
  }

  let chestMesh = null, coinMesh = null, gemMesh = null, fireMesh = null, fogMesh = null, raysMesh = null;
  const hit = {};
  const padMeshes = [];
  const plinthMat = new THREE.MeshStandardMaterial({ map: px8(stoneCanvas("plinth", 3)), roughness: 0.6, metalness: 0.1, emissive: 0x2a0640 });
  function plinth(x, id) {
    const mat = plinthMat.clone();
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 1.2), mat);
    m.position.set(x, 0.45, -0.4);
    scene.add(m);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.12, 1.35), mat);
    cap.position.set(x, 0.96, -0.4);
    scene.add(cap);
    padMeshes.push({ id, mat, x });
    const h = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.4, 1.6), new THREE.MeshBasicMaterial({ visible: false }));
    h.position.set(x, 1.3, -0.4);
    h.userData.pad = id;
    scene.add(h);
    hit[id] = h;
  }

  function addSprites({ chest, coin, gem, fireflies, fog, rays }) {
    // weather: shafts of light slanting onto the back wall, and low banks of mist along the floor
    if (rays) raysMesh = spriteMesh(rays, { x: 0, y: -0.2, z: -8.6, px: PX * 1.5, blending: THREE.AdditiveBlending, order: 0, fog: false });
    if (fog) {
      // low mist hugging the floor: tiled sideways (sharing one material) so it runs past both screen edges
      fogMesh = spriteMesh(fog, { x: 0, y: -2.1, z: -2.6, px: PX * 1.4, order: 1, fog: false });
      for (const dx of [-fog.w * PX * 1.4, fog.w * PX * 1.4]) {
        const m = fogMesh.clone();
        m.position.x += dx;
        scene.add(m);
      }
    }
    fireMesh = spriteMesh(fireflies, { x: 0, y: -0.9, z: -3.2, px: PX * 1.15, blending: THREE.AdditiveBlending, order: 1, fog: true });
    chestMesh = spriteMesh(chest, { x: 0, y: 0.02, z: 0, order: 3 });
    plinth(-3.5, "coin");
    plinth(3.5, "gem");
    coinMesh = spriteMesh(coin, { x: -3.5, y: 1.02, z: -0.4, order: 2 });
    gemMesh = spriteMesh(gem, { x: 3.5, y: 1.02, z: -0.4, order: 2 });
    const h = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.0), new THREE.MeshBasicMaterial({ visible: false }));
    h.position.set(0, 1.0, 0.2);
    h.userData.pad = "chest";
    scene.add(h);
    hit.chest = h;
    hit.car = carHit;
  }

  // ---------- camera, sizing, anchor ----------
  const PHASES = ["day", "sunset", "night", "dawn"];
  const state = { c: 0.25, mode: "auto", cTarget: null, phase: "sunset", driftK: 1, W: 1, H: 1, anchorX: null, anchorY: null, offX: 0, offY: 0, roomLight: 1, chestK: 1, glow: 0, t: 0, intro: null, dim: 0, px: 0, py: 0 };
  const home = () => {
    const aspect = state.W / state.H;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const needW = narrow ? 4.4 : 10.4;
    const z = Math.max(5.6, needW / (2 * tan * aspect));
    return { pos: new THREE.Vector3(0, 1.55, Math.min(z, 22)), look: new THREE.Vector3(0, 0.95, 0) };
  };
  function applyAnchor() {
    camera.clearViewOffset();
    const hm = home();
    camera.position.copy(hm.pos);
    camera.lookAt(hm.look);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    if (state.anchorX == null) return;
    const v = new THREE.Vector3(0, 0, 0).project(camera);
    const px = (v.x * 0.5 + 0.5) * state.W;
    const py = (-v.y * 0.5 + 0.5) * state.H;
    state.offX = -(state.anchorX - px);
    state.offY = -(state.anchorY - py);
    camera.setViewOffset(state.W, state.H, state.offX, state.offY, state.W, state.H);
  }
  function resize() {
    const W = host.clientWidth || window.innerWidth;
    const H = host.clientHeight || window.innerHeight;
    state.W = W;
    state.H = H;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    camera.aspect = W / H;
    applyAnchor();
  }
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(host);
  window.addEventListener("resize", resize);
  resize();

  // ---------- picking ----------
  const ray = new THREE.Raycaster();
  const ptr = new THREE.Vector2();
  const pointer = { x: 0, y: 0 };
  let hover = null;
  let padsOn = !narrow;
  const listeners = { pick: [], hover: [], phase: [] };
  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ptr.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ptr, camera);
    const hits = ray.intersectObjects(Object.values(hit).filter((o) => padsOn || o.userData.pad === "chest" || o.userData.pad === "car"), false);
    return hits.length ? hits[0].object.userData.pad : null;
  }
  canvas.addEventListener("pointermove", (ev) => {
    pointer.x = (ev.clientX / state.W - 0.5) * 2;
    pointer.y = (ev.clientY / state.H - 0.5) * 2;
    if (state.intro) return;
    const id = pick(ev);
    if (id !== hover) {
      hover = id;
      canvas.style.cursor = id ? "pointer" : "";
      listeners.hover.forEach((f) => f(id));
    }
  });
  canvas.addEventListener("pointerleave", () => {
    if (hover) { hover = null; canvas.style.cursor = ""; listeners.hover.forEach((f) => f(null)); }
  });
  canvas.addEventListener("click", (ev) => {
    if (state.intro) return;
    const id = pick(ev);
    if (id) listeners.pick.forEach((f) => f(id));
  });


  // ---------- time of day ----------
  // c in [0,1): 0 noon, 0.25 sunset, 0.5 midnight, 0.75 dawn. Each keyframe holds for a stretch, then eases to the next.
  const AUTO_SECONDS = 170;
  const KEY = { day: 0, sunset: 0.25, night: 0.5, dawn: 0.75 };
  const TOD = {
    amb: [[0xb8a8ff, 1.5], [0x8a5cff, 1.0], [0x4a3aa0, 0.75], [0x9a6cff, 0.95]],
    fog: [0x8a5ab8, 0x2a0a52, 0x120435, 0x4a2a80],
    skyline: [1.0, 0.8, 0.4, 0.7], floor: [1.0, 1.0, 1.25, 1.0], torch: [22, 50, 82, 38], flame: [0.55, 1, 1.15, 0.85], win: [0, 0.5, 1, 0.2],
  };
  const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const tmpA = new THREE.Color(), tmpB = new THREE.Color();
  const mixNum = (arr, i, j, f) => arr[i] * (1 - f) + arr[j] * f;
  const mixCol = (arr, i, j, f, out) => out.copy(tmpA.setHex(arr[i])).lerp(tmpB.setHex(arr[j]), f);
  const fogColor = new THREE.Color(), ambColor = new THREE.Color();
  function timeOfDay() {
    const x = state.c * 4, i = Math.floor(x) % 4, j = (i + 1) % 4;
    const f = smooth(((x - Math.floor(x)) - 0.2) / 0.6);
    const amb = TOD.amb;
    tmpA.setHex(amb[i][0]); tmpB.setHex(amb[j][0]); ambColor.copy(tmpA).lerp(tmpB, f);
    mixCol(TOD.fog, i, j, f, fogColor);
    const phi = state.c * Math.PI * 2;
    const sunY = 4.2 + Math.cos(phi) * 7.6, moonY = 4.2 - Math.cos(phi) * 7.6;
    return {
      i, j, f, ambI: mixNum(amb.map((a) => a[1]), i, j, f), skylineK: mixNum(TOD.skyline, i, j, f), floorK: mixNum(TOD.floor, i, j, f),
      torch: mixNum(TOD.torch, i, j, f), flameK: mixNum(TOD.flame, i, j, f), win: mixNum(TOD.win, i, j, f),
      sunX: -Math.sin(phi) * 11.5 + Math.max(0, Math.cos(phi)) * 8, sunY, moonX: Math.sin(phi) * 11.5 - Math.max(0, -Math.cos(phi)) * 8, moonY,
    };
  }
  function advanceTime(dt) {
    if (state.cTarget != null) {
      const remaining = (state.cTarget - state.c + 1) % 1;
      const step = reduced ? remaining : Math.min(remaining, dt * 0.4);
      state.c = (state.c + step) % 1;
      if (remaining - step < 1e-4) { state.c = state.cTarget; state.cTarget = null; }
    } else if (state.mode === "auto" && !reduced) {
      state.c = (state.c + dt / AUTO_SECONDS) % 1;
    }
    const ph = PHASES[Math.round(state.c * 4) % 4];
    if (ph !== state.phase) { state.phase = ph; listeners.phase.forEach((fn) => fn(ph, state.mode)); }
  }

  // ---------- frame ----------
  const ease = (u) => u * u * (3 - 2 * u);
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  function introPose(t) {
    // 0 to 1.5 s: far away, slow. 1.5 to 3.5 s: the dolly accelerates and lands exactly on the home framing.
    const hm = home();
    const far = new THREE.Vector3(0.6, 1.0, hm.pos.z + 11);
    const mid = new THREE.Vector3(0.3, 1.1, hm.pos.z + 9.4);
    let pos;
    if (t < 1.5) pos = far.clone().lerp(mid, ease(clamp01(t / 1.5)) * 0.9);
    else {
      const u = clamp01((t - 1.5) / 2.0);
      const f = ease(Math.pow(u, 1.45));
      const from = far.clone().lerp(mid, 0.9);
      pos = from.lerp(hm.pos, f);
    }
    return { pos, look: hm.look };
  }

  function render(dt, nowSec) {
    state.t += dt;
    const t = state.t;
    advanceTime(dt);
    const tod = timeOfDay();
    // pixelfx canvases that changed since the last upload
    for (const w of watched) {
      if (w.sprite.version !== w.v) {
        w.v = w.sprite.version;
        w.t.needsUpdate = true;
      }
    }
    // torches
    const rl = state.roomLight;
    torchLights.forEach((l, i) => {
      const f = reduced ? 1 : 1 + 0.12 * Math.sin(t * 11 + i * 2) + 0.08 * Math.sin(t * 27 + i) + 0.05 * Math.sin(t * 53 + i * 5);
      l.intensity = tod.torch * f * rl;
    });
    ambient.intensity = tod.ambI * (0.25 + 0.75 * rl);
    ambient.color.copy(ambColor);
    scene.fog.color.copy(fogColor);
    fill.intensity = 14 * rl;
    seamLight.intensity = state.glow * 28;
    if (!reduced || state.flameDrawn !== true) {
      torchFlames.forEach((f, i) => { drawFlame(f.fctx, f.fimg, reduced ? 0 : t + i * 0.7, f.ramp); f.ftex.needsUpdate = true; });
      state.flameDrawn = true;
    }
    // the neon road rolls toward the camera; palms sway; the pink cruiser drives past, turns round and comes back
    if (!reduced) {
      gridTex.offset.y = (t * 0.045) % 1;
      for (const p of swayers) p.rotation.z = Math.sin(t * 0.6 + p.userData.sway) * 0.018;
      if (carState.wait > 0) carState.wait -= dt;
      else {
        carState.x += carState.dir * (4.2 + carState.boost * 26) * dt;
        carState.boost = Math.max(0, carState.boost - dt * 0.25);
        if (Math.abs(carState.x) > 21) { carState.dir *= -1; carState.wait = 7; }
        car.scale.x = carState.dir;
        car.position.x = carState.x;
        carHit.position.x = carState.x;
        car.position.y = 14 * 0.085 * 0.5 + Math.sin(t * 9) * 0.012;
      }
    } else { car.position.x = 3.2; }
    if (chestMesh) {
      const k = state.chestK;
      chestMesh.material.color.setRGB(k, k, k);
    }
    // everything unlit by the scene's lights (pixel sprites, flames) dims with the room, so the intro starts in the dark
    const dim = 0.2 + 0.8 * rl;
    for (const m of [coinMesh, gemMesh, car, ...palms]) m?.material.color.setScalar(dim);
    torchFlames.forEach((f) => f.mesh.material.color.setScalar(dim * tod.flameK));
    floor.material.color.setScalar(dim * tod.floorK);
    // sky layers: the current keyframe underneath, the next one fading in on top
    skyLayers.forEach((m, k) => {
      const base = k === tod.i, top = k === tod.j;
      m.visible = base || top;
      m.material.opacity = base ? 1 : tod.f;
      m.renderOrder = base ? -3 : -2;
      m.material.color.setScalar(dim);
    });
    skyline.material.color.setScalar(dim * tod.skylineK);
    windows.material.opacity = tod.win * dim;
    // the sun and moon ride their arcs; the nearer the horizon, the warmer the colour
    sunMesh.position.set(tod.sunX, tod.sunY, -24.9);
    moonMesh.position.set(tod.moonX, tod.moonY, -24.9);
    const warm = (y) => Math.max(0, Math.min(1, (y - 4.2) / 6));
    const sw = warm(tod.sunY), mw = warm(tod.moonY);
    sunMesh.material.color.setRGB(dim, dim * (0.62 + 0.38 * sw), dim * (0.4 + 0.6 * sw));
    moonMesh.material.color.setRGB(dim, dim * (0.8 + 0.2 * mw), dim);
    sunMesh.visible = tod.sunY > -2; moonMesh.visible = tod.moonY > -2;
    // the weather follows the room's light: thick mist in the dark, the rays bloom as the torches catch
    if (raysMesh) raysMesh.material.opacity = 0.22 * Math.max(0, Math.min(1, (rl - 0.25) / 0.75));
    if (fogMesh) { fogMesh.material.opacity = 0.3 - 0.16 * rl; fogMesh.material.color.setScalar(0.35 + 0.65 * rl); }
    for (const p of padMeshes) p.mat.emissive.setHex(hover === p.id ? 0x8a1a66 : 0x2a0640);
    if (coinMesh) coinMesh.scale.setScalar(hover === "coin" ? 1.12 : 1);
    if (gemMesh) gemMesh.scale.setScalar(hover === "gem" ? 1.12 : 1);

    // camera
    let pose;
    if (state.intro != null) pose = introPose(state.intro);
    else {
      pose = home();
      state.driftK = Math.min(1, state.driftK + dt / 2.5);
      if (!reduced) {
        // the drift eases in after the intro lands, so the hand-off has no jump
        pose.pos.x += (Math.sin(t * 0.21) * 0.14 + pointer.x * 0.1) * state.driftK;
        pose.pos.y += (Math.sin(t * 0.17) * 0.05 - pointer.y * 0.04) * state.driftK;
      }
    }
    camera.position.copy(pose.pos);
    camera.lookAt(pose.look);
    camera.updateMatrixWorld(true);
    renderer.render(scene, camera);
  }

  function screenOf(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = canvas.getBoundingClientRect();
    return { x: r.left + (v.x * 0.5 + 0.5) * r.width, y: r.top + (-v.y * 0.5 + 0.5) * r.height };
  }

  return {
    ok: true,
    canvas,
    addSprites,
    render,
    resize,
    setAnchor(x, y) { state.anchorX = x; state.anchorY = y; applyAnchor(); },
    setIntro(t) { state.intro = t; if (t != null) state.driftK = 0; },
    setRoomLight(v) { state.roomLight = v; },
    setChestBrightness(v) { state.chestK = v; },
    setGlow(v) { state.glow = v; },
    chestScreen() { return screenOf(0, 0, 0); },
    padScreen(id) { return screenOf(id === "coin" ? -3.5 : 3.5, 0.42, 0.25); },
    on(type, fn) { listeners[type].push(fn); },
    boostCar() { carState.wait = 0; carState.boost = 1; carState.x = carState.dir > 0 ? Math.min(carState.x, -20) : Math.max(carState.x, 20); },
    setTimeMode(mode, instant = false) {
      if (mode === "auto") { state.mode = "auto"; state.cTarget = null; return; }
      if (!(mode in KEY)) return;
      state.mode = mode;
      if (instant) { state.c = KEY[mode]; state.cTarget = null; } else state.cTarget = KEY[mode];
    },
    timeState() { return { mode: state.mode, phase: state.phase }; },
    setPadsInteractive(on) { padsOn = !!on; },
    dispose() {
      ro?.disconnect();
      window.removeEventListener("resize", resize);
      renderer.dispose();
      canvas.remove();
    },
  };
}
