// Market pulse (top of Market today): key indices with today / week / month change, and the top gainers and losers of
// the day, week or month among the Nifty 500, Nifty 50, every liquid stock or your own, from NSE's daily files.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = Number.isFinite;
  let period = "week", uni = "nifty500", data = null, poll = null;
  try { uni = localStorage.getItem("wk-uni") || uni; period = localStorage.getItem("wk-period") || period; } catch { /* private mode */ }
  const pc = v => (fin(v) ? `<span class="${v > 0 ? "pl-up" : v < 0 ? "pl-dn" : ""}">${v > 0 ? "↗ +" : v < 0 ? "↘ " : ""}${v.toFixed(2)}%</span>` : '<span class="hint">—</span>');
  const num = v => (fin(v) ? v.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) : "—");
  const nice = n => n.replace(/^NIFTY /, "Nifty ").replace("Nifty BANK", "Bank Nifty").replace("SENSEX", "Sensex").replace("NEXT 50", "Next 50").replace("MIDCAP", "Midcap").replace("SMALLCAP", "Smallcap");
  const P = { day: "today", week: "this week", month: "this month" };
  function render() {
    const d = data; if (!d) return;
    $("#wkPeriod").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.p === period)); $("#wkUni").value = uni;
    $("#wkIdx").innerHTML = d.indices.filter(i => fin(i.last)).map(i => `<div class="wk-row"><span>${esc(nice(i.name))}</span><b>${num(i.last)}</b>${pc(i[period])}</div>`).join("") || '<p class="hint">Index levels appear after the first daily file or Yahoo answers.</p>';
    const m = d.movers, row = r => `<div class="wk-row" data-sym="${esc(r.symbol)}"><span title="${esc(r.symbol)}">${esc(r.name)}${r.watching ? ' <small class="hint">· watching</small>' : ""}</span><b>${num(r.price)}</b>${pc(r.change)}${r.watching ? "" : `<button type="button" class="ghost wk-add" data-add="${esc(r.symbol)}" data-name="${esc(r.name)}" title="Add to watchlist">＋</button>`}</div>`;
    document.querySelectorAll("[data-wk-p]").forEach(x => { x.textContent = P[period]; });
    if (!m.ready) { const msg = `<p class="hint">Collecting NSE's daily files (${d.backfill.days} of ~22 days)…</p>`; $("#wkUp").innerHTML = msg; $("#wkDown").innerHTML = msg; }
    else { $("#wkUp").innerHTML = m.gainers.map(row).join("") || '<p class="hint">None.</p>'; $("#wkDown").innerHTML = m.losers.map(row).join("") || '<p class="hint">None.</p>'; }
    $("#wkNote").textContent = m.ready ? `${d.universeLabel} · ${m.count} stocks · closes ${m.from} → ${m.asOf}${m.partial ? " (fewer days saved so far)" : ""} · ${m.breadth.up} up, ${m.breadth.down} down. Indices: ${[...new Set(d.indices.map(i => i.source))].join(", ")}.` : d.universeLabel;
    clearTimeout(poll); if ((d.backfill.running || !m.ready) && !$("#marketView").hidden) poll = setTimeout(load, 8000);
  }
  async function load() {
    try { const r = await fetch(`/api/market/week?period=${period}&universe=${uni}`); if (!r.ok) throw new Error(`HTTP ${r.status}`); data = await r.json(); render(); }
    catch (e) { $("#wkNote").textContent = e.message; }
  }
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.market = () => load();
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#wkBox")) return;
    $("#wkPeriod").addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (!b) return; period = b.dataset.p; try { localStorage.setItem("wk-period", period); } catch { /* ignore */ } load(); });
    $("#wkUni").onchange = () => { uni = $("#wkUni").value; try { localStorage.setItem("wk-uni", uni); } catch { /* ignore */ } load(); };
    $("#wkBox").addEventListener("click", async e => {
      const a = e.target.closest("[data-add]"); if (!a) return; a.disabled = true;
      try { const r = await fetch("/api/indices/add", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: [a.dataset.add], names: { [a.dataset.add]: a.dataset.name }, from: "Market pulse" }) }); const j = await r.json(); if (!r.ok) throw new Error(j.message); window.toast?.(`${a.dataset.name} added to your watchlist${j.valuing ? "; valuing it now" : ""}.`, { kind: "ok" }); load(); }
      catch (err) { a.disabled = false; window.toast?.(err.message, { kind: "error" }); }
    });
  });
})();
