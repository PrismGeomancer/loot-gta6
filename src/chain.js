// Read-only data: Solana RPC (getAccountInfo, getTokenSupply, getTokenAccountsByOwner), DexScreener, optional RugCheck.
// Everything keyless. Friendly errors, one retry, no raw error dumps.

import { sleep } from "./util.js";

export class ReadError extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind; // "down" | "busy" | "offline" | "notToken" | "none"
  }
}

async function postJson(url, body, signal) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (res.status === 429 || res.status === 503) throw new ReadError("busy");
  if (!res.ok) throw new ReadError("down"); // includes 403: Solana's own public endpoint refuses browser origins
  return res.json();
}

let sticky = 0; // index of the endpoint that last answered, so a refusing endpoint is not retried on every call

async function callOnce(url, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const json = await postJson(url, body, ctl.signal);
    if (json.error) {
      const code = json.error.code;
      if (code === -32429 || code === 429) throw new ReadError("busy");
      // e.g. "indexed requests need a personal token" on free public nodes: this endpoint cannot answer, try the next
      throw Object.assign(new ReadError("down"), { rpcCode: code, rpcMessage: json.error.message });
    }
    return json.result;
  } catch (e) {
    throw e instanceof ReadError ? e : new ReadError("down");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One JSON-RPC call. Tries cfg.rpc first, then each of cfg.rpcFallbacks. If every endpoint failed, waits once
 * (longer when they were busy) and goes round one more time. onBusy() fires before that wait.
 */
export async function rpc(cfg, method, params, { onBusy } = {}) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new ReadError("offline");
  const body = { jsonrpc: "2.0", id: 1, method, params };
  const urls = [cfg.rpc, ...(Array.isArray(cfg.rpcFallbacks) ? cfg.rpcFallbacks : [])].filter(Boolean);
  const order = urls.map((_, i) => urls[(i + sticky) % urls.length]);
  let lastKind = "down";
  for (let round = 0; round < 2; round++) {
    let busy = false;
    for (const url of order) {
      try {
        const result = await callOnce(url, body);
        sticky = urls.indexOf(url);
        return result;
      } catch (e) {
        lastKind = e.kind || "down";
        if (e.kind === "busy") busy = true;
      }
    }
    if (round === 0) {
      if (busy) { onBusy?.(); await sleep(2500); } else await sleep(500);
    }
  }
  throw new ReadError(lastKind);
}

/** The mint account: supply, decimals, authorities. Throws ReadError("none") when the account does not exist. */
export async function readMint(cfg, mint, hooks) {
  const res = await rpc(cfg, "getAccountInfo", [mint, { encoding: "jsonParsed", commitment: "confirmed" }], hooks);
  const v = res && res.value;
  if (!v) throw new ReadError("none");
  const parsed = v.data && v.data.parsed;
  if (!parsed || parsed.type !== "mint" || !parsed.info) throw new ReadError("notToken");
  const i = parsed.info;
  return {
    supply: String(i.supply),
    decimals: Number(i.decimals),
    mintAuthority: i.mintAuthority ?? null,
    freezeAuthority: i.freezeAuthority ?? null,
    program: v.owner,
  };
}

/** The best (highest liquidity) Solana pair on DexScreener, or null. Throws on network trouble. */
export async function readPair(mint) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, { signal: ctl.signal });
    if (!res.ok) throw new Error("dex");
    const json = await res.json();
    const pairs = (json.pairs || []).filter((p) => (!p.chainId || p.chainId === "solana") && p.liquidity && typeof p.liquidity.usd === "number");
    if (!pairs.length) return null;
    pairs.sort((a, b) => b.liquidity.usd - a.liquidity.usd);
    const p = pairs[0];
    const created = typeof p.pairCreatedAt === "number" ? p.pairCreatedAt : null;
    return {
      dexId: p.dexId || "unknown",
      url: p.url || null,
      liquidityUsd: p.liquidity.usd,
      volume24h: p.volume && typeof p.volume.h24 === "number" ? p.volume.h24 : null,
      ageDays: created ? Math.max(0, Math.floor((Date.now() - created) / 86400000)) : null,
      pairAddress: p.pairAddress || null,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** RugCheck is skipped silently unless the browser can reach it (CORS). Returns null on any failure. */
export async function readRugcheck(mint) {
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report/summary`, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const j = await res.json();
    if (typeof j.score_normalised !== "number" && !Array.isArray(j.risks)) return null;
    return { score: j.score_normalised ?? null, risks: (j.risks || []).slice(0, 5).map((r) => r.name).filter(Boolean) };
  } catch {
    return null;
  }
}

/** Token balance (raw bigint + decimals) of an owner for a mint, summed over their token accounts. */
export async function readBalance(cfg, owner, mint) {
  const res = await rpc(cfg, "getTokenAccountsByOwner", [owner, { mint }, { encoding: "jsonParsed" }]);
  let raw = 0n;
  let decimals = 0;
  for (const a of res.value || []) {
    const ta = a.account?.data?.parsed?.info?.tokenAmount;
    if (ta) {
      raw += BigInt(ta.amount);
      decimals = ta.decimals;
    }
  }
  return { raw, decimals };
}

/**
 * Deterministic verdict from the facts and the thresholds in config.
 *   Solid:  both authorities null AND liquidity >= solidMinLiquidityUsd
 *   Shaky:  exactly one authority set, OR liquidity between thin and solid; also the cases the three rules leave open
 *           (both set but liquidity not below thin, thin liquidity with clean authorities, no market data to check)
 *   No-go:  both authorities set AND liquidity < thinLiquidityUsd
 * Returns { key, reasonKey, authorityName? } where key is solid | shaky | nogo.
 */
export function judge(facts, cfg) {
  const { solidMinLiquidityUsd: solidMin, thinLiquidityUsd: thinMin } = cfg.verdict;
  const mintSet = facts.mintAuthority != null;
  const freezeSet = facts.freezeAuthority != null;
  const both = mintSet && freezeSet;
  const one = mintSet !== freezeSet;
  const liq = facts.pair ? facts.pair.liquidityUsd : null;
  const authorityName = mintSet ? "Mint authority" : "Freeze authority";
  if (liq == null) {
    return { key: "shaky", reasonKey: facts.marketFailed ? "noMarket" : "noPair", sentenceKey: "shakyNoData", authorityName };
  }
  if (both && liq < thinMin) return { key: "nogo", reasonKey: "nogo", sentenceKey: "nogo" };
  if (!mintSet && !freezeSet && liq >= solidMin) return { key: "solid", reasonKey: "solid", sentenceKey: "solid" };
  if (both) return { key: "shaky", reasonKey: liq < solidMin ? "thinBoth" : "authBoth", sentenceKey: "shakyBoth" };
  if (one) return { key: "shaky", reasonKey: "authOne", sentenceKey: "shakyAuth", authorityName };
  return { key: "shaky", reasonKey: "thin", sentenceKey: "shakyThin" };
}
