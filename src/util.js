// Small helpers: DOM, safe storage, base58, hashing, number formatting.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h("div.card#id", { onclick }, child, "text") -> element. Text is always set as text, never as HTML. */
export function h(spec, attrs, ...kids) {
  const m = /^([a-z0-9]+)((?:[.#][\w-]+)*)$/i.exec(spec);
  const el = document.createElement(m ? m[1] : "div");
  if (m && m[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === "#") el.id = part.slice(1);
      else el.classList.add(part.slice(1));
    }
  }
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className += (el.className ? " " : "") + v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "text") el.textContent = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  add(el, kids);
  return el;
}
export function add(el, kids) {
  for (const k of [kids].flat(Infinity)) {
    if (k == null || k === false) continue;
    el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
  return el;
}
export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** "Open the chest. *Check the loot.*" -> text with the starred part in <em>. */
export function rich(str, into = document.createDocumentFragment()) {
  str.split(/(\*[^*]+\*)/).forEach((part) => {
    if (!part) return;
    if (part[0] === "*" && part.endsWith("*")) into.append(h("em", part.slice(1, -1)));
    else into.append(document.createTextNode(part));
  });
  return into;
}
export function plain(str) {
  return str.replace(/\*/g, "");
}
/** Fill {braces}. Unknown keys stay as they are. */
export function fmt(str, vars = {}) {
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// ---- storage that never throws (and falls back to memory) ----
function makeStore(kind) {
  const mem = new Map();
  const real = () => {
    try {
      return window[kind];
    } catch {
      return null;
    }
  };
  return {
    get(key, fallback = null) {
      try {
        const s = real();
        const raw = s ? s.getItem(key) : mem.get(key) ?? null;
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return mem.has(key) ? JSON.parse(mem.get(key)) : fallback;
      }
    },
    set(key, value) {
      const raw = JSON.stringify(value);
      mem.set(key, raw);
      try {
        const s = real();
        if (s) s.setItem(key, raw);
      } catch {
        /* storage blocked: memory only */
      }
    },
    remove(key) {
      mem.delete(key);
      try {
        const s = real();
        if (s) s.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}
export const local = makeStore("localStorage");
export const session = makeStore("sessionStorage");

// ---- base58 ----
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function b58decode(str) {
  if (typeof str !== "string" || !str.length) return null;
  let n = 0n;
  for (const ch of str) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * 58n + BigInt(i);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.push(Number(n & 255n));
    n >>= 8n;
  }
  let zeros = 0;
  for (const ch of str) {
    if (ch === "1") zeros++;
    else break;
  }
  return new Uint8Array([...Array(zeros).fill(0), ...bytes.reverse()]);
}
export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out;
}
/** A Solana address: base58 that decodes to exactly 32 bytes. */
export function isSolanaAddress(str) {
  if (typeof str !== "string") return false;
  const s = str.trim();
  if (s.length < 32 || s.length > 44) return false;
  const d = b58decode(s);
  return !!d && d.length === 32;
}

// ---- hashing ----
export async function sha256hex(data) {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
/** A stable 32 bit number from a string (FNV-1a). Used to seed effects from a mint. */
export function hashSeed(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    x ^= str.charCodeAt(i);
    x = Math.imul(x, 0x01000193) >>> 0;
  }
  return x >>> 0;
}

// ---- formatting ----
export const shortAddr = (a) => (a && a.length > 10 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a || "");
export function fmtUsd(n) {
  if (n == null || !isFinite(n)) return "n/a";
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}
/** raw integer string + decimals -> "1,000,000,000" (trailing zeros of the fraction dropped). */
export function fmtAmount(raw, decimals = 0) {
  try {
    const big = BigInt(raw);
    const d = 10n ** BigInt(decimals);
    const whole = big / d;
    let frac = (big % d).toString().padStart(decimals, "0").replace(/0+$/, "");
    if (frac.length > 4) frac = frac.slice(0, 4).replace(/0+$/, "");
    const w = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return frac ? `${w}.${frac}` : w;
  } catch {
    return "n/a";
  }
}
export function fmtTime(ts) {
  return new Date(ts).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = h("textarea", { style: { position: "fixed", opacity: "0" } });
      ta.value = text;
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
