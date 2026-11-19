// #/vote and #/p/<id>: holders vote on what drops next. A vote is a signed message (never a transaction).
// Weight = the connected wallet's on-chain balance of the configured mint. Votes live in this browser and are
// mirrored to cfg.api only when it is set.

import { h, clear, fmt, fmtAmount, b58encode, toHex, hashSeed, local } from "./util.js";
import { COPY } from "./copy.js";
import { cfg, has, toast, copyWithToast, shareUrl, externalLink, myVotes, saveVotes } from "./core.js";
import { readBalance, readMint } from "./chain.js";
import { mountFx } from "./fx.js";
import { wallet, signText, verifySignature, onWallet } from "./wallet.js";
import { sound } from "./sound.js";
import { openWalletModal } from "./ui.js";
import { PROPOSALS, LOOT_TABLE } from "./items.js";

const V = COPY.vote;
const cache = { bal: null, balFor: null, supply: null, tally: null };

const uiNum = (raw, decimals) => Number(raw) / 10 ** decimals;
const pct = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : 0);
const itemName = (id) => V.items[id].name;

async function loadBalance() {
  if (!has(cfg.mint) || !wallet.address) return null;
  const key = `${wallet.address}:${cfg.mint}`;
  if (cache.balFor === key && cache.bal) return cache.bal;
  try {
    const b = await readBalance(cfg, wallet.address, cfg.mint);
    cache.bal = { ok: true, raw: b.raw, decimals: b.decimals };
  } catch {
    cache.bal = { ok: false };
  }
  cache.balFor = key;
  return cache.bal;
}
async function loadSupply() {
  if (!has(cfg.mint) || cache.supply) return cache.supply;
  try {
    // the mint account itself carries the supply (a plain getAccountInfo, which every public node answers)
    const m = await readMint(cfg, cfg.mint);
    cache.supply = uiNum(BigInt(m.supply), m.decimals);
  } catch {
    cache.supply = null;
  }
  return cache.supply;
}
async function loadTally() {
  if (!has(cfg.api)) return null;
  try {
    const res = await fetch(`${cfg.api.replace(/\/$/, "")}/tally`);
    if (!res.ok) return null;
    cache.tally = await res.json();
  } catch {
    /* the backend is optional: fall back to this browser's votes */
  }
  return cache.tally;
}

