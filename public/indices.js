// Smart indices screen: pick an NSE index (Nifty 50, Nifty500 Quality 50, Nifty200 Momentum 30, …), see every stock in it
// with valuation, momentum and a smart score, filter, and add the good ones to a watchlist in one go.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = Number.isFinite;
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  };
  const px = v => (fin(v) ? `₹${v >= 1000 ? Math.round(v).toLocaleString("en-IN") : v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
  const pc = v => (fin(v) ? `${v > 0 ? "+" : ""}${v.toFixed(1)}%` : "—");
  const cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const short = s => String(s).replace(/^NIFTY\s*/i, "Nifty ").replace(/\b(\d+)\b/g, "$1").replace(/\bQUALITY\b/i, "Quality").replace(/\bMOMENTUM\b/i, "Momentum").replace(/\bVALUE\b/i, "Value").replace(/\bLOW VOLATILITY\b/i, "Low Vol").replace(/\bLOW-VOLATILITY\b/i, "Low-Vol").replace(/\bALPHA\b/i, "Alpha").replace(/\bDIVIDEND OPPORTUNITIES\b/i, "Dividend Opp.").replace(/\bNEXT\b/i, "Next").replace(/MIDCAP/i, "Midcap").replace(/SMALLCAP/i, "Smallcap");
  const FILTERS = [["all", "All"], ["top", "Smart score 70+"], ["undervalued", "Undervalued"], ["momentum", "Momentum leaders"], ["pullback", "Pullback in uptrend"], ["near-low", "Near 52w low"], ["new", "Not in my watchlist"], ["held", "I hold"]];
  let home = null, view = null, current = localStorageGet("idx-current") || "NIFTY500 QUALITY 50", filter = "all", sort = { k: "score", dir: -1 }, sel = new Set(), poll = null, lists = [];
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } }

  function renderPicker() {
    if (!home) return;
    const chip = x => `<button type="button" class="idx-chip${x.name === current ? " active" : ""}" data-name="${esc(x.name)}" title="${esc(x.blurb || x.name)}">${esc(short(x.name))}${fin(x.pChange) ? `<small class="${cls(x.pChange)}">${pc(x.pChange)}</small>` : ""}</button>`;
    const groups = [...new Set(home.curated.map(x => x.group))];
    $("#idxPicker").innerHTML = groups.map(g => `<div class="idx-group"><span class="idx-glabel">${esc(g)}</span>${home.curated.filter(x => x.group === g).map(chip).join("")}</div>`).join("")
      + (home.others.length ? `<div class="idx-group"><span class="idx-glabel">All NSE indices</span><select class="ui-input" id="idxMore"><option value="">More (${home.others.length})…</option>${[...new Set(home.others.map(o => o.category || "Other"))].map(cat => `<optgroup label="${esc(cat)}">${home.others.filter(o => (o.category || "Other") === cat).map(o => `<option value="${esc(o.name)}"${o.name === current ? " selected" : ""}>${esc(o.name)}</option>`).join("")}</optgroup>`).join("")}</select></div>` : "");
    const more = $("#idxMore"); if (more) more.onchange = () => { if (more.value) pick(more.value); };
  }
  const matches = (r, f = filter) => f === "all" || (f === "top" ? r.score >= 70 : f === "new" ? !r.watching : f === "held" ? r.held : r.tags.includes(f));
  const valOf = r => r.valuation?.upside ?? -999;
  function shown() {
    const q = $("#idxQ").value.trim().toLowerCase();
    const rows = view.rows.filter(r => matches(r)).filter(r => !q || `${r.symbol} ${r.name} ${r.industry || ""}`.toLowerCase().includes(q));
    const key = r => (sort.k === "val" ? valOf(r) : sort.k === "name" ? r.name : r[sort.k]);
    return rows.sort((a, b) => { const x = key(a), y = key(b); if (typeof x === "string") return x.localeCompare(y) * -sort.dir; if (!fin(x) && !fin(y)) return 0; if (!fin(x)) return 1; if (!fin(y)) return -1; return (x - y) * sort.dir; });
  }
  function render() {
    const v = view; if (!v) return;
    const m = v.meta || {}, s = v.summary;
    $("#idxHead").innerHTML = `<div class="idx-title"><div><h2>${esc(v.name)}</h2>${m.blurb ? `<p class="hint">${esc(m.blurb)}</p>` : ""}</div>${v.index ? `<div class="idx-level"><b>${v.index.last?.toLocaleString("en-IN") ?? "—"}</b><span class="${cls(v.index.pChange)}">${pc(v.index.pChange)} today</span><small>1Y ${pc(v.index.ch365d)} · 1M ${pc(v.index.ch30d)}</small></div>` : ""}</div>`
      + (s ? `<div class="idx-stats"><span><b>${s.count}</b> stocks</span><span><b>${s.held}</b> you hold${s.heldWeight ? ` (${s.heldWeight}% of the index)` : ""}</span><span><b>${s.watching}</b> in your watchlist</span><span><b>${s.valued}</b> valued${v.fundamentalsMissing ? ` · ${v.fundamentalsMissing} not yet` : ""}</span><span>🟢 <b>${s.undervalued}</b> undervalued</span><span>🚀 <b>${s.momentum}</b> momentum leaders</span><span>↘↗ <b>${s.pullback}</b> pullbacks</span></div>
        <div class="idx-inds">${s.industries.map(x => `<span class="chip v-none">${esc(x.industry)} ${x.weight}${v.rows.some(r => r.weight) ? "%" : ""}</span>`).join(" ")}</div>` : "")
      + `<p class="vs-fine">${v.pending ? "Loading the latest list from NSE… " : ""}${v.error && !v.rows.length ? `Could not load from NSE (${esc(v.error)}). ` : ""}${v.source ? `Source: ${esc(v.source)}, ${new Date(v.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : ""}</p>`;
    const counts = Object.fromEntries(FILTERS.map(([k]) => [k, v.rows.filter(r => matches(r, k)).length]));
    $("#idxFilters").innerHTML = FILTERS.map(([k, l]) => `<button type="button" class="pf-chip${filter === k ? " active" : ""}" data-f="${k}">${l}<b>${counts[k]}</b></button>`).join("");
    const rows = shown();
    $("#idxRows").innerHTML = rows.length ? rows.map(r => {
      const val = r.valuation, sc = r.score;
      return `<tr data-sym="${esc(r.symbol)}" class="${r.held ? "idx-held" : ""}"><td><input type="checkbox" data-sel="${esc(r.symbol)}"${sel.has(r.symbol) ? " checked" : ""}${r.watching ? " disabled title=\"Already in your watchlist\"" : ""}></td>
        <td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)}${r.industry ? ` · ${esc(r.industry)}` : ""}</div><div class="idx-tags">${r.held ? '<span class="chip buy">You hold</span>' : ""}${r.watching ? '<span class="chip v-none">Watchlist</span>' : ""}${r.tags.map(t => `<span class="idx-tag t-${t}">${{ undervalued: "Undervalued", momentum: "🚀 Momentum", pullback: "↘↗ Pullback", "near-low": "⚠ Near 52w low" }[t]}</span>`).join("")}</div></td>
        <td class="num"><b>${px(r.price)}</b></td><td class="num ${cls(r.pChange)}">${pc(r.pChange)}</td><td class="num ${cls(r.ch30d)}">${pc(r.ch30d)}</td><td class="num ${cls(r.ch365d)}">${pc(r.ch365d)}</td>
        <td class="num">${fin(r.fromHigh) ? `${r.fromHigh.toFixed(1)}%` : "—"}${fin(r.rsi) ? `<div class="ticker">RSI ${Math.round(r.rsi)}</div>` : ""}</td><td class="num">${fin(r.weight) ? `${r.weight}%` : "—"}</td>
        <td>${val ? `<span class="chip ${val.view === "Undervalued" ? "buy" : val.view === "Fair" ? "v-none" : "avoid"}">${esc(val.view)}</span><div class="ticker">${fin(val.fair) ? `fair ${px(val.fair)}` : ""}${fin(val.upside) ? ` (${val.upside > 0 ? "+" : ""}${val.upside}%)` : ""}${fin(val.pe) ? ` · P/E ${val.pe}` : ""}</div>` : '<span class="hint">not valued yet</span>'}</td>
        <td title="${esc(r.why.join("\n"))}">${fin(sc) ? `<div class="idx-score"><i style="width:${sc}%" class="${sc >= 70 ? "hi" : sc >= 50 ? "mid" : "lo"}"></i></div><b>${sc}</b>${r.partial ? '<small class="hint"> partial</small>' : ""}` : "—"}</td>
        <td class="sw-acts">${r.watching ? "" : `<button type="button" class="ghost" data-add="${esc(r.symbol)}" title="Add to watchlist">＋</button>`}<button type="button" class="ghost ai-btn" data-ask-ai="Is ${esc(r.symbol)} (in the ${esc(v.name)} index) worth adding to my watchlist or buying now? Use its valuation, momentum, trend and what I already hold." data-ask-sym="${esc(r.symbol)}" data-ask-where="Smart indices" title="Ask AI">✨</button></td></tr>`;
    }).join("") : `<tr><td colspan="11" class="nw-empty-row">${v.pending ? "Loading the stocks in this index…" : v.rows.length ? "No stocks match this filter." : "No stocks yet for this index."}</td></tr>`;
    document.querySelectorAll(".idx-table th[data-k]").forEach(th => th.classList.toggle("sorted", th.dataset.k === sort.k));
    $("#idxAdd").disabled = !sel.size; $("#idxAdd").textContent = sel.size ? `＋ Add ${sel.size} to watchlist` : "＋ Add selected to watchlist";
    const j = v.valueJob; $("#idxValue").disabled = !!j?.running || !v.fundamentalsMissing;
    $("#idxStatus").textContent = j?.running ? `Valuing ${j.name}: ${j.done} of ${j.total}…` : j?.note || "";
    clearTimeout(poll); if ((v.pending || j?.running) && !$("#idxView").hidden) poll = setTimeout(() => load(false), v.pending ? 2500 : 6000);
  }
  async function load(resetSel = true) {
    try {
      if (resetSel) { sel = new Set(); $("#idxRows").innerHTML = `<tr><td colspan="11" class="nw-empty-row">Loading…</td></tr>`; }
      const [h, v] = await Promise.all([home ? Promise.resolve(home) : api("/api/indices"), api(`/api/indices/view?name=${encodeURIComponent(current)}`)]);
      home = h; view = v; renderPicker(); render();
    } catch (e) { $("#idxStatus").textContent = e.message; }
  }
  function pick(name) { current = name; localStorageSet("idx-current", name); filter = "all"; load(); renderPicker(); }
  async function addSyms(syms) {
    const names = Object.fromEntries(view.rows.filter(r => syms.includes(r.symbol)).map(r => [r.symbol, r.name]));
    try {
      const r = await api("/api/indices/add", { symbols: syms, names, list: $("#idxList").value || undefined, from: view.name });
      window.toast?.(`${r.added} added to your watchlist${r.already ? ` (${r.already} were already there)` : ""}.${r.valuing ? ` Valuing ${r.valuing} in the background.` : ""}`, { kind: "ok", ms: 6000 });
      sel = new Set(); load(false); window.loadStocks?.();
    } catch (e) { window.toast?.(e.message, { kind: "error" }); }
  }
  async function importCsv() {
    let file = null;
    const out = await window.ui.dialog({
      title: "Import an index's stocks", icon: "📄", okText: "Import", wide: true,
      message: "On niftyindices.com open the index (e.g. Nifty500 Quality 50) and download its constituents CSV (Company Name, Industry, Symbol, Series, ISIN Code). Prices come from NSE's daily closes this app saves.",
      bodyHtml: `<div class="nw-form"><label class="ui-field"><span>Index</span><input class="ui-input" name="name" value="${esc(current)}"></label><label class="ui-field"><span>CSV file</span><input class="ui-input" type="file" name="file" accept=".csv,.txt"></label></div>`,
      onOpen: box => { box.querySelector("[name=file]").onchange = e => { file = e.target.files[0] || null; }; },
      collect: async box => { if (!file) throw new Error("Choose the CSV file."); return api("/api/indices/import", { name: box.querySelector("[name=name]").value.trim(), csv: await file.text() }); }
    });
    if (out) { view = out; current = out.name; renderPicker(); render(); }
  }
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.indices = async () => {
    try { lists = (await api("/api/lists")).lists || []; } catch { lists = []; }
    $("#idxList").innerHTML = lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("") || '<option value="">Default watchlist</option>';
    load();
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#idxView")) return;
    $("#idxPicker").addEventListener("click", e => { const b = e.target.closest("[data-name]"); if (b) pick(b.dataset.name); });
    $("#idxFilters").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } });
    $("#idxQ").addEventListener("input", () => render());
    $("#idxRows").addEventListener("change", e => { const c = e.target.closest("[data-sel]"); if (!c) return; c.checked ? sel.add(c.dataset.sel) : sel.delete(c.dataset.sel); $("#idxAdd").disabled = !sel.size; $("#idxAdd").textContent = sel.size ? `＋ Add ${sel.size} to watchlist` : "＋ Add selected to watchlist"; });
    $("#idxAll").addEventListener("change", e => { for (const r of shown()) if (!r.watching) e.target.checked ? sel.add(r.symbol) : sel.delete(r.symbol); render(); });
    $("#idxRows").addEventListener("click", e => {
      const a = e.target.closest("[data-add]"); if (a) { addSyms([a.dataset.add]); return; }
      const tr = e.target.closest("tr[data-sym]"); if (tr && !e.target.closest("button, input") && typeof window.openStockSheet === "function" && view.rows.find(r => r.symbol === tr.dataset.sym)?.watching) window.openStockSheet(tr.dataset.sym);
    });
    document.querySelectorAll(".idx-table th[data-k]").forEach(th => { th.tabIndex = 0; th.title = "Sort"; th.onclick = () => { sort = { k: th.dataset.k, dir: sort.k === th.dataset.k ? -sort.dir : (th.dataset.k === "name" ? 1 : -1) }; render(); }; });
    $("#idxAdd").onclick = () => addSyms([...sel]);
    $("#idxValue").onclick = async () => { try { const r = await api("/api/indices/value", { name: current }); view.valueJob = r.valueJob; render(); window.toast?.(`Fetching fundamentals for ${r.valueJob.total} stocks, largest first. Scores fill in as they arrive.`, { kind: "ok", ms: 6000 }); } catch (e) { window.toast?.(e.message, { kind: "error" }); } };
    $("#idxAsk").onclick = () => window.askAI?.(`From the ${current} index, which stocks are really worth adding to my watchlist right now, and which to avoid? Use the index_stocks tool. Consider what I already hold (avoid doubling up on the same sector), valuation, momentum and trend. Give a shortlist of 5–8 with one line each.`, { symbol: "", where: "Smart indices" });
    $("#idxImport").onclick = () => importCsv();
  });
})();
