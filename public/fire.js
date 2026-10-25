// FIRE planner: your path from today's corpus to 1 Cr … 10 Cr … 100 Cr and financial independence, using your
// Monthly expenses (spends, SIPs, PF) and Net worth (what you hold). Reads /api/fire; every change is saved to your login.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
  const short = v => (v >= 1e7 ? `${+(v / 1e7).toFixed(v >= 1e8 ? 0 : 1)} Cr` : `${+(v / 1e5).toFixed(0)} L`);
  const inAmt = v => (v >= 1e7 ? `${+(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `${+(v / 1e5).toFixed(2)}L` : String(v));
  // "50L", "10 Cr", "1.5cr", "1,20,000" → rupees
  const parseAmt = t => { const m = String(t ?? "").replace(/[,₹\s]/g, "").toLowerCase().match(/^(\d+(?:\.\d+)?)(cr|crore|crores|l|lakh|lakhs|lac|k)?$/); if (!m) return t === "" ? "" : NaN; const x = Number(m[1]), u = m[2] || ""; return Math.round(x * (u.startsWith("c") ? 1e7 : u.startsWith("l") ? 1e5 : u === "k" ? 1e3 : 1)); };
  const dur = m => (m === null || m === undefined ? "—" : m <= 0 ? "now" : m < 12 ? `${m} mo` : `${Math.floor(m / 12)} yr${m % 12 ? ` ${m % 12} mo` : ""}`);
  const yrs = y => (y === null || y === undefined ? "not within 45 yrs" : y === 0 ? "already there" : `${y} yrs`);
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  let d = null, saving = null;
  async function load() { try { d = await api("/api/fire"); render(); } catch (e) { $("#fiBody").innerHTML = `<p class="hint">Could not load the planner: ${esc(e.message)}</p>`; } }
  async function save(body) {
    const at = document.activeElement?.name; clearTimeout(saving);
    try { d = await api("/api/fire/save", body); render(); if (at) { const el = $(`#fiBody [name="${at}"]`); el?.focus(); } } catch (e) { window.toast?.(esc(e.message), { kind: "bad" }); }
  }
  const SRC = { tracked: "from your expenses", you: "your number", default: "default" };
  function field(name, label, value, { src, hint, money, suffix } = {}) {
    const shown = value === null || value === undefined ? "" : money ? inAmt(value) : String(value);
    return `<label class="ui-field fi-f"><span>${esc(label)}${src ? ` <em class="fi-src fi-${src}">${SRC[src]}</em>` : ""}</span><span class="fi-in"><input class="ui-input" name="${name}" inputmode="decimal" value="${esc(shown)}" ${money ? 'data-money="1"' : ""} placeholder="${esc(hint || "")}">${suffix ? `<i>${suffix}</i>` : ""}</span></label>`;
  }
  function inputs() {
    const p = d.inputs, s = p.src || {}, t = d.tracked || {};
    return `<details class="report-card fi-inputs"${p.age === null || $("#fiBody .fi-inputs")?.open ? " open" : ""}><summary><b>Your numbers</b> <span class="hint">spend ${amt(p.spend)}/mo · invest ${amt(p.invest + p.pfMonthly)}/mo · equity ${p.ret.equity}% · reserve ${p.safetyMonths} months · PF cap ${amt(p.pfCap)}</span></summary>
      <div class="fi-grid">
        ${field("age", "Your age", p.age, { hint: "e.g. 38", suffix: "yrs" })}
        ${field("retireAge", "Stop working by (optional)", p.retireAge, { hint: "e.g. 50", suffix: "age" })}
        ${field("spend", "Monthly spends (today)", p.spend, { src: s.spend, money: true, hint: "e.g. 1.2L" })}
        ${field("invest", "Monthly investing: equity", p.invest, { src: s.invest, money: true, hint: "SIPs, stocks, US, crypto" })}
        ${field("pfMonthly", "Monthly investing: PF / PPF / NPS", p.pfMonthly, { src: s.pfMonthly, money: true, hint: "EPF + VPF + PPF" })}
        ${field("stepUp", "Raise investing every year by", p.stepUp, { suffix: "%" })}
        ${field("inflation", "Inflation", p.inflation, { suffix: "%" })}
        ${field("safetyMonths", "Emergency reserve (arbitrage)", p.safetyMonths, { suffix: "months" })}
        ${field("reserveShare", "New money to the reserve until it's full", p.reserveShare, { suffix: "%" })}
        ${field("pfCap", "Stop adding to PF at", p.pfCap, { money: true, hint: "50L" })}
        <label class="ui-field fi-f"><span>After the PF cap</span><select class="ui-input" name="pfAfterCap"><option value="equity"${p.pfAfterCap === "equity" ? " selected" : ""}>PF money goes to equity</option><option value="pf"${p.pfAfterCap === "pf" ? " selected" : ""}>Keep adding (mandatory EPF)</option></select></label>
        ${field("ret.equity", "Equity return", p.ret.equity, { suffix: "% a yr" })}
        ${field("ret.safety", "Arbitrage / liquid return", p.ret.safety, { suffix: "% a yr" })}
        ${field("ret.pf", "PF / PPF / NPS return", p.ret.pf, { suffix: "% a yr" })}
        ${field("ret.other", "Hybrid / debt / gold return", p.ret.other, { suffix: "% a yr" })}
        ${field("swr", "Safe withdrawal rate", p.swr, { suffix: "% a yr" })}
        <label class="ui-field fi-f"><span>Your targets</span><span class="fi-in"><input class="ui-input" name="goals" value="${esc(p.goals.map(short).join(", "))}" placeholder="10 Cr, 100 Cr"></span></label>
      </div>
      <p class="vs-fine">${t.months ? `Tracked: last ${t.months} month${t.months === 1 ? "" : "s"} of Monthly expenses${t.income ? `, income about ${amt(t.income)}/mo` : ""}. Investment lines named PPF / EPF / VPF / NPS count as PF, the rest as equity.` : "No Monthly expenses yet: enter your spends and investing here, or add a month in Monthly expenses."} Leave a box empty to go back to the tracked or default number. Amounts accept 1.2L, 50L, 10Cr.</p>
    </details>`;
  }
  function chart() {
    const ys = d.years, W = 820, H = 300, L = 54, R = 14, T = 14, B = 30;
    const lo = Math.max(1e6, Math.min(...ys.map(y => y.total).filter(v => v > 0), 1e7) * 0.8), hi = Math.max(1.2e9, ...ys.map(y => y.total)) * 1.05;
    const x = i => L + (W - L - R) * i / (ys.length - 1), y = v => T + (H - T - B) * (1 - (Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)));
    const path = k => ys.map((r, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(r[k]).toFixed(1)}`).join("");
    const grid = [1e6, 1e7, 5e7, 1e8, 2.5e8, 5e8, 1e9, 2.5e9, 1e10].filter(v => v >= lo && v <= hi).map(v => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="fi-grid-l${d.inputs.goals.includes(v) ? " goal" : ""}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`).join("");
    const xt = ys.filter((r, i) => i % 5 === 0).map(r => `<text x="${x(r.year)}" y="${H - 8}" text-anchor="middle">${r.age !== null ? `age ${Math.round(r.age)}` : `yr ${r.year}`}</text>`).join("");
    const dots = d.milestones.filter(m => m.month !== null && m.month > 0 && m.goal).map(m => `<circle cx="${x(m.month / 12)}" cy="${y(m.amount)}" r="5" class="fi-dot"><title>${m.label} at ${m.age ?? `year ${m.years}`}</title></circle>`).join("");
    const fire = d.fire.month !== null ? `<line x1="${x(d.fire.month / 12)}" x2="${x(d.fire.month / 12)}" y1="${T}" y2="${H - B}" class="fi-fire-l"/><text x="${x(d.fire.month / 12) + 4}" y="${T + 12}" class="fi-fire-t">🔥 FIRE${d.fire.age ? ` at ${Math.round(d.fire.age)}` : ""}</text>` : "";
    const hover = ys.map((r, i) => `<rect x="${x(i) - (W - L - R) / ys.length / 2}" y="${T}" width="${(W - L - R) / ys.length}" height="${H - T - B}" fill="transparent"><title>${r.age !== null ? `Age ${Math.round(r.age)}` : `Year ${r.year}`}: ${amt(r.total)} (${amt(r.real)} in today's money) · FIRE number ${amt(r.fireNumber)} · investing ${amt(r.monthlyInvest)}/mo</title></rect>`).join("");
    return `<svg class="fi-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Corpus over time, log scale">${grid}${xt}<path d="${path("fireNumber")}" class="fi-need"/><path d="${path("real")}" class="fi-real"/><path d="${path("total")}" class="fi-total"/>${fire}${dots}${hover}</svg>
      <p class="fi-legend"><i class="fi-k total"></i> Your money <i class="fi-k real"></i> In today's rupees <i class="fi-k need"></i> FIRE number (grows with inflation) <span class="hint">Log scale: each step up is ×10 or so. Hover a year for numbers.</span></p>`;
  }
  const leverCell = x => (!x ? "—" : x.now ? '<b class="up">now within reach</b>' : x.months === -999 ? '<span class="dn">later</span>' : x.months > 0 ? `<b class="up">${dur(x.months)} sooner</b>` : x.months < 0 ? `<span class="dn">${dur(-x.months)} later</span>` : "same");
  function render() {
    if (!d) return;
    const f = d.fire, g = d.goals, first = g[0], top = g[g.length - 1], p = d.inputs;
    const tile = (cls, head, big, small) => `<div class="fi-tile ${cls}"><span>${head}</span><strong>${big}</strong><small>${small}</small></div>`;
    const when = x => (x?.years === null || x?.years === undefined ? "Beyond 45 years" : x.years === 0 ? "Reached" : x.age !== null && x.age !== undefined ? `Age ${Math.round(x.age)}` : `In ${x.years} yrs`);
    const tiles = `<div class="fi-tiles">
      ${tile("now", "💼 Invested today", amt(d.corpus), `Safety ${amt(d.start.safety)} · PF ${amt(d.start.pf)} · equity ${amt(d.start.equity)}${d.start.other ? ` · other ${amt(d.start.other)}` : ""}`)}
      ${tile("fire", "🔥 Financial independence", when(f), `${f.year ? `${f.year} · ` : ""}needs ${amt(f.number)} in today's money (${amt(p.spend * 12)} a year ÷ ${p.swr}%) · ${f.progress ?? 0}% there`)}
      ${first ? tile("g1", `🎯 ${esc(first.label)}`, when(first), first.year ? `${first.year} · in ${yrs(first.years)}` : "Raise investing or the return to get there") : ""}
      ${top && top !== first ? tile("g2", `🚀 ${esc(top.label)}`, when(top), top.year ? `${top.year} · in ${yrs(top.years)}` : "Raise investing or the return to get there") : ""}
      ${tile("rate", "💰 Savings rate", d.savingsRate !== null ? `${d.savingsRate}%` : "—", d.savingsRate !== null ? `${amt(p.invest + p.pfMonthly)} of ${amt(d.tracked.income)} income a month` : "Add your income in Monthly expenses")}
    </div>`;
    const bar = `<div class="fi-progress" title="${f.progress}% of your FIRE number today"><i style="width:${Math.min(100, f.progress || 0)}%"></i></div>`;
    const road = `<section class="report-card"><h3>🛣️ Milestones</h3><div class="fi-road">${d.milestones.map(m => `<div class="fi-stop${m.reached ? " done" : ""}${m.goal ? " goal" : ""}"><b>${esc(m.label)}</b><span>${m.reached ? "✓ done" : m.month === null ? "beyond 45 yrs" : `${m.age !== null ? `age ${Math.round(m.age)} · ` : ""}${m.year}`}</span>${!m.reached && m.real ? `<small>worth ${amt(m.real)} today</small>` : ""}</div>`).join("")}</div>${chart()}</section>`;
    const fireBox = `<section class="report-card fi-fire"><h3>🔥 FIRE levels <span class="hint">annual spend ÷ ${p.swr}% withdrawal rate</span></h3>
      <div class="fi-levels">
        <div><b>Lean FIRE</b><strong>${amt(f.lean)}</strong><span>${f.leanWhen.age ? `age ${Math.round(f.leanWhen.age)}` : yrs(f.leanWhen.years)}</span><small>spending 30% less than now</small></div>
        <div class="main"><b>FIRE</b><strong>${amt(f.number)}</strong><span>${f.age ? `age ${Math.round(f.age)}` : yrs(f.years)}</span><small>today's lifestyle${f.numberThen ? `; ${amt(f.numberThen)} in rupees of that year` : ""}</small></div>
        <div><b>Fat FIRE</b><strong>${amt(f.fat)}</strong><span>${f.fatWhen.age ? `age ${Math.round(f.fatWhen.age)}` : yrs(f.fatWhen.years)}</span><small>twice today's spending</small></div>
        ${f.coast ? `<div><b>Coast FIRE</b><strong>${amt(f.coast.needToday)}</strong><span>${f.coast.reached ? "✓ reached" : "not yet"}</span><small>enough today to reach FIRE by ${f.coast.age} even if you stop investing</small></div>` : ""}
      </div>${bar}
      ${f.byAge ? `<p class="bk-act ${f.byAge.onTrack ? "ok" : "warn"}">${f.byAge.onTrack ? "✅" : "⚠️"} To stop working at ${f.byAge.age} you need ${amt(f.byAge.fireThen)} then; this plan has ${amt(f.byAge.corpusThen)}. ${f.byAge.onTrack ? "You are on track." : f.byAge.investNeeded ? `Invest about <b>${amt(f.byAge.investNeeded)}</b> a month in equity (now ${amt(p.invest)}), rising ${p.stepUp}% a year, to get there.` : "Not reachable by then with these numbers: push the age out or raise the return."}</p>` : p.age === null ? '<p class="hint">Enter your age in <b>Your numbers</b> to see ages, and a target age to see what it takes to stop working by then.</p>' : ""}
    </section>`;
    const faster = g.filter(x => x.faster?.length).map(x => `<li>🎯 <b>${esc(x.label)}</b> in ${yrs(x.years)}${x.age ? ` (age ${Math.round(x.age)})` : ""}. ${x.faster.map(z => z.invest ? `${z.sooner} years sooner: invest <b>${amt(z.invest)}</b>/mo in equity` : `${z.sooner} years sooner: not reachable with SIPs alone`).join(" · ")} <span class="hint">(now ${amt(p.invest)}, rising ${p.stepUp}% a year)</span></li>`).join("");
    const levers = `<section class="report-card"><h3>⚡ Get there faster <span class="hint">each change on its own, against your plan as it is</span></h3>
      <div class="table-wrap"><table class="fi-table"><thead><tr><th>Change</th><th>${first ? esc(first.label) : "Goal"}</th>${top && top !== first ? `<th>${esc(top.label)}</th>` : ""}<th>FIRE</th></tr></thead><tbody>
      ${d.levers.map(l => `<tr><td><b>${esc(l.title)}</b><div class="hint">${esc(l.how)}</div></td><td>${leverCell(l.first)}</td>${top && top !== first ? `<td>${leverCell(l.top)}</td>` : ""}<td>${l.fire === null ? "—" : l.fire > 0 ? `<b class="up">${dur(l.fire)} sooner</b>` : l.fire < 0 ? `<span class="dn">${dur(-l.fire)} later</span>` : "same"}</td></tr>`).join("")}</tbody></table></div>
      ${faster ? `<ul class="fi-faster">${faster}</ul>` : ""}</section>`;
    const sens = `<section class="report-card"><h3>📉 If equity returns differ</h3><div class="table-wrap"><table class="fi-table"><thead><tr><th>Equity return</th><th>${first ? esc(first.label) : ""}</th>${top && top !== first ? `<th>${esc(top.label)}</th>` : ""}<th>FIRE</th></tr></thead><tbody>${d.sens.map(s => `<tr${s.equity === p.ret.equity ? ' class="cur"' : ""}><td>${s.equity}% a year${s.equity === p.ret.equity ? " (your plan)" : ""}</td><td>${yrs(s.first)}</td>${top && top !== first ? `<td>${yrs(s.top)}</td>` : ""}<td>${yrs(s.fire)}</td></tr>`).join("")}</tbody></table></div><p class="vs-fine">Indian equity (Nifty 50 TRI) has returned roughly 11–13% a year over long periods, with long flat stretches. Small and mid caps swing more both ways.</p></section>`;
    const tips = `<section class="report-card bk-acts">${d.tips.map(t => `<p class="bk-act ${t.tone}">${t.tone === "warn" ? "⚠️" : t.tone === "ok" ? "✅" : "💡"} ${esc(t.text)}</p>`).join("")}</section>`;
    const table = `<details class="report-card fi-years"><summary><b>Year by year</b> <span class="hint">where the money sits each year</span></summary><div class="table-wrap"><table class="fi-table"><thead><tr><th>${p.age !== null ? "Age" : "Year"}</th><th class="num">Investing / mo</th><th class="num">Arbitrage</th><th class="num">PF / PPF / NPS</th><th class="num">Equity</th><th class="num">Other</th><th class="num">Total</th><th class="num">In today's ₹</th><th class="num">FIRE number</th></tr></thead><tbody>
      ${d.years.map(r => `<tr${r.total >= r.fireNumber ? ' class="fi-free"' : ""}><td>${r.age !== null ? Math.round(r.age) : r.year} <span class="hint">${new Date().getFullYear() + r.year}</span></td><td class="num">${amt(r.monthlyInvest)}</td><td class="num">${amt(r.safety)}</td><td class="num">${amt(r.pf)}</td><td class="num">${amt(r.equity)}</td><td class="num">${amt(r.other)}</td><td class="num"><b>${amt(r.total)}</b></td><td class="num">${amt(r.real)}</td><td class="num">${amt(r.fireNumber)}</td></tr>`).join("")}</tbody></table></div></details>`;
    const notes = `<p class="vs-fine">How the plan works: each month ${p.reserveShare}% of new money first tops up the ${p.safetyMonths}-month arbitrage reserve (it grows with inflation), PF-type money goes to PF until it reaches ${amt(p.pfCap)}, and everything else goes to equity. Anything above the reserve moves to equity once a year. Hybrid / debt / gold you already hold stay put. Returns are before tax. Your home and other things outside the Bucket strategy are not counted; loans are not subtracted. This is a projection, not advice: real returns come unevenly.</p>`;
    $("#fiBody").innerHTML = inputs() + tiles + fireBox + road + levers + tips + sens + table + notes;
  }
  function collect(el) {
    const n = el.name; if (!n) return null;
    if (n === "goals") { const gs = el.value.split(/[,;/]+/).map(s => parseAmt(s.trim())).filter(v => fin(v) && v > 0); return gs.length ? { goals: gs } : null; }
    let v = el.dataset.money ? parseAmt(el.value) : el.value.trim();
    if (el.dataset.money && Number.isNaN(v)) { window.toast?.("Enter an amount like 1.2L, 50L or 10Cr.", { kind: "bad" }); return null; }
    if (n.startsWith("ret.")) return { ret: { [n.slice(4)]: v } };
    return { [n]: v };
  }
  const init = () => {
    const v = $("#fiView"); if (!v) return;
    v.addEventListener("change", e => { const b = collect(e.target); if (b) save(b); });
    v.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("#fiBody input")) { e.preventDefault(); e.target.blur(); } });
    v.addEventListener("click", e => {
      if (e.target.closest("#fiReload")) { load(); return; }
      if (e.target.closest("#fiReset")) { save({ reset: true }).then(() => window.toast?.("Back to your tracked numbers and the defaults.", { ms: 2500 })); return; }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init(); // loaded on demand (app.js LAZY_VIEWS)
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.fire = () => load();
})();
