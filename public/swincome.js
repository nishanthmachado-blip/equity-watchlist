// Swing income tracker on the Swing page: booked profit month by month against your monthly target (after tax), how
// often you hit it, win rate, payoff, streaks, and the swing capital your own results say the target needs.
// Loaded the first time Swing opens. Reads /api/swing/income.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}` : "—");
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `${v < 0 ? "−" : ""}₹${+(Math.abs(v) / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${v < 0 ? "−" : ""}₹${+(Math.abs(v) / 1e5).toFixed(2)} L` : inr(v));
  const mon = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  let d = null, openMonth = null; // openMonth: the month whose trades are listed (click a bar or a row)
  async function load(body) {
    const box = $("#swIncome"); if (!box) return;
    try { const r = await fetch("/api/swing/income", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" }); const j = await r.json(); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); d = j; render(); if (body?.target) window.toast?.("Monthly target saved.", { kind: "ok", ms: 2000 }); }
    catch (e) { if (body) window.toast?.(esc(e.message), { kind: "bad" }); else box.hidden = true; }
  }
  // month by month: trades, wins, booked, after tax, target hit; a month's trades open under it
  function monthsHtml() {
    const rows = [...d.series].reverse().filter(x => x.trades || x.month === d.current.month);
    if (!rows.length) return "";
    const list = m => { const T = d.monthTrades?.[m] || []; return T.length ? `<tr class="si-mt"><td colspan="6"><div class="table-wrap m-keep"><table class="si-trades"><thead><tr><th>Sold</th><th>Stock</th><th class="num">Qty</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Booked</th><th class="num">Held</th></tr></thead><tbody>${T.map(t => `<tr><td>${esc(new Date(`${t.day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" }))}</td><td><b>${esc(t.symbol)}</b>${t.account ? `<div class="hint">${esc(t.account)}${t.intraday ? " · intraday" : ""}</div>` : t.intraday ? '<div class="hint">intraday</div>' : ""}</td><td class="num">${t.qty ?? "—"}</td><td class="num">${fin(t.buyAvg) ? inr(t.buyAvg) : "—"}</td><td class="num">${fin(t.sellAvg) ? inr(t.sellAvg) : "—"}</td><td class="num ${t.pnl < 0 ? "pl-dn" : "pl-up"}">${inr(t.pnl)}</td><td class="num">${t.days ? `${t.days} d` : t.intraday ? "same day" : "—"}</td></tr>`).join("")}</tbody></table></div></td></tr>` : `<tr class="si-mt"><td colspan="6" class="hint">No trades this month.</td></tr>`; };
    return `<details class="si-months" ${openMonth ? "open" : ""}><summary><b>📅 Month by month</b> <span class="hint">click a month (or a bar) to see its trades</span></summary><div class="table-wrap m-keep"><table class="si-mtab"><thead><tr><th>Month</th><th class="num">Trades</th><th class="num">Win rate</th><th class="num">Booked</th><th class="num">After tax</th><th>Target</th></tr></thead><tbody>${rows.map(x => `<tr class="si-mrow${x.month === openMonth ? " sel" : ""}" data-simonth="${x.month}" role="button" tabindex="0"><td><b>${esc(new Date(`${x.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "2-digit", timeZone: "UTC" }))}</b>${x.month === d.current.month ? ' <span class="hint">so far</span>' : ""}</td><td class="num">${x.trades}</td><td class="num">${x.trades ? `${Math.round(x.wins / x.trades * 100)}%` : "—"}</td><td class="num ${x.pnl < 0 ? "pl-dn" : x.pnl > 0 ? "pl-up" : ""}">${inr(x.pnl)}</td><td class="num">${inr(x.afterTax)}</td><td>${x.hit ? "✅ hit" : x.month === d.current.month ? `${d.current.pct}%` : x.pnl < 0 ? "🔻 loss" : `${Math.max(0, Math.round(x.pnl / d.preTax * 100))}%`}</td></tr>${x.month === openMonth ? list(x.month) : ""}`).join("")}</tbody></table></div></details>`;
  }
  function render() {
    const box = $("#swIncome"), s = d.stats, c = d.capital; box.hidden = false;
    const max = Math.max(d.preTax, ...d.series.map(x => Math.abs(x.pnl)), 1), H = 120;
    const bars = d.series.map(x => { const h = Math.round(Math.abs(x.pnl) / max * H); return `<div class="si-col${x.month === d.current.month ? " now" : ""}${x.month === openMonth ? " sel" : ""}" data-simonth="${x.month}" role="button" tabindex="0" title="${esc(mon(x.month))}: booked ${inr(x.pnl)} on ${x.trades} trade${x.trades === 1 ? "" : "s"}${x.pnl > 0 ? ` · about ${inr(x.afterTax)} after tax` : ""}"><div class="si-up">${x.pnl > 0 ? `<i class="${x.hit ? "hit" : ""}" style="height:${h}px"></i>` : ""}</div><div class="si-dn">${x.pnl < 0 ? `<i style="height:${Math.round(h / 2)}px"></i>` : ""}</div><span>${esc(mon(x.month))}</span></div>`; }).join("");
    const line = Math.round(d.preTax / max * H);
    box.innerHTML = `<div class="nw-head"><h3>💰 Swing income <span class="hint">your booked profit against a monthly income</span></h3><div class="si-src" role="group" aria-label="Which trades"><button type="button" data-sisrc="brokers" class="${d.source === "brokers" ? "active" : ""}" title="The trades in the Tax view: broker tax reports, tradebooks, Dhan and the daily pick-up">🏦 Brokers${d.counts?.brokers ? ` · ${d.counts.brokers}` : ""}</button><button type="button" data-sisrc="journal" class="${d.source === "journal" ? "active" : ""}" title="The trades you typed into this Swing trading journal">✍️ My journal${d.counts?.journal ? ` · ${d.counts.journal}` : ""}</button></div><label class="si-target">Target after tax / month <input class="ui-input" id="siTarget" inputmode="numeric" value="${d.target}"></label></div>
      <div class="si-now"><div><span>${esc(new Date(`${d.current.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", timeZone: "UTC" }))} so far</span><strong class="${d.current.pnl < 0 ? "pl-dn" : ""}">${inr(d.current.pnl)}</strong><small>of ${inr(d.preTax)} needed before tax (${inr(d.target)} after ${Math.round(d.taxRate * 1000) / 10}% tax) · ${d.current.trades} trade${d.current.trades === 1 ? "" : "s"}</small></div><i class="si-prog"><b style="width:${d.current.pct}%"></b></i></div>
      <p class="bk-act ${d.verdict.tone}">${d.verdict.tone === "ok" ? "✅" : d.verdict.tone === "warn" ? "⚠️" : "💡"} ${esc(d.verdict.text)}</p>
      ${s.trades ? `<div class="si-chart" style="--line:${line}px"><div class="si-line" title="Target before tax: ${inr(d.preTax)}"><em>${amt(d.preTax)} target</em></div>${bars}</div>
      <div class="si-grid">
        <div><span>Average month</span><b class="${s.perMonth < 0 ? "pl-dn" : ""}">${inr(s.perMonth)}</b><small>${inr(s.perMonthAfterTax)} after tax · over ${s.months} month${s.months === 1 ? "" : "s"}</small></div>
        <div><span>Months at target</span><b>${s.hitMonths} of ${s.closedMonths}</b><small>${s.lossMonths} losing month${s.lossMonths === 1 ? "" : "s"}${fin(s.best) ? ` · best ${amt(s.best)}, worst ${amt(s.worst)}` : ""}</small></div>
        <div><span>Win rate</span><b>${s.winRate ?? "—"}%</b><small>${s.trades} trades · ${s.tradesPerMonth} a month${s.avgDays ? ` · held ${s.avgDays} days on average` : ""}</small></div>
        <div><span>Average win / loss</span><b>${inr(s.avgWin)} / ${inr(-s.avgLoss)}</b><small>${s.payoff ? `wins are ${s.payoff}× the losses` : "no losing trades yet"} · ${inr(s.expectancy)} a trade</small></div>
        <div><span>Losing streak</span><b>${s.losingStreak} now</b><small>worst ${s.worstStreak} in a row · deepest dip ${amt(-s.maxDip)}</small></div>
        <div class="si-cap"><span>Capital this target needs</span><b>${c.needed ? amt(c.needed) : "—"}</b><small>${fin(c.yearlyPct) ? `at your ${c.yearlyPct}% a year on ${amt(c.base)}${c.yours ? " of swing capital (cash + open positions)" : " deployed on average"}` : "needs profitable months first"}${c.gap ? ` · ${amt(c.gap)} more than you have` : c.needed && c.yours ? " · you have enough" : ""}</small></div>
      </div>` : ""}
      ${monthsHtml()}
      <p class="vs-fine">${d.source === "brokers" ? `From your brokers' records (the same trades as the Tax view and the Swing book): short-term and same-day sales of stocks and ETFs, last 12 months, before charges.${d.undated?.trades ? ` ${d.undated.trades} sale${d.undated.trades === 1 ? "" : "s"} (${inr(d.undated.gain)}) from a report without sale dates (Dhan's P&L) can't be put in a month and are left out here.` : ""}` : "From the closed trades you typed into this Swing journal, last 12 months."} Short-term gains are taxed at 20% + cess, so ₹${Math.round(d.target).toLocaleString("en-IN")} in hand needs ${inr(d.preTax)} booked. Income from trading comes in lumps: plan your spending on the average of good and bad months, and keep your 3-year reserve so a bad quarter never forces a trade.</p>`;
  }
  const pickMonth = m => { openMonth = openMonth === m ? null : m; render(); document.querySelector(`.si-mrow[data-simonth="${m}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); };
  document.addEventListener("click", e => {
    const src = e.target.closest("[data-sisrc]"); if (src && (!d || src.dataset.sisrc !== d.source || src.closest(".sw-bk-src"))) { openMonth = null; load({ source: src.dataset.sisrc }).then(() => window.swingReload?.()); return; }
    const m = e.target.closest("#swIncome [data-simonth]"); if (m) pickMonth(m.dataset.simonth);
  });
  document.addEventListener("keydown", e => { const m = e.target.closest?.("#swIncome [data-simonth]"); if (m && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pickMonth(m.dataset.simonth); } });
  document.addEventListener("change", e => { if (e.target.id === "siTarget") { const v = Number(String(e.target.value).replace(/[,₹\s]/g, "").replace(/l$/i, "e5").replace(/k$/i, "e3")); load({ target: v }); } });
  window.loadSwIncome = () => load();
  window.loadSwIncome();
})();
