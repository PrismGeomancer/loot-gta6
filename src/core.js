// Shared state and small UI services: config, toast, modal, routing helpers, links.

import { h, $, clear, fmt, local, copyText } from "./util.js";
import { COPY } from "./copy.js";

const DEFAULTS = {
  name: "LOOT",
  ticker: "$LOOT",
  mint: "",
  x: "",
  telegram: "",
  repo: "",
  dexscreener: "",
  rpc: "https://api.mainnet-beta.solana.com",
  rpcFallbacks: ["https://solana-rpc.publicnode.com"],
  api: "",
  quorumPct: 1,
  verdict: { solidMinLiquidityUsd: 25000, thinLiquidityUsd: 5000 },
  features: { sound: false, rugcheck: false, intro: true, seedVotes: true },
};
const user = (typeof window !== "undefined" && window.LOOT_CONFIG) || {};
export const cfg = {
  ...DEFAULTS,
  ...user,
  verdict: { ...DEFAULTS.verdict, ...(user.verdict || {}) },
  features: { ...DEFAULTS.features, ...(user.features || {}) },
};
// the one source for every link, address and ticker shown in the UI
export const has = (v) => typeof v === "string" && v.trim().length > 0;

export const ctx = {
  scene: null, // three.js scene wrapper, or null when the 2D layout is in use
  route: { name: "", arg: "" },
  introPlaying: false,
  go: (hash) => { location.hash = hash; },
};

export const isNarrow = () => window.matchMedia("(max-width: 760px)").matches;
export const isTouch = () => window.matchMedia("(pointer: coarse)").matches;

/** Link for this page with a hash route, usable from any subpath (relative to the current document). */
export function shareUrl(hash) {
  const base = location.href.split("#")[0];
  return base + hash;
}

// ---------- toasts ----------
export function toast(message, ms = 2600) {
  const root = $("#toasts");
  if (!root) return;
  const el = h("div.toast", { role: "status" }, message);
  root.append(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 300);
  }, ms);
}

export async function copyWithToast(text, msg = COPY.toast.linkCopied) {
  if (await copyText(text)) toast(msg);
}

// ---------- modal ----------
let modalEl = null;
let modalReturn = null;
export function openModal(title, sub, body) {
  closeModal();
  modalReturn = document.activeElement;
  const root = $("#modal-root");
  const card = h("div.modal-card", { role: "dialog", "aria-modal": "true", "aria-label": title },
    h("h2", title), sub ? h("p.sub", sub) : null, body,
    h("button.btn.ghost.close", { type: "button", onclick: closeModal }, COPY.wallet.close));
  modalEl = h("div.modal", { onclick: (e) => { if (e.target === modalEl) closeModal(); } }, card);
  root.append(modalEl);
  requestAnimationFrame(() => {
    modalEl?.classList.add("in");
    $("button, a", card)?.focus();
  });
  return modalEl;
}
export function closeModal() {
  if (!modalEl) return false;
  modalEl.remove();
  modalEl = null;
  try { modalReturn?.focus?.(); } catch { /* element may be gone */ }
  return true;
}
export const modalOpen = () => !!modalEl;

// ---------- link rows ----------
export function externalLink(href, label, cls = "") {
  return h("a", { href, target: "_blank", rel: "noopener noreferrer", class: cls }, label);
}

// ---------- stats shared by pages ----------
export const chestsOpened = () => Number(local.get("loot:chests-opened", 0)) || 0;
export const setChestsOpened = (n) => local.set("loot:chests-opened", n);
export const myChests = () => {
  const v = local.get("loot:chests", []);
  return Array.isArray(v) ? v : [];
};
export const saveChests = (list) => local.set("loot:chests", list.slice(0, 200));
export const myVotes = () => {
  const v = local.get("loot:votes", {});
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
};
export const saveVotes = (v) => local.set("loot:votes", v);

export { clear, fmt };
