// LOOT server (no dependencies). Serves index.html with config from environment variables, proxies Solana RPC so the
// API key stays secret, and keeps a shared vote tally with server-side signature and balance checks.
//
//   node server.mjs            (PORT defaults to 3000; Railway sets it)
//
// Environment (all optional):
//   LOOT_MINT        your token's mint address (empty = every wallet votes with weight 1)
//   LOOT_TICKER, LOOT_NAME, LOOT_X, LOOT_TELEGRAM, LOOT_REPO, LOOT_DEXSCREENER
//   RPC_URL          a Solana RPC that allows getTokenAccountsByOwner (Helius, QuickNode, ...). Needed for token-weighted votes.
//   QUORUM_PCT, SOLID_MIN_LIQ, THIN_LIQ, SEED_VOTES ("true" shows starter numbers), RUGCHECK ("true")
//   DATA_DIR         where votes.json lives (mount a Railway volume here to keep votes across deploys). Default ./data

import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const PORT = Number(env.PORT) || 3000;
const MINT = (env.LOOT_MINT || "").trim();
const RPC_URL = (env.RPC_URL || "https://solana-rpc.publicnode.com").trim();
const DATA_DIR = env.DATA_DIR || join(ROOT, "data");
const PROPOSALS = ["key-glint", "potion", "heart-pickup", "crystal-shard", "power-star", "feather-burst", "confetti"];
const RPC_METHODS = new Set(["getAccountInfo", "getTokenAccountsByOwner", "getTokenSupply"]);

// ---------- storage: one JSON file, written atomically ----------
mkdirSync(DATA_DIR, { recursive: true });
const FILE = join(DATA_DIR, "votes.json");
let votes = {}; // { proposalId: { wallet: { side, weight (raw string), decimals, ts } } }
try { if (existsSync(FILE)) votes = JSON.parse(readFileSync(FILE, "utf8")); } catch (e) { console.error("could not read votes.json, starting empty:", e.message); }
function save() {
  const tmp = FILE + ".tmp";
  writeFileSync(tmp, JSON.stringify(votes));
  renameSync(tmp, FILE);
}

// ---------- base58 + ed25519 ----------
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58decode(str) {
  if (typeof str !== "string" || !str) return null;
  let n = 0n;
  for (const ch of str) { const i = B58.indexOf(ch); if (i < 0) return null; n = n * 58n + BigInt(i); }
  const out = [];
  while (n > 0n) { out.push(Number(n & 255n)); n >>= 8n; }
  let zeros = 0;
  for (const ch of str) { if (ch === "1") zeros++; else break; }
  return Buffer.from([...Array(zeros).fill(0), ...out.reverse()]);
}
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function verifyEd25519(address, message, signature) {
  const key = b58decode(address);
  if (!key || key.length !== 32 || !signature || signature.length !== 64) return false;
  try {
    const pub = crypto.createPublicKey({ key: Buffer.concat([SPKI_PREFIX, key]), format: "der", type: "spki" });
    return crypto.verify(null, Buffer.from(message, "utf8"), pub, signature);
  } catch { return false; }
}

