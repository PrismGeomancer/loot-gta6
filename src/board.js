// #/how, #/board and #/credits.

import { h, clear, fmt, fmtUsd, fmtTime, shortAddr, isSolanaAddress, download } from "./util.js";
import { COPY } from "./copy.js";
import { cfg, toast, copyWithToast, shareUrl, chestsOpened, setChestsOpened, myChests, saveChests, myVotes } from "./core.js";
import { mountFx } from "./fx.js";
import { judge } from "./chain.js";
import { LOOT_TABLE } from "./items.js";
import { MIT_TEXT, NOTICE_TEXT, EFFECTS_USED } from "./licenses.generated.js";

// ---------------- how (the plan) ----------------
const slug = { solid: "solid", shaky: "shaky", nogo: "nogo", cant: "cant" };
const STARS = { solid: 0, shaky: 3, nogo: 5, cant: 0 };

/** A log-scale slider value (0..100) to dollars, 0 to 2M. */
const sliderToUsd = (v) => (v <= 0 ? 0 : Math.round(Math.pow(10, 2 + (v / 100) * 4.3) / 100) * 100);
const usdToSlider = (usd) => (usd <= 100 ? 0 : Math.round(((Math.log10(usd) - 2) / 4.3) * 100));

function simulator() {
  const P = COPY.plan, T = COPY.tool;
  const st = { mint: false, freeze: false, liq: 30000, noPool: false };
  const result = h("div.sim-result", { "aria-live": "polite" });
  const seg = (label, key) => {
    const mk = (val, text) => {
      const b = h("button.seg-btn", { type: "button", "aria-pressed": "false" }, text);
      b.addEventListener("click", () => { st[key] = val; paint(); });
      b.dataset.val = String(val);
      return b;
    };
    const ok = mk(false, P.simRenounced), bad = mk(true, P.simActive);
    return { el: h("div.sim-row", h("span.sim-label", label), h("div.seg", ok, bad)), ok, bad };
  };
  const mintSeg = seg(P.simMint, "mint"), freezeSeg = seg(P.simFreeze, "freeze");
  const slider = h("input.sim-range", { type: "range", min: "0", max: "100", step: "1", value: String(usdToSlider(st.liq)), "aria-label": P.simLiq });
  const liqText = h("output.sim-liq");
  const noPool = h("label.sim-check", h("input", { type: "checkbox" }), P.simNoPool);
  const marks = h("div.sim-marks",
    h("span", { style: { left: `${usdToSlider(cfg.verdict.thinLiquidityUsd)}%` } }, fmtUsd(cfg.verdict.thinLiquidityUsd)),
    h("span", { style: { left: `${usdToSlider(cfg.verdict.solidMinLiquidityUsd)}%` } }, fmtUsd(cfg.verdict.solidMinLiquidityUsd)));
  const liqRow = h("div.sim-row.liq", h("span.sim-label", P.simLiq, " ", liqText), h("div.sim-slider", slider, marks), noPool);
  slider.addEventListener("input", () => { st.liq = sliderToUsd(Number(slider.value)); st.noPool = false; paint(); });
  noPool.querySelector("input").addEventListener("change", (e) => { st.noPool = e.target.checked; paint(); });
  const presets = h("div.sim-presets", h("span.sim-label", P.simPresets),
    P.presets.map((p) => {
      const b = h("button.chip-btn", { type: "button" }, p.label);
      b.addEventListener("click", () => { st.mint = p.mint; st.freeze = p.freeze; st.noPool = p.liq == null; if (p.liq != null) { st.liq = p.liq; slider.value = String(usdToSlider(p.liq)); } paint(); });
      return b;
    }));
  const root = h("section.card.sim", h("h2.sub.sim-title", P.simTitle), h("p.help", P.simSub), presets, mintSeg.el, freezeSeg.el, liqRow, result);

  function paint() {
    mintSeg.ok.setAttribute("aria-pressed", String(!st.mint)); mintSeg.bad.setAttribute("aria-pressed", String(st.mint));
    freezeSeg.ok.setAttribute("aria-pressed", String(!st.freeze)); freezeSeg.bad.setAttribute("aria-pressed", String(st.freeze));
    noPool.querySelector("input").checked = st.noPool;
    slider.disabled = st.noPool; liqRow.classList.toggle("off", st.noPool);
    liqText.textContent = st.noPool ? "n/a" : fmtUsd(st.liq);
    const facts = { mintAuthority: st.mint ? "sim" : null, freezeAuthority: st.freeze ? "sim" : null, pair: st.noPool ? null : { liquidityUsd: st.liq }, marketFailed: false };
    const v = judge(facts, cfg);
    const reason = fmt(T.reasons[v.reasonKey], { authorityName: v.authorityName || "" });
    const stars = h("div.wanted", { class: `lvl-${v.key}`, role: "img", "aria-label": fmt(COPY.vice.wantedLevel, { n: String(STARS[v.key]) }) });
    for (let i = 0; i < 5; i++) stars.append(h("span.star.on-" + (i < STARS[v.key] ? "y" : "n"), { class: i < STARS[v.key] ? "on" : "" }, "★"));
    stars.classList.add("lit");
    clear(result);
    result.className = `sim-result v-${v.key}`;
    result.append(h("span.badge", { class: v.key }, T.verdicts[v.key]), stars, h("p.why", fmt(P.simLine, { reason: reason.charAt(0).toUpperCase() + reason.slice(1) })));
  }
  paint();
  return root;
}

