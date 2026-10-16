// "Value a stock" home screen, portfolio view (broker holdings -> watchlist -> Value / Growth / Buy verdicts) and the side menu.
// Loaded after app.js: it reuses app.js globals ($, esc, fmt, money, viewChip, statusChip, gaugeHtml, rangeBar, capTag,
// growthScore, valuation, loadValuation, loadStocks, loadPe, render).
(() => {
  const post = (path, body = {}) => fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    .then(async r => { const x = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(x.message || `HTTP ${r.status}`); e.status = r.status; throw e; } return x; });
  const get = path => fetch(path).then(async r => { const x = await r.json().catch(() => ({})); if (!r.ok) throw new Error(x.message || `HTTP ${r.status}`); return x; });
  const inr = v => Number.isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
  const pc = v => Number.isFinite(v) ? `${fmt(v)}%` : "—";
  const symKey = s => String(s || "").trim().toUpperCase();
  const rowFor = sym => (valuation.rows || []).find(r => symKey(r.symbol) === symKey(sym));

  // ---- Side menu -----------------------------------------------------------------------------
  const menu = $("#sideMenu"), scrim = $("#menuScrim"), menuBtn = $("#menuBtn");
  // Wide screens: the menu is a permanent right-hand sidebar. Narrow screens: a drawer opened with ☰ Menu.
  const wide = window.matchMedia("(min-width: 1100px)");
  const syncRail = () => { if (wide.matches) { menu.setAttribute("aria-hidden", "false"); scrim.hidden = true; document.body.classList.remove("menu-open"); } else if (!menu.classList.contains("open")) menu.setAttribute("aria-hidden", "true"); };
  wide.addEventListener?.("change", syncRail);
  window.closeMenu = () => { if (wide.matches) return; menu.classList.remove("open"); menu.setAttribute("aria-hidden", "true"); scrim.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); document.body.classList.remove("menu-open"); };
  const openMenu = () => { menu.classList.add("open"); menu.setAttribute("aria-hidden", "false"); scrim.hidden = false; menuBtn.setAttribute("aria-expanded", "true"); document.body.classList.add("menu-open"); $("#menuClose").focus(); };
  menuBtn.onclick = () => (menu.classList.contains("open") ? window.closeMenu() : openMenu());
  syncRail();
  // Phone tab bar: shortcuts to the main screens, "More" opens the full menu
  document.querySelectorAll(".tabbar [data-go]").forEach(b => { b.onclick = () => (b.dataset.go === "menu" ? openMenu() : $("#" + b.dataset.go)?.click()); });
  new MutationObserver(() => document.querySelectorAll(".tabbar [data-go]").forEach(b => b.classList.toggle("active", b.dataset.go !== "menu" && $("#" + b.dataset.go)?.classList.contains("active")))).observe($("#sideMenu"), { subtree: true, attributes: true, attributeFilter: ["class"] });
  $("#menuClose").onclick = window.closeMenu; scrim.onclick = window.closeMenu;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && menu.classList.contains("open")) { window.closeMenu(); menuBtn.focus(); } });
  $("#backHomeBtn").onclick = () => setView("home");

  // ---- Verdict: Value / Growth / Buy-zone classification --------------------------------------
  // Value  = priced at or below ~1.15x the model's fair multiple (view Undervalued or Fair).
  // Growth = passes every gate of the Growth picks screen (growthScore in app.js).
  // Buy    = price is in or below the model's buy zone.
  function classify(r) {
    if (r && r.verdict) return r.verdict; // computed on the server (classify.mjs), so alerts, allocator and this screen agree
    if (!r || !r.view || r.view === "No fundamentals") return { key: "none", label: "Not valued yet", cls: "v-none", tags: [], why: "No fundamentals fetched yet." };
    if (!Number.isFinite(r.ratio)) return { key: "none", label: "Can't value yet", cls: "v-none", tags: [], why: (r.reasons || []).slice(-1)[0] || "Missing data." };
    const inZone = (r.status === "In zone" || r.status === "Below zone") && !r.floored; // a floored zone is "wait for a reset", not an entry
    const rich = r.view === "Rich" || r.view === "Very rich";
    const g = typeof growthScore === "function" ? growthScore(r) : null;
    const value = r.view === "Undervalued" || r.view === "Fair";
    const tags = [value && "Value", g && "Growth", inZone && "Buy zone"].filter(Boolean);
    let key, label, cls;
    if (g && value && inZone) { key = "buy"; label = "Growth + Value buy"; cls = "v-under"; }
    else if (value && inZone) { key = "buy"; label = "Value buy"; cls = "v-under"; }
    else if (g && inZone) { key = "buy"; label = "Growth buy"; cls = "v-under"; }
    else if (g && !rich) { key = "wait"; label = "Growth: wait for a dip"; cls = "v-fair"; }
    else if (g) { key = "expensive"; label = "Growth but expensive"; cls = "v-rich"; }
    else if (value) { key = "wait"; label = "Value: near its zone, watch"; cls = "v-fair"; }
    else if (rich) { key = "expensive"; label = "Expensive: avoid for now"; cls = "v-rich"; }
    else { key = "wait"; label = "Fair to rich: hold or watch"; cls = "v-rich1"; }
    if (r.confidence === "low") label += " (low confidence)";
    return { key, label, cls, tags, growthScore: g ? g.score : null, growthNotes: g ? g.notes : [] };
  }
  window.classifyStock = classify;
  const verdictChip = c => `<span class="chip ${c.cls}">${esc(c.label)}</span>`;

  // ---- Home: add a stock, get the valuation ----------------------------------------------------
  const status = (el, msg) => { el.textContent = msg; };
  async function resolveSymbol(input) {
    const q = symKey(input);
    let results = [];
    try { results = (await get(`/api/search?q=${encodeURIComponent(input.trim())}`)).results || []; } catch {}
    const exact = results.find(s => s.symbol === q);
    if (exact) return { symbol: q, name: exact.name, exchange: exact.exchange };
    // A bare 6-digit number is a BSE scrip code (common for newly listed / BSE-only companies)
    if (/^\d{6}$/.test(q)) return { symbol: q, name: null, exchange: "BSE" };
    if (/^[A-Z0-9&-]{1,20}$/.test(q) && !/\s/.test(input.trim())) return { symbol: q, name: null, exchange: "NSE", results };
    if (results.length) return { symbol: results[0].symbol, name: results[0].name, exchange: results[0].exchange, guessed: true };
    return { symbol: null };
  }

  async function valueStock(input, pick = null) {
    const st = $("#vsStatus"), btn = $("#vsBtn");
    if (!input.trim()) { status(st, "Enter an NSE symbol or company name first."); return; }
    btn.disabled = true; status(st, "Looking up the symbol…");
    let addedId = null, symbolUsed = null;
    try {
      const res = pick ? { symbol: pick.symbol, name: pick.name, exchange: pick.exchange } : await resolveSymbol(input);
      if (!res.symbol) throw new Error("Could not match that to an NSE-listed stock. Try the NSE symbol (the part in screener.in/company/SYMBOL).");
      const { symbol } = res; symbolUsed = symbol;
      const cached = rowFor(symbol);
      if (cached && cached.view !== "No fundamentals" && cached.ageDays !== null && cached.ageDays < 1 && !pick?.force && !/range only/i.test(cached.source || "")) { // a range-only ETF reading is a stopgap: always try for the full history
        if (!listBy(activeListId)?.symbols.includes(symbol)) { lists = (await post("/api/lists/members", { id: activeListId, add: [symbol] })).lists; applyActiveList(); renderListBar(); }
        status(st, `${symbol}: fetching the live price…`);
        try { await post("/api/prices/live", { symbols: [symbol] }); await loadStocks(); await loadValuation(); } catch { /* the saved price stands */ }
        showResult(symbol); status(st, `${symbol}: data fetched today (${cached.source || "saved"}). Use Refresh data to fetch again.`); $("#vsSymbol").value = ""; return;
      }
      status(st, `${symbol}${res.exchange === "BSE" ? " (BSE)" : ""}${res.name ? ` · ${res.name}` : ""}: adding to your watchlist…`);
      let id;
      try { const x = await post("/api/stocks/add", { company: res.name || symbol, symbol, bucket: "Imported", action: "Watch", note: "Added from Value a stock.", list: activeListId, exchange: res.exchange || "NSE" }); id = x.stock.id; addedId = id; }
      catch (e) { if (e.status !== 409) throw e; }
      await loadStocks(); await loadLists();
      if (id === undefined) id = stocks.find(s => symKey(s.marketSymbol || s.ticker) === symbol)?.id;
      if (id === undefined) throw new Error("Could not find the stock after adding it.");
      status(st, `${symbol}: fetching fundamentals (Screener → Yahoo → NSE), this takes a few seconds…`);
      const out = await post("/api/fundamentals/fetch", { ids: [id], force: true, source: "auto" });
      const r0 = out.results?.[0];
      if (r0?.error && r0.rateLimited) {
        await loadValuation();
        $("#vsResult").innerHTML = `<div class="vs-card vs-empty"><b>${esc(symbol)} is saved to your watchlist.</b><br>The data sources (Screener / Yahoo) are rate-limiting this server right now, so its numbers could not be fetched. The app retries by itself in about 20 minutes, or press <b>Get valuation</b> again later.</div>`;
        status(st, `${symbol}: data sources busy (rate limit). Saved; retrying automatically.`); $("#vsSymbol").value = ""; return;
      }
      if (r0?.error) {
        const err = new Error(r0.error); err.rateLimited = !!r0.rateLimited; throw err;
      }
      await loadValuation();
      showResult(symbol);
      status(st, `${symbol} valued. ${res.guessed ? `(Matched "${input.trim()}" to ${symbol}; check this is the company you meant.)` : ""}`);
      $("#vsSymbol").value = "";
      loadPe?.().then(() => render?.());
    } catch (e) {
      status(st, `Could not value this stock: ${e.message}`);
      await loadValuation();
      const saved = symbolUsed && rowFor(symbolUsed);
      if (saved && saved.view !== "No fundamentals") { showResult(symbolUsed); status(st, `${symbolUsed}: refresh failed (${e.message.slice(0, 120)}), so this shows the saved data from ${saved.ageDays ?? "?"} day(s) ago.`); addedId = null; }
      // A typo'd symbol would otherwise leave an empty row behind: take it back out (never for rate limits).
      if (addedId !== null && !e.rateLimited && /not found|no page|no price|too little|could not match/i.test(e.message) && !/session|fetch failed|cooling|rate-limit|timeout/i.test(e.message)) {
        try { const all = (await get("/api/stocks")).stocks; await post("/api/watchlist", { stocks: all.filter(s => s.id !== addedId) }); await loadStocks(); } catch {}
      }
    } finally { btn.disabled = false; }
  }
  $("#vsForm").addEventListener("submit", e => { e.preventDefault(); const it = sg.active >= 0 ? sg.items[sg.active] : null; closeDrop(); it ? valueStock(it.symbol, it) : valueStock($("#vsSymbol").value); });

  // ---- Search-as-you-type dropdown -----------------------------------------------------------------------------------
  const sg = { items: [], active: -1, seq: 0, timer: null, previews: new Map(), note: null };
  const drop = $("#vsDrop"), input = $("#vsSymbol");
  function closeDrop() { drop.hidden = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); sg.active = -1; }
  function inActive(it) { const l = listBy(activeListId); return !!(l && l.symbols.includes(it.symbol)); }
  function itemHtml(it, i) {
    const pv = it.tracked ? it : sg.previews.get(`${it.exchange}:${it.symbol}`);
    const nums = pv && (Number.isFinite(pv.price) || Number.isFinite(pv.pe)) ? `<span class="sg-nums">${Number.isFinite(pv.price) ? money(pv.price) : ""}${Number.isFinite(pv.pe) ? ` · P/E ${fmt(pv.pe)}` : ""}${Number.isFinite(pv.sectorPe) ? ` · sector ${pv.sectorPeEst ? "~" : ""}${fmt(pv.sectorPe)}` : ""}</span>` : `<span class="sg-nums hint">${pv?.loading ? "loading…" : it.tracked ? "not valued yet" : ""}</span>`;
    const verdict = it.verdict ? `<span class="chip ${esc(it.verdictCls || "v-none")}">${esc(it.verdict)}</span>` : it.tracked ? "" : '<span class="chip v-none">New</span>';
    const inL = inActive(it), lname = listBy(activeListId)?.name || "watchlist";
    return `<div class="sg-item${i === sg.active ? " active" : ""}" role="option" id="sg-${i}" data-i="${i}" aria-selected="${i === sg.active}">
      <div class="sg-main"><div class="sg-name">${esc(it.name)}</div><div class="sg-meta"><b>${esc(it.symbol)}</b> · <span class="sg-ex ${it.exchange === "BSE" ? "bse" : ""}">${esc(it.exchange)}</span>${it.sector ? ` · ${esc(it.sector)}` : ""} ${nums}</div></div>
      <div class="sg-side">${verdict}<button type="button" class="ghost sg-add" data-add="${i}" title="${inL ? `Remove from “${esc(lname)}”` : `Add to “${esc(lname)}” and fetch its data`}">${inL ? "✓ In list" : "+ Watchlist"}</button><button type="button" class="primary sg-val" data-val="${i}">Value</button></div></div>`;
  }
  function renderDrop() {
    if (!sg.items.length && !sg.note) { closeDrop(); return; }
    const lname = listBy(activeListId)?.name || "watchlist";
    drop.innerHTML = (sg.items.length ? sg.items.map(itemHtml).join("") : `<div class="sg-empty">No match. Press Enter to try “${esc(input.value.trim())}” as an NSE symbol or BSE code.</div>`)
      + `<div class="sg-foot"><span>↑↓ to move · Enter to value · Ctrl+Enter to add to “${esc(lname)}”</span><button type="button" class="ghost" id="sgNewList">+ New watchlist</button></div>${sg.note ? `<div class="sg-note">${esc(sg.note)}</div>` : ""}`;
    drop.hidden = false; input.setAttribute("aria-expanded", "true");
    if (sg.active >= 0) input.setAttribute("aria-activedescendant", `sg-${sg.active}`); else input.removeAttribute("aria-activedescendant");
  }
  async function preview(i) {
    const it = sg.items[i]; if (!it || it.tracked) return;
    const key = `${it.exchange}:${it.symbol}`; if (sg.previews.has(key)) return;
    sg.previews.set(key, { loading: true }); renderDrop();
    try { sg.previews.set(key, await get(`/api/quote-preview?symbol=${encodeURIComponent(it.symbol)}&exchange=${it.exchange}`)); } catch { sg.previews.set(key, {}); }
    if (!drop.hidden) renderDrop();
  }
  function setActive(i) { sg.active = i; renderDrop(); if (i >= 0) { preview(i); $(`#sg-${i}`)?.scrollIntoView({ block: "nearest" }); } }
  input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-controls", "vsDrop"); input.setAttribute("aria-expanded", "false");
  input.addEventListener("input", () => {
    clearTimeout(sg.timer);
    const q = input.value.trim(); if (!q) { sg.items = []; sg.note = null; closeDrop(); return; }
    sg.timer = setTimeout(async () => {
      const my = ++sg.seq;
      try { const x = await get(`/api/search?q=${encodeURIComponent(q)}`); if (my !== sg.seq) return; sg.items = x.results || []; sg.note = x.note || null; sg.active = sg.items.length ? 0 : -1; renderDrop(); if (sg.active === 0) preview(0); } catch {}
    }, 160);
  });
  input.addEventListener("keydown", e => {
    if (drop.hidden && e.key === "ArrowDown" && input.value.trim()) { input.dispatchEvent(new Event("input")); return; }
    if (drop.hidden) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive(Math.min(sg.items.length - 1, sg.active + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive(Math.max(0, sg.active - 1)); }
    else if (e.key === "Escape") { closeDrop(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && sg.active >= 0) { e.preventDefault(); toggleInList(sg.active); }
  });
  input.addEventListener("focus", () => { if (sg.items.length && input.value.trim()) renderDrop(); });
  document.addEventListener("click", e => { if (!e.target.closest("#vsForm")) closeDrop(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !drop.hidden) { closeDrop(); input.focus(); } });
  drop.addEventListener("mousemove", e => { const el = e.target.closest(".sg-item"); if (el && Number(el.dataset.i) !== sg.active) setActive(Number(el.dataset.i)); });
  drop.addEventListener("click", async e => {
    if (e.target.closest("#sgNewList")) { $("#listNew").click(); return; }
    const add = e.target.closest("[data-add]"); if (add) { e.preventDefault(); toggleInList(Number(add.dataset.add)); return; }
    const row = e.target.closest(".sg-item"); if (!row) return;
    const it = sg.items[Number(row.dataset.i)]; closeDrop(); input.value = it.symbol; valueStock(it.symbol, it);
  });
  // Moves a suggestion into the selected watchlist (or out of it). New stocks are tracked and their data fetched in the background.
  async function toggleInList(i) {
    const it = sg.items[i], st = $("#vsStatus"); if (!it) return;
    const lname = listBy(activeListId)?.name || "watchlist";
    try {
      if (inActive(it)) { lists = (await post("/api/lists/members", { id: activeListId, remove: [it.symbol] })).lists; applyActiveList(); renderListBar(); renderDrop(); redrawAll(); status(st, `${it.symbol} removed from “${lname}”.`); return; }
      const tracked = stocks.some(x => symOfAny(x) === it.symbol);
      if (tracked) await post("/api/lists/members", { id: activeListId, add: [it.symbol] });
      else await post("/api/stocks/add", { symbol: it.symbol, company: it.name, exchange: it.exchange, list: activeListId, bucket: "Imported", action: "Watch", note: "Added from search." });
      await Promise.all([loadStocks(), loadLists()]); it.lists = [...(it.lists || []), activeListId]; renderDrop(); redrawAll();
      const stock = stocks.find(x => symOfAny(x) === it.symbol), row = rowFor(it.symbol);
      if (stock && (!row || row.view === "No fundamentals")) {
        status(st, `${it.symbol} added to “${lname}”. Fetching its P/E, growth and valuation…`);
        post("/api/fundamentals/fetch", { ids: [stock.id], force: false, source: "auto" })
          .then(async x => { await loadValuation(); redrawAll(); const r0 = x.results?.[0]; status(st, r0?.error ? `${it.symbol} added to “${lname}”, but its data could not be fetched yet: ${r0.error}` : `${it.symbol} added to “${lname}” and valued.`); })
          .catch(err => status(st, `${it.symbol} added; data fetch failed: ${err.message}`));
      } else status(st, `${it.symbol} added to “${lname}”.`);
    } catch (err) { status(st, `Could not update the watchlist: ${err.message}`); }
  }

  // "Yahoo · 3:28 pm", same label as the Swing page, so you can see which quote the valuation used
  function priceStamp(symbol) {
    const s = (typeof stocks !== "undefined" ? stocks : []).find(x => symKey(x.marketSymbol || x.ticker) === symKey(symbol));
    if (!s?.priceAt) return "";
    const d = new Date(s.priceAt), today = d.toDateString() === new Date().toDateString();
    const when = d.toLocaleString("en-IN", today ? { hour: "numeric", minute: "2-digit" } : { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
    const src = String(s.priceSource || "").replace(/ Finance| MCP.*$/g, "");
    return `<small class="hint vs-stamp">${esc(src)}${src ? " · " : ""}${esc(when)}</small>`;
  }
  // Live update: when a price changes, redraw the card that is open (only if its price moved)
  window.addEventListener("prices:updated", () => {
    const card = $("#vsResult .vs-card[data-symbol]"); if (!card) return;
    const r = rowFor(card.dataset.symbol); if (r && String(r.price) !== card.dataset.price) showResult(card.dataset.symbol);
  });
  function showResult(symbol) {
    const box = $("#vsResult"), r = rowFor(symbol);
    if (!r) { box.innerHTML = `<div class="vs-card vs-empty">${esc(symbol)} is not on your watchlist yet.</div>`; return; }
    const c = classify(r);
    const row = (k, v) => `<div class="row"><span>${k}</span><strong>${v}</strong></div>`;
    const fin = r.profile === "financial";
    const fv = r.fairValue;
    const up = Number.isFinite(r.upsideToBase) ? `<small class="${r.upsideToBase >= 0 ? "buy" : "avoid"}">${r.upsideToBase >= 0 ? "+" : ""}${Math.round(r.upsideToBase * 100)}% from today's price to base value</small>` : "";
    const assessable = Number.isFinite(r.ratio);
    const tiles = assessable ? `
      <div class="vs-tile"><span>Fair value (bear · base · bull)</span><strong>${fv ? `${money(fv.bear)} · ${money(fv.base)} · ${money(fv.bull)}` : "—"}</strong>${up}</div>
      <div class="vs-tile"><span>Buy zone</span><strong>${r.zoneLow ? `${money(r.zoneLow)} – ${money(r.zoneHigh)}${r.floored ? " ⚑" : ""}` : "—"}</strong><small>${statusChip(r.status)} ${Number.isFinite(r.gapToZone) ? `${r.gapToZone > 0 ? "+" : ""}${Math.round(r.gapToZone * 100)}% vs top of zone` : ""}</small></div>
      ${r.etf && !Number.isFinite(r.etf.devNow) && Number.isFinite(r.rangePos) ? `<div class="vs-tile"><span>Place in 52-week range</span><strong>${Math.round(r.rangePos * 100)}% of the way up</strong><small>${viewChip(r.view)} low confidence: price history not available yet</small>${gaugeHtml(r.ratio)}</div>`
        : r.etf ? `<div class="vs-tile"><span>vs its 200-day average</span><strong>${Number.isFinite(r.etf.devNow) ? `${r.etf.devNow > 0 ? "+" : ""}${fmt(r.etf.devNow)}%` : "—"}</strong><small>${viewChip(r.view)} ${Number.isFinite(r.etf.pctile) ? `${Math.round(r.etf.pctile)}th percentile of its history` : ""}</small>${gaugeHtml(r.ratio)}</div>`
        : `<div class="vs-tile"><span>${esc(r.basis || "Multiple")} vs fair</span><strong>${fmt(r.multiple)} vs ${fmt(r.fairMultiple)}</strong><small>${viewChip(r.view)}</small>${gaugeHtml(r.ratio)}</div>`}
      <div class="vs-tile"><span>52-week range</span>${rangeBar(r.low, r.high, r.price) || "<strong>—</strong>"}</div>` : "";
    const tags = c.tags.length ? c.tags.map(t => `<span class="chip v-none">${esc(t)}</span>`).join(" ") : "";
    const reasons = (r.reasons || []).map(x => `<li>${esc(x)}</li>`).join("");
    const gnotes = (c.growthNotes || []).map(x => `<li>${esc(x)}</li>`).join("");
    $("#vsResult").innerHTML = `<article class="vs-card" data-symbol="${esc(r.symbol)}" data-price="${esc(String(r.price))}">
      <div class="vs-top"><div><h2>${esc(r.company)} <small>(${esc(r.symbol)})</small>${capTag(r.cap)}</h2><p class="hint" style="margin:4px 0 0">${esc(r.sector || "")}${r.marketCap ? ` · ₹${Math.round(r.marketCap).toLocaleString("en-IN")} Cr market cap` : ""}</p></div><div class="vs-price"><span class="hint">Price</span><strong>${money(r.price)}</strong>${priceStamp(r.symbol)}</div></div>
      <div class="vs-verdict"><span class="vs-big chip ${c.cls}">${esc(c.label)}</span>${tags}</div>
      ${c.growthScore !== null && c.growthScore !== undefined ? `<p class="hint" style="margin:4px 0 0">Growth score ${c.growthScore}/100 (passes every growth and durability gate).</p>` : ""}
      <div class="vs-grid">${tiles}</div>
      <section class="gl-panel" id="glPanel" aria-label="Growth lens"></section>
      <div class="vs-cols">
        <div><h3>Why this verdict</h3><ul>${reasons || "<li>No details available.</li>"}${gnotes}</ul>${r.flags ? `<p class="hint"><em>${esc(r.flags)}</em></p>` : ""}</div>
        <div><h3>Key numbers</h3>
          ${r.etf ? etfRowsHtml(r, row) : `${row("P/E", fmt(r.pe))}${row("Sector P/E", Number.isFinite(r.sectorPe) ? `${fmt(r.sectorPe)} <small class="hint">${esc(r.sectorPeSource || "")}</small>` : Number.isFinite(r.sectorPeEst) ? `~${fmt(r.sectorPeEst)} <small class="hint">median of ${r.sectorPeEstN} tracked</small>` : "—")}${row("P/B", fmt(r.pb, 2))}
          ${row(fin ? "ROE" : "ROCE", pc(fin ? r.roe : r.roce))}${row("3-yr sales CAGR", pc(r.salesCagr3))}${row("3-yr profit CAGR", pc(r.profitCagr3))}
          ${row("Borrowings / reserves", `${fmt(r.borrowings, 0)} / ${fmt(r.reserves, 0)} Cr`)}${row("Promoter holding", pc(r.promoter))}
          ${row("Source · data age", `${esc(r.source || "—")} · ${r.ageDays === null || r.ageDays === undefined ? "—" : r.ageDays + "d"}${r.stale ? " ⚠ stale" : ""}`)}`}</div>
      </div>
      <div id="vsExtras" class="vs-extras"><p class="hint">Loading dividend, trend and peer data…</p></div>
      <div class="toolbar" style="margin:16px 0 0"><button type="button" class="ghost" id="vsListBtn"></button><button type="button" class="ghost" id="vsRefetch">Refresh data</button><button type="button" class="ghost" id="vsOpenTable">Open in Valuation table</button></div>
      <p class="vs-fine">${r.etf ? "ETFs have no earnings: the zone is where the price has been cheapest against its own 200-day average over the past years (bottom 20%), and fair value is its typical (median) level. Not a forecast or investment advice." : ""}${r.etf ? "" : `Value = priced at or under ~1.15× the model's fair multiple. Growth = passes all growth, return-on-capital, balance-sheet and cash-flow gates. Buy = price within the model's buy zone. A rule-based screen from public data (Screener / Yahoo / NSE), not a forecast or investment advice; check the reasons and the data age.`}</p>
    </article>`;
    loadExtras(r.symbol);
    renderGrowthLens(r);
    const lb = $("#vsListBtn"), paintListBtn = () => { const l = lists.find(x => x.id === activeListId), inL = !!(l && l.symbols.includes(symKey(r.symbol))); lb.textContent = inL ? `✓ In “${l.name}” (remove)` : `+ Add to “${l?.name || "watchlist"}”`; lb.dataset.in = inL ? "1" : ""; };
    paintListBtn();
    lb.onclick = async () => { lb.disabled = true; try { await post("/api/lists/members", { id: activeListId, [lb.dataset.in ? "remove" : "add"]: [symKey(r.symbol)] }); await loadLists(); redrawAll(); paintListBtn(); } catch (e) { lb.textContent = `Failed: ${e.message}`; } finally { lb.disabled = false; } };
    $("#vsRefetch").onclick = () => valueStock(r.symbol, { symbol: r.symbol, name: r.company, exchange: r.exchange || "NSE", force: true });
    $("#vsOpenTable").onclick = () => { setView("valuation"); setTimeout(() => { const i = $("#valSearch"); if (i) { i.value = r.symbol; i.dispatchEvent(new Event("input")); } }, 50); };
    if (!sheet?.open) box.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
  }
  window.showStockResult = showResult;

  // Side menu pin (wide screens): folded rail by default, 📌 keeps it open; remembered per browser.
  (() => {
    const pin = $("#menuPin"); if (!pin) return;
    const apply = on => { document.body.classList.toggle("menu-pinned", on); pin.setAttribute("aria-pressed", String(on)); pin.title = on ? "Unpin: fold the menu to icons" : "Keep the menu open"; };
    let on = false; try { on = localStorage.getItem("equity-menu-pinned") === "1"; } catch {}
    apply(on);
    pin.onclick = () => { on = !on; apply(on); try { localStorage.setItem("equity-menu-pinned", on ? "1" : "0"); } catch {} if (!on) document.activeElement?.blur(); };
  })();

  // ---- Stock sheet: open a stock's full valuation over the current page (holdings, focus, market, funds, alerts…)
  // instead of jumping to "Value a stock". The result card (and its status line) is moved into the sheet while it is open
  // and put back when it closes, so every button inside it keeps working.
  let sheet = null;
  function buildSheet() {
    const scrim = document.createElement("div"); scrim.className = "sheet-scrim"; scrim.hidden = true;
    const el = document.createElement("aside"); el.className = "stock-sheet"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Stock valuation");
    el.innerHTML = `<div class="sheet-bar"><button type="button" class="ghost sheet-back" data-close>← <span></span></button><span class="sheet-hint">Esc to close</span><button type="button" class="modal-close" data-close aria-label="Close">&times;</button></div><div class="sheet-body"></div>`;
    document.body.append(scrim, el);
    scrim.addEventListener("click", () => closeSheet());
    el.querySelectorAll("[data-close]").forEach(b => { b.onclick = () => closeSheet(); });
    return { scrim, el, body: el.querySelector(".sheet-body"), home: { status: [$("#vsStatus").parentNode, $("#vsStatus").nextSibling], result: [$("#vsResult").parentNode, $("#vsResult").nextSibling] }, prevFocus: null, open: false };
  }
  const onSheetKey = e => { if (e.key === "Escape" && sheet?.open && !document.querySelector(".ui-scrim")) { e.preventDefault(); closeSheet(); } };
  function closeSheet() {
    if (!sheet?.open) return;
    sheet.open = false;
    const [rp, rn] = sheet.home.result, [sp, sn] = sheet.home.status;
    rp.insertBefore($("#vsResult"), rn && rn.parentNode === rp ? rn : null);
    sp.insertBefore($("#vsStatus"), sn && sn.parentNode === sp ? sn : null);
    $("#vsResult").innerHTML = ""; status($("#vsStatus"), "");
    sheet.el.hidden = true; sheet.scrim.hidden = true; document.body.classList.remove("sheet-open");
    document.removeEventListener("keydown", onSheetKey, true);
    sheet.prevFocus?.focus?.({ preventScroll: true });
    window.scrollTo(0, sheet.scrollY || 0);
  }
  window.openStockSheet = (sym, { pick = null, back = "Back" } = {}) => {
    if (!sheet) sheet = buildSheet();
    if (!sheet.open) {
      sheet.prevFocus = document.activeElement; sheet.scrollY = window.scrollY;
      sheet.body.append($("#vsStatus"), $("#vsResult"));
      status($("#vsStatus"), "");
      sheet.el.hidden = false; sheet.scrim.hidden = false; sheet.open = true; document.body.classList.add("sheet-open");
      document.addEventListener("keydown", onSheetKey, true);
    }
    sheet.el.querySelector(".sheet-back span").textContent = back;
    sheet.body.scrollTop = 0;
    if (rowFor(sym)) showResult(sym);
    else { $("#vsResult").innerHTML = `<div class="vs-card vs-empty">Valuing ${esc(sym)}…</div>`; valueStock(sym, pick || { symbol: sym, name: null, exchange: /^\d{6}$/.test(sym) ? "BSE" : "NSE" }); }
    requestAnimationFrame(() => sheet.el.querySelector(".sheet-back").focus({ preventScroll: true }));
  };
  window.closeStockSheet = closeSheet;
  // Any navigation (menu, "Open in Valuation table") closes the sheet first.
  const _setView = window.setView;
  window.setView = (...a) => { closeSheet(); return _setView(...a); };

  function renderRecent() {
    const rows = (valuation.rows || []).filter(r => (!activeListSymbols || activeListSymbols.has(symOfAny(r))) && r.view && r.view !== "No fundamentals" && r.asOf).sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)) || a.company.localeCompare(b.company)).slice(0, 8);
    $("#vsRecentWrap").hidden = !rows.length;
    $("#vsRecent").innerHTML = rows.map(r => { const c = classify(r); return `<tr data-sym="${esc(r.symbol)}"><td><div class="company">${esc(r.company)}</div><div class="ticker">${esc(r.symbol)}</div></td><td>${money(r.price)}</td><td>${verdictChip(c)}</td><td>${viewChip(r.view)}</td><td class="range">${r.zoneLow ? `${money(r.zoneLow)} – ${money(r.zoneHigh)}` : "—"}</td><td>${statusChip(r.status)}</td></tr>`; }).join("");
  }
  $("#vsRecent").addEventListener("click", e => { const tr = e.target.closest("tr[data-sym]"); if (tr) showResult(tr.dataset.sym); });
  window.openHome = async () => { loadSwingStrip(); await loadValuation(); renderRecent(); };
  // Swing signals at a glance on Home (only when you track swing trades)
  async function loadSwingStrip() {
    const el = $("#homeSwing"); if (!el) return;
    try {
      const x = await get("/api/swing/summary"); if (!x.has) { el.hidden = true; return; }
      const sgn = v => Number.isFinite(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}` : "—";
      const L = v => v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`;
      const pills = [x.takeProfit ? `<span class="pill tp">🎯 ${x.takeProfit} to book profit</span>` : "", x.deploy ? `<span class="pill dp">💰 ${x.deploy} to deploy${x.deployNow ? ` · ${L(x.deployNow)}` : ""}</span>` : "", x.near ? `<span class="pill near">${x.near} near a level</span>` : "", x.cashShort ? `<span class="pill bad">cash short by ${L(x.cashShort)}</span>` : ""].filter(Boolean);
      el.innerHTML = `<b class="t">⚡ Swing</b>${pills.join("") || '<span class="pill">No signals right now</span>'}<span>P/L <b class="${x.pnl > 0 ? "buy" : x.pnl < 0 ? "avoid" : ""}">${sgn(x.pnl)}</b>${Number.isFinite(x.pnlPct) ? ` (${x.pnlPct > 0 ? "+" : ""}${x.pnlPct}%)` : ""} on ${x.positions} position${x.positions === 1 ? "" : "s"}</span>${Number.isFinite(x.cash) ? `<span>Free cash <b>${L(x.cash)}</b></span>` : ""}<span class="go">Open ›</span>`;
      el.title = x.top.map(t => `${t.name}: ${t.note || ""}`).join("\n");
      el.hidden = false;
    } catch { el.hidden = true; }
  }
  window.loadSwingStrip = loadSwingStrip;
  $("#homeSwing")?.addEventListener("click", () => setView("swing"));
  $("#homeSwing")?.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setView("swing"); } });
  setInterval(() => { if (!$("#homeView").hidden && !document.hidden) loadSwingStrip(); }, 120000);

  // ---- Portfolio ---------------------------------------------------------------------------------
  let pf = null, pfFilter = "all", pfTimer = null;
  const FILTERS = [["all", "All"], ["buy", "Buy zone"], ["Value", "Value"], ["Growth", "Growth"], ["Dividend", "Dividend"], ["wait", "Wait / hold"], ["expensive", "Expensive"], ["none", "Not valued"]];
  const matches = (h, f) => f === "all" || h.c.key === f || h.c.tags.includes(f);
  let pfAccount = "all"; // "all" or an account userId: each broker account gets its own tab
  function renderPortfolio() {
    const v = pf; if (!v) return;
    if (pfAccount !== "all" && !v.accounts.some(a => a.userId === pfAccount)) pfAccount = "all";
    // In an account tab, quantity / cost / value are that account's own, not the combined position.
    const scoped = v.holdings.map(h => {
      if (pfAccount === "all") return h;
      const acc = h.accounts.find(a => a.userId === pfAccount); if (!acc) return null;
      const price = h.syncPrice ?? h.watchlistPrice, value = Number.isFinite(price) ? price * acc.qty : null, invested = Number.isFinite(acc.avgPrice) ? acc.avgPrice * acc.qty : null;
      return { ...h, qty: acc.qty, avgPrice: acc.avgPrice, value, invested, pnl: value !== null && invested !== null ? value - invested : null, accounts: [acc] };
    }).filter(Boolean);
    const totalValue = scoped.reduce((x, h) => x + (h.value || 0), 0), totalPnl = scoped.reduce((x, h) => x + (h.pnl || 0), 0);
    const hs = scoped.map(h => { const r = rowFor(h.symbol); return { ...h, weightPct: totalValue > 0 && Number.isFinite(h.value) ? Math.round(h.value / totalValue * 1000) / 10 : null, r, c: h.inWatchlist ? classify(r) : { key: "none", label: "Not on watchlist", cls: "v-none", tags: [] } }; });
    const cnt = f => hs.filter(h => matches(h, f)).length;
    if (!v.accounts.length) $("#pfSetup").open = true;
    $("#pfAccounts").innerHTML = v.accounts.length ? `<ul class="flag-list">${v.accounts.map(a => `<li><div class="fcompany">${esc(a.brokerName || "Zerodha")} · ${esc(a.label)}</div><div class="fnote">${a.count} holdings · synced ${new Date(a.syncedAt).toLocaleString("en-IN")}</div></li>`).join("")}</ul>` : "No broker connected yet. Connect one, or import a CSV below.";
    $("#pfAccTabs").innerHTML = v.accounts.length ? [`<button type="button" class="viewTab${pfAccount === "all" ? " active" : ""}" data-acc="all">All accounts <span class="tab-badge">${v.holdings.length}</span></button>`, ...v.accounts.map(a => `<button type="button" class="viewTab${pfAccount === a.userId ? " active" : ""}" data-acc="${esc(a.userId)}">${(a.label || "").toLowerCase().includes(String(a.brokerName || "").toLowerCase()) ? "" : `<span class="acc-broker">${esc(a.brokerName)}</span> `}${esc(a.label)} <span class="tab-badge">${a.count}</span></button>`)].join("") : "";
    $("#pfCards").innerHTML = hs.length ? `<div><span>Holdings${pfAccount === "all" ? "" : " in this account"}</span><strong>${hs.length}</strong></div><div><span>Value</span><strong>${inr(Math.round(totalValue))}</strong></div><div><span>P/L</span><strong class="${totalPnl > 0 ? "buy" : totalPnl < 0 ? "avoid" : ""}">${inr(Math.round(totalPnl))}</strong></div><div><span>In buy zone / expensive</span><strong><b class="buy">${cnt("buy")}</b> / ${cnt("expensive")}</strong></div>` : "";
    $("#pfFilters").innerHTML = FILTERS.map(([k, l]) => `<button type="button" class="pf-chip${pfFilter === k ? " active" : ""}" data-f="${k}">${l}<b>${cnt(k)}</b></button>`).join("");
    const shown = hs.filter(h => matches(h, pfFilter));
    $("#pfRows").innerHTML = shown.length ? shown.map(h => { const r = h.r; return `<tr data-sym="${esc(h.symbol)}"><td><div class="company">${esc(h.company || h.symbol)}</div><div class="ticker">${esc(h.symbol)} · ${h.accounts.map(a => (a.label || "").toLowerCase().includes(String(a.brokerName || "").toLowerCase()) ? esc(a.label) : `${esc(a.brokerName || "")} · ${esc(a.label)}`).join(", ")}</div></td><td>${h.qty}</td><td>${inr(h.avgPrice)}</td><td>${inr(h.syncPrice ?? h.watchlistPrice)}</td><td>${r && Number.isFinite(r.pe) ? `<b>${fmt(r.pe)}</b>` : "—"}</td><td>${r ? sectorPeText(r) : "—"}</td><td class="${h.pnl > 0 ? "buy" : h.pnl < 0 ? "avoid" : ""}">${inr(Number.isFinite(h.pnl) ? Math.round(h.pnl) : null)}</td><td>${Number.isFinite(h.weightPct) ? h.weightPct + "%" : "—"}</td><td>${verdictChip(h.c)}</td><td>${r && Number.isFinite(r.ratio) ? viewChip(r.view) : "—"}</td><td>${r?.fairValue ? money(r.fairValue.base) : "—"}</td><td class="range">${r?.zoneLow ? `${money(r.zoneLow)} – ${money(r.zoneHigh)}` : "—"}</td><td>${r && Number.isFinite(r.ratio) ? statusChip(r.status) : "—"}</td><td>${h.inWatchlist ? "" : `<button type="button" class="ghost" data-add="${esc(h.symbol)}">Add &amp; value</button>`}</td></tr>`; }).join("") : `<tr><td colspan="14" style="text-align:center;padding:24px;color:var(--muted)">${hs.length ? "No holdings match this filter." : "No holdings yet. Connect a broker or import a CSV above."}</td></tr>`;
    $("#pfNote").textContent = hs.length ? `Click a row to see the full valuation. ${hs.filter(h => !h.inWatchlist).length} holding(s) are not on the watchlist yet: use "Add all holdings & value them".` : "";
  }
  $("#pfAccTabs").addEventListener("click", e => { const b = e.target.closest("[data-acc]"); if (b) { pfAccount = b.dataset.acc; renderPortfolio(); } });
  window.openHoldingsFor = userId => { pfAccount = userId || "all"; setView("portfolio"); };
  $("#intGoHoldings").onclick = () => setView("portfolio");

  // ---- Toasts: short confirmations (sync done, import done) with an optional action button ----
  const toastBox = document.createElement("div"); toastBox.className = "toasts"; toastBox.setAttribute("role", "status"); toastBox.setAttribute("aria-live", "polite"); document.body.appendChild(toastBox);
  window.toast = (html, { kind = "ok", action = null, ms = 7000 } = {}) => {
    const t = document.createElement("div"); t.className = `toast ${kind}`;
    t.innerHTML = `<span>${html}</span>${action ? `<button type="button" class="ghost">${esc(action.label)}</button>` : ""}<button type="button" class="toast-x" aria-label="Dismiss">&times;</button>`;
    const kill = () => { t.classList.add("out"); setTimeout(() => t.remove(), 250); };
    if (action) t.querySelector("button.ghost").onclick = () => { action.fn(); kill(); };
    t.querySelector(".toast-x").onclick = kill; toastBox.appendChild(t); setTimeout(kill, ms);
  };
  window.openPortfolio = async () => {
    renderHealth();
    try { const [h] = await Promise.all([get("/api/holdings"), loadValuation()]); pf = h; renderPortfolio(); } catch (e) { $("#pfAccounts").textContent = `Could not load holdings: ${e.message}`; }
  };
  $("#pfFilters").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) { pfFilter = b.dataset.f; renderPortfolio(); } });
  $("#pfRows").addEventListener("click", async e => {
    const add = e.target.closest("[data-add]");
    if (add) { e.stopPropagation(); await addToWatchlist([add.dataset.add]); return; }
    const tr = e.target.closest("tr[data-sym]"); if (!tr) return;
    const sym = tr.dataset.sym;
    if (!rowFor(sym)) return;
    openStockSheet(sym, { back: "Back to My holdings" });
  });
  $("#pfConnect").onclick = () => setView("integrations");
  const goCsv = $("#intGoCsv"); if (goCsv) goCsv.onclick = () => { setView("portfolio"); $("#pfSetup").open = true; $("#pfCsv").open = true; };

  async function addToWatchlist(symbols) {
    const st = $("#pfAddStatus"), btn = $("#pfAddAll"); btn.disabled = true; status(st, "Adding to watchlist…");
    try {
      const x = await post("/api/holdings/add-to-watchlist", { ...(symbols ? { symbols } : {}), list: activeListId });
      status(st, `${x.added} added, ${x.alreadyThere} already tracked. ${x.started || x.jobRunning ? "Fetching fundamentals…" : ""}`);
      await loadStocks(); await loadLists();
      pollJob2();
    } catch (e) { status(st, `Failed: ${e.message}`); btn.disabled = false; }
  }
  async function pollJob2() {
    clearTimeout(pfTimer);
    try {
      const j = await get("/api/fundamentals/job");
      const st = $("#pfAddStatus");
      await loadValuation(); await openPortfolioQuiet();
      if (j.running) { status(st, `Valuing ${j.done}/${j.total}${j.current ? ` · now ${j.current}` : ""} · ${j.saved} saved, ${j.failed.length} failed`); pfTimer = setTimeout(pollJob2, 3000); return; }
      $("#pfAddAll").disabled = false;
      if (j.startedAt) status(st, `${j.note || "Done."} ${j.saved} valued${j.failed.length ? `, ${j.failed.length} failed: ${j.failed.slice(0, 3).map(f => `${f.company} (${String(f.error).slice(0, 70)})`).join(" | ")}` : ""}`);
    } catch { pfTimer = setTimeout(pollJob2, 5000); }
  }
  async function openPortfolioQuiet() { try { pf = await get("/api/holdings"); renderPortfolio(); } catch {} }
  $("#pfAddAll").onclick = () => addToWatchlist(null);

  // CSV import (INDmoney or any broker)
  $("#pfCsvFile").addEventListener("change", e => { const f = e.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => { $("#pfCsvText").value = String(rd.result || ""); }; rd.readAsText(f); });
  $("#pfCsvBtn").onclick = async () => {
    const st = $("#pfCsvStatus"), btn = $("#pfCsvBtn"); btn.disabled = true; btn.classList.add("is-loading"); status(st, "Importing…");
    try {
      const x = await post("/api/holdings/import", { csv: $("#pfCsvText").value, label: $("#pfCsvLabel").value, broker: /indmoney/i.test($("#pfCsvLabel").value) ? "indmoney" : "other" });
      status(st, `Imported ${x.imported} holding(s).${x.skipped.length ? ` Skipped ${x.skipped.length} (not NSE symbols): ${x.skipped.slice(0, 5).join(", ")}` : ""}`);
      $("#pfCsvText").value = ""; await openPortfolioQuiet();
      window.toast(`✓ Imported ${x.imported} holding${x.imported === 1 ? "" : "s"} into <b>${esc($("#pfCsvLabel").value || "Imported holdings")}</b>`);
    } catch (e) { status(st, `Failed: ${e.message}`); } finally { btn.disabled = false; btn.classList.remove("is-loading"); }
  };

  // ---- Stock card extras: dividend lens, swing overlay, peers ------------------------------------------
  const safetyCls = { Safe: "v-under", Watch: "v-rich1", "At risk": "v-rich", None: "v-none" };
  const setupCls = { Breakout: "v-under", "Swing setup": "v-under", Neutral: "v-fair", "Weak trend": "v-rich", "No data": "v-none" };
  async function loadExtras(symbol) {
    const box = $("#vsExtras"); if (!box) return;
    box.innerHTML = '<p class="hint">Loading dividend, trend and peer data from Screener…</p>';
    try {
      const x = await get(`/api/stock-extras?symbol=${encodeURIComponent(symbol)}`);
      const art = $("#vsResult article"); if (!$("#vsExtras") || (art && symKey(art.dataset.symbol) !== symKey(symbol))) return; // user moved on
      const row = (k, v) => `<div class="row"><span>${k}</span><strong>${v}</strong></div>`;
      // Dividend lens
      const d = x.dividend;
      let divHtml = `<h3>Dividend lens</h3><p class="xp">How much the company pays you each year and how safe that payout looks.</p>`;
      if (d) {
        const yrs = Object.entries(d.annual || {}).map(([y, v]) => [Number(y), v]).sort((p, q) => p[0] - q[0]).slice(-8), mx = Math.max(0.01, ...yrs.map(z => z[1]));
        divHtml += `<p style="margin:0 0 8px"><span class="chip ${safetyCls[d.safety] || "v-none"}">${esc(d.safety === "None" ? "No dividend" : "Dividend " + d.safety.toLowerCase())}</span></p>
          ${d.safety === "None" ? "" : row("Dividend yield", pc(d.yield)) + row("Dividend per share (latest year)", d.ttm ? `₹${fmt(d.ttm, 2)}` : "—") + row("Years paid in a row", `${d.streakYears}`) + row("5-yr dividend growth", d.cagr5 === null ? "—" : pc(d.cagr5)) + row("Payout of profit", d.payout === null ? "—" : pc(d.payout))}
          ${yrs.length > 1 ? `<div class="mini-bars" aria-label="Dividend per share by year">${yrs.map(([y, v]) => `<div title="FY${y}: ₹${fmt(v, 2)}"><i style="height:${Math.max(3, v / mx * 100)}%"></i><span>${String(y).slice(-2)}</span></div>`).join("")}</div>` : ""}
          <p class="hint">${esc(d.note || "")}${d.source ? ` · Source: ${esc(d.source)}` : ""}</p>`;
      } else divHtml += `<p class="hint">${esc(x.errors?.dividend || "No data yet.")}</p>`;
      // Swing overlay
      const t = x.technicals;
      let techHtml = `<h3>Swing overlay</h3><p class="xp">Short-term trend for timing a buy: 50/200-day averages, RSI and volume breakouts. The verdict above is about long-term value.</p>`;
      if (t && t.setup !== "No data") techHtml += `<p style="margin:0 0 8px"><span class="chip ${setupCls[t.setup] || "v-none"}">${esc(t.setup)}</span></p>
        ${row("Price vs 50-day / 200-day average", `${fmt(t.price)} vs ${fmt(t.sma50)} / ${fmt(t.sma200)}`)}${row("50-day above 200-day (golden cross)", t.goldenCross === null ? "—" : t.goldenCross ? `Yes${t.crossDaysAgo !== null ? ` · ${t.crossDaysAgo} days ago` : ""}` : "No")}${row("RSI (14)", `${fmt(t.rsi)}${Number.isFinite(t.rsi) ? (t.rsi >= 70 ? " · overbought" : t.rsi <= 30 ? " · oversold" : "") : ""}`)}${row("20-day breakout on volume", t.breakout20 ? "Yes" : "No")}${row("From 52-week high", Number.isFinite(t.pctFrom52wHigh) ? `${t.pctFrom52wHigh}%` : "—")}
        <p class="hint">Swing setup = 50-day above 200-day, RSI above 50 and price above its 50-day average. Source: ${esc(t.source || "—")}.</p>`;
      else techHtml += `<p class="hint">${esc(x.errors?.technicals || (t?.notes || ["No data yet."]).join(" "))}</p>`;
      // Peers: Screener's own peer table first, then the comparison with stocks you track
      const sp = x.screenerPeers, pr = x.peers;
      let peerHtml = "";
      if (rowFor(symbol)?.etf) peerHtml = `<h3>Compare</h3><p class="hint">For an ETF, compare its expense ratio and tracking error with other ETFs on the same index (shown on the AMC's factsheet and on NSE). Prefer the one with the lower cost and higher trading volume.</p>`;
      else if (sp?.rows?.length) {
        const heads = sp.headers.map(h => h.replace(/\s*Rs\.?\s*/g, " ₹ ").replace(/\s+/g, " ").trim());
        peerHtml = `<h3>Peer comparison <span class="hint">(as on Screener)</span></h3><p class="xp">Companies in the same industry, with Screener's own columns. Your stock is highlighted; the last row is the industry median.</p>
          <div class="table-wrap"><table class="peer-table"><thead><tr>${heads.map(h => `<th>${esc(h)}</th>`).join("")}<th>In this app</th></tr></thead><tbody>
          ${sp.rows.map(p => `<tr class="${p.self ? "peer-self" : ""}"${p.symbol && !p.self ? ` data-peer="${esc(p.symbol)}"` : ""}>${p.cells.map((c, i) => `<td>${i === 1 ? `<b>${esc(c)}</b>` : esc(c)}</td>`).join("")}<td>${p.verdict ? `<span class="chip ${esc(p.verdictCls)}">${esc(p.verdict)}</span>` : p.self ? "" : `<button type="button" class="ghost peer-val" data-peer="${esc(p.symbol || "")}">Value</button>`}</td></tr>`).join("")}
          ${sp.median ? `<tr class="peer-median">${sp.median.map(c => `<td>${esc(c)}</td>`).join("")}<td></td></tr>` : ""}</tbody></table></div>`;
      }
      if (pr?.available) {
        const m = pr.medians, me = pr.me, n = pr.count, q = me.quality;
        const cmp = (label, mine, med, beats, betterLow, f = v => fmt(v)) => Number.isFinite(mine) && Number.isFinite(med) ? `<li><b>${label}</b> ${f(mine)} vs ${f(med)} median: ${betterLow ? (mine <= med ? `cheaper than ${beats ?? 0}` : `pricier than ${n - (beats ?? 0)}`) : (mine >= med ? `better than ${beats ?? 0}` : `weaker than ${n - (beats ?? 0)}`)} of ${n}</li>` : "";
        peerHtml += `<div class="peer-mine"><h3>Versus the ${n} ${esc(pr.sector)} stocks you track <span class="chip ${pr.verdict.startsWith("Cheaper") ? "v-under" : pr.verdict.startsWith("Pricier") ? "v-rich" : "v-fair"}">${esc(pr.verdict)}</span></h3>
          <ul class="peer-facts">${cmp("P/E", me.pe, m.pe, pr.rank.cheaperPE, true)}${cmp("Price ÷ fair multiple", me.ratio, m.ratio, pr.rank.cheaperRatio, true, v => fmt(v, 2) + "×")}${cmp(me.quality !== null && pr.me ? "ROCE / ROE" : "Return on capital", q, m.quality, pr.rank.betterQuality, false, v => fmt(v) + "%")}${cmp("3-yr profit growth", me.profitCagr3, m.profitCagr3, pr.rank.fasterProfit, false, v => fmt(v) + "%")}</ul>
          ${sp?.rows?.length ? "" : `<div class="table-wrap"><table class="peer-table"><thead><tr><th>Name</th><th>CMP ₹</th><th>P/E</th><th>Mar Cap ₹ Cr</th><th>Div Yld %</th><th>ROCE / ROE %</th><th>Sales CAGR 3y %</th><th>Profit CAGR 3y %</th><th>Verdict</th></tr></thead><tbody>
          ${[me, ...pr.peers].map((p, i) => `<tr class="${i === 0 ? "peer-self" : ""}"${i ? ` data-peer="${esc(p.symbol)}"` : ""}><td><b>${esc(p.company)}</b> <small class="hint">${esc(p.symbol)}</small></td><td>${fmt(p.price)}</td><td>${fmt(p.pe)}</td><td>${p.marketCap ? Math.round(p.marketCap).toLocaleString("en-IN") : "—"}</td><td>${fmt(p.divYield)}</td><td>${fmt(p.quality)}</td><td>${fmt(p.salesCagr3)}</td><td>${fmt(p.profitCagr3)}</td><td>${p.verdict ? `<span class="chip ${esc(p.verdictCls)}">${esc(p.verdict)}</span>` : "—"}</td></tr>`).join("")}
          <tr class="peer-median"><td>Median of ${n}</td><td></td><td>${fmt(m.pe)}</td><td></td><td></td><td>${fmt(m.quality)}</td><td>${fmt(m.salesCagr3)}</td><td>${fmt(m.profitCagr3)}</td><td></td></tr></tbody></table></div>`}</div>`;
      } else if (!sp?.rows?.length) peerHtml = `<h3>Peer comparison</h3><p class="hint">${esc(pr?.note || "")}${x.errors?.screener ? ` Screener's peer table could not be loaded (${esc(x.errors.screener)}).` : ""}</p>`;
      box.innerHTML = `<div class="vs-cols"><div>${divHtml}</div><div>${techHtml}</div></div><div class="peer-wrap">${peerHtml}</div>`;
    } catch (e) { box.innerHTML = `<p class="hint">Could not load extras: ${esc(e.message)}</p>`; }
  }
  $("#vsResult").addEventListener("click", e => {
    const el = e.target.closest("[data-peer]"); if (!el || !el.dataset.peer) return;
    const sym = el.dataset.peer; if (rowFor(sym)) showResult(sym); else { $("#vsSymbol").value = sym; valueStock(sym, { symbol: sym, name: null, exchange: /^\d{6}$/.test(sym) ? "BSE" : "NSE" }); }
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  // ---- Portfolio health card -------------------------------------------------------------------------------
  async function renderHealth() {
    const box = $("#pfHealth"); if (!box) return;
    try {
      const h = await get("/api/portfolio/health");
      if (h.empty) { box.innerHTML = ""; return; }
      const list = (title, items) => `<div class="report-card"><h3>${title}</h3>${items.slice(0, 6).map(i => `<div class="row"><span>${esc(i.name)}</span><strong>${i.pct}%</strong></div><div class="hbar"><i style="width:${Math.min(100, i.pct)}%"></i></div>`).join("")}</div>`;
      const flagCls = { warn: "avoid", info: "wait", ok: "buy" };
      box.innerHTML = `<div class="report-card"><h3>Portfolio health</h3><ul class="flag-list">${h.flags.map(f => `<li><div class="${flagCls[f.level] || ""}">${esc(f.text)}</div></li>`).join("")}</ul>
        <p class="hint" style="margin-top:10px">Tilt by value held: Value ${h.tilt.value}% · Growth ${h.tilt.growth}% · Dividend ${h.tilt.dividend}% (a stock can be in several). Top 5 holdings: ${h.top5}%.</p></div>${list("By valuation", h.byVerdict)}${list("By sector", h.bySector)}${list("By market cap", h.byCap)}`;
    } catch { box.innerHTML = ""; }
  }

  // ---- Alerts -------------------------------------------------------------------------------------------------------
  let lastNotified = null;
  async function pollAlerts(render = false) {
    try {
      const a = await get("/api/alerts");
      const bc = $("#bellCount"); bc.textContent = a.unread > 99 ? "99+" : a.unread; bc.hidden = !a.unread;
      const maxId = Math.max(0, ...a.events.map(e => e.id || 0));
      if (lastNotified === null) lastNotified = maxId;
      else if (maxId > lastNotified && "Notification" in window && Notification.permission === "granted") {
        for (const e of a.events.filter(e => e.id > lastNotified && !e.read).slice(0, 3)) new Notification(e.title, { body: e.detail });
        lastNotified = maxId;
      } else lastNotified = Math.max(lastNotified, maxId);
      if (render) renderAlerts(a);
      return a;
    } catch {}
  }
  function renderAlerts(a) {
    $("#alList").innerHTML = a.events.length ? `<ul class="flag-list">${a.events.map(e => `<li class="al-item${e.read ? "" : " unread"}${String(e.type || "").startsWith("swing") ? ` ${esc(e.type)}` : ""}" data-sym="${esc(e.symbol)}" data-id="${e.id}" data-type="${esc(e.type || "")}" tabindex="0"><div class="fcompany">${e.type === "buy-zone" ? "🟢 " : String(e.type || "").startsWith("swing") ? "" : "🔄 "}${esc(e.title)}</div><div class="fnote">${esc(e.detail)} · ${new Date(e.at).toLocaleString("en-IN")}</div></li>`).join("")}</ul>` : '<p class="vs-empty">No alerts yet. The first check only records where every stock stands today; alerts appear when something changes after that.</p>';
  }
  window.openAlerts = () => { pollAlerts(true); const ok = "Notification" in window; $("#alNotify").hidden = !ok || Notification.permission === "granted"; };
  $("#bellBtn").onclick = () => setView("alerts");
  // Phone alerts through the user's own Telegram bot
  $("#alPhone").onclick = async () => {
    let st = {}; try { st = await get("/api/notify"); } catch {}
    const t = st.telegram || {};
    const state = () => t.connected ? `<p class="tg-state">✅ Connected to <b>@${esc(t.bot || "your bot")}</b> → ${esc(t.chat || "")}. ${t.enabled ? "On" : "Paused"}.${st.lastError ? ` <span class="avoid">Last error: ${esc(st.lastError)}</span>` : st.lastSent ? ` Last sent ${new Date(st.lastSent).toLocaleString("en-IN")}.` : ""}</p>` : "";
    const out = await window.ui.dialog({
      title: "Phone alerts on Telegram", icon: "📱", okText: t.connected ? "Save" : "Connect", wide: true,
      bodyHtml: `${t.connected ? "" : `<ol class="tg-steps"><li>In Telegram, open <b>@BotFather</b>, send <b>/newbot</b> and follow the two questions. It gives you a <b>token</b>.</li><li>Open your new bot (the link BotFather shows) and press <b>Start</b>.</li><li>Paste the token below and press Connect. The app finds your chat and sends a confirmation.</li></ol>`}
        <div class="nw-form"><label class="ui-field"><span>Bot token${t.connected ? ` (saved: ${esc(t.token)}; paste a new one to change)` : ""}</span><input class="ui-input" name="token" autocomplete="off" spellcheck="false" placeholder="123456789:AA…"></label>
        <label class="ui-field"><span>Send</span><select class="ui-input" name="scope"><option value="all">All alerts</option><option value="swing"${t.scope === "swing" ? " selected" : ""}>Swing only</option></select></label>
        ${t.connected ? `<label class="ui-field"><span>Status</span><select class="ui-input" name="enabled"><option value="1">On</option><option value="0"${t.enabled ? "" : " selected"}>Paused</option></select></label>` : ""}</div>
        ${state()}
        ${t.connected ? `<div class="toolbar" style="margin:10px 0 0"><button type="button" class="ghost" data-tg="test">Send a test</button><button type="button" class="ghost danger-text" data-tg="disconnect">Disconnect</button><span class="ui-hint" data-tgst></span></div>` : ""}
        <p class="ui-hint">The token stays on your server, in your account only, and is never shown in full again. Alerts are sent when they happen, even with the app closed (the server checks during market hours). Telegram is free; WhatsApp needs a paid business account, so it is not used.</p>`,
      onOpen: (box, { setError }) => box.querySelectorAll("[data-tg]").forEach(b => { b.onclick = async () => {
        setError(""); const st2 = box.querySelector("[data-tgst]"); st2.textContent = "…";
        try { await post(`/api/notify/${b.dataset.tg}`, {}); st2.textContent = b.dataset.tg === "test" ? "Sent. Check Telegram." : "Disconnected."; if (b.dataset.tg === "disconnect") setTimeout(() => box.closest(".ui-scrim")?.querySelector('[data-ui="cancel"]')?.click(), 600); }
        catch (e) { setError(e.message); st2.textContent = ""; }
      }; }),
      collect: async box => {
        const token = box.querySelector("[name=token]").value.trim(), scope = box.querySelector("[name=scope]").value;
        if (!t.connected || token) return post("/api/notify/connect", { token, scope });
        return post("/api/notify/settings", { scope, enabled: box.querySelector("[name=enabled]").value === "1" });
      }
    });
    if (out?.telegram) window.toast?.(out.telegram.enabled ? `Phone alerts on: @${out.telegram.bot} → ${out.telegram.chat}` : "Phone alerts paused.", { kind: "ok" });
  };
  $("#alMarkAll").onclick = async () => { await post("/api/alerts/read", { all: true }); pollAlerts(true); };
  $("#alNotify").onclick = async () => { const p = await Notification.requestPermission(); $("#alStatus").textContent = p === "granted" ? "Notifications on while this tab is open." : "Notifications were not allowed."; $("#alNotify").hidden = p === "granted"; };
  const openAlert = async li => { if (!li) return; await post("/api/alerts/read", { ids: [Number(li.dataset.id)] }); if (li.dataset.type.startsWith("swing")) { setView("swing"); pollAlerts(); return; } await loadValuation(); openStockSheet(li.dataset.sym, { back: "Back to Alerts" }); pollAlerts(); };
  $("#alList").addEventListener("click", e => openAlert(e.target.closest("li[data-sym]")));
  $("#alList").addEventListener("keydown", e => { if (e.key === "Enter") openAlert(e.target.closest("li[data-sym]")); });
  pollAlerts(); setInterval(pollAlerts, 60000);
  $("#viewAlerts").onclick = () => setView("alerts");
  $("#viewInvest").onclick = () => setView("invest");

  // ---- Where to invest ------------------------------------------------------------------------------------------------
  window.openInvest = () => {};
  $("#ivForm").addEventListener("submit", async e => {
    e.preventDefault();
    const st = $("#ivStatus"), btn = $("#ivBtn"); btn.disabled = true; status(st, "Working it out…");
    try {
      const x = await post("/api/allocate", { amount: Number($("#ivAmount").value), maxPerStockPct: Number($("#ivStock").value), maxPerSectorPct: Number($("#ivSector").value), maxPerStockAmount: Number($("#ivStockAmt").value) || null, tag: $("#ivTag").value, scope: $("#ivScope").value, symbols: $("#ivScope").value === "watchlist" && activeListSymbols ? [...activeListSymbols] : undefined });
      $("#ivRows").innerHTML = x.allocations.length ? x.allocations.map(a => `<tr data-sym="${esc(a.symbol)}"><td><div class="company">${esc(a.company)}</div><div class="ticker">${esc(a.symbol)} · ${esc(a.sector)}</div></td><td><span class="chip v-under">${esc(a.verdict)}</span></td><td>${money(a.price)}</td><td>${a.shares}</td><td><strong>${inr(a.amount)}</strong></td><td>${a.weightAfter}%</td><td>${a.upsideToBase === null ? "—" : `${a.upsideToBase >= 0 ? "+" : ""}${Math.round(a.upsideToBase * 100)}%`}</td></tr>`).join("") : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--muted)">No allocation.</td></tr>`;
      const spent = x.allocations.reduce((s, a) => s + a.amount, 0);
      $("#ivNote").textContent = `${x.candidates} stock(s) in their buy zone · ${inr(spent)} allocated · ${inr(x.leftover)} left as cash. ${x.portfolioValue ? `Caps are measured against your synced portfolio (${inr(x.portfolioValue)}) plus this amount.` : "No synced holdings, so caps are measured against this amount alone."} ${(x.notes || []).join(" ")}`;
      status(st, "");
    } catch (err) { status(st, `Failed: ${err.message}`); } finally { btn.disabled = false; }
  });
  $("#ivRows").addEventListener("click", async e => { const tr = e.target.closest("tr[data-sym]"); if (tr) openStockSheet(tr.dataset.sym, { back: "Back to Where to invest" }); });

  // ---- Named watchlists ---------------------------------------------------------------------------------------------
  let lists = [], activeListId = "default";
  try { activeListId = localStorage.getItem("equity-active-list") || "default"; } catch {}
  const listBy = id => lists.find(l => l.id === id);
  function applyActiveList() {
    if (!listBy(activeListId)) activeListId = "default";
    const l = listBy(activeListId); activeListSymbols = l ? new Set(l.symbols) : null;
    try { localStorage.setItem("equity-active-list", activeListId); } catch {}
  }
  function renderListBar() {
    const sel = $("#listSelect");
    sel.innerHTML = lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)} (${l.count ?? l.symbols.length})</option>`).join("");
    sel.value = activeListId;
    const l = listBy(activeListId); $("#listCount").textContent = l ? `${l.symbols.length} stock${l.symbols.length === 1 ? "" : "s"}${l.default ? " · default" : ""}` : "";
  }
  async function loadLists() { try { lists = (await get("/api/lists")).lists; applyActiveList(); renderListBar(); } catch {} }
  window.loadLists = loadLists;
  window.redrawAll = () => redrawAll();
  window.addEventListener("prices:updated", () => { if (!$("#homeView").hidden) loadSwingStrip(); });
  function redrawAll() {
    try { render(); renderValuation(); renderPicks(); renderGrowth(); renderRecent(); } catch (e) { console.error(e); }
    if (!$("#reportsView").hidden) try { renderDashboard(); } catch {}
    if (!$("#portfolioView").hidden) renderPortfolio();
  }
  $("#listSelect").onchange = () => { activeListId = $("#listSelect").value; applyActiveList(); renderListBar(); redrawAll(); };
  // New watchlist: name (with quick picks) + what to start with (empty, your holdings, or a copy of the current list)
  $("#listNew").onclick = async () => {
    let held = pf?.holdings?.map(h => h.symbol);
    if (!held) { try { held = (await get("/api/holdings")).holdings.map(h => h.symbol); } catch { held = []; } }
    const cur = listBy(activeListId), curSyms = cur?.symbols || [];
    const opt = (v, t, d, n, on) => `<label class="ui-opt"><input type="radio" name="nlStart" value="${v}"${on ? " checked" : ""}${n === 0 && v !== "empty" ? " disabled" : ""}><span><b>${t}</b><small>${d}${v !== "empty" ? ` · ${n} stock${n === 1 ? "" : "s"}` : ""}</small></span></label>`;
    const out = await ui.dialog({
      title: "Create a watchlist", icon: "✨", okText: "Create watchlist", wide: true,
      message: "Group the stocks you want to focus on. Every screen follows the watchlist you select.",
      bodyHtml: `<label class="ui-field"><span>Name</span><input type="text" class="ui-input" id="nlName" placeholder="e.g. Dividend picks" maxlength="40" autocomplete="off" autofocus></label>
        <div class="ui-chips">${["Dividend picks", "Small caps", "Banks & NBFCs", "Long term (10 yr)", "Swing trades", "New age tech"].map(c => `<button type="button" class="ui-chip" data-chip="${c}">${c}</button>`).join("")}</div>
        <p class="ui-sub">Start with</p><div class="ui-opts">${opt("empty", "Empty list", "Pick stocks next", null, true)}${opt("holdings", "My holdings", "Everything you hold across brokers", held.length, false)}${opt("copy", `Copy “${ui.esc(cur?.name || "current list")}”`, "Then trim it down", curSyms.length, false)}</div>`,
      onOpen: box => box.querySelectorAll("[data-chip]").forEach(b => { b.onclick = () => { box.querySelector("#nlName").value = b.dataset.chip; box.querySelector("#nlName").focus(); }; }),
      collect: async box => {
        const name = box.querySelector("#nlName").value.trim(); if (!name) throw new Error("Give the watchlist a name.");
        const start = box.querySelector('input[name="nlStart"]:checked')?.value || "empty";
        const symbols = start === "holdings" ? held : start === "copy" ? curSyms : [];
        const x = await post("/api/lists/create", { name, symbols }); // errors (duplicate name…) show inside the dialog
        return { x, start, count: symbols.length };
      }
    });
    if (!out) return;
    lists = out.x.lists; activeListId = out.x.created; applyActiveList(); renderListBar(); redrawAll();
    const nm = ui.esc(listBy(activeListId)?.name || "");
    if (!$("#listsView").hidden) { renderLists(); window.toast(`✓ Watchlist “${nm}” created${out.count ? ` with ${out.count} stocks` : ""}. Add stocks with the search box.`); $("#wlQ").focus(); }
    else window.toast(`✓ Watchlist “${nm}” created${out.count ? ` with ${out.count} stocks` : ""}`, { action: { label: "Open watchlist", fn: () => setView("lists") } });
  };
  $("#listManage").onclick = () => openListModal();

  // ---- Watchlists page: every list as a tab, its stocks with their numbers, add / move / remove in place ----
  let wlFilter = "all", wlSort = "upside";
  try { wlSort = localStorage.getItem("equity-wl-sort") || "upside"; } catch {}
  const WL_FILTERS = [["all", "All"], ["zone", "In buy zone"], ["buy", "Buy ideas"], ["growth", "Growth"], ["expensive", "Expensive"], ["none", "Not valued yet"]];
  const wlMatch = (f, r, c) => f === "all" ? true : f === "none" ? !r || !Number.isFinite(r.ratio) : !r ? false
    : f === "zone" ? r.status === "In zone" || r.status === "Below zone" : f === "buy" ? c.key === "buy" : f === "growth" ? (c.tags || []).some(t => /growth/i.test(t)) || /growth/i.test(c.label) : f === "expensive" ? c.key === "expensive" : true;
  function renderLists() {
    if ($("#listsView").hidden) return;
    const l = listBy(activeListId); if (!l) return;
    $("#wlTabs").innerHTML = lists.map(x => `<button type="button" role="tab" aria-selected="${x.id === l.id}" class="wl-tab${x.id === l.id ? " active" : ""}" data-wl="${esc(x.id)}">${x.default ? "⭐ " : ""}${esc(x.name)} <b>${x.symbols.length}</b></button>`).join("");
    $("#wlName").textContent = l.name;
    $("#wlRename").hidden = false; $("#wlDelete").hidden = !!l.default;
    const order = new Map(l.symbols.map((s, i) => [s, i]));
    const items = l.symbols.map(sym => { const r = rowFor(sym), st = stocks.find(x => symOfAny(x) === sym); const c = r ? classify(r) : { key: "none", label: "Not valued yet", cls: "v-none", tags: [] }; return { sym, r, st, c }; });
    const valued = items.filter(x => x.r && Number.isFinite(x.r.ratio));
    const inZone = valued.filter(x => x.r.status === "In zone" || x.r.status === "Below zone").length;
    const pes = valued.filter(x => x.r.pe > 0), hpe = pes.length ? pes.length / pes.reduce((a, x) => a + 1 / x.r.pe, 0) : null;
    $("#wlMeta").textContent = `${l.symbols.length} stock${l.symbols.length === 1 ? "" : "s"}${l.default ? " · your main watchlist" : ""} · used by Valuation, Picks and Reports while selected`;
    $("#wlCards").innerHTML = l.symbols.length ? `<div><span>Stocks</span><strong>${l.symbols.length}</strong></div><div><span>In buy zone now</span><strong>${inZone}</strong></div><div><span>Buy ideas</span><strong>${valued.filter(x => x.c.key === "buy").length}</strong></div><div><span>Typical P/E</span><strong>${hpe ? fmt(hpe) : "—"}</strong></div>` : "";
    $("#wlFilters").innerHTML = WL_FILTERS.map(([k, t]) => `<button type="button" class="pf-chip${wlFilter === k ? " active" : ""}" data-wlf="${k}">${t}<b>${items.filter(x => wlMatch(k, x.r, x.c)).length}</b></button>`).join("");
    $("#wlSort").value = wlSort;
    const gap = r => Number.isFinite(r?.gapToZone) ? r.gapToZone : Infinity, up = r => Number.isFinite(r?.upsideToBase) ? -r.upsideToBase : Infinity;
    const sorters = { upside: (a, b) => up(a.r) - up(b.r), zone: (a, b) => gap(a.r) - gap(b.r), pe: (a, b) => (a.r?.pe > 0 ? a.r.pe : Infinity) - (b.r?.pe > 0 ? b.r.pe : Infinity), name: (a, b) => String(a.r?.company || a.st?.company || a.sym).localeCompare(String(b.r?.company || b.st?.company || b.sym)), added: (a, b) => order.get(b.sym) - order.get(a.sym) };
    const shown = items.filter(x => wlMatch(wlFilter, x.r, x.c)).sort(sorters[wlSort] || sorters.upside);
    $("#wlRows").innerHTML = shown.length ? shown.map(({ sym, r, st, c }) => {
      const name = r?.company || st?.company || sym, ok = r && Number.isFinite(r.ratio);
      return `<tr data-sym="${esc(sym)}"><td><div class="company">${esc(name)}${r?.cap ? capTag(r.cap) : ""}</div><div class="ticker">${esc(sym)}${r?.sector ? ` · ${esc(r.sector)}` : ""}${st?.exchange === "BSE" ? " · BSE" : ""}</div></td>
        <td class="num">${money(r?.price ?? st?.price)}</td>
        <td class="num">${ok ? fmt(r.pe) : "—"}${Number.isFinite(r?.sectorPe ?? r?.sectorPeEst) ? `<div class="ticker">${r.sectorPe ? "" : "~"}${fmt(r.sectorPe ?? r.sectorPeEst)}</div>` : ""}</td>
        <td>${ok ? verdictChip(c) : `<span class="chip v-none">${r ? "Can't value yet" : "Fetching data…"}</span>`}</td>
        <td>${ok && r.zoneLow ? `${money(r.zoneLow)}–${money(r.zoneHigh)}<div>${statusChip(r.status)}</div>` : "—"}</td>
        <td class="num ${r?.upsideToBase > 0 ? "buy" : r?.upsideToBase < 0 ? "avoid" : ""}">${Number.isFinite(r?.upsideToBase) ? `${r.upsideToBase > 0 ? "+" : ""}${Math.round(r.upsideToBase * 100)}%` : "—"}</td>
        <td>${rangeBar(r?.low ?? st?.low, r?.high ?? st?.high, r?.price ?? st?.price) || "—"}</td>
        <td class="num">${Number.isFinite(r?.dividend?.yield) && r.dividend.yield > 0 ? `${fmt(r.dividend.yield)}%` : "—"}</td>
        <td class="wl-acts">${!ok ? `<button type="button" class="ghost" data-wl-retry="${esc(sym)}" title="Fetch its data again">⟳</button>` : ""}<button type="button" class="ghost" data-wl-move="${esc(sym)}" title="Copy or move to another watchlist">⇄</button><button type="button" class="ghost danger-text" data-wl-rm="${esc(sym)}" title="Remove from this watchlist">✕</button></td></tr>`;
    }).join("") : `<tr><td colspan="9" class="nw-empty-row">${l.symbols.length ? "No stock matches this filter." : `“${esc(l.name)}” is empty. Type a company name or NSE symbol in the box above to add stocks.`}</td></tr>`;
  }
  window.openLists = async () => { await Promise.all([loadLists(), loadValuation()]); renderLists(); };
  const wlStatus = t => { $("#wlStatus").textContent = t || ""; };
  async function wlAdd(it) {
    const l = listBy(activeListId); if (!l) return;
    if (l.symbols.includes(it.symbol)) { wlStatus(`${it.symbol} is already in “${l.name}”.`); return; }
    wlStatus(`Adding ${it.symbol}…`);
    try {
      const tracked = stocks.some(x => symOfAny(x) === it.symbol);
      if (tracked) await post("/api/lists/members", { id: l.id, add: [it.symbol] });
      else await post("/api/stocks/add", { symbol: it.symbol, company: it.name, exchange: it.exchange || "NSE", list: l.id, bucket: "Imported", action: "Watch", note: "Added from Watchlists." });
      await Promise.all([loadStocks(), loadLists()]); applyActiveList(); renderListBar(); renderLists();
      const st = stocks.find(x => symOfAny(x) === it.symbol), r = rowFor(it.symbol);
      if (st && (!r || !Number.isFinite(r.ratio))) {
        wlStatus(`${it.symbol} added. Fetching its P/E, growth and valuation…`);
        const x = await post("/api/fundamentals/fetch", { ids: [st.id], force: false, source: "auto" });
        await loadValuation(); renderLists(); redrawAll();
        const r0 = x.results?.[0];
        wlStatus(r0?.error ? (r0.rateLimited ? `${it.symbol} added. Data sources are busy (rate limit); it will be valued automatically in about 20 minutes.` : `${it.symbol} added, but its data could not be fetched: ${r0.error}`) : `${it.symbol} added and valued.`);
      } else wlStatus(`${it.symbol} added to “${l.name}”.`);
    } catch (e) { wlStatus(`Could not add ${it.symbol}: ${e.message}`); }
  }
  // search box on the Watchlists page (same suggestions as Value a stock)
  const wl = { items: [], active: -1, timer: null, seq: 0 };
  function wlDraw() {
    const dd = $("#wlDrop"), l = listBy(activeListId);
    dd.hidden = !wl.items.length && !wl.note;
    dd.innerHTML = wl.items.map((it, i) => `<button type="button" class="us-opt${i === wl.active ? " active" : ""}" data-i="${i}"><b>${esc(it.symbol)}</b> <span>${esc(it.name)}${it.exchange === "BSE" ? " · BSE" : ""}</span><em>${l?.symbols.includes(it.symbol) ? "✓ in list" : "+ add"}</em></button>`).join("") || `<div class="sg-empty">${esc(wl.note || "No match.")}</div>`;
  }
  $("#wlQ").addEventListener("input", () => {
    clearTimeout(wl.timer); const q = $("#wlQ").value.trim(); if (!q) { wl.items = []; wl.note = null; wlDraw(); return; }
    wl.timer = setTimeout(async () => { const my = ++wl.seq; try { const x = await get(`/api/search?q=${encodeURIComponent(q)}`); if (my !== wl.seq) return; wl.items = x.results || []; wl.note = x.note || (wl.items.length ? null : `No match. Press Enter to add “${q.toUpperCase()}” as an NSE symbol.`); wl.active = wl.items.length ? 0 : -1; wlDraw(); } catch {} }, 160);
  });
  $("#wlQ").addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { wl.active = Math.min(wl.items.length - 1, wl.active + 1); wlDraw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { wl.active = Math.max(0, wl.active - 1); wlDraw(); e.preventDefault(); }
    else if (e.key === "Escape") { wl.items = []; wl.note = null; wlDraw(); }
    else if (e.key === "Enter") {
      e.preventDefault(); const q = $("#wlQ").value.trim(); if (!q) return;
      const it = wl.items[wl.active] || (/^[A-Za-z0-9&-]{1,20}$/.test(q) ? { symbol: q.toUpperCase(), name: q.toUpperCase(), exchange: /^\d{6}$/.test(q) ? "BSE" : "NSE" } : null);
      if (it) { $("#wlQ").value = ""; wl.items = []; wl.note = null; wlDraw(); wlAdd(it); }
    }
  });
  $("#wlDrop").addEventListener("mousedown", e => { const b = e.target.closest("[data-i]"); if (!b) return; e.preventDefault(); const it = wl.items[Number(b.dataset.i)]; $("#wlQ").value = ""; wl.items = []; wl.note = null; wlDraw(); wlAdd(it); });
  $("#wlQ").addEventListener("blur", () => setTimeout(() => { wl.items = []; wl.note = null; wlDraw(); }, 150));
  $("#wlTabs").addEventListener("click", e => { const b = e.target.closest("[data-wl]"); if (!b) return; activeListId = b.dataset.wl; wlFilter = "all"; applyActiveList(); renderListBar(); renderLists(); redrawAll(); });
  $("#wlFilters").addEventListener("click", e => { const b = e.target.closest("[data-wlf]"); if (b) { wlFilter = b.dataset.wlf; renderLists(); } });
  $("#wlSort").onchange = () => { wlSort = $("#wlSort").value; try { localStorage.setItem("equity-wl-sort", wlSort); } catch {} renderLists(); };
  $("#wlNew").onclick = () => $("#listNew").click();
  $("#listOpen").onclick = () => setView("lists");
  $("#viewLists").onclick = () => setView("lists");
  $("#wlRename").onclick = async () => {
    const l = listBy(activeListId); const name = await ui.prompt({ title: "Rename watchlist", label: "Name", value: l.name, okText: "Rename", validate: v => v.length > 40 ? "Keep it under 40 characters." : null }); if (!name) return;
    try { lists = (await post("/api/lists/rename", { id: l.id, name })).lists; applyActiveList(); renderListBar(); renderLists(); } catch (e) { wlStatus(e.message); }
  };
  $("#wlDelete").onclick = async () => {
    const l = listBy(activeListId); if (!l || l.default) return;
    if (!(await ui.confirm({ title: `Delete “${l.name}”?`, message: "Only the list is deleted; the stocks stay tracked and in your other watchlists.", okText: "Delete watchlist", danger: true }))) return;
    try { lists = (await post("/api/lists/delete", { id: l.id })).lists; activeListId = "default"; applyActiveList(); renderListBar(); renderLists(); redrawAll(); } catch (e) { wlStatus(e.message); }
  };
  $("#wlRows").addEventListener("click", async e => {
    const rm = e.target.closest("[data-wl-rm]"), mv = e.target.closest("[data-wl-move]"), rt = e.target.closest("[data-wl-retry]");
    const l = listBy(activeListId);
    if (rm) { const sym = rm.dataset.wlRm; lists = (await post("/api/lists/members", { id: l.id, remove: [sym] })).lists; applyActiveList(); renderListBar(); renderLists(); redrawAll(); window.toast(`${esc(sym)} removed from “${esc(l.name)}”.`, { ms: 5000, action: { label: "Undo", fn: async () => { lists = (await post("/api/lists/members", { id: l.id, add: [sym] })).lists; applyActiveList(); renderListBar(); renderLists(); } } }); return; }
    if (rt) { const st = stocks.find(x => symOfAny(x) === rt.dataset.wlRetry); if (!st) return; rt.disabled = true; wlStatus(`Fetching ${rt.dataset.wlRetry}…`); try { const x = await post("/api/fundamentals/fetch", { ids: [st.id], force: true, source: "auto" }); await loadValuation(); renderLists(); const r0 = x.results?.[0]; wlStatus(r0?.error ? `${rt.dataset.wlRetry}: ${r0.rateLimited ? "data sources busy (rate limit), retrying automatically in ~20 min" : r0.error}` : `${rt.dataset.wlRetry} valued.`); } catch (err) { wlStatus(err.message); } return; }
    if (mv) {
      const sym = mv.dataset.wlMove, others = lists.filter(x => x.id !== l.id);
      if (!others.length) { window.toast("Create another watchlist first.", { kind: "warn", ms: 4000 }); return; }
      const out = await ui.dialog({ title: `Copy or move ${sym}`, icon: "⇄", okText: "Done",
        bodyHtml: `<div class="ui-opts">${others.map(x => `<label class="ui-opt"><input type="checkbox" value="${esc(x.id)}"${x.symbols.includes(sym) ? " checked disabled" : ""}><span><b>${esc(x.name)}</b><small>${x.symbols.length} stocks${x.symbols.includes(sym) ? " · already there" : ""}</small></span></label>`).join("")}</div>
          <label class="ui-opt" style="margin-top:12px"><input type="checkbox" name="moveOut"><span><b>Remove it from “${esc(l.name)}”</b><small>Move instead of copy</small></span></label>`,
        collect: box => ({ to: [...box.querySelectorAll(".ui-opts input:checked:not(:disabled)")].map(i => i.value), move: box.querySelector("[name=moveOut]").checked }) });
      if (!out) return;
      for (const id of out.to) lists = (await post("/api/lists/members", { id, add: [sym] })).lists;
      if (out.move) lists = (await post("/api/lists/members", { id: l.id, remove: [sym] })).lists;
      applyActiveList(); renderListBar(); renderLists(); redrawAll();
      if (out.to.length || out.move) window.toast(`✓ ${esc(sym)} ${out.move ? "moved" : "copied"}${out.to.length ? ` to ${out.to.map(id => esc(listBy(id)?.name || "")).join(", ")}` : ""}.`, { ms: 4000 });
      return;
    }
    const tr = e.target.closest("tr[data-sym]"); if (tr && rowFor(tr.dataset.sym)) openStockSheet(tr.dataset.sym, { back: `Back to ${listBy(activeListId)?.name || "watchlist"}` });
  });

  const lm = { modal: $("#listModal") };
  function lmRender() {
    const l = listBy(activeListId); if (!l) return;
    const q = ($("#lmSearch").value || "").toLowerCase(), only = $("#lmOnly").checked, inL = new Set(l.symbols);
    $("#lmTitle").textContent = `Choose stocks for “${l.name}”`;
    $("#lmSub").textContent = `${l.symbols.length} selected. Tick the stocks you want to focus on: every screen (Watchlist, Valuation, Picks, Plan lists, Reports) shows only this list. Stocks you value from the home screen join the selected list automatically.`;
    $("#lmDelete").disabled = !!l.default; $("#lmName").value = $("#lmName").dataset.for === l.id ? $("#lmName").value : l.name; $("#lmName").dataset.for = l.id;
    const pool = [...stocks].sort((a, b) => a.company.localeCompare(b.company)).filter(st => (!q || `${st.company} ${st.marketSymbol || st.ticker}`.toLowerCase().includes(q)) && (!only || inL.has(symOfAny(st))));
    $("#lmList").innerHTML = pool.length ? pool.map(st => { const sym = symOfAny(st), r = rowFor(sym); return `<label class="lm-row"><input type="checkbox" data-sym="${esc(sym)}"${inL.has(sym) ? " checked" : ""}><span class="lm-name"><b>${esc(st.company)}</b> <small>${esc(sym)}</small></span>${r && r.view && r.view !== "No fundamentals" ? verdictChip(classify(r)) : ""}</label>`; }).join("") : '<p class="hint">No stocks match.</p>';
  }
  function openListModal() { lm.modal.hidden = false; document.body.classList.add("modal-open"); $("#lmName").dataset.for = ""; $("#lmStatus").textContent = ""; lmRender(); }
  function closeListModal() { lm.modal.hidden = true; document.body.classList.remove("modal-open"); renderListBar(); redrawAll(); }
  $("#lmClose").onclick = closeListModal; lm.modal.onclick = e => { if (e.target === lm.modal) closeListModal(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !lm.modal.hidden) closeListModal(); });
  $("#lmSearch").oninput = lmRender; $("#lmOnly").onchange = lmRender;
  $("#lmList").addEventListener("change", async e => {
    const cb = e.target.closest("input[data-sym]"); if (!cb) return;
    try { lists = (await post("/api/lists/members", { id: activeListId, [cb.checked ? "add" : "remove"]: [cb.dataset.sym] })).lists; applyActiveList(); $("#lmSub").textContent = `${listBy(activeListId).symbols.length} selected.`; renderListBar(); }
    catch (err) { $("#lmStatus").textContent = err.message; cb.checked = !cb.checked; }
  });
  $("#lmRename").onclick = async () => { try { lists = (await post("/api/lists/rename", { id: activeListId, name: $("#lmName").value })).lists; applyActiveList(); renderListBar(); lmRender(); $("#lmStatus").textContent = "Renamed."; } catch (e) { $("#lmStatus").textContent = e.message; } };
  $("#lmDelete").onclick = async () => {
    const l = listBy(activeListId); if (!l || l.default || !(await ui.confirm({ title: `Delete “${l.name}”?`, message: "Only the list is removed; its stocks stay tracked and valued.", okText: "Delete watchlist", danger: true }))) return;
    try { lists = (await post("/api/lists/delete", { id: l.id })).lists; activeListId = "default"; applyActiveList(); renderListBar(); closeListModal(); } catch (e) { $("#lmStatus").textContent = e.message; }
  };
  $("#lmAddSym").onclick = async () => { const sym = await ui.prompt({ title: "Add a stock to this watchlist", message: "It is valued straight away and added to the selected list.", label: "Company name, NSE symbol or BSE code", placeholder: "e.g. Titan, INDIGO, 544252", okText: "Add & value", icon: "➕" }); if (!sym) return; closeListModal(); setView("home"); $("#vsSymbol").value = sym; valueStock(sym); };

  // ---- Screens sub-nav (Value / Growth / Dividend) -------------------------------------------------------------------
  document.querySelectorAll(".screen-nav [data-screen]").forEach(b => { b.onclick = () => setView(b.dataset.screen); });
  $("#viewDividends").onclick = () => setView("dividends");

  // ---- Dividend income planner ---------------------------------------------------------------------------------------
  let dv = null, dvSaveTimer = null, dvPick = null, dvPoll = null, dvTries = 0;
  const dvSafetyCls = { Safe: "v-under", Watch: "v-rich1", "At risk": "v-rich", None: "v-none" };
  const pct1 = v => (Number.isFinite(v) ? `${fmt(v)}%` : "—");
  function dvRender() {
    const x = dv; if (!x) return;
    const t = x.totals, st = x.settings;
    $("#dvCards").innerHTML = `<div><span>Annual dividend income</span><strong>${inr(t.annualIncome)}</strong></div><div><span>Average per month</span><strong>${inr(t.monthlyAvg)}</strong></div><div><span>Portfolio yield</span><strong>${pct1(t.yield)}</strong></div><div><span>Paying stocks</span><strong>${t.payers} <small style="font-size:14px;color:var(--muted)">of ${x.rows.length}</small></strong></div>`;
    const prog = t.progress ?? 0, yrs = x.projection.reachedInYears;
    $("#dvTarget").innerHTML = st.targetMonthly > 0 ? `<div class="dv-tgt-top"><div><span class="hint">Monthly income vs target</span><div class="dv-tgt-num">${inr(t.monthlyAvg)} <small>of ${inr(st.targetMonthly)} / month</small></div></div><div class="dv-tgt-pct">${Math.round(prog * 100)}%</div></div>
      <div class="dv-bar"><i style="width:${Math.max(1, prog * 100)}%"></i></div>
      <p class="hint" style="margin:8px 0 0">${yrs === 0 ? "Target already reached." : yrs ? `At ${inr(st.monthlyContribution)}/month invested at ${st.newMoneyYield}% yield, ${st.dividendGrowth}% yearly dividend growth${st.reinvest ? " and dividends reinvested" : ""}, you reach the target in about <b>${yrs} year${yrs === 1 ? "" : "s"}</b>.` : "Not reached within 30 years at these settings: raise the monthly investment or the yield."} Corpus needed at ${st.newMoneyYield}% yield: <b>${inr(x.projection.corpusNeeded)}</b>.</p>` : "";
    for (const [id, k] of [["#dvTargetIn", "targetMonthly"], ["#dvContrib", "monthlyContribution"], ["#dvGrowth", "dividendGrowth"], ["#dvNewYield", "newMoneyYield"]]) if (document.activeElement !== $(id)) $(id).value = st[k];
    $("#dvReinvest").checked = !!st.reinvest;
    const hide = $("#dvHideZero").checked;
    const rows = x.rows.filter(r => !hide || r.pending || r.annual > 0 || r.dpsSource === "yours");
    $("#dvRows").innerHTML = rows.length ? rows.map(r => `<tr data-sym="${esc(r.symbol)}"${r.annual > 0 || r.pending ? "" : ' class="dv-zero"'}>
      <td><div class="company">${esc(r.company)}</div><div class="ticker">${esc(r.symbol)}${r.exchange === "BSE" ? " · BSE" : ""}${r.held !== null ? ` · you hold ${r.held}` : ""}</div></td>
      <td><input class="dv-in" data-f="shares" type="number" min="0" step="1" value="${r.shares}" aria-label="Shares of ${esc(r.symbol)}"></td>
      <td>${money(r.price)}</td>
      <td><input class="dv-in" data-f="dpsOverride" type="number" min="0" step="0.01" value="${Number.isFinite(r.dps) ? r.dps : ""}" placeholder="${r.pending ? "fetching…" : r.dataError ? "enter it" : "—"}" title="${esc(r.dataError || "")}" aria-label="Dividend per share of ${esc(r.symbol)}"><div class="ticker">${esc(r.dpsSource)}</div></td>
      <td>${pct1(r.yield)}</td><td><strong>${inr(r.annual)}</strong></td><td>${inr(r.monthly)}</td>
      <td>${r.safety ? `<span class="chip ${dvSafetyCls[r.safety] || "v-none"}" title="${esc(r.note || "")}">${esc(r.safety === "None" ? "No dividend" : r.safety)}</span>` : r.pending ? '<span class="hint">loading…</span>' : "—"}</td>
      <td>${r.streakYears ?? "—"}</td><td>${pct1(r.cagr5)}</td>
      <td class="dv-months">${r.payMonths.length ? r.payMonths.map(m => `<span>${m}</span>`).join("") : "—"}</td>
      <td><button type="button" class="ghost" data-rm="${esc(r.symbol)}" aria-label="Remove ${esc(r.symbol)}">Remove</button></td></tr>`).join("")
      : `<tr><td colspan="12" style="text-align:center;padding:24px;color:var(--muted)">${x.rows.length ? "No paying stocks shown. Untick “Hide non-payers” to see all." : "No dividend stocks yet. Add one above, import your holdings, or pick from the ideas below."}</td></tr>`;
    const max = Math.max(1, ...x.calendar.map(c => c.amount));
    $("#dvCalendar").innerHTML = x.calendar.map(c => `<div class="dv-col${c.amount === max && c.amount > 0 ? " top" : ""}" title="${c.month}: ${inr(c.amount)}"><span class="dv-amt">${c.amount ? inr(c.amount) : ""}</span><i style="height:${Math.max(2, c.amount / max * 100)}%"></i><span class="dv-m">${c.month}</span></div>`).join("");
    const ys = x.projection.years.slice(0, 20), target = st.targetMonthly, pm = Math.max(target, ...ys.map(y => y.monthly), 1);
    $("#dvProjNote").textContent = `Projected income per month, year by year (${st.reinvest ? "reinvesting" : "not reinvesting"} dividends). The line is your target.`;
    $("#dvProj").innerHTML = `<div class="dv-proj-bars">${target > 0 ? `<div class="dv-line" style="bottom:${target / pm * 100}%"><span>${inr(target)}</span></div>` : ""}${ys.map(y => `<div class="dv-pcol${target > 0 && y.monthly >= target ? " hit" : ""}" title="Year ${y.year}: ${inr(y.monthly)}/month · ${inr(y.contributed)} invested"><i style="height:${Math.max(1, y.monthly / pm * 100)}%"></i><span>${y.year}</span></div>`).join("")}</div>`;
    $("#dvIdeas").innerHTML = x.ideas.length ? `<div class="table-wrap"><table style="min-width:0"><thead><tr><th>Stock</th><th>Price</th><th>Dividend / share</th><th>Yield</th><th>Safety</th><th>Years paid</th><th>Valuation verdict</th><th></th></tr></thead><tbody>${x.ideas.map(i => `<tr><td><div class="company">${esc(i.company)}</div><div class="ticker">${esc(i.symbol)}</div></td><td>${money(i.price)}</td><td>${money(i.dps)}</td><td><strong>${pct1(i.yield)}</strong></td><td><span class="chip ${dvSafetyCls[i.safety]}">${esc(i.safety)}</span></td><td>${i.streakYears}</td><td>${i.verdict ? `<span class="chip ${esc(i.verdictCls)}">${esc(i.verdict)}</span>` : "—"}</td><td><button type="button" class="ghost" data-idea="${esc(i.symbol)}" data-ex="${esc(i.exchange || "NSE")}">+ Add</button></td></tr>`).join("")}</tbody></table></div>`
      : `<p class="hint">${x.dividendDataCount ? "No tracked stock with a Safe or Watch dividend outside your plan." : "Dividend history is fetched when you value a stock or add it here; ideas appear once a few tracked stocks have it."}</p>`;
    $("#dvStatus").textContent = x.cooling ? "Yahoo is rate-limiting dividend requests; trying again in a few minutes." : x.pendingData ? `Fetching dividend history for ${x.pendingData} stock(s)…` : "";
    clearTimeout(dvPoll); if (x.pendingData && !$("#divView").hidden && dvTries++ < 15) dvPoll = setTimeout(dvLoad, 6000);
  }
  async function dvLoad() { try { dv = await get("/api/dividend-plan"); dvRender(); dgRender(); } catch (e) { $("#dvStatus").textContent = `Could not load the planner: ${e.message}`; } }
  window.openDividends = () => { dvTries = 0; return dvLoad(); };
  const dvSave = (body, msg = "Saved") => post("/api/dividend-plan", body).then(x => { dv = x; dvRender(); dgRender(); $("#dvSaveStatus").textContent = msg; setTimeout(() => { $("#dvSaveStatus").textContent = ""; }, 1500); }).catch(e => { $("#dvSaveStatus").textContent = `Not saved: ${e.message}`; });
  const dvSettings = () => ({ targetMonthly: Number($("#dvTargetIn").value), monthlyContribution: Number($("#dvContrib").value), dividendGrowth: Number($("#dvGrowth").value), newMoneyYield: Number($("#dvNewYield").value), reinvest: $("#dvReinvest").checked });
  for (const id of ["#dvTargetIn", "#dvContrib", "#dvGrowth", "#dvNewYield"]) $(id).addEventListener("input", () => { clearTimeout(dvSaveTimer); dvSaveTimer = setTimeout(() => dvSave({ settings: dvSettings() }), 450); });
  $("#dvReinvest").onchange = () => dvSave({ settings: dvSettings() });
  $("#dvHideZero").onchange = dvRender;
  const dvRowsBody = () => dv.rows.map(r => ({ symbol: r.symbol, exchange: r.exchange, shares: r.shares, dpsOverride: r.dpsOverride }));
  $("#dvRows").addEventListener("change", e => {
    const inp = e.target.closest(".dv-in"); if (!inp) return;
    const sym = inp.closest("tr").dataset.sym, rows = dvRowsBody(), row = rows.find(r => r.symbol === sym);
    if (inp.dataset.f === "shares") row.shares = Number(inp.value) || 0;
    else { const auto = dv.rows.find(r => r.symbol === sym); row.dpsOverride = inp.value === "" || (auto && auto.dpsSource !== "yours" && Number(inp.value) === auto.dps) ? null : Number(inp.value); }
    dvSave({ rows });
  });
  $("#dvRows").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) dvSave({ rows: dvRowsBody().filter(r => r.symbol !== b.dataset.rm) }, `Removed ${b.dataset.rm}`); });
  async function dvAddStock(symbol, exchange, name, shares) {
    const st = $("#dvStatus"), btn = $("#dvAdd"); btn.disabled = true; btn.classList.add("is-loading"); st.textContent = `Adding ${symbol} and fetching its dividend history…`;
    try { dv = await post("/api/dividend-plan/add", { symbol, exchange, name, shares }); dvRender(); window.toast(`✓ ${esc(symbol)} added to your dividend planner`); $("#dvSym").value = ""; $("#dvShares").value = ""; dvPick = null; }
    catch (e) { st.textContent = `Could not add: ${e.message}`; } finally { btn.disabled = false; btn.classList.remove("is-loading"); }
  }
  $("#dvAdd").onclick = () => { const q = $("#dvSym").value.trim(); if (!q && !dvPick) { $("#dvStatus").textContent = "Type a stock name or symbol first."; return; } const p = dvPick || { symbol: q.toUpperCase(), exchange: /^\d{6}$/.test(q) ? "BSE" : "NSE", name: null }; dvAddStock(p.symbol, p.exchange, p.name, Number($("#dvShares").value) || 0); };
  $("#dvIdeas").addEventListener("click", e => { const b = e.target.closest("[data-idea]"); if (b) dvAddStock(b.dataset.idea, b.dataset.ex, null, 0); });
  $("#dvImport").onclick = async () => { const b = $("#dvImport"); b.classList.add("is-loading"); b.disabled = true; try { const x = await post("/api/dividend-plan/import-holdings"); dv = x; dvRender(); window.toast(`✓ Imported ${x.imported} holdings. Dividend data is loading.`); } catch (e) { $("#dvStatus").textContent = e.message; } finally { b.classList.remove("is-loading"); b.disabled = false; } };
  $("#dvRefresh").onclick = async () => { await post("/api/dividend-plan/refresh"); $("#dvStatus").textContent = "Refreshing dividend history in the background…"; setTimeout(dvLoad, 8000); };
  // small search dropdown for the planner
  let dvTimer = null; const dvDrop = $("#dvDrop");
  $("#dvSym").addEventListener("input", () => { dvPick = null; clearTimeout(dvTimer); const q = $("#dvSym").value.trim(); if (!q) { dvDrop.hidden = true; return; }
    dvTimer = setTimeout(async () => { try { const x = await get(`/api/search?q=${encodeURIComponent(q)}`); dvDrop.innerHTML = (x.results || []).slice(0, 8).map((it, i) => `<div class="sg-item" data-i="${i}" role="option"><div class="sg-main"><div class="sg-name">${esc(it.name)}</div><div class="sg-meta"><b>${esc(it.symbol)}</b> · <span class="sg-ex ${it.exchange === "BSE" ? "bse" : ""}">${esc(it.exchange)}</span>${Number.isFinite(it.price) ? ` · ${money(it.price)}` : ""}</div></div></div>`).join("") || '<div class="sg-empty">No match: press Add to try it as a symbol.</div>'; dvDrop.hidden = false; dvDrop._items = x.results || []; } catch {} }, 160); });
  dvDrop.addEventListener("click", e => { const el = e.target.closest(".sg-item"); if (!el) return; const it = dvDrop._items[Number(el.dataset.i)]; dvPick = { symbol: it.symbol, exchange: it.exchange, name: it.name }; $("#dvSym").value = `${it.name} (${it.symbol})`; dvDrop.hidden = true; $("#dvShares").focus(); });
  document.addEventListener("click", e => { if (!e.target.closest(".dv-search")) dvDrop.hidden = true; });

  // ---- Goal planner tab ----------------------------------------------------------------------------------------------
  const DG_HELP = { equalDiv: "Each stock contributes the same income.", equalCap: "The same amount of money goes into each stock.", yieldWeighted: "More money goes to higher-yield stocks." };
  const DG_PALETTE = ["#f2b53c", "#4fd8b6", "#5c9df2", "#ef6f9e", "#6bd08a", "#a985f5", "#f2925f", "#5cd3ea", "#e17be0", "#f4d35e", "#4fbf8f", "#7aa8f7", "#f08a8a", "#c084fc", "#34d399"];
  let dgTimer = null, dgPick = null;
  document.querySelectorAll("[data-dvtab]").forEach(b => { b.onclick = () => { const g = b.dataset.dvtab === "goal"; $("#dvGoal").hidden = !g; $("#dvMine").hidden = g; document.querySelectorAll("[data-dvtab]").forEach(x => x.classList.toggle("active", x === b)); try { localStorage.setItem("equity-dvtab", b.dataset.dvtab); } catch {} }; });
  try { if (localStorage.getItem("equity-dvtab") === "goal") document.querySelector('[data-dvtab="goal"]').click(); } catch {}
  const dgBody = () => dv.goal.candidates.map(c => ({ symbol: c.symbol, name: c.name, price: c.price, div: c.div, sel: c.sel, priceManual: c.priceManual, divManual: c.divManual }));
  const dgSave = (goal, msg = "Saved") => post("/api/dividend-plan", { goal }).then(x => { dv = x; dgRender(); $("#dgSave").textContent = msg; setTimeout(() => { $("#dgSave").textContent = ""; }, 1500); }).catch(e => { $("#dgSave").textContent = `Not saved: ${e.message}`; });
  const dgGoalOf = over => ({ monthlyGoal: Number($("#dgGoal").value) || 0, method: $("#dgMethod").value, candidates: dgBody(), ...over });
  function dgRender() {
    if (!dv?.goal) return;
    const g = dv.goal, p = g.plan, nSel = g.candidates.filter(c => c.sel).length;
    if (document.activeElement !== $("#dgGoal")) $("#dgGoal").value = g.monthlyGoal;
    $("#dgMethod").value = g.method; $("#dgMethodHelp").textContent = DG_HELP[g.method];
    $("#dgCards").innerHTML = `<div><span>Annual goal</span><strong>${inr(p.annualGoal)}</strong></div><div><span>Estimated capital</span><strong style="color:var(--saffron)">${inr(p.totalCap)}</strong></div><div><span>Blended yield</span><strong>${fmt(p.blendedYield, 2)}%</strong></div><div><span>Selected</span><strong>${nSel}<small style="font-size:14px;color:var(--muted)"> / ${p.max}</small></strong></div>`;
    const srcTag = s => `<span class="src src-${s.split(" ")[0]}">${s === "last 12 months" ? "live" : s}</span>`;
    $("#dgRows").innerHTML = g.candidates.map(c => `<tr data-sym="${esc(c.symbol)}"${c.sel ? ' class="dg-sel"' : ""}>
      <td><input type="checkbox" data-f="sel" ${c.sel ? "checked" : ""} ${!c.sel && nSel >= p.max ? "disabled" : ""} aria-label="Select ${esc(c.symbol)}"></td>
      <td><div class="company">${esc(c.name)}</div><div class="ticker">${esc(c.symbol)}</div></td>
      <td><input class="dv-in" data-f="price" type="number" min="0" step="0.5" value="${c.price}"> ${srcTag(c.priceSource)}</td>
      <td><input class="dv-in" data-f="div" type="number" min="0" step="0.1" value="${c.div}"> ${srcTag(c.divSource)}</td>
      <td><strong>${fmt(c.yield, 2)}%</strong></td>
      <td>${c.safety ? `<span class="chip ${dvSafetyCls[c.safety] || "v-none"}">${esc(c.safety === "None" ? "No dividend" : c.safety)}</span>` : '<span class="hint">—</span>'}</td>
      <td><button type="button" class="ghost" data-rm="${esc(c.symbol)}" aria-label="Remove ${esc(c.symbol)}">✕</button></td></tr>`).join("");
    $("#dgOut").hidden = !p.rows.length;
    $("#dgPlan").innerHTML = p.rows.map(r => `<tr><td><b>${esc(r.symbol)}</b><div class="ticker">${esc(r.name)}</div></td><td>${r.shares.toLocaleString("en-IN")}</td><td>${inr(r.capital)}</td><td>${inr(r.annualDiv)}</td><td>${inr(r.monthly)}</td></tr>`).join("") + (p.rows.length ? `<tr class="dg-total"><td>Total</td><td></td><td>${inr(p.totalCap)}</td><td>${inr(p.totalDiv)}</td><td>${inr(Math.round(p.totalDiv / 12))}</td></tr>` : "");
    let acc = 0; const stops = p.rows.map((r, i) => { const pc = p.totalCap ? r.capital / p.totalCap * 100 : 0; const st = `${DG_PALETTE[i % 15]} ${acc.toFixed(2)}% ${(acc + pc).toFixed(2)}%`; acc += pc; return st; });
    $("#dgDonut").style.background = stops.length ? `conic-gradient(${stops.join(",")})` : "var(--mute-bg)";
    $("#dgDonut").setAttribute("aria-label", `Capital allocation: ${p.rows.map(r => `${r.symbol} ${(p.totalCap ? r.capital / p.totalCap * 100 : 0).toFixed(1)}%`).join(", ")}`);
    $("#dgDonutCap").textContent = inr(p.totalCap);
    $("#dgLegend").innerHTML = p.rows.map((r, i) => `<div><span class="dot" style="background:${DG_PALETTE[i % 15]}"></span><b>${esc(r.symbol)}</b> <span class="hint">${(p.totalCap ? r.capital / p.totalCap * 100 : 0).toFixed(1)}% · ${inr(r.capital)}</span></div>`).join("");
  }
  $("#dgGoal").addEventListener("input", () => { clearTimeout(dgTimer); dgTimer = setTimeout(() => dgSave(dgGoalOf()), 400); });
  $("#dgMethod").onchange = () => dgSave(dgGoalOf());
  $("#dgRows").addEventListener("change", e => {
    const inp = e.target.closest("input[data-f]"); if (!inp) return;
    const sym = inp.closest("tr").dataset.sym, cands = dgBody(), c = cands.find(x => x.symbol === sym);
    if (inp.dataset.f === "sel") c.sel = inp.checked;
    else { c[inp.dataset.f] = Number(inp.value) || 0; c[inp.dataset.f === "price" ? "priceManual" : "divManual"] = true; }
    dgSave(dgGoalOf({ candidates: cands }));
  });
  $("#dgRows").addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (b) dgSave(dgGoalOf({ candidates: dgBody().filter(c => c.symbol !== b.dataset.rm) }), `Removed ${b.dataset.rm}`); });
  $("#dgTop").onclick = () => { const order = [...dv.goal.candidates].filter(c => c.price > 0 && c.div > 0).sort((a, b) => b.div / b.price - a.div / a.price).slice(0, 15).map(c => c.symbol); dgSave(dgGoalOf({ candidates: dgBody().map(c => ({ ...c, sel: order.includes(c.symbol) })) }), "Top 15 by yield selected"); };
  $("#dgMine").onclick = () => { const have = new Set(dv.goal.candidates.map(c => c.symbol)); const add = dv.rows.filter(r => !have.has(r.symbol) && Number.isFinite(r.price) && r.dps > 0).map(r => ({ symbol: r.symbol, name: r.company, price: r.price, div: r.dps, sel: false, priceManual: false, divManual: r.dpsSource === "yours" })); if (!add.length) { $("#dgSave").textContent = "No new paying stocks in My dividend income."; return; } dgSave(dgGoalOf({ candidates: [...dgBody(), ...add] }), `Added ${add.length} stock(s)`); };
  $("#dgReset").onclick = async () => { if (await ui.confirm({ title: "Reset to the starter list?", message: "Your list is replaced with the 19 starter dividend stocks.", okText: "Reset list", danger: true })) dgSave({ monthlyGoal: Number($("#dgGoal").value) || 100000, method: $("#dgMethod").value, candidates: null }, "Starter list restored"); };
  $("#dgCsv").onclick = () => {
    const rows = dv?.goal?.plan?.rows || []; if (!rows.length) { $("#dgSave").textContent = "Select at least one stock first."; return; }
    const lines = [["Symbol", "Company", "Price", "DividendPerShare", "Shares", "Capital", "AnnualDividend", "MonthlyDividend"], ...rows.map(r => [r.symbol, `"${String(r.name).replace(/"/g, '""')}"`, r.price, r.div, r.shares, r.capital, r.annualDiv, r.monthly])];
    const url = URL.createObjectURL(new Blob([lines.map(l => l.join(",")).join("\n")], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = "dividend_plan.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  // add a stock: search suggestions, or a typed symbol with optional price / dividend
  const dgDrop = $("#dgDrop"); let dgSTimer = null;
  $("#dgSym").addEventListener("input", () => { dgPick = null; clearTimeout(dgSTimer); const q = $("#dgSym").value.trim(); if (!q) { dgDrop.hidden = true; return; }
    dgSTimer = setTimeout(async () => { try { const x = await get(`/api/search?q=${encodeURIComponent(q)}`); dgDrop._items = x.results || []; dgDrop.innerHTML = dgDrop._items.slice(0, 8).map((it, i) => `<div class="sg-item" data-i="${i}" role="option"><div class="sg-main"><div class="sg-name">${esc(it.name)}</div><div class="sg-meta"><b>${esc(it.symbol)}</b> · ${esc(it.exchange)}${Number.isFinite(it.price) ? ` · ${money(it.price)}` : ""}</div></div></div>`).join("") || '<div class="sg-empty">No match: type price and dividend and press Add.</div>'; dgDrop.hidden = false; } catch {} }, 160); });
  dgDrop.addEventListener("click", e => { const el = e.target.closest(".sg-item"); if (!el) return; const it = dgDrop._items[Number(el.dataset.i)]; dgPick = it; $("#dgSym").value = `${it.name} (${it.symbol})`; if (Number.isFinite(it.price)) $("#dgPrice").value = it.price; dgDrop.hidden = true; });
  document.addEventListener("click", e => { if (!e.target.closest("#dgSym, #dgDrop")) dgDrop.hidden = true; });
  $("#dgAdd").onclick = () => {
    const sym = (dgPick?.symbol || $("#dgSym").value.trim()).toUpperCase(), price = Number($("#dgPrice").value) || 0, div = Number($("#dgDiv").value) || 0;
    if (!/^[A-Z0-9&-]{1,20}$/.test(sym)) { $("#dgSave").textContent = "Pick a suggestion or type a symbol."; return; }
    if (dv.goal.candidates.some(c => c.symbol === sym)) { $("#dgSave").textContent = `${sym} is already in the list.`; return; }
    const nSel = dv.goal.candidates.filter(c => c.sel).length;
    dgSave(dgGoalOf({ candidates: [...dgBody(), { symbol: sym, name: dgPick?.name || sym, price, div, sel: nSel < 15, priceManual: price > 0 && !dgPick?.tracked, divManual: div > 0 }] }), `Added ${sym}`);
    $("#dgSym").value = ""; $("#dgPrice").value = ""; $("#dgDiv").value = ""; dgPick = null;
  };

  // ---- Focus list -----------------------------------------------------------------------------------------------------
  let fc = null, fcFilter = "all";
  const FC_CLS = { Accumulate: "v-under", Hold: "v-fair", Trim: "v-rich1", Exit: "v-rich", Review: "v-none" };
  const scoreBar = v => Number.isFinite(v) ? `<div class="fc-score"><b>${v}</b><span><i style="width:${v}%"></i></span></div>` : "—";
  function fcRender() {
    if (!fc) return;
    const c = fc.counts;
    $("#fcCards").innerHTML = `<div><span>Accumulate</span><strong class="buy">${c.Accumulate}</strong></div><div><span>Hold</span><strong>${c.Hold}</strong></div><div><span>Trim</span><strong class="wait">${c.Trim}</strong></div><div><span>Exit / review</span><strong class="avoid">${c.Exit}<small style="font-size:14px;color:var(--muted)"> / ${c.Review}</small></strong></div>`;
    $("#fcFilters").innerHTML = [["all", "All"], ["focus", `Top ${fc.n}`], ["Accumulate", "Accumulate"], ["Hold", "Hold"], ["Trim", "Trim"], ["Exit", "Exit"], ["Review", "Review"]].map(([k, l]) => `<button type="button" class="pf-chip${fcFilter === k ? " active" : ""}" data-fc="${k}">${l}<b>${k === "all" ? fc.rows.length : k === "focus" ? fc.rows.filter(r => r.inFocus).length : c[k]}</b></button>`).join("");
    const rows = fc.rows.filter(r => fcFilter === "all" || (fcFilter === "focus" ? r.inFocus : r.action === fcFilter));
    $("#fcRows").innerHTML = rows.length ? rows.map(r => `<tr data-sym="${esc(r.symbol)}"${r.rank && r.rank === fc.n ? ' class="fc-cut"' : ""}>
      <td>${r.rank ?? "—"}</td><td><div class="company">${esc(r.company)}</div><div class="ticker">${esc(r.symbol)}${r.verdict ? ` · ${esc(r.verdict)}` : ""}</div></td>
      <td><span class="chip ${FC_CLS[r.action]}">${esc(r.action)}</span></td><td>${scoreBar(r.score)}</td><td>${r.quality ?? "—"}</td><td>${r.view ? `${viewChip(r.view)} <small class="hint">${r.valuation}</small>` : "—"}</td>
      <td>${Number.isFinite(r.weightPct) ? `${r.weightPct}%` : "—"}${Number.isFinite(r.targetPct) ? ` → <b>${r.targetPct}%</b>` : ""}</td>
      <td>${Number.isFinite(r.move) && Math.abs(r.move) >= 500 ? `<span class="${r.move > 0 ? "buy" : "avoid"}">${r.move > 0 ? "Add" : "Reduce"} ${inr(Math.abs(r.move))}</span>` : "—"}</td>
      <td class="kpi">${esc(r.why)}${r.strengths?.length ? `<div class="fc-tags">${r.strengths.map(t => `<span class="fc-plus">+ ${esc(t)}</span>`).join("")}${(r.concerns || []).map(t => `<span class="fc-minus">− ${esc(t)}</span>`).join("")}</div>` : r.concerns?.length ? `<div class="fc-tags">${r.concerns.map(t => `<span class="fc-minus">− ${esc(t)}</span>`).join("")}</div>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--muted)">${fc.rows.length ? "Nothing in this group." : "No holdings yet. Sync a broker or import a CSV under My holdings."}</td></tr>`;
    $("#fcIdeasCard").hidden = !fc.ideas.length;
    $("#fcIdeas").innerHTML = fc.ideas.length ? `<div class="table-wrap"><table style="min-width:0"><thead><tr><th>Stock</th><th>Score</th><th>Quality</th><th>Verdict</th><th>Strengths</th></tr></thead><tbody>${fc.ideas.map(i => `<tr data-sym="${esc(i.symbol)}"><td><div class="company">${esc(i.company)}</div><div class="ticker">${esc(i.symbol)}</div></td><td>${scoreBar(i.score)}</td><td>${i.quality}</td><td><span class="chip ${esc(i.verdictCls)}">${esc(i.verdict)}</span></td><td class="kpi">${i.strengths.map(esc).join(" · ")}</td></tr>`).join("")}</tbody></table></div>` : "";
    $("#fcStatus").textContent = `Equal-weight target: ${fc.targetPct}% each across your top ${fc.n} holding${fc.n === 1 ? "" : "s"}${fc.ideas.length ? ` + ${fc.ideas.length} idea${fc.ideas.length === 1 ? "" : "s"}` : ""}.`;
  }
  async function fcLoad() {
    try {
      const acc = $("#fcAcc").value;
      fc = await get(`/api/portfolio/focus?n=${$("#fcN").value}${acc ? `&account=${encodeURIComponent(acc)}` : ""}`); fcRender();
      if (pf?.accounts) { const cur = $("#fcAcc").value; $("#fcAcc").innerHTML = '<option value="">All accounts</option>' + pf.accounts.map(a => `<option value="${esc(a.userId)}">${esc(a.label)}</option>`).join(""); $("#fcAcc").value = cur; }
    } catch (e) { $("#fcStatus").textContent = `Could not rank: ${e.message}`; }
  }
  window.openFocus = async () => { if (!pf) { try { pf = await get("/api/holdings"); } catch {} } fcLoad(); };
  $("#viewFocus").onclick = () => setView("focus");
  $("#fcN").onchange = fcLoad; $("#fcAcc").onchange = fcLoad;
  $("#fcFilters").addEventListener("click", e => { const b = e.target.closest("[data-fc]"); if (b) { fcFilter = b.dataset.fc; fcRender(); } });
  for (const id of ["#fcRows", "#fcIdeas"]) $(id).addEventListener("click", async e => { const tr = e.target.closest("tr[data-sym]"); if (!tr || !rowFor(tr.dataset.sym)) return; openStockSheet(tr.dataset.sym, { back: "Back to Focus list" }); });

  // ---- Market today (NSE-style lists) ---------------------------------------------------------------------------------
  let mk = null, mkList = "52high";
  const cr = v => (Number.isFinite(v) ? `₹${(v / 1e7).toLocaleString("en-IN", { maximumFractionDigits: v >= 1e9 ? 0 : 1 })} Cr` : "—");
  const qty = v => (Number.isFinite(v) ? (v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v.toLocaleString("en-IN")) : "—");
  const pchg = v => (Number.isFinite(v) ? `<span class="${v > 0 ? "buy" : v < 0 ? "avoid" : ""}">${v > 0 ? "+" : ""}${fmt(v, 2)}%</span>` : "—");
  function mkRender() {
    if (!mk) return;
    const is52 = mkList === "52high" || mkList === "52low", q = ($("#mkSearch").value || "").toLowerCase();
    const rows = mk.rows.filter(r => (!$("#mkMine").checked || r.tracked || r.held !== null) && (!q || `${r.symbol} ${r.name || ""}`.toLowerCase().includes(q)));
    $("#mkHead").innerHTML = `<tr><th>#</th><th>Stock</th><th>LTP</th><th>Change</th>${is52 ? `<th>${mkList === "52high" ? "New 52W high" : "New 52W low"}</th><th>Previous ${mkList === "52high" ? "high" : "low"}</th>` : ""}<th>Volume</th><th>Value</th>${mkList === "volgainers" ? "<th>Vs avg volume</th>" : ""}<th>P/E</th><th>Sector P/E</th><th>Your view</th></tr>`;
    $("#mkRows").innerHTML = rows.length ? rows.map((r, i) => `<tr data-sym="${esc(r.symbol)}">
      <td>${i + 1}</td><td><div class="company">${esc(r.name || r.symbol)}</div><div class="ticker">${esc(r.symbol)}${r.held !== null ? ` · <b>you hold ${r.held}</b>` : r.tracked ? " · tracked" : ""}</div></td>
      <td>${money(r.ltp)}</td><td>${pchg(r.pChange)}</td>
      ${is52 ? `<td>${money(mkList === "52high" ? r.high52 : r.low52)}</td><td>${money(r.prev52)}</td>` : ""}
      <td>${qty(r.volume)}</td><td>${cr(r.value)}</td>${mkList === "volgainers" ? `<td>${Number.isFinite(r.volRatio) ? `<b>${fmt(r.volRatio, 2)}×</b>` : "—"}</td>` : ""}
      <td>${Number.isFinite(r.pe) ? fmt(r.pe) : "—"}</td><td>${Number.isFinite(r.sectorPe) ? `${r.sectorPeEst ? "~" : ""}${fmt(r.sectorPe)}` : "—"}</td>
      <td>${r.verdict ? `<span class="chip ${esc(r.verdictCls)}">${esc(r.verdict)}</span>` : '<span class="hint">Value it →</span>'}</td></tr>`).join("")
      : `<tr><td colspan="12" style="text-align:center;padding:24px;color:var(--muted)">${mk.rows.length ? "No stock matches the filter." : mk.source === "none" ? 'No live quotes right now. <button type="button" class="ghost" id="mkGoKite">Log in to Kite</button> under Connect brokers to see today\'s movers for your stocks.' : "None of your stocks is on this list right now."}</td></tr>`;
    $("#mkGoKite")?.addEventListener("click", () => setView("integrations"));
    const src = { nse: "NSE · whole market", kite: "Your watchlist + holdings · Kite quotes", yahoo: "Your watchlist + holdings · Yahoo quotes", saved: "Your watchlist · saved prices", none: "No source available" }[mk.source] || mk.source;
    $("#mkMineWrap").hidden = $("#mkSource").value !== "nse";
    $("#mkStatus").textContent = `${src} · ${new Date(mk.asOf).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}`;
    const showNote = mk.note && mk.source !== "kite";
    $("#mkNote").hidden = !showNote; $("#mkNote").textContent = showNote ? `${mk.note} ${mk.source === "yahoo" ? "Using Yahoo quotes instead." : mk.source === "saved" ? "Showing your watchlist's last saved prices (no volume)." : ""}` : "";
  }
  async function mkLoad(fresh = false) {
    const b = $("#mkRefresh"); b.classList.add("is-loading"); b.disabled = true; $("#mkStatus").textContent = "Loading…";
    try { mk = await get(`/api/market?list=${mkList}&source=${$("#mkSource").value}${fresh ? "&fresh=1" : ""}`); mkRender(); }
    catch (e) { $("#mkStatus").textContent = `Could not load: ${e.message}`; } finally { b.classList.remove("is-loading"); b.disabled = false; }
  }
  window.openMarket = () => mkLoad();
  $("#viewMarket").onclick = () => setView("market");
  document.querySelectorAll("[data-mk]").forEach(btn => { btn.onclick = () => { mkList = btn.dataset.mk; document.querySelectorAll("[data-mk]").forEach(x => x.classList.toggle("active", x === btn)); mkLoad(); }; });
  $("#mkSource").onchange = () => mkLoad(); $("#mkRefresh").onclick = () => mkLoad(true); $("#mkMine").onchange = mkRender; $("#mkSearch").oninput = mkRender;
  $("#mkRows").addEventListener("click", e => { const tr = e.target.closest("tr[data-sym]"); if (!tr) return; const sym = tr.dataset.sym; openStockSheet(sym, { back: "Back to Market today", pick: { symbol: sym, name: mk.rows.find(r => r.symbol === sym)?.name || null, exchange: "NSE" } }); });

  // ---- Growth lens panel (same maths as growthlens.mjs, recomputed live while you edit the assumptions) ------------
  function glCalc(r, o) {
    const pe = r.pe, price = r.price; if (!(pe > 0) || !(price > 0) || !Number.isFinite(o.growth)) return null;
    const years = o.years, s1 = Math.min(5, years), g1 = o.growth, g2 = Math.max(6, g1 / 2), eps = price / pe, disc = Math.pow(1 + o.required / 100, years);
    const epsAt = (a, b) => eps * Math.pow(1 + a / 100, s1) * Math.pow(1 + b / 100, years - s1), val = (a, b, x) => epsAt(a, b) * x / disc;
    const base = val(g1, g2, o.exitPE), bear = val(g1 * 0.7, g2 * 0.8, o.exitPE * 0.85), bull = val(g1 * 1.2, g2 * 1.1, o.exitPE * 1.1), ratio = price / base;
    return { fair: { bear, base, bull }, ratio, implied: (Math.pow(pe * disc / o.exitPE, 1 / years) - 1) * 100, ret: (Math.pow(epsAt(g1, g2) * o.exitPE / price, 1 / years) - 1) * 100, peg: g1 > 0 ? pe / g1 : null, g2,
      verdict: ratio <= 0.9 ? ["Undervalued for its growth", "v-under"] : ratio <= 1.1 ? ["Fairly priced for its growth", "v-fair"] : ratio <= 1.4 ? ["Pricey even with growth", "v-rich1"] : ["Price needs more growth than likely", "v-rich"] };
  }
  function renderGrowthLens(r) {
    const box = $("#glPanel"); if (!box) return;
    const gl = r.growthLens;
    box.hidden = !!r.etf; if (r.etf) return; // ETFs: no earnings to grow
    if (!gl) { box.innerHTML = `<h3>Growth lens</h3><p class="hint">Needs a positive P/E and growth history; not available for this stock.</p>`; return; }
    const o = { growth: gl.growth, years: gl.years, exitPE: gl.exitPE, required: gl.required };
    box.innerHTML = `<div class="gl-head"><div><h3>Growth lens <span class="hint">what the price is worth if the growth continues</span></h3>
        <p class="xp">High P/E can be fine when profits compound for years. This projects earnings ${o.years} years out (your growth for 5 years, then half of it), applies an exit P/E, and discounts back at your required return.</p></div>
        <span class="chip ${r.verdict?.growthJustified ? "v-under" : "v-none"}" id="glJust">${r.verdict?.growthJustified ? "Growth justifies the P/E" : "Static valuation applies"}</span></div>
      <div class="gl-grid">
        <div class="gl-inputs">
          <label>Expected profit growth, next 5 yrs <b id="glGv">${o.growth}%</b><input type="range" id="glG" min="0" max="40" step="0.5" value="${o.growth}"></label>
          <div class="gl-row"><label>Years<select id="glY">${[5, 7, 10, 15].map(y => `<option${y === o.years ? " selected" : ""}>${y}</option>`).join("")}</select></label>
          <label>Exit P/E<input id="glX" type="number" min="5" max="80" step="1" value="${o.exitPE}"></label>
          <label>Required return %<input id="glR" type="number" min="4" max="30" step="0.5" value="${o.required}"></label></div>
          <p class="hint">Default growth = 3-yr sales/profit history (cautious blend, capped at 25%). Default exit P/E follows return on capital (25 / 20 / 15).${gl.custom ? " <b>You have saved your own assumptions.</b>" : ""}</p>
          <div class="toolbar" style="margin:6px 0 0"><button type="button" class="primary" id="glSave">Save as my assumptions</button>${gl.custom ? '<button type="button" class="ghost" id="glReset">Reset to defaults</button>' : ""}</div>
        </div>
        <div class="gl-out" id="glOut"></div>
      </div>`;
    const read = () => ({ growth: Number($("#glG").value), years: Number($("#glY").value), exitPE: Number($("#glX").value) || gl.exitPE, required: Number($("#glR").value) || gl.required });
    const paint = () => {
      const v = read(), c = glCalc(r, v); $("#glGv").textContent = `${v.growth}%`; if (!c) return;
      const max = Math.max(c.implied, v.growth, 1) * 1.15;
      $("#glOut").innerHTML = `<div class="gl-verdict"><span class="chip ${c.verdict[1]}">${c.verdict[0]}</span></div>
        <div class="gl-fv"><span>Growth-adjusted fair value</span><strong>${money(Math.round(c.fair.base))}</strong><small>bear ${money(Math.round(c.fair.bear))} · bull ${money(Math.round(c.fair.bull))} · price ${money(r.price)} (${c.ratio <= 1 ? `${Math.round((1 / c.ratio - 1) * 100)}% upside` : `${Math.round((c.ratio - 1) * 100)}% above`})</small></div>
        <div class="gl-bars"><div><span>Growth the price already assumes</span><i style="width:${Math.max(2, c.implied / max * 100)}%" class="imp"></i><b>${fmt(c.implied, 1)}%/yr</b></div><div><span>Your expected growth</span><i style="width:${Math.max(2, v.growth / max * 100)}%" class="exp"></i><b>${fmt(v.growth, 1)}%/yr</b></div></div>
        <div class="gl-stats"><div><span>Expected return if it plays out</span><strong class="${c.ret >= v.required ? "buy" : c.ret >= 8 ? "wait" : "avoid"}">${fmt(c.ret, 1)}%/yr</strong></div><div><span>PEG (P/E ÷ growth)</span><strong>${c.peg === null ? "—" : fmt(c.peg, 2)}</strong></div><div><span>Then growth fades to</span><strong>${fmt(c.g2, 1)}%</strong></div></div>`;
    };
    ["glG", "glY", "glX", "glR"].forEach(id => $("#" + id).addEventListener("input", paint));
    paint();
    const after = async x => { await loadValuation(); showResult(r.symbol); window.toast(x.verdict?.growthJustified ? `✓ Saved. ${ui.esc(r.symbol)} now reads “${ui.esc(x.verdict.label)}”` : `✓ Saved. Verdict: ${ui.esc(x.verdict?.label || "updated")}`); };
    $("#glSave").onclick = async () => { const b = $("#glSave"); b.classList.add("is-loading"); try { await after(await post("/api/growth-lens", { symbol: r.symbol, ...read() })); } catch (e) { window.toast(`Not saved: ${ui.esc(e.message)}`, { kind: "bad" }); } finally { b.classList.remove("is-loading"); } };
    $("#glReset")?.addEventListener("click", async () => after(await post("/api/growth-lens", { symbol: r.symbol, reset: true })));
  }

  // ---- Mutual fund X-ray ----------------------------------------------------------------------------------------------------
  let fdList = [], fdActive = null, fdPoll = null, fdTables = null, fdRows = null, fdData = null;
  async function fdLoadList() { try { fdList = (await get("/api/funds")).funds; } catch { fdList = []; } }
  function fdTabs() {
    $("#fdTabs").innerHTML = fdList.map(f => `<button type="button" class="viewTab${f.id === fdActive ? " active" : ""}" data-fd="${esc(f.id)}">${esc(f.name)} <span class="tab-badge">${f.count}</span></button>`).join("");
  }
  async function fdOpen(id) {
    fdActive = id; fdTabs(); clearTimeout(fdPoll);
    const body = $("#fdBody");
    if (!id) { body.innerHTML = `<div class="fd-empty"><div class="fd-empty-ico">🧺</div><h2>See inside any mutual fund</h2><p>Load a fund's portfolio (Helios Flexi Cap, Trust MF Small Cap, any scheme) and every holding gets this app's valuation, growth lens and verdict, plus the fund's weighted P/E and how much it overlaps with what you already own.</p><button type="button" class="primary" id="fdAdd2">+ Add your first fund</button></div>`; $("#fdAdd2").onclick = fdShowImport; return; }
    try {
      const x = await get(`/api/funds/view?id=${encodeURIComponent(id)}`), s = x.summary, m = s.mix;
      const bar = [["buy", "In buy zone", "var(--good)"], ["wait", "Wait / fair", "var(--warn)"], ["expensive", "Expensive", "var(--bad)"], ["unvalued", "Not valued yet", "var(--mute-bg)"]];
      body.innerHTML = `<div class="fd-head"><div><h2>${esc(x.fund.name)}</h2><p class="hint">${x.fund.asOf ? `Portfolio as of ${esc(x.fund.asOf)} · ` : ""}${s.count} equity holdings · updated ${new Date(x.fund.updatedAt).toLocaleDateString("en-IN")}</p></div>
          <div class="toolbar" style="margin:0"><button type="button" class="ghost" id="fdUpdate">Update holdings</button><button type="button" class="ghost" id="fdDelete">Delete fund</button></div></div>
        <section class="metrics"><div><span>Weighted P/E</span><strong>${s.weightedPE ?? "—"}</strong></div><div><span>In buy zone</span><strong class="buy">${m.buy}%</strong></div><div><span>Growth-justified</span><strong>${s.growthJustified}%</strong></div><div><span>Overlap with your holdings</span><strong>${s.overlapWithYou}%<small style="font-size:14px;color:var(--muted)"> · ${s.sharedStocks} shared</small></strong></div></section>
        <div class="fd-mix" role="img" aria-label="Valuation mix by weight">${bar.map(([k, l, c]) => m[k] > 0 ? `<i style="width:${m[k]}%;background:${c}" title="${l}: ${m[k]}%"></i>` : "").join("")}</div>
        <div class="fd-legend">${bar.map(([k, l, c]) => `<span><i style="background:${c}"></i>${l} ${m[k]}%</span>`).join("")}${s.weightedGrowth !== null ? `<span>· weighted expected growth ${s.weightedGrowth}%/yr</span>` : ""}</div>
        ${x.pending ? `<p class="mk-note">Fetching fundamentals for ${x.pending} holding(s) in the background; this page refreshes by itself.</p>` : ""}
        <section class="table-wrap"><table class="fd-table"><thead><tr><th>#</th><th>Stock</th><th>Weight</th><th>P/E</th><th>Sector P/E</th><th>ROCE / ROE</th><th>Verdict</th><th>Growth lens</th><th>You</th></tr></thead><tbody>
        ${x.holdings.map((h, i) => `<tr${h.symbol ? ` data-sym="${esc(h.symbol)}"` : ""}><td>${i + 1}</td><td><div class="company">${esc(h.name)}</div><div class="ticker">${h.symbol ? esc(h.symbol) : '<span class="avoid">no symbol</span>'}${h.sector ? ` · ${esc(h.sector)}` : ""}</div></td><td><div class="fd-w"><b>${fmt(h.weight, 2)}%</b><span><i style="width:${Math.min(100, h.weight * 10)}%"></i></span></div></td>
          <td>${Number.isFinite(h.pe) ? fmt(h.pe) : "—"}</td><td>${Number.isFinite(h.sectorPe) ? `${h.sectorPeEst ? "~" : ""}${fmt(h.sectorPe)}` : "—"}</td><td>${Number.isFinite(h.roce) ? `${fmt(h.roce)}%` : "—"}</td>
          <td>${h.verdict ? `<span class="chip ${esc(h.verdictCls)}">${esc(h.verdict)}</span>` : h.symbol ? '<span class="hint">fetching…</span>' : "—"}</td>
          <td>${h.growth ? `<span class="chip ${({ under: "v-under", fair: "v-fair", pricey: "v-rich1", rich: "v-rich" })[h.growth.key]}" title="Expected ${h.growth.growth}%/yr vs ${h.growth.implied}%/yr priced in">${esc(h.growth.verdict)}</span>` : "—"}</td>
          <td>${h.held ? '<span class="chip v-none">You hold</span>' : ""}</td></tr>`).join("")}</tbody></table></section>`;
      $("#fdUpdate").onclick = () => fdShowImport(x.fund);
      $("#fdDelete").onclick = async () => { if (await ui.confirm({ title: `Delete ${x.fund.name}?`, message: "Only the fund's saved portfolio is removed; the stocks stay tracked.", okText: "Delete fund", danger: true })) { await post("/api/funds/delete", { id }); await fdLoadList(); fdOpen(fdList[0]?.id || null); } };
      if (x.pending && !$("#fundView").hidden) fdPoll = setTimeout(async () => { await loadValuation(); fdOpen(id); }, 10000);
    } catch (e) { body.innerHTML = `<p class="hint">Could not load the fund: ${esc(e.message)}</p>`; }
  }
  function fdShowImport(fund = null) {
    $("#fdImport").hidden = false; $("#fdImport").dataset.id = fund?.id || ""; $("#fdName").value = fund?.name || ""; $("#fdAsOf").value = fund?.asOf || "";
    $("#fdPreview").innerHTML = ""; $("#fdStatus").textContent = ""; fdData = null; $("#fdFileName").textContent = ""; $("#fdPaste").value = "";
    $("#fdImport").scrollIntoView({ behavior: "smooth", block: "start" }); $("#fdName").focus();
  }
  $("#fdAdd").onclick = () => fdShowImport();
  $("#fdCancel").onclick = () => { $("#fdImport").hidden = true; };
  $("#fdTabs").addEventListener("click", e => { const b = e.target.closest("[data-fd]"); if (b) fdOpen(b.dataset.fd); });
  $("#fdBody").addEventListener("click", e => { const tr = e.target.closest("tr[data-sym]"); if (!tr) return; openStockSheet(tr.dataset.sym, { back: "Back to Mutual fund X-ray" }); });
  const fdTakeFile = f => { if (!f) return; if (f.size > 15e6) { $("#fdStatus").textContent = "File is larger than 15 MB."; return; } const rd = new FileReader(); rd.onload = () => { fdData = { filename: f.name, data: String(rd.result).split(",")[1] }; $("#fdFileName").textContent = `📄 ${f.name} (${Math.round(f.size / 1024)} KB)`; }; rd.readAsDataURL(f); };
  $("#fdPick").onclick = () => $("#fdFile").click(); $("#fdFile").onchange = e => fdTakeFile(e.target.files[0]);
  const fdDropZone = $("#fdDrop"); ["dragenter", "dragover"].forEach(ev => fdDropZone.addEventListener(ev, e => { e.preventDefault(); fdDropZone.classList.add("over"); })); ["dragleave", "drop"].forEach(ev => fdDropZone.addEventListener(ev, e => { e.preventDefault(); fdDropZone.classList.remove("over"); }));
  fdDropZone.addEventListener("drop", e => fdTakeFile(e.dataTransfer.files[0]));
  $("#fdRead").onclick = async () => {
    const st = $("#fdStatus"), b = $("#fdRead"); const text = $("#fdPaste").value.trim();
    if (!fdData && !text) { st.textContent = "Upload a file or paste a table first."; return; }
    b.classList.add("is-loading"); b.disabled = true; st.textContent = "Reading…";
    try {
      const x = await post("/api/funds/parse", fdData || { text }); fdTables = x.tables;
      // pick the sheet whose title matches the fund name (AMC workbooks have one sheet per scheme)
      const want = normFd($("#fdName").value); let idx = 0; if (want) { const i = fdTables.findIndex(t => normFd(`${t.title} ${t.sheet}`).includes(want) || want.split(" ").filter(w => w.length > 3).every(w => normFd(`${t.title} ${t.sheet}`).includes(w))); if (i >= 0) idx = i; }
      if (!$("#fdName").value.trim()) $("#fdName").value = fdTables[idx].title.replace(/\s*\(.*$/, "").slice(0, 80);
      fdPreview(idx); st.textContent = "";
    } catch (e) { st.textContent = e.message; } finally { b.classList.remove("is-loading"); b.disabled = false; }
  };
  const normFd = s => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  async function fdPreview(idx) {
    const t = fdTables[idx]; fdRows = t.holdings.map(h => ({ ...h, symbol: null, exchange: "NSE", how: "…" }));
    const draw = () => { $("#fdPreview").innerHTML = `${fdTables.length > 1 ? `<label class="lens-control" style="margin:10px 0">Scheme in this file<select id="fdSheet">${fdTables.map((x, i) => `<option value="${i}"${i === idx ? " selected" : ""}>${esc(x.title)} · ${esc(x.sheet)} (${x.holdings.length})</option>`).join("")}</select></label>` : ""}
      <p class="hint">${fdRows.length} equity holdings, ${fdRows.reduce((a, h) => a + h.weight, 0).toFixed(1)}% of the fund. Symbols are matched automatically (your watchlist, then Screener's search); fix any that are wrong or missing before saving.</p>
      <div class="table-wrap" style="max-height:420px"><table style="min-width:0"><thead><tr><th>Holding</th><th>Weight</th><th>NSE symbol / BSE code</th><th>Matched by</th></tr></thead><tbody>${fdRows.map((h, i) => `<tr><td><b>${esc(h.name)}</b><div class="ticker">${esc(h.isin || "")}${h.sector ? ` · ${esc(h.sector)}` : ""}</div></td><td>${fmt(h.weight, 2)}%</td><td><input class="dv-in fd-sym" data-i="${i}" value="${esc(h.symbol || "")}" placeholder="${h.how === "…" ? "matching…" : "type symbol"}"></td><td><span class="hint">${esc(h.how)}</span></td></tr>`).join("")}</tbody></table></div>
      <div class="toolbar"><button type="button" class="primary" id="fdSave">Save fund</button><span class="hint" id="fdSaveSt"></span></div>`;
      $("#fdSheet")?.addEventListener("change", e => fdPreview(Number(e.target.value)));
      $("#fdPreview").querySelectorAll(".fd-sym").forEach(inp => inp.oninput = () => { const h = fdRows[Number(inp.dataset.i)]; h.symbol = inp.value.trim().toUpperCase() || null; h.exchange = /^\d{6}$/.test(h.symbol || "") ? "BSE" : "NSE"; h.how = "you"; });
      $("#fdSave").onclick = fdSave; };
    draw();
    for (let i = 0; i < fdRows.length; i += 10) {
      if (fdTables[idx] !== t) return;
      $("#fdStatus").textContent = `Matching symbols ${Math.min(i + 10, fdRows.length)} / ${fdRows.length}…`;
      try { const r = await post("/api/funds/resolve", { items: fdRows.slice(i, i + 10).map(h => ({ name: h.name, isin: h.isin })) }); r.results.forEach((x, k) => { const h = fdRows[i + k]; if (h.how === "you") return; h.symbol = x.symbol; h.exchange = x.exchange || "NSE"; h.how = { saved: "remembered", watchlist: "your watchlist", screener: "Screener search", none: "not found", error: "search failed" }[x.how] || x.how; }); }
      catch (e) { fdRows.slice(i, i + 10).forEach(h => { if (h.how === "…") h.how = "search failed"; }); }
      draw();
    }
    const miss = fdRows.filter(h => !h.symbol).length; $("#fdStatus").textContent = miss ? `${miss} holding(s) without a symbol: type it, or save anyway (they are shown but not valued).` : "All holdings matched.";
  }
  async function fdSave() {
    const name = $("#fdName").value.trim(); if (!name) { $("#fdSaveSt").textContent = "Give the fund a name."; $("#fdName").focus(); return; }
    const b = $("#fdSave"); b.classList.add("is-loading"); b.disabled = true;
    try {
      const x = await post("/api/funds/save", { id: $("#fdImport").dataset.id || null, name, asOf: $("#fdAsOf").value, holdings: fdRows.map(h => ({ name: h.name, isin: h.isin, weight: h.weight, sector: h.sector, symbol: h.symbol, exchange: h.exchange })) });
      $("#fdImport").hidden = true; await fdLoadList(); await loadStocks(); fdOpen(x.id);
      window.toast(`✓ ${ui.esc(name)} saved. Fetching fundamentals for its holdings in the background.`);
    } catch (e) { $("#fdSaveSt").textContent = e.message; } finally { b.classList.remove("is-loading"); b.disabled = false; }
  }
  window.openFunds = async () => { await fdLoadList(); fdOpen(fdActive && fdList.some(f => f.id === fdActive) ? fdActive : fdList[0]?.id || null); };
  $("#viewFunds").onclick = () => setView("funds");

  // First paint: the view in the address (#networth, #portfolio… from an app shortcut or a reload), else home
  setView(decodeURIComponent(location.hash.slice(1)) || "home");
  window.addEventListener("hashchange", () => { const v = decodeURIComponent(location.hash.slice(1)); if (v) setView(v); });
  loadLists().then(redrawAll);
})();
