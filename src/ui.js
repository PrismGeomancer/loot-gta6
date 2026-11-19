// Chrome shared by every page: top bar, wallet modal, footer.

import { h, $, clear, fmt, shortAddr } from "./util.js";
import { COPY } from "./copy.js";
import { cfg, has, ctx, toast, openModal, closeModal, externalLink, copyWithToast } from "./core.js";
import { WALLETS, detected, connect, disconnect, wallet, onWallet } from "./wallet.js";
import { sound } from "./sound.js";
import { radio } from "./radio.js";
import { local } from "./util.js";

// ---------- wallet modal ----------
export function openWalletModal(onDone) {
  const list = h("ul.wallets");
  for (const w of WALLETS) {
    const here = detected(w);
    const btn = h("button.wallet-opt", { type: "button" }, h("span.wname", w.name), h("span.wtag", { class: here ? "yes" : "no" }, here ? COPY.wallet.detected : COPY.wallet.install));
    btn.addEventListener("click", async () => {
      if (!detected(w)) {
        toast(COPY.toast.noWallet);
        window.open(w.url, "_blank", "noopener,noreferrer");
        return;
      }
      btn.disabled = true;
      try {
        await connect(w.id);
        closeModal();
        toast(COPY.toast.connected);
        sound.blip("select");
        onDone?.();
      } catch (e) {
        btn.disabled = false;
        if (e.code === "none") { toast(COPY.toast.noWallet); window.open(w.url, "_blank", "noopener,noreferrer"); }
        else toast(COPY.toast.cancelled);
      }
    });
    list.append(h("li", btn));
  }
  openModal(COPY.wallet.title, COPY.wallet.sub, list);
}

// ---------- top bar ----------
export function buildTopbar(logo) {
  logoSrc = logo;
  const bar = $("#topbar");
  clear(bar);
  const brand = h("a.brand", { href: "#/", "aria-label": cfg.name }, h("img", { src: logoSrc, alt: "", width: 32, height: 32 }), h("span", COPY.nav.brand));
  const nav = h("nav.nav", { "aria-label": "Main" }, COPY.nav.links.map((l) => h("a.pill", { href: l.href, "data-route": l.href }, l.label)));
  nav.append(externalLink(has(cfg.x) ? cfg.x : "https://x.com/TheLootCoin", "TWITTER", "pill"));
  const snd = h("button#btn-sound.icon", { type: "button", "aria-pressed": String(sound.on) });
  const paintSound = () => { snd.textContent = sound.on ? COPY.nav.soundOn : COPY.nav.soundOff; snd.setAttribute("aria-pressed", String(sound.on)); };
  paintSound();
  snd.addEventListener("click", () => { sound.toggle(); paintSound(); });
  const rad = h("button#btn-radio.icon.radio-btn", { type: "button", "aria-pressed": "false" });
  const paintRadio = (on = radio.playing) => { rad.textContent = on ? COPY.vice.radioOn : COPY.vice.radioOff; rad.setAttribute("aria-pressed", String(on)); };
  paintRadio();
  rad.addEventListener("click", () => radio.toggle());
  radio.subscribe((on) => paintRadio(on));
  // time of day: cycles Auto > Day > Dusk > Night > Dawn; hidden until the 3D strip exists
  const MODES = ["auto", "day", "sunset", "night", "dawn"];
  const skyBtn = h("button#btn-time.icon.sky-btn", { type: "button", hidden: true, "aria-label": COPY.sky.aria });
  const paintSky = (phase) => {
    const mode = local.get("loot:time", "auto");
    const name = COPY.sky.modes[mode] || COPY.sky.modes.auto;
    skyBtn.textContent = `${COPY.sky.label}: ${name}`;
    skyBtn.title = phase ? `${COPY.sky.modes[phase]}` : "";
    skyBtn.dataset.mode = mode;
  };
  skyBtn.addEventListener("click", () => {
    const cur = local.get("loot:time", "auto");
    const next = MODES[(MODES.indexOf(cur) + 1) % MODES.length];
    local.set("loot:time", next);
    ctx.scene?.setTimeMode(next);
    paintSky(ctx.scene?.timeState().phase);
    sound.blip("select");
  });
  paintSky();
  window.addEventListener("loot:phase", (e) => paintSky(e.detail));
  window.addEventListener("loot:scene", () => { skyBtn.hidden = false; ctx.scene?.setTimeMode(local.get("loot:time", "auto"), true); paintSky(ctx.scene?.timeState().phase); });
  const walletBox = h("div.walletbox");
  const paintWallet = () => {
    clear(walletBox);
    if (!wallet.address) {
      walletBox.append(h("button#btn-wallet.btn.primary.small", { type: "button", onclick: () => openWalletModal() }, COPY.nav.connect));
      return;
    }
    const menu = h("div.menu", { hidden: true },
      h("button", { type: "button", onclick: () => { copyWithToast(wallet.address, COPY.toast.addressCopied); menu.hidden = true; } }, COPY.nav.copyAddress),
      h("button", { type: "button", onclick: async () => { menu.hidden = true; await disconnect(); toast(COPY.toast.disconnected); } }, COPY.nav.disconnect));
    const btn = h("button#btn-wallet.btn.ghost.small", { type: "button", "aria-haspopup": "true", onclick: (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; } }, shortAddr(wallet.address));
    walletBox.append(btn, menu);
  };
  paintWallet();
  onWallet(paintWallet);
  document.addEventListener("click", () => { const m = $(".menu", walletBox); if (m) m.hidden = true; });
  bar.append(brand, nav, h("div.tools", skyBtn, rad, snd, walletBox));
  // pages start below the bar however many rows it wraps to
  const measure = () => document.documentElement.style.setProperty("--bar", `${bar.offsetHeight}px`);
  measure();
  if (typeof ResizeObserver === "function") new ResizeObserver(measure).observe(bar);
  document.fonts?.ready.then(measure);
}

