// LOOT: boot, router, home room, scene wiring, page transitions.

import { $, $$, h, clear, rich, fmt, local } from "./util.js";
import { COPY } from "./copy.js";
import { cfg, has, ctx, toast, closeModal, modalOpen, isNarrow, isTouch, chestsOpened, setChestsOpened, externalLink } from "./core.js";
import { Sprite, track, mountFx, reducedMotion } from "./fx.js";
import { createScene } from "./scene3d.js";
import { sound } from "./sound.js";
import { quietReconnect } from "./wallet.js";
import { buildTopbar, buildFooter, markNav } from "./ui.js";
import { renderTool } from "./tool.js";
import { renderVote, renderProposal } from "./vote.js";
import { renderHow, renderBoard, renderCredits } from "./board.js";
import "./intro.js";
import { launchClock, isLive, launchDayWelcome } from "./vice.js";
import { radioPlate } from "./radio.js";
import "./cheats.js";

const html = document.documentElement;
const REDUCED = reducedMotion();
const intro = () => window.LOOT_INTRO; // absent when the INTRO block is cut out

// the ambient and hero sprites that feed the room (3D texture) or the plain 2D stage
const hero = { chest: null, coin: null, gem: null, fireflies: null, fog: null, rays: null, chestPlayer: null, loopPlayers: [] };
const home = { opening: false, lidDone: false, el: null };

// ---------------------------------------------------------------------------------------------
// hero chest
// ---------------------------------------------------------------------------------------------
const glowAt = (t) => (t < 0.8 ? 0.28 * (t / 0.8) ** 2 : t < 1.1 ? 1 : t < 3.3 ? 1 - (t - 1.1) / 2.2 : 0);

function chestDrawn(s) {
  if (!home.opening) return;
  ctx.scene?.setGlow(glowAt(s.t));
  if (!home.lidDone && s.t >= 0.8) {
    home.lidDone = true;
    lidKicked();
  }
}

function lidKicked() {
  const n = chestsOpened() + 1;
  setChestsOpened(n);
  sound.blip("coin");
  paintCounter(n, true);
}

function paintCounter(n, play) {
  const el = $("#counter-text");
  if (!el) return;
  el.textContent = fmt(COPY.home.counter, { n });
  const fxBox = $("#counter-fx");
  if (play && fxBox && !REDUCED && ctx.scene) {
    clear(fxBox);
    // ui/coin-collect: `from` is the counter's real previous value and count is the one coin this chest adds,
    // so the HUD in the effect ticks from n-1 to n and shows no invented number.
    mountFx(fxBox, "ui/coin-collect", { scale: 2, scaleSmall: 1.5, opts: { from: n - 1, count: 1 }, onDone: () => clear(fxBox) });
  }
}

function openHomeChest() {
  if (home.opening || ctx.introPlaying || !hero.chestPlayer) return;
  home.opening = true;
  home.lidDone = false;
  sound.blip("open");
  if (REDUCED) {
    // reduced motion: a still frame of the open chest with a short fade, not the 4.6 s sequence
    home.lidDone = true; // counted once, here (drawing the still frame must not count it again)
    lidKicked();
    hero.chestPlayer.still(2.0);
    ctx.scene?.setGlow(0.6);
    fadeChest();
    setTimeout(() => {
      hero.chestPlayer.still(0);
      ctx.scene?.setGlow(0);
      fadeChest();
      home.opening = false;
    }, 1500);
    return;
  }
  hero.chestPlayer.restart();
}

function fadeChest() {
  const s = ctx.scene;
  const c2d = hero.chest.canvas.isConnected ? hero.chest.canvas : null;
  if (c2d) { c2d.classList.remove("fade"); void c2d.offsetWidth; c2d.classList.add("fade"); }
  if (!s) return;
  const t0 = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - t0) / 350);
    s.setChestBrightness(0.25 + 0.75 * k);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function chestDone() {
  hero.chestPlayer.still(0); // back to the closed idle: draw t = 0 and do not advance time
  ctx.scene?.setGlow(0);
  home.opening = false;
}

