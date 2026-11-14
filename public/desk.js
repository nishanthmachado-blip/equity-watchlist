// Trade desk: is the market helping, how much is at risk, how big may the next trade be, what your own trades say, and
// which setups have paid on your stocks. Reads /api/desk. Loaded on demand.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
  const amt = v => (!fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : inr(v));
  const sgn = v => (!fin(v) ? "—" : v === 0 ? "₹0" : `${v > 0 ? "+" : "−"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`), cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const pc = v => (fin(v) ? `${v > 0 ? "+" : ""}${v}%` : "—");
  const day = s => (s ? new Date(`${String(s).slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "2-digit", timeZone: "UTC" }) : "—");
  let d = null, chk = null, chkErr = "", form = {}, timer = null;
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `Request failed (${r.status})`); return j; };
  async function load() {
    clearTimeout(timer);
    try { d = await api("/api/desk"); render(); } catch (e) { $("#dkBody").innerHTML = `<p class="hint">Could not load the trade desk: ${esc(e.message)}</p>`; return; }
    if (d.compare.job?.running && !$("#dkView").hidden) timer = setTimeout(load, 2500);
  }
  const tone = { ok: "dk-ok", warn: "dk-warn", bad: "dk-bad", info: "dk-info" };
  const tick = (ok, half) => `<span class="dk-tick ${ok ? "y" : half ? "h" : "n"}">${ok ? "✓" : half ? "~" : "✕"}</span>`;

  function regimeHtml() {
    const r = d.regime, m = r.mode, i = r.index, b = r.breadth;
    return `<section class="report-card dk-regime ${tone[m.tone]}"><h3>🌦 Market regime <span class="hint">${r.asOf ? `from the charts scanned ${day(r.asOf)}` : ""}</span></h3>
      <div class="dk-mode"><strong>${esc(m.label)}</strong>${m.key !== "unknown" ? `<span class="chip">trade at ${m.sizeFactor === 1 ? "full" : m.sizeFactor === 0.5 ? "half" : "a quarter of"} your normal risk</span>` : ""}</div>
      <p>${esc(m.advice)}</p>
      ${r.checks.length ? `<ul class="dk-checks">${r.checks.map(c => `<li>${tick(c.ok, c.half)} ${esc(c.label)} <small>${esc(c.detail)}</small></li>`).join("")}</ul>` : ""}
      ${i || b ? `<div class="sb-cards dk-tiles">${i ? `<div><span>Nifty vs 200-day average</span><strong class="${cls(i.vs200Pct)}">${pc(i.vs200Pct)}</strong><small>${i.fromHighPct}% from its 1-year high</small></div><div><span>Nifty 1 month / 3 months</span><strong><span class="${cls(i.ret1m)}">${pc(i.ret1m)}</span> / <span class="${cls(i.ret3m)}">${pc(i.ret3m)}</span></strong><small>read from NIFTYBEES</small></div>` : ""}
        ${b ? `<div><span>Stocks above 50-day average</span><strong>${b.above50 ?? "—"}%</strong><small>of ${b.stocks} scanned stocks</small></div><div><span>Stocks above 200-day average</span><strong>${b.above200 ?? "—"}%</strong><small>${b.uptrend ?? "—"}% in a full uptrend</small></div><div><span>Near 1-year highs / lows</span><strong><span class="pl-up">${b.nearHigh}</span> / <span class="pl-dn">${b.nearLow}</span></strong><small>within 3% of the high, 5% of the low</small></div>` : ""}</div>` : ""}
      <p class="vs-fine">Breadth is measured on the stocks the Swing ideas scan reads (the ones you hold, trade and track, plus the app's starter list), not the whole market. Score ${r.score} of ${r.max}. A guide for position size, not a forecast.</p></section>`;
  }

  function riskHtml() {
    const R = d.risk, T = R.totals, S = d.settings;
    const heat = fin(T.heatPct) ? Math.min(100, T.heatPct / S.maxHeatPct * 100) : 0;
    const src = R.source === "journal" ? `your Swing trading journal (${R.counts.journal})` : `your brokers' records: shares bought in the last 12 months (${R.counts.brokers})`;
    const sw = R.counts.journal && R.counts.brokers ? ` <button type="button" class="ghost dk-mini" data-dk="src" data-to="${R.source === "journal" ? "brokers" : "journal"}">Use ${R.source === "journal" ? "broker positions" : "my journal"} instead</button>` : "";
    return `<section class="report-card"><h3>🛡 Risk on the table <button type="button" class="ghost dk-mini" data-dk="settings">⚙ Limits</button></h3>
      <p class="hint">Positions from ${src}.${sw} Stops come from the journal. Swing capital ${amt(R.capital)}${R.capitalSet ? "" : ' (positions + swing cash; set it under ⚙ Limits for exact numbers)'}.</p>
      <div class="sb-cards dk-tiles">
        <div><span>If every stop is hit today</span><strong class="${T.risk ? "pl-dn" : ""}">${T.risk ? `−${inr(T.risk).slice(1)}` : "₹0"}</strong><small>${T.heatPct ?? "—"}% of capital · your limit ${S.maxHeatPct}%</small><i class="dk-bar"><b class="${heat > 100 * 0.999 ? "over" : heat > 75 ? "near" : ""}" style="width:${heat}%"></b></i></div>
        <div><span>Room for new risk</span><strong>${inr(T.heatRoom)}</strong><small>about ${S.riskPct > 0 ? Math.floor(T.heatRoom / (R.capital * S.riskPct / 100) || 0) : 0} more trade${Math.floor(T.heatRoom / (R.capital * S.riskPct / 100) || 0) === 1 ? "" : "s"} at ${S.riskPct}% each</small></div>
        <div><span>In positions</span><strong>${amt(T.value)}</strong><small>${T.positions} position${T.positions === 1 ? "" : "s"} · ${T.investedPct ?? "—"}% of capital</small></div>
        <div><span>Without a stop-loss</span><strong class="${T.noStop ? "pl-dn" : "pl-up"}">${T.noStop}</strong><small>${T.noStop ? `counted as a ${S.noStopPct}% loss each` : "every position has an exit price"}</small></div></div>
      ${R.warnings.length ? `<ul class="dk-warns">${R.warnings.map(w => `<li class="${tone[w.level]}">${w.level === "bad" ? "⛔" : "⚠"} ${esc(w.text)}</li>`).join("")}</ul>` : R.rows.length ? '<p class="bk-act ok">✓ Within all your limits.</p>' : ""}
      ${R.rows.length ? `<details${R.rows.length <= 8 ? " open" : ""}><summary class="hint">Each position (${R.rows.length})</summary><div class="dk-scroll"><table class="sb-t dk-t"><thead><tr><th>Stock</th><th class="num">Value</th><th class="num">Stop</th><th class="num">At risk</th><th class="num">% of capital</th><th>Sector</th></tr></thead><tbody>${R.rows.map(r => `<tr><td><b>${esc(r.symbol)}</b><br><small>${r.qty} × ${inr(r.price)}</small></td><td class="num">${inr(r.value)}<br><small>${r.posPct ?? "—"}%</small></td><td class="num">${r.stopState === "none" ? '<span class="pl-dn">none</span>' : `${inr(r.stop)}<br><small>${r.stopState === "hit" ? '<span class="pl-dn">hit</span>' : `−${r.stopPct}%${r.locked ? " · above cost" : ""}`}</small>`}</td><td class="num ${r.risk ? "pl-dn" : ""}">${inr(r.risk)}</td><td class="num">${r.riskPct ?? "—"}%</td><td>${esc(r.sector)}</td></tr>`).join("")}</tbody></table></div>
        ${R.sectors.length > 1 ? `<p class="hint">By sector: ${R.sectors.slice(0, 6).map(s => `${esc(s.sector)} ${s.pct ?? "—"}%`).join(" · ")}</p>` : ""}</details>` : '<p class="nw-empty-row">No open swing positions found. Add them in Swing trading, or import your tradebook in Swing book.</p>'}
    </section>`;
  }

  function checkHtml() {
    const c = chk, v = { ok: ["dk-ok", "✓ Fits your rules"], careful: ["dk-warn", "⚠ Fits, with warnings"], skip: ["dk-bad", "⛔ Skip or resize"] };
    return `<section class="report-card"><h3>🧮 Size the next trade <span class="hint">before you place the order</span></h3>
      <form class="dk-form" id="dkCheck"><label>Stock (NSE symbol)<input class="ui-input" name="symbol" placeholder="e.g. NETWEB" autocomplete="off" value="${esc(form.symbol || "")}"></label><label>Buy price ₹<input class="ui-input" name="entry" inputmode="decimal" required value="${esc(form.entry || "")}"></label><label>Stop-loss ₹<input class="ui-input" name="stop" inputmode="decimal" required value="${esc(form.stop || "")}"></label><label>Target ₹<input class="ui-input" name="target" inputmode="decimal" placeholder="optional" value="${esc(form.target || "")}"></label><button type="submit" class="primary">Check</button></form>
      ${chkErr ? `<p class="bk-act warn">${esc(chkErr)}</p>` : ""}
      ${c ? `<div class="dk-verdict ${v[c.verdict][0]}"><strong>${v[c.verdict][1]}</strong><p>${esc(c.summary)}</p></div>
        <div class="sb-cards dk-tiles"><div><span>Shares</span><strong>${c.qty}</strong><small>${inr(c.amount)} · ${c.posPct}% of capital</small></div><div><span>Loss if stopped</span><strong class="pl-dn">${c.riskAmount ? `−${inr(c.riskAmount).slice(1)}` : "₹0"}</strong><small>${c.riskPct}% of capital · stop ${c.stopPct}% away</small></div><div><span>Gain at target</span><strong class="pl-up">${c.reward !== null ? sgn(c.reward) : "—"}</strong><small>${c.rr !== null ? `${c.rr} : 1 reward to risk` : "no target entered"}</small></div><div><span>Size set by</span><strong class="dk-sm">${esc(c.limitLabel)}</strong><small>${c.limitedBy !== "risk" ? `risk alone would allow ${c.qtyByRisk}` : c.regimeFactor < 1 ? "reduced for the market regime" : "your risk per trade"}</small></div></div>
        <ul class="dk-checks">${c.checks.map(x => `<li>${tick(x.ok)} ${esc(x.label)} <small>${esc(x.detail)}</small></li>`).join("")}</ul>
        ${c.symbol && !c.hasChart ? '<p class="hint">This stock is not in the Swing ideas scan, so its trend and daily range were not checked.</p>' : ""}` : '<p class="hint">Enter the price you would buy at and where you would accept you are wrong. The size comes from your risk per trade, the open risk already on the table, your position and sector limits, swing cash and the market regime above.</p>'}
    </section>`;
  }

  const statRow = g => `<tr><td>${esc(g.label)}</td><td class="num">${g.trades}</td><td class="num">${g.winRate}%</td><td class="num"><span class="pl-up">${inr(g.avgWin)}</span> / <span class="pl-dn">${inr(g.avgLoss)}</span></td><td class="num ${cls(g.expectancy)}"><b>${sgn(g.expectancy)}</b></td><td class="num ${cls(g.total)}">${sgn(g.total)}</td></tr>`;
  const statTable = (title, rows, note = "") => (rows?.length ? `<div><h4>${title}</h4><div class="dk-scroll"><table class="sb-t dk-t"><thead><tr><th></th><th class="num">Trades</th><th class="num">Won</th><th class="num">Avg win / loss</th><th class="num">Per trade</th><th class="num">Total</th></tr></thead><tbody>${rows.map(statRow).join("")}</tbody></table></div>${note ? `<p class="vs-fine">${note}</p>` : ""}</div>` : "");
  function edgeHtml() {
    const E = d.edge, o = E.overall, P = E.plan;
    if (!E.trades) return `<section class="report-card"><h3>📊 Your edge <span class="hint">from your brokers' records</span></h3><p class="bk-act info">💡 ${esc(E.note)}</p></section>`;
    const stockList = (l, c) => l.map(s => `<li><b>${esc(s.symbol)}</b> <span class="${c}">${sgn(s.total)}</span> <small>${s.trades} trade${s.trades === 1 ? "" : "s"}, ${s.wins} won</small></li>`).join("");
    return `<section class="report-card"><h3>📊 Your edge <span class="hint">${E.trades} closed swing trades from your brokers' records${E.from ? `, since ${day(E.from)}` : ""}</span></h3>
      <div class="sb-cards dk-tiles">
        <div><span>Per trade (expectancy)</span><strong class="${cls(o.expectancy)}">${sgn(o.expectancy)}</strong><small>${fin(o.avgPct) ? `${pc(o.avgPct)} on the money in a trade` : ""}</small></div>
        <div><span>Win rate</span><strong>${o.winRate}%</strong><small>${o.breakEvenWinRate !== null ? `break-even at ${o.breakEvenWinRate}%` : `${o.wins} wins · ${o.losses} losses`}</small></div>
        <div><span>Average win / loss</span><strong><span class="pl-up">${inr(o.avgWin)}</span> / <span class="pl-dn">${inr(o.avgLoss)}</span></strong><small>${o.payoff !== null ? `a win is ${o.payoff}× a loss` : ""}${o.profitFactor !== null ? ` · profit factor ${o.profitFactor}` : ""}</small></div>
        <div><span>Total</span><strong class="${cls(o.total)}">${sgn(o.total)}</strong><small>average trade size ${amt(o.avgInvested)}</small></div></div>
      ${E.findings.length ? `<ul class="dk-warns">${E.findings.map(f => `<li class="${tone[f.tone]}">${f.tone === "ok" ? "✓" : f.tone === "bad" ? "⛔" : f.tone === "warn" ? "⚠" : "💡"} ${esc(f.text)}</li>`).join("")}</ul>` : ""}
      <div class="dk-plan"><h4>What ${amt(P.target)} a month after tax needs <button type="button" class="ghost dk-mini" data-dk="settings">change</button></h4>
        <p>${amt(P.preTax)} a month before tax. Over the last ${P.months} month${P.months === 1 ? "" : "s"} you booked <b class="${cls(P.perMonth)}">${sgn(P.perMonth)}</b> a month from ${P.tradesPerMonth} trades a month.
        ${P.tradesNeeded ? `At your ${inr(P.expectancy)} a trade that is <b>${P.tradesNeeded} trades a month</b> at today's size${P.positionNeeded ? `, or the same number of trades at about <b>${amt(P.positionNeeded)}</b> a trade (${P.sizeMultiple}× today's ${amt(P.avgInvested)})` : ""}.` : P.trades ? "Your trades lost money over this period, so more trades or more capital would only lose faster: fix the leaks above first." : "No dated trades in the last 12 months to work it out from."}</p>
        <p class="vs-fine">Bigger size only scales an edge that is already there, and it scales the losses too. Check the risk limits above before adding capital.</p></div>
      <div class="dk-grid">${statTable("By holding period", E.byHold)}${statTable("By trade size", E.bySize)}${statTable("By setup at entry", E.bySetup, "Was one of the scanner's setups on in the three days before you bought?")}${statTable("By trend at entry", E.byTrend)}${statTable("By market at entry", E.byMarket)}</div>
      ${!E.tagged ? `<p class="hint">Setup, trend and market at entry appear after you run <b>Test all setups</b> below: it reads each traded stock's chart on the day you bought.</p>` : `<p class="vs-fine">${E.tagged} of ${E.dated} dated trades could be matched to a chart.</p>`}
      <div class="dk-grid"><div><h4>Stocks that paid you most</h4><ul class="dk-stocks">${stockList(E.best, "pl-up") || "<li>None yet</li>"}</ul></div><div><h4>Stocks that cost you most</h4><ul class="dk-stocks">${stockList(E.worst, "pl-dn") || "<li>None</li>"}</ul></div></div>
      ${E.undated.trades ? `<p class="vs-fine">${E.undated.trades} sales (${sgn(E.undated.gain)}) come from a report without dates (Dhan): they count in the totals, not in the holding-period, setup or monthly numbers.</p>` : ""}
    </section>`;
  }

  function compareHtml() {
    const C = d.compare, j = C.job, L = C.last, p = j?.params || L?.params || { exit: "t1", maxDays: 30 };
    const opt = Object.entries(C.exits).map(([k, l]) => `<option value="${k}"${k === p.exit ? " selected" : ""}>${esc(l)}</option>`).join("");
    const form = `<div class="toolbar dk-cmp-form"><label class="hint">Exit <select class="ui-input" id="dkExit">${opt}</select></label><label class="hint">Max days <input class="ui-input" id="dkDays" inputmode="numeric" value="${p.maxDays}" style="width:64px"></label><button type="button" class="primary" id="dkRun"${j?.running ? " disabled" : ""}>${j?.running ? `Testing ${j.done} of ${j.total || "…"}` : "▶ Test all setups"}</button></div>`;
    const V = { good: ["dk-ok", "Has paid"], thin: ["dk-warn", "Thin edge"], bad: ["dk-bad", "Lost money"], few: ["dk-info", "Too few trades"], none: ["dk-info", "No signals"] };
    const mk = m => (m?.trades ? `${m.winRate}% · <span class="${cls(m.avgPct)}">${pc(m.avgPct)}</span> <small>(${m.trades})</small>` : "—");
    const table = L ? `<p class="hint">${L.tested} of ${L.stocks} stocks · ${day(L.from)} to ${day(L.to)} · exit: ${esc(L.exitLabel)} · max ${L.params.maxDays} days · ${L.params.costPct}% costs a trade · run ${new Date(L.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</p>
      <div class="dk-scroll"><table class="sb-t dk-t dk-cmp"><thead><tr><th>Setup</th><th class="num">Trades</th><th class="num">Won</th><th class="num">Avg trade</th><th class="num">Profit factor</th><th class="num">₹1 L a trade<br><small>after costs</small></th><th class="num">After tax</th><th class="num">Worst dip</th><th class="num">Nifty above 200-DMA<br><small>won · avg</small></th><th class="num">Nifty below<br><small>won · avg</small></th><th>Verdict</th></tr></thead><tbody>${L.rows.map(r => `<tr><td><b>${esc(r.label)}</b>${r.trades ? `<br><small>${r.avgDays} days on average</small>` : ""}</td><td class="num">${r.trades}</td><td class="num">${r.trades ? `${r.winRate}%` : "—"}</td><td class="num ${cls(r.avgPct)}">${r.trades ? `<b>${pc(r.avgPct)}</b><br><small>${pc(r.avgWinPct)} / ${pc(r.avgLossPct)}</small>` : "—"}</td><td class="num">${fin(r.profitFactor) ? r.profitFactor : "—"}</td><td class="num ${cls(r.per100k)}">${r.trades ? sgn(r.per100k) : "—"}</td><td class="num ${cls(r.afterTaxPer100k)}">${r.trades ? sgn(r.afterTaxPer100k) : "—"}</td><td class="num">${r.trades ? `${r.maxDrawdownPct}%<br><small>${r.worstStreak} losses in a row</small>` : "—"}</td><td class="num">${mk(r.marketUp)}</td><td class="num">${mk(r.marketDown)}</td><td><span class="dk-pill ${V[r.verdict][0]}">${V[r.verdict][1]}</span></td></tr>`).join("")}</tbody></table></div>
      <p class="vs-fine">"₹1 L a trade" adds up every trade's result as if each used ₹1 L. "After tax" takes 20.8% short-term gains tax off each financial year that ended in profit. "Worst dip" is the deepest fall from a peak, in % of one position. ${L.niftyOk ? "The last two columns split the trades by whether Nifty (NIFTYBEES) was above its 200-day average on the day of entry: that is the test of the market regime rule above." : "Nifty's history could not be read, so the market split is missing."} "Has paid" needs 30+ trades, a profit factor of 1.3+ and more than 0.3% a trade after costs.</p>
      ${L.skipped?.length ? `<p class="hint">Skipped ${L.skipped.length}: ${L.skipped.slice(0, 8).map(x => `${esc(x.symbol)} (${esc(x.why)})`).join(", ")}${L.skipped.length > 8 ? "…" : ""}</p>` : ""}` : `<p class="hint">Runs every setup of the Swing ideas scan (pullback, breakout, oversold bounce, 52-week high, cup and handle, momentum, golden cross) on about 5 years of daily prices of the stocks you hold, trade and track: a signal is bought at the next open and sold at the stop, the target or after the max days, with costs and tax taken off. It also checks which setup, if any, was on when you bought each of your own trades. Takes a few minutes.</p>`;
    return `<section class="report-card"><h3>🧪 Which setups have paid on your stocks</h3>${form}${j?.error ? `<p class="bk-act warn">The last run stopped: ${esc(j.error)}</p>` : ""}${table}
      <p class="vs-fine">Past results on today's list of stocks (the ones that did badly and were dropped are missing), so real results will be worse. Use it to drop setups that lose, not to expect the winners' numbers. Not advice.</p></section>`;
  }

  function render() {
    $("#dkBody").innerHTML = regimeHtml() + riskHtml() + checkHtml() + edgeHtml() + compareHtml();
  }

  async function settingsDialog() {
    const S = d.settings, f = (label, name, val, attr = "") => `<label class="ui-field"><span>${label}</span><input class="ui-input" name="${name}" value="${esc(val ?? "")}" ${attr}></label>`;
    const out = await window.ui.dialog({ title: "Trade desk limits", icon: "⚙", okText: "Save", wide: true,
      bodyHtml: `<div class="nw-form">${f("Swing capital: all the money you trade with (₹, e.g. 15L; blank = positions + swing cash)", "capital", S.capital ? `${S.capital / 1e5}L` : "", 'placeholder="e.g. 15L"')}${f("Risk per trade (% of capital lost if the stop is hit)", "riskPct", S.riskPct, 'inputmode="decimal"')}${f("Total open risk allowed (% of capital, all stops hit together)", "maxHeatPct", S.maxHeatPct, 'inputmode="decimal"')}${f("Largest single position (% of capital)", "maxPosPct", S.maxPosPct, 'inputmode="decimal"')}${f("Largest sector (% of capital)", "maxSectorPct", S.maxSectorPct, 'inputmode="decimal"')}${f("Loss assumed on a position without a stop (%)", "noStopPct", S.noStopPct, 'inputmode="decimal"')}${f("Monthly income target after tax (₹, e.g. 1L)", "target", S.target ? `${S.target / 1e5}L` : "1L")}</div>
        <label class="ui-opt"><input type="checkbox" name="useRegime"${S.useRegime ? " checked" : ""}><span><b>Cut the size of new trades when the market is weak</b> (half in a mixed market, a quarter in a weak one)</span></label>
        <p class="ui-hint">Common starting points: 1% risk a trade, 6% total open risk, 25% in one position. With ₹10 L that is at most ₹10,000 lost on one trade and ₹60,000 if every stop is hit on the same day.</p>`,
      collect: box => api("/api/desk/settings", { ...Object.fromEntries([...box.querySelectorAll("input[name]")].filter(i => i.type !== "checkbox").map(i => [i.name, i.value.trim()])), useRegime: box.querySelector("[name=useRegime]").checked }) });
    if (out) { d = out; chk = null; render(); }
  }

  document.addEventListener("click", async e => {
    if (!e.target.closest("#dkView")) return;
    const b = e.target.closest("[data-dk]");
    try {
      if (e.target.closest("#dkReload")) return load();
      if (b?.dataset.dk === "settings") return settingsDialog();
      if (b?.dataset.dk === "src") { d = await api("/api/desk/settings", { positionsFrom: b.dataset.to }); chk = null; return render(); }
      if (e.target.closest("#dkRun")) { d = await api("/api/desk/compare", { exit: $("#dkExit").value, maxDays: $("#dkDays").value }); render(); clearTimeout(timer); timer = setTimeout(load, 2500); }
    } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); }
  });
  document.addEventListener("submit", async e => {
    if (e.target.id !== "dkCheck") return;
    e.preventDefault();
    form = Object.fromEntries(new FormData(e.target));
    try { chk = await api("/api/desk/check", form); chkErr = ""; } catch (err) { chkErr = err.message; chk = null; }
    render(); $("#dkCheck")?.scrollIntoView({ block: "nearest" });
  });
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.desk = () => load();
  if (!$("#dkView")?.hidden) load();
})();
