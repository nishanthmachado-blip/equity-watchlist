// P&L across all brokers (Tax view): realised profit for a financial year per account (Zerodha, Dhan, …), per account
// holder (each PAN's tax), month by month and trade by trade, plus unrealised profit now. Reads /api/tax/pnl. Loaded on
// demand the first time the Tax view opens.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
  const sgn = v => (!fin(v) ? "—" : v === 0 ? "₹0" : `${v > 0 ? "+" : "−"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`);
  const cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const day = s => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "—");
  const mon = s => new Date(`${s}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  let d = null, fy = null, fAcc = "all", fTerm = "all", q = "", more = false, busy = false;
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  async function load() { const box = $("#txPnl"); if (!box) return; try { d = await api(`/api/tax/pnl${fy ? `?fy=${encodeURIComponent(fy)}` : ""}`); fy = d.fy.label; render(); } catch (e) { box.innerHTML = `<p class="hint">P&L not available: ${esc(e.message)}</p>`; } }
  function render() {
    const T = d.total, box = $("#txPnl"); if (!box) return;
    const fyOpts = d.fys.map(f => `<option${f === d.fy.label ? " selected" : ""}>${esc(f)}</option>`).join("");
    const head = `<div class="nw-head pn-head"><h3>📊 P&L across all your brokers</h3><div class="pn-tools"><select class="ui-input" id="pnFy" aria-label="Financial year">${fyOpts}</select>
      ${d.dhan.accounts.length || d.kiteAccounts ? `<button type="button" class="ghost" id="pnDhan"${busy ? " disabled" : ""} title="Zerodha: today's trades (Kite gives only today). Dhan: everything since last April.">${busy ? "Getting trades…" : "⟳ Get trades from brokers"}</button>` : ""}
      <button type="button" class="ghost" id="pnImport" title="Zerodha Console → Reports → Tax P&L, INDmoney → Reports → Tax report (xlsx)">⬆ Import tax P&L report</button>
      <a class="ghost btnlike" href="/api/tax/pnl.xlsx?fy=${encodeURIComponent(d.fy.label)}" download>⬇ Excel for your CA</a></div></div>`;
    if (!d.rows.length) { box.innerHTML = `<section class="report-card pn">${head}<p class="hint">Nothing yet. Import each broker's tax P&L report (Zerodha: Console → Reports → Tax P&L → Download xlsx; INDmoney: Reports → Tax report), or a tradebook, or connect Dhan on Integrations and use ⟳ Get trades from brokers.</p></section>`; return; }
    const C = d.capture, capLine = `<p class="hint pn-cap">🔄 ${C ? `Last automatic pick-up ${esc(new Date(C.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }))}: ${[...C.kite.map(k => k.error ? `Zerodha ⚠ ${esc(k.error)}` : `Zerodha ${k.rows} trade${k.rows === 1 ? "" : "s"}`), C.dhan?.error ? `Dhan ⚠ ${esc(C.dhan.error)}` : C.dhan ? `Dhan ${C.dhan.added} new` : null].filter(Boolean).join(" · ") || "no broker connected"}.` : "Not run yet."} Every weekday after 3:45 pm, today's trades are picked up from Zerodha (if you logged in that day) and Dhan. Older Zerodha trades: import the Console tradebook once.</p>`;
    const cards = capLine + `<div class="pn-cards">
      <div><span>Realised P&L · ${esc(d.fy.label)}</span><strong class="${cls(T.gross)}">${sgn(T.gross)}</strong><small>${T.trades} sale${T.trades === 1 ? "" : "s"} across ${d.rows.filter(r => r.trades).length} account${d.rows.filter(r => r.trades).length === 1 ? "" : "s"}</small></div>
      <div><span>After charges</span><strong class="${cls(T.net)}">${sgn(T.net)}</strong><small>charges ${inr(T.charges)}${T.chargesEst ? ` (${inr(T.chargesEst)} estimated)` : ""}</small></div>
      <div><span>Short term (STCG)</span><strong class="${cls(T.netSt)}">${sgn(T.netSt)}</strong><small>gains ${inr(T.stGain)} · losses ${inr(T.stLoss)}</small></div>
      <div><span>Long term (LTCG)</span><strong class="${cls(T.netLt)}">${sgn(T.netLt)}</strong><small>gains ${inr(T.ltGain)} · losses ${inr(T.ltLoss)}</small></div>
      <div><span>Intraday</span><strong class="${cls(T.intraday)}">${sgn(T.intraday)}</strong><small>same-day buy and sell; slab rate</small></div>
      ${T.neSt || T.neLt ? `<div><span>Other assets</span><strong class="${cls(T.neSt + T.neLt)}">${sgn(T.neSt + T.neLt)}</strong><small>debt / gold ETFs, US stocks: ST ${sgn(T.neSt)} · LT ${sgn(T.neLt)}</small></div>` : ""}
      <div><span>Unrealised now</span><strong class="${cls(T.unrealised)}">${sgn(T.unrealised)}</strong><small>on what you still hold</small></div></div>`;
    const accTable = `<div class="table-wrap"><table class="pn-table"><thead><tr><th>Account</th><th>Holder</th><th class="num">Sales</th><th class="num">Intraday</th><th class="num">Short term</th><th class="num">Long term</th><th class="num">Other assets</th><th class="num">Realised</th><th class="num">Charges</th><th class="num">Net</th><th class="num">Unrealised</th></tr></thead><tbody>
      ${d.rows.map(r => `<tr><td><b>${esc(r.label)}</b><div class="hint">${r.report ? `📄 ${esc(r.report.broker)} tax P&L to ${day(r.report.to)}${r.tradesOnFile ? ", then trades on file" : ""}` : r.tradesOnFile ? `${r.tradesOnFile} trades on file, ${day(r.from)} → ${day(r.to)}${r.fromApi ? " · from Dhan" : ""}` : "nothing on file"}</div></td><td>${esc(r.holder)}</td><td class="num">${r.trades}</td>
        <td class="num ${cls(r.intraday)}">${r.intraday ? sgn(r.intraday) : "—"}</td><td class="num ${cls(r.netSt)}">${r.netSt ? sgn(r.netSt) : "—"}</td><td class="num ${cls(r.netLt)}">${r.netLt ? sgn(r.netLt) : "—"}</td><td class="num ${cls(r.neSt + r.neLt)}">${r.neSt || r.neLt ? sgn(r.neSt + r.neLt) : "—"}</td>
        <td class="num ${cls(r.gross)}"><b>${sgn(r.gross)}</b></td><td class="num">${inr(r.charges)}${r.chargesEst ? "<small class='hint'> est.</small>" : ""}</td><td class="num ${cls(r.net)}">${sgn(r.net)}</td><td class="num ${cls(r.unrealised)}">${sgn(r.unrealised)}</td></tr>`).join("")}
      <tr class="pn-total"><td><b>All brokers</b></td><td></td><td class="num">${T.trades}</td><td class="num ${cls(T.intraday)}">${sgn(T.intraday)}</td><td class="num ${cls(T.netSt)}">${sgn(T.netSt)}</td><td class="num ${cls(T.netLt)}">${sgn(T.netLt)}</td><td class="num ${cls(T.neSt + T.neLt)}">${sgn(T.neSt + T.neLt)}</td><td class="num ${cls(T.gross)}"><b>${sgn(T.gross)}</b></td><td class="num">${inr(T.charges)}</td><td class="num ${cls(T.net)}"><b>${sgn(T.net)}</b></td><td class="num ${cls(T.unrealised)}">${sgn(T.unrealised)}</td></tr></tbody></table></div>`;
    const slabSel = `<label class="pn-slab">Your income-tax slab <select class="ui-input" id="pnSlab">${[0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map(r => `<option value="${r}"${d.slabRate === r ? " selected" : ""}>${r * 100}%</option>`).join("")}</select></label>`;
    const taxCards = `<div class="pn-tax">${d.holders.map(h => { const X = h.tax, O = h.other; return `<div class="pn-holder"><h4>🧾 Tax for ${esc(h.name)} <span class="hint">${h.accounts.length} account${h.accounts.length === 1 ? "" : "s"}</span></h4>
      <p>After set-off: short term <b class="${cls(X.netSt)}">${sgn(X.netSt)}</b> · long term <b class="${cls(X.netLt)}">${sgn(X.netLt)}</b></p>
      <p>₹1.25 L long-term exemption: ${inr(X.exemptUsed)} used, <b>${inr(X.exemptLeft)} left</b></p>
      <table class="pn-taxbr"><tbody>
        <tr><td>Capital gains tax <span class="hint">(STCG ${d.rules.stRate * 100}%, LTCG ${d.rules.ltRate * 100}%${h.neSt ? `, other short term at ${X.slabRate * 100}%` : ""})</span></td><td class="num"><b>${inr(X.capitalGainsTax)}</b></td></tr>
        ${X.slabIncome ? `<tr><td>Added to your income at ${X.slabRate * 100}%: ${[h.intraday > 0 ? `intraday ${inr(h.intraday)}` : "", O.fno > 0 ? `F&O ${inr(O.fno)}` : "", O.dividends ? `dividends ${inr(O.dividends)}` : "", O.interest ? `interest ${inr(O.interest)}` : ""].filter(Boolean).join(", ")}</td><td class="num">${inr(X.slabTax)}</td></tr>` : ""}
        <tr class="pn-total"><td><b>Estimated tax</b> <span class="hint">before surcharge and 4% cess</span></td><td class="num"><b>${inr(X.tax)}</b></td></tr></tbody></table>
      ${X.carryForward ? `<p class="hint">Losses to carry forward (8 years; file your return on time): ${inr(X.carryForward)}</p>` : ""}
      ${h.intradayNote ? `<p class="hint">Intraday ${sgn(h.intraday)}: ${esc(h.intradayNote)}</p>` : ""}</div>`; }).join("")}
      <details class="pn-who"><summary>Whose accounts are these?</summary><p class="hint">Tax is per person (PAN): gains and losses in all of one person's brokers are added up, and the ₹1.25 L exemption is used once. Give accounts of the same person the same name.</p>
      ${d.rows.filter(r => r.id).map(r => `<label class="ui-field"><span>${esc(r.label)}</span><input class="ui-input" data-holder="${esc(r.id)}" value="${esc(d.holderMap[r.id] || "")}" placeholder="Me"></label>`).join("")}<button type="button" class="primary" id="pnSaveWho">Save</button></details></div>`;
    const max = Math.max(1, ...d.months.map(m => Math.abs(m.total)));
    const months = d.months.length ? `<div class="pn-months">${d.months.map(m => `<div class="pn-mo" title="${esc(mon(m.month))}: intraday ${sgn(m.intraday)}, short term ${sgn(m.st)}, long term ${sgn(m.lt)}"><b class="${cls(m.total)}">${Math.abs(m.total) >= 1e5 ? `${m.total < 0 ? "−" : ""}${(Math.abs(m.total) / 1e5).toFixed(1)}L` : Math.abs(m.total) >= 1e3 ? `${m.total < 0 ? "−" : ""}${Math.round(Math.abs(m.total) / 1e3)}k` : `${m.total < 0 ? "−" : ""}${Math.round(Math.abs(m.total))}`}</b><i class="${m.total < 0 ? "dn" : "up"}" style="height:${Math.max(3, Math.round(Math.abs(m.total) / max * 70))}px"></i><span>${esc(mon(m.month))}</span></div>`).join("")}</div>` : "";
    const list = d.trades.filter(t => (fAcc === "all" || t.account === fAcc) && (fTerm === "all" || t.term === fTerm) && (!q || `${t.symbol} ${t.name || ""}`.toLowerCase().includes(q)));
    const shown = more ? list : list.slice(0, 40);
    const accOpts = d.rows.filter(r => r.trades).map(r => `<option value="${esc(r.id)}"${fAcc === r.id ? " selected" : ""}>${esc(r.label)}</option>`).join("");
    const trades = `<div class="pn-filter"><input class="ui-input" id="pnQ" placeholder="Search a stock" value="${esc(q)}"><select class="ui-input" id="pnAcc"><option value="all">All accounts</option>${accOpts}</select><select class="ui-input" id="pnTerm">${["all", "STCG", "LTCG", "Intraday", "Other ST", "Other LT", "No buy found"].map(x => `<option value="${x}"${fTerm === x ? " selected" : ""}>${x === "all" ? "All types" : x}</option>`).join("")}</select>
      <span class="hint">${list.length} sale${list.length === 1 ? "" : "s"} · ${sgn(list.reduce((a, t) => a + (t.gain || 0), 0))}</span></div>
      <div class="table-wrap"><table class="pn-table pn-trades"><thead><tr><th>Sold</th><th>Stock</th><th>Account</th><th class="num">Qty</th><th class="num">Bought</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Gain</th><th>Type</th></tr></thead><tbody>
      ${shown.map(t => `<tr><td>${t.noDates ? `<span class="hint">period total<br>to ${day(t.sellDate)}</span>` : day(t.sellDate)}</td><td><b>${esc(t.symbol)}</b>${t.kind && t.kind !== "stock" ? ` <span class="chip">${esc({ mf: "MF", us: "US", etf: "ETF", debt: "Debt" }[t.kind] || t.kind)}</span>` : ""}${t.name ? `<div class="hint">${esc(t.name)}</div>` : ""}</td><td class="hint">${esc(t.accountLabel)}</td><td class="num">${t.qty ?? "—"}</td><td class="num">${day(t.buyDate)}${fin(t.days) && t.days > 0 ? `<div class="hint">${t.days} d</div>` : ""}</td><td class="num">${fin(t.buy) ? `₹${t.buy}` : "—"}</td><td class="num">${fin(t.sell) ? `₹${t.sell}` : "—"}</td><td class="num ${cls(t.gain)}">${sgn(t.gain)}</td><td><span class="chip pn-${t.term.replace(/\s+/g, "").toLowerCase()}">${esc(t.term)}</span>${t.termFrom === "assumed" || t.termFrom === "you" ? `<div><button type="button" class="linkbtn" data-term="${esc(t.reportId)}|${esc(t.isin || "")}|${t.termFrom === "assumed" ? 1 : 0}">${t.termFrom === "assumed" ? "Mark long term" : "Back to short term"}</button></div>` : t.termFrom === "trades" ? '<div class="hint">term from your trades</div>' : ""}</td></tr>`).join("") || '<tr><td colspan="9" class="hint">No sales match.</td></tr>'}</tbody></table></div>
      ${list.length > 40 && !more ? `<button type="button" class="ghost" id="pnMore">Show all ${list.length}</button>` : ""}`;
    const warn = d.warnings.map(w => `<p class="bk-act warn">⚠️ ${esc(w.text)}</p>`).join("") + (d.notes || []).map(n => `<p class="bk-act info">💡 ${esc(n)}</p>`).join("");
    const srcs = d.reports.length ? `<details class="pn-srcs"><summary>📄 Tax reports used for ${esc(d.fy.label)} (${d.reports.length})</summary><ul>${d.reports.map(r => `<li><b>${esc(r.broker)}</b> → ${esc(r.accountLabel)}: ${r.sales} sales, ${day(r.from)} → ${day(r.to)}${r.other?.dividends ? `, dividends ${inr(r.other.dividends)}` : ""}${r.file ? ` <span class="hint">${esc(r.file)}</span>` : ""}${r.broker === "Dhan" ? ' <span class="hint">(no dates in this report: download it for the whole year, 1 Apr to today)</span>' : ""} <button type="button" class="ghost" data-delrep="${esc(r.id)}" aria-label="Remove">✕</button></li>`).join("")}</ul><p class="hint">The broker's figures are used as they are (its FIFO, grandfathering and charges) up to the report's last day; sales after that come from trades on file. Import a newer report any time: it replaces the older one for that account and year.</p></details>` : "";
    box.innerHTML = `<section class="report-card pn">${head}${warn}${cards}${accTable}${srcs}<div class="nw-head"><h4 class="pn-sub">Tax by person</h4>${slabSel}</div>${taxCards}${months ? `<h4 class="pn-sub">Month by month</h4>${months}` : ""}<h4 class="pn-sub">Every sale in ${esc(d.fy.label)}</h4>${trades}
      <p class="vs-fine">Where you imported a broker's tax P&L report, its figures are used as they are. Otherwise each demat account sells its own oldest shares first (FIFO), as the tax rules say. A buy and a sell of the same stock on the same day in one account count as intraday. Charges come from Dhan where synced; for other trades they're estimated from Zerodha's published rates (STT, stamp duty, exchange and SEBI fees, GST, DP). Without a report, grandfathering (shares bought before Feb 2018) isn't applied. Set-off: short-term losses reduce short-term then long-term gains; long-term losses only long-term gains. Check against each broker's tax P&L before filing; not tax advice.</p></section>`;
  }
  async function act(e) {
    const t = e.target;
    if (t.closest("#pnMore")) { more = true; return render(); }
    if (t.closest("#pnImport")) return document.getElementById("txFile")?.click();
    const tm = t.closest("[data-term]"); if (tm) { const [id, isin, long] = tm.dataset.term.split("|"); try { d = await api("/api/tax/report-term", { id, isin, long: long === "1", fy }); render(); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); } return; }
    const dr = t.closest("[data-delrep]"); if (dr) { if (await window.ui.confirm({ title: "Remove this tax report?", message: "Its sales stop counting; trades on file for that account are used instead.", okText: "Remove", danger: true })) { try { d = await api("/api/tax/report-delete", { id: dr.dataset.delrep, fy }); render(); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); } } return; }
    if (t.closest("#pnDhan")) {
      busy = true; render();
      try {
        d = await api("/api/tax/capture", { fy, full: true }); const c = d.captured, msg = [];
        for (const k of c.kite) msg.push(k.error ? `Zerodha ${k.account || k.slot}: ${k.error}` : `Zerodha ${k.account}: ${k.rows} trades today`);
        if (c.dhan?.error) msg.push(`Dhan: ${c.dhan.error}`); else if (c.dhan) msg.push(`Dhan: ${c.dhan.rows} trades read, ${c.dhan.added} new`);
        window.toast?.(esc(msg.join(" · ") || "No broker connected for trades. Connect Zerodha or Dhan on Integrations."), { kind: c.kite.some(k => k.error) || c.dhan?.error ? "bad" : "ok", ms: 6000 }); window.openTax?.();
      }
      catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); }
      busy = false; return render();
    }
    if (t.closest("#pnSaveWho")) {
      const holders = {}; for (const i of $("#txPnl").querySelectorAll("[data-holder]")) holders[i.dataset.holder] = i.value.trim();
      try { d = await api("/api/tax/holders", { holders, fy }); render(); window.toast?.("✓ Saved.", { kind: "ok" }); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); }
    }
  }
  function change(e) {
    const t = e.target;
    if (t.id === "pnFy") { fy = t.value; more = false; return load(); }
    if (t.id === "pnSlab") { api("/api/tax/slab", { slabRate: Number(t.value), fy }).then(j => { d = j; render(); }).catch(err => window.toast?.(esc(err.message), { kind: "bad" })); return; }
    if (t.id === "pnAcc") { fAcc = t.value; more = false; return render(); }
    if (t.id === "pnTerm") { fTerm = t.value; more = false; return render(); }
  }
  const box = $("#txPnl");
  if (box) {
    box.addEventListener("click", act); box.addEventListener("change", change);
    box.addEventListener("input", e => { if (e.target.id !== "pnQ") return; q = e.target.value.trim().toLowerCase(); render(); const i = $("#pnQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  }
  window.loadPnl = load;
})();
