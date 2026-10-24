// Bucket strategy: your net worth split into Safety / Short term / Long-term growth / Retirement, with the safety bucket
// sized in months of expenses, goals (house, kids' education) and a "move to" for every line. Reads /api/buckets.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  const CAT = { stocks: "Stocks", mf: "Mutual fund", epf: "EPF / PF", ppf: "PPF", nps: "NPS", gold: "Gold", realestate: "Real estate", fd: "Fixed deposit", bonds: "Bonds / debt", cash: "Bank & cash", intl: "US / global", crypto: "Crypto", insurance: "Insurance", other: "Other" };
  let d = null;
  async function load() { try { d = await api("/api/buckets"); render(); } catch (e) { $("#bkBody").innerHTML = `<p class="hint">Could not load your buckets: ${esc(e.message)}</p>`; } }
  async function save(body, msg) { try { d = await api("/api/buckets/save", body); render(); if (msg) window.toast?.(msg, { kind: "ok", ms: 2500 }); } catch (e) { window.toast?.(esc(e.message), { kind: "bad" }); } }
  const moveSel = r => `<select class="ui-input bk-move" data-move="${esc(r.id)}" aria-label="Bucket for ${esc(r.name)}">${[...d.BUCKETS.map(b => [b.id, `${b.icon} ${b.label}`]), ["none", "Not in a bucket"]].map(([k, l]) => `<option value="${k}"${k === r.bucket ? " selected" : ""}>${l}${k === r.auto ? " (auto)" : ""}</option>`).join("")}</select>`;
  const goalSel = r => `<select class="ui-input bk-goal" data-goal="${esc(r.id)}" aria-label="Goal for ${esc(r.name)}"><option value="">No goal</option>${d.goalsList.map(g => `<option value="${esc(g.id)}"${g.id === r.goal ? " selected" : ""}>🎯 ${esc(g.name)}</option>`).join("")}</select>`;
  const lineRow = r => `<tr><td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(CAT[r.category] || r.category)}${r.fundCategory ? ` · ${esc(r.fundCategory.replace(/^\w+ Scheme - /, ""))}` : ""}${r.moved ? " · moved by you" : ""}</div></td><td class="num"><b>${amt(r.value)}</b></td><td>${goalSel(r)}</td><td>${moveSel(r)}</td></tr>`;
  function render() {
    const S = d.buckets.find(b => b.id === "safety");
    if (!d.total && !d.outside.length) { $("#bkSum").innerHTML = ""; $("#bkBody").innerHTML = '<p class="nw-empty-row">Your net worth is empty. Add or sync your assets in <button type="button" class="linklike" data-go="networth">Net worth</button> and they are sorted into buckets here.</p>'; return; }
    $("#bkSum").innerHTML = `<div class="bk-tiles">${d.buckets.map(b => `<a class="bk-tile bk-${b.id}" href="#" data-jump="${b.id}"><span>${b.icon} ${esc(b.label)}</span><strong>${amt(b.value)}</strong><small>${b.pct}% of your buckets${b.target !== null ? ` · target ${b.target}%` : ""}</small>${b.id === "safety" ? `<i class="bk-range" title="Your range: ${d.plan.minMonths}–${d.plan.maxMonths} months"><b style="width:${Math.min(100, (S.months || 0) / Math.max(1, d.plan.maxMonths) * 100)}%"></b><u style="left:${d.plan.minMonths / Math.max(1, d.plan.maxMonths) * 100}%"></u></i><small class="bk-${S.status}">${S.months} months of expenses (${amt(d.plan.monthly)}/month)</small>` : ""}</a>`).join("")}</div>`;
    const acts = d.actions.length ? `<section class="report-card bk-acts">${d.actions.map(a => `<p class="bk-act ${a.tone}">${a.tone === "warn" ? "⚠️" : a.tone === "ok" ? "✅" : "💡"} ${esc(a.text)}</p>`).join("")}</section>` : "";
    const goals = `<section class="report-card bk-goals"><div class="nw-head"><h3>🎯 Goals <span class="hint">tag a line with a goal to track it</span></h3><button type="button" class="ghost" data-goals>Edit goals</button></div><div class="bk-glist">${d.goals.map(g => `<div class="bk-g"><b>${esc(g.name)}</b>${g.year ? ` <span class="hint">by ${g.year}</span>` : ""}<div>${amt(g.value)}${g.target ? ` of ${amt(g.target)}` : ""}</div>${g.progress !== null ? `<i class="bk-prog"><b style="width:${g.progress}%"></b></i><small>${g.progress}%</small>` : `<small class="hint">${g.lines.length ? esc(g.lines.join(", ")) : "No lines tagged yet"}</small>`}</div>`).join("") || '<p class="hint">No goals yet.</p>'}</div></section>`;
    $("#bkBody").innerHTML = acts + d.buckets.map(b => `<section class="report-card bk-sec bk-${b.id}" id="bk-${b.id}"><div class="nw-head"><h3>${b.icon} ${esc(b.label)} <span class="hint">${amt(b.value)} · ${b.pct}%</span></h3><span class="hint">${esc(b.blurb)}</span></div>
      ${b.lines.length ? `<div class="table-wrap"><table class="bk-table"><thead><tr><th>What</th><th class="num">Value</th><th>Goal</th><th>Bucket</th></tr></thead><tbody>${b.lines.map(lineRow).join("")}</tbody></table></div>` : `<p class="hint">Nothing here yet.${b.id === "safety" ? " Add your bank balance, FDs or a liquid / arbitrage fund in Net worth." : b.id === "retirement" ? " Add your EPF and NPS in Net worth." : ""}</p>`}</section>`).join("") + goals
      + (d.outside.length ? `<section class="report-card bk-sec"><div class="nw-head"><h3>🏠 Not in a bucket <span class="hint">${amt(d.outside.reduce((a, r) => a + r.value, 0))}</span></h3><span class="hint">Your home, vehicles, insurance… move a line into a bucket if it is money for a goal.</span></div><div class="table-wrap"><table class="bk-table"><tbody>${d.outside.map(lineRow).join("")}</tbody></table></div></section>` : "");
    $("#bkNotes").innerHTML = `<p class="vs-fine">Lines are placed by type: bank, FDs, liquid / arbitrage funds → Safety; PPF, balanced advantage / hybrid / flexi-cap and debt funds → Short term; stocks, other equity funds, US stocks, crypto, gold → Long-term growth; EPF, NPS → Retirement. Change any line with its Bucket menu (remembered). Values come from Net worth. Private to your login.</p>`;
  }
  async function settings() {
    const t = d.plan.targets || {};
    const out = await window.ui.dialog({ title: "Bucket settings", icon: "🛟", okText: "Save", wide: true,
      bodyHtml: `<div class="lt-form"><label class="ui-field"><span>Monthly expenses (₹)</span><input class="ui-input" name="monthly" inputmode="numeric" value="${d.plan.monthly}"></label>
        <label class="ui-field"><span>Safety: at least (months)</span><input class="ui-input" name="minMonths" inputmode="numeric" value="${d.plan.minMonths}"></label>
        <label class="ui-field"><span>Safety: at most (months)</span><input class="ui-input" name="maxMonths" inputmode="numeric" value="${d.plan.maxMonths}"></label>
        <label class="ui-field"><span>Short term target (% of buckets, optional)</span><input class="ui-input" name="short" inputmode="decimal" value="${t.short ?? ""}"></label>
        <label class="ui-field"><span>Long-term growth target (%)</span><input class="ui-input" name="long" inputmode="decimal" value="${t.long ?? ""}"></label>
        <label class="ui-field"><span>Retirement target (%)</span><input class="ui-input" name="retirement" inputmode="decimal" value="${t.retirement ?? ""}"></label></div>
        ${d.spend ? `<p class="hint">Your Monthly expenses tracker shows about ${amt(d.spend.avgMonthly)} a month of planned spending (last ${d.spend.months} month${d.spend.months === 1 ? "" : "s"}).</p>` : ""}`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return { monthly: v("monthly"), minMonths: v("minMonths"), maxMonths: v("maxMonths"), targets: { short: v("short"), long: v("long"), retirement: v("retirement") } }; } });
    if (out) save(out, "Bucket settings saved.");
  }
  async function editGoals() {
    const rows = g => `<tr><td><input class="ui-input" data-f="name" value="${esc(g.name || "")}" placeholder="e.g. House"></td><td><input class="ui-input" data-f="target" inputmode="numeric" value="${g.target ?? ""}" placeholder="₹ target"></td><td><input class="ui-input" data-f="year" inputmode="numeric" value="${g.year ?? ""}" placeholder="year"></td><td><button type="button" class="ghost" data-rm-g>✕</button></td></tr>`;
    const out = await window.ui.dialog({ title: "Goals", icon: "🎯", okText: "Save", wide: true,
      bodyHtml: `<table class="bk-gedit"><thead><tr><th>Goal</th><th>Target (₹)</th><th>By year</th><th></th></tr></thead><tbody>${d.goalsList.map(g => rows(g).replace("<tr>", `<tr data-id="${esc(g.id)}">`)).join("")}</tbody></table><button type="button" class="ghost" data-add-g>+ Add a goal</button>`,
      onOpen: box => { box.addEventListener("click", e => { if (e.target.closest("[data-add-g]")) box.querySelector(".bk-gedit tbody").insertAdjacentHTML("beforeend", rows({})); const rm = e.target.closest("[data-rm-g]"); if (rm) rm.closest("tr").remove(); }); },
      collect: box => ({ goals: [...box.querySelectorAll(".bk-gedit tbody tr")].map(tr => ({ id: tr.dataset.id || undefined, name: tr.querySelector("[data-f=name]").value, target: tr.querySelector("[data-f=target]").value, year: tr.querySelector("[data-f=year]").value })).filter(g => g.name.trim()) }) });
    if (out) save(out, "Goals saved.");
  }
  const init = () => {
    const v = $("#bkView"); if (!v) return;
    v.addEventListener("change", e => {
      const m = e.target.closest("[data-move]"); if (m) { const r = [...d.buckets.flatMap(b => b.lines), ...d.outside].find(x => x.id === m.dataset.move); save({ assign: { [m.dataset.move]: m.value === r?.auto ? "auto" : m.value } }, "Moved."); return; }
      const g = e.target.closest("[data-goal]"); if (g) save({ goalOf: { [g.dataset.goal]: g.value || null } }, g.value ? "Goal tagged." : "Goal removed.");
    });
    v.addEventListener("click", e => {
      const j = e.target.closest("[data-jump]"); if (j) { e.preventDefault(); document.getElementById(`bk-${j.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
      if (e.target.closest("[data-bk-settings]")) { settings(); return; }
      if (e.target.closest("[data-goals]")) { editGoals(); return; }
      if (e.target.closest("#bkReload")) { load(); return; }
      const go = e.target.closest("[data-go]"); if (go && typeof setView === "function") setView(go.dataset.go);
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init(); // loaded on demand (app.js LAZY_VIEWS)
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.buckets = () => load();
})();
