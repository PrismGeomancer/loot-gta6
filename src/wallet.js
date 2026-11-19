// Injected-provider wallets. LOOT only ever calls connect / disconnect / signMessage. It never builds or requests a transaction.

import { b58decode, b58encode, local } from "./util.js";

const W = typeof window !== "undefined" ? window : {};

export const WALLETS = [
  {
    id: "phantom", name: "Phantom", url: "https://phantom.app/download",
    provider: () => (W.phantom && W.phantom.solana && W.phantom.solana.isPhantom ? W.phantom.solana : W.solana && W.solana.isPhantom ? W.solana : null),
  },
  {
    id: "solflare", name: "Solflare", url: "https://solflare.com/download",
    provider: () => (W.solflare && W.solflare.isSolflare ? W.solflare : null),
  },
  {
    id: "backpack", name: "Backpack", url: "https://backpack.app/downloads",
    provider: () => (W.backpack && (W.backpack.isBackpack || typeof W.backpack.connect === "function") ? W.backpack : null),
  },
  {
    id: "coinbase", name: "Coinbase Wallet", url: "https://www.coinbase.com/wallet/downloads",
    provider: () => (W.coinbaseSolana && typeof W.coinbaseSolana.connect === "function" ? W.coinbaseSolana : null),
  },
  {
    id: "trust", name: "Trust", url: "https://trustwallet.com/download",
    provider: () => (W.trustwallet && W.trustwallet.solana && typeof W.trustwallet.solana.connect === "function" ? W.trustwallet.solana : null),
  },
];

const listeners = new Set();
export const wallet = { id: null, address: null, provider: null };

export const onWallet = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
const emit = () => listeners.forEach((fn) => { try { fn(wallet); } catch { /* a listener must not break the others */ } });

export const detected = (w) => !!w.provider();

function addressOf(res, provider) {
  const pk = (res && res.publicKey) || provider.publicKey;
  return pk ? pk.toString() : null;
}

function bind(provider) {
  if (provider.__lootBound) return;
  provider.__lootBound = true;
  const onChange = (pk) => {
    if (wallet.provider !== provider) return;
    if (!pk) { clearWallet(); return; }
    wallet.address = pk.toString();
    emit();
  };
  const onDisconnect = () => {
    if (wallet.provider === provider) clearWallet();
  };
  try {
    provider.on?.("accountChanged", onChange);
    provider.on?.("disconnect", onDisconnect);
  } catch { /* some providers do not expose events */ }
}

function clearWallet() {
  wallet.id = wallet.address = wallet.provider = null;
  emit();
}

/** Connect. Returns the address, or throws {code:"none"} when not installed (caller opens the download page). */
export async function connect(id, { quiet = false } = {}) {
  const def = WALLETS.find((w) => w.id === id);
  if (!def) throw Object.assign(new Error("unknown wallet"), { code: "none" });
  const provider = def.provider();
  if (!provider) throw Object.assign(new Error("not installed"), { code: "none", def });
  const res = await provider.connect(quiet ? { onlyIfTrusted: true } : undefined);
  const address = addressOf(res, provider);
  if (!address) throw Object.assign(new Error("no key"), { code: "cancelled" });
  wallet.id = id;
  wallet.address = address;
  wallet.provider = provider;
  bind(provider);
  local.set("loot:wallet", id);
  emit();
  return address;
}

export async function disconnect() {
  const p = wallet.provider;
  local.remove("loot:wallet");
  try {
    if (p && typeof p.disconnect === "function") await p.disconnect();
  } catch { /* ignore */ }
  clearWallet();
}

/** Reconnect without a prompt if the wallet already trusts this site. Waits briefly for injected providers. */
export async function quietReconnect() {
  const id = local.get("loot:wallet");
  if (!id) return null;
  for (let i = 0; i < 10 && !WALLETS.find((w) => w.id === id)?.provider(); i++) await new Promise((r) => setTimeout(r, 150));
  try {
    return await connect(id, { quiet: true });
  } catch {
    return null;
  }
}

/** Ask the wallet to sign a plain text message. Returns the signature bytes. */
export async function signText(text) {
  if (!wallet.provider) throw Object.assign(new Error("not connected"), { code: "none" });
  const bytes = new TextEncoder().encode(text);
  try {
    let res;
    try {
      res = await wallet.provider.signMessage(bytes, "utf8");
    } catch (e) {
      if (e && (e.code === 4001 || /reject|denied|cancel/i.test(String(e.message)))) throw e;
      res = await wallet.provider.signMessage(bytes);
    }
    const sig = res && res.signature ? res.signature : res;
    if (!(sig instanceof Uint8Array) && !Array.isArray(sig)) throw new Error("no signature");
    return new Uint8Array(sig);
  } catch (e) {
    const cancelled = e && (e.code === 4001 || /reject|denied|cancel|declin/i.test(String(e.message)));
    throw Object.assign(new Error(cancelled ? "cancelled" : "failed"), { code: cancelled ? "cancelled" : "failed" });
  }
}

/** Verify an Ed25519 signature with WebCrypto where supported. Returns true / false / null (cannot check here). */
export async function verifySignature(address, text, signature) {
  try {
    const key = b58decode(address);
    if (!key || key.length !== 32) return null;
    const pub = await crypto.subtle.importKey("raw", key, { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "Ed25519" }, pub, signature, new TextEncoder().encode(text));
  } catch {
    return null;
  }
}

export { b58encode };
