// Swing → Match with your broker: the journal's sales against the broker's records (tax P&L reports, trades on file).
// Reads /api/swing/recon; fixes and additions go to /api/swing/recon-apply. Loaded the first time the card opens.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—"), px = v => (fin(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
  const sgn = v => (!fin(v) ? "—" : v === 0 ? "₹0" : `${v > 0 ? "+" : "−"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`), cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const day = s => (s ? new Date(`${s}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "—");
  let d = null, fy = null, tab = "differ", busy = false;
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  async function load() { const box = $("#swReconBody"); if (!box) return; try { d = await api(`/api/swing/recon${fy ? `?fy=${encodeURIComponent(fy)}` : ""}`); fy = d.fy; render(); } catch (e) { box.innerHTML = `<p class="hint">Could not load: ${esc(e.message)}</p>`; } }
  const DIFF = { qty: "Quantity", buy: "Buy price", sell: "Sell price", date: "Sale date" };
  const fmt = (f, v) => (f === "date" ? day(v) : f === "qty" ? v : px(v));
  function render() {
    const box = $("#swReconBody"), C = d.counts, T = d.totals; if (!box) return;
    $("#swReconSum").textContent = d.hasBroker ? `${C.same} of ${C.journal} journal sales match · ${C.differ} differ · ${C.journalOnly} only in journal · ${C.brokerOnly} swing sales missing` : "import your brokers' tax P&L in the Tax view first";
    if (!d.hasBroker) { box.innerHTML = `<p class="bk-act info">💡 Nothing from a broker yet. In <a href="#" data-goto-tax>Tax view</a>, import each broker's tax P&L report (Zerodha, INDmoney, Dhan) or tradebook, then come back: every sale in this journal is checked against it.</p>`; return; }
    const fyOpts = d.fys.map(f => `<option${f === d.fy ? " selected" : ""}>${esc(f)}</option>`).join("");
    const differ = d.matched.filter(m => m.status === "differs"), same = d.matched.filter(m => m.status === "same"), fixable = differ.filter(m => m.fixable);
    const head = `<div class="sr-head"><select class="ui-input" id="srFy">${fyOpts}</select>
      <div class="sr-sum"><div><span>Journal P&L</span><b class="${cls(T.journal)}">${sgn(T.journal)}</b><small>${C.journal} sales you typed</small></div>
      <div><span>Swing P&L at your brokers</span><b class="${cls(T.swingAtBroker)}">${sgn(T.swingAtBroker)}</b><small>matched + short-term sales not in the journal</small></div>
      <div><span>Gap</span><b class="${cls(T.swingAtBroker - T.journal)}">${sgn(T.swingAtBroker - T.journal)}</b><small>${T.swingAtBroker === T.journal ? "the same" : "fix below to close it"}</small></div></div></div>`;
    const tabs = `<div class="sr-tabs">${[["differ", `⚠️ Differ (${differ.length})`], ["broker", `➕ Missing from journal (${d.brokerOnly.length})`], ["journal", `❓ Only in journal (${d.journalOnly.length})`], ["same", `✅ Match (${same.length})`]].map(([k, l]) => `<button type="button" class="${tab === k ? "on" : ""}" data-tab="${k}">${l}</button>`).join("")}</div>`;
    let body = "";
    if (tab === "differ") body = differ.length ? `${fixable.length > 1 ? `<button type="button" class="primary" data-fixall${busy ? " disabled" : ""}>Use the broker's numbers for all ${fixable.length}</button>` : ""}
      <div class="table-wrap"><table class="sr-t"><thead><tr><th>Stock</th><th>What differs</th><th class="num">Journal</th><th class="num">Broker</th><th class="num">P&L gap</th><th></th></tr></thead><tbody>${differ.map(m => `<tr><td><b>${esc(m.journal.name || m.journal.symbol)}</b><div class="hint">sold ${day(m.journal.day)} · ${esc(m.broker.accountLabel || "")}${m.broker.noDates ? " (report without dates: whole year)" : ""}</div></td>
        <td>${m.diffs.map(x => `<div>${DIFF[x.field]}</div>`).join("")}</td><td class="num">${m.diffs.map(x => `<div>${fmt(x.field, x.journal)}</div>`).join("")}</td><td class="num">${m.diffs.map(x => `<div><b>${fmt(x.field, x.broker)}</b></div>`).join("")}</td>
        <td class="num ${cls(m.pnlGap)}">${sgn(m.pnlGap)}<div class="hint">journal ${sgn(m.journal.pnl)} · broker ${sgn(m.broker.gain)}</div></td>
        <td>${m.fixable ? `<button type="button" class="ghost" data-fix="${esc(m.journal.ids.join(","))}">Use broker's</button>` : `<span class="hint">${m.diffs.some(x => x.field === "qty") ? "Quantity differs: check partial sales, then fix in the Ledger" : "Fix in the Ledger"}</span>`}</td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">No differences.</p>';
    if (tab === "broker") body = d.brokerOnly.length ? `<p class="hint">Short-term and intraday sales your brokers have that the journal doesn't. Add the swing ones; hide the rest (e.g. funds or investments you sold).${d.investments ? ` ${d.investments} long-term sales (${sgn(d.investmentsPnl)}) are left out: those are investments.` : ""}</p>
      ${d.brokerOnly.filter(b => !b.noDates).length > 1 ? `<button type="button" class="primary" data-addall${busy ? " disabled" : ""}>Add all ${d.brokerOnly.filter(b => !b.noDates).length} to the journal</button>` : ""}
      <div class="table-wrap"><table class="sr-t"><thead><tr><th>Stock</th><th>Account</th><th class="num">Qty</th><th class="num">Bought</th><th class="num">Sold</th><th class="num">P&L</th><th></th></tr></thead><tbody>${d.brokerOnly.map(b => `<tr><td><b>${esc(b.symbol || b.name)}</b>${b.name && b.name !== b.symbol ? `<div class="hint">${esc(b.name)}</div>` : ""}</td><td class="hint">${esc(b.accountLabel || "")}</td><td class="num">${b.qty}</td>
        <td class="num">${px(b.buyAvg)}<div class="hint">${day(b.buyDay)}</div></td><td class="num">${px(b.sellAvg)}<div class="hint">${b.noDates ? "whole year" : day(b.day)}</div></td><td class="num ${cls(b.gain)}">${sgn(b.gain)}</td>
        <td class="sr-act">${b.noDates ? '<span class="hint">no dates: add by hand</span>' : `<button type="button" class="ghost" data-add="${esc(b.k)}">Add</button>`}<button type="button" class="ghost" data-ign="${esc(b.k)}" title="Not a swing trade">Hide</button></td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">Every short-term sale at your brokers is in the journal.${d.ignored ? ` <button type="button" class="linkbtn" data-unign>Show ${d.ignored} hidden</button>` : ""}</p>`;
    if (tab === "journal") body = d.journalOnly.length ? `<p class="hint">In the journal, but no broker has a sale of this stock within 3 days. Usually a typo in the date or stock, a sale in an account whose report isn't imported yet, or a trade that never happened. Fix or remove it in the Ledger.</p>
      <div class="table-wrap"><table class="sr-t"><thead><tr><th>Stock</th><th class="num">Sold</th><th class="num">Qty</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">P&L</th></tr></thead><tbody>${d.journalOnly.map(j => `<tr><td><b>${esc(j.name || j.symbol)}</b><div class="hint">${esc(j.symbol)}</div></td><td class="num">${day(j.day)}</td><td class="num">${j.qty}</td><td class="num">${px(j.buyAvg)}</td><td class="num">${px(j.sellAvg)}</td><td class="num ${cls(j.pnl)}">${sgn(j.pnl)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">Every journal sale was found at a broker.</p>';
    if (tab === "same") body = same.length ? `<div class="table-wrap"><table class="sr-t"><thead><tr><th>Stock</th><th class="num">Sold</th><th class="num">Qty</th><th class="num">P&L</th><th>Account</th></tr></thead><tbody>${same.map(m => `<tr><td><b>${esc(m.journal.name || m.journal.symbol)}</b></td><td class="num">${day(m.journal.day)}</td><td class="num">${m.journal.qty}</td><td class="num ${cls(m.broker.gain)}">${sgn(m.broker.gain)}</td><td class="hint">${esc(m.broker.accountLabel || "")}</td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">None yet.</p>';
    box.innerHTML = `${head}${tabs}<div class="sr-body">${body}</div><p class="vs-fine">Your brokers' records are the source of truth: tax in Swing and in the Tax view comes from them, never from what is typed here. "Use broker's" sets the journal's buy and sell prices (and sale date) to the broker's; swing cash moves by the P&L change. Added sales don't change swing cash. Sales match on the same stock within 3 days; a report without dates (Dhan) is matched on the year's total for each stock.</p>`;
  }
  async function act(action, items) {
    busy = true; render();
    try { d = await api("/api/swing/recon-apply", { action, items, fy }); window.toast?.(esc(d.notice || "Done."), { kind: "ok" }); window.swingReload?.(); }
    catch (e) { window.toast?.(esc(e.message), { kind: "bad" }); }
    busy = false; render();
  }
  const box = $("#swReconBody");
  box?.addEventListener("click", e => {
    const t = e.target;
    if (t.closest("[data-goto-tax]")) { e.preventDefault(); return window.setView?.("tax"); }
    const tb = t.closest("[data-tab]"); if (tb) { tab = tb.dataset.tab; return render(); }
    const f = t.closest("[data-fix]"); if (f) return act("fix", [f.dataset.fix]);
    if (t.closest("[data-fixall]")) return act("fix", d.matched.filter(m => m.fixable).map(m => m.journal.ids.join(",")));
    const a = t.closest("[data-add]"); if (a) return act("add", [a.dataset.add]);
    if (t.closest("[data-addall]")) return act("add", d.brokerOnly.filter(b => !b.noDates).map(b => b.k));
    const ig = t.closest("[data-ign]"); if (ig) return act("ignore", [ig.dataset.ign]);
    if (t.closest("[data-unign]")) return act("unignore", []);
  });
  box?.addEventListener("change", e => { if (e.target.id === "srFy") { fy = e.target.value; load(); } });
  window.loadSwRecon = load;
})();