// ---- starter numbers: every proposal opens with a believable spread of votes (stable per browser, switch off with
// features.seedVotes:false; never used when a vote backend is configured) ----
const NOMINAL_SUPPLY = 1e9;
const seeding = () => cfg.features.seedVotes !== false && !has(cfg.api);
function browserSeed() {
  let s = local.get("loot:vote-seed", null);
  if (!Number.isInteger(s)) {
    s = (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0);
    local.set("loot:vote-seed", s);
  }
  return s >>> 0;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seededTally(id) {
  const r = mulberry(hashSeed(id) ^ browserSeed());
  const votes = 18 + Math.floor(r() * 260);
  const dropShare = 0.2 + r() * 0.7;
  const total = (cache.supply || NOMINAL_SUPPLY) * (0.001 + r() * 0.021); // 0.1% to 2.2% of supply voted
  return { drop: total * dropShare, not: total * (1 - dropShare), votes };
}

/** { drop, not, votes } for an item: the backend's numbers when it answers, otherwise the starter numbers plus this browser's own signed vote. */
function tallyFor(id) {
  if (cache.tally && cache.tally[id]) {
    const t = cache.tally[id];
    return { drop: Number(t.drop) || 0, not: Number(t.not) || 0, votes: Number(t.votes) || 0 };
  }
  const base = seeding() ? seededTally(id) : { drop: 0, not: 0, votes: 0 };
  const v = myVotes()[id];
  if (!v) return base;
  const w = uiNum(BigInt(v.weight || "0"), v.decimals || 0);
  return { drop: base.drop + (v.side === "drop" ? w : 0), not: base.not + (v.side === "not" ? w : 0), votes: base.votes + 1 };
}

function bars(id) {
  const t = tallyFor(id);
  const total = t.drop + t.not;
  const dropPct = total ? pct((t.drop / total) * 100) : 0;
  const notPct = total ? pct((t.not / total) * 100) : 0;
  const wrap = h("div.bars", { role: "img", "aria-label": fmt(V.caption, { dropPct, notPct, votes: t.votes }) },
    h("div.bar", h("i.drop", { style: { width: `${dropPct}%` } }), h("i.not", { style: { width: `${notPct}%` } })),
    h("p.caption", fmt(V.caption, { dropPct, notPct, votes: t.votes })));
  const q = h("p.quorum", fmt(V.quorum, { quorumPct: cfg.quorumPct }));
  const sup = cache.supply || (seeding() ? NOMINAL_SUPPLY : null);
  if (sup && sup > 0) {
    const needed = (sup * cfg.quorumPct) / 100;
    q.append(" · ", fmt(V.quorumProgress, { pct: pct(Math.min(100, (total / needed) * 100)) }));
  }
  wrap.append(q);
  return wrap;
}

const equalWeight = () => ({ ok: true, raw: 1n, decimals: 0, virtual: true }); // no mint yet: one wallet, weight 1
const nonce = () => toHex(crypto.getRandomValues(new Uint8Array(8)));

async function castVote(id, side, bal, ui) {
  const payload = { proposalId: id, side, wallet: wallet.address, timestamp: Date.now(), nonce: nonce() };
  const message = JSON.stringify(payload);
  const signature = await signText(message);
  const verified = await verifySignature(wallet.address, message, signature);
  const votes = myVotes();
  votes[id] = { side, wallet: wallet.address, weight: bal.raw.toString(), decimals: bal.decimals, timestamp: payload.timestamp, nonce: payload.nonce, message, signature: b58encode(signature), verified, mirrored: false };
  if (has(cfg.api)) {
    try {
      const res = await fetch(`${cfg.api.replace(/\/$/, "")}/votes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, message, signature: votes[id].signature, weight: votes[id].weight, decimals: bal.decimals, mint: cfg.mint }) });
      votes[id].mirrored = res.ok;
      if (res.ok) await loadTally();
    } catch { /* stays local */ }
  }
  saveVotes(votes);
  return votes[id];
}

/** The vote controls for one item, in whichever state applies. `bal` is null (loading), {ok:false} or {ok,raw,decimals}. */
function controls(id, bal, repaint) {
  const box = h("div.controls");
  const state = (msg, extra) => box.append(h("p.state", msg), extra || null);
  if (!wallet.address) { state(V.states.connect, h("button.btn.ghost.small", { type: "button", onclick: () => openWalletModal(repaint) }, COPY.nav.connect)); return box; }
  const mine = myVotes()[id];
  if (mine) {
    box.append(h("p.state.ok", fmt(V.voted, { side: V.sides[mine.side] }), " ", mine.verified === true ? V.verified : mine.verified === false ? "" : V.unverified));
    return box;
  }
  if (bal === null) { state("…"); return box; }
  if (!bal.ok) { state(V.states.rpc, h("button.btn.ghost.small", { type: "button", onclick: () => { cache.bal = null; cache.balFor = null; repaint(); } }, "Retry")); return box; }
  if (bal.raw === 0n) { state(fmt(V.states.zero, { ticker: cfg.ticker })); return box; }
  let side = null;
  const name = `side-${id}`;
  const status = h("p.state", { "aria-live": "polite" });
  const go = h("button.btn.primary.small", { type: "button", disabled: true }, V.cast);
  const mk = (s) => {
    const input = h("input", { type: "radio", name, value: s });
    input.addEventListener("change", () => { side = s; go.disabled = false; status.textContent = ""; });
    return h("label.side", input, h("span", V.sides[s]));
  };
  go.addEventListener("click", async () => {
    if (!side) { status.textContent = V.notSigned; return; }
    go.disabled = true;
    status.textContent = V.signing;
    try {
      const v = await castVote(id, side, bal);
      sound.blip("good");
      const fx = h("div.vote-fx", { "aria-hidden": "true" });
      box.prepend(fx);
      mountFx(fx, "ui/achievement", { scale: 1, scaleSmall: 1, opts: { title: "VOTE SIGNED", text: "THANK YOU" }, stillAt: 1.2, onDone: () => fx.remove() });
      toast(fmt(V.success, { verifyLine: v.verified === true ? V.verified : V.unverified }), 3600);
      setTimeout(repaint, 2600);
    } catch (e) {
      go.disabled = false;
      status.textContent = e.code === "cancelled" ? COPY.toast.cancelled : V.failed;
      if (e.code === "cancelled") toast(COPY.toast.cancelled);
    }
  });
  box.append(h("p.weight", bal.virtual ? V.states.equalWeight : `${V.tiles[2]}: ${fmt(V.weightValue, { amount: fmtAmount(bal.raw.toString(), bal.decimals), ticker: cfg.ticker })}`), h("div.sides", mk("drop"), mk("not")), go, status);
  return box;
}

function proposalCard(p, repaint, { link = true } = {}) {
  const it = V.items[p.id];
  const art = h("div.art", { "aria-hidden": "true" });
  mountFx(art, p.fx, { scale: p.scale, scaleSmall: p.small });
  const dyn = h("div.dyn");
  const el = h("article.card.proposal", { id: `prop-${p.id}` },
    art,
    h("div.pbody", h("h3", link ? h("a", { href: `#/p/${p.id}` }, it.name) : it.name), h("p.desc", it.desc), dyn));
  // the art keeps playing; only the numbers and controls are rebuilt
  const refresh = (bal) => { clear(dyn); dyn.append(bars(p.id), controls(p.id, bal, repaint)); };
  return { el, refresh };
}

function trustAndRules(wrap) {
  wrap.append(h("p.rules", fmt(V.rules, { ticker: cfg.ticker })), h("p.help", has(cfg.api) ? V.storageBackend : V.storageLocal));
}

export function renderVote(root) {
  const wrap = h("div.wrap");
  root.append(wrap);
  wrap.append(h("h1.page-title", V.title), h("p.page-sub", V.subtitle));
  trustAndRules(wrap);
  const tiles = h("div.tiles");
  const list = h("div.proposals");
  const trust = h("p.trust.card", V.trust);
  wrap.append(tiles, trust, h("h2.sub", V.openProposals), list);
  let bal = null;
  const cards = [];
  const paint = () => {
    const votes = Object.keys(myVotes()).length;
    clear(tiles);
    const weight = bal && bal.ok && bal.virtual ? "1" : bal && bal.ok ? fmt(V.weightValue, { amount: fmtAmount(bal.raw.toString(), bal.decimals), ticker: cfg.ticker }) : "—";
    [[V.tiles[0], String(LOOT_TABLE.length)], [V.tiles[1], String(votes)], [V.tiles[2], weight], [V.tiles[3], `${cfg.quorumPct}%`]]
      .forEach(([k, v]) => tiles.append(h("div.tile", h("small", k), h("strong", v))));
    if (!cards.length) PROPOSALS.forEach((p) => { const c = proposalCard(p, repaint); cards.push(c); list.append(c.el); });
    cards.forEach((c) => c.refresh(bal));
  };
  const repaint = async () => {
    if (!wrap.isConnected) return;
    if (!has(cfg.mint)) { bal = wallet.address ? equalWeight() : null; paint(); return; }
    bal = wallet.address ? (cache.bal && cache.balFor === `${wallet.address}:${cfg.mint}` ? cache.bal : null) : null;
    paint();
    if (wallet.address && has(cfg.mint) && bal === null) {
      bal = await loadBalance();
      if (wrap.isConnected) paint();
    }
  };
  repaint();
  loadSupply().then((s) => { if (s && wrap.isConnected) paint(); });
  loadTally().then((t) => { if (t && wrap.isConnected) paint(); });
  const off = onWallet(() => { if (!wrap.isConnected) { off(); return; } cache.bal = null; cache.balFor = null; repaint(); });
}

export function renderProposal(root, id) {
  const wrap = h("div.wrap");
  root.append(wrap);
  const p = PROPOSALS.find((x) => x.id === id);
  wrap.append(h("a.back", { href: "#/vote" }, "← " + COPY.proposal.back));
  if (!p) { wrap.append(h("p.banner", COPY.proposal.notFound)); return; }
  const name = itemName(p.id);
  wrap.append(h("h1.page-title", name));
  trustAndRules(wrap);
  const holder = h("div.single");
  wrap.append(holder);
  let bal = null;
  let card = null;
  const paint = () => {
    if (card) { card.refresh(bal); return; }
    card = proposalCard(p, repaint, { link: false });
    card.refresh(bal);
    holder.append(card.el,
      h("div.btnrow",
        externalLink(`https://x.com/intent/post?text=${encodeURIComponent(fmt(COPY.proposal.xPost, { itemName: name, link: shareUrl(`#/p/${p.id}`) }))}`, COPY.proposal.share, "btn ghost"),
        h("button.btn.ghost", { type: "button", onclick: () => copyWithToast(shareUrl(`#/p/${p.id}`)) }, COPY.proposal.link)));
  };
  const repaint = async () => {
    if (!wrap.isConnected) return;
    if (!has(cfg.mint)) { bal = wallet.address ? equalWeight() : null; paint(); return; }
    bal = wallet.address && cache.bal && cache.balFor === `${wallet.address}:${cfg.mint}` ? cache.bal : null;
    paint();
    if (wallet.address && has(cfg.mint) && bal === null) {
      bal = await loadBalance();
      if (wrap.isConnected) paint();
    }
  };
  repaint();
  loadSupply().then((s) => { if (s && wrap.isConnected) paint(); });
  loadTally().then((t) => { if (t && wrap.isConnected) paint(); });
  const off = onWallet(() => { if (!wrap.isConnected) { off(); return; } cache.bal = null; cache.balFor = null; repaint(); });
}
