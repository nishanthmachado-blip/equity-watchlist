// US stocks tab: your US list or a popular large-cap universe, screens, and a detail sheet with a growth override.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  let data = null, list = "mine", screen = "all", sort = { k: "upside", dir: -1 }, poll = null, sheet = null;
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 202) throw new Error(j.message || `HTTP ${r.status}`); return Object.assign(j, { _status: r.status });
  };
  const usd = v => Number.isFinite(v) ? `$${v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}` : "—";
  const big = v => !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)} T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)} B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)} M` : usd(v);
  const pct = (v, plus = false) => Number.isFinite(v) ? `${plus && v > 0 ? "+" : ""}${v}%` : "—";
  const SCREENS = [
    ["all", "All", () => true],
    ["under", "Undervalued", r => r.ratio !== null && r.ratio <= 0.9],
    ["quality", "Quality compounders", r => r.quality >= 70 && (r.roic ?? r.roe ?? 0) >= 15 && (r.revG ?? 0) >= 5],
    ["growth", "High growth", r => (r.revG ?? 0) >= 15 && (r.epsG ?? 0) >= 15],
    ["dividend", "Dividend payers", r => (r.divYield ?? 0) >= 2 && (r.payout ?? 100) < 75],
    ["value", "Low P/E value", r => r.pe > 0 && r.pe < 16 && (r.epsG ?? 0) >= 0]
  ];
  const valued = r => !r.pending && !r.error && r.verdict;
  function render() {
    if (!data) return;
    $("#usList").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.list === list));
    const rowsAll = data.rows, ok = rowsAll.filter(valued);
    $("#usScreens").innerHTML = SCREENS.map(([k, l, f]) => `<button type="button" class="pf-chip${screen === k ? " active" : ""}" data-screen="${k}">${l}<b>${ok.filter(f).length}</b></button>`).join("");
    const f = SCREENS.find(x => x[0] === screen)[2];
    const shown = (screen === "all" ? rowsAll : ok.filter(f)).slice().sort((a, b) => { const x = a[sort.k], y = b[sort.k]; if (!Number.isFinite(x) && !Number.isFinite(y)) return String(a.symbol).localeCompare(b.symbol); if (!Number.isFinite(x)) return 1; if (!Number.isFinite(y)) return -1; return (x - y) * sort.dir; });
    const st = [];
    if (data.pending) st.push(`Fetching SEC filings for ${data.pending} stock${data.pending === 1 ? "" : "s"}…`);
    if (data.secError) st.push(`SEC: ${data.secError}`);
    if (data.priceErrors?.length && !rowsAll.some(r => r.price)) st.push(`Prices unavailable (${data.priceErrors[0]})`);
    $("#usStatus").textContent = st.join(" · ");
    $("#usRows").innerHTML = shown.length ? shown.map(r => {
      if (!valued(r)) return `<tr data-sym="${esc(r.symbol)}" class="us-pending"><td><div class="company">${esc(r.name || r.symbol)}</div><div class="ticker">${esc(r.symbol)}</div></td><td class="num">${usd(r.price)}</td><td colspan="11" class="hint">${r.pending ? "⏳ reading SEC filings…" : `⚠ ${esc(r.error || "no data")}`}</td></tr>`;
      return `<tr data-sym="${esc(r.symbol)}"><td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)} · ${big(r.marketCap)} · FY${r.asOfFy}</div></td>
        <td class="num">${usd(r.price)}</td><td class="num">${r.pe ?? "—"}${r.fairPE ? `<div class="ticker">fair ${r.fairPE}</div>` : ""}</td><td class="num">${usd(r.fairValue)}</td>
        <td class="num ${r.upside > 0 ? "buy" : r.upside < 0 ? "avoid" : ""}">${pct(r.upside, true)}</td><td><span class="chip ${esc(r.verdict.cls)}">${esc(r.verdict.label)}</span></td>
        <td class="num">${pct(r.revG)}</td><td class="num">${pct(r.epsG)}</td><td class="num">${pct(r.roic ?? r.roe)}${r.roic === null && r.roe !== null ? '<div class="ticker">ROE</div>' : ""}</td><td class="num">${pct(r.netMargin)}</td><td class="num">${r.de ?? "—"}</td><td class="num">${pct(r.divYield)}</td>
        <td>${r.tags.map(t => `<span class="chip v-none">${esc(t)}</span>`).join(" ")}</td></tr>`;
    }).join("") : `<tr><td colspan="13" class="nw-empty-row">${list === "mine" && !data.mine.length ? `Your US list is empty. Search above to add stocks, or switch to <button type="button" class="linklike" data-list="popular">Popular large caps</button>.` : "No stocks match this screen."}</td></tr>`;
    document.querySelectorAll(".us-table th[data-k]").forEach(th => th.classList.toggle("sorted", th.dataset.k === sort.k));
    clearTimeout(poll); if (data.pending && !$("#usView").hidden) poll = setTimeout(load, 4000);
  }
  async function load() { try { data = await api(`/api/us?list=${list}`); render(); } catch (e) { $("#usStatus").textContent = e.message; } }
  window.openUs = load;

  // ---- detail sheet ----
  function ensureSheet() {
    if (sheet) return sheet;
    const scrim = document.createElement("div"); scrim.className = "sheet-scrim"; scrim.hidden = true;
    const el = document.createElement("aside"); el.className = "stock-sheet"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="sheet-bar"><button type="button" class="ghost sheet-back" data-close>← Back to US stocks</button><span class="sheet-hint">Esc to close</span><button type="button" class="modal-close" data-close aria-label="Close">&times;</button></div><div class="sheet-body"></div>`;
    document.body.append(scrim, el);
    const close = () => { el.hidden = true; scrim.hidden = true; document.body.classList.remove("sheet-open"); };
    scrim.onclick = close; el.querySelectorAll("[data-close]").forEach(b => { b.onclick = close; });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !el.hidden && !document.querySelector(".ui-scrim")) close(); });
    sheet = { el, scrim, body: el.querySelector(".sheet-body"), close };
    return sheet;
  }
  async function openStock(sym) {
    const s = ensureSheet(); s.el.hidden = false; s.scrim.hidden = false; document.body.classList.add("sheet-open");
    s.body.innerHTML = `<div class="vs-card vs-empty">Loading ${esc(sym)}…</div>`;
    let d;
    for (let i = 0; i < 20; i++) { d = await api(`/api/us/stock?symbol=${encodeURIComponent(sym)}`).catch(e => ({ error: e.message })); if (d._status !== 202 || d.error) break; s.body.innerHTML = `<div class="vs-card vs-empty">Reading ${esc(sym)}'s SEC filings…</div>`; await new Promise(r => setTimeout(r, 2500)); }
    if (d.error || !d.valuation) { s.body.innerHTML = `<div class="vs-card vs-empty">${esc(sym)}: ${esc(d.error || "no data yet, try again in a minute")}</div>`; return; }
    const v = d.valuation, row = (k, val) => `<div class="row"><span>${k}</span><strong>${val}</strong></div>`;
    const yrs = d.years;
    s.body.innerHTML = `<article class="vs-card">
      <div class="vs-top"><div><h2>${esc(d.name)} <small>(${esc(d.symbol)})</small></h2><p class="hint" style="margin:4px 0 0">${big(v.marketCap)} market cap · latest 10-K: FY${v.asOfFy} (year to ${esc(v.fyEnd)}) · SEC CIK ${d.cik}</p></div>
        <div class="vs-price"><span>Price</span><strong>${usd(d.price)}</strong><small>${esc(d.priceSource || "")} ${esc(d.priceDate || "")}</small></div></div>
      <div class="vs-verdict"><span class="vs-big chip ${esc(v.verdict.cls)}">${esc(v.verdict.label)}</span>${v.tags.map(t => `<span class="chip v-none">${esc(t)}</span>`).join(" ")}</div>
      <div class="vs-grid">
        <div class="vs-tile"><span>Fair value (bear · base · bull)</span><strong>${usd(v.bear)} · ${usd(v.fairValue)} · ${usd(v.bull)}</strong><small class="${v.upside >= 0 ? "buy" : "avoid"}">${pct(v.upside, true)} to base value</small></div>
        <div class="vs-tile"><span>P/E vs fair P/E</span><strong>${v.pe ?? "—"} vs ${v.fairPE ?? "—"}</strong><small>by P/E ${usd(v.byPE)} · by cash flow ${usd(v.byDcf)}</small></div>
        <div class="vs-tile"><span>Growth the price assumes</span><strong>${v.impliedGrowth !== null ? `${v.impliedGrowth}%/yr` : "—"}</strong><small>vs ${v.growthUsed ?? "—"}%/yr used here</small></div>
        <div class="vs-tile"><span>Quality score</span><strong>${v.quality ?? "—"}/100</strong><small>returns, margins, cash, debt, consistency</small></div>
      </div>
      <section class="gl-panel"><div class="gl-head"><div><h3>Your growth assumption</h3><p class="hint" style="margin:0">History says ${v.growthModel ?? "—"}%/yr. If you expect faster or slower growth for the next 5 years, set it here; fair value updates.</p></div></div>
        <div class="us-growth"><input type="range" min="-5" max="35" step="0.5" value="${v.growthUsed ?? 0}" id="usG" aria-label="Growth per year"><b id="usGv">${v.growthUsed ?? 0}%</b><button type="button" class="primary" id="usGsave">Save</button>${v.growthOverride !== null ? '<button type="button" class="ghost" id="usGreset">Use history</button>' : ""}</div></section>
      <div class="vs-cols"><div><h3>Why this verdict</h3><ul>${v.why.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h3>Key numbers (FY${v.asOfFy})</h3>${row("Revenue", big(v.revenue))}${row("Net income", big(v.netIncome))}${row("Revenue growth (3 yr)", pct(v.revG))}${row("EPS growth (3 yr)", pct(v.epsG))}${row(v.roic !== null ? "ROIC" : "ROE", pct(v.roic ?? v.roe))}${row("ROE", pct(v.roe))}${row("Operating / net margin", `${pct(v.opMargin)} / ${pct(v.netMargin)}`)}${row("Free-cash-flow yield", pct(v.fcfYield))}${row("Debt / equity", v.de ?? "—")}${row("Dividend yield · payout", `${pct(v.divYield)} · ${pct(v.payout)}`)}${row("P/S · P/B", `${v.ps ?? "—"} · ${v.pb ?? "—"}`)}</div></div>
      <h3>Last ${yrs.length} fiscal years</h3>
      <div class="table-wrap"><table class="us-years"><thead><tr><th>FY</th><th class="num">Revenue</th><th class="num">Net income</th><th class="num">EPS</th><th class="num">Free cash flow</th><th class="num">Net margin</th></tr></thead><tbody>${yrs.map(y => `<tr><td>${y.fy}</td><td class="num">${big(y.revenue)}</td><td class="num">${big(y.netIncome)}</td><td class="num">${Number.isFinite(y.eps) ? usd(y.eps) : "—"}</td><td class="num">${Number.isFinite(y.cfo) ? big(y.cfo - (y.capex || 0)) : "—"}</td><td class="num">${y.revenue && Number.isFinite(y.netIncome) ? pct(Math.round(y.netIncome / y.revenue * 1000) / 10) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <div class="toolbar" style="margin:16px 0 0"><button type="button" class="ghost" id="usToggle">${d.inList ? "✓ In my US list (remove)" : "+ Add to my US list"}</button><button type="button" class="ghost" id="usRef">Refresh from SEC</button></div>
      <p class="vs-fine">Fair value = average of (fair P/E × EPS) and a 10-year DCF of free cash flow per share (your growth for 5 years, fading to 3%; 9% discount rate). Rule-based screen from SEC filings, not investment advice.</p>
    </article>`;
    const rg = $("#usG"); rg.oninput = () => { $("#usGv").textContent = `${rg.value}%`; };
    $("#usGsave").onclick = async () => { await api("/api/us/growth", { symbol: sym, growth: Number(rg.value) }); openStock(sym); load(); };
    $("#usGreset")?.addEventListener("click", async () => { await api("/api/us/growth", { symbol: sym, growth: null }); openStock(sym); load(); });
    $("#usToggle").onclick = async () => { await api("/api/us/list", d.inList ? { remove: [sym] } : { add: [sym] }); window.toast?.(d.inList ? `${esc(sym)} removed from your US list.` : `✓ ${esc(sym)} added to your US list.`, { kind: "ok", ms: 3000 }); openStock(sym); load(); };
    $("#usRef").onclick = async () => { await api("/api/us/refresh", { symbols: [sym] }); window.toast?.("Refreshing from SEC…", { kind: "ok", ms: 2500 }); setTimeout(() => openStock(sym), 3000); };
  }

  // ---- search ----
  let sTimer = null, results = [], active = -1;
  function drawDrop() {
    const dd = $("#usDrop"); dd.hidden = !results.length;
    dd.innerHTML = results.map((r, i) => `<button type="button" class="us-opt${i === active ? " active" : ""}" data-i="${i}"><b>${esc(r.symbol)}</b> <span>${esc(r.name)}</span><em>${data?.mine?.includes(r.symbol) ? "in your list" : "+ add"}</em></button>`).join("");
  }
  async function addSym(sym) {
    results = []; drawDrop(); $("#usQ").value = "";
    try { await api("/api/us/list", { add: [sym] }); list = "mine"; window.toast?.(`✓ ${esc(sym)} added. Reading its SEC filings…`, { kind: "ok", ms: 3000 }); await load(); }
    catch (e) { window.toast?.(esc(e.message), { kind: "warn" }); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#usView")) return;
    $("#viewUs").onclick = () => setView("us");
    $("#usList").addEventListener("click", e => { const b = e.target.closest("[data-list]"); if (b) { list = b.dataset.list; load(); } });
    $("#usRows").addEventListener("click", e => { const l = e.target.closest("[data-list]"); if (l) { list = l.dataset.list; load(); return; } const tr = e.target.closest("tr[data-sym]"); if (tr) openStock(tr.dataset.sym); });
    $("#usScreens").addEventListener("click", e => { const b = e.target.closest("[data-screen]"); if (b) { screen = b.dataset.screen; render(); } });
    $("#usRefresh").onclick = async () => { if (!data) return; await api("/api/us/refresh", { symbols: data.rows.map(r => r.symbol) }); $("#usStatus").textContent = "Refreshing prices and SEC data…"; setTimeout(load, 1500); };
    // sortable numeric columns
    const keys = [null, "price", "pe", "fairValue", "upside", null, "revG", "epsG", "roic", "netMargin", "de", "divYield", null];
    document.querySelectorAll(".us-table thead th").forEach((th, i) => { if (!keys[i]) return; th.dataset.k = keys[i]; th.tabIndex = 0; th.title = "Sort"; const go = () => { sort = { k: keys[i], dir: sort.k === keys[i] ? -sort.dir : -1 }; render(); }; th.onclick = go; th.onkeydown = e => { if (e.key === "Enter") go(); }; });
    const q = $("#usQ");
    q.addEventListener("input", () => { clearTimeout(sTimer); const v = q.value.trim(); if (!v) { results = []; drawDrop(); return; } sTimer = setTimeout(async () => { try { results = (await api(`/api/us/search?q=${encodeURIComponent(v)}`)).results; active = results.length ? 0 : -1; drawDrop(); } catch (e) { $("#usStatus").textContent = e.message; } }, 200); });
    q.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); drawDrop(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); drawDrop(); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); if (results[active]) addSym(results[active].symbol); else if (q.value.trim()) addSym(q.value.trim().toUpperCase()); }
      else if (e.key === "Escape") { results = []; drawDrop(); }
    });
    $("#usDrop").addEventListener("mousedown", e => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); addSym(results[Number(b.dataset.i)].symbol); } });
    q.addEventListener("blur", () => setTimeout(() => { results = []; drawDrop(); }, 150));
  });
})();
