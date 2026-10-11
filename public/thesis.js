// Thesis tab: write the reason you own a stock plus measurable "holds while" conditions; shows which are still true.
(() => {
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const api = async (path, opts) => { const r = await fetch(path, opts); const x = await r.json().catch(() => ({})); if (!r.ok) throw new Error(x.message || `HTTP ${r.status}`); return x; };
  const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const OPSHOW = { ">=": "≥", "<=": "≤", ">": ">", "<": "<" };
  let view = null, stocks = [], conds = [];
  const metricOf = k => view?.metrics.find(m => m.key === k);
  const chip = s => `<span class="chip ${s === "Broken" ? "v-rich" : s === "Intact" ? "v-under" : "v-none"}">${s === "Unassessed" ? "No data yet" : s}</span>`;
  const fmt = (v, unit) => v === null || v === undefined ? "no data" : `${v}${unit === "%" || unit === "pts" ? (unit === "%" ? "%" : " pts") : unit === "x" ? "x" : ""}`;
  const condText = c => { const m = metricOf(c.metric); return `${esc(m?.label || c.metric)} ${OPSHOW[c.op] || c.op} ${c.value}${m?.unit === "%" ? "%" : m?.unit === "pts" ? " pts" : m?.unit === "x" ? "x" : ""}`; };

  function renderForm() {
    $("#thConds").innerHTML = conds.length ? `<ul class="flag-list">${conds.map((c, i) => `<li><div class="fcompany">Holds while ${condText(c)}</div><div class="fnote"><button type="button" class="ghost" data-del="${i}">Remove</button></div></li>`).join("")}</ul>` : '<p class="hint">No conditions yet. Add the numbers that would prove your reason wrong.</p>';
  }
  function fillStatic() {
    $("#thAddMetric").innerHTML = view.metrics.map(m => `<option value="${m.key}" title="${esc(m.hint)}">${esc(m.label)}${m.unit ? ` (${m.unit})` : ""}</option>`).join("");
    $("#thAddOp").innerHTML = view.ops.map(o => `<option value="${o}">holds while ${OPSHOW[o]}</option>`).join("");
    $("#thPresets").innerHTML = view.presets.map((p, i) => `<button type="button" class="ghost" data-preset="${i}">${condText(p)}</button>`).join(" ");
    const have = new Set(view.rows.map(r => r.symbol));
    $("#thStock").innerHTML = '<option value="">Choose a stock…</option>' + stocks.map(s => { const sym = (s.marketSymbol || s.ticker || "").toUpperCase(); return `<option value="${esc(sym)}">${esc(s.company)} (${esc(sym)})${have.has(sym) ? " ✓" : ""}</option>`; }).join("");
  }
  function renderList() {
    const t = view.summary;
    $("#thCards").innerHTML = `<div><span>With a thesis</span><strong>${t.total}</strong></div><div><span>Thesis broken</span><strong class="${t.broken ? "avoid" : ""}">${t.broken}</strong></div><div><span>Broken &amp; held</span><strong class="${t.brokenAndHeld ? "avoid" : ""}">${t.brokenAndHeld}</strong></div><div><span>Stocks without a thesis</span><strong>${t.withoutThesis}</strong></div>`;
    $("#thList").innerHTML = view.rows.length ? view.rows.map(r => `<div class="report-card" style="margin-top:12px;${r.status === "Broken" ? "border-left:4px solid #b13c35" : ""}">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><h3 style="margin:0">${esc(r.company)} <small>${esc(r.symbol)}</small></h3>${chip(r.status)}${r.held ? '<span class="chip v-fair">Held (synced broker)</span>' : ""}<span style="flex:1"></span><button type="button" class="ghost" data-edit="${esc(r.symbol)}">Edit</button><button type="button" class="ghost" data-remove="${esc(r.symbol)}">Delete</button></div>
      ${r.reasons ? `<p style="margin:8px 0">${esc(r.reasons)}</p>` : ""}
      <ul class="flag-list">${r.conditions.map(c => `<li><div class="fcompany">${c.state === "broken" ? "✗" : c.state === "ok" ? "✓" : "…"} Holds while ${condText(c)}</div><div class="fnote ${c.state === "broken" ? "avoid" : ""}">Now: ${esc(fmt(c.actual, c.unit))}${c.state === "broken" && c.brokenSince ? ` · broken since ${new Date(c.brokenSince).toLocaleDateString("en-IN")}` : ""}${c.state === "nodata" ? " · fetch fundamentals on the Valuation tab" : ""}</div></li>`).join("") || '<li><div class="fnote">No measurable conditions: add some so this can be checked.</div></li>'}</ul>
      <p class="hint" style="margin:6px 0 0">Fundamentals as of ${esc(r.dataAsOf || "never fetched")}. Stale data can hide a break; refresh before acting.</p></div>`).join("") : '<p class="hint" style="margin-top:14px">No theses yet. Pick a stock above, write why you own it, and add the conditions that would prove you wrong.</p>';
  }
  async function load() {
    try { [view, stocks] = await Promise.all([api("/api/thesis"), api("/api/stocks").then(x => x.stocks || [])]); } catch (e) { $("#thList").innerHTML = `<p class="hint">Failed: ${esc(e.message)}</p>`; return; }
    stocks.sort((a, b) => a.company.localeCompare(b.company)); fillStatic(); renderList(); renderForm();
  }
  const status = (m, bad) => { $("#thStatus").textContent = m; $("#thStatus").className = bad ? "hint avoid" : "hint"; };
  function addCond(c) { conds.push({ metric: c.metric, op: c.op, value: Number(c.value) }); renderForm(); }
  function clearForm() { conds = []; $("#thStock").value = ""; $("#thReasons").value = ""; renderForm(); status(""); }

  $("#thAddBtn").onclick = () => { const v = $("#thAddValue").value; if (v === "" || !Number.isFinite(Number(v))) return status("Enter a number for the condition.", true); status(""); addCond({ metric: $("#thAddMetric").value, op: $("#thAddOp").value, value: v }); $("#thAddValue").value = ""; };
  $("#thPresets").onclick = e => { const i = e.target.dataset?.preset; if (i !== undefined) addCond(view.presets[i]); };
  $("#thConds").onclick = e => { const i = e.target.dataset?.del; if (i !== undefined) { conds.splice(Number(i), 1); renderForm(); } };
  $("#thClear").onclick = clearForm;
  $("#thSave").onclick = async () => {
    const symbol = $("#thStock").value; if (!symbol) return status("Choose a stock first.", true);
    try { view = await post("/api/thesis/save", { symbol, reasons: $("#thReasons").value, conditions: conds }); fillStatic(); $("#thStock").value = symbol; renderList(); status("Saved."); }
    catch (e) { status(e.message, true); }
  };
  $("#thList").onclick = async e => {
    const edit = e.target.dataset?.edit, rem = e.target.dataset?.remove;
    if (edit) { const r = view.rows.find(x => x.symbol === edit); conds = r.conditions.map(({ id, metric, op, value }) => ({ id, metric, op, value })); $("#thStock").value = edit; $("#thReasons").value = r.reasons || ""; renderForm(); $("#thForm").open = true; $("#thForm").scrollIntoView({ behavior: "smooth" }); }
    if (rem && await window.ui.confirm({ title: `Delete the thesis for ${rem}?`, okText: "Delete", danger: true })) { view = await post("/api/thesis/remove", { symbol: rem }); fillStatic(); renderList(); }
  };
  window.loadThesis = load;
})();
