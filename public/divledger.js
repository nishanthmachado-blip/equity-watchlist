// Dividend income planner → 📅 Received: dividends credited, month by month, one grid per year (stocks × months) with
// totals both ways, who paid each month, and the comparison with last year. Record as they arrive, click a cell to
// change it, or paste your own sheet. Reads /api/divledger. Loaded the first time the tab opens.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${(Math.round(v * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
  const n0 = v => (v ? (Math.round(v * 100) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const thisMonth = () => new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 7);
  let d = null, year = null;
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  async function load() { try { d = await api(`/api/divledger${year ? `?year=${year}` : ""}`); year = d.year; render(); } catch (e) { $("#dvLedger").innerHTML = `<p class="hint">Could not load: ${esc(e.message)}</p>`; } }
  function render() {
    const box = $("#dvLedger"), cy = Number(thisMonth().slice(0, 4));
    const ys = [...new Set([cy, ...d.years.map(y => y.year)])].sort((a, b) => b - a);
    const tools = `<div class="dl-tools"><div class="mh-tabs">${ys.map(y => `<button type="button" class="${y === d.year ? "on" : ""}" data-dly="${y}">${y}${d.years.find(x => x.year === y) ? ` <small>₹${Math.round(d.years.find(x => x.year === y).total).toLocaleString("en-IN")}</small>` : ""}</button>`).join("")}<button type="button" class="ghost" data-dlnewyear>+ Year</button></div>
      <div class="dl-btns"><button type="button" class="primary" data-dladd>+ Record a dividend</button><button type="button" class="ghost" data-dlpaste>📋 Paste from Excel</button>${d.rows.length ? `<a class="ghost btnlike" href="/api/divledger/export.xlsx?year=${d.year}" download>⬇ Excel</a>` : ""}</div></div>`;
    if (!d.rows.length && !d.years.length) { box.innerHTML = `${tools}<section class="report-card"><p class="bk-act info">💡 Record each dividend as it's credited (<b>+ Record a dividend</b>), or copy your existing sheet from Excel / Google Sheets (the year row with Jan … Dec, and a row per stock) and use <b>📋 Paste from Excel</b>.</p></section>`; return; }
    const G = d.growth, cmp = d.isCurrent ? `vs ${inr(d.prevSamePeriod)} in Jan–${MONTHS[d.monthsSoFar - 1]} ${d.year - 1}` : d.prevTotal ? `vs ${inr(d.prevTotal)} in ${d.year - 1}` : `no ${d.year - 1} data to compare`;
    const cards = `<div class="mh-cards">
      <div><span>Received in ${d.year}${d.isCurrent ? " so far" : ""}</span><strong>${inr(d.total)}</strong><small>${d.entries} credits from ${d.payersCount} stocks</small></div>
      <div><span>Change on last year</span><strong class="${G > 0 ? "pl-up" : G < 0 ? "pl-dn" : ""}">${fin(G) ? `${G > 0 ? "+" : ""}${G}%` : "—"}</strong><small>${cmp}</small></div>
      <div><span>Per month on average</span><strong>${inr(d.perMonth)}</strong><small>best month: ${d.best.month ? `${d.best.month} (${inr(d.best.amount)})` : "—"}</small></div>
      <div><span>Biggest payers</span><strong class="dl-top">${d.top.slice(0, 3).map(t => esc(t.stock)).join(", ") || "—"}</strong><small>${d.top.slice(0, 3).map(t => `${t.share}%`).join(" · ")}${d.top.length ? " of the year" : ""}</small></div></div>`;
    const curM = d.isCurrent ? d.monthsSoFar - 1 : 11;
    const head = `<tr><th class="dl-stock">Stock</th><th class="num" title="Shares you hold now, from your synced holdings">Shares</th>${MONTHS.map(m => `<th class="num">${m}</th>`).join("")}<th class="num">Total</th><th class="num">${d.year - 1}</th></tr>`;
    const body = d.rows.map(r => `<tr><td class="dl-stock"><b>${esc(r.stock)}</b></td><td class="num hint">${fin(r.shares) ? r.shares.toLocaleString("en-IN") : "—"}</td>${r.months.map((x, i) => `<td class="num dl-cell${x.amount ? " has" : ""}${x.auto ? " auto" : ""}${i > curM ? " dl-future" : ""}" data-cell="${esc(r.stock)}|${i}" title="${esc(r.stock)}, ${MONTHS[i]} ${d.year}${x.ids.length > 1 ? ` (${x.ids.length} credits)` : ""}${x.auto ? ` · ≈ ${inr(x.auto)} worked out from your holdings: click to confirm` : ""}">${x.auto ? "≈" : ""}${n0(x.amount)}</td>`).join("")}<td class="num"><b>${n0(r.total)}</b></td><td class="num hint">${r.lastYear !== null ? n0(r.lastYear) : "—"}</td></tr>`).join("");
    const foot = `<tr class="dl-total"><td class="dl-stock"><b>Total</b></td><td></td>${d.monthTotals.map((x, i) => `<td class="num${i > curM ? " dl-future" : ""}"><b>${n0(x) || (i > curM ? "" : "0")}</b></td>`).join("")}<td class="num"><b>${n0(d.total)}</b></td><td class="num hint">${n0(d.prevTotal)}</td></tr>
      <tr class="dl-prev"><td class="dl-stock hint">${d.year - 1}</td><td></td>${d.prevMonthTotals.map(x => `<td class="num hint">${n0(x)}</td>`).join("")}<td class="num hint">${n0(d.prevTotal)}</td><td></td></tr>
      <tr class="dl-who"><td class="dl-stock hint">Paid by</td><td></td>${d.payers.map(p => `<td>${p.map(n => `<div>${esc(n)}</div>`).join("")}</td>`).join("")}<td></td><td></td></tr>`;
    const grid = `<div class="table-wrap m-keep dl-wrap"><table class="dl-grid"><thead>${head}</thead><tbody>${body || `<tr><td colspan="16" class="hint">Nothing recorded for ${d.year} yet.</td></tr>`}${foot}</tbody></table></div>`;
    const max = Math.max(1, ...d.monthTotals, ...d.prevMonthTotals);
    const bars = `<div class="dl-bars">${MONTHS.map((m, i) => `<div class="dl-bar" title="${m}: ${inr(d.monthTotals[i])} (${d.year - 1}: ${inr(d.prevMonthTotals[i])})"><div class="dl-pair"><i class="prev" style="height:${Math.round(d.prevMonthTotals[i] / max * 70)}px"></i><i class="cur" style="height:${Math.round(d.monthTotals[i] / max * 70)}px"></i></div><span>${m}</span></div>`).join("")}<p class="hint dl-legend"><i class="cur"></i> ${d.year} <i class="prev"></i> ${d.year - 1}</p></div>`;
    const missing = d.missing.length ? `<p class="bk-act warn">⏳ Paid in ${d.year - 1}, nothing recorded in ${d.year} yet: ${d.missing.map(m => `<b>${esc(m.stock)}</b> (${inr(m.lastYear)}, ${m.months.join("/")}${fin(m.shares) ? `; you hold ${m.shares}` : "; not in your holdings"})`).join(", ")}.${d.isCurrent ? " Some may still come; others you may have sold." : ""}</p>` : "";
    const TX = d.tax, taxLine = TX?.count ? `<p class="bk-act info dl-tax">🧾 <b>Income tax, ${esc(TX.fy)}</b> (Apr–Mar): dividends ${inr(Math.round(TX.gross))} before TDS × your ${Math.round(TX.slabRate * 100)}% slab = <b>${inr(TX.tax)}</b>${TX.tds ? `; TDS already cut ≈ ${inr(Math.round(TX.tds))}, so about <b>${inr(TX.due)}</b> still to pay` : ""}. Counted in the <a href="#" data-gotax>Tax view</a>.</p>` : "";
    const A = d.auto || {}, autoLine = A.on ? (d.autoCount ? `<p class="bk-act info">🔄 <b>${d.autoCount} dividend${d.autoCount === 1 ? "" : "s"} (${inr(d.autoTotal)})</b> added from your holdings since ${esc(A.from)}, marked ≈. Click one to confirm it when it's credited, change the amount, or hide it.</p>` : "") : "";
    const autoSet = `<details class="dl-auto"><summary>🔄 Auto-add from your holdings: <b>${A.on ? `on, from ${esc(A.from)}` : "off"}</b> <span class="hint">${A.holdings ? `${A.holdings} stocks held` : "no synced holdings yet"}</span></summary>
      <p class="hint">When a stock you hold pays a dividend (NSE's announcements and the dividend history), the app adds shares held on the ex-date × dividend per share, in the month it's usually credited (about 3 weeks after the ex-date). Shares on the ex-date come from your trades on file, else today's holding. Set an earlier date to fill past months; check those amounts, as you may have held a different number of shares then.</p>
      <label class="ui-opt"><input type="checkbox" name="on"${A.on ? " checked" : ""}><span><b>Add dividends from my holdings</b></span></label>
      <label class="ui-field" style="max-width:220px"><span>Starting from</span><input class="ui-input" type="date" name="from" value="${esc(A.from || "")}"></label><button type="button" class="primary" data-dlauto>Save</button></details>`;
    box.innerHTML = `${tools}<section class="report-card">${cards}${taxLine}${autoLine}${missing}${bars}${autoSet}</section><section class="report-card"><h3>📅 ${d.year} month by month <span class="hint">click a cell to add, change or remove</span></h3>${grid}
      <p class="vs-fine">Amounts are what was credited to your bank (after TDS, if any was cut). Months later in the year than today are dimmed. Pasting a sheet replaces the years it contains, so you can paste again after editing it in Excel.</p></section>`;
  }
  const names = () => [...new Set(d.rows.map(r => r.stock))];
  async function entryForm({ stock = "", month = thisMonth(), amount = "", note = "", id = null } = {}) {
    const out = await window.ui.dialog({ title: id ? "Change this dividend" : "Record a dividend", icon: "💰", okText: id ? "Save" : "Add",
      bodyHtml: `<label class="ui-field dl-stockf"><span>Stock · <small class="hint">type any name or symbol, e.g. IOC</small></span><input class="ui-input" name="stock" list="dlNames" value="${esc(stock)}" placeholder="Start typing: your holdings and earlier names are suggested" autocomplete="off"></label>
        <datalist id="dlNames">${names().map(n => `<option value="${esc(n)}">`).join("")}${(d.holdingNames || []).filter(h => !names().some(n => n.toLowerCase() === h.symbol.toLowerCase())).map(h => `<option value="${esc(h.symbol)}">${esc(h.name || "")} · ${h.qty} shares</option>`).join("")}</datalist>
        <div class="nw-form">
        <label class="ui-field"><span>Month received</span><input class="ui-input" type="month" name="month" value="${esc(month)}" max="${thisMonth()}"></label>
        <label class="ui-field"><span>Amount credited (₹)</span><input class="ui-input" name="amount" inputmode="decimal" value="${amount}"></label>
        <label class="ui-field"><span>Note (optional)</span><input class="ui-input" name="note" maxlength="120" value="${esc(note || "")}" placeholder="e.g. final dividend, Angel account"></label></div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return api(`/api/divledger/${id ? "edit" : "add"}`, { id, stock: v("stock"), month: v("month"), amount: v("amount"), note: v("note"), year }); } });
    if (out) { d = out; year = out.year; render(); window.toast?.(esc(out.notice), { kind: "ok" }); }
  }
  async function autoForm(a, stock, month) {
    const out = await window.ui.dialog({ title: `${stock}: dividend from your holdings`, icon: "🔄", okText: "Confirm",
      bodyHtml: `<p>${a.qty} shares × ₹${a.perShare} (ex-date ${esc(a.exDate)}) = <b>${inr(a.amount)}</b>${a.approx ? ' <span class="hint">(shares from today\'s holding: no trades on file for that date)</span>' : ""}.</p>
        <p class="hint">${a.expected ? "Usually credited about 3 weeks after the ex-date: confirm once it's in your bank." : "Confirm it, or put the amount actually credited (after TDS) and the month."}</p>
        <div class="nw-form"><label class="ui-field"><span>Amount credited (₹)</span><input class="ui-input" name="amount" inputmode="decimal" value="${a.amount}"></label>
        <label class="ui-field"><span>Month received</span><input class="ui-input" type="month" name="month" value="${esc(month)}" max="${thisMonth()}"></label></div>
        <button type="button" class="ghost danger-text" data-dlhide>Not received / not mine: hide it</button>`,
      onOpen: box => box.querySelector("[data-dlhide]").onclick = async () => { try { d = await api("/api/divledger/dismiss", { autoId: a.id, year }); render(); window.toast?.(esc(d.notice), { kind: "ok" }); window.ui.dialog({ title: "Hidden", icon: "✓", okText: "OK", hideCancel: true, message: "It won't be added again." }); } catch (e) { window.toast?.(esc(e.message), { kind: "bad" }); } },
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return api("/api/divledger/confirm", { autoId: a.id, amount: v("amount"), month: v("month"), year }); } });
    if (out) { d = out; render(); window.toast?.(esc(out.notice), { kind: "ok" }); }
  }
  async function cellForm(stock, m) {
    const row = d.rows.find(r => r.stock === stock), month = `${d.year}-${String(m + 1).padStart(2, "0")}`;
    const autos = row?.months[m].autos || [];
    if (autos.length && !row.months[m].ids.length && autos.length === 1) return autoForm(autos[0], stock, month);
    if (autos.length) { const pick = await window.ui.dialog({ title: `${stock}, ${MONTHS[m]} ${d.year}`, icon: "💰", okText: "Close", hideCancel: true, bodyHtml: `<ul class="dl-list">${autos.map((a, i) => `<li>≈ <b>${inr(a.amount)}</b> <span class="hint">from holdings, ex ${esc(a.exDate)}</span> <button type="button" class="ghost" data-dlauto-i="${i}">Review</button></li>`).join("")}${row.months[m].ids.length ? `<li><b>${inr(row.months[m].amount - row.months[m].auto)}</b> recorded <button type="button" class="ghost" data-dlman>Edit</button></li>` : ""}</ul>`,
      onOpen: box => box.addEventListener("click", e => { const x = e.target.closest("[data-dlauto-i]"); if (x) autoForm(autos[Number(x.dataset.dlautoI)], stock, month); if (e.target.closest("[data-dlman]")) manualCell(stock, m, row); }) }); void pick; return; }
    return manualCell(stock, m, row);
  }
  async function manualCell(stock, m, row) {
    const month = `${d.year}-${String(m + 1).padStart(2, "0")}`;
    if (!row || !row.months[m].ids.length) return entryForm({ stock, month });
    const full = await api(`/api/divledger/entries?year=${d.year}`).catch(() => null);
    const list = (full?.entries || []).filter(e => row.months[m].ids.includes(e.id));
    if (list.length === 1) return entryForm({ ...list[0] });
    const out = await window.ui.dialog({ title: `${stock}, ${MONTHS[m]} ${d.year}`, icon: "💰", okText: "Close", bodyHtml: `<ul class="dl-list">${list.map(e => `<li><b>${inr(e.amount)}</b>${e.note ? ` <span class="hint">${esc(e.note)}</span>` : ""} <button type="button" class="ghost" data-dledit="${esc(e.id)}">✎</button></li>`).join("")}</ul><button type="button" class="ghost" data-dladdhere>+ Another credit this month</button>`,
      collect: () => true, onOpen: box => box.addEventListener("click", e => { const ed = e.target.closest("[data-dledit]"); if (ed) { entryForm(list.find(x => x.id === ed.dataset.dledit)); } if (e.target.closest("[data-dladdhere]")) { entryForm({ stock, month }); } }) });
    void out;
  }
  async function pasteForm() {
    const out = await window.ui.dialog({ title: "Paste your dividend sheet", icon: "📋", okText: "Check", wide: true,
      bodyHtml: `<p class="hint">In Excel or Google Sheets, select from the year row (e.g. <code>2025  JAN  FEB … Dec</code>) down to the last stock, copy, and paste here. Several years at once are fine. TOTAL rows and the "who paid" lists are skipped.</p>
        <textarea class="ui-input dl-paste" name="text" rows="12" placeholder="2025\tJAN\tFEB\t…\nTCS\t\t1064\t…"></textarea>
        <label class="ui-opt"><input type="radio" name="mode" value="replace" checked><span><b>Replace</b> the years in the paste <small>Safe to paste again after editing your sheet</small></span></label>
        <label class="ui-opt"><input type="radio" name="mode" value="add"><span><b>Add</b> to what's recorded</span></label>`,
      collect: box => ({ text: box.querySelector("[name=text]").value, mode: box.querySelector("[name=mode]:checked").value }) });
    if (!out) return;
    try {
      const { preview: p } = await api("/api/divledger/import", { ...out, dryRun: true });
      const ok = await window.ui.confirm({ title: `Import ${p.entries} dividends?`, okText: "Import", message: `${p.years.join(", ")}: ₹${p.total.toLocaleString("en-IN")} in total.${p.replacing ? ` Replaces ${p.replacing} entries already recorded for ${p.years.length === 1 ? "that year" : "those years"}.` : ""}${p.skipped.length ? ` Skipped: ${p.skipped.join("; ")}.` : ""}` });
      if (!ok) return;
      d = await api("/api/divledger/import", out); year = d.year; render(); window.toast?.(esc(d.notice), { kind: "ok", ms: 5000 });
    } catch (e) { window.toast?.(esc(e.message), { kind: "bad", ms: 6000 }); }
  }
  const box = $("#dvLedger");
  box?.addEventListener("click", async e => {
    const t = e.target;
    if (t.closest("[data-gotax]")) { e.preventDefault(); return window.setView?.("tax"); }
    const y = t.closest("[data-dly]"); if (y) { year = Number(y.dataset.dly); return load(); }
    if (t.closest("[data-dladd]")) return entryForm();
    if (t.closest("[data-dlpaste]")) return pasteForm();
    if (t.closest("[data-dlnewyear]")) { const n = await window.ui.dialog({ title: "Which year?", icon: "📅", okText: "Open", bodyHtml: `<label class="ui-field"><span>Year</span><input class="ui-input" name="y" inputmode="numeric" value="${(d.years.at(-1)?.year || d.year) - 1}"></label>`, collect: b => { const v = Number(b.querySelector("[name=y]").value); if (!(v >= 1990 && v <= Number(thisMonth().slice(0, 4)))) throw new Error("Enter a year up to this one."); return v; } }); if (n) { year = n; load(); } return; }
    if (t.closest("[data-dlauto]")) { const f = t.closest(".dl-auto"); try { d = await api("/api/divledger/auto", { on: f.querySelector("[name=on]").checked, from: f.querySelector("[name=from]").value, year }); render(); window.toast?.(esc(d.notice), { kind: "ok" }); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); } return; }
    const c = t.closest("[data-cell]"); if (c) { const [stock, m] = c.dataset.cell.split("|"); if (Number(m) > (d.isCurrent ? d.monthsSoFar - 1 : 11)) return window.toast?.("That month hasn't come yet.", { kind: "info" }); return cellForm(stock, Number(m)); }
  });
  window.loadDivLedger = load;
})();
