// #/main-tool: paste a mint, read it live, open the chest, show the facts, optionally seal the reading with a signature.

import { h, clear, fmt, isSolanaAddress, hashSeed, fmtUsd, fmtAmount, fmtTime, shortAddr, sleep, sha256hex, b58encode, download } from "./util.js";
import { COPY } from "./copy.js";
import { cfg, has, toast, copyWithToast, shareUrl, externalLink, chestsOpened, setChestsOpened, myChests, saveChests } from "./core.js";
import { readMint, readPair, readRugcheck, judge, ReadError } from "./chain.js";
import { mountFx, reducedMotion, PAL } from "./fx.js";
import { wallet, signText, verifySignature } from "./wallet.js";
import { sound } from "./sound.js";
import { openWalletModal } from "./ui.js";
import { wantedStars, stinger } from "./vice.js";

const T2 = COPY.tool2;
const KNOWN = [
  { n: "SOL", m: "So11111111111111111111111111111111111111112" },
  { n: "USDC", m: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" },
  { n: "BONK", m: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263" },
  { n: "JUP", m: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN" },
];
const liqPct = (usd) => Math.max(0, Math.min(100, ((Math.log10(Math.max(usd, 100)) - 2) / 4.3) * 100));

const T = COPY.tool;
const VERDICT_FX = { solid: "pickups/loot-beam", shaky: "scifi/hologram", nogo: "ui/heart-lost" };
// recoloured with pixelfx ramps: a gold beam for Clean, a neon-pink hologram for Wanted
const VERDICT_OPTS = { solid: { palette: PAL.gold }, shaky: { palette: PAL.neon }, nogo: {} };
const VERDICT_SOUND = { solid: "good", shaky: "warn", nogo: "bad", cant: "warn" };

// survives page rebuilds within a session so a revisit still shows the last reading
const S = { phase: "idle", mint: "", result: null, sealed: null, run: 0, lidCounted: false };
export const toolState = S;

const pretty = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const verdictLabel = (k) => ({ solid: T.verdicts.solid, shaky: T.verdicts.shaky, nogo: T.verdicts.nogo, cant: T.verdicts.cant })[k];

const authorityPhrase = (v) => v.authorityName || "";
function reasonSentence(result) {
  const v = result.verdict;
  return fmt(T.reasons[v.reasonKey] || T.reasons.cant, { authorityName: authorityPhrase(v) });
}
function resultSentence(result) {
  const f = result.facts, v = result.verdict;
  if (result.verdict.key === "cant") return T.sentences.cant;
  if (!f.pair) return f.marketFailed ? T.errors.dex : T.sentences.noPair;
  return fmt(T.sentences[v.sentenceKey], { liquidity: fmtUsd(f.pair.liquidityUsd), authorityName: v.authorityName || "" });
}
function factCards(result) {
  const f = result.facts, I = T.items;
  const cards = [
    { k: "supply", label: I.supply, value: fmtAmount(f.supply, f.decimals) },
    { k: "mint", label: I.mintAuth, value: f.mintAuthority == null ? I.renounced : I.active, sub: f.mintAuthority ? shortAddr(f.mintAuthority) : null, open: f.mintAuthority != null },
    { k: "freeze", label: I.freezeAuth, value: f.freezeAuthority == null ? I.renounced : I.active, sub: f.freezeAuthority ? shortAddr(f.freezeAuthority) : null, open: f.freezeAuthority != null },
  ];
  if (f.pair) {
    cards.push({ k: "liq", label: I.liquidity, value: fmtUsd(f.pair.liquidityUsd) });
    if (f.pair.volume24h != null) cards.push({ k: "vol", label: I.volume, value: fmtUsd(f.pair.volume24h) });
    cards.push({ k: "pool", label: I.pool, value: f.pair.ageDays != null ? fmt(I.poolValue, { dexName: pretty(f.pair.dexId), ageDays: f.pair.ageDays }) : pretty(f.pair.dexId) });
  }
  return cards;
}

/** Heat check: four pass/fail lines and a log-scale liquidity meter with the two thresholds marked. */
function heatBox(result) {
  const f = result.facts, solidMin = cfg.verdict.solidMinLiquidityUsd, thin = cfg.verdict.thinLiquidityUsd;
  const liq = f.pair ? f.pair.liquidityUsd : null;
  const checks = [
    { ok: f.mintAuthority == null, label: T2.heat.mint },
    { ok: f.freezeAuthority == null, label: T2.heat.freeze },
    { ok: liq != null ? liq >= solidMin : null, label: fmt(T2.heat.liq, { min: fmtUsd(solidMin) }) },
    { ok: f.pair ? true : f.marketFailed ? null : false, label: T2.heat.pool },
  ];
  const list = h("ul.heat-list", checks.map((c) => h("li", { class: c.ok === true ? "ok" : c.ok === false ? "bad" : "na" }, h("i.ck", c.ok === true ? "✓" : c.ok === false ? "✕" : "–"), c.label)));
  const meter = liq == null
    ? h("p.help", T2.meterNone)
    : h("div.meter", { role: "img", "aria-label": `${T2.meterTitle}: ${fmtUsd(liq)}` },
        h("div.meter-track", h("i.z.bad", { style: { width: `${liqPct(thin)}%` } }), h("i.z.mid", { style: { width: `${liqPct(solidMin) - liqPct(thin)}%` } }), h("i.z.ok", { style: { width: `${100 - liqPct(solidMin)}%` } }),
          h("b.needle", { style: { left: `${liqPct(liq)}%` } })),
        h("div.meter-labels", h("span", T2.meterThin + " " + fmtUsd(thin)), h("span", { style: { marginLeft: "auto" } }, T2.meterClean + " " + fmtUsd(solidMin) + "+")));
  return h("section.heat.late", h("h3", T2.heatTitle), list, h("h3.meter-title", T2.meterTitle), meter);
}

/** Build the reading from live data. Never invents a value: anything unreadable is simply absent. */
async function read(mint, hooks) {
  const [mintRes, pairRes, rugRes] = await Promise.allSettled([
    readMint(cfg, mint, hooks),
    readPair(mint),
    cfg.features.rugcheck ? readRugcheck(mint) : Promise.resolve(null),
  ]);
  if (mintRes.status === "rejected") throw mintRes.reason;
  const m = mintRes.value;
  const facts = {
    supply: m.supply, decimals: m.decimals, mintAuthority: m.mintAuthority, freezeAuthority: m.freezeAuthority,
    pair: pairRes.status === "fulfilled" ? pairRes.value : null,
    marketFailed: pairRes.status === "rejected",
    rugcheck: rugRes.status === "fulfilled" ? rugRes.value : null,
  };
  return { mint, ts: Date.now(), facts, verdict: judge(facts, cfg) };
}

function errorKind(e) {
  if (e instanceof ReadError) return e.kind;
  return "down";
}

// ---------------------------------------------------------------------------------------------

export function renderTool(root, { mint: queryMint = "" } = {}) {
  const wrap = h("div.wrap");
  root.append(wrap);
  wrap.append(h("p.eyebrow.light", T2.eyebrow), h("h1.page-title", T.title), h("p.page-sub", T.subtitle));
  if (!has(cfg.mint)) wrap.append(h("p.banner", T.noContract));

  const stepEls = T.steps.map((name, i) => h("li.step", { "data-step": i + 1 }, h("b", String(i + 1)), h("span", name), h("small", T.stepLines[i])));
  const steps = h("ol.steps", stepEls);
  wrap.append(steps);
  const setStep = (n) => stepEls.forEach((el, i) => { el.classList.toggle("on", i + 1 === n); el.classList.toggle("done", i + 1 < n); });

  // form
  const input = h("input#mint-input", { type: "text", name: "mint", autocomplete: "off", autocapitalize: "off", spellcheck: "false", placeholder: T.fieldHint, "aria-label": T.label, "aria-describedby": "mint-help", value: S.mint || queryMint || "" });
  const btn = h("button#btn-read.btn.primary", { type: "submit" }, T.button);
  const err = h("p#mint-error.error", { role: "alert", hidden: true });
  const pasteBtn = h("button.btn.ghost.small.paste", { type: "button" }, T2.paste);
  pasteBtn.addEventListener("click", async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      input.value = t; input.focus();
      if (isSolanaAddress(t)) run(t); else showError(T.errors.bad);
    } catch { toast(T2.pasteFail); input.focus(); }
  });
  const chip = (label, mint, verdict) => {
    const b = h("button.chip-btn", { type: "button", title: mint }, verdict ? h("i.dot", { class: verdict }) : null, label);
    b.addEventListener("click", () => { input.value = mint; run(mint); });
    return b;
  };
  const knownRow = h("div.chips-row", h("span.chips-label", T2.known), KNOWN.map((k) => chip(k.n, k.m)));
  const recentRow = h("div.chips-row");
  function paintRecent() {
    clear(recentRow);
    const seen = new Set(), items = [];
    for (const c of myChests()) { if (seen.has(c.mint)) continue; seen.add(c.mint); items.push(c); if (items.length >= 5) break; }
    recentRow.hidden = !items.length;
    if (items.length) recentRow.append(h("span.chips-label", T2.recent), ...items.map((c) => chip(shortAddr(c.mint), c.mint, c.verdict)));
  }
  paintRecent();
  const form = h("form#tool-form.card.form", { novalidate: true },
    h("label", { for: "mint-input" }, T.label), h("div.row", input, pasteBtn, btn), err, h("p#mint-help.help", T.helper), knownRow, recentRow);
  wrap.append(form);

  const out = h("div#tool-out.out");
  wrap.append(out);
  const foot = h("p.footnote", { hidden: true });
  wrap.append(foot);

  const showError = (msg) => { err.textContent = msg; err.hidden = !msg; input.setAttribute("aria-invalid", msg ? "true" : "false"); };
  const empty = () => { clear(out); out.append(h("div.card.empty", T.empty)); foot.hidden = true; };

  async function run(mint) {
    mint = mint.trim();
    showError("");
    if (!isSolanaAddress(mint)) { showError(T.errors.bad); sound.blip("bad"); return; }
    const run = ++S.run;
    S.mint = mint;
    S.phase = "reading";
    S.sealed = null;
    S.lidCounted = false;
    btn.disabled = true;
    setStep(2);
    clear(out);
    foot.hidden = true;
    const status = h("p#read-status.status", { "aria-live": "polite" }, T.reading[0]);
    const orbHost = h("div.orb");
    out.append(h("div.card.reading", orbHost, status));
    mountFx(orbHost, "pickups/xp-orb", { scale: 2 });
    let li = 0;
    const timer = setInterval(() => { li = (li + 1) % T.reading.length; status.textContent = T.reading[li]; }, 900);
    const alive = () => run === S.run && wrap.isConnected;
    let result = null, failure = null;
    const started = performance.now();
    try {
      result = await read(mint, { onBusy: () => { if (alive()) status.textContent = T.errors.rpcBusy; } });
    } catch (e) {
      failure = errorKind(e);
    }
    const wait = Math.max(0, 1900 - (performance.now() - started));
    if (wait) await sleep(reducedMotion() ? Math.min(wait, 300) : wait);
    clearInterval(timer);
    if (!alive()) return;
    btn.disabled = false;
    if (failure) {
      const msg = { offline: T.errors.offline, notToken: T.errors.notToken, none: T.sentences.cant, down: T.errors.rpcDown, busy: T.errors.rpcDown }[failure];
      S.result = { mint, ts: Date.now(), cant: true, verdict: { key: "cant", reasonKey: "cant" }, facts: null, message: msg };
      S.phase = "done";
      setStep(1);
      showCant(S.result);
      return;
    }
    S.result = result;
    S.phase = "done";
    remember(result);
    reveal(result, { animate: true, alive });
  }

  function showCant(result) {
    clear(out);
    foot.hidden = true;
    out.append(h("div.card.cant", h("span.badge.cant", T.verdicts.cant), h("p.sentence", T.sentences.cant), result.message && result.message !== T.sentences.cant ? h("p.help", result.message) : null));
    sound.blip("warn");
  }

  function remember(result) {
    const list = myChests();
    list.unshift({ mint: result.mint, verdict: result.verdict.key, reasonKey: result.verdict.reasonKey, ts: result.ts });
    saveChests(list);
    paintRecent();
  }

  function countLid() {
    if (S.lidCounted) return;
    S.lidCounted = true;
    setChestsOpened(chestsOpened() + 1);
  }

  /** Show a result. animate: play the chest and land the cards one by one. Otherwise show everything at once. */
  function reveal(result, { animate, alive = () => wrap.isConnected }) {
    clear(out);
    const reduced = reducedMotion();
    const play = animate && !reduced;
    const seed = hashSeed(result.mint);
    const v = result.verdict;
    const cards = factCards(result);

    // the chest, seeded from the mint so the same token always opens the same way
    const chestHost = h("div.chest-host", { "aria-hidden": "true" });
    const chestBox = h("div.chest-box", chestHost);
    const sentence = h("p#result-sentence.sentence", { "aria-live": "polite" }, resultSentence(result));
    const grid = h("div.facts");
    const dex = result.facts.pair?.url ? externalLink(result.facts.pair.url, T.items.dex, "dexlink") : null;
    const verdictFx = h("div.verdict-fx", { "aria-hidden": "true" });
    const badge = h("span.badge", { class: v.key }, verdictLabel(v.key));
    const why = h("p.why", fmt(T.reasonLine, { reason: reasonSentence(result), solidMin: fmtUsd(cfg.verdict.solidMinLiquidityUsd), thinMin: fmtUsd(cfg.verdict.thinLiquidityUsd) }));
    const verdictRow = h("div.verdict", verdictFx, h("div.verdict-text", badge, wantedStars(v.key), why));
    const rug = result.facts.rugcheck ? h("p.help", `${T.rugcheck}: ${result.facts.rugcheck.score != null ? result.facts.rugcheck.score : ""} ${result.facts.rugcheck.risks.join(", ")}`.trim()) : null;
    const noPair = !result.facts.pair && !result.facts.marketFailed ? h("p.help", T.noPairLine) : null;
    const sealBox = h("div#seal-box.card.seal");
    const caseHead = h("div.case-head",
      h("span.case-no", `${T2.caseFile} #${String(hashSeed(result.mint) % 10000).padStart(4, "0")}`),
      h("code.case-mint", shortAddr(result.mint)),
      h("button.linklike.case-copy", { type: "button", onclick: () => copyWithToast(result.mint, COPY.toast.addressCopied) }, T2.copyAddress));
    const heat = heatBox(result);
    const actions = h("div.btnrow.case-actions",
      h("button.btn.small.ghost", { type: "button", onclick: () => copyWithToast(shareUrl(`#/main-tool?mint=${result.mint}`)) }, T2.copyCase),
      h("button.btn.small.primary", { type: "button", onclick: () => { window.scrollTo(0, 0); document.querySelector(".page")?.scrollTo({ top: 0, behavior: "smooth" }); input.value = ""; input.focus(); } }, T2.another));
    out.append(chestBox, h("div.card.result", caseHead, sentence, grid, noPair, dex, verdictRow, heat, rug, actions), sealBox);
    const hide = [verdictRow, sealBox, heat, actions];
    foot.textContent = fmt(T.footnote, { time: fmtTime(result.ts) });

    const cardEls = cards.map((c) => h("div.fact", { class: c.open ? "open" : "", "data-k": c.k },
      h("span.fl", c.label), h("strong.fv", c.value), c.sub ? h("small.fs", c.sub) : null));
    const land = (el) => {
      grid.append(el);
      requestAnimationFrame(() => el.classList.add("in"));
      if (play) {
        const burst = h("div.burst", { "aria-hidden": "true" });
        el.append(burst);
        mountFx(burst, "pickups/collect-burst", { scale: 2, scaleSmall: 1, opts: { seed: seed + cardEls.indexOf(el) }, onDone: () => burst.remove() });
      }
    };
    const finish = () => {
      if (!alive()) return;
      verdictRow.classList.add("in");
      heat.classList.add("in");
      actions.classList.add("in");
      verdictFx.classList.toggle("tall", v.key === "solid");
      mountFx(verdictFx, VERDICT_FX[v.key], { scale: 2, opts: { seed, ...VERDICT_OPTS[v.key] }, stillAt: v.key === "nogo" ? 0.35 : undefined });
      sound.blip(VERDICT_SOUND[v.key]);
      if (play) stinger(v.key);
      sealBox.classList.add("in");
      foot.hidden = false;
      renderSeal(sealBox, result);
      setStep(S.sealed ? 3 : 2);
    };
    hide.forEach((e) => e.classList.add("late"));

    if (!play) {
      // revisit, reduced motion, or replay: a still chest and everything shown at once
      const p = mountFx(chestHost, "pickups/chest-open", { scale: 3, scaleSmall: 1.6, opts: { seed }, autoplay: false });
      p.still(2.3);
      sentence.classList.add("in");
      if (reduced && animate) countLid();
      cardEls.forEach((el) => { grid.append(el); el.classList.add("in"); });
      finish();
      if (S.sealed) renderSealed(sealBox, result);
      return;
    }

    sound.blip("open");
    // the one-shot ends empty by design, so the box then holds the opened chest with its loot on the floor
    const chest = mountFx(chestHost, "pickups/chest-open", { scale: 3, scaleSmall: 1.6, opts: { seed }, autoplay: true, onDone: () => chest.still(2.3) });
    // the lid kicks open at 0.8 s: the counter ticks and the sentence appears; cards land after
    setTimeout(() => { if (alive()) { countLid(); sentence.classList.add("in"); } }, 800);
    cardEls.forEach((el, i) => setTimeout(() => { if (alive()) land(el); }, 950 + i * 260));
    setTimeout(() => { if (alive()) finish(); }, 950 + cardEls.length * 260 + 350);
  }

  // ---- seal ----
  function renderSeal(box, result) {
    clear(box);
    if (S.sealed) return renderSealed(box, result);
    box.append(h("h2", T.sealTitle));
    if (!wallet.address) {
      box.append(h("p", T.sealConnect), h("button.btn.ghost", { type: "button", onclick: () => openWalletModal(() => renderSeal(box, result)) }, COPY.nav.connect));
      return;
    }
    const sealBtn = h("button#btn-seal.btn.primary", { type: "button" }, T.sealButton);
    sealBtn.addEventListener("click", async () => {
      sealBtn.disabled = true;
      const message = [
        COPY.seal.messageHead,
        `Mint: ${result.mint}`,
        `Verdict: ${verdictLabel(result.verdict.key)}`,
        `Reason: ${reasonSentence(result)}`,
        `Time: ${new Date(result.ts).toISOString()}`,
      ].join("\n");
      try {
        const signature = await signText(message);
        const fingerprint = await sha256hex(new Uint8Array([...new TextEncoder().encode(message), ...signature]));
        const verified = await verifySignature(wallet.address, message, signature);
        S.sealed = { message, signature: b58encode(signature), fingerprint, verified, address: wallet.address, ts: Date.now() };
        setStep(3);
        renderSealed(box, result, { celebrate: true });
      } catch (e) {
        sealBtn.disabled = false;
        if (e.code === "cancelled") toast(COPY.toast.cancelled);
        else toast(T.errors.rpcDown.replace(/Solana node/, "wallet"));
      }
    });
    box.append(h("p", T.sealExplainer), sealBtn);
  }

  function renderSealed(box, result, { celebrate = false } = {}) {
    clear(box);
    const s = S.sealed;
    box.append(h("h2", T.sealTitle));
    const fx = h("div.seal-fx", { "aria-hidden": "true" });
    box.append(fx);
    if (celebrate || !S.sealFxShown) {
      S.sealFxShown = true;
      mountFx(fx, "ui/quest-complete", { scale: 2, scaleSmall: 1, opts: { text: "SEALED" }, stillAt: 1.4 });
      sound.blip("good");
    }
    box.append(
      h("p.sealed", fmt(T.sealed, { hash8: s.fingerprint.slice(0, 8) })),
      h("p.help", s.verified === true ? COPY.vote.verified : s.verified === false ? "The signature did not verify in this browser." : COPY.vote.unverified),
      h("div.btnrow",
        h("button#btn-card.btn.ghost", { type: "button", onclick: () => saveCard(result) }, T.sealButtons.card),
        h("button#btn-proof.btn.ghost", { type: "button", onclick: () => saveProof(result) }, T.sealButtons.proof),
        externalLink(`https://x.com/intent/post?text=${encodeURIComponent(xPost(result))}`, T.sealButtons.share, "btn ghost"),
        h("button#btn-link.btn.ghost", { type: "button", onclick: () => copyWithToast(shareUrl(`#/main-tool?mint=${result.mint}`)) }, T.sealButtons.link)));
  }

  const xPost = (result) => fmt(T.xPost, { verdict: verdictLabel(result.verdict.key), reasonShort: reasonSentence(result), link: shareUrl(`#/main-tool?mint=${result.mint}`) });

  function saveProof(result) {
    const s = S.sealed;
    const proof = { app: "LOOT", mint: result.mint, verdict: verdictLabel(result.verdict.key), message: s.message, address: s.address, signature: s.signature, signatureEncoding: "base58", fingerprintSha256: s.fingerprint, verifiedInBrowser: s.verified, signedAt: new Date(s.ts).toISOString(), note: "A signature proves the wallet approved this text. It does not prove who holds the wallet." };
    download(`loot-proof-${result.mint.slice(0, 6)}.json`, new Blob([JSON.stringify(proof, null, 2)], { type: "application/json" }));
    toast(COPY.toast.proofSaved);
  }

  async function saveCard(result) {
    const W = 1200, Hh = 630;
    const c = h("canvas", { width: W, height: Hh });
    const g = c.getContext("2d");
    const grad = g.createLinearGradient(0, 0, 0, Hh);
    grad.addColorStop(0, "#2a0a52");
    grad.addColorStop(0.55, "#b02bd6");
    grad.addColorStop(1, "#ff5a6e");
    g.fillStyle = grad;
    g.fillRect(0, 0, W, Hh);
    g.fillStyle = "#19e3d1";
    g.fillRect(0, 0, W, 10);
    g.fillStyle = "#ffb400"; g.fillRect(0, 10, W, 6);
    // the chest logo, drawn pixelated
    try {
      const logo = new Image();
      const src = document.querySelector('link[rel="icon"]')?.href;
      await new Promise((res, rej) => { logo.onload = res; logo.onerror = rej; logo.src = src; });
      g.imageSmoothingEnabled = false;
      g.drawImage(logo, 60, 60, 192, 192);
    } catch { /* the card still works without the logo */ }
    const font = (px, w = "700") => `${w} ${px}px "Bungee", "Pixelify Sans", ui-monospace, Menlo, monospace`;
    g.fillStyle = "#ffe86a";
    g.font = font(64);
    g.fillText(`${cfg.name} / SOLANA`, 280, 120);
    g.fillStyle = "#fff3d6";
    g.font = font(40, "500");
    g.fillText(`Cracked a stash: ${shortAddr(result.mint)}`, 280, 180);
    const col = { solid: "#19e3a1", shaky: "#ffb400", nogo: "#ff3b5c", cant: "#9a8ab8" }[result.verdict.key];
    g.fillStyle = col;
    g.fillRect(60, 300, 300, 84);
    g.fillStyle = "#1d0638";
    g.font = font(44);
    g.fillText(verdictLabel(result.verdict.key), 84, 358);
    g.fillStyle = "#fff3d6";
    g.font = '400 28px "Outfit", system-ui, sans-serif';
    wrapText(g, `Why: ${reasonSentence(result)}.`, 400, 330, 740, 38);
    const f = result.facts;
    g.fillStyle = "#cfc6e6";
    const lines = [
      `Mint authority: ${f.mintAuthority == null ? "Renounced" : "Still active"}   Freeze authority: ${f.freezeAuthority == null ? "Renounced" : "Still active"}`,
      f.pair ? `Liquidity: ${fmtUsd(f.pair.liquidityUsd)}   Top pool: ${pretty(f.pair.dexId)}` : T.noPairLine,
      `Fingerprint ${S.sealed.fingerprint.slice(0, 8)}   Sealed ${fmtTime(S.sealed.ts)}`,
    ];
    lines.forEach((l, i) => g.fillText(l, 60, 450 + i * 40));
    g.fillStyle = "#8b8499";
    g.font = '400 22px "Outfit", system-ui, sans-serif';
    g.fillText(T.footnote.replace("{time}", fmtTime(result.ts)), 60, 590);
    c.toBlob((blob) => { if (blob) { download(`loot-card-${result.mint.slice(0, 6)}.png`, blob); toast(COPY.toast.cardSaved); } }, "image/png");
  }
  function wrapText(g, text, x, y, maxW, lh) {
    let line = "", yy = y;
    for (const word of text.split(" ")) {
      const test = line ? `${line} ${word}` : word;
      if (g.measureText(test).width > maxW && line) { g.fillText(line, x, yy); line = word; yy += lh; } else line = test;
    }
    if (line) g.fillText(line, x, yy);
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); run(input.value); });
  input.addEventListener("input", () => showError(""));

  // restore state on revisit
  setStep(1);
  if (queryMint) {
    input.value = queryMint;
    run(queryMint);
  } else if (S.result && S.phase === "done") {
    input.value = S.mint;
    if (S.result.cant) { showCant(S.result); }
    else { setStep(S.sealed ? 3 : 2); reveal(S.result, { animate: false }); }
  } else {
    empty();
  }
  return null;
}
