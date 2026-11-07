// What to do now: every stock you hold, heart or keep in a theme gets one call (buy now / swing / wait for price /
// hold / trim / skip) and the best five long-term buys for today's market. Reads /api/decide.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
  const px = v => (fin(v) ? `₹${v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toFixed(1)}` : "—");
  const parseAmt = t => { const m = String(t ?? "").replace(/[,₹\s]/g, "").toLowerCase().match(/^(\d+(?:\.\d+)?)(cr|crore|l|lakh|lac|k)?$/); if (!m) return null; const x = Number(m[1]), u = m[2] || ""; return Math.round(x * (u.startsWith("c") ? 1e7 : u.startsWith("l") ? 1e5 : u === "k" ? 1e3 : 1)); };
  const LANES = { buy: ["🟢", "Long-term: buy now"], swing: ["⚡", "Swing trade"], wait: ["⏳", "Long-term: wait for price"], hold: ["✋", "Hold, don't add"], trim: ["✂️", "Trim / exit"], skip: ["·", "Skip"] };
  const MOOD = { strong: "ok", dip: "info", weak: "warn", bear: "warn", unknown: "info" };
  let d = null, lane = "all", amount = null;
  try { amount = Number(localStorage.getItem("decide-amount")) || null; } catch { /* private mode */ }
  async function load() {
    try { const r = await fetch(`/api/decide${amount ? `?amount=${amount}` : ""}`, { credentials: "same-origin" }); const j = await r.json(); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); d = j; render(); }
    catch (e) { $("#dcBody").innerHTML = `<p class="hint">Could not load: ${esc(e.message)}</p>`; }
  }
  const bar = (v, cls) => (fin(v) ? `<span class="dc-bar ${cls}" title="${v}/100"><span class="t"><i style="width:${v}%"></i></span><b>${v}</b></span>` : '<span class="hint">—</span>');
  const zone = r => (fin(r.zoneHigh) ? `${px(r.zoneLow)}–${px(r.zoneHigh)}${fin(r.awayPct) ? `<div class="hint">${r.awayPct <= 0 ? "in / below zone" : `${r.awayPct}% above`}</div>` : ""}` : "—");
  const trend = r => (r.trend === "up" ? '<span class="up">▲ uptrend</span>' : r.trend === "down" ? '<span class="dn">▼ below 200-DMA</span>' : r.trend === "flat" ? "→ flat" : "—") + (fin(r.offHigh) ? `<div class="hint">${r.offHigh}% off 1-yr high</div>` : "");
  const tags = r => r.sources.map(s => `<span class="dc-src">${esc(s.replace("Theme: ", "🧭 "))}</span>`).join("");
  function card(r, i) {
    const split = d.split ? `<div class="dc-split">${d.split.parts > 1 ? `Put <b>${amt(d.split.now)}</b> now, the same at −5% and −10% (${amt(d.split.each)} in all)` : `Put <b>${amt(d.split.each)}</b> here`}</div>` : "";
    return `<article class="dc-card" data-sym="${esc(r.symbol)}"><div class="dc-rank">${i + 1}</div><div class="dc-main">
      <div class="dc-head"><div><b>${esc(r.name)}</b><div class="hint">${esc(r.symbol)}${r.sector ? ` · ${esc(r.sector)}` : ""} · ${px(r.price)}</div></div><div class="dc-tags">${tags(r)}</div></div>
      <p class="dc-act">${esc(r.action)}</p>${split}
      <div class="dc-meta"><span>Quality ${bar(r.quality, "q")}</span><span>Value ${bar(r.value, "v")}</span><span>Buy zone ${zone(r)}</span><span>${trend(r)}</span></div>
      ${r.why.length ? `<div class="dc-why">${r.why.map(t => `<span class="fc-plus">+ ${esc(t)}</span>`).join("")}${r.against.map(t => `<span class="fc-minus">− ${esc(t)}</span>`).join("")}</div>` : ""}
    </div></article>`;
  }
  function render() {
    if (!d) return;
    const m = d.market, c = d.counts, total = d.rows.length;
    if (!total) { $("#dcBody").innerHTML = '<p class="nw-empty-row">Nothing to judge yet. Sync your holdings, ❤ some stocks, or add stocks to Long-term themes, then come back.</p>'; return; }
    const top = d.top.map(s => d.rows.find(r => r.symbol === s));
    const head = `<section class="report-card bk-acts"><p class="bk-act ${MOOD[m.mood]}"><b>${esc(m.label)}.</b> ${esc(m.text)}</p>
      <div class="dc-amt"><label for="dcAmt">Money to invest now</label><input id="dcAmt" class="ui-input" inputmode="decimal" placeholder="e.g. 5L" value="${amount ? esc(amount >= 1e5 ? `${+(amount / 1e5).toFixed(2)}L` : String(amount)) : ""}"><span class="hint">optional: splits it across the Top ${d.rules.top}</span></div></section>`;
    const tops = `<section class="report-card"><h3>🏆 Top ${d.rules.top} to focus on now <span class="hint">best long-term buys from your own list${m.mood === "weak" || m.mood === "bear" ? ", weighted for a weak market (quality and stocks holding up)" : ""}; at most ${d.rules.maxPerSector} per sector</span></h3>
      ${top.length ? `<div class="dc-cards">${top.map(card).join("")}</div>` : `<p class="hint">No stock in your list is a good business at a fair price today.</p>`}
      ${d.next.length ? `<p class="dc-next"><b>⏳ Next to watch</b> (good businesses closest to their buy zone): ${d.next.map(s => { const r = d.rows.find(x => x.symbol === s); return `<a href="#" data-sym="${esc(s)}">${esc(r.name)}</a> <span class="hint">${r.awayPct}% away</span>`; }).join(" · ")}</p>` : ""}</section>`;
    const tips = d.tips.length ? `<section class="report-card bk-acts">${d.tips.map(t => `<p class="bk-act info">💡 ${esc(t)}</p>`).join("")}</section>` : "";
    const chips = `<div class="dc-chips">${[["all", "All", total], ...Object.keys(LANES).map(k => [k, `${LANES[k][0]} ${LANES[k][1]}`, c[k]])].map(([k, l, n]) => `<button type="button" class="pf-chip${lane === k ? " active" : ""}" data-lane="${k}"${n ? "" : " disabled"}>${esc(l)}<b>${n}</b></button>`).join("")}</div>`;
    const rows = d.rows.filter(r => lane === "all" || r.lane === lane);
    const table = `<section class="report-card"><h3>Every stock, one call <span class="hint">your holdings, favourites and theme stocks</span></h3>${chips}
      <div class="table-wrap"><table class="dc-table"><thead><tr><th>Stock</th><th>Call</th><th>What to do</th><th>Quality</th><th>Value</th><th>Buy zone</th><th>Trend</th><th>Why</th></tr></thead><tbody>
      ${rows.map(r => `<tr data-sym="${esc(r.symbol)}"><td><div class="company">${esc(r.name)}${d.top.includes(r.symbol) ? " 🏆" : ""}</div><div class="ticker">${esc(r.symbol)} · ${px(r.price)}${r.held?.value > 0 ? ` · own ${amt(r.held.value)}${fin(r.held.pnlPct) ? ` (${r.held.pnlPct > 0 ? "+" : ""}${r.held.pnlPct}%)` : ""}` : ""}</div><div class="dc-tags">${tags(r)}</div></td>
        <td><span class="dc-lane l-${r.lane}">${LANES[r.lane][0]} ${esc(LANES[r.lane][1])}</span></td><td class="kpi">${esc(r.action)}</td><td>${bar(r.quality, "q")}</td><td>${bar(r.value, "v")}</td><td class="range">${zone(r)}</td><td>${trend(r)}</td>
        <td class="kpi">${r.why.map(t => `<span class="fc-plus">+ ${esc(t)}</span>`).join(" ")} ${r.against.map(t => `<span class="fc-minus">− ${esc(t)}</span>`).join(" ")}</td></tr>`).join("")}</tbody></table></div></section>`;
    const notes = `<p class="vs-fine">How the call is made: <b>Quality</b> (0–100) scores returns on capital, growth, debt, cash conversion and promoter holding; ≥ ${d.rules.goodQuality} is a long-term keeper. <b>Value</b> compares the price with the fair value; ≥ ${d.rules.fairValue}, or within ${d.rules.nearZonePct}% of the buy zone, is a fair price. A good business at a fair price is a long-term buy; at a higher price, wait. A chart setup on a stock that isn't a keeper is a swing trade, not an investment. Trim / exit comes from Holdings clean-up. Trend and strength vs Nifty come from the daily swing scan${d.scanAt ? ` (last run ${new Date(d.scanAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })})` : ""}. Rule-based on saved data, not advice: check the latest results before you buy.</p>`;
    const pb = d.playbook, mv = pb?.move, pct = v => (fin(v) ? `${v > 0 ? "+" : ""}${v}%` : "—");
    const pbList = (title, hint, list, line) => `<div class="pb-col"><h4>${title}</h4><p class="hint">${hint}</p>${list.length ? `<ul>${list.map(r => `<li data-sym="${esc(r.symbol)}"><b>${esc(r.name)}</b> <span class="hint">${px(r.price)}${fin(r.d5) ? ` · ${pct(r.d5)} in 5 days` : ""}</span><div class="pb-why">${line(r)}</div></li>`).join("")}</ul>` : '<p class="hint">None in your list right now.</p>'}</div>`;
    const play = pb && pb.kind !== "normal" ? `<section class="report-card pb ${pb.kind}"><h3>${pb.kind === "rally" ? "🚀 The market just ran up" : "📉 The market just fell"}: what to do <span class="hint">Nifty ${pct(mv?.d1)} today · ${pct(mv?.d2)} in 2 days · ${pct(mv?.d5)} in 5 days</span></h3>
      <ol class="pb-money">${pb.money.map(t => `<li>${esc(t)}</li>`).join("")}</ol>
      <div class="pb-grid">
        ${pbList("🟢 Still at a fair price", "Good businesses that haven't run with the market: the place for new money", pb.laggards, r => esc(r.action || ""))}
        ${pbList("⚡ Swing: breakouts", "Riding the move: smaller size, stop set on day one", pb.breakouts, r => r.swing ? `${esc(r.swing.label)}: entry ${px(r.swing.entry)}, stop ${px(r.swing.stop)}, target ${px(r.swing.t1)}` : "")}
        ${pbList("💰 Book some profit", "Holdings now well above their buy zone: sell 20–30%, keep the rest", pb.book, r => `${fin(r.pnlPct) ? `up ${r.pnlPct}% on your cost · ` : ""}${fin(r.awayPct) && r.awayPct > 0 ? `${r.awayPct}% above the buy zone` : "priced high for its earnings"}`)}
        ${pbList("✋ Don't chase", "Stocks you like that just jumped: wait for the price", pb.chase, r => fin(r.zoneHigh) ? `wait for ${px(r.zoneHigh)} or lower (${r.awayPct}% away)` : "wait for a better price")}
      </div></section>`
      : pb?.move ? `<p class="hint pb-calm">Nifty ${pct(mv.d2)} in 2 days, ${pct(mv.d5)} in 5 days: no sharp move. If the market runs up or falls fast, a playbook for that day appears here.</p>` : "";
    $("#dcBody").innerHTML = head + play + tops + tips + table + notes;
  }
  const init = () => {
    const v = $("#dcView"); if (!v) return;
    v.addEventListener("click", e => {
      if (e.target.closest("#dcReload")) { load(); return; }
      const l = e.target.closest("[data-lane]"); if (l) { lane = l.dataset.lane; render(); return; }
      const s = e.target.closest("[data-sym]"); if (s && !e.target.closest("input, button") && typeof window.openStockSheet === "function") { e.preventDefault(); window.openStockSheet(s.dataset.sym, { back: "What to do now" }); }
    });
    v.addEventListener("change", e => { if (e.target.id !== "dcAmt") return; const a = e.target.value.trim() ? parseAmt(e.target.value) : null; if (e.target.value.trim() && !a) { window.toast?.("Enter an amount like 50000, 5L or 1Cr.", { kind: "bad" }); return; } amount = a; try { if (a) localStorage.setItem("decide-amount", String(a)); else localStorage.removeItem("decide-amount"); } catch { /* private mode */ } load(); });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init(); // loaded on demand (app.js LAZY_VIEWS)
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.decide = () => load();
})();
