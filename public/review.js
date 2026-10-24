// Holdings clean-up: Keep / Add / Trim / Exit for every stock you hold, each with its reasons (valuation and stance,
// trend vs the 200-day average, how much you also own through your funds, tax if sold, losses that cancel gains you
// booked this year, tiny positions). Reads /api/holdings/review (saved data only). Not advice.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}` : "—");
  const sg = v => (fin(v) ? `${v >= 0 ? "+" : "−"}${inr(v)}` : "—");
  const cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const ICON = { Exit: "🚪", Trim: "✂️", Add: "➕", Keep: "✅" }, TONE = { for: "rv-for", against: "rv-against", warn: "rv-warn", info: "rv-info" };
  let data = null, filt = "all", open = new Set();
  try { const o = JSON.parse(localStorage.getItem("rv-opt") || "{}"); if (o.filt) filt = o.filt; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem("rv-opt", JSON.stringify({ filt })); } catch { /* private mode */ } };
  async function load() {
    $("#rvBody").innerHTML = '<p class="hint">Reviewing your holdings…</p>';
    try { const r = await fetch("/api/holdings/review", { credentials: "same-origin" }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`); data = await r.json(); render(); }
    catch (e) { $("#rvBody").innerHTML = `<p class="hint">Could not review your holdings: ${esc(e.message)}</p>`; }
  }
  function render() {
    const d = data, c = d.counts || {};
    if (!d.rows.length) { $("#rvSum").innerHTML = ""; $("#rvFilters").innerHTML = ""; $("#rvBody").innerHTML = '<p class="nw-empty-row">No holdings yet. Connect a broker or import your holdings in <button type="button" class="linklike" data-goto-view="portfolio">My holdings</button>.</p>'; return; }
    const tile = (k, n, sub) => `<button type="button" class="rv-tile rv-${k.toLowerCase()}${filt === k ? " active" : ""}" data-rf="${k}"><span>${ICON[k]} ${k}</span><strong>${n}</strong><small>${sub}</small></button>`;
    const val = k => inr(d.rows.filter(r => r.verdict === k).reduce((a, r) => a + r.value, 0));
    $("#rvSum").innerHTML = tile("Exit", c.Exit || 0, `${val("Exit")} to free up`) + tile("Trim", c.Trim || 0, `${val("Trim")} held`) + tile("Add", c.Add || 0, `${val("Add")} held`) + tile("Keep", c.Keep || 0, `${val("Keep")} held`);
    $("#rvFilters").innerHTML = `<button type="button" class="pf-chip${filt === "all" ? " active" : ""}" data-rf="all">All ${d.rows.length}</button><button type="button" class="pf-chip${filt === "tax" ? " active" : ""}" data-rf="tax">Tax to watch</button><button type="button" class="pf-chip${filt === "funds" ? " active" : ""}" data-rf="funds">Also in my funds</button><button type="button" class="pf-chip${filt === "tiny" ? " active" : ""}" data-rf="tiny">Tiny positions</button>`;
    const list = d.rows.filter(r => filt === "all" || r.verdict === filt || (filt === "tax" && (r.tax?.wait || r.tax?.offset)) || (filt === "funds" && r.viaFunds > 0) || (filt === "tiny" && r.tiny));
    const trend = t => !t ? '<span class="hint">—</span>' : `<span class="rv-trend ${t.state}" title="200-day average ₹${t.sma200}${t.rising === null ? "" : t.rising ? ", rising" : ", falling"}">${{ up: "▲ Up", "above-falling": "◆ Above, avg falling", below: "▼ Below 200-DMA", down: "▼ Down" }[t.state]} <small>${t.gapPct >= 0 ? "+" : ""}${t.gapPct}%</small></span>`;
    $("#rvBody").innerHTML = list.length ? `<div class="table-wrap"><table class="rv-table"><thead><tr><th>Stock</th><th>Call</th><th class="num">Value</th><th class="num">P/L</th><th class="num">Weight</th><th>Trend</th><th class="num" title="Also owned through your mutual funds (X-ray)">Via funds</th><th class="num" title="Estimated tax if you sold every share today">Tax if sold</th><th>Why</th></tr></thead><tbody>${list.map(r => {
      const main = r.reasons.filter(x => x.tone !== "info").slice(0, 2), isOpen = open.has(r.symbol);
      return `<tr data-sym="${esc(r.symbol)}" class="rv-row${isOpen ? " open" : ""}"><td><div class="company">${esc(r.company)} <button type="button" class="ch-mini" data-chart="${esc(r.symbol)}" data-chart-name="${esc(r.company)}" title="Price chart" aria-label="Chart">📈</button></div><div class="ticker">${esc(r.symbol)} · ${r.qty} shares${r.view ? ` · ${esc(r.view)}` : ""}</div></td>
        <td><span class="rv-verdict rv-${r.verdict.toLowerCase()}">${ICON[r.verdict]} ${r.verdict}</span>${r.waitFirst ? `<div class="ticker rv-warn-t">wait ${r.tax.wait.days}d for long-term</div>` : ""}</td>
        <td class="num">${inr(r.value)}</td><td class="num ${cls(r.pnl)}">${sg(r.pnl)}${fin(r.pnlPct) ? `<div>${r.pnlPct >= 0 ? "+" : ""}${r.pnlPct}%</div>` : ""}</td><td class="num">${fin(r.weightPct) ? `${r.weightPct}%` : "—"}</td>
        <td>${trend(r.trend)}</td><td class="num">${r.viaFunds > 0 ? inr(r.viaFunds) : "—"}</td><td class="num">${r.tax ? (r.tax.tax > 0 ? inr(r.tax.tax) : "nil") : '<span class="hint">no tradebook</span>'}${r.tax?.offset ? `<div class="ticker pl-up">saves ${inr(r.tax.offset.saves)}</div>` : ""}</td>
        <td class="rv-why">${main.map(x => `<div class="${TONE[x.tone] || ""}">${esc(x.text)}</div>`).join("") || `<div class="rv-info">${esc(r.reasons[0]?.text || "")}</div>`}<button type="button" class="linklike rv-more" data-more="${esc(r.symbol)}">${isOpen ? "Less" : `All ${r.reasons.length} reasons`}</button></td></tr>
        <tr class="rv-detail" data-for="${esc(r.symbol)}"${isOpen ? "" : " hidden"}><td colspan="9"><ul class="rv-reasons">${r.reasons.map(x => `<li class="${TONE[x.tone] || ""}">${esc(x.text)}</li>`).join("")}</ul>
          <div class="toolbar" style="margin:6px 0 0"><button type="button" class="ghost" data-open-val="${esc(r.symbol)}">Open valuation</button><button type="button" class="ghost ai-btn" data-ask-ai="Holdings clean-up says ${esc(r.verdict)} for ${esc(r.symbol)}. Do you agree? Weigh valuation, trend, fund overlap and the tax of selling now." data-ask-sym="${esc(r.symbol)}" data-ask-where="Holdings clean-up">✨ Ask AI</button></div></td></tr>`;
    }).join("")}</tbody></table></div>` : '<p class="hint">Nothing in this group.</p>';
    const notes = [];
    if (d.trendMissing) notes.push(`${d.trendMissing} stock${d.trendMissing === 1 ? " has" : "s have"} no 200-day average yet: the Swing ideas scan fills it from daily prices.`);
    if (!d.hasTradebook) notes.push('Tax uses your swing journal only: import your broker tradebook in <button type="button" class="linklike" data-goto-view="tax">Tax view</button> for buy dates and short / long-term tax per stock.');
    if (!d.fundsLinked) notes.push('Fund overlap needs your mutual funds linked to an X-ray portfolio (<button type="button" class="linklike" data-goto-view="mf">Mutual funds</button> → X-ray).');
    if (d.realised?.stGain > 0) notes.push(`You booked ${inr(d.realised.stGain)} of short-term gains this financial year: a loss you sell now cancels them first.`);
    $("#rvNotes").innerHTML = `${notes.map(n => `<p class="hint">${n}</p>`).join("")}<p class="vs-fine">How the call is made: it starts from each holding's stance (valuation, buy zone, your thesis and rating, weight), then a falling 200-day average holds back adds and turns a rich holding into a trim, funds that already hold the stock stop a direct add, and positions under ${inr(d.tinyBelow)} (₹5,000 or 0.3% of your holdings) are flagged to build up or let go. Tax: short-term 20%, long-term 12.5% above the ₹1.25 lakh exemption. A screen to start your own review, not advice.</p>`;
  }
  const init = () => {
    const v = $("#rvView"); if (!v) return;
    v.addEventListener("click", e => {
      const f = e.target.closest("[data-rf]"); if (f) { filt = filt === f.dataset.rf && f.dataset.rf !== "all" ? "all" : f.dataset.rf; save(); render(); return; }
      const m = e.target.closest("[data-more]"); if (m) { const s = m.dataset.more; if (open.has(s)) open.delete(s); else open.add(s); render(); return; }
      const ov = e.target.closest("[data-open-val]"); if (ov && typeof window.openStockSheet === "function") { window.openStockSheet(ov.dataset.openVal, { back: "Holdings clean-up" }); return; }
      const g = e.target.closest("[data-goto-view]"); if (g && typeof setView === "function") { setView(g.dataset.gotoView); return; }
      if (e.target.closest("#rvReload")) load();
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init(); // loaded on demand (app.js LAZY_VIEWS)
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.review = () => load();
})();
