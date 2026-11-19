// Tiny WebAudio blips. Nothing is downloaded. Off by default; the toggle in the top bar turns it on.

import { local } from "./util.js";

let ctx = null;
let on = false;
const listeners = new Set();

export const sound = {
  get on() { return on; },
  init(defaultOn) {
    const saved = local.get("loot:sound", null);
    on = saved == null ? !!defaultOn : !!saved;
  },
  toggle() {
    on = !on;
    local.set("loot:sound", on);
    if (on) this.blip("select");
    listeners.forEach((f) => f(on));
    return on;
  },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  blip(kind = "select") {
    if (!on) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      const notes = {
        select: [[660, 0.05]],
        coin: [[988, 0.06], [1319, 0.12]],
        open: [[196, 0.08], [262, 0.08], [392, 0.16]],
        good: [[523, 0.07], [659, 0.07], [784, 0.14]],
        warn: [[330, 0.1], [277, 0.14]],
        bad: [[220, 0.12], [165, 0.2]],
      }[kind] || [[660, 0.05]];
      let at = t;
      for (const [f, d] of notes) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "square";
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.05, at + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, at + d);
        o.connect(g).connect(ctx.destination);
        o.start(at);
        o.stop(at + d + 0.02);
        at += d * 0.9;
      }
    } catch {
      /* audio unavailable: stay silent */
    }
  },
};
