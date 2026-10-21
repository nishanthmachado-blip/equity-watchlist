// Order wins: companies announcing new orders / contracts on NSE, ranked by the size of the wins against their sales,
// with the app's valuation and growth numbers alongside; plus the latest order announcements as a feed.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const cr = v => !fin(v) ? "—" : v >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L Cr` : v >= 1000 ? `₹${Math.round(v).toLocaleString("en-IN")} Cr` : `₹${v >= 100 ? Math.round(v) : v.toFixed(1)} Cr`;
  const pc = v => fin(v) ? `${v}%` : "—";
  const day = d => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  let data = null, days = 90, filt = "all", q = "", timer = null;
  try { const o = JSON.parse(localStorage.getItem("ord-opt") || "{}"); if ([30, 90, 180, 365].includes(o.days)) days = o.days; if (o.filt) filt = o.filt; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem("ord-opt", JSON.stringify({ days, filt })); } catch { /* private mode */ } };
  async function load() {
    clearTimeout(timer);
    try { const r = await fetch(`/api/orders?days=${days}`, { credentials: "same-origin" }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`); data = await r.json(); render(); }
    catch (e) { $("#ordBody").innerHTML = `<p class="hint">Could not load order wins: ${esc(e.message)}</p>`; }
    if (!$("#ordView").hidden && (data?.refreshing || !data?.at)) timer = setTimeout(load, 8000); // first fetch still running
  }
  const FILTERS = [["all", "All"], ["big", "Big vs sales (10%+)"], ["value", "In buy zone"], ["quality", "ROCE 20%+"], ["mine", "In my lists / holdings"]];
  function render() {
    const d = data;
    $("#ordStatus").textContent = d.at ? `NSE announcements · updated ${new Date(d.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}${d.refreshing ? " · refreshing…" : ""} · ${d.total} order filings kept` : d.refreshing ? "Fetching order announcements from NSE (first time takes a minute)…" : d.error ? `NSE did not answer: ${d.error}. Tries again shortly.` : "Fetching…";
    document.querySelectorAll("#ordDays [data-days]").forEach(b => b.classList.toggle("active", Number(b.dataset.days) === days));
    $("#ordFilters").innerHTML = FILTERS.map(([k, l]) => `<button type="button" class="pf-chip${filt === k ? " active" : ""}" data-of="${k}">${l}</button>`).join("");
    const qq = q.trim().toLowerCase();
    const list = d.companies.filter(c => filt === "all" || (filt === "big" && c.ofSales >= 10) || (filt === "value" && (c.verdict === "buy" || c.inZone)) || (filt === "quality" && c.roce >= 20) || (filt === "mine" && (c.tracked || c.held || c.swing)))
      .filter(c => !qq || `${c.symbol} ${c.name} ${c.industry || ""}`.toLowerCase().includes(qq));
    const badge = c => [c.held ? '<span class="chip v-none">You hold</span>' : "", c.swing ? '<span class="chip v-none">Swing</span>' : "", c.verdictLabel ? `<span class="chip ${c.verdict === "buy" ? "v-under" : c.verdict === "expensive" ? "v-rich" : "v-fair"}">${esc(c.verdictLabel)}</span>` : c.tracked ? "" : '<span class="hint">not valued yet</span>'].join(" ");
    $("#ordBody").innerHTML = !d.companies.length ? `<p class="hint">${d.at ? `No order announcements in the last ${days} days.` : "No data yet."}</p>` : `
      <div class="table-wrap"><table class="ord-table"><thead><tr><th>Company</th><th class="num">Wins</th><th class="num">Order value</th><th class="num" title="Order value in the period ÷ last 12 months' sales">vs yearly sales</th><th class="num">Biggest</th><th class="num" title="Sales growth (latest year, else 3-year)">Sales growth</th><th class="num">ROCE</th><th class="num">P/E</th><th>Valuation</th><th class="num">Score</th></tr></thead>
      <tbody>${list.slice(0, 100).map(c => `<tr data-sym="${esc(c.symbol)}"><td><div class="company">${esc(c.name)} <button type="button" class="ch-mini" data-chart="${esc(c.symbol)}" data-chart-name="${esc(c.name)}" title="Price chart" aria-label="Chart">📈</button></div><div class="ticker">${esc(c.symbol)}${c.industry ? ` · ${esc(c.industry)}` : ""} · last ${day(c.last)}${fin(c.bookYears) ? ` · order book ≈ ${c.bookYears}× sales` : ""}</div></td>
        <td class="num">${c.wins}</td><td class="num"><b>${c.totalCr > 0 ? cr(c.totalCr) : "—"}</b>${c.valued < c.wins ? `<div class="ticker">${c.wins - c.valued} without a value</div>` : ""}</td>
        <td class="num">${fin(c.ofSales) ? `<b class="${c.ofSales >= 20 ? "pl-up" : ""}">${c.ofSales}%</b>` : "—"}</td><td class="num">${cr(c.biggestCr)}</td>
        <td class="num ${c.salesGrowth > 0 ? "pl-up" : c.salesGrowth < 0 ? "pl-dn" : ""}">${pc(fin(c.salesGrowth) ? Math.round(c.salesGrowth) : null)}</td><td class="num">${pc(fin(c.roce) ? Math.round(c.roce) : null)}</td><td class="num">${fin(c.pe) ? Math.round(c.pe) : "—"}</td>
        <td>${badge(c)}</td><td class="num"><span class="ord-score" style="--s:${c.score}">${c.score}</span></td></tr>
        <tr class="ord-detail" data-for="${esc(c.symbol)}" hidden><td colspan="10"><ul class="ord-list">${c.orders.map(o => `<li><b>${day(o.day)}</b> ${fin(o.valueCr) ? `<span class="ord-val">${cr(o.valueCr)}</span> ` : ""}${esc(o.text)}${o.file ? ` <a href="${esc(o.file)}" target="_blank" rel="noopener">filing ↗</a>` : ""}</li>`).join("")}</ul>
          <div class="toolbar" style="margin:6px 0 0"><button type="button" class="ghost" data-open="${esc(c.symbol)}">Open valuation</button></div></td></tr>`).join("")}</tbody></table></div>
      ${d.untracked ? `<div class="toolbar"><button type="button" class="ghost" id="ordTrack">Value the ${Math.min(60, d.untracked)} not valued yet</button><span class="hint">adds them to tracking (not to a watchlist) and fetches fundamentals in the background</span></div>` : ""}
      <p class="vs-fine">Order value is read from each announcement's text (₹ crore / lakh, US$ million at today's rate); filings that give no figure count as a win without a value. "vs yearly sales" = orders in the period ÷ last 12 months' sales: 20%+ in 90 days is a strong pipeline. The full order book is in results presentations; it shows here only when a filing mentions it. Click a row for the announcements. Not advice.</p>`;
    $("#ordFeed").innerHTML = d.recent.length ? d.recent.slice(0, 25).map(o => `<li data-open="${esc(o.symbol)}"><b>${esc(o.symbol)}</b> <span class="hint">${day(o.day)}</span> ${fin(o.valueCr) ? `<span class="ord-val">${cr(o.valueCr)}</span>` : ""}<div>${esc(o.text.slice(0, 160))}</div></li>`).join("") : '<li class="hint">No order announcements in the last two weeks.</li>';
  }
  document.addEventListener("DOMContentLoaded", () => {
    const v = $("#ordView"); if (!v) return;
    $("#ordDays").addEventListener("click", e => { const b = e.target.closest("[data-days]"); if (b) { days = Number(b.dataset.days); save(); load(); } });
    $("#ordFilters").addEventListener("click", e => { const b = e.target.closest("[data-of]"); if (b) { filt = b.dataset.of; save(); render(); } });
    $("#ordQ").addEventListener("input", e => { q = e.target.value; if (data) render(); });
    v.addEventListener("click", async e => {
      const op = e.target.closest("[data-open]"); if (op && typeof window.openStockSheet === "function") { window.openStockSheet(op.dataset.open, { back: "Order wins" }); return; }
      if (e.target.closest("#ordTrack")) { const b = e.target.closest("#ordTrack"); b.disabled = true; try { const syms = data.companies.filter(c => !c.tracked).map(c => c.symbol).slice(0, 60); const r = await fetch("/api/orders/track", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: syms }) }).then(x => x.json()); window.toast?.(`Valuing ${r.added} more stock${r.added === 1 ? "" : "s"} in the background.`, { kind: "ok" }); setTimeout(load, 15000); } catch (err) { window.toast?.(err.message, { kind: "error" }); } return; }
      const tr = e.target.closest("tr[data-sym]"); if (tr && !e.target.closest("button, a, input")) { const det = v.querySelector(`tr.ord-detail[data-for="${CSS.escape(tr.dataset.sym)}"]`); if (det) { det.hidden = !det.hidden; tr.classList.toggle("open", !det.hidden); } }
    });
  });
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.orders = () => load();
})();