export function markNav(routeName) {
  for (const a of document.querySelectorAll("#topbar .pill")) {
    const on = a.getAttribute("data-route") === `#/${routeName}`;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  }
}

// ---------- footer ----------
let logoSrc = "";
export function buildFooter({ introAvailable }) {
  const F = COPY.footer;
  const links = h("nav.flinks", { "aria-label": "Footer" }, F.links.map((l) => h("a.fpill", { href: l.href }, l.label)));
  const ext = h("div.f-ext");
  if (has(cfg.x)) ext.append(externalLink(cfg.x, F.x, "fpill gold"));
  if (has(cfg.telegram)) ext.append(externalLink(cfg.telegram, F.telegram, "fpill gold"));
  if (has(cfg.repo)) ext.append(externalLink(cfg.repo, F.repo, "fpill gold"));
  if (has(cfg.dexscreener)) ext.append(externalLink(cfg.dexscreener, F.dexscreener, "fpill gold"));
  const brand = h("div.f-brand",
    logoSrc ? h("img", { src: logoSrc, alt: "", width: 28, height: 28 }) : null,
    h("strong", COPY.nav.brand));
  const bar = h("div.f-bar");
  if (has(cfg.mint)) {
    bar.append(h("p.contract", fmt(F.contract, { mintShort: shortAddr(cfg.mint) }), " ", h("button.linklike", { type: "button", onclick: () => copyWithToast(cfg.mint, COPY.toast.addressCopied) }, F.copy)));
  }
  if (introAvailable) bar.append(h("button#btn-replay.fpill.ghostbtn", { type: "button" }, COPY.intro.replay));
  return h("footer.footer", h("div.f-main", brand, links, ext), bar.children.length ? bar : null, h("p.small", F.small), h("p.small.cheat-hint", COPY.cheats.hint));
}
