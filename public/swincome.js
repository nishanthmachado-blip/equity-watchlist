// Swing income tracker on the Swing page: booked profit month by month against your monthly target (after tax), how
// often you hit it, win rate, payoff, streaks, and the swing capital your own results say the target needs.
// Loaded the first time Swing opens. Reads /api/swing/income.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `${v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}` : "—");
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `${v < 0 ? "−" : ""}₹${+(Math.abs(v) / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `${v < 0 ? "−" : ""}₹${+(Math.abs(v) / 1e5).toFixed(2)} L` : inr(v));
  const mon = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
  let d = null;
  async function load(body) {
    const box = $("#swIncome"); if (!box) return;
    try { const r = await fetch("/api/swing/income", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin" }); const j = await r.json(); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); d = j; render(); if (body) window.toast?.("Monthly target saved.", { kind: "ok", ms: 2000 }); }
    catch (e) { if (body) window.toast?.(esc(e.message), { kind: "bad" }); else box.hidden = true; }
  }
  function render() {
    const box = $("#swIncome"), s = d.stats, c = d.capital; box.hidden = false;
    const max = Math.max(d.preTax, ...d.series.map(x => Math.abs(x.pnl)), 1), H = 120;
    const bars = d.series.map(x => { const h = Math.round(Math.abs(x.pnl) / max * H); return `<div class="si-col${x.month === d.current.month ? " now" : ""}" title="${esc(mon(x.month))}: booked ${inr(x.pnl)} on ${x.trades} trade${x.trades === 1 ? "" : "s"}${x.pnl > 0 ? ` · about ${inr(x.afterTax)} after tax` : ""}"><div class="si-up">${x.pnl > 0 ? `<i class="${x.hit ? "hit" : ""}" style="height:${h}px"></i>` : ""}</div><div class="si-dn">${x.pnl < 0 ? `<i style="height:${Math.round(h / 2)}px"></i>` : ""}</div><span>${esc(mon(x.month))}</span></div>`; }).join("");
    const line = Math.round(d.preTax / max * H);
    box.innerHTML = `<div class="nw-head"><h3>💰 Swing income <span class="hint">your booked profit against a monthly income</span></h3><label class="si-target">Target after tax / month <input class="ui-input" id="siTarget" inputmode="numeric" value="${d.target}"></label></div>
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
      <p class="vs-fine">From your closed trades in Swing, last 12 months. Short-term gains are taxed at 20% + cess, so ₹${Math.round(d.target).toLocaleString("en-IN")} in hand needs ${inr(d.preTax)} booked. Income from trading comes in lumps: plan your spending on the average of good and bad months, and keep your 3-year reserve so a bad quarter never forces a trade.</p>`;
  }
  document.addEventListener("change", e => { if (e.target.id === "siTarget") { const v = Number(String(e.target.value).replace(/[,₹\s]/g, "").replace(/l$/i, "e5").replace(/k$/i, "e3")); load({ target: v }); } });
  window.loadSwIncome = () => load();
  window.loadSwIncome();
})();
