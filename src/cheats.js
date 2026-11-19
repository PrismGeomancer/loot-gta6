// GTA-style cheat codes: type a word anywhere on the page (not inside a text field).
//   HESOYAM      cash rain + coin chime
//   FASTCAR      the pink cruiser makes a flat-out pass right now
//   LEAVEMEALONE clears the stars and calms the sirens
//   WANTED       five stars, full siren, for the drama
// Pure fun: nothing here touches readings, votes or wallets.

import { COPY } from "./copy.js";
import { ctx, toast } from "./core.js";
import { sound } from "./sound.js";
import { stinger, rain, siren } from "./vice.js";

const C = COPY.cheats;
let buf = "";

const CODES = {
  HESOYAM: () => { rain(); sound.blip("coin"); toast(C.hesoyam); },
  FASTCAR: () => { if (ctx.scene?.boostCar) ctx.scene.boostCar(); toast(C.fastcar); },
  LEAVEMEALONE: () => { document.querySelectorAll(".siren-wash").forEach((e) => e.remove()); document.querySelectorAll(".star.on").forEach((s) => s.classList.remove("on")); sound.blip("good"); toast(C.leavemealone); },
  WANTED: () => { siren(); stinger("shaky"); sound.blip("warn"); toast(C.wanted); },
};
const LONGEST = Math.max(...Object.keys(CODES).map((k) => k.length));

document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
  buf = (buf + e.key.toUpperCase()).slice(-LONGEST);
  for (const [code, run] of Object.entries(CODES)) {
    if (buf.endsWith(code)) { buf = ""; run(); return; }
  }
});
