// Swing book: swing trading from your brokers' records only (tax P&L reports, tradebooks, Dhan's history, the daily
// pick-up and trades you add here). The old Swing trading journal is not read. Reads /api/swingbook. Loaded on demand.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—"), px = v => (fin(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
  const sgn = v => (!fin(v) ? "—" : v === 0 ? "₹0" : `${v > 0 ? "+" : "−"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`), cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const pc = v => (fin(v) ? `${v > 0 ? "+" : ""}${v}%` : "—");
  const day = s => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "—");
  const mon = s => new Date(`${s}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  let d = null, fy = null, fAcc = "all", fRes = "all", q = "", more = false;
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  async function load() { try { d = await api(`/api/swingbook${fy ? `?fy=${encodeURIComponent(fy)}` : ""}`); fy = d.fy; render(); } catch (e) { $("#sbBody").innerHTML = `<p class="hint">Could not load: ${esc(e.message)}</p>`; } }
  function render() {
    const S = d.stats, box = $("#sbBody");
    const fyOpts = d.fys.map(f => `<option${f === d.fy ? " selected" : ""}>${esc(f)}</option>`).join("");
    const tools = `<div class="sb-tools"><select class="ui-input" id="sbFy">${fyOpts}</select><button type="button" class="primary" id="sbImport">⬆ Import tax P&L or tradebook</button><button type="button" class="ghost" id="sbAdd">+ Add a trade</button><input type="file" id="sbFile" accept=".xlsx,.xls,.csv,.txt" hidden><span class="hint" id="sbStatus"></span></div>`;
    if (!d.hasBroker) { box.innerHTML = `${tools}<section class="report-card"><p class="bk-act info">💡 Import your brokers' tax P&L reports (Zerodha Console → Reports → Tax P&L; INDmoney → Tax report; Dhan → Realised P&L) or tradebooks. This page is built only from those, the daily pick-up of trades and trades you add here: your swing trades, win rate and tax come straight from the broker's numbers.</p></section>`; return; }
    const cards = `<div class="sb-cards">
      <div><span>Swing P&L · ${esc(d.fy)}</span><strong class="${cls(S.gain)}">${sgn(S.gain)}</strong><small>${S.trades} trades · after charges <b class="${cls(S.net)}">${sgn(S.net)}</b></small></div>
      <div><span>Win rate</span><strong>${S.winRate ?? "—"}${S.winRate !== null ? "%" : ""}</strong><small>${S.wins} wins · ${S.losses} losses</small></div>
      <div><span>Average win / loss</span><strong><span class="pl-up">${sgn(S.avgWin)}</span> / <span class="pl-dn">${S.avgLoss ? `−${inr(S.avgLoss).slice(1)}` : "—"}</span></strong><small>profit factor ${S.profitFactor ?? "—"}${S.profitFactor ? (S.profitFactor >= 1.5 ? " · healthy" : S.profitFactor >= 1 ? " · thin edge" : " · losing more than winning") : ""}</small></div>
      <div><span>Average hold</span><strong>${S.avgDays ?? "—"}${S.avgDays !== null ? " days" : ""}</strong><small>${S.best ? `best ${esc(S.best.symbol)} ${sgn(S.best.gain)}` : ""}${S.worst ? ` · worst ${esc(S.worst.symbol)} ${sgn(S.worst.gain)}` : ""}</small></div>
      <div><span>Tax on these trades</span><strong>${inr(S.tax.estimate)}</strong><small>short term ${sgn(S.tax.shortTerm)} × 20%${S.tax.intraday ? ` · intraday ${sgn(S.tax.intraday)} × ${S.tax.slabRate * 100}%` : ""}; your full tax is in the Tax view</small></div>
      <div><span>Open swing positions</span><strong class="${cls(d.openTotals.pnl)}">${sgn(d.openTotals.pnl)}</strong><small>${d.open.length} stock${d.open.length === 1 ? "" : "s"} · ${inr(d.openTotals.cost)} invested</small></div></div>`;
    const max = Math.max(1, ...d.months.map(m => Math.abs(m.gain)));
    const months = d.months.length ? `<section class="report-card"><h3>Month by month</h3><div class="pn-months">${d.months.map(m => `<div class="pn-mo" title="${esc(mon(m.month))}: ${m.trades} trades, ${m.wins} wins, ${sgn(m.gain)}"><b class="${cls(m.gain)}">${Math.abs(m.gain) >= 1e5 ? `${m.gain < 0 ? "−" : ""}${(Math.abs(m.gain) / 1e5).toFixed(1)}L` : Math.abs(m.gain) >= 1e3 ? `${m.gain < 0 ? "−" : ""}${Math.round(Math.abs(m.gain) / 1e3)}k` : Math.round(m.gain)}</b><i class="${m.gain < 0 ? "dn" : "up"}" style="height:${Math.max(3, Math.round(Math.abs(m.gain) / max * 70))}px"></i><span>${esc(mon(m.month))}</span></div>`).join("")}</div></section>` : "";
    const open = `<section class="report-card"><h3>📂 Open swing positions <span class="hint">bought in the last 12 months, still held as per the trades on file</span></h3>${d.open.length ? `<div class="table-wrap"><table class="sb-t"><thead><tr><th>Stock</th><th>Account</th><th class="num">Qty</th><th class="num">Avg buy</th><th class="num">Now</th><th class="num">P&L</th><th class="num">Held</th><th>Long term from</th></tr></thead><tbody>${d.open.map(o => `<tr><td><b>${esc(o.symbol)}</b>${o.name && o.name !== o.symbol ? `<div class="hint">${esc(o.name)}</div>` : ""}</td><td class="hint">${esc(o.accountLabel)}</td><td class="num">${o.qty}</td><td class="num">${px(o.avg)}</td><td class="num">${px(o.price)}${o.priceFrom === "report" ? `<div class="hint">close, ${esc(o.fromReport.broker)} ${day(o.fromReport.asOf)}</div>` : ""}</td><td class="num ${cls(o.pnl)}">${sgn(o.pnl)}<div class="hint">${pc(o.pct)}</div></td><td class="num">${o.days !== null ? `${o.days} d` : "—"}</td><td>${o.longFrom ? day(o.longFrom) : o.fromReport ? `<span class="hint">from ${esc(o.fromReport.broker)}'s report</span>` : "—"}</td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">None found. Open positions need the buys on file: import the broker\'s tradebook (Zerodha Console → Reports → Tradebook), or they come in with the daily pick-up and trades you add.</p>'}</section>`;
    const accOpts = [...new Map(d.closed.map(c => [c.account, c.accountLabel]))].map(([id, l]) => `<option value="${esc(id)}"${fAcc === id ? " selected" : ""}>${esc(l)}</option>`).join("");
    const list = d.closed.filter(c => (fAcc === "all" || c.account === fAcc) && (fRes === "all" || (fRes === "win" ? c.gain > 0 : fRes === "loss" ? c.gain < 0 : c.intraday)) && (!q || `${c.symbol} ${c.name || ""}`.toLowerCase().includes(q)));
    const shown = more ? list : list.slice(0, 50);
    const closed = `<section class="report-card"><h3>✅ Closed swing trades <span class="hint">short-term and intraday sales of stocks and ETFs, as your brokers report them</span></h3>
      <div class="pn-filter"><input class="ui-input" id="sbQ" placeholder="Search a stock" value="${esc(q)}"><select class="ui-input" id="sbAcc"><option value="all">All accounts</option>${accOpts}</select><select class="ui-input" id="sbRes">${[["all", "All"], ["win", "Wins"], ["loss", "Losses"], ["intraday", "Intraday"]].map(([k, l]) => `<option value="${k}"${fRes === k ? " selected" : ""}>${l}</option>`).join("")}</select><span class="hint">${list.length} trades · ${sgn(list.reduce((a, c) => a + c.gain, 0))}</span></div>
      <div class="table-wrap"><table class="sb-t"><thead><tr><th>Sold</th><th>Stock</th><th>Account</th><th class="num">Qty</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Held</th><th class="num">P&L</th><th class="num">Charges</th></tr></thead><tbody>
      ${shown.map(c => `<tr><td>${c.noDates ? `<span class="hint">year total<br>to ${day(c.periodTo)}</span>` : day(c.sellDay)}</td><td><b>${esc(c.symbol)}</b>${c.intraday ? ' <span class="chip pn-intraday">Intraday</span>' : ""}${c.name && c.name !== c.symbol ? `<div class="hint">${esc(c.name)}</div>` : ""}</td><td class="hint">${esc(c.accountLabel)}</td><td class="num">${c.qty}</td><td class="num">${px(c.buyAvg)}<div class="hint">${c.buyDay ? day(c.buyDay) : ""}</div></td><td class="num">${px(c.sellAvg)}</td><td class="num">${c.days !== null ? `${c.days} d` : "—"}</td><td class="num ${cls(c.gain)}"><b>${sgn(c.gain)}</b><div class="hint">${pc(c.pct)}</div></td><td class="num">${inr(c.charges)}</td></tr>`).join("") || '<tr><td colspan="9" class="hint">No trades match.</td></tr>'}</tbody></table></div>
      ${list.length > 50 && !more ? `<button type="button" class="ghost" id="sbMore">Show all ${list.length}</button>` : ""}</section>`;
    const accs = d.accounts.length > 1 ? `<section class="report-card"><h3>By account</h3><div class="table-wrap"><table class="sb-t"><thead><tr><th>Account</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">P&L</th></tr></thead><tbody>${d.accounts.map(a => `<tr><td><b>${esc(a.label)}</b></td><td class="num">${a.trades}</td><td class="num">${a.winRate}%</td><td class="num ${cls(a.gain)}">${sgn(a.gain)}</td></tr>`).join("")}</tbody></table></div></section>` : "";
    const manual = d.manual.length ? `<details class="report-card"><summary><b>✍️ Trades you added by hand (${d.manual.length})</b> <span class="hint">kept in the same tradebook as the broker files; a newer broker report for that period replaces them</span></summary><div class="table-wrap"><table class="sb-t"><thead><tr><th>Date</th><th></th><th>Stock</th><th class="num">Qty</th><th class="num">Price</th><th>Account</th><th></th></tr></thead><tbody>${d.manual.map(t => `<tr><td>${day(t.date)}</td><td>${t.side === "buy" ? "Buy" : "Sell"}</td><td><b>${esc(t.symbol)}</b></td><td class="num">${t.qty}</td><td class="num">${px(t.price)}</td><td class="hint">${esc(t.accountLabel)}</td><td><button type="button" class="ghost" data-delt="${esc(t.tradeId)}" aria-label="Remove">✕</button></td></tr>`).join("")}</tbody></table></div></details>` : "";
    const notes = d.notes.map(n => `<p class="hint">ℹ️ ${esc(n)}</p>`).join("");
    box.innerHTML = `${tools}<section class="report-card">${cards}${notes}</section>${months}${open}${closed}${accs}${manual}
      <p class="vs-fine">Built only from your brokers' records: imported tax P&L reports (their figures as they are), tradebooks, Dhan's trade history, the daily pick-up of trades and trades you add here. The same data feeds the Tax view, so both always agree. Nothing from the old Swing trading journal is used. Swing = sales of stocks and ETFs held up to 12 months (and same-day trades); long-term sales, mutual funds, debt ETFs and US stocks are left out. Not tax advice.</p>`;
  }
  async function addTrade() {
    const accs = d.accountsList, today = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
    const out = await window.ui.dialog({ title: "Add a trade", icon: "✍️", okText: "Add",
      bodyHtml: `<p class="hint">For a fill your broker's file doesn't have yet. It goes into the tradebook the Tax view uses. When you import a newer report for that account, the report's figures are used for its period.</p>
        <div class="nw-form"><label class="ui-field"><span>Date</span><input class="ui-input" type="date" name="date" value="${today}" max="${today}"></label>
        <label class="ui-field"><span>Buy or sell</span><select class="ui-input" name="side"><option value="buy">Buy</option><option value="sell">Sell</option></select></label>
        <label class="ui-field"><span>NSE symbol</span><input class="ui-input" name="symbol" placeholder="INFY" autocapitalize="characters"></label>
        <label class="ui-field"><span>Quantity</span><input class="ui-input" name="qty" inputmode="decimal"></label>
        <label class="ui-field"><span>Price (₹)</span><input class="ui-input" name="price" inputmode="decimal"></label>
        <label class="ui-field"><span>Account</span><select class="ui-input" name="account">${accs.map(a => `<option value="${esc(a.id)}">${esc(a.label)}</option>`).join("")}</select></label></div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return api("/api/swingbook/trade", { date: v("date"), side: v("side"), symbol: v("symbol"), qty: v("qty"), price: v("price"), account: v("account"), fy }); } });
    if (out) { d = out; render(); window.toast?.(esc(out.notice), { kind: "ok" }); }
  }
  const init = () => {
    const v = $("#sbView"); if (!v) return;
    v.addEventListener("click", async e => {
      const t = e.target;
      if (t.closest("#sbReload")) return load();
      if (t.closest("#sbAdd")) return addTrade();
      if (t.closest("#sbImport")) return $("#sbFile").click();
      if (t.closest("#sbMore")) { more = true; return render(); }
      const dt = t.closest("[data-delt]"); if (dt) { try { d = await api("/api/swingbook/trade-delete", { tradeId: dt.dataset.delt, fy }); render(); window.toast?.("Trade removed.", { kind: "ok" }); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); } }
    });
    v.addEventListener("change", async e => {
      const t = e.target;
      if (t.id === "sbFy") { fy = t.value; more = false; return load(); }
      if (t.id === "sbAcc") { fAcc = t.value; more = false; return render(); }
      if (t.id === "sbRes") { fRes = t.value; more = false; return render(); }
      if (t.id === "sbFile" && t.files[0]) {
        const f = t.files[0], st = $("#sbStatus"); st.textContent = `Reading ${f.name}…`;
        try {
          const data = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1]); r.onerror = () => bad(new Error("Could not read the file.")); r.readAsDataURL(f); });
          const j = await api("/api/tax/import", { filename: f.name, data });
          await load();
          const msg = j.report ? `${j.report.broker} tax P&L, ${j.report.fy}: ${j.report.sales} sales up to ${j.report.to}` : `${j.imported.rows} trades read, ${j.imported.added} new`;
          $("#sbStatus").textContent = `${f.name}: ${msg}.`; window.toast?.(`✓ ${esc(msg)}`, { kind: "ok" });
        } catch (err) { st.textContent = err.message; window.toast?.(esc(err.message), { kind: "bad" }); }
        t.value = "";
      }
    });
    v.addEventListener("input", e => { if (e.target.id !== "sbQ") return; q = e.target.value.trim().toLowerCase(); render(); const i = $("#sbQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.swingbook = () => load();
})();
