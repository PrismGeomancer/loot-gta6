// pixelfx glue. Only the effects in the EFFECT MAP are imported, and they are driven through the public API only:
// createFx(effect, opts), fx.update(dt), fx.draw(frame, layer), composite(frame, img.data, bg), fx.done(), fx.stop().
// Options used: palette, seed, light, flip, angle (plus count/from/text/title that the effects document in meta.options).

import { createFrame, clearFrame, createFx, composite, PAL } from "../pixelfx/src/core/index.js";

// pixelfx colour ramps used for recolours (gold, fire, night)
export { PAL };

import * as chestOpen from "../pixelfx/src/fx/pickups/chest-open.js";
import * as coinSpin from "../pixelfx/src/fx/pickups/coin-spin.js";
import * as gemSpin from "../pixelfx/src/fx/pickups/gem-spin.js";
import * as collectBurst from "../pixelfx/src/fx/pickups/collect-burst.js";
import * as coinCollect from "../pixelfx/src/fx/ui/coin-collect.js";
import * as xpOrb from "../pixelfx/src/fx/pickups/xp-orb.js";
import * as lootBeam from "../pixelfx/src/fx/pickups/loot-beam.js";
import * as hologram from "../pixelfx/src/fx/scifi/hologram.js";
import * as heartLost from "../pixelfx/src/fx/ui/heart-lost.js";
import * as questComplete from "../pixelfx/src/fx/ui/quest-complete.js";
import * as achievement from "../pixelfx/src/fx/ui/achievement.js";
import * as iris from "../pixelfx/src/fx/transitions/iris.js";
import * as crtOff from "../pixelfx/src/fx/transitions/crt-off.js";
import * as fireflies from "../pixelfx/src/fx/weather/fireflies.js";
import * as fog from "../pixelfx/src/fx/weather/fog.js";
import * as godRays from "../pixelfx/src/fx/weather/god-rays.js";
import * as keyGlint from "../pixelfx/src/fx/pickups/key-glint.js";
import * as potion from "../pixelfx/src/fx/pickups/potion.js";
import * as heartPickup from "../pixelfx/src/fx/pickups/heart-pickup.js";
import * as crystalShard from "../pixelfx/src/fx/pickups/crystal-shard.js";
import * as powerStar from "../pixelfx/src/fx/pickups/power-star.js";
import * as featherBurst from "../pixelfx/src/fx/holy/feather-burst.js";
import * as confetti from "../pixelfx/src/fx/ui/confetti.js";

export const FX = {
  "pickups/chest-open": chestOpen,
  "pickups/coin-spin": coinSpin,
  "pickups/gem-spin": gemSpin,
  "pickups/collect-burst": collectBurst,
  "ui/coin-collect": coinCollect,
  "pickups/xp-orb": xpOrb,
  "pickups/loot-beam": lootBeam,
  "scifi/hologram": hologram,
  "ui/heart-lost": heartLost,
  "ui/quest-complete": questComplete,
  "ui/achievement": achievement,
  "transitions/iris": iris,
  "transitions/crt-off": crtOff,
  "weather/fireflies": fireflies,
  "weather/fog": fog,
  "weather/god-rays": godRays,
  "pickups/key-glint": keyGlint,
  "pickups/potion": potion,
  "pickups/heart-pickup": heartPickup,
  "pickups/crystal-shard": crystalShard,
  "pickups/power-star": powerStar,
  "holy/feather-burst": featherBurst,
  "ui/confetti": confetti,
};
export const FX_IDS = Object.keys(FX);

