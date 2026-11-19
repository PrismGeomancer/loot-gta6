/*! INTRO:START */
// Concept: one continuous camera dolly toward a rattling chest in the dark. It stops one beat before the chest opens:
// the visitor does that. This block registers itself on window.LOOT_INTRO; the rest of the app only calls it through
// optional chaining, so deleting everything between the INTRO markers (here, in the CSS and in the <head> script)
// removes the intro without touching anything else.
import { h, clamp } from "./util.js";
import { COPY } from "./copy.js";

const DURATION = 5.0;
const rootEl = () => document.documentElement;

function introLight(t) {
  if (t < 1.5) return 0.05 + 0.04 * (t / 1.5);
  if (t < 3.0) return 0.09 + 0.2 * ((t - 1.5) / 1.5);
  if (t < 3.5) return 0.29 + 0.71 * ((t - 3.0) / 0.5);
  return 1;
}
function introGlow(t) {
  // a seam of gold light on the floor, growing as the chest rattles, then fading as the dolly lands
  if (t < 1.5) return 0.12 + 0.1 * (t / 1.5);
  if (t < 3.0) return 0.22 + 0.6 * ((t - 1.5) / 1.5);
  if (t < 3.6) return 0.82 * (1 - (t - 3.0) / 0.6);
  return 0;
}

window.LOOT_INTRO = {
  available: true,
  /** Plays the intro. Resolves when it ends or is skipped. Never plays twice in a session. */
  run({ scene, chest, onProgress }) {
    return new Promise((resolve) => {
      try { sessionStorage.setItem("loot:intro", "1"); } catch { /* storage blocked: the <head> script already skipped the intro */ }
      const html = rootEl();
      html.classList.add("intro-on");
      html.style.setProperty("--intro-p", "0");
      ctxState.playing = true;

      const caption = h("p.intro-caption", { "aria-live": "polite" }, COPY.intro.captions[0]);
      const skip = h("button.intro-skip", { type: "button" }, COPY.intro.skip);
      const hud = h("div#intro-hud", { role: "presentation" },
        h("p.intro-title", COPY.intro.hud), caption, skip);
      document.body.append(hud);

      let finished = false;
      let start = null;
      let raf = 0;
      let lastCap = 0;
      let rattling = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        cancelAnimationFrame(raf);
        window.removeEventListener("keydown", onKey, true);
        hud.removeEventListener("click", finish);
        // the last frame equals the page's first frame: home camera, chest closed and idle, torches lit
        scene.setIntro(null);
        scene.setRoomLight(1);
        scene.setChestBrightness(1);
        scene.setGlow(0);
        chest.player.still(0);
        html.style.setProperty("--intro-p", "1");
        html.classList.remove("intro-on");
        html.classList.add("intro-out");
        setTimeout(() => html.classList.remove("intro-out"), 700);
        html.style.removeProperty("--intro-p");
        html.style.overflow = "";
        hud.remove();
        ctxState.playing = false;
        window.__introResolve?.();
        resolve();
      };
      const onKey = (e) => {
        if (e.key === "Escape" || e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          finish();
        }
      };
      window.addEventListener("keydown", onKey, true);
      hud.addEventListener("click", finish);
      skip.addEventListener("click", (e) => { e.stopPropagation(); finish(); });
      html.style.overflow = "hidden";
      scene.setIntro(0);

      const tick = (now) => {
        if (finished) return;
        if (start == null) start = now;
        const t = Math.min(DURATION, (now - start) / 1000);
        scene.setIntro(t < 3.5 ? t : 3.5);
        scene.setRoomLight(introLight(t));
        scene.setChestBrightness(0.5 + 0.5 * clamp((t - 0.4) / 3.0, 0, 1));
        scene.setGlow(introGlow(t));
        // 1.5 to 3.5 s: the chest rattles (the first 0.8 s of chest-open, looped, never the lid kick)
        if (t >= 1.5 && t < 3.5) {
          if (!rattling) { rattling = true; chest.player.restart(); }
          else if (chest.sprite.t >= 0.78) chest.player.restart();
        } else if (rattling) {
          rattling = false;
          chest.player.still(0);
        }
        const cap = t < 2 ? 0 : t < 4 ? 1 : 2;
        if (cap !== lastCap || !caption.dataset.set) {
          lastCap = cap;
          caption.dataset.set = "1";
          caption.textContent = COPY.intro.captions[cap];
        }
        // 3.5 to 5 s: the title card fades in over the landed framing
        html.style.setProperty("--intro-p", String(clamp((t - 3.5) / 1.5, 0, 1)));
        ctxState.t = t;
        onProgress?.(t);
        if (t >= DURATION) finish();
        else raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
  },
  reset() { try { sessionStorage.removeItem("loot:intro"); } catch { /* ignore */ } },
};
const ctxState = (window.LOOT_INTRO.state = { playing: false, t: 0 });
/*! INTRO:END */
