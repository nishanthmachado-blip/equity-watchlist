// Monthly expenses: each month's income and budget (needs / wants / investments / unplanned, bank, done), a daily
// spend log (item, amount, how you paid, category guessed and learned), and the April–March year report. Private to
// your login. Reads /api/expenses.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : inr(v));
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  const ist = () => new Date(Date.now() + 19800e3).toISOString();
  const monName = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
  const lastDay = m => { const [yy, mo] = m.split("-").map(Number); return `${m}-${String(new Date(Date.UTC(yy, mo, 0)).getUTCDate()).padStart(2, "0")}`; };
  const shiftM = (m, n) => { const [y, mo] = m.split("-").map(Number), d = new Date(Date.UTC(y, mo - 1 + n, 1)); return d.toISOString().slice(0, 7); };
  const TYPE_ICON = { needs: "🧱", wants: "🎈", invest: "📈", unplanned: "⚡" };
  let month = (() => { try { return localStorage.getItem("exp-month") || ist().slice(0, 7); } catch { return ist().slice(0, 7); } })(), tab = "month", d = null, y = null;
  const remember = () => { try { localStorage.setItem("exp-month", month); } catch { /* private mode */ } };
  async function load() {
    $("#exMonth").textContent = monName(month); $("#exTabs").querySelectorAll("[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    try {
      if (tab === "year") { y = await api(`/api/expenses/year?month=${month}`); renderYear(); }
      else { d = await api(`/api/expenses?month=${month}`); render(); }
    } catch (e) { $("#exBody").innerHTML = `<p class="hint">Could not load: ${esc(e.message)}</p>`; }
  }
  const post = async (op, body, msg) => { try { d = await api(`/api/expenses/${op}`, { month, ...body }); render(); if (msg || d.notice) window.toast?.(esc(msg || d.notice), { kind: "ok", ms: 3000 }); return true; } catch (e) { window.toast?.(esc(e.message), { kind: "bad" }); return false; } };
  const bars = (list, total, label = x => x.key) => `<ul class="ex-bars">${list.map(x => `<li><span>${label(x)}</span><i><b style="width:${total > 0 ? Math.min(100, x.amount / total * 100) : 0}%"></b></i><em>${inr(x.amount)} <small>${x.pct}%</small></em></li>`).join("")}</ul>`;
  const shareOpts = (cur = "") => `<option value="">Just me</option>${(d.people || []).map(p => `<option value="owe:${esc(p)}"${cur === `owe:${p}` ? " selected" : ""}>${esc(p)} paid · I owe</option><option value="owed:${esc(p)}"${cur === `owed:${p}` ? " selected" : ""}>I paid for ${esc(p)} · owes me</option>`).join("")}`;
  const shareBody = (v, amount) => { if (!v) return undefined; const [dir, ...rest] = v.split(":"); return { person: rest.join(":"), dir, amount }; };
  const shareMap = () => { const mp = new Map(); for (const p of d.settle || []) { for (const x of p.owe) mp.set(x.id, { person: p.person, dir: "owe", amount: x.amount, of: x.of }); for (const x of p.owed) mp.set(x.id, { person: p.person, dir: "owed", amount: x.amount, of: x.of }); } return mp; };
  const owesText = (person, net) => (Math.abs(net) < 1 ? `You and ${esc(person)} are even` : net > 0 ? `${esc(person)} owes you <b>${inr(net)}</b>` : `You owe ${esc(person)} <b>${inr(-net)}</b>`);
  function settleSection() {
    const ps = d.settle || [];
    if (!ps.length) return `<section class="report-card ex-settle"><h3>🤝 Settle up</h3><p class="hint">Track money between you and family or friends: who paid for what and who owes whom. Add their names in ⚙ Settings (or use a name as the "paid by" method, like Sophia), then pick "… paid · I owe" or "I paid for … · owes me" on a spend.</p></section>`;
    const li = (x, sign) => `<li><span>${esc(new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }))} · ${esc(x.item)}${x.of && x.of !== x.amount ? ` <small class="hint">(share of ${inr(x.of)})</small>` : ""}</span><b>${sign}${inr(x.amount)}</b></li>`;
    return `<section class="report-card ex-settle"><div class="nw-head"><h3>🤝 Settle up <span class="hint">${esc(monName(month))} and the running balance</span></h3></div>${ps.map(p => `<div class="ex-sp" data-person="${esc(p.person)}">
      <div class="ex-snet ${Math.abs(p.net) < 1 ? "even" : p.net > 0 ? "in" : "out"}"><div><span>Overall till ${esc(monName(month))}</span><strong>${owesText(p.person, p.net)}</strong>${p.before ? `<small>${p.before > 0 ? `${esc(p.person)} owed you ${inr(p.before)}` : `you owed ${esc(p.person)} ${inr(-p.before)}`} from earlier months · this month ${p.monthNet >= 0 ? "+" : "−"}${inr(Math.abs(p.monthNet))}</small>` : "<small>Nothing carried from earlier months</small>"}</div>
        <div class="ex-sbtn">${Math.abs(p.net) >= 1 ? `<button type="button" data-settle="${esc(p.person)}" data-amt="${Math.abs(p.net)}" data-dir="${p.net < 0 ? "paid" : "received"}">${p.net < 0 ? `✓ I paid ${esc(p.person)} ${inr(-p.net)}` : `✓ ${esc(p.person)} paid me ${inr(p.net)}`}</button>` : ""}<button type="button" class="ghost" data-settle="${esc(p.person)}">+ Record a payment</button></div></div>
      <div class="ex-scols"><div><h4>${esc(p.person)} paid · you owe <span>${inr(p.totals.owe)}</span></h4><ul>${p.owe.map(x => li(x, "")).join("") || '<li class="hint">Nothing this month</li>'}</ul></div>
        <div><h4>You paid for ${esc(p.person)} · owes you <span>${inr(p.totals.owed)}</span></h4><ul>${p.owed.map(x => li(x, "")).join("") || '<li class="hint">Nothing this month</li>'}</ul></div>
        <div><h4>Payments between you <span>${inr(p.totals.paid + p.totals.received)}</span></h4><ul>${p.payments.map(x => `<li><span>${esc(new Date(`${x.date}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }))} · ${x.dir === "paid" ? `You paid ${esc(p.person)}` : `${esc(p.person)} paid you`}${x.note ? ` <small class="hint">${esc(x.note)}</small>` : ""}</span><b>${inr(x.amount)}</b><button type="button" class="ghost ex-rm" data-sdel="${esc(x.id)}" aria-label="Delete payment">✕</button></li>`).join("") || '<li class="hint">None this month</li>'}</ul></div></div>
      <p class="ex-sline">This month: ${owesText(p.person, p.monthNet)} <span class="hint">(${inr(p.totals.owed)} for ${esc(p.person)} − ${inr(p.totals.owe)} paid by ${esc(p.person)}${p.totals.paid ? ` + ${inr(p.totals.paid)} you paid back` : ""}${p.totals.received ? ` − ${inr(p.totals.received)} paid to you` : ""})</span></p></div>`).join("")}
      <p class="vs-fine">Spends paid by a person (their name as "Paid by") count as "you owe them" automatically. Change it, or split it (e.g. half), with ✎ on the spend. These spends still count in your monthly spending.</p></section>`;
  }
  function render() {
    const m = d.data, s = d.summary;
    if (!m) {
      $("#exBody").innerHTML = `<div class="report-card ex-empty"><h3>${esc(monName(month))} isn't started yet</h3><p>Start it to copy your income and budget from ${d.template ? `your standard monthly budget (${d.template.lines} lines)` : d.months.length ? "your last month" : "scratch"}, then log what you spend day by day. Or paste straight from your spreadsheet: the budget block (Rent 47500 HDFC Expense NEEDS DONE…) and / or the daily list (date, item, amount, with Pluxee / GPay / Credit card columns).</p>
        <div class="toolbar"><button type="button" data-ex="start">▶ Start ${esc(monName(month))}</button><button type="button" class="ghost" data-ex="paste">📋 Paste from my sheet</button></div></div>`; return;
    }
    const cats = d.categories, catOpt = cur => `<option value="">Auto</option>${cats.map(c => `<option value="${esc(c.key)}"${c.key === cur ? " selected" : ""}>${c.icon} ${esc(c.key)}</option>`).join("")}`;
    const today = ist().slice(0, 10), defDay = today.slice(0, 7) === month ? today : `${month}-01`;
    const tiles = [["Income", inr(s.income), ""], ["Budgeted", inr(s.plannedTotal), `needs ${amt(s.planned.needs)} · wants ${amt(s.planned.wants)} · invest ${amt(s.planned.invest)}${s.planned.unplanned ? ` · unplanned ${amt(s.planned.unplanned)}` : ""}`], ["Saved", inr(s.saved), s.income ? `${Math.round(s.saved / s.income * 100)}% of income` : ""], ["Day-to-day spends", inr(s.spent), `${s.entries} entries · wants ${s.wantsPct}%`]];
    const plan = m.plan.length ? `<table class="ex-plan"><tbody>${["needs", "wants", "invest", "unplanned"].map(t => { const rows = m.plan.filter(p => p.type === t); return rows.length ? `<tr class="ex-ph"><th colspan="4">${TYPE_ICON[t]} ${esc(d.planTypes[t])} <span class="hint">${inr(s.planned[t])}</span></th></tr>${rows.map(p => `<tr class="${p.done ? "ex-done" : ""}"><td><label class="ex-chk"><input type="checkbox" data-done="${esc(p.id)}"${p.done ? " checked" : ""}> ${esc(p.name)}</label></td><td class="num">${p.amount !== null ? inr(p.amount) : '<span class="hint">—</span>'}</td><td class="hint">${esc(p.bank || "")}</td><td>${p.done ? '<span class="ex-tag">done</span>' : ""}</td></tr>`).join("")}` : ""; }).join("")}</tbody></table>` : '<p class="hint">No budget lines yet.</p>';
    const vb = s.vsBudget.length ? `<h4>Budget vs spent</h4>${s.vsBudget.map(v => `<div class="ex-vb"><span>${esc(v.name)}</span><i><b class="${v.pct > 100 ? "over" : v.pct > 85 ? "near" : ""}" style="width:${Math.min(100, v.pct)}%"></b></i><em>${inr(v.spent)} of ${inr(v.budget)} <small class="${v.left < 0 ? "pl-dn" : ""}">${v.left < 0 ? `${inr(-v.left)} over` : `${inr(v.left)} left`}</small></em></div>`).join("")}` : "";
    const shares = shareMap();
    const byDay = new Map(); for (const e of m.entries) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
    const log = [...byDay].sort((a, b) => b[0].localeCompare(a[0])).map(([day, es]) => `<div class="ex-day"><div class="ex-dh"><b>${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}</b><span>${inr(es.reduce((a, e) => a + e.amount, 0))}</span></div>${es.map(e => `<div class="ex-e" data-eid="${esc(e.id)}"><span class="ex-ci" title="${esc(e.category)}">${cats.find(c => c.key === e.category)?.icon || "📦"}</span><span class="ex-it">${esc(e.item)}<small>${esc(e.category)}${e.note ? ` · ${esc(e.note)}` : ""}</small></span><span class="ex-md">${esc(e.mode || "")}${(sh => (sh ? `<em class="ex-share ${sh.dir}">🤝 ${sh.dir === "owe" ? `owe ${esc(sh.person)}` : `${esc(sh.person)} owes`}${sh.amount !== sh.of ? ` ${inr(sh.amount)}` : ""}</em>` : ""))(shares.get(e.id))}</span><b>${inr(e.amount)}</b><button type="button" class="ghost ex-ed" data-edit="${esc(e.id)}" aria-label="Edit">✎</button><button type="button" class="ghost ex-rm" data-del="${esc(e.id)}" aria-label="Delete">✕</button></div>`).join("")}</div>`).join("");
    $("#exBody").innerHTML = `<div class="ex-tiles">${tiles.map(([k, v, sub]) => `<div><span>${k}</span><strong>${v}</strong>${sub ? `<small>${esc(sub)}</small>` : ""}</div>`).join("")}</div>
      <div class="ex-grid">
        <section class="report-card ex-log"><div class="nw-head"><h3>🧾 Daily spends</h3><span class="hint">${s.entries} · ${inr(s.spent)}</span></div>
          <form class="ex-add" data-add autocomplete="off"><input class="ui-input" type="date" name="date" value="${defDay}" min="${month}-01" max="${lastDay(month)}" aria-label="Date"><input class="ui-input" name="item" list="exItems" placeholder="What (e.g. Milk, Grocery, Petrol)" required aria-label="Item"><input class="ui-input" name="amount" inputmode="decimal" placeholder="₹" required aria-label="Amount"><select class="ui-input" name="mode" aria-label="Paid by">${d.modes.map((x, i) => `<option${i === 0 ? " selected" : ""}>${esc(x)}</option>`).join("")}</select><select class="ui-input" name="category" aria-label="Category">${catOpt("")}</select>${(d.people || []).length ? `<select class="ui-input" name="share" aria-label="Shared with">${shareOpts()}</select>` : ""}<button type="submit">Add</button></form>
          <datalist id="exItems">${d.items.map(i => `<option value="${esc(i)}">`).join("")}</datalist>
          <div class="ex-days">${log || '<p class="hint">Nothing logged yet. Add a spend above, or paste your list.</p>'}</div></section>
        <aside>
          <section class="report-card"><div class="nw-head"><h3>📋 Budget</h3><button type="button" class="ghost" data-ex="plan">Edit</button></div>
            <p class="hint ex-std">${d.template ? `⭐ Standard monthly budget: ${d.template.lines} lines, used for every new month · <button type="button" class="linklike" data-ex="apply-std">reset this month to it</button>` : 'Tip: in Edit, tick "standard monthly budget" and every new month starts with these lines.'}</p>
            <p class="hint">Income: ${m.income.map(i => `${esc(i.name)} ${inr(i.amount)}`).join(" · ") || "—"}</p>${plan}${s.pending.length ? `<p class="hint">Still to pay: ${s.pending.map(p => `${esc(p.name)} ${inr(p.amount)}`).join(", ")}</p>` : ""}${vb}</section>
          ${s.byCategory.length ? `<section class="report-card"><h3>Where it went</h3>${bars(s.byCategory, s.spent, x => `${x.icon} ${esc(x.key)}`)}<h4>Paid by</h4>${bars(s.byMode, s.spent, x => esc(x.key))}</section>` : ""}
        </aside></div>${settleSection()}`;
  }
  function renderYear() {
    const r = y, max = Math.max(1, ...r.rows.map(x => Math.max(x.plannedTotal, x.spent, x.income)));
    if (!r.totals.months) { $("#exBody").innerHTML = `<p class="nw-empty-row">Nothing tracked in ${esc(r.fy)} yet.</p>`; return; }
    const mm = k => new Date(`${k}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
    $("#exBody").innerHTML = `<div class="ex-tiles"><div><span>${esc(r.fy)} income</span><strong>${amt(r.totals.income)}</strong><small>${r.totals.months} month${r.totals.months === 1 ? "" : "s"} tracked</small></div><div><span>Budgeted</span><strong>${amt(r.totals.plannedTotal)}</strong><small>needs ${amt(r.totals.needs)} · wants ${amt(r.totals.wants)} · invest ${amt(r.totals.invest)}</small></div><div><span>Saved</span><strong>${amt(r.totals.saved)}</strong><small>${r.totals.income ? `${Math.round(r.totals.saved / r.totals.income * 100)}% of income` : ""}</small></div><div><span>Day-to-day spends</span><strong>${amt(r.totals.spent)}</strong><small>${inr(r.avgSpent)} a month on average</small></div></div>
      <section class="report-card"><h3>Month by month</h3><div class="ex-chart">${r.rows.map(x => `<div class="ex-col${x.has ? "" : " empty"}" title="${esc(monName(x.month))}: budget ${inr(x.plannedTotal)}, daily spends ${inr(x.spent)}, saved ${inr(x.saved)}"><div class="ex-colbars"><i class="b" style="height:${x.plannedTotal / max * 100}%"></i><i class="s" style="height:${x.spent / max * 100}%"></i></div><span>${mm(x.month)}</span></div>`).join("")}</div><p class="hint"><i class="ex-key b"></i> budgeted &nbsp; <i class="ex-key s"></i> day-to-day spends</p></section>
      <section class="report-card"><h3>Where it went: category by month</h3><div class="table-wrap"><table class="ex-year"><thead><tr><th>Category</th>${r.months.map(k => `<th class="num">${mm(k)}</th>`).join("")}<th class="num">Total</th><th class="num">%</th></tr></thead><tbody>${r.categories.map(c => `<tr><td>${c.icon} ${esc(c.key)}</td>${c.perMonth.map(v => `<td class="num">${v ? inr(v) : '<span class="hint">·</span>'}</td>`).join("")}<td class="num"><b>${inr(c.amount)}</b></td><td class="num">${c.pct}%</td></tr>`).join("")}<tr class="ex-tot"><td>Total</td>${r.rows.map(x => `<td class="num">${x.spent ? inr(x.spent) : ""}</td>`).join("")}<td class="num"><b>${inr(r.totals.spent)}</b></td><td></td></tr></tbody></table></div></section>
      <div class="ex-grid2"><section class="report-card"><h3>Top categories</h3>${bars(r.categories.slice(0, 10), r.totals.spent, x => `${x.icon} ${esc(x.key)}`)}</section><section class="report-card"><h3>Paid by</h3>${bars(r.byMode, r.totals.spent, x => esc(x.key))}</section></div>
      <p class="hint"><a href="/api/expenses/export.csv" download>⬇ Download every spend (CSV)</a></p>`;
  }
  // ---- dialogs ----
  async function editPlan() {
    const m = d.data, row = p => `<tr data-id="${esc(p.id || "")}"><td><input class="ui-input" data-f="name" value="${esc(p.name || "")}" placeholder="e.g. Rent"></td><td><input class="ui-input" data-f="amount" inputmode="numeric" value="${p.amount ?? ""}" placeholder="₹"></td><td><input class="ui-input" data-f="bank" value="${esc(p.bank || "")}" placeholder="Bank"></td><td><select class="ui-input" data-f="type">${Object.entries(d.planTypes).map(([k, l]) => `<option value="${k}"${k === (p.type || "needs") ? " selected" : ""}>${l}</option>`).join("")}</select></td><td><input type="checkbox" data-f="done"${p.done ? " checked" : ""} aria-label="Done"></td><td><button type="button" class="ghost" data-rm>✕</button></td></tr>`;
    const inc = i => `<tr data-id="${esc(i.id || "")}"><td><input class="ui-input" data-f="name" value="${esc(i.name || "")}" placeholder="e.g. Salary in hand"></td><td><input class="ui-input" data-f="amount" inputmode="numeric" value="${i.amount ?? ""}"></td><td><button type="button" class="ghost" data-rm>✕</button></td></tr>`;
    const out = await window.ui.dialog({ title: `Budget: ${monName(month)}`, icon: "📋", okText: "Save", wide: true,
      bodyHtml: `<h4>Income</h4><table class="ex-edit ex-inc"><tbody>${m.income.map(inc).join("")}</tbody></table><button type="button" class="ghost" data-add-inc>+ Income</button>
        <h4>Budget lines</h4><div class="table-wrap"><table class="ex-edit ex-pl"><thead><tr><th>Line</th><th>Amount</th><th>Bank</th><th>Type</th><th>Done</th><th></th></tr></thead><tbody>${m.plan.map(row).join("")}</tbody></table></div><button type="button" class="ghost" data-add-pl>+ Budget line</button>
        <label class="ui-opt"><input type="checkbox" name="standard"${d.template ? "" : " checked"}><span><b>${d.template ? "Also update my standard monthly budget" : "Make this my standard monthly budget"}</b><small>Every new month starts with these lines and amounts (nothing ticked as done). One-off spends go in Daily spends as they happen.</small></span></label>`,
      onOpen: box => box.addEventListener("click", e => { if (e.target.closest("[data-add-pl]")) box.querySelector(".ex-pl tbody").insertAdjacentHTML("beforeend", row({})); if (e.target.closest("[data-add-inc]")) box.querySelector(".ex-inc tbody").insertAdjacentHTML("beforeend", inc({})); const rm = e.target.closest("[data-rm]"); if (rm) rm.closest("tr").remove(); }),
      collect: box => { const f = (tr, k) => tr.querySelector(`[data-f=${k}]`); return { plan: [...box.querySelectorAll(".ex-pl tbody tr")].map(tr => ({ id: tr.dataset.id || undefined, name: f(tr, "name").value, amount: f(tr, "amount").value, bank: f(tr, "bank").value, type: f(tr, "type").value, done: f(tr, "done").checked })).filter(p => p.name.trim()), income: [...box.querySelectorAll(".ex-inc tbody tr")].map(tr => ({ id: tr.dataset.id || undefined, name: f(tr, "name").value, amount: f(tr, "amount").value || 0 })).filter(i => i.name.trim()), standard: box.querySelector("[name=standard]").checked }; } });
    if (out) post("plan", out, out.standard ? null : "Budget saved.");
  }
  async function paste() {
    const out = await window.ui.dialog({ title: `Paste into ${monName(month)}`, icon: "📋", okText: "Add", wide: true,
      message: "Copy cells from your spreadsheet. Fill either box, or both.",
      bodyHtml: `<label class="ui-field"><span>Budget block (Salary in Hand 198000, Rent 47500 HDFC Expense NEEDS DONE…): replaces this month's budget</span><textarea class="ui-input" name="plan" rows="6"></textarea></label>
        <label class="ui-opt"><input type="checkbox" name="standard" checked><span><b>Make the pasted budget my standard monthly budget</b><small>Every new month starts with it.</small></span></label>
        <label class="ui-field"><span>Daily list (date, item, amount; include the header row with Pluxee / Gpay / Credit Card so each amount gets its payment method): added to this month</span><textarea class="ui-input" name="log" rows="8"></textarea></label>`,
      collect: box => { const p = box.querySelector("[name=plan]").value, l = box.querySelector("[name=log]").value; if (!p.trim() && !l.trim()) throw new Error("Paste something first."); return { plan: p.trim() ? p : undefined, log: l.trim() ? l : undefined, standard: !!p.trim() && box.querySelector("[name=standard]").checked }; } });
    if (out) post("paste", out);
  }
  async function editEntry(e) {
    const cats = d.categories, cur = shareMap().get(e.id) || null;
    const out = await window.ui.dialog({ title: "Edit spend", icon: "✎", okText: "Save",
      bodyHtml: `<div class="lt-form"><label class="ui-field"><span>Date</span><input class="ui-input" type="date" name="date" value="${e.date}" min="${month}-01" max="${lastDay(month)}"></label><label class="ui-field"><span>Amount (₹)</span><input class="ui-input" name="amount" inputmode="decimal" value="${e.amount}"></label>
        <label class="ui-field"><span>Item</span><input class="ui-input" name="item" value="${esc(e.item)}"></label><label class="ui-field"><span>Paid by</span><select class="ui-input" name="mode">${[...new Set([...d.modes, e.mode].filter(Boolean))].map(x => `<option${x === e.mode ? " selected" : ""}>${esc(x)}</option>`).join("")}</select></label>
        <label class="ui-field"><span>Category (the app learns your choice for this item)</span><select class="ui-input" name="category">${cats.map(c => `<option value="${esc(c.key)}"${c.key === e.category ? " selected" : ""}>${c.icon} ${esc(c.key)}</option>`).join("")}</select></label><label class="ui-field"><span>Note</span><input class="ui-input" name="note" value="${esc(e.note || "")}"></label>
        ${(d.people || []).length ? `<label class="ui-field"><span>Shared with</span><select class="ui-input" name="share">${shareOpts(cur ? `${cur.dir}:${cur.person}` : "")}</select></label><label class="ui-field"><span>Their part (₹; empty = all of it)</span><input class="ui-input" name="sharePart" inputmode="decimal" value="${cur && cur.amount !== e.amount ? cur.amount : ""}" placeholder="e.g. half: ${Math.round(e.amount / 2)}"></label>` : ""}</div>`,
      collect: box => { const o = Object.fromEntries(["date", "amount", "item", "mode", "category", "note"].map(k => [k, box.querySelector(`[name=${k}]`).value])); const sv = box.querySelector("[name=share]"); if (sv) { const part = box.querySelector("[name=sharePart]").value.trim(); o.share = sv.value ? shareBody(sv.value, part || undefined) : (cur ? false : undefined); } return o; } });
    if (out) post("entry", { ...out, id: e.id }, "Saved.");
  }
  async function recordPayment(person, amount = null, dir = null) {
    const today = ist().slice(0, 10), day = today.slice(0, 7) === month ? today : lastDay(month);
    if (amount && dir) { if (await window.ui.confirm({ title: dir === "paid" ? `Paid ${person} ${inr(amount)}?` : `${person} paid you ${inr(amount)}?`, message: "Records the payment and brings the balance to zero.", okText: "Record" })) post("settle-add", { person, amount, dir, date: day, note: "Settled" }); return; }
    const out = await window.ui.dialog({ title: `Payment with ${person}`, icon: "🤝", okText: "Record",
      bodyHtml: `<label class="ui-opt"><input type="radio" name="dir" value="paid" checked><span><b>I paid ${esc(person)}</b><small>Paying back what you owe, or lending</small></span></label><label class="ui-opt"><input type="radio" name="dir" value="received"><span><b>${esc(person)} paid me</b><small>Paying you back</small></span></label>
        <div class="lt-form"><label class="ui-field"><span>Amount (₹)</span><input class="ui-input" name="amount" inputmode="decimal"></label><label class="ui-field"><span>Date</span><input class="ui-input" type="date" name="date" value="${day}" min="${month}-01" max="${lastDay(month)}"></label><label class="ui-field"><span>Note</span><input class="ui-input" name="note" placeholder="e.g. UPI"></label></div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return { person, dir: box.querySelector("[name=dir]:checked").value, amount: v("amount"), date: v("date"), note: v("note") }; } });
    if (out) post("settle-add", out);
  }
  async function moneyMap() {
    const out = await window.ui.dialog({ title: `Money Map: ${monName(month)}`, icon: "⬇", okText: "Download",
      message: "One page: responsible and bonus spending, monthly investments and your current portfolio (from Net worth), in your Money Map layout. The orange totals are live formulas, and a Details sheet shows where each number came from.",
      bodyHtml: `<label class="ui-opt"><input type="radio" name="basis" value="actual" checked><span><b>Actual spends where you logged them</b><small>Grocery, Milk, Petrol… use what you spent in Daily spends; other lines use the budget.</small></span></label><label class="ui-opt"><input type="radio" name="basis" value="budget"><span><b>Budgeted amounts</b><small>The plan for the month, not what was spent.</small></span></label>`,
      collect: box => box.querySelector("[name=basis]:checked").value });
    if (!out) return;
    const a = document.createElement("a"); a.href = `/api/expenses/money-map.xlsx?month=${month}&basis=${out}`; a.download = ""; document.body.append(a); a.click(); a.remove();
  }
  async function settings() {
    const out = await window.ui.dialog({ title: "Expense settings", icon: "⚙️", okText: "Save", wide: true,
      bodyHtml: `<label class="ui-field"><span>Payment methods (one per line; e.g. Pluxee, GPay, Credit card, a family member who pays)</span><textarea class="ui-input" name="modes" rows="6">${esc(d.modes.join("\n"))}</textarea></label>
        <label class="ui-field"><span>People you settle up with (one per line; empty = payment methods that are names, e.g. Sophia)</span><textarea class="ui-input" name="people" rows="3">${esc((d.people || []).join("\n"))}</textarea></label>
        ${d.template ? `<p class="hint">⭐ Standard monthly budget: ${d.template.lines} lines (saved ${new Date(d.template.savedAt).toLocaleDateString("en-IN")}). <button type="button" class="linklike" data-clear-std>Remove it</button></p>` : ""}<h4>Which budget line each category counts against</h4><div class="lt-form">${d.categories.map(c => `<label class="ui-field"><span>${c.icon} ${esc(c.key)}</span><input class="ui-input" data-bud="${esc(c.key)}" value="${esc(c.budget || "")}" placeholder="budget line name"></label>`).join("")}</div>`,
      onOpen: box => box.querySelector("[data-clear-std]")?.addEventListener("click", async () => { box.closest(".ui-scrim")?.querySelector('[data-ui="cancel"]')?.click(); post("standard-clear", {}); }),
      collect: box => ({ people: box.querySelector("[name=people]").value.split("\n").map(x => x.trim()).filter(Boolean), modes: box.querySelector("[name=modes]").value.split("\n").map(x => x.trim()).filter(Boolean), budgets: Object.fromEntries([...box.querySelectorAll("[data-bud]")].map(i => [i.dataset.bud, i.value])) }) });
    if (out) { const ppl = out.people; delete out.people; if (await post("settings", out, "Settings saved.") && ppl.join("\n") !== (d.people || []).join("\n")) post("people", { people: ppl }); }
  }
  const init = () => {
    const v = $("#exView"); if (!v) return;
    v.addEventListener("click", async e => {
      const nav = e.target.closest("[data-mnav]"); if (nav) { month = shiftM(month, Number(nav.dataset.mnav)); remember(); load(); return; }
      const t = e.target.closest("[data-tab]"); if (t) { tab = t.dataset.tab; load(); return; }
      const b = e.target.closest("[data-ex]");
      if (b) { const k = b.dataset.ex; if (k === "moneymap") { moneyMap(); return; } if (k === "start") post("start", {}); else if (k === "apply-std") { if (await window.ui.confirm({ title: `Reset ${monName(month)} to your standard budget?`, message: "This month's budget lines and income are replaced by the standard ones (nothing ticked as done). Daily spends are not touched.", okText: "Reset" })) post("start", { applyStandard: true }); } else if (k === "paste") paste(); else if (k === "plan") editPlan(); else if (k === "settings") settings(); else if (k === "today") { month = ist().slice(0, 7); remember(); load(); } return; }
      const sd = e.target.closest("[data-sdel]"); if (sd) { if (await window.ui.confirm({ title: "Delete this payment?", okText: "Delete", danger: true })) post("settle-delete", { id: sd.dataset.sdel }, "Payment deleted."); return; }
      const st = e.target.closest("[data-settle]"); if (st) { recordPayment(st.dataset.settle, st.dataset.amt ? Number(st.dataset.amt) : null, st.dataset.dir || null); return; }
      const ed = e.target.closest("[data-edit]"); if (ed) { editEntry(d.data.entries.find(x => x.id === ed.dataset.edit)); return; }
      const del = e.target.closest("[data-del]"); if (del) { const x = d.data.entries.find(z => z.id === del.dataset.del); if (x && await window.ui.confirm({ title: `Delete ${x.item} ${inr(x.amount)}?`, okText: "Delete", danger: true })) post("entry-delete", { id: x.id }, "Deleted."); }
    });
    v.addEventListener("change", e => { const c = e.target.closest("[data-done]"); if (c) post("plan-done", { id: c.dataset.done, done: c.checked }); });
    v.addEventListener("submit", async e => {
      const f = e.target.closest("[data-add]"); if (!f) return; e.preventDefault();
      const val = n => f.querySelector(`[name=${n}]`).value;
      if (await post("entry", { date: val("date"), item: val("item"), amount: val("amount"), mode: val("mode"), category: val("category") || undefined, share: f.querySelector("[name=share]") ? shareBody(val("share")) : undefined })) { const nf = $("#exBody [data-add]"); nf?.querySelector("[name=date]") && (nf.querySelector("[name=date]").value = val("date")); nf?.querySelector("[name=mode]") && (nf.querySelector("[name=mode]").value = val("mode")); nf?.querySelector("[name=item]")?.focus(); }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init(); // loaded on demand (app.js LAZY_VIEWS)
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.expenses = () => load();
})();
