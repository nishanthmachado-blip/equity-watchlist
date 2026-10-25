// Favourites: a ♡ on every stock row in the app (tables with data-sym / data-id, Market pulse, the valuation card);
// a hearted stock gets a red border and ❤ on every screen, and the Favourites screen lists them with price, valuation,
// what you hold and what is coming up.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = Number.isFinite;
  let favs = new Set(), ready = false, queued = false;
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  // tables whose rows carry the watchlist id instead of the symbol
  const ID_TABLES = "#valRows, #pkRows, #pkMineRows, #gpRows, #planRows, #rows, #wlRows";
  const symOfRow = el => {
    if (el.dataset.sym) return String(el.dataset.sym).toUpperCase();
    if (el.dataset.id && el.closest(ID_TABLES)) { try { const st = typeof stocks !== "undefined" ? stocks.find(x => String(x.id) === el.dataset.id) : null; return st ? String(st.marketSymbol || st.ticker || "").toUpperCase() : null; } catch { return null; } }
    return null;
  };
  const heart = (sym, on) => `<button type="button" class="fav-btn${on ? " on" : ""}" data-fav="${esc(sym)}" aria-pressed="${on}" title="${on ? "Remove from favourites" : "Add to favourites"}">${on ? "❤" : "♡"}</button>`;
  function decorate() {
    queued = false; if (!ready) return;
    const rows = document.querySelectorAll(`main tr[data-sym], main .wk-row[data-sym], main .sw-idea[data-sym], main .fav-card-item[data-sym], ${ID_TABLES.split(",").map(s => `main ${s.trim()} > tr[data-id]`).join(", ")}`);
    for (const el of rows) {
      const sym = symOfRow(el); if (!sym || !/^[A-Z0-9&.-]{1,20}$/.test(sym)) continue;
      const on = favs.has(sym);
      if (el.classList.contains("fav-row") !== on) el.classList.toggle("fav-row", on);
      let b = el.querySelector(":scope [data-fav]");
      if (!b) {
        const host = el.matches("tr") ? (el.querySelector("td .company") || [...el.cells].find(td => !td.querySelector("input[type=checkbox]")) || el.cells[0]) : (el.querySelector(".company") || el.firstElementChild || el);
        if (!host) continue;
        host.insertAdjacentHTML("afterbegin", heart(sym, on));
      } else if (b.classList.contains("on") !== on || b.dataset.fav !== sym) b.outerHTML = heart(sym, on);
    }
    // the valuation card on Value a stock
    const card = document.querySelector("#vsResult .vs-card[data-symbol]");
    if (card) { const sym = card.dataset.symbol.toUpperCase(), on = favs.has(sym), h2 = card.querySelector("h2"); card.classList.toggle("fav-card", on); const b = h2?.querySelector("[data-fav]"); if (h2 && !b) h2.insertAdjacentHTML("afterbegin", heart(sym, on)); else if (b && b.classList.contains("on") !== on) b.outerHTML = heart(sym, on); }
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(decorate); } };
  async function toggle(sym) {
    const on = !favs.has(sym);
    on ? favs.add(sym) : favs.delete(sym); queue(); // instant, then saved
    try { favs = new Set((await api("/api/favourites", { symbol: sym, on })).symbols); window.toast?.(on ? `❤ ${esc(sym)} added to favourites` : `${esc(sym)} removed from favourites`, { kind: "ok", ms: 2500 }); }
    catch (e) { on ? favs.delete(sym) : favs.add(sym); window.toast?.(esc(e.message), { kind: "error" }); }
    queue(); if (!$("#favView").hidden) loadPage();
  }
  window.isFavourite = sym => favs.has(String(sym || "").toUpperCase());

  // ---- Favourites screen ----
  const px = v => (fin(v) ? `₹${v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
  const pc = v => (fin(v) ? `<span class="${v > 0 ? "pl-up" : v < 0 ? "pl-dn" : ""}">${v > 0 ? "+" : ""}${v}%</span>` : "—");
  async function loadPage() {
    try {
      const v = await api("/api/favourites/view");
      $("#favNote").textContent = v.rows.length ? `${v.rows.length} favourite${v.rows.length === 1 ? "" : "s"}` : "";
      $("#favGrid").innerHTML = v.rows.length ? v.rows.map(r => `<article class="fav-card-item" data-sym="${esc(r.symbol)}">
        <div class="fav-top"><div><div class="company">${esc(r.name)} <button type="button" class="ch-mini" data-chart="${esc(r.symbol)}" data-chart-name="${esc(r.name)}" title="Price chart" aria-label="Chart">📈</button></div><div class="ticker">${esc(r.symbol)}</div></div><div class="fav-price"><b ${window.lpAttr?.(r.symbol, "px") || ""}>${px(r.price)}</b><small><span ${window.lpAttr?.(r.symbol, "chg") || ""}>${pc(r.dayPct)}</span> today</small></div></div>
        <div class="fav-facts">
          <div><span>Valuation</span>${r.view ? `<b class="chip ${r.view === "Undervalued" ? "buy" : r.view === "Fair" ? "v-none" : "avoid"}">${esc(r.view)}</b>` : '<b class="hint">not valued</b>'}</div>
          <div><span>Fair value</span><b>${px(r.fair)}${fin(r.upside) ? ` <small>${pc(r.upside)}</small>` : ""}</b></div>
          <div><span>Buy zone</span><b>${r.zone ? `${px(r.zone[0])} – ${px(r.zone[1])}` : "—"}</b></div>
          <div><span>You hold</span><b>${r.held ? `${r.held.qty} · ${pc(r.held.pnlPct)}` : r.swing?.qty ? `swing ${r.swing.qty} · ${pc(r.swing.pnlPct)}` : r.swing?.watch ? `${r.swing.dip ? "dip list" : "swing watch"} below ${px(r.swing.buyBelow)}` : "—"}</b></div>
        </div>
        ${r.verdict ? `<div class="ticker">Verdict: ${esc(r.verdict)}</div>` : ""}${r.event ? `<div class="fav-ev">${r.event.kind === "dividend" ? "💰" : "📊"} ${esc(r.event.label)} · ${esc(r.event.date)}${r.event.amount ? ` · ₹${r.event.amount}/share` : ""}</div>` : ""}
        <div class="fav-acts">${r.inWatchlist ? `<button type="button" class="ghost" data-open="${esc(r.symbol)}">Details</button>` : `<button type="button" class="ghost" data-value="${esc(r.symbol)}">Value it</button>`}<button type="button" class="ghost ai-btn" data-ask-ai="Is ${esc(r.symbol)} a buy, hold or avoid for me right now? It is one of my favourites. Use its valuation, trend, upcoming events and what I hold." data-ask-sym="${esc(r.symbol)}" data-ask-where="Favourites">✨ Ask AI</button></div>
      </article>`).join("") : `<div class="fd-empty"><div class="fd-empty-ico">❤️</div><h2>No favourites yet</h2><p>Tap ♡ next to any stock in the app, or add one above.</p></div>`;
      queue();
    } catch (e) { $("#favNote").textContent = e.message; }
  }
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.favs = () => loadPage();

  document.addEventListener("DOMContentLoaded", async () => {
    // hearts: capture the click before the row's own handler (which opens details)
    document.addEventListener("click", e => { const b = e.target.closest("[data-fav]"); if (!b) return; e.preventDefault(); e.stopPropagation(); toggle(b.dataset.fav); }, true);
    try { favs = new Set((await api("/api/favourites")).symbols); } catch { /* signed out */ }
    ready = true;
    const main = document.querySelector("main") || document.body;
    new MutationObserver(ms => { if (ms.some(m => m.type === "childList" && [...m.addedNodes].some(n => n.nodeType === 1 && !n.matches?.("[data-fav]")))) queue(); }).observe(main, { childList: true, subtree: true });
    queue();
    if (!$("#favView")) return;
    $("#favGrid").addEventListener("click", e => {
      const o = e.target.closest("[data-open]"); if (o && typeof window.openStockSheet === "function") { window.openStockSheet(o.dataset.open, { back: "Back to Favourites" }); return; }
      const v = e.target.closest("[data-value]"); if (v) { setView("home"); const inp = document.querySelector("#vsSymbol"); if (inp) { inp.value = v.dataset.value; document.querySelector("#vsForm")?.requestSubmit(); } }
    });
    let t = null, res = [];
    const q = $("#favQ"), drop = $("#favDrop");
    const draw = () => { drop.innerHTML = res.map((r, i) => `<button type="button" class="mf-opt" data-i="${i}">${esc(r.name || r.symbol)}<small>${esc(r.symbol)}${r.exchange && r.exchange !== "NSE" ? ` · ${esc(r.exchange)}` : ""}</small></button>`).join(""); };
    q.addEventListener("input", () => { clearTimeout(t); const v = q.value.trim(); if (v.length < 2) { res = []; draw(); return; } t = setTimeout(async () => { try { res = ((await api(`/api/search?q=${encodeURIComponent(v)}`)).results || []).filter(r => r.symbol).slice(0, 8); } catch { res = []; } draw(); }, 200); });
    drop.addEventListener("click", async e => { const b = e.target.closest("[data-i]"); if (!b) return; const r = res[Number(b.dataset.i)]; res = []; draw(); q.value = ""; if (!favs.has(String(r.symbol).toUpperCase())) await toggle(String(r.symbol).toUpperCase()); });
  });
})();
