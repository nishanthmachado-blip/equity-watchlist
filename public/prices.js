// Live prices on every tab: the header button refreshes now; the server also refreshes every minute while the market is
// open, and this script checks every 20 s (every 4 s while quotes are still loading) for newer prices and redraws
// whatever screen is open. All screens read the same server-side price store as the Swing page.
(() => {
  const $ = s => document.querySelector(s);
  let lastSeen = null, busy = false, st = null, fastUntil = 0;
  const hm = iso => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null);
  function paint() {
    const b = $("#pricesBtn"), t = $("#pricesTime"); if (!b || !st) return;
    const age = st.myLatestPriceAt ? Math.round((Date.now() - Date.parse(st.myLatestPriceAt)) / 60e3) : null;
    t.textContent = busy ? "Updating…" : st.pending ? `Loading ${st.pending}…` : st.myLatestPriceAt ? (st.marketOpen && age !== null && age <= 2 ? `Live · ${hm(st.myLatestPriceAt)}` : `Prices ${hm(st.myLatestPriceAt)}`) : "Refresh prices";
    b.classList.toggle("stale", !!(st.marketOpen && age !== null && age > 5));
    b.classList.toggle("is-loading", busy || !!st.pending);
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
  const seen = x => x.version || x.myLatestPriceAt || null;
  async function poll() {
    if (document.hidden || busy) return;
    try {
      const r = await fetch("/api/prices/status"); if (!r.ok) return; st = await r.json(); paint();
      if (lastSeen && seen(st) && seen(st) !== lastSeen) await apply();
      lastSeen = seen(st) || lastSeen;
      if (st.pending) fastUntil = Date.now() + 60e3; // quotes finishing in the background: look again soon
    } catch { /* offline: try again next time */ }
  }
  let tick = 0;
  setInterval(() => { tick++; if (Date.now() < fastUntil || tick % 5 === 0) poll(); }, 4e3);
  async function refreshNow() {
    if (busy) return; busy = true; const b = $("#pricesBtn"); b.disabled = true; paint();
    try {
      const r = await fetch("/api/prices/refresh", { method: "POST" }); const x = await r.json(); if (!r.ok) throw new Error(x.message || `HTTP ${r.status}`);
      st = x; lastSeen = seen(x); await apply();
      if (x.pending) fastUntil = Date.now() + 90e3;
      const src = Object.entries(x.bySource || {}).map(([k, n]) => `${k} ${n}`).join(", ");
      const more = x.pending ? ` ${x.pending} more still loading; they appear by themselves.` : "";
      const miss = x.failedStocks?.length ? ` No price for ${x.failedStocks.join(", ")}${x.failedCount > x.failedStocks.length ? ` and ${x.failedCount - x.failedStocks.length} more` : ""}: Integrations → Compare sources shows why.` : "";
      window.toast?.(`Prices updated${x.lastCount ? `: ${x.lastCount} quotes${src ? ` (${src})` : ""}` : ""}.${more}${miss}`, { kind: x.lastCount || x.pending ? "ok" : "bad", ms: miss ? 9000 : 4500 });
    } catch (e) { window.toast?.(`Price refresh failed: ${e.message}`, { kind: "bad" }); }
    finally { busy = false; b.disabled = false; paint(); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    $("#pricesBtn")?.addEventListener("click", refreshNow);
    poll(); setInterval(paint, 30e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
  });
})();