// ---------- RPC ----------
async function rpcCall(method, params) {
  const res = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`rpc ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || "rpc error");
  return json.result;
}
async function balanceOf(owner) {
  const r = await rpcCall("getTokenAccountsByOwner", [owner, { mint: MINT }, { encoding: "jsonParsed" }]);
  let raw = 0n, decimals = 0;
  for (const a of r.value || []) {
    const ta = a.account?.data?.parsed?.info?.tokenAmount;
    if (ta) { raw += BigInt(ta.amount); decimals = ta.decimals; }
  }
  return { raw, decimals };
}

// ---------- small helpers ----------
const hits = new Map(); // ip -> [timestamps]
function limited(ip, max = 40, windowMs = 60000) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(ip, list);
  return list.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 60000)) hits.delete(k); }, 60000).unref();

function readBody(req, limit = 16384) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const send = (res, status, body, headers = {}) => {
  const isStr = typeof body === "string";
  res.writeHead(status, { "content-type": isStr ? "text/html; charset=utf-8" : "application/json", "cache-control": "no-store", ...headers });
  res.end(isStr ? body : JSON.stringify(body));
};

function tally() {
  const out = {};
  for (const id of PROPOSALS) {
    let drop = 0, not = 0, n = 0;
    for (const v of Object.values(votes[id] || {})) {
      const w = Number(v.weight) / 10 ** v.decimals;
      if (v.side === "drop") drop += w; else not += w;
      n++;
    }
    out[id] = { drop, not, votes: n };
  }
  return out;
}

// ---------- the page, with config from env ----------
function page() {
  let html = readFileSync(join(ROOT, "index.html"), "utf8");
  const patch = {
    api: "api", // same origin
    rpc: "api/rpc", rpcFallbacks: [],
    mint: MINT,
    ...(env.LOOT_NAME && { name: env.LOOT_NAME }),
    ...(env.LOOT_TICKER && { ticker: env.LOOT_TICKER }),
    x: env.LOOT_X || "", telegram: env.LOOT_TELEGRAM || "", repo: env.LOOT_REPO || "", dexscreener: env.LOOT_DEXSCREENER || "",
    ...(env.QUORUM_PCT && { quorumPct: Number(env.QUORUM_PCT) }),
    verdict: {
      ...(env.SOLID_MIN_LIQ && { solidMinLiquidityUsd: Number(env.SOLID_MIN_LIQ) }),
      ...(env.THIN_LIQ && { thinLiquidityUsd: Number(env.THIN_LIQ) }),
    },
    features: { seedVotes: env.SEED_VOTES === "true", rugcheck: env.RUGCHECK === "true" },
  };
  const inject = `\n<script>(function(c,p){for(var k in p){if(p[k]&&typeof p[k]==="object"&&!Array.isArray(p[k]))Object.assign(c[k]=c[k]||{},p[k]);else c[k]=p[k];}})(window.LOOT_CONFIG,${JSON.stringify(patch).replace(/</g, "\\u003c")});</script>`;
  const end = html.indexOf("};\n</script>");
  if (end < 0) throw new Error("config block not found in index.html");
  const at = end + "};\n</script>".length;
  return html.slice(0, at) + inject + html.slice(at);
}
const PAGE = page();

// ---------- routes ----------
async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) return send(res, 200, PAGE, { "cache-control": "no-cache" });
  if (req.method === "GET" && url.pathname === "/health") return send(res, 200, { ok: true });
  if (req.method === "GET" && url.pathname === "/api/tally") return send(res, 200, tally());

  if (req.method === "POST" && url.pathname === "/api/rpc") {
    if (limited(ip, 120)) return send(res, 429, { error: "slow down" });
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "bad json" }); }
    if (!body || !RPC_METHODS.has(body.method) || !Array.isArray(body.params)) return send(res, 403, { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not allowed" } });
    try {
      const result = await rpcCall(body.method, body.params);
      return send(res, 200, { jsonrpc: "2.0", id: body.id ?? 1, result });
    } catch (e) {
      return send(res, 200, { jsonrpc: "2.0", id: body.id ?? 1, error: { code: -32000, message: e.message } });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/votes") {
    if (limited(ip, 20)) return send(res, 429, { error: "slow down" });
    let b;
    try { b = JSON.parse(await readBody(req)); } catch { return send(res, 400, { error: "bad json" }); }
    // 1. the signed message is exactly {proposalId, side, wallet, timestamp, nonce}
    let m;
    try { m = JSON.parse(b.message); } catch { return send(res, 400, { error: "bad message" }); }
    const keys = Object.keys(m || {}).sort().join(",");
    if (keys !== "nonce,proposalId,side,timestamp,wallet") return send(res, 400, { error: "bad message" });
    if (!PROPOSALS.includes(m.proposalId)) return send(res, 400, { error: "unknown item" });
    if (m.side !== "drop" && m.side !== "not") return send(res, 400, { error: "bad side" });
    if (typeof m.nonce !== "string" || !/^[0-9a-f]{8,64}$/.test(m.nonce)) return send(res, 400, { error: "bad nonce" });
    if (!Number.isFinite(m.timestamp) || Math.abs(Date.now() - m.timestamp) > 10 * 60 * 1000) return send(res, 400, { error: "stale vote" });
    // 2. the wallet really signed it
    const sig = b58decode(b.signature);
    if (!verifyEd25519(m.wallet, b.message, sig)) return send(res, 401, { error: "bad signature" });
    // 3. one vote per wallet per item
    votes[m.proposalId] = votes[m.proposalId] || {};
    if (votes[m.proposalId][m.wallet]) return send(res, 409, { error: "already voted" });
    // 4. weight comes from the chain, never from the browser
    let weight = 1n, decimals = 0;
    if (MINT) {
      try { ({ raw: weight, decimals } = await balanceOf(m.wallet)); } catch (e) { return send(res, 503, { error: "could not read balance" }); }
      if (weight === 0n) return send(res, 403, { error: "no balance" });
    }
    if (votes[m.proposalId][m.wallet]) return send(res, 409, { error: "already voted" }); // re-check after the await
    votes[m.proposalId][m.wallet] = { side: m.side, weight: weight.toString(), decimals, ts: m.timestamp };
    save();
    return send(res, 200, { ok: true, tally: tally()[m.proposalId] });
  }

  send(res, 404, { error: "not found" });
}

http.createServer((req, res) => {
  handle(req, res).catch((e) => { if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : "server error" }); else res.end(); });
}).listen(PORT, "0.0.0.0", () => console.log(`LOOT on :${PORT}  mint=${MINT || "(none: weight 1)"}  rpc=${RPC_URL.replace(/\/\/([^/]{0,6})[^/]*/, "//$1…")}  data=${DATA_DIR}`));
