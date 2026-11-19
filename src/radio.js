// Vice Wave FM: a tiny synthwave generator in WebAudio. Nothing is downloaded. Starts only after the visitor clicks Radio.
// Drums, an octave-pumping bass, a looped square arp, a detuned saw pad, and a feedback delay. Three "tracks" differ in key and tempo.

import { h } from "./util.js";
import { COPY } from "./copy.js";

const TRACKS = [
  { name: "Neon Getaway", bpm: 104, root: 45, prog: [0, 0, -4, -2], arp: [0, 7, 12, 7, 15, 12, 7, 3] },
  { name: "Palm Tree Panic", bpm: 112, root: 48, prog: [0, -5, -7, -2], arp: [0, 12, 7, 12, 3, 15, 10, 7] },
  { name: "Midnight on Ocean Dr.", bpm: 96, root: 43, prog: [0, -2, -4, -7], arp: [0, 3, 7, 10, 12, 10, 7, 3] },
];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

let ac = null, master = null, delay = null, timer = 0, step = 0, nextAt = 0, trackIx = 0, playing = false;
const listeners = new Set();
const emit = () => listeners.forEach((f) => f(playing, TRACKS[trackIx].name));

function boot() {
  if (ac) return;
  ac = new (window.AudioContext || window.webkitAudioContext)();
  master = ac.createGain();
  master.gain.value = 0.16;
  const comp = ac.createDynamicsCompressor();
  delay = ac.createDelay(1);
  delay.delayTime.value = 0.36;
  const fb = ac.createGain(); fb.gain.value = 0.32;
  const wet = ac.createGain(); wet.gain.value = 0.28;
  delay.connect(fb).connect(delay);
  delay.connect(wet).connect(master);
  master.connect(comp).connect(ac.destination);
}

function tone(type, freq, at, dur, vol, { toDelay = false, detune = 0, lp = 0 } = {}) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.value = freq; o.detune.value = detune;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  let out = g;
  o.connect(g);
  if (lp) { const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = lp; g.connect(f); out = f; }
  out.connect(master);
  if (toDelay) out.connect(delay);
  o.start(at); o.stop(at + dur + 0.05);
}
function kick(at) {
  const o = ac.createOscillator(), g = ac.createGain();
  o.frequency.setValueAtTime(150, at); o.frequency.exponentialRampToValueAtTime(42, at + 0.14);
  g.gain.setValueAtTime(0.9, at); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.2);
  o.connect(g).connect(master); o.start(at); o.stop(at + 0.22);
}
let noiseBuf = null;
function noise(at, dur, vol, hp) {
  if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const s = ac.createBufferSource(), g = ac.createGain(), f = ac.createBiquadFilter();
  s.buffer = noiseBuf; f.type = "highpass"; f.frequency.value = hp;
  g.gain.setValueAtTime(vol, at); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(master); s.start(at); s.stop(at + dur + 0.02);
}

function schedule() {
  const tr = TRACKS[trackIx];
  const sp = 60 / tr.bpm / 4; // a sixteenth
  while (nextAt < ac.currentTime + 0.25) {
    const s = step % 64, bar = Math.floor(s / 16), k = s % 16;
    const chord = tr.root + tr.prog[bar % 4];
    if (k % 4 === 0) kick(nextAt);
    if (k === 4 || k === 12) { noise(nextAt, 0.14, 0.34, 1800); tone("triangle", 190, nextAt, 0.09, 0.2); }
    if (k % 2 === 0) noise(nextAt, 0.04, k % 4 === 2 ? 0.2 : 0.1, 7000);
    // bass: root / octave pumping on the off-beats
    if (k % 2 === 0 || k === 15) tone("sawtooth", mtof(chord - 12 + (k % 4 === 2 ? 12 : 0)), nextAt, sp * 1.7, 0.2, { lp: 700 });
    // arp
    if (bar >= 1) tone("square", mtof(chord + 12 + tr.arp[k % 8]), nextAt, sp * 1.4, 0.07, { toDelay: true, lp: 3200 });
    // pad, once per bar
    if (k === 0) for (const iv of [0, 7, 12, 15]) { tone("sawtooth", mtof(chord + iv), nextAt, sp * 15, 0.035, { detune: -8, lp: 1100 }); tone("sawtooth", mtof(chord + iv), nextAt, sp * 15, 0.035, { detune: 8, lp: 1100 }); }
    nextAt += sp; step++;
  }
}

export const radio = {
  get playing() { return playing; },
  get track() { return TRACKS[trackIx].name; },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  start() {
    try {
      boot();
      if (ac.state === "suspended") ac.resume();
      if (playing) return;
      playing = true; step = 0; nextAt = ac.currentTime + 0.08;
      timer = setInterval(schedule, 60);
      emit();
    } catch { playing = false; }
  },
  stop() { if (!playing) return; playing = false; clearInterval(timer); emit(); },
  toggle() { playing ? this.stop() : this.start(); return playing; },
  next() { trackIx = (trackIx + 1) % TRACKS.length; step = 0; if (ac) nextAt = ac.currentTime + 0.08; emit(); },
};

/** The little "on air" plate that sits bottom-left while the station plays. */
export function radioPlate() {
  const bars = h("span.eq", h("i"), h("i"), h("i"), h("i"));
  const name = h("span.rp-name");
  const next = h("button.rp-next", { type: "button", "aria-label": COPY.vice.radioNext, onclick: () => radio.next() }, "⏭");
  const plate = h("div.radio-plate", { hidden: true }, bars, h("div.rp-text", h("small", COPY.vice.radioStation), name), next);
  radio.subscribe((on, track) => { plate.hidden = !on; name.textContent = track; });
  return plate;
}
