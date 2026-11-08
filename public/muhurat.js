// Diwali Muhurat picks: one tab per year plus All years. Entries by hand; prices from the app's live / last prices.
// Reads /api/muhurat. Loaded on demand (app.js LAZY_VIEWS).
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—"), px = v => (fin(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : inr(v));
  const sgn = v => (!fin(v) ? "—" : v === 0 ? "₹0" : `${v > 0 ? "+" : "−"}${amt(Math.abs(v))}`), cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const pc = v => (fin(v) ? `${v > 0 ? "+" : ""}${v}%` : "—");
  const day = s => (s ? new Date(`${s.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");
  let d = null, tab = null;
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  async function load() { try { d = await api("/api/muhurat"); render(); } catch (e) { $("#mhBody").innerHTML = `<p class="hint">Could not load: ${esc(e.message)}</p>`; } }
  const cagrCell = (c, held) => (fin(c) ? `<b class="${cls(c)}">${c > 0 ? "+" : ""}${c}%</b>` : `<span class="hint" title="CAGR shows once held a year: a few months' move, annualised, says little">${held < 1 ? `after ${Math.max(0, 12 - Math.round(held * 12))} mo` : "—"}</span>`);
  function render() {
    const box = $("#mhBody"), A = d.all, years = d.years.filter(y => y.picks.length || y.year === tab);
    if (tab === null) tab = years.length ? "all" : d.suggestYear;
    const tabYears = [...new Set([...d.years.map(y => y.year), d.suggestYear])].sort((a, b) => b - a);
    const tabs = `<div class="mh-tabs">${[["all", "All years"], ["watch", "Watchlist"], ...tabYears.map(y => [y, String(y)])].map(([k, l]) => `<button type="button" class="${String(tab) === String(k) ? "on" : ""}${k === "watch" ? " mh-wtab" : ""}" data-tab="${k}">${k === "all" ? "🪔 " : k === "watch" ? "👀 " : ""}${l}${k === "watch" && d.watch.rows.length ? ` <small>${d.watch.rows.length}</small>` : ""}${k !== "all" && d.years.find(y => y.year === k)?.picks.length ? ` <small>${d.years.find(y => y.year === k).picks.length}</small>` : ""}</button>`).join("")}<button type="button" class="ghost" data-newyear>+ Another year</button></div>`;
    const banner = d.muhuratToday ? `<p class="bk-act ok">🪔 Today is Muhurat trading. Add today's picks to ${d.suggestYear} once they're bought.</p>` : "";
    let body = "";
    if (tab === "watch") {
      const W = d.watch, nextY = W.nextDate ? Number(W.nextDate.slice(0, 4)) : null, budget = nextY ? d.years.find(y => y.year === nextY)?.budget : null;
      const rows = W.rows.map(w => `<tr class="${w.atTarget ? "mh-hit" : ""}"><td><b>${esc(w.symbol)}</b>${w.name && w.name.toUpperCase() !== w.symbol ? `<div class="hint">${esc(w.name)}</div>` : ""}${w.note ? `<div class="hint">📝 ${esc(w.note)}</div>` : ""}</td>
        <td class="num">${px(w.now)}${fin(w.sinceAdded) ? `<div class="hint ${cls(w.sinceAdded)}">${pc(w.sinceAdded)} since ${day(w.addedOn)}</div>` : `<div class="hint">added ${day(w.addedOn)}</div>`}</td>
        <td class="num">${w.target ? `${px(w.target)}<div class="hint">${w.atTarget ? '<b class="pl-up">✅ at or below</b>' : `${w.toTarget}% above`}</div>` : '<span class="hint">—</span>'}</td>
        <td class="num">${fin(w.offHigh) ? `${w.offHigh}% below<div class="hint">high ${px(w.high52)}</div>` : '<span class="hint">—</span>'}</td>
        <td>${w.verdict?.zoneHigh ? `${esc(w.verdict.status || "")}<div class="hint">buy zone ${px(w.verdict.zoneLow)}–${px(w.verdict.zoneHigh)}${w.verdict.inZone ? " · in zone" : ""}</div>` : '<span class="hint">add it to your watchlist for a valuation</span>'}</td>
        <td class="num">${w.amount ? `${amt(w.amount)}${w.qtyAtNow ? `<div class="hint">≈ ${w.qtyAtNow} shares now</div>` : ""}` : '<span class="hint">—</span>'}</td>
        <td class="mh-act"><button type="button" class="ghost" data-bought="${esc(w.id)}" title="Bought it in the Muhurat session">✓ Bought</button><button type="button" class="ghost" data-wedit="${esc(w.id)}" aria-label="Edit">✎</button><button type="button" class="ghost" data-wdel="${esc(w.id)}" aria-label="Remove">✕</button></td></tr>`).join("");
      body = `<section class="report-card"><div class="mh-cards">
        <div><span>Next Muhurat</span><strong>${W.nextDate ? day(W.nextDate) : "—"}</strong><small>${W.nextDate ? (W.daysToNext === 0 ? "today" : `in ${W.daysToNext} days`) : "date announced closer to Diwali"}</small></div>
        <div><span>On the watchlist</span><strong>${W.rows.length}</strong><small>${W.atTarget} at or below your buy-below price</small></div>
        <div><span>Planned to invest</span><strong>${amt(W.planned)}</strong><small>${fin(budget) ? `budget for ${nextY}: ${amt(budget)}${W.planned > budget ? ' · <b class="pl-dn">over budget</b>' : ""}` : "set a budget in the year's ⚙ settings"}</small></div></div>
        <div class="nw-head"><h3>👀 Shortlist for the next Diwali</h3><button type="button" class="primary" data-wadd>+ Add a stock</button></div>
        ${W.rows.length ? `<div class="table-wrap"><table class="mh-t"><thead><tr><th>Stock</th><th class="num">Now</th><th class="num">Buy below</th><th class="num">From 52-wk high</th><th>Valuation</th><th class="num">Planned</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="hint">Add stocks you\'d like to buy in a Muhurat session. Set a buy-below price and a planned amount; when you buy, tap ✓ Bought and it moves into that year\'s picks.</p>'}
        <p class="vs-fine">Prices update like the rest of the app. The 52-week range comes from saved closing prices (it appears after a few weeks for a new stock). Valuation and buy zone come from your main watchlist when the stock is in it. Not advice.</p></section>`;
    } else if (tab === "all") {
      body = A.picks ? `<section class="report-card"><div class="mh-cards">
        <div><span>Invested since ${esc(String(d.years.at(-1)?.year || ""))}</span><strong>${amt(A.invested)}</strong><small>${A.picks} picks over ${A.years} Diwali${A.years === 1 ? "" : "s"}</small></div>
        <div><span>Worth today</span><strong>${amt(A.value)}</strong><small class="${cls(A.gain)}">${sgn(A.gain)} · ${pc(A.absPct)}</small></div>
        <div><span>XIRR, all years</span><strong>${fin(A.xirr) ? `<span class="${cls(A.xirr)}">${A.xirr > 0 ? "+" : ""}${A.xirr}%</span>` : "—"}</strong><small>${fin(A.xirr) ? (A.doubleIn ? `money doubles every ${A.doubleIn} years at this rate` : "") : "shows once your first pick is a year old"}</small></div>
        <div><span>Winners</span><strong>${A.winners} of ${A.picks}</strong><small>${A.best ? `best: ${esc(A.best.symbol)} (${A.best.year}) at ${A.best.cagr}% a year` : "CAGR shows after a year"}</small></div></div>
        ${A.unpriced ? `<p class="hint">⏳ ${A.unpriced} pick${A.unpriced === 1 ? "" : "s"} without a price yet: it comes with the next price refresh.</p>` : ""}</section>
        <section class="report-card"><h3>Each Diwali, side by side</h3><div class="table-wrap"><table class="mh-t"><thead><tr><th>Year</th><th class="num">Picks</th><th class="num">Invested</th><th class="num">Worth now</th><th class="num">Gain</th><th class="num">CAGR</th><th class="num">Nifty CAGR</th><th class="num">vs Nifty</th></tr></thead><tbody>
        ${d.years.filter(y => y.picks.length).map(y => `<tr class="mh-row" data-tab="${y.year}"><td><b>${y.year}</b><div class="hint">${day(y.date)} · ${y.heldYears} yr</div></td><td class="num">${y.picks.length}</td><td class="num">${amt(y.invested)}</td><td class="num">${amt(y.value)}</td><td class="num ${cls(y.gain)}">${sgn(y.gain)}<div class="hint">${pc(y.absPct)}</div></td><td class="num">${cagrCell(y.cagr, y.heldYears)}</td><td class="num">${fin(y.nifty.cagr) ? `${y.nifty.cagr}%` : fin(y.nifty.absPct) && y.heldYears < 1 ? `<span class="hint">${pc(y.nifty.absPct)} so far</span>` : '<span class="hint">—</span>'}</td><td class="num">${fin(y.vsNifty) ? `<b class="${cls(y.vsNifty)}">${y.vsNifty > 0 ? "+" : ""}${y.vsNifty}${fin(y.cagr) ? " pts" : "%"}</b>` : "—"}</td></tr>`).join("")}</tbody></table></div>
        <p class="vs-fine">CAGR is the yearly rate at which each Diwali's money has grown, shown once it's a year old. XIRR combines all years, each from its own buy date. "vs Nifty" compares with putting the same money in NIFTYBEES on the same day.</p></section>`
        : `<section class="report-card"><p class="bk-act info">🪔 Add the stocks you bought in each Muhurat session. Pick a year tab, then <b>+ Add a pick</b>. Prices update on their own; CAGR starts once a pick is a year old.</p></section>`;
    } else {
      const y = d.years.find(x => x.year === Number(tab)) || { year: Number(tab), date: d.dates[tab] || null, picks: [], invested: 0, value: 0, nifty: {}, heldYears: 0 };
      const cards = y.picks.length ? `<div class="mh-cards">
        <div><span>Invested on ${day(y.date)}</span><strong>${amt(y.invested)}</strong><small>${y.picks.length} pick${y.picks.length === 1 ? "" : "s"}${fin(y.budget) ? ` · budget ${amt(y.budget)}` : ""}</small></div>
        <div><span>Worth today</span><strong>${amt(y.value)}</strong><small class="${cls(y.gain)}">${sgn(y.gain)} · ${pc(y.absPct)}</small></div>
        <div><span>CAGR</span><strong>${cagrCell(y.cagr, y.heldYears)}</strong><small>${fin(y.cagr) ? (y.doubleIn ? `doubles every ${y.doubleIn} years at this rate` : "") : `held ${y.heldYears} yr; CAGR from ${day(y.picks[0]?.longFrom)}`}</small></div>
        <div><span>Same money in Nifty</span><strong>${amt(y.nifty.ifInvested)}</strong><small>${fin(y.nifty.cagr) ? `${y.nifty.cagr}% a year` : fin(y.nifty.absPct) ? `${pc(y.nifty.absPct)} so far` : "needs NIFTYBEES's price on that day (⚙ below)"}${fin(y.vsNifty) ? ` · you're <b class="${cls(y.vsNifty)}">${y.vsNifty > 0 ? "ahead" : "behind"} by ${Math.abs(y.vsNifty)}${fin(y.cagr) ? " pts" : "%"}</b>` : ""}</small></div></div>` : "";
      const rows = y.picks.map(p => `<tr><td><b>${esc(p.symbol)}</b>${p.name && p.name.toUpperCase() !== p.symbol ? `<div class="hint">${esc(p.name)}</div>` : ""}${p.note ? `<div class="hint">📝 ${esc(p.note)}</div>` : ""}</td><td class="num">${p.qty}</td><td class="num">${px(p.price)}<div class="hint">${day(p.date)}</div>${p.heldYears < 1 ? `<div class="hint">long term from ${day(p.longFrom)}</div>` : ""}</td><td class="num">${px(p.now)}</td><td class="num">${amt(p.invested)}</td><td class="num">${amt(p.value)}</td><td class="num ${cls(p.gain)}">${sgn(p.gain)}<div class="hint">${pc(p.absPct)}</div></td><td class="num">${cagrCell(p.cagr, p.heldYears)}${p.doubleIn ? `<div class="hint">2× in ${p.doubleIn} yr</div>` : ""}</td><td class="mh-act"><button type="button" class="ghost" data-edit="${esc(p.id)}" aria-label="Edit">✎</button><button type="button" class="ghost" data-del="${esc(p.id)}" aria-label="Remove">✕</button></td></tr>`).join("");
      body = `<section class="report-card">${cards}<div class="nw-head"><h3>🪔 Diwali ${y.year} picks</h3><button type="button" class="primary" data-add="${y.year}">+ Add a pick</button></div>
        ${y.picks.length ? `<div class="table-wrap"><table class="mh-t"><thead><tr><th>Stock</th><th class="num">Qty</th><th class="num">Bought at</th><th class="num">Now</th><th class="num">Invested</th><th class="num">Worth</th><th class="num">Gain</th><th class="num">CAGR</th><th></th></tr></thead><tbody>${rows}
          <tr class="pn-total"><td><b>Total</b></td><td></td><td></td><td></td><td class="num"><b>${amt(y.invested)}</b></td><td class="num"><b>${amt(y.value)}</b></td><td class="num ${cls(y.gain)}"><b>${sgn(y.gain)}</b></td><td class="num">${cagrCell(y.cagr, y.heldYears)}</td><td></td></tr></tbody></table></div>` : `<p class="hint">No picks for ${y.year} yet.</p>`}
        <details class="mh-set"><summary>⚙ ${y.year} settings <span class="hint">Muhurat date ${day(y.date)}${y.nifty.then ? ` · NIFTYBEES then ₹${y.nifty.then}${y.nifty.thenFrom === "history" ? " (from saved prices)" : ""}` : ""}</span></summary>
          <div class="nw-form"><label class="ui-field"><span>Muhurat date</span><input class="ui-input" type="date" name="date" value="${esc(y.date || "")}"></label>
          <label class="ui-field"><span>NIFTYBEES price that day (for the Nifty comparison)</span><input class="ui-input" name="niftyThen" inputmode="decimal" value="${y.nifty.thenFrom === "you" ? y.nifty.then : ""}" placeholder="${y.nifty.then ? `₹${y.nifty.then} from saved prices` : "e.g. 268.5"}"></label>
          <label class="ui-field"><span>Budget for this Diwali (₹, optional)</span><input class="ui-input" name="budget" inputmode="decimal" value="${y.budget ?? ""}"></label></div>
          <button type="button" class="primary" data-saveyear="${y.year}">Save</button></details></section>
        <p class="vs-fine">Kept for the long run: nothing is sold here. A pick turns long term (for tax, if you ever sell) a year and a day after you bought it. CAGR shows once a pick is a year old. Prices: live during market hours, else the last close.</p>`;
    }
    box.innerHTML = banner + tabs + body;
  }
  async function watchForm(w = null) {
    const out = await window.ui.dialog({ title: w ? `Edit ${w.symbol}` : "Add to the Muhurat watchlist", icon: "👀", okText: w ? "Save" : "Add",
      bodyHtml: `<div class="nw-form">${w ? "" : '<label class="ui-field"><span>NSE symbol</span><input class="ui-input" name="symbol" placeholder="e.g. TITAN" autocapitalize="characters"></label>'}
        <label class="ui-field"><span>Buy below (₹, optional)</span><input class="ui-input" name="target" inputmode="decimal" value="${w?.target ?? ""}"></label>
        <label class="ui-field"><span>Planned amount (₹, optional)</span><input class="ui-input" name="amount" inputmode="decimal" value="${w?.amount ?? ""}"></label>
        <label class="ui-field"><span>Note (why this stock)</span><input class="ui-input" name="note" maxlength="140" value="${esc(w?.note || "")}"></label></div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`)?.value ?? ""; return api(`/api/muhurat/${w ? "watch-edit" : "watch-add"}`, { id: w?.id, symbol: w ? w.symbol : v("symbol"), target: v("target"), amount: v("amount"), note: v("note") }); } });
    if (out) { d = out; tab = "watch"; render(); window.toast?.(esc(out.notice), { kind: "ok" }); }
  }
  async function boughtForm(w) {
    const year = d.suggestYear, date = d.dates[year] || "";
    const out = await window.ui.dialog({ title: `Bought ${w.symbol}`, icon: "🪔", okText: "Move to picks",
      bodyHtml: `<p class="hint">It moves from the watchlist into that year's Muhurat picks.</p><div class="nw-form">
        <label class="ui-field"><span>Diwali year</span><input class="ui-input" name="year" inputmode="numeric" value="${year}"></label>
        <label class="ui-field"><span>Quantity</span><input class="ui-input" name="qty" inputmode="decimal" value="${w.qtyAtNow ?? ""}"></label>
        <label class="ui-field"><span>Buy price (₹)</span><input class="ui-input" name="price" inputmode="decimal" value="${w.now ?? ""}"></label>
        <label class="ui-field"><span>Bought on</span><input class="ui-input" type="date" name="date" value="${esc(date)}"></label></div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return api("/api/muhurat/watch-bought", { id: w.id, year: v("year"), qty: v("qty"), price: v("price"), date: v("date") }); } });
    if (out) { d = out; tab = Number(box2year(out, w)); render(); window.toast?.(esc(out.notice), { kind: "ok" }); }
  }
  const box2year = (out, w) => out.years.find(y => y.picks.some(p => p.symbol === w.symbol))?.year ?? "all";
  async function pickForm(year, p = null) {
    const y = d.years.find(x => x.year === Number(year)), date = p?.date || y?.date || d.dates[year] || "";
    const out = await window.ui.dialog({ title: p ? `Edit ${p.symbol}` : `Add a Diwali ${year} pick`, icon: "🪔", okText: p ? "Save" : "Add",
      bodyHtml: `<div class="nw-form"><label class="ui-field"><span>NSE symbol</span><input class="ui-input" name="symbol" value="${esc(p?.symbol || "")}" placeholder="e.g. HDFCBANK" autocapitalize="characters"></label>
        <label class="ui-field"><span>Quantity</span><input class="ui-input" name="qty" inputmode="decimal" value="${p?.qty ?? ""}"></label>
        <label class="ui-field"><span>Buy price (₹)</span><input class="ui-input" name="price" inputmode="decimal" value="${p?.price ?? ""}"></label>
        <label class="ui-field"><span>Bought on</span><input class="ui-input" type="date" name="date" value="${esc(date)}"></label>
        <label class="ui-field"><span>Note (why this stock)</span><input class="ui-input" name="note" value="${esc(p?.note || "")}" maxlength="140"></label></div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return api(`/api/muhurat/${p ? "edit" : "add"}`, { id: p?.id, year, symbol: v("symbol"), qty: v("qty"), price: v("price"), date: v("date"), note: v("note") }); } });
    if (out) { d = out; tab = Number(year); render(); window.toast?.(esc(out.notice), { kind: "ok" }); }
  }
  const init = () => {
    const v = $("#mhView"); if (!v) return;
    v.addEventListener("click", async e => {
      const t = e.target;
      if (t.closest("#mhReload")) return load();
      const tb = t.closest("[data-tab]"); if (tb) { tab = ["all", "watch"].includes(tb.dataset.tab) ? tb.dataset.tab : Number(tb.dataset.tab); return render(); }
      if (t.closest("[data-wadd]")) return watchForm();
      const wf = id => d.watch.rows.find(x => x.id === id);
      const we = t.closest("[data-wedit]"); if (we) return watchForm(wf(we.dataset.wedit));
      const wb = t.closest("[data-bought]"); if (wb) return boughtForm(wf(wb.dataset.bought));
      const wd = t.closest("[data-wdel]"); if (wd) { const w = wf(wd.dataset.wdel); if (await window.ui.confirm({ title: `Remove ${w.symbol}?`, message: "Takes it off the Muhurat watchlist.", okText: "Remove", danger: true })) { try { d = await api("/api/muhurat/watch-delete", { id: w.id }); render(); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); } } return; }
      if (t.closest("[data-newyear]")) { const y = await window.ui.dialog({ title: "Which Diwali?", icon: "🪔", okText: "Open", bodyHtml: `<label class="ui-field"><span>Year</span><input class="ui-input" name="y" inputmode="numeric" value="${d.suggestYear - 1}"></label>`, collect: b => { const n = Number(b.querySelector("[name=y]").value); if (!(n >= 1990 && n <= d.suggestYear)) throw new Error("Enter a year up to this one."); return n; } }); if (y) { tab = y; render(); } return; }
      const a = t.closest("[data-add]"); if (a) return pickForm(Number(a.dataset.add));
      const ed = t.closest("[data-edit]"); if (ed) { const p = d.years.flatMap(y => y.picks).find(x => x.id === ed.dataset.edit); return pickForm(p.year, p); }
      const dl = t.closest("[data-del]"); if (dl) { const p = d.years.flatMap(y => y.picks).find(x => x.id === dl.dataset.del); if (await window.ui.confirm({ title: `Remove ${p.symbol}?`, message: `Removes this ${p.year} pick from the tracker (nothing is sold).`, okText: "Remove", danger: true })) { try { d = await api("/api/muhurat/delete", { id: p.id }); render(); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); } } return; }
      const sy = t.closest("[data-saveyear]"); if (sy) { const f = t.closest(".mh-set"), v2 = n => f.querySelector(`[name=${n}]`).value.trim(); try { d = await api("/api/muhurat/year", { year: Number(sy.dataset.saveyear), date: v2("date"), niftyThen: v2("niftyThen"), budget: v2("budget") }); render(); window.toast?.(esc(d.notice), { kind: "ok" }); } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); } }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.muhurat = () => load();
})();