// ---------------------------------------------------------------------------------------------
// the home room page
// ---------------------------------------------------------------------------------------------
function renderHome(root) {
  const H = COPY.home;
  home.labels = null;
  const card = h("section.title-card.card.cream",
    h("p.eyebrow", isLive() ? COPY.vice.liveEyebrow : H.eyebrow),
    h("h1", rich(H.h1)),
    h("p.lede", H.sentence),
    h("div.btnrow",
      h("button#btn-open-chest.btn.primary", { type: "button", onclick: openHomeChest }, H.primary),
      h("a.btn.ghost", { href: "#/how" }, H.secondary)));
  const stage = h("div#stage.stage");
  const ui = h("div.stage-ui",
    h("p.hint", H.hint),
    h("p#counter-text.counter", fmt(H.counter, { n: chestsOpened() })));
  // ui/coin-collect plays from the chest: its coins fly out to a HUD plate that ticks from n-1 to n
  stage.append(ui, h("div#counter-fx.counter-fx", { "aria-hidden": "true" }));
  const safety = h("p.safety", H.safety);
  root.append(h("div.home-inner", launchClock(), card, stage, safety));
  home.el = stage;

  if (!ctx.scene) {
    // plain version: the same chest and loot on 2D canvases
    const row = h("div.plain-stage");
    const mount = (sprite, label) => {
      const c = sprite.canvas;
      c.classList.add("fx");
      c.style.setProperty("--w", sprite.w); c.style.setProperty("--h", sprite.h);
      c.style.setProperty("--s", 3); c.style.setProperty("--sm", label === "chest" ? 1.6 : 1.5);
      return c;
    };
    const chestBtn = h("button.chest2d", { type: "button", "aria-label": H.primary, onclick: openHomeChest }, mount(hero.chest, "chest"));
    const coin = h("a.plinth-2d", { href: "#/board" }, mount(hero.coin, "coin"), h("span", H.plinths.coin));
    const gem = h("a.plinth-2d", { href: "#/vote" }, mount(hero.gem, "gem"), h("span", H.plinths.gem));
    hero.chestPlayer.detachable = false;
    row.append(coin, chestBtn, gem);
    stage.prepend(row);
    root.prepend(h("p.notice", COPY.states.webgl));
  } else if (!isNarrow() && !isTouch()) {
    // 3D pads: labels float over the plinths and double as keyboard-reachable links
    const labels = [["coin", "#/board"], ["gem", "#/vote"]].map(([id, href]) => h("a.padlabel", { href, "data-pad": id }, H.plinths[id]));
    stage.append(...labels);
    home.labels = labels;
  }
  if (REDUCED) root.append(h("p.notice.small", COPY.states.reduced));
  placeStage();
  // the anchor follows the layout: web fonts, rotation and window resizes all move the stage
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(placeStage);
    ro.observe(stage);
    ro.observe(card);
  }
  document.fonts?.ready.then(placeStage);
  return null;
}

function placeStage() {
  const s = ctx.scene, stage = home.el;
  if (!s || !stage || !stage.isConnected) return;
  const r = stage.getBoundingClientRect();
  s.setAnchor(r.left + r.width / 2, r.top + r.height * 0.62);
}

// ---------------------------------------------------------------------------------------------
// router
// ---------------------------------------------------------------------------------------------
const pages = () => $("#pages");
let shown = null; // the hash currently on screen (or on its way)
let transitioning = false;
let swapDone = true; // false while a transition is still covering the old page

