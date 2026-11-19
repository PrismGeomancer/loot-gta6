// The Vice layer: GTA VI countdown, wanted-level stars and the mission stingers. Pure DOM, no assets.
// Launch date comes from LOOT_CONFIG.gtaLaunch (an ISO string; no timezone means the visitor's local time).

import { h, clear, session } from "./util.js";
import { mountFx } from "./fx.js";
import { toast } from "./core.js";
import { COPY } from "./copy.js";
import { cfg } from "./core.js";
import { reducedMotion } from "./fx.js";

const V = COPY.vice;
const pad = (n) => String(n).padStart(2, "0");

const launchAt = () => Date.parse(cfg.gtaLaunch || "2026-11-19T00:00:00");
/** True once GTA VI is out: the config says so, or the launch time has passed. */
export const isLive = () => !!cfg.gtaLive || Date.now() >= launchAt();

/** Cash rain over the whole page. Used by the HESOYAM cheat and the launch-day welcome. */
export function rain() {
  if (reducedMotion()) return;
  const box = h("div.cheat-fx", { "aria-hidden": "true" });
  document.body.append(box);
  mountFx(box, "ui/confetti", { scale: 6, scaleSmall: 3, onDone: () => box.remove() });
  setTimeout(() => box.remove(), 6000);
}
/** A red/blue siren wash across the screen. */
export function siren(ms = 3500) {
  const el = h("div.siren-wash", { "aria-hidden": "true" });
  document.body.append(el);
  setTimeout(() => el.remove(), ms);
}
/** Once per browser session, the first time the home page shows after launch: sirens, cash rain, a toast. */
export function launchDayWelcome() {
  if (!isLive() || session.get("loot:welcomed", false)) return;
  session.set("loot:welcomed", true);
  setTimeout(() => { rain(); siren(2600); toast(V.liveToast, 4200); }, 900);
}

/** The home plate: a live countdown before launch, a LIVE plate with a scrolling ticker after it. */
export function launchClock() {
  const t = launchAt();
  if (isLive()) {
    const days = Number.isFinite(t) ? Math.max(1, Math.floor((Date.now() - t) / 86400000) + 1) : 1;
    const track = h("span.vc-marquee-track", V.liveMarquee.repeat(3));
    return h("section.vi-clock.live", { "aria-label": V.liveTitle },
      h("span.vc-logo", "VI"),
      h("div.vc-body",
        h("p.vc-title", h("i.live-dot"), V.liveTitle, h("span.vc-day", V.liveDay.replace("{n}", String(days)))),
        h("div.vc-marquee", { "aria-hidden": "true" }, track)));
  }
  if (!Number.isFinite(t)) return null;
  const cell = (label) => {
    const n = h("b", "00");
    return { n, el: h("div.vc-cell", n, h("small", label)) };
  };
  const cells = V.units.map(cell);
  const title = h("p.vc-title", V.clockTitle);
  const box = h("section.vi-clock", { "aria-label": V.clockTitle }, h("span.vc-logo", "VI"), h("div.vc-body", title, h("div.vc-cells", cells.map((c) => c.el))));
  let timer = 0;
  const tick = () => {
    if (!box.isConnected) { clearInterval(timer); return; }
    const ms = t - Date.now();
    if (ms <= 0) {
      box.classList.add("live");
      title.textContent = V.clockLive;
      cells.forEach((c) => (c.n.textContent = "00"));
      return;
    }
    const s = Math.floor(ms / 1000);
    const parts = [Math.floor(s / 86400), Math.floor(s / 3600) % 24, Math.floor(s / 60) % 60, s % 60];
    parts.forEach((v, i) => (cells[i].n.textContent = pad(v)));
    box.dataset.urgent = ms < 86400000 ? "1" : "0";
  };
  tick();
  timer = setInterval(tick, 1000);
  return box;
}

/** Five stars. Clean = none lit, Wanted = three, Busted = all five with the siren glow. */
export function wantedStars(key) {
  const n = { solid: 0, shaky: 3, nogo: 5, cant: 0 }[key] ?? 0;
  const row = h("div.wanted", { class: `lvl-${key}`, role: "img", "aria-label": fmtLevel(n) });
  for (let i = 0; i < 5; i++) row.append(h("span.star", { class: i < n ? "on" : "", style: { "--i": i } }, "★"));
  return row;
}
const fmtLevel = (n) => V.wantedLevel.replace("{n}", String(n));

/** The full-screen mission result: MISSION PASSED / WANTED / WASTED. Click or wait to dismiss. */
export function stinger(key) {
  const spec = V.stingers[key];
  if (!spec || reducedMotion()) return;
  document.querySelector(".stinger")?.remove();
  const el = h("div.stinger", { class: `st-${key}`, role: "status", "aria-live": "polite" },
    h("div.st-big", spec.big), h("div.st-small", spec.small));
  document.body.append(el);
  const kill = () => { el.classList.add("out"); setTimeout(() => el.remove(), 500); };
  el.addEventListener("click", kill);
  setTimeout(kill, key === "nogo" ? 2800 : 2300);
}