export function renderHow(root) {
  const P = COPY.plan, C = COPY.how;
  const wrap = h("div.wrap.plan",
    h("header.plan-hero",
      h("p.eyebrow.light", P.eyebrow),
      h("h1.page-title", C.title),
      h("p.page-sub", P.heroLine)));
  root.append(wrap);
  // missions: a vertical timeline
  wrap.append(h("ol.missions", P.missions.map((m, i) => h("li.mission",
    h("span.m-num", String(i + 1).padStart(2, "0")),
    h("div.m-body", h("small.m-label", fmt(P.missionLabel, { n: i + 1 })), h("h3", m.t), h("p", m.d)),
    h("span.m-tag", m.tag)))));
  wrap.append(simulator());
  // the four outcomes
  const fill = { solidMin: fmtUsd(cfg.verdict.solidMinLiquidityUsd), thinMin: fmtUsd(cfg.verdict.thinLiquidityUsd) };
  wrap.append(h("h2.sub", P.tiersTitle), h("div.tiers", ["solid", "shaky", "nogo", "cant"].map((k) => {
    const stars = h("div.wanted.mini", { "aria-hidden": "true" });
    for (let i = 0; i < 5; i++) stars.append(h("span.star", { class: i < STARS[k] ? "on lit" : "" }, "★"));
    return h("article.tier", { class: `t-${k}` }, h("span.badge", { class: k }, COPY.tool.verdicts[k]), stars, h("p", fmt(P.tiers[k], fill)));
  })));
  wrap.append(h("h2.sub", P.sidesTitle), h("div.sides-yes", h("div.card", h("h3", C.trader), h("p", C.traderText)), h("div.card", h("h3", C.skeptic), h("p", C.skepticText))));
  wrap.append(h("h2.sub", P.faqTitle), h("div.faq", P.faq.map((f, i) => h("details.faq-item", { open: i === 0 }, h("summary", f.q), h("p", f.a)))));
  wrap.append(h("section.cta-band", h("div", h("h2", P.ctaTitle), h("p", P.ctaSub)), h("a.btn.primary", { href: "#/main-tool" }, COPY.nav.links[0].label)));
}

// ---------------- board ----------------
const VERDICT_LABEL = { solid: COPY.tool.verdicts.solid, shaky: COPY.tool.verdicts.shaky, nogo: COPY.tool.verdicts.nogo, cant: COPY.tool.verdicts.cant };

function sanitizeLog(json) {
  if (!json || json.app !== "LOOT" || !Array.isArray(json.chests)) return null;
  const chests = json.chests
    .filter((c) => c && typeof c.mint === "string" && isSolanaAddress(c.mint) && VERDICT_LABEL[c.verdict] && Number.isFinite(c.ts))
    .map((c) => ({ mint: c.mint, verdict: c.verdict, reasonKey: typeof c.reasonKey === "string" ? c.reasonKey : "cant", ts: c.ts }));
  return { chests, opened: Number.isFinite(json.chestsOpened) ? Math.max(0, Math.floor(json.chestsOpened)) : null };
}