function parse(hash) {
  const raw = (hash || "").replace(/^#\/?/, "");
  const [path, query = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const name = parts[0] || "";
  const known = ["", "main-tool", "vote", "how", "board", "p", "credits"];
  return { name: known.includes(name) ? name : "", arg: parts[1] || "", query: new URLSearchParams(query), raw };
}

function mountPage(r) {
  const root = pages();
  clear(root);
  ctx.route = r;
  const sec = h("section.page", { id: `page-${r.name || "home"}`, class: r.name === "" ? "home" : "", tabindex: "-1", "aria-label": COPY.nav.brand });
  root.append(sec);
  const scrollBox = sec;
  switch (r.name) {
    case "main-tool": renderTool(sec, { mint: r.query.get("mint") || "" }); break;
    case "vote": renderVote(sec); break;
    case "how": renderHow(sec); break;
    case "board": renderBoard(sec); break;
    case "p": renderProposal(sec, decodeURIComponent(r.arg)); break;
    case "credits": renderCredits(sec); break;
    default: renderHome(sec);
  }
  sec.append(buildFooter({ introAvailable: !!intro() && !!ctx.scene }));
  scrollBox.scrollTop = 0;
  markNav(r.name);
  setSceneActive(r.name === "");
  html.dataset.route = r.name || "home";
  if (!html.classList.contains("intro-on")) sec.classList.add("enter");
  try { if (r.name !== "") sec.focus({ preventScroll: true }); } catch { /* ignore */ }
  window.introDone?.then(() => sec.classList.add("enter"));
}

function setSceneActive(on) {
  sceneActive = on;
  for (const p of hero.loopPlayers) { if (on) p.play(); else p.pause(); }
}
let sceneActive = true;

const TRANSITIONS = {
  "transitions/iris": { swapAt: 1.05, speed: 1.5 },
  "transitions/crt-off": { swapAt: 0.8, speed: 1.5 },
};
function runTransition(id, swap) {
  const layer = $("#fxlayer");
  if (!layer || REDUCED || ctx.introPlaying) { swap(); return; }
  transitioning = true;
  swapDone = false;
  const doSwap = swap;
  swap = () => { swapDone = true; doSwap(); };
  clear(layer);
  // a neon wipe in pure CSS (no per-frame script): teal, pink, then night purple cover the screen; the page swaps
  // underneath at full cover and the stripes carry on out the other side
  const wipe = h("div.vice-wipe", { "aria-hidden": "true" }, h("i"), h("i"), h("i"));
  layer.append(wipe);
  setTimeout(() => { try { swap(); } catch (e) { console.error(e); } }, 540);
  setTimeout(() => { wipe.remove(); transitioning = false; }, 1000);
}

let firstRoute = true;
function route() {
  const target = location.hash && location.hash !== "#" ? location.hash : "#/";
  if (target === shown) return;
  const previous = shown;
  shown = target;
  const draw = () => {
    closeModal();
    mountPage(parse(location.hash && location.hash !== "#" ? location.hash : "#/"));
  };
  if (firstRoute || previous == null) { firstRoute = false; draw(); return; }
  if (transitioning) {
    // before the swap: the swap in flight renders whatever the latest hash is. After it: render now, under the overlay.
    if (swapDone) draw();
    return;
  }
  const next = parse(target);
  runTransition(next.name === "" || next.name === "main-tool" ? "transitions/iris" : "transitions/crt-off", draw);
}

/** One click handler for every internal #link. */
function go(hash) {
  if (location.hash !== hash) location.hash = hash;
  route();
}
ctx.go = go;

document.addEventListener("click", (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest && e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  sound.blip("select");
  go(a.getAttribute("href"));
});
window.addEventListener("hashchange", route);
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  if (modalOpen()) { closeModal(); return; }
  if (ctx.introPlaying) return; // the intro handles its own Escape
  if (parse(location.hash).name !== "") go("#/");
});
document.addEventListener("click", (e) => {
  const b = e.target.closest && e.target.closest("#btn-replay");
  if (!b) return;
  replayIntro();
});

// ---------------------------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------------------------
async function replayIntro() {
  if (!intro() || !ctx.scene) return;
  intro().reset();
  window.introDone = new Promise((r) => { window.__introResolve = r; });
  shown = "#/";
  if (location.hash !== "#/") location.hash = "#/";
  mountPage(parse("#/"));
  startIntro();
}

