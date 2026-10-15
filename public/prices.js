// Live prices on every tab: the header button refreshes now; the server also refreshes every minute while the market is
// open, and this script checks every 20 s for newer prices and redraws whatever screen is open.
(() => {
  const $ = s => document.querySelector(s);
  let lastSeen = null, busy = false, st = null;
  const hm = iso => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null);
  function paint() {
    const b = $("#pricesBtn"), t = $("#pricesTime"); if (!b || !st) return;
    const age = st.myLatestPriceAt ? Math.round((Date.now() - Date.parse(st.myLatestPriceAt)) / 60e3) : null;
    t.textContent = busy ? "Updating…" : st.myLatestPriceAt ? (st.marketOpen && age !== null && age <= 2 ? `Live · ${hm(st.myLatestPriceAt)}` : `Prices ${hm(st.myLatestPriceAt)}`) : "Refresh prices";
    b.classList.toggle("stale", !!(st.marketOpen && age !== null && age > 5));
    const src = Object.entries(st.bySource || {}).map(([k, n]) => `${k} ${n}`).join(", ");
    b.title = `${st.marketOpen ? `Market open: prices update automatically every ${st.intervalSec >= 60 ? `${Math.round(st.intervalSec / 60)} min` : `${st.intervalSec} s`}.` : "Market closed."} Click to refresh now.${st.lastRun ? ` Last update ${hm(st.lastRun)}${src ? ` (${src})` : ""}${st.lastFailed ? `, ${st.lastFailed} without a price` : ""}.` : ""}`;
  }
  // Pull the new prices into every screen that shows them
  async function apply() {
    try {
      if (typeof loadStocks === "function") await loadStocks();
      if (typeof selected !== "undefined" && selected && typeof stocks !== "undefined") selected = stocks.find(s => s.id === selected.id) || selected;
      if (typeof loadValuation === "function") await loadValuation();
      window.redrawAll?.();
    } catch (e) { console.warn("price redraw:", e); }
    window.dispatchEvent(new CustomEvent("prices:updated"));
  }
  async function poll() {
    if (document.hidden || busy) return;
    try {
      const r = await fetch("/api/prices/status"); if (!r.ok) return; st = await r.json(); paint();
      if (lastSeen && st.myLatestPriceAt && st.myLatestPriceAt !== lastSeen) await apply();
      lastSeen = st.myLatestPriceAt || lastSeen;
    } catch { /* offline: try again next time */ }
  }
  async function refreshNow() {
    if (busy) return; busy = true; const b = $("#pricesBtn"); b.classList.add("is-loading"); b.disabled = true; paint();
    try {
      const r = await fetch("/api/prices/refresh", { method: "POST" }); const x = await r.json(); if (!r.ok) throw new Error(x.message || `HTTP ${r.status}`);
      st = x; lastSeen = x.myLatestPriceAt; await apply();
      const src = Object.entries(x.bySource || {}).map(([k, n]) => `${k} ${n}`).join(", ");
      window.toast?.(`Prices updated${x.lastCount ? `: ${x.lastCount} quotes${src ? ` (${src})` : ""}` : ""}${x.failedStocks?.length ? `. No fresh price for ${x.failedStocks.join(", ")}: Integrations → Compare sources shows why.` : "."}`, { kind: x.lastCount ? "ok" : "bad", ms: x.failedStocks?.length ? 9000 : 4000 });
    } catch (e) { window.toast?.(`Price refresh failed: ${e.message}`, { kind: "bad" }); }
    finally { busy = false; b.classList.remove("is-loading"); b.disabled = false; paint(); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("#pricesBtn")?.addEventListener("click", refreshNow);
    poll(); setInterval(poll, 20e3); setInterval(paint, 30e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  });
})();