export const reducedMotion = () => {
  try {
    return matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** One effect rendered at its native pixel size into an offscreen canvas (transparent background). */
export class Sprite {
  constructor(id, opts = {}) {
    this.id = id;
    this.mod = FX[id];
    if (!this.mod) throw new Error(`unknown effect ${id}`);
    this.meta = this.mod.meta;
    [this.w, this.h] = this.meta.size;
    const [ox, oy] = this.meta.origin;
    this.frame = createFrame(this.w, this.h);
    this.img = new ImageData(this.w, this.h);
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.ctx = this.canvas.getContext("2d");
    this.opts = { x: ox, y: oy, ...opts };
    this.version = 0;
    this.restart();
  }
  restart(extra) {
    if (extra) Object.assign(this.opts, extra);
    this.fx = createFx(this.mod, this.opts);
  }
  update(dt) {
    this.fx.update(dt);
  }
  /** Jump to time t (re-simulates from 0 in 1/30 s steps so simulated effects stay correct). */
  seek(t) {
    this.restart();
    const step = 1 / 30;
    for (let a = 0; a < t - 1e-9; a += step) this.fx.update(Math.min(step, t - a));
  }
  draw() {
    clearFrame(this.frame);
    this.fx.draw(this.frame);
    composite(this.frame, this.img.data, null);
    this.ctx.putImageData(this.img, 0, 0);
    this.version++;
  }
  get t() {
    return this.fx.t;
  }
  get duration() {
    return this.meta.duration;
  }
  get loop() {
    return !!this.meta.loop;
  }
  done() {
    return this.fx.done();
  }
  stop() {
    this.fx.stop();
  }
}

// ---- one ticker for every live effect ----
const STEP = 1 / 30; // loops are capped to 30 fps
const players = new Set();
let raf = 0;
let last = 0;
const io = typeof IntersectionObserver === "function"
  ? new IntersectionObserver((entries) => {
      for (const e of entries) for (const p of players) if (p.el === e.target) p.visible = e.isIntersecting;
    })
  : null;

/**
 * Put a sprite under the ticker.
 * mode "loop": advances at 30 fps; "once": plays to its end at display rate, then calls onDone.
 * A player whose element has left the document removes itself. Off-screen players do not advance.
 */
export function track(sprite, { mode, el = sprite.canvas, onDraw, onDone, speed = 1, autoplay = true } = {}) {
  const p = {
    sprite, el, mode: mode || (sprite.loop ? "loop" : "once"), onDraw, onDone, speed,
    detachable: false, running: autoplay, visible: true, acc: 0, finished: false,
    play() { this.running = true; this.finished = false; start(); },
    pause() { this.running = false; },
    restart(extra) { sprite.restart(extra); this.acc = 0; this.finished = false; this.running = true; sprite.draw(); onDraw?.(sprite); start(); },
    still(t = 0) { sprite.seek(t); sprite.draw(); onDraw?.(sprite); this.running = false; },
    dispose() { players.delete(this); io?.unobserve(el); },
  };
  players.add(p);
  // only canvases that are actually on the page are throttled when off-screen (room textures never are)
  if (io && el instanceof Element && el.isConnected) io.observe(el);
  sprite.draw();
  onDraw?.(sprite);
  start();
  return p;
}

function start() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(frame);
}

function frame(now) {
  raf = 0;
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!document.hidden) {
    for (const p of [...players]) {
      if (p.detachable && !p.el.isConnected) { p.dispose(); continue; }
      if (!p.running || !p.visible) continue;
      try {
      if (p.mode === "loop") {
        p.acc += dt * p.speed;
        if (p.acc < STEP * 0.98) continue;
        p.sprite.update(p.acc);
        p.acc = 0;
      } else {
        p.sprite.update(dt * p.speed);
      }
      p.sprite.draw();
      p.onDraw?.(p.sprite);
      if (p.mode === "once" && !p.finished && p.sprite.done()) {
        p.finished = true;
        p.running = false;
        p.onDone?.(p.sprite);
      }
      } catch (e) { console.error(e); p.running = false; }
    }
  }
  // keep ticking while anything can still move
  for (const p of players) if (p.running) { raf = requestAnimationFrame(frame); return; }
}

/**
 * Create a sprite, size its canvas in whole CSS pixels, append it to host and put it under the ticker.
 * Detached canvases are dropped from the ticker automatically (pages are rebuilt on every visit).
 * Under reduced motion loops are drawn as one still frame and one-shots show their last meaningful frame
 * only when `stillAt` is given.
 */
export function mountFx(host, id, { scale = 3, scaleSmall, opts = {}, mode, speed = 1, autoplay = true, stillAt, className = "fx", onDone, label } = {}) {
  const sprite = new Sprite(id, opts);
  const c = sprite.canvas;
  c.className = className;
  // size comes from CSS (.fx uses --w --h --s, and --sm on phones) so it can change with the viewport
  c.style.setProperty("--w", sprite.w);
  c.style.setProperty("--h", sprite.h);
  c.style.setProperty("--s", scale);
  c.style.setProperty("--sm", scaleSmall ?? scale);
  c.setAttribute("aria-hidden", "true");
  if (label) { c.setAttribute("role", "img"); c.setAttribute("aria-label", label); c.removeAttribute("aria-hidden"); }
  host.append(c);
  const player = track(sprite, { mode, speed, autoplay, onDone });
  player.detachable = true;
  if (reducedMotion()) {
    const t = stillAt ?? (sprite.loop ? sprite.duration * 0.35 : 0);
    player.still(t);
  }
  return player;
}