function startIntro() {
  if (!intro() || !ctx.scene) {
    html.classList.remove("intro-on");
    window.__introResolve?.();
    return Promise.resolve();
  }
  ctx.introPlaying = true;
  return intro().run({ scene: ctx.scene, chest: { player: hero.chestPlayer, sprite: hero.chest } }).then(() => { ctx.introPlaying = false; });
}

function sceneLoop() {
  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const s = ctx.scene;
    if (s && !document.hidden && (sceneActive || ctx.introPlaying)) {
      s.render(dt, now / 1000);
      if (home.labels && home.el?.isConnected) {
        const sr = home.el.getBoundingClientRect();
        for (const l of home.labels) {
          const p = s.padScreen(l.dataset.pad);
          l.style.left = `${p.x - sr.left}px`;
          l.style.top = `${p.y - sr.top}px`;
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

async function boot() {
  sound.init(cfg.features.sound);
  const logoSrc = document.querySelector('link[rel="icon"]')?.href || "";
  buildTopbar(logoSrc);
  document.body.append(radioPlate());

  // sprites for the room
  hero.chest = new Sprite("pickups/chest-open", { seed: 3 });
  hero.chestPlayer = track(hero.chest, { mode: "once", autoplay: false, onDraw: chestDrawn, onDone: chestDone });
  hero.chestPlayer.still(0);
  hero.coin = new Sprite("pickups/coin-spin", {});
  hero.gem = new Sprite("pickups/gem-spin", {});
  hero.fireflies = new Sprite("weather/fireflies", {});
  hero.fog = new Sprite("weather/fog", {});
  hero.rays = new Sprite("weather/god-rays", {});
  for (const s of [hero.coin, hero.gem, hero.fireflies, hero.fog, hero.rays]) {
    const p = track(s, { mode: "loop", autoplay: !REDUCED });
    if (REDUCED) p.still(s.duration * 0.35);
    hero.loopPlayers.push(p);
  }

  // the room (three.js); null means CDN or WebGL failed and the plain layout is used
  let scene = null;
  try {
    scene = await createScene($("#scene"), { reduced: REDUCED, narrow: isNarrow() || isTouch() });
  } catch {
    scene = null;
  }
  if (scene) {
    scene.addSprites({ chest: hero.chest, coin: hero.coin, gem: hero.gem, fireflies: hero.fireflies, fog: hero.fog, rays: hero.rays });
    scene.on("pick", (id) => {
      if (id === "chest") openHomeChest();
      else if (id === "coin") go("#/board");
      else if (id === "gem") go("#/vote");
      else if (id === "car") { scene.boostCar(); sound.blip("coin"); toast(COPY.cheats.carHonk); }
    });
    ctx.scene = scene;
    scene.on("phase", (ph) => window.dispatchEvent(new CustomEvent("loot:phase", { detail: ph })));
    window.dispatchEvent(new CustomEvent("loot:scene"));
    html.classList.add("has-3d");
    window.addEventListener("resize", placeStage);
    sceneLoop();
  } else {
    html.classList.add("no-3d");
    if (html.classList.contains("intro-on")) { html.classList.remove("intro-on"); window.__introResolve?.(); }
  }

  route();
  const wantsIntro = html.classList.contains("intro-on");
  if (wantsIntro) await startIntro();
  quietReconnect().catch(() => {});
  window.addEventListener("offline", () => toast(COPY.tool.errors.offline));
  html.classList.add("ready");
  window.introDone?.then(() => { if (ctx.route.name === "") launchDayWelcome(); });
}

window.LOOT_STATE = { get opening() { return home.opening; }, get route() { return ctx.route; }, get introT() { return intro()?.state?.t ?? null; }, get has3d() { return !!ctx.scene; }, get chestScreen() { return ctx.scene?.chestScreen() ?? null; }, get stageRect() { const r = home.el?.getBoundingClientRect(); return r ? { top: r.top, h: r.height, left: r.left, w: r.width } : null; } };
boot();