export function renderBoard(root) {
  const C = COPY.board;
  const wrap = h("div.wrap", h("h1.page-title", C.title), h("p.page-sub", C.subtitle));
  root.append(wrap);
  const tiles = h("div.tiles");
  wrap.append(tiles);
  const paintTiles = () => {
    clear(tiles);
    [[C.tiles[0], LOOT_TABLE.length], [C.tiles[1], chestsOpened()], [C.tiles[2], Object.keys(myVotes()).length]]
      .forEach(([k, v]) => tiles.append(h("div.tile", h("small", k), h("strong", String(v)))));
  };
  paintTiles();

  const tabs = h("div.tabs", { role: "tablist" });
  const panel = h("div.tabpanel", { role: "tabpanel" });
  wrap.append(tabs, panel);
  let current = 0;
  const tabBtns = C.tabs.map((name, i) => {
    const b = h("button.tab", { type: "button", role: "tab", id: `tab-${i}`, "aria-selected": String(i === 0) }, name);
    b.addEventListener("click", () => show(i));
    tabs.append(b);
    return b;
  });
  tabs.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { show((current + (e.key === "ArrowRight" ? 1 : 1 + C.tabs.length - 2)) % C.tabs.length); tabBtns[current].focus(); }
  });

  function show(i) {
    current = i;
    tabBtns.forEach((b, j) => { b.setAttribute("aria-selected", String(i === j)); b.classList.toggle("on", i === j); });
    panel.setAttribute("aria-labelledby", `tab-${i}`);
    clear(panel);
    if (i === 0) lootTable(); else myChestsTab();
  }

  function lootTable() {
    const grid = h("div.loot-grid");
    for (const it of LOOT_TABLE) {
      const art = h("div.art", { "aria-hidden": "true" });
      mountFx(art, it.fx, { scale: it.scale, scaleSmall: it.small, opts: it.opts || {} });
      const t = C.table[it.id];
      grid.append(h("article.card.loot-item", art, h("h3", t.name), h("p.desc", t.desc)));
    }
    panel.append(grid);
  }

  function myChestsTab() {
    const list = myChests();
    const bar = h("div.btnrow");
    const file = h("input", { type: "file", accept: "application/json,.json", hidden: true, "aria-label": C.import });
    bar.append(
      h("button#btn-export.btn.ghost.small", { type: "button", onclick: exportLog }, C.export),
      h("button#btn-import.btn.ghost.small", { type: "button", onclick: () => file.click() }, C.import), file);
    file.addEventListener("change", async () => {
      const f = file.files && file.files[0];
      file.value = "";
      if (!f) return;
      try {
        const parsed = sanitizeLog(JSON.parse(await f.text()));
        if (!parsed) throw new Error("shape");
        const have = new Set(myChests().map((c) => `${c.mint}:${c.ts}`));
        const merged = [...parsed.chests.filter((c) => !have.has(`${c.mint}:${c.ts}`)), ...myChests()].sort((a, b) => b.ts - a.ts);
        saveChests(merged);
        if (parsed.opened != null && parsed.opened > chestsOpened()) setChestsOpened(parsed.opened);
        toast(COPY.toast.logImported);
        paintTiles();
        show(1);
      } catch {
        toast(C.importError);
      }
    });
    panel.append(bar);
    if (!list.length) panel.append(h("p.empty.card", C.empty));
    else {
      panel.append(h("ul.chest-list", list.map((c) => h("li.card.mychest",
        h("code", shortAddr(c.mint)),
        h("span.badge", { class: c.verdict }, VERDICT_LABEL[c.verdict] || c.verdict),
        h("time", fmtTime(c.ts)),
        h("div.btnrow",
          h("a.btn.ghost.small", { href: `#/main-tool?mint=${c.mint}` }, C.again),
          h("button.btn.ghost.small", { type: "button", onclick: () => copyWithToast(shareUrl(`#/main-tool?mint=${c.mint}`)) }, C.link))))));
    }
    panel.append(h("p.help", C.note));
  }

  function exportLog() {
    const data = { app: "LOOT", version: 1, exportedAt: new Date().toISOString(), chestsOpened: chestsOpened(), chests: myChests() };
    download("loot-log.json", new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    toast(COPY.toast.logExported);
  }
  show(0);
}

// ---------------- credits ----------------
export function renderCredits(root) {
  const C = COPY.credits;
  const wrap = h("div.wrap", h("h1.page-title", C.title), h("p.credits-text", C.text));
  root.append(wrap);
  wrap.append(h("h2.sub", C.effectsUsed), h("ul.effects-used", EFFECTS_USED.map((e) => h("li", h("code", e.id), " ", e.name))));
  wrap.append(h("details.card.licenses", h("summary", C.licenses),
    h("h3", "MIT License (pixelfx, Patch, Hugo Duprez)"), h("pre", MIT_TEXT),
    h("h3", "NOTICE.md"), h("pre", NOTICE_TEXT)));
}
