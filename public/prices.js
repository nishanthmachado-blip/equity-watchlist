// Live prices on every tab. The server pushes new quotes over /api/events (server-sent events) the moment they arrive;
// this script redraws only the screen you are looking at (at most every 2 s), and catches other screens up when you
// switch to them. The header button asks for a refresh and gets its summary back over the same stream.
// If the stream is unavailable (some proxies block it) it falls back to checking every 30 s.
(() => {
  const $ = s => document.querySelector(s);
  let lastStreamAt = 0, st = null, busy = false, total = 0, got = null, es = null, live = false, lastQuoteAt = null, dirty = false, timer = null, lastRun = 0, refreshWait = null, pollTimer = null, lastSeen = null;
  const hm = t => (t ? new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : null);
  const visible = () => ["homeView", "swingView", "portfolioView", "nwView"].find(id => $(`#${id}`) && !$(`#${id}`).hidden) || "other";
  function paint() {
    const b = $("#pricesBtn"), t = $("#pricesTime"); if (!b) return;
    const latest = Math.max(lastQuoteAt || 0, Date.parse(st?.myLatestPriceAt || "") || 0) || null;
    const age = latest ? Math.round((Date.now() - latest) / 60e3) : null;
    const feed = st?.marketOpen && Date.now() - lastStreamAt < 60e3;
    t.textContent = busy ? (got && total ? `Updating ${Math.min(got.size, total)}/${total}` : "Updating…") : feed ? "Live · Angel One" : latest ? (st?.marketOpen && age !== null && age <= 2 ? `Live · ${hm(latest)}` : `Prices ${hm(latest)}`) : "Refresh prices";
    b.classList.toggle("stale", !!(st?.marketOpen && age !== null && age > 5));
    b.classList.toggle("is-loading", busy);
    b.classList.toggle("is-live", live);
    b.title = `${feed ? "Market open: live prices from your Angel One account, updated the moment they change (the screen redraws every 10 s)." : st?.marketOpen ? `Market open: prices stream in as they change (checked every ${st.intervalSec >= 60 ? `${Math.round(st.intervalSec / 60)} min` : `${st.intervalSec} s`}).` : "Market closed."} Click to refresh now.${live ? "" : " (Live updates unavailable; checking every 30 s.)"}`;
  }
  // Reload the data of the screen that is open; other screens are marked and reloaded when you open them
  async function refreshVisible() {
    timer = null; lastRun = Date.now(); dirty = false;
    try {
      if (visible() === "swingView") { window.dispatchEvent(new CustomEvent("prices:updated")); dirty = true; return; } // the swing page loads its own data
      if (typeof loadStocks === "function") await loadStocks();
      if (typeof selected !== "undefined" && selected && typeof stocks !== "undefined") selected = stocks.find(s => s.id === selected.id) || selected;
      if (typeof loadValuation === "function") await loadValuation();
      window.redrawAll?.();
    } catch (e) { console.warn("price redraw:", e); }
    window.dispatchEvent(new CustomEvent("prices:updated"));
  }
  // With Angel One's live feed prices change every second: redraw the open screen at most every 10 s then (every 2 s otherwise)
  let streaming = false;
  function schedule() { if (document.hidden) { dirty = true; return; } if (timer) return; timer = setTimeout(refreshVisible, Math.max(250, (streaming ? 10000 : 2000) - (Date.now() - lastRun))); }
  // Switching screens: catch up if prices changed while it was hidden
  const wrapSetView = () => { const orig = window.setView; if (typeof orig !== "function" || orig.__live) return; const w = function (v) { const r = orig.apply(this, arguments); if (dirty) schedule(); return r; }; w.__live = true; window.setView = w; };
  function connect() {
    if (!("EventSource" in window)) return startPolling();
    es = new EventSource("/api/events");
    es.addEventListener("hello", e => { live = true; const h = JSON.parse(e.data); st = { ...(st || {}), marketOpen: h.marketOpen, intervalSec: h.intervalSec }; streaming = !!h.streaming; total = h.symbols || 0; stopPolling(); paint(); });
    es.addEventListener("prices", e => { const x = JSON.parse(e.data); lastQuoteAt = Date.now(); if (Object.values(x.quotes).some(q => q.stream)) { streaming = true; lastStreamAt = Date.now(); } else if (Date.now() - lastStreamAt > 60e3) streaming = false; if (got) for (const k of Object.keys(x.quotes)) got.add(k); window.liveQuotes = { ...(window.liveQuotes || {}), ...x.quotes }; window.dispatchEvent(new CustomEvent("prices:quotes", { detail: x.quotes })); schedule(); paint(); });
    es.addEventListener("alert", e => { const x = JSON.parse(e.data); window.toast?.(`🔔 ${x.titles.join(" · ")}${x.count > x.titles.length ? ` +${x.count - x.titles.length} more` : ""}`, { kind: "ok", ms: 8000 }); window.dispatchEvent(new CustomEvent("prices:alert", { detail: x })); window.pollAlerts?.(); });
    es.addEventListener("refresh", e => { const x = JSON.parse(e.data); if (refreshWait) { refreshWait(x); refreshWait = null; } });
    es.onerror = () => { live = false; paint(); if (es.readyState === EventSource.CLOSED) { startPolling(); setTimeout(connect, 15e3); } else startPolling(); };
  }
  // Fallback when the stream is not available
  async function poll() {
    if (document.hidden || busy || live) return;
    try { const r = await fetch("/api/prices/status"); if (!r.ok) return; st = await r.json(); paint(); const v = st.version || st.myLatestPriceAt; if (lastSeen && v && v !== lastSeen) schedule(); lastSeen = v || lastSeen; } catch { /* offline */ }
  }
  function startPolling() { if (!pollTimer) { poll(); pollTimer = setInterval(poll, 30e3); } }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }
  async function refreshNow() {
    if (busy) return; busy = true; got = new Set(); const b = $("#pricesBtn"); b.disabled = true; paint();
    try {
      const done = new Promise(res => { refreshWait = res; setTimeout(() => { if (refreshWait) { refreshWait(null); refreshWait = null; } }, 45e3); });
      const r = await fetch(`/api/prices/refresh${live ? "" : "?wait=1"}`, { method: "POST" }); const x0 = await r.json(); if (!r.ok) throw new Error(x0.message || `HTTP ${r.status}`);
      const x = live ? await done : x0;
      if (!x) { window.toast?.("Prices are still coming in; they appear by themselves.", { ms: 4000 }); return; }
      if (x.error) throw new Error(x.error);
      st = { ...(st || {}), ...x }; schedule();
      const src = Object.entries(x.bySource || {}).map(([k, n]) => `${k} ${n}`).join(", ");
      const more = x.pending ? ` ${x.pending} more still loading; they appear by themselves.` : "";
      const miss = x.failedStocks?.length ? ` No price for ${x.failedStocks.join(", ")}${x.failedCount > x.failedStocks.length ? ` and ${x.failedCount - x.failedStocks.length} more` : ""}: Integrations → Compare sources shows why.` : "";
      window.toast?.(`Prices updated${x.lastCount ? `: ${x.lastCount} quotes${src ? ` (${src})` : ""}` : ""} in ${((x.tookMs || 0) / 1000).toFixed(1)} s.${more}${miss}`, { kind: x.lastCount || x.pending ? "ok" : "bad", ms: miss ? 9000 : 4500 });
    } catch (e) { window.toast?.(`Price refresh failed: ${e.message}`, { kind: "bad" }); }
    finally { busy = false; got = null; b.disabled = false; paint(); }
  }
  document.addEventListener("DOMContentLoaded", async () => {
    $("#pricesBtn")?.addEventListener("click", refreshNow);
    wrapSetView();
    try { const r = await fetch("/api/prices/status"); if (r.ok) { st = await r.json(); lastSeen = st.version; } } catch { /* fine */ }
    paint(); connect(); setInterval(paint, 15e3);
    document.addEventListener("visibilitychange", () => { if (!document.hidden && dirty) schedule(); });
  });
  window.liveStream = () => live;
})();
