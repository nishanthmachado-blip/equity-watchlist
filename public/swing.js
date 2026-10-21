// Swing trading page: live P/L on swing positions, take-profit / deploy signals, and a swing watchlist to deploy into.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  let sw = null, timer = null;
  let swMore = (() => { try { return localStorage.getItem("sw-more") === "1"; } catch { return false; } })(); // second card row open?
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  };
  const fin = Number.isFinite;
  const inr = v => fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—";
  const px = v => fin(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
  const amt = v => !fin(v) ? "—" : v >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : inr(v);
  const sg = v => fin(v) ? `${v > 0 ? "+" : v < 0 ? "−" : ""}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}` : "—";
  const pct = v => fin(v) ? `${v > 0 ? "+" : ""}${v}%` : "—";
  const cls = v => v > 0 ? "buy" : v < 0 ? "avoid" : "";
  const SIG = {
    "stop-hit": ["🛑 Stop-loss hit", "sl"], "near-stop": ["Near stop-loss", "near"], "take-profit": ["🎯 Book profit", "tp"], deploy: ["💰 Deploy", "dp"], "deploy-limit": ["Limit used", "lim"],
    "near-profit": ["Near target", "near"], "near-deploy": ["Near add level", "near"], riding: ["✓ Booked · riding", "rd"], hold: ["Hold", ""], watch: ["Watching", ""]
  };
  const sig = r => { const [t, c] = SIG[r.status] || [r.status, ""]; return `<span class="sw-sig ${c}">${t}</span>${r.note ? `<div class="sw-note">${esc(r.note)}</div>` : ""}`; };

  // Results / dividend / bonus decision under a position (open by default when it asks you to act)
  const evIcon = { results: "📊", "board-dividend": "📊", dividend: "💰", bonus: "🎁", split: "🎁" };
  const evRow = r => { const e = r.events; if (!e) return ""; const act = e.tone === "bad" || e.tone === "warn" || /wait for the dividend/i.test(e.headline);
    return `<tr class="sw-ev-row ${(SIG[r.status] || [])[1] || ""}" data-ev="${esc(r.id)}"><td colspan="12"><details class="sw-ev ${esc(e.tone)}"${act ? " open" : ""}><summary><b>${esc(e.headline)}</b><span class="hint"> · ${e.items.length} note${e.items.length === 1 ? "" : "s"}</span></summary><ul>${e.items.map(i => `<li><span>${i.icon}</span> ${esc(i.text)}</li>`).join("")}</ul><button type="button" class="ghost sw-decide-inline" data-decide="${esc(r.id)}">⚖ Hold or sell? Compare with your numbers</button></details></td></tr>`; };
  const upChips = w => (w.upcoming || []).map(e => `<span class="sw-up-chip ${esc(e.kind)}" title="${esc(e.label)} on ${esc(e.date)}">${evIcon[e.kind] || "🗓"} ${esc(e.kind === "dividend" && e.amount ? `Div ₹${e.amount}` : e.kind === "results" ? "Results" : e.label)} ${e.days === 0 ? "today" : e.days === 1 ? "tmrw" : `in ${e.days}d`}</span>`).join("");
  function render() {
    const v = sw, t = v.totals; window.__swingData = sw; // Ask AI offers a question about a position with a dividend coming
    // A position without a live price is left out of the totals (said so); one on an older saved price is counted and flagged
    const priceNote = t.missing?.length ? `<small class="sw-miss" title="No price from any source yet; refresh again shortly">excl. ${esc(t.missing.join(", "))} (no price)</small>` : t.staleNames?.length ? `<small class="sw-miss" title="Live sources did not answer; the last saved price is used">${esc(t.staleNames.join(", "))} on last saved price</small>` : "";
    $("#swTargetLbl").textContent = `${v.settings.targets.join(" / ")}%`;
    $("#swCards").innerHTML = `
      <div><span>Invested</span><strong>${amt(t.invested)}</strong></div>
      <div><span>Value now</span><strong>${amt(t.value)}</strong>${priceNote}</div>
      <div class="${t.pnl > 0 ? "sw-up" : t.pnl < 0 ? "sw-down" : ""}"><span>Profit / loss</span><strong class="${cls(t.pnl)}">${sg(t.pnl)}</strong><small class="${cls(t.pnlPct)}">${pct(t.pnlPct)}</small>${priceNote}</div>
      ${t.pat ? `<div class="sw-pat${t.pat.net < 0 ? " neg" : ""}" title="If you sold every position now"><span>🧾 Profit after tax (PAT)</span><strong class="${cls(t.pat.net)}">${sg(t.pat.net)}</strong><small>if you book all now: P/L − STT ${inr(t.pat.stt)} − charges ${inr(t.pat.otherCharges)} − tax ${inr(t.pat.tax)}</small><button type="button" class="pat-btn" data-go="pat">How it is worked out</button></div>` : ""}
      ${(() => { const B = v.booked, y = B?.years.find(x => x.current); if (!y || (!y.trades && !y.paid)) return ""; return `<div class="sw-tax${y.due ? " due" : " clear"}" title="Tax on this FY's booked swing profits (short-term ${B.rules.stRate}%, long-term ${B.rules.ltRate}% above ₹1.25 L, + ${B.rules.cessPct}% cess) minus what you recorded as paid"><span>🧾 Tax to pay · ${esc(y.fy)}</span><strong>${y.due ? inr(y.due) : "✓ ₹0"}</strong><small>${y.paid ? `${inr(y.tax)} on booked ${sg(y.pnl)} · paid ${inr(y.paid)}` : `on booked ${sg(y.pnl)} this year`}</small><button type="button" class="pat-btn" data-go="taxpaid">${y.due ? "Record a payment" : "Payments"}</button></div>`; })()}
      ${swMore ? `
      <div class="${t.takeProfit ? "sw-tp" : ""}"><span>🎯 To book profit</span><strong>${t.takeProfit}</strong>${t.stopHit ? `<small class="avoid">🛑 ${t.stopHit} at stop-loss</small>` : ""}</div>
      <div class="${t.deploy ? "sw-dp" : ""}"><span>💰 Deploy signals</span><strong>${t.deploy}</strong>${t.deployNow ? `<small>up to ${amt(t.deployNow)}</small>` : ""}</div>
      <div><span>Booked so far</span><strong class="${cls(v.realised.pnl)}">${sg(v.realised.pnl)}</strong><small>${v.realised.count} closed trade${v.realised.count === 1 ? "" : "s"}${v.realisedNet && v.realised.count ? ` · ≈ ${sg(v.realisedNet.net)} after tax & charges` : ""}</small></div>
      ${fin(t.cash) ? `<div class="${t.cashShort ? "sw-short" : ""}" title="Buys take from it, sales add to it. Change it in ⚙ Settings."><span>💵 Free cash</span><strong>${amt(t.cash)}</strong><small>${t.cashShort ? `signals need ${amt(t.deployNow)}: short by ${amt(t.cashShort)}` : t.deployNow ? `signals need ${amt(t.deployNow)}` : "for new swing buys"}</small></div>`
        : `<div class="sw-setcash"><span>💵 Free cash</span><button type="button" class="linklike" data-go="cash">Set your swing cash</button><small>to see if you can cover deploy signals</small></div>`}` : ""}`;
    // Second row (book profit / deploy / booked / free cash): a one-line strip unless you open it
    const strip = [
      `<span class="${t.takeProfit ? "on-tp" : ""}">🎯 <b>${t.takeProfit}</b> to book profit</span>`,
      t.stopHit ? `<span class="on-bad">🛑 <b>${t.stopHit}</b> at stop-loss</span>` : "",
      `<span class="${t.deploy ? "on-dp" : ""}">💰 <b>${t.deploy}</b> deploy signal${t.deploy === 1 ? "" : "s"}${t.deployNow ? ` · up to ${amt(t.deployNow)}` : ""}</span>`,
      `<span>Booked <b class="${cls(v.realised.pnl)}">${sg(v.realised.pnl)}</b> · ${v.realised.count} trade${v.realised.count === 1 ? "" : "s"} in all</span>`,
      fin(t.cash) ? `<span class="${t.cashShort ? "on-bad" : ""}">💵 Free cash <b>${amt(t.cash)}</b>${t.cashShort ? ` · short by ${amt(t.cashShort)}` : ""}</span>` : `<span><button type="button" class="linklike" data-go="cash">💵 Set your swing cash</button></span>`
    ].filter(Boolean).join("");
    $("#swMore").innerHTML = swMore ? `<button type="button" class="linklike sw-more-btn" data-more="0" aria-expanded="true">▴ Fewer cards</button>` : `<div class="sw-strip">${strip}<button type="button" class="linklike sw-more-btn" data-more="1" aria-expanded="false">▾ Details</button></div>`;
    renderScore(); renderLedger();
    const src = [...new Set([...v.positions, ...v.watch].map(r => r.priceSource).filter(Boolean))];
    $("#swStatus").innerHTML = `<b>Updated ${hm(v.checkedAt)}</b> · ${v.marketOpen ? "market open, auto-updates every minute" : "market closed"} · prices from ${esc(src.join(", ") || "—")}${v.pricePending ? ` · <span class="sw-pending">${v.pricePending} still loading…</span>` : ""}${t.unpriced ? ` · ${t.unpriced} without a price` : ""}`;
    const order = { "stop-hit": -1, "take-profit": 0, "near-stop": 2.5, deploy: 1, "near-profit": 2, "near-deploy": 3, "deploy-limit": 4, hold: 5 };
    $("#swPosNote").textContent = v.positions.length ? `${v.positions.length} position${v.positions.length === 1 ? "" : "s"} · sorted by signal` : "";
    order.riding = 4.5;
    $("#swRows").innerHTML = v.positions.length ? [...v.positions].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.pnlPct ?? -999) - (a.pnlPct ?? -999)).map(r => {
      const used = r.limit ? Math.min(100, Math.round(r.invested / r.limit * 100)) : null;
      return `<tr class="sw-row ${(SIG[r.status] || [])[1] || ""}" data-id="${esc(r.id)}" data-sym="${esc(r.symbol)}">
        <td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)}${r.exchange === "BSE" ? " · BSE" : ""}</div></td>
        <td class="num">${r.qty}</td><td class="num">${px(r.avgPrice)}</td>
        <td class="num"><b>${px(r.price)}</b>${r.health ? `<div><span class="sw-health ${r.health.state}" title="${esc(r.health.note)}. Trailing stop idea: ₹${r.health.trail} (2 ATR under the price or the 20-day low, whichever is higher).">${{ strong: "▲ Uptrend", pause: "◆ Pausing", caution: "▼ Below 50-DMA", weak: "▼ Below 200-DMA" }[r.health.state]}</span></div>` : ""}${fin(r.dayPct) ? `<div class="ticker ${cls(r.dayPct)}">${pct(r.dayPct)} today</div>` : ""}${srcLine(r)}</td>
        <td class="num">${inr(r.invested)}</td><td class="num">${inr(r.value)}</td>
        <td class="num ${cls(r.pnl)}"><b>${sg(r.pnl)}</b><div>${pct(r.pnlPct)}</div>${r.ifSold ? `<div class="sw-net" data-tax="${esc(r.id)}" title="If you sold all ${r.qty} now: ${taxTitle(r.ifSold)}">net ${sg(r.ifSold.net)}<small> after tax</small></div>` : ""}</td>
        <td class="sw-tg">${r.targets.map(t => `<div class="tg-l ${t.hit ? "hit" : r.nextTarget?.n === t.n ? "next" : ""}${t.done ? " done" : ""}" title="${t.sellQty ? `Plan: sell ${t.sellQty} share${t.sellQty === 1 ? "" : "s"} at T${t.n} (${t.planPct}%), about ${sg(t.profit)} profit` : `No sale planned at T${t.n}`}${t.done ? " · booked" : ""}"><i>T${t.n}</i><span>+${t.pct}%</span><b>${px(t.price)}</b><u class="tg-inr ${cls(r.qty * (t.price - r.avgPrice))}" title="Profit if all ${r.qty} shares sold at T${t.n}">${sg(r.qty * (t.price - r.avgPrice))}</u><em>${t.sellQty ? `sell ${t.sellQty}` : "hold"}</em>${t.done ? "✓✓" : t.hit ? "✓" : ""}</div>`).join("")}${(() => { const left = r.targets.filter(t => t.sellQty && !t.done), tot = left.reduce((a, t) => a + (Number(t.profit) || 0), 0); return left.length ? `<div class="tg-plan" title="Profit from the planned sales still to come (${left.map(t => `T${t.n}: sell ${t.sellQty}`).join(", ")})">Plan books <b class="${cls(tot)}">${sg(tot)}</b></div>` : ""; })()}${r.ownTargets || r.ownPlan ? `<div class="ticker">own ${[r.ownTargets && "targets", r.ownPlan && "plan"].filter(Boolean).join(" + ")}</div>` : ""}${r.sellNow ? `<div class="sw-sellnow">Sell ${r.sellNow} now</div>` : ""}${r.stopLoss ? `<div class="sw-sl${r.status === "stop-hit" ? " hit" : ""}">SL ${px(r.stopLoss)}</div>` : ""}</td>
        <td>${r.limit ? `<div class="fd-w"><span><i style="width:${used}%"></i></span>${used}%</div><div class="ticker">${amt(r.invested)} of ${amt(r.limit)}</div>` : "—"}</td>
        <td>${r.addBelow ? `Add ${amt(r.addAmount)} below ${px(r.addBelow)}<div class="ticker">${fin(r.distanceToAdd) ? `${r.distanceToAdd > 0 ? `${r.distanceToAdd}% away` : "reached"}` : ""}</div>` : r.addAmount ? `Add ${amt(r.addAmount)}` : "—"}</td>
        <td>${sig(r)}</td>
        <td class="sw-acts"><button type="button" class="ghost ai-btn" data-ask-ai="My ${esc(r.symbol)} swing position: book profit, hold, add or cut? Use the hold-or-sell numbers, targets, stop, trend and any results / dividend coming up." data-ask-sym="${esc(r.symbol)}" data-ask-where="Swing trading" title="Ask AI about this position">✨</button><button type="button" class="ghost sw-decide-btn" data-decide="${esc(r.id)}" title="Hold or sell? Compare selling now, holding to the dividend / results, and booking part with a stop">⚖</button><button type="button" class="ghost" data-act="sell" title="Sell / book profit">Sell</button><button type="button" class="ghost" data-act="buy" title="Bought more">Buy</button><button type="button" class="ghost" data-act="lots" title="Buys: dates, quantities and prices">📒</button><button type="button" class="ghost" data-act="edit" title="Edit">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button></td></tr>${evRow(r)}`;
    }).join("") : `<tr><td colspan="12" class="nw-empty-row">No swing positions yet. <button type="button" class="linklike" data-go="paste">Paste them from your sheet</button> or add one.</td></tr>`;
    renderDips(v.watch.filter(w => w.list === "dip"));
    const watchList = v.watch.filter(w => w.list !== "dip");
    $("#swWatchNote").textContent = watchList.length ? `${watchList.filter(w => w.status === "deploy").length} at your buy level now` : "";
    $("#swWatchRows").innerHTML = watchList.length ? [...watchList].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.distance ?? 999) - (b.distance ?? 999)).map(w => `<tr class="sw-row ${(SIG[w.status] || [])[1] || ""}" data-id="${esc(w.id)}" data-sym="${esc(w.symbol)}">
        <td><div class="company">${esc(w.name)}</div><div class="ticker">${esc(w.symbol)}${w.notes ? ` · ${esc(w.notes)}` : ""}</div>${w.upcoming?.length ? `<div class="sw-up">${upChips(w)}</div>` : ""}${w.idea ? `<div class="ticker">💡 ${esc(w.idea.label)}${w.stopLoss ? ` · SL ${px(w.stopLoss)}` : ""}${w.idea.t1 ? ` · T1 ${px(w.idea.t1)}` : ""}</div>` : w.stopLoss ? `<div class="ticker">SL ${px(w.stopLoss)}</div>` : ""}</td>
        <td class="num"><b>${px(w.price)}</b>${fin(w.dayPct) ? `<div class="ticker ${cls(w.dayPct)}">${pct(w.dayPct)} today</div>` : ""}</td>
        <td class="num">${w.buyBelow ? px(w.buyBelow) : '<span class="hint">not set</span>'}</td>
        <td class="num">${fin(w.distance) ? (w.distance <= 0 ? '<b class="buy">reached</b>' : `${w.distance}% above`) : "—"}</td>
        <td class="num">${amt(w.amount)}</td><td>${sig(w)}</td>
        <td class="sw-acts"><button type="button" class="ghost" data-act="bought" title="I bought it: move to positions">Bought</button><button type="button" class="ghost" data-act="wedit" title="Edit">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button></td></tr>`).join("")
      : `<tr><td colspan="7" class="nw-empty-row">Add stocks you want to buy on a dip, with the price to buy below and how much to deploy.</td></tr>`;
    renderBooked();
    $("#swClosedRows").innerHTML = bookedRows().map(c => `<tr><td><div class="company">${esc(c.name)}</div><div class="ticker">${esc(c.symbol)}</div></td><td class="num">${c.qty}</td><td class="num">${px(c.buyAvg)}</td><td class="num">${px(c.sellPrice)}</td><td class="num ${cls(c.pnl)}">${sg(c.pnl)} <small>${pct(c.pnlPct)}</small></td><td>${new Date(c.closedAt).toLocaleDateString("en-IN")}</td>
      <td class="sw-acts"><button type="button" class="ghost${c.review ? " reviewed" : ""}" data-tact="review" data-tid="${esc(c.id)}" title="${c.review ? "Reviewed: " + esc((c.review.mistakes || []).map(m => sw.journal?.mistakes?.[m] || m).join(", ") || c.review.note || "") : "Journal: what went right or wrong"}">📝${c.review ? "✓" : ""}</button><button type="button" class="ghost" data-tact="reopen" data-tid="${esc(c.id)}" title="Closed by mistake: put the ${c.qty} shares back into positions">↩ Reopen</button><button type="button" class="ghost danger-text" data-tact="delete-trade" data-tid="${esc(c.id)}" title="Delete this record only">✕</button></td></tr>`).join("") || `<tr><td colspan="7" class="nw-empty-row">Sells you record appear here with their profit.</td></tr>`;
  }
  // Closed trades by financial year and month: the totals come from every trade; the table lists the matching ones.
  const monthName = m => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  const istMonth = iso => new Date(Date.parse(iso) + 5.5 * 3600e3).toISOString().slice(0, 7);
  const fyStartYear = fy => Number(String(fy).slice(3, 7));
  const fyMonths = fy => { const y = fyStartYear(fy); return Array.from({ length: 12 }, (_, i) => { const m = (3 + i) % 12, yy = y + (i >= 9 ? 1 : 0); return `${yy}-${String(m + 1).padStart(2, "0")}`; }); };
  const nowMonth = () => istMonth(new Date().toISOString());
  const rangeLabel = (f, t) => f === t ? monthName(f) : `${monthName(f).replace(/ \d{4}$/, f.slice(0, 4) === t.slice(0, 4) ? "" : ` ${f.slice(0, 4)}`)} – ${monthName(t)}`;
  // the chosen period, clamped to the FY's months (defaults: the current FY, April to this month)
  function period() {
    const B = sw.booked, fys = B ? B.years.map(y => y.fy) : [];
    let fy = fys.includes(per.fy) ? per.fy : B?.currentFy; const ms = fyMonths(fy);
    let from = ms.includes(per.from) ? per.from : ms[0], to = ms.includes(per.to) ? per.to : (ms.includes(nowMonth()) ? nowMonth() : ms[11]);
    if (from > to) [from, to] = [to, from];
    return { fy, from, to, months: ms, inRange: m => m >= from && m <= to };
  }
  function periodStats() {
    const B = sw.booked, P = period(), sel = B.months.filter(m => P.inRange(m.month)), y = B.years.find(x => x.fy === P.fy);
    let st = sel.reduce((a, m) => a + (m.st || 0), 0), lt = sel.reduce((a, m) => a + (m.lt || 0), 0); if (st < 0) { lt += st; st = 0; } lt = Math.max(0, lt);
    const exempt = Math.max(0, B.rules.ltExemption - (y?.current ? (sw.taxInfo?.ltUsedElsewhere || 0) : 0)), tax = Math.round((st * B.rules.stRate + Math.max(0, lt - exempt) * B.rules.ltRate) / 100 * (1 + B.rules.cessPct / 100));
    return { P, sel, pnl: sel.reduce((a, m) => a + m.pnl, 0), trades: sel.reduce((a, m) => a + m.trades, 0), wins: sel.reduce((a, m) => a + m.wins, 0), tax, whole: P.from === P.months[0] && P.to === P.months[11] };
  }
  function bookedRows() { if (!sw.booked) return sw.closed; const P = period(); return sw.closed.filter(c => P.inRange(istMonth(c.closedAt))); }
  function renderBooked() {
    const v = sw, B = v.booked, box = $("#swPeriod");
    if (!B || !v.realised.count) { box.innerHTML = ""; $("#swBkBar").innerHTML = ""; $("#swBkMonths").innerHTML = ""; $("#swClosedSum").textContent = v.closed.length ? `${v.closed.length} trades, ${sg(v.realised.pnl)}` : "none yet"; return; }
    const S = periodStats(), P = S.P, byM = new Map(B.months.map(m => [m.month, m])), cur = nowMonth();
    const q = i => [P.months[i * 3], P.months[i * 3 + 2]], last = (() => { const d = new Date(`${cur}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
    const chips = [["This month", cur, cur], ["Last month", last, last], ["Q1 Apr–Jun", ...q(0)], ["Q2 Jul–Sep", ...q(1)], ["Q3 Oct–Dec", ...q(2)], ["Q4 Jan–Mar", ...q(3)], [`Full ${P.fy}`, P.months[0], P.months[11]]]
      .filter(([, f]) => P.months.includes(f)).map(([l, f, t]) => `<button type="button" class="sw-per-chip${P.from === f && P.to === t ? " on" : ""}" data-per="${f}|${t}">${l}</button>`).join("");
    const max = Math.max(1, ...P.months.map(m => Math.abs(byM.get(m)?.pnl || 0)));
    const opt = sel => P.months.map(m => `<option value="${m}"${m === sel ? " selected" : ""}>${monthName(m)}</option>`).join("");
    box.innerHTML = `<div class="sw-per-head"><b>📅 Booked profit</b>
        <label>Year <select class="ui-input" id="swPerFy">${B.years.map(y => `<option${y.fy === P.fy ? " selected" : ""}>${esc(y.fy)}</option>`).join("")}</select></label>
        <label>From <select class="ui-input" id="swPerFrom">${opt(P.from)}</select></label><label>To <select class="ui-input" id="swPerTo">${opt(P.to)}</select></label>
        <div class="sw-per-total"><span>${esc(S.whole ? P.fy : rangeLabel(P.from, P.to))}</span><strong class="${cls(S.pnl)}">${sg(S.pnl)}</strong><small>${S.trades} trade${S.trades === 1 ? "" : "s"}${S.trades ? ` · ${S.wins} in profit` : ""}${S.trades ? ` · tax ≈ ${inr(S.tax)}` : ""}</small></div></div>
      <div class="sw-per-chips">${chips}</div>
      <div class="sw-per-bars">${P.months.map(m => { const g = byM.get(m), pnl = g?.pnl || 0; return `<button type="button" class="sw-bk-m${P.inRange(m) ? " on" : ""}${m > cur ? " future" : ""}" data-bkm="${m}" title="${monthName(m)}: ${g ? `${sg(pnl)} from ${g.trades} trade${g.trades === 1 ? "" : "s"}` : "nothing booked"}. Click for this month; Shift+click to extend the range"><i class="${pnl >= 0 ? "up" : "dn"}" style="height:${g ? Math.max(3, Math.round(Math.abs(pnl) / max * 40)) : 0}px"></i><small>${monthName(m).slice(0, 3)}</small><b class="${cls(pnl)}">${!g ? "—" : Math.abs(pnl) >= 1e5 ? `${(pnl / 1e5).toFixed(1)}L` : Math.abs(pnl) >= 1e3 ? `${Math.round(pnl / 1e3)}k` : Math.round(pnl)}</b></button>`; }).join("")}</div>
      ${S.trades && !S.whole ? `<p class="hint sw-per-note">Tax ≈ is for these months alone (${B.rules.stRate}% short-term, ${B.rules.ltRate}% long-term above ₹1.25 L, + cess); the 🧾 tile shows the whole year and what you paid.</p>` : ""}`;
    $("#swPerFy").onchange = e => { per = { fy: e.target.value }; perSave(); render(); };
    $("#swPerFrom").onchange = e => { per = { fy: P.fy, from: e.target.value, to: e.target.value > P.to ? e.target.value : P.to }; perSave(); render(); };
    $("#swPerTo").onchange = e => { per = { fy: P.fy, from: e.target.value < P.from ? e.target.value : P.from, to: e.target.value }; perSave(); render(); };
    $("#swClosedSum").textContent = `${S.trades} of ${v.realised.count} trade${v.realised.count === 1 ? "" : "s"} · ${esc(S.whole ? P.fy : rangeLabel(P.from, P.to))}: ${sg(S.pnl)}`;
    $("#swBkBar").innerHTML = `<span class="hint">Showing trades sold in <b>${esc(S.whole ? P.fy : rangeLabel(P.from, P.to))}</b> (change the period at the top of the page).</span>`;
    $("#swBkMonths").innerHTML = "";
  }
  // Tax on booked swing profits for a financial year, and the payments you made against it
  async function taxPaidDialog(fy) {
    const B = sw.booked, y = B.years.find(x => x.fy === fy) || B.years.find(x => x.current);
    const pays = B.payments.filter(p => p.fy === y.fy);
    const out = await window.ui.dialog({ title: `Tax on swing profits · ${y.fy}`, icon: "🧾", okText: "Record payment", wide: true,
      message: `Short-term gains ${inr(y.netSt)} × ${B.rules.stRate}%${y.netLt ? ` + long-term ${inr(y.netLt)} (₹${(B.rules.ltExemption / 1e5).toFixed(2)} L exempt, taxable ${inr(y.taxableLt)}) × ${B.rules.ltRate}%` : ""} + ${B.rules.cessPct}% cess = <b>${inr(y.tax)}</b>. Paid ${inr(y.paid)} · <b>${y.due ? `due ${inr(y.due)}` : y.over ? `paid ${inr(y.over)} more than this estimate` : "nothing due"}</b>.`,
      bodyHtml: `<div class="nw-form">${field("Amount paid (₹)", "amount", y.due || "", 'inputmode="decimal" autofocus')}${dateField("Paid on")}<label class="ui-field"><span>Counts for</span><select class="ui-input" name="fy">${B.years.map(x => `<option${x.fy === y.fy ? " selected" : ""}>${esc(x.fy)}</option>`).join("")}</select></label>${field("Note (optional)", "note", "", 'placeholder="Advance tax 15 Dec · challan no."')}</div>
        ${pays.length ? `<table class="sw-prev sw-taxpays"><thead><tr><th>Paid on</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead><tbody>${pays.map(p => `<tr><td>${dmy(p.date)}</td><td class="num">${inr(p.amount)}</td><td>${esc(p.note || "")}</td><td><button type="button" class="ghost danger-text" data-del-pay="${esc(p.id)}">✕</button></td></tr>`).join("")}</tbody></table>` : ""}
        <p class="ui-hint">An estimate for these swing trades only, at ${B.rules.stRate}% short-term and ${B.rules.ltRate}% long-term plus cess. Your actual tax also depends on your other gains and losses. Advance tax dates: 15 Jun, 15 Sep, 15 Dec, 15 Mar.</p>`,
      onOpen: (box, { setError }) => box.querySelectorAll("[data-del-pay]").forEach(b => b.onclick = async () => { try { sw = await api("/api/swing/tax-paid-delete", { id: b.dataset.delPay }); render(); b.closest("tr").remove(); window.toast?.("Payment removed.", { kind: "ok" }); } catch (e) { setError(e.message); } }),
      collect: box => api("/api/swing/tax-paid", { amount: box.querySelector("[name=amount]").value, date: box.querySelector("[name=date]").value, fy: box.querySelector("[name=fy]").value, note: box.querySelector("[name=note]").value })
    });
    if (out) { sw = out; render(); if (out.notice) window.toast?.(out.notice, { kind: "ok" }); }
  }
  // Buy-the-dip list: one price per stock (or several rungs), how far it still has to fall, and a bulk buy for the ones that got there
  function renderDips(dips) {
    const reached = dips.filter(w => w.status === "deploy"), near = dips.filter(w => w.status === "near-deploy");
    const need = reached.reduce((a, w) => a + (w.amount || 0), 0);
    $("#swDipNote").textContent = dips.length ? `${reached.length} of ${dips.length} reached${near.length ? ` · ${near.length} close` : ""}` : "";
    const b = $("#swDipBuy"); b.disabled = !reached.length; b.textContent = reached.length ? `Bulk buy reached (${reached.length})` : "Bulk buy reached"; b.classList.toggle("primary", !!reached.length);
    $("#swDipCash").textContent = reached.length && need ? `${amt(need)} to deploy${fin(sw.totals.cash) ? ` · swing cash ${amt(sw.totals.cash)}${sw.totals.cash < need ? " (short)" : ""}` : ""}` : "";
    const sorted = [...dips].sort((a, x) => (a.distance ?? 999) - (x.distance ?? 999));
    $("#swDipRows").innerHTML = sorted.length ? sorted.map(w => {
      const d = w.distance, fall = fin(d) ? Math.max(0, d) : null, bar = fin(fall) ? Math.max(4, 100 - Math.min(100, fall * 5)) : 0; // 0% away = full bar, 20%+ away = nearly empty
      const qty = w.amount && w.buyBelow ? Math.floor(w.amount / Math.min(w.buyBelow, w.price || w.buyBelow)) : null;
      const st = w.status === "deploy" ? '<b class="buy">✓ Reached: buy</b>' : w.status === "near-deploy" ? '<span class="sw-dip-near">Close</span>' : w.price == null ? '<span class="hint">no price yet</span>' : '<span class="hint">Waiting</span>';
      return `<tr class="sw-row ${w.status === "deploy" ? "dp" : w.status === "near-deploy" ? "near" : ""}" data-id="${esc(w.id)}" data-sym="${esc(w.symbol)}">
        <td><div class="company">${esc(w.name)}</div><div class="ticker">${esc(w.symbol)}${w.notes ? ` · ${esc(w.notes)}` : ""}${w.stopLoss ? ` · SL ${px(w.stopLoss)}` : ""}</div>${w.upcoming?.length ? `<div class="sw-up">${upChips(w)}</div>` : ""}</td>
        <td class="num"><b>${px(w.price)}</b>${fin(w.dayPct) ? `<div class="ticker ${cls(w.dayPct)}">${pct(w.dayPct)} today</div>` : ""}</td>
        <td class="num"><b>${px(w.buyBelow)}</b></td>
        <td>${fin(d) ? (d <= 0 ? `<div class="sw-dip-bar done"><i style="width:100%"></i></div><span class="ticker buy">${Math.abs(d).toFixed(1)}% below your level</span>` : `<div class="sw-dip-bar"><i style="width:${bar}%"></i></div><span class="ticker">needs −${fall.toFixed(1)}% (${px(w.price - w.buyBelow)})</span>`) : "—"}</td>
        <td class="num">${w.amount ? amt(w.amount) : '<span class="hint">not set</span>'}</td>
        <td class="num">${qty ? `${qty}` : "—"}</td>
        <td>${st}</td>
        <td class="sw-acts">${w.status === "deploy" ? '<button type="button" class="ghost" data-act="dipbuy" title="Record this buy">Buy</button>' : ""}<button type="button" class="ghost" data-act="wedit" title="Change the level or amount">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button></td></tr>`;
    }).join("") : `<tr><td colspan="8" class="nw-empty-row">Write your levels in one go, like <i>TCS below 2100, INFY below 1000, HCL below 1200</i>. <button type="button" class="linklike" data-go="dip">Add dip levels</button></td></tr>`;
  }
  async function dipAddDialog() {
    let rows = null;
    const out = await window.ui.dialog({
      title: "Add buy-the-dip levels", icon: "📉", okText: "Add to the list", wide: true,
      message: "One line or many: the stock, then the price to buy below, and optionally how much to put in. Short names work (HDFC, HCL, SBI, L&T). Two levels for the same stock make a ladder.",
      bodyHtml: `<textarea class="ui-input sw-paste sw-dip-text" name="text" rows="4" placeholder="TCS below 2100, INFY below 1000, HCL below 1200, VBL below 400, HDFC below 680&#10;Bajaj Finance under 6500 for 2L"></textarea>
        <div class="nw-form" style="margin-top:8px">${field("Amount per stock when not written (e.g. 1L)", "amount", sw.settings?.dipAmount ? `${sw.settings.dipAmount / 1e5}L` : "", 'placeholder="e.g. 1L"')}</div>
        <div class="toolbar" style="margin:8px 0 0"><button type="button" class="ghost" data-read>Read</button><span class="ui-hint" data-st></span></div><div class="sw-preview" data-prev></div>`,
      onOpen: (box, { setError }) => {
        box.querySelector("[data-read]").onclick = async () => {
          setError(""); box.querySelector("[data-st]").textContent = "Reading…";
          try {
            rows = (await api("/api/swing/dip-parse", { text: box.querySelector("[name=text]").value })).rows;
            box.querySelector("[data-st]").textContent = `${rows.length} stock${rows.length === 1 ? "" : "s"}. Check the symbols:`;
            box.querySelector("[data-prev]").innerHTML = `<table class="sw-prev"><thead><tr><th>You wrote</th><th>NSE symbol</th><th>Buy below (₹)</th><th>Amount</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${esc(r.typed)}</td><td><input class="ui-input" data-i="${i}" list="dipOpt${i}" value="${esc(r.symbol || "")}" placeholder="symbol?"><datalist id="dipOpt${i}">${(r.options || []).map(o => `<option value="${esc(o.symbol)}">${esc(o.name)}</option>`).join("")}</datalist><div class="ticker">${esc(r.name || "")}${r.how === "not found" ? ' <span class="avoid">not found</span>' : r.how === "short name" ? " · short name" : ""}</div></td><td><input class="ui-input" data-p="${i}" inputmode="decimal" value="${r.buyBelow}"></td><td><input class="ui-input" data-a="${i}" value="${r.amount ? `${r.amount / 1e5}L` : ""}" placeholder="default"></td></tr>`).join("")}</tbody></table>`;
          } catch (e) { setError(e.message); box.querySelector("[data-st]").textContent = ""; }
        };
      },
      collect: async box => {
        if (!rows) { box.querySelector("[data-read]").click(); throw new Error('Check the symbols below, then press "Add to the list".'); }
        box.querySelectorAll("[data-i]").forEach(inp => { rows[Number(inp.dataset.i)].symbol = inp.value.trim().toUpperCase(); });
        box.querySelectorAll("[data-p]").forEach(inp => { rows[Number(inp.dataset.p)].buyBelow = inp.value.trim(); });
        box.querySelectorAll("[data-a]").forEach(inp => { rows[Number(inp.dataset.a)].amount = inp.value.trim() || null; });
        const bad = rows.filter(r => !r.symbol); if (bad.length) throw new Error(`Type the NSE symbol for: ${bad.map(r => r.typed).join(", ")}`);
        return api("/api/swing/dip-add", { rows: rows.map(r => ({ symbol: r.symbol, name: r.how === "not found" ? r.symbol : r.name, exchange: "NSE", buyBelow: r.buyBelow, amount: r.amount })), amount: box.querySelector("[name=amount]").value });
      }
    });
    if (out) { sw = out; render(); if (out.notice) window.toast?.(out.notice, { kind: "ok", ms: 6000 }); }
  }
  // Bought several dips together: quantity from the amount at today's price, all editable; each becomes a swing position
  async function bulkBuyDialog(list) {
    if (!list.length) return;
    const qty0 = w => (w.amount && w.price ? Math.max(1, Math.floor(w.amount / w.price)) : "");
    const out = await window.ui.dialog({
      title: list.length === 1 ? `Bought ${list[0].name} on the dip` : `Bulk buy: ${list.length} dips`, icon: "🛒", okText: "Record buys", wide: true,
      message: "Place the orders at your broker, then record what you bought. Untick any you skipped. Each becomes a swing position (or adds to the one you hold) with your usual targets.",
      bodyHtml: `<div class="sw-bulk-wrap"><table class="sw-prev sw-bulk"><thead><tr><th></th><th>Stock</th><th class="num">Level</th><th class="num">LTP</th><th>Qty</th><th>Price (₹)</th><th class="num">Cost</th></tr></thead><tbody>${list.map(w => `<tr data-row="${esc(w.id)}"><td><input type="checkbox" data-on checked></td><td><b>${esc(w.symbol)}</b><div class="ticker">${esc(w.name)}</div></td><td class="num">${px(w.buyBelow)}</td><td class="num">${px(w.price)}</td><td><input class="ui-input" data-q inputmode="numeric" value="${qty0(w)}"></td><td><input class="ui-input" data-pr inputmode="decimal" value="${w.price ?? w.buyBelow}"></td><td class="num" data-cost></td></tr>`).join("")}</tbody><tfoot><tr><td></td><td colspan="5"><b>Total</b></td><td class="num" data-total></td></tr></tfoot></table></div>
        <div class="nw-form" style="margin-top:8px">${dateField("Bought on")}</div><label class="hint sw-keep"><input type="checkbox" name="keep"> Keep these levels on the list (to buy again if it falls further)</label><p class="ui-hint" data-cashnote></p>`,
      onOpen: box => {
        const upd = () => { let t = 0; box.querySelectorAll("[data-row]").forEach(tr => { const on = tr.querySelector("[data-on]").checked, c = Number(tr.querySelector("[data-q]").value) * Number(tr.querySelector("[data-pr]").value); tr.querySelector("[data-cost]").textContent = on && c > 0 ? amt(c) : "—"; tr.style.opacity = on ? "" : 0.45; if (on && c > 0) t += c; }); box.querySelector("[data-total]").textContent = amt(t); box.querySelector("[data-cashnote]").textContent = fin(sw.totals.cash) ? `Swing cash ${amt(sw.totals.cash)}${t > sw.totals.cash ? `: ${amt(t - sw.totals.cash)} short` : ` → ${amt(sw.totals.cash - t)} left after these`}` : ""; };
        box.addEventListener("input", upd); box.addEventListener("change", upd); upd();
      },
      collect: box => {
        const items = [...box.querySelectorAll("[data-row]")].filter(tr => tr.querySelector("[data-on]").checked).map(tr => ({ id: tr.dataset.row, qty: tr.querySelector("[data-q]").value, price: tr.querySelector("[data-pr]").value }));
        if (!items.length) throw new Error("Tick at least one stock.");
        return api("/api/swing/bulk-buy", { items, date: box.querySelector("[name=date]").value, keep: box.querySelector("[name=keep]").checked });
      }
    });
    if (out) { sw = out; render(); if (out.notice) window.toast?.(out.notice, { kind: "ok", ms: 7000 }); }
  }
  function journalHtml(j) {
    if (!j?.total) return "";
    const tbl = (title, rows, empty) => `<div><h4>${title}</h4>${rows.length ? `<table class="sw-prev sw-jt"><thead><tr><th></th><th class="num">Trades</th><th class="num">Won</th><th class="num">Avg</th><th class="num">P/L</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.trades}</td><td class="num">${r.winRate}%</td><td class="num ${cls(r.avgPct)}">${pct(r.avgPct)}</td><td class="num ${cls(r.pnl)}"><b>${sg(r.pnl)}</b></td></tr>`).join("")}</tbody></table>` : `<p class="hint">${empty}</p>`}</div>`;
    const early = j.earlyExits?.trades ? `<p class="hint">${j.earlyExits.trades} trade${j.earlyExits.trades === 1 ? " was" : "s were"} sold in profit before target 1${fin(j.earlyExits.missedToT1) ? `: about ${sg(j.earlyExits.missedToT1)} more if they had reached T1 at the time` : ""}.</p>` : "";
    return `<details class="sw-journal" open><summary>📝 Journal: what works for you <span class="hint">${j.reviewed} of ${j.total} trades reviewed (📝 on a closed trade)</span></summary>
      <div class="sw-jgrid">${tbl("By setup", j.bySetup, "Tag a setup when you add a position.")}${tbl("By mistake", j.byMistake.filter(r => r.key !== "unreviewed" || j.byMistake.length === 1), "Review closed trades to see which mistakes cost the most.")}</div>${early}</details>`;
  }
  function renderScore() {
    const c = sw.score, box = $("#swScore"); if (!box) return;
    box.hidden = !c || !c.trades;
    if (!c?.trades) return;
    const tile = (k, v, sub = "", klass = "") => `<div class="${klass}"><span>${k}</span><strong>${v}</strong>${sub ? `<small>${sub}</small>` : ""}</div>`;
    const maxM = Math.max(1, ...c.months.map(m => Math.abs(m.pnl)));
    $("#swScoreBody").innerHTML = `<div class="sw-score">
      ${tile("Win rate", fin(c.winRate) ? `${c.winRate}%` : "—", `${c.wins} won · ${c.losses} lost of ${c.trades}`, c.winRate >= 50 ? "good" : "")}
      ${tile("Average win", sg(c.avgWin), fin(c.avgWinPct) ? `+${c.avgWinPct}%` : "")}
      ${tile("Average loss", c.losses ? sg(c.avgLoss) : "—", fin(c.avgLossPct) ? `${c.avgLossPct}%` : "no losing trades")}
      ${tile("Profit factor", fin(c.profitFactor) ? `${c.profitFactor}×` : c.losses ? "—" : "∞", "₹ won for every ₹1 lost")}
      ${tile("Per trade", sg(c.expectancy), "average P/L")}
      ${tile("Days held", fin(c.avgHoldDays) ? c.avgHoldDays : "—", "average")}
      ${tile("Sold at a target", `${c.atTargets} / ${c.trades}`, "followed the plan")}
      ${tile("Best · worst", c.best ? `${esc(c.best.symbol)} ${sg(c.best.pnl)}` : "—", c.worst ? `${esc(c.worst.symbol)} ${sg(c.worst.pnl)}` : "no loss yet")}
    </div>
    ${c.months.length > 1 ? `<div class="sw-months" role="img" aria-label="Booked profit by month">${c.months.map(m => `<div title="${m.month}: ${sg(m.pnl)}"><i class="${m.pnl >= 0 ? "up" : "dn"}" style="height:${Math.max(3, Math.round(Math.abs(m.pnl) / maxM * 48))}px"></i><span>${new Date(`${m.month}-01`).toLocaleDateString("en-IN", { month: "short" })}</span></div>`).join("")}</div>` : ""}
    ${journalHtml(sw.journal)}
    ${sw.cash?.log?.length ? `<details class="sw-cashlog"><summary>Cash movements</summary><table class="sw-prev"><tbody>${sw.cash.log.map(l => `<tr><td>${new Date(l.at).toLocaleDateString("en-IN")}</td><td>${esc(l.why)}</td><td class="num ${cls(l.amount)}">${l.amount === null ? "" : sg(l.amount)}</td><td class="num">${amt(l.balance)}</td></tr>`).join("")}</tbody></table></details>` : ""}`;
  }
  const hm = t => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const srcLine = r => { if (!r.priceSource) return ""; const stale = r.priceStale || /saved|sync/.test(r.priceSource); const age = r.priceAsOf ? Math.round((Date.now() - Date.parse(r.priceAsOf)) / 60e3) : null; return `<div class="ticker${stale ? " sw-stale" : ""}" title="${stale ? "Live price not available right now: showing the last saved price." : r.priceAsOf ? `Market time ${new Date(r.priceAsOf).toLocaleString("en-IN")}` : ""}">${esc(r.priceSource)}${r.priceAsOf && age !== null ? ` · ${age <= 1 ? "live" : age < 60 * 18 && sw?.marketOpen ? `${age} min old` : new Date(r.priceAsOf).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : ""}</div>`; };
  const taxTitle = e => `sale value ${inr(e.sellValue)}, gross ${sg(e.gross)}, charges ${inr(e.charges.total)} (STT ${inr(e.charges.stt)}), tax ${inr(e.tax)}${e.shortTerm.qty ? ` (short-term ${e.rules.stRate}%)` : ""}${e.longTerm.qty ? ` (long-term ${e.rules.ltRate}% above the exemption)` : ""} incl. ${e.rules.cessPct}% cess → you keep ${sg(e.net)}`;
  // One request at a time is shown: a slower, older answer never replaces a newer one.
  let loadSeq = 0, lastLoaded = 0, pendingTimer = null;
  function setBusy(on) { const b = $("#swRefresh"); if (!b) return; b.classList.toggle("is-loading", on); b.disabled = on; b.textContent = on ? "Updating prices…" : "⟳ Refresh prices"; $("#swingView").classList.toggle("sw-busy", on); }
  async function load(quiet = false, fresh = false) {
    const seq = ++loadSeq; if (!quiet) setBusy(true);
    try {
      const v = await api(fresh ? "/api/swing?fresh=1" : "/api/swing");
      if (seq !== loadSeq) return; // a newer request has been made
      sw = v; lastLoaded = Date.now(); render();
      clearTimeout(pendingTimer);
      if (v.pricePending && !window.liveStream?.()) pendingTimer = setTimeout(() => load(true), 5000); // no live stream: look again for prices still on their way
    } catch (e) { if (seq === loadSeq) $("#swStatus").textContent = `Could not update: ${e.message}`; }
    finally { if (seq === loadSeq) { setBusy(false); clearTimeout(timer); if (!$("#swingView").hidden) timer = setTimeout(() => load(true), sw?.marketOpen ? 60e3 : 5 * 60e3); } }
  }
  window.addEventListener("prices:updated", () => { if (!$("#swingView").hidden) load(true); }); // the header refresh / live update
  document.addEventListener("visibilitychange", () => { if (!document.hidden && !$("#swingView").hidden && Date.now() - lastLoaded > 30e3) load(true); });
  window.openSwing = () => { if (!sw) { $("#swRows").innerHTML = `<tr><td colspan="12" class="nw-empty-row">Loading live prices…</td></tr>`; $("#swStatus").textContent = "Loading…"; } load(); loadIdeas(); };
  // ---- Swing ideas ----
  let ideas = null, ideasTimer = null, ideasShown = 12;
  async function loadIdeas(scan = false) {
    clearTimeout(ideasTimer);
    try { ideas = await api("/api/swing/ideas" + (scan ? "/scan" : ""), scan ? {} : undefined); renderIdeas(); }
    catch (e) { $("#swIdeasStatus").textContent = e.message; }
    if (!$("#swingView").hidden) ideasTimer = setTimeout(() => loadIdeas(), ideas?.scan?.running ? 15000 : 5 * 60e3);
  }
  function renderIdeas() {
    const x = ideas, sc = x.scan, setup = $("#swIdeasSetup").value, src = $("#swIdeasSrc").value;
    const via = Object.entries(sc.sources || {}).map(([k, n]) => `${k} ${n}`).join(", ");
    $("#swIdeasStatus").textContent = sc.running ? `Scanning charts… ${sc.done} of ${sc.total}${via ? ` (via ${via})` : ""}` : sc.pausedUntil ? `${sc.scanned} of ${sc.universe} scanned so far. ${sc.error}` : `${sc.scanned} of ${sc.universe} stocks scanned${sc.lastRun ? ` · ${new Date(sc.lastRun).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}${via ? ` · via ${via}` : ""}${sc.failed ? ` · ${sc.failed} without data` : ""}${sc.error ? ` · ${sc.error}` : ""}`;
    $("#swIdeasScan").disabled = sc.running;
    // How the scanner's earlier ideas worked out (target 1 before the stop, within 20 trading days)
    const tr = x.track, tb = $("#swTrack");
    if (tb) { tb.hidden = !tr?.all?.ideas;
      if (tr?.all?.ideas) {
        $("#swTrackSum").textContent = tr.all.judged ? `${tr.all.judged} judged: ${tr.all.hitRate}% reached T1 before the stop, average ${pct(tr.all.avgReturn)} an idea${tr.all.open ? ` · ${tr.all.open} still running` : ""}` : `${tr.all.open} idea${tr.all.open === 1 ? "" : "s"} being tracked since ${tr.since}; first results after a few trading days`;
        $("#swTrackBody").innerHTML = `<table class="sw-prev sw-jt"><thead><tr><th>Setup</th><th class="num">Ideas</th><th class="num">Judged</th><th class="num">Hit T1</th><th class="num">Stopped</th><th class="num">Avg / idea</th></tr></thead><tbody>${tr.rows.map(r => `<tr><td>${esc(r.label)}</td><td class="num">${r.ideas}</td><td class="num">${r.judged}</td><td class="num">${fin(r.hitRate) ? `${r.hitRate}%` : "—"}</td><td class="num">${fin(r.stopRate) ? `${r.stopRate}%` : "—"}</td><td class="num ${cls(r.avgReturn)}">${fin(r.avgReturn) ? pct(r.avgReturn) : "—"}</td></tr>`).join("")}</tbody></table>
          ${tr.recent.length ? `<p class="hint" style="margin:8px 0 4px">Latest results</p><ul class="sw-track-list">${tr.recent.slice(0, 8).map(i => `<li><b>${esc(i.symbol)}</b> ${esc(i.label)} from ${i.day}: ${i.outcome === "t1" ? `<span class="buy">reached T1 in ${i.days} days (${pct(i.ret)})</span>` : i.outcome === "stop" ? `<span class="avoid">stopped out in ${i.days} days (${pct(i.ret)})</span>` : `no target or stop in 20 days (${pct(i.ret)})`}</li>`).join("")}</ul>` : ""}
          <p class="vs-fine">Every idea scoring 50+ is recorded the day it appears, with the entry, stop and target 1 shown on its card, and judged on the daily highs and lows that followed. A day that touched both the stop and T1 counts as stopped. Past results do not promise future ones.</p>`;
      } }
    const list = x.ideas.filter(i => (!setup || i.setup === setup) && (!src || i.source !== "market"));
    const sz = x.sizing;
    const more = list.length - ideasShown;
    $("#swIdeas").innerHTML = list.length ? list.slice(0, ideasShown).map(i => `<article class="sw-idea s-${i.setup}" data-sym="${esc(i.symbol)}">
      <div class="sw-idea-top"><div><div class="company">${esc(i.name)}</div><div class="ticker">${esc(i.symbol)} · ${esc(i.source)}${i.watching ? " · in your swing watchlist" : ""}${fin(i.snap.changePct) ? ` · <span class="${cls(i.snap.changePct)}">${pct(i.snap.changePct)} today</span>` : ""}</div></div>
        <div class="sw-score-pill" title="Setup score out of 100"><b>${i.score}</b><span>score</span></div></div>
      <div class="sw-setup">${i.icon} ${esc(i.label)}</div>
      <div class="sw-plan">
        <div><span>Entry</span><b>${px(i.entry)}</b><small>up to ${px(i.entryHigh)}</small></div>
        <div class="sl"><span>Stop-loss</span><b>${px(i.stop)}</b><small>−${i.riskPct}%</small></div>
        <div class="tg"><span>Target 1</span><b>${px(i.t1)}</b><small>+${i.t1Pct}%</small></div>
        <div class="tg"><span>Target 2</span><b>${px(i.t2)}</b><small>+${i.t2Pct}%</small></div>
        <div><span>Reward : risk</span><b>${i.rr} : 1</b><small>to target 1</small></div>
        <div><span>Size</span><b>${i.size.qty ? `${i.size.qty} sh` : "—"}</b><small>${i.size.qty ? `${amt(i.size.amount)} · risk ${inr(i.size.riskAmount)}` : "price above max per trade"}</small></div>
      </div>
      <ul class="sw-why">${[...i.why, ...i.notes].map(w => `<li>${esc(w)}</li>`).join("")}</ul>
      <div class="sw-idea-acts"><button type="button" class="ghost" data-idea="watch"${i.watching ? " disabled" : ""}>${i.watching ? "✓ Watching" : "+ Swing watchlist"}</button><button type="button" class="primary" data-idea="bought">Bought</button><button type="button" class="ghost" data-idea="chart" title="Valuation and chart details">Details</button></div>
    </article>`).join("") + (more > 0 ? `<button type="button" class="ghost sw-more" data-more>Show ${Math.min(more, 12)} more of ${more}</button>` : "") : `<p class="nw-empty-row">${sc.running ? "Scanning daily charts for setups… ideas appear as stocks are checked." : x.ideas.length ? "No ideas match these filters." : sc.scanned ? "No stock fits a setup today. That happens: no trade is a position too. The scan runs again after tomorrow's close." : sc.pausedUntil ? "Price-history sources are busy right now, so no charts could be read yet. The scan retries by itself." : "No charts scanned yet. Press Scan now (takes a few minutes for ~200 stocks)."}${!sc.kite && (sc.pausedUntil || !sc.scanned || sc.failed) ? ` <br><span class="hint">Yahoo and Screener limit how fast charts can be read; the scan continues by itself. If both stay busy, logging in to Zerodha in the app lets the scan fill the gaps from Kite.</span>` : ""}</p>`;
    $("#swIdeasBox").dataset.sizing = `${sz.riskPct}% risk · max ${amt(sz.perTrade)} per trade${fin(sz.capital) ? ` · swing cash ${amt(sz.capital)}` : ""}`;
  }
  async function ideaAction(i, act) {
    if (act === "chart") { window.openStockSheet?.(i.symbol, { back: "Back to Swing trading" }); return; }
    const watchBody = { symbol: i.symbol, name: i.name, exchange: i.exchange, buyBelow: i.entryHigh, amount: i.size.amount || "", stopLoss: i.stop, idea: { setup: i.setup, label: i.label, t1: i.t1, t2: i.t2 }, notes: `${i.label}: entry ${px(i.entry)}, T1 ${px(i.t1)}` };
    if (act === "watch") { sw = await api("/api/swing/watch", watchBody); render(); ideas.ideas.forEach(x => { if (x.symbol === i.symbol) x.watching = true; }); renderIdeas(); window.toast?.(`${i.name} added to your swing watchlist with its stop and targets.`, { kind: "ok" }); return; }
    const out = await window.ui.dialog({
      title: `Bought ${i.name}`, icon: "✅", okText: "Add to positions",
      message: `The stop-loss (${px(i.stop)}) and targets T1 ${px(i.t1)} / T2 ${px(i.t2)} come with it; you get alerts at each.`,
      bodyHtml: `<div class="nw-form">${field("Quantity", "qty", i.size.qty || "", 'inputmode="numeric" autofocus')}${field("Price (₹)", "price", i.entry, 'inputmode="decimal"')}${dateField("Bought on")}</div>`,
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        let w = sw.watch.find(x => x.symbol === i.symbol);
        if (!w) { sw = await api("/api/swing/watch", watchBody); w = sw.watch.find(x => x.symbol === i.symbol); }
        return api("/api/swing/promote", { id: w.id, qty: v("qty"), price: v("price"), date: v("date") });
      }
    });
    if (out) { sw = out; render(); ideas.ideas = ideas.ideas.filter(x => x.symbol !== i.symbol); renderIdeas(); window.toast?.(out.notice || `${i.name} added to your swing positions.`, { kind: "ok", ms: 6000 }); }
  }

  // ---- dialogs ----
  const todayIst = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const dateField = (label = "Trade date", name = "date", value = todayIst()) => field(label, name, value, `type="date" max="${todayIst()}"`);
  const dmy = d => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const field = (label, name, value = "", attrs = "") => `<label class="ui-field"><span>${label}</span><input class="ui-input" name="${name}" value="${esc(value ?? "")}" ${attrs}></label>`;
  async function pickStock(box) {
    const q = box.querySelector("[name=stock]").value.trim(); if (!q) throw new Error("Type the stock name or NSE symbol.");
    const r = (await api("/api/swing/resolve", { name: q })).results[0];
    if (!r?.symbol) throw new Error(`Could not find "${q}". Try its NSE symbol.`);
    return r;
  }
  async function editPosition(p = null) {
    const out = await window.ui.dialog({
      title: p ? `Edit ${p.name}` : "Add a swing position", icon: "⚡", okText: p ? "Save" : "Add", wide: true,
      bodyHtml: `<div class="nw-form">${field("Stock (name or NSE symbol)", "stock", p ? p.symbol : "", p ? "readonly" : 'placeholder="e.g. Hero Motocorp or HEROMOTOCO" autofocus')}
        ${field("Quantity", "qty", p?.qty, `inputmode="numeric"${p?.lotCount > 1 ? " readonly" : ""}`)}${field("Average buy price (₹)", "avgPrice", p?.avgPrice, `inputmode="decimal"${p?.lotCount > 1 ? " readonly" : ""}`)}
        ${p?.lotCount > 1 ? `<p class="ui-hint" style="grid-column:1/-1;margin:0">Bought in ${p.lotCount} lots: change quantity, prices and dates in <b>📒 Buys</b>.</p>` : ""}
        ${field("Limit for this stock (₹, e.g. 3L)", "limit", p?.limit ? `${p.limit / 1e5}L` : "", 'placeholder="optional, e.g. 3L"')}
        ${field("Add amount (e.g. 2L)", "addAmount", p?.addAmount ? `${p.addAmount / 1e5}L` : "", 'placeholder="optional"')}${field("Add below price (₹, e.g. 4.7k)", "addBelow", p?.addBelow, 'placeholder="optional"')}
        ${field(`Targets % T1, T2, T3 (default ${(sw?.settings.targets || [10, 20, 40]).join(", ")})`, "targets", (p?.ownTargets ? p.targets.map(t => t.pct) : []).join(", "), 'placeholder="default"')}
        ${field(`Stop-loss (₹)${p?.health ? ` · trailing idea ₹${p.health.trail}` : ""}`, "stopLoss", p?.stopLoss ?? "", 'inputmode="decimal" placeholder="optional: alert when price falls to it"')}
        ${field(`Booking plan: % to sell at T1, T2, T3 (default ${(sw?.settings.bookPlan || [33, 33, 34]).join(", ")})`, "bookPlan", p?.ownPlan ? p.bookPlan.join(", ") : "", 'placeholder="default"')}
        ${p?.lotCount > 1 ? "" : field("Bought on (for STCG / LTCG)", "boughtOn", p?.openedAt ? p.openedAt.slice(0, 10) : todayIst(), `type="date" max="${todayIst()}"`)}${field("Note", "notes", p?.notes)}
        <label class="ui-field"><span>Journal: setup</span><select class="ui-input" name="setup"><option value="">Not tagged</option>${Object.entries(sw?.journal?.setups || {}).map(([k, l]) => `<option value="${k}"${p?.setup === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>
        <label class="ui-field" style="grid-column:1/-1"><span>Journal: why I bought (optional)</span><textarea class="ui-input" name="reason" rows="2" maxlength="300" placeholder="e.g. pulled back to the 50-DMA on low volume, results due in 3 weeks">${esc(p?.reason || "")}</textarea></label></div>`,
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        const s = p ? { symbol: p.symbol, name: p.name, exchange: p.exchange } : await pickStock(box);
        return api("/api/swing/position", { id: p?.id, symbol: s.symbol, name: s.name, exchange: s.exchange, qty: v("qty"), avgPrice: v("avgPrice"), limit: v("limit"), addAmount: v("addAmount"), addBelow: v("addBelow"), targets: v("targets"), stopLoss: v("stopLoss"), bookPlan: v("bookPlan"), setup: v("setup") || null, reason: v("reason"), boughtOn: box.querySelector("[name=boughtOn]")?.value || undefined, notes: v("notes") });
      }
    });
    if (out) { sw = out; render(); if (out.notice) window.toast?.(out.notice, { kind: "ok", ms: 6000 }); }
  }
  async function editWatch(w = null) {
    const out = await window.ui.dialog({
      title: w ? `Edit ${w.name}` : "Add to swing watchlist", icon: "👀", okText: w ? "Save" : "Add", wide: true,
      bodyHtml: `<div class="nw-form">${field("Stock (name or NSE symbol)", "stock", w ? w.symbol : "", w ? "readonly" : 'placeholder="e.g. PB Fintech" autofocus')}
        ${field("Buy below (₹)", "buyBelow", w?.buyBelow, 'placeholder="e.g. 980"')}${field("Amount to deploy (e.g. 3L)", "amount", w?.amount ? `${w.amount / 1e5}L` : "", 'placeholder="e.g. 3L"')}${field("Stop-loss after buying (₹)", "stopLoss", w?.stopLoss ?? "", 'inputmode="decimal" placeholder="optional"')}${field("Note", "notes", w?.notes)}</div>`,
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        const s = w ? { symbol: w.symbol, name: w.name, exchange: w.exchange } : await pickStock(box);
        return api("/api/swing/watch", { id: w?.id, symbol: s.symbol, name: s.name, exchange: s.exchange, buyBelow: v("buyBelow"), amount: v("amount"), stopLoss: v("stopLoss"), notes: v("notes") });
      }
    });
    if (out) { sw = out; render(); }
  }
  async function tradeDialog(p, side) {
    const out = await window.ui.dialog({
      title: side === "sell" ? `Sell ${p.name}` : `Bought more ${p.name}`, icon: side === "sell" ? "🎯" : "➕", okText: side === "sell" ? "Record sale" : "Record buy",
      message: side === "sell" ? `You hold ${p.qty} at ${px(p.avgPrice)}.${p.sellNow ? ` Your booking plan says sell ${p.sellNow} now (T${p.hitLevel}).` : ""} Profit on the shares you sell is added to Closed trades.` : `Your average price is recalculated.${fin(sw.totals.cash) ? " The cost comes out of your swing cash." : ""}`,
      bodyHtml: `<div class="nw-form">${field("Quantity", "qty", side === "sell" ? (p.sellNow || p.qty) : "", 'inputmode="numeric" autofocus')}${field("Price (₹)", "price", p.price ?? "", 'inputmode="decimal"')}${dateField(side === "sell" ? "Sold on" : "Bought on")}</div><p class="ui-hint" data-prev></p>${side === "sell" ? reviewFields(null) : ""}`,
      onOpen: box => {
        let tt = null;
        const upd = () => {
          const q = Number(box.querySelector("[name=qty]").value), pr = Number(box.querySelector("[name=price]").value), d = box.querySelector("[name=date]").value;
          if (side === "buy") { box.querySelector("[data-prev]").textContent = q > 0 && pr > 0 ? `New average: ${px(+((p.qty * p.avgPrice + q * pr) / (p.qty + q)).toFixed(2))} on ${p.qty + q} shares` : ""; return; }
          if (!(q > 0 && pr > 0)) { box.querySelector("[data-prev]").textContent = ""; return; }
          box.querySelector("[data-prev]").textContent = `Profit / loss on this sale: ${sg((pr - p.avgPrice) * q)} (${pct(+((pr / p.avgPrice - 1) * 100).toFixed(2))}) · working out tax…`;
          clearTimeout(tt); tt = setTimeout(async () => { try { const e = await api("/api/swing/tax", { id: p.id, qty: q, price: pr, date: d }); box.querySelector("[data-prev]").innerHTML = taxTable(e); } catch (err) { box.querySelector("[data-prev]").textContent = err.message; } }, 300);
        };
        box.querySelectorAll("input").forEach(i => { i.oninput = upd; }); upd();
      },
      collect: box => api(`/api/swing/${side}`, { id: p.id, qty: box.querySelector("[name=qty]").value, price: box.querySelector("[name=price]").value, date: box.querySelector("[name=date]").value, ...(side === "sell" ? { review: readReview(box) } : {}) })
    });
    if (out) { sw = out; render(); window.toast?.(side === "sell" ? "Sale recorded." : "Buy recorded.", { kind: "ok", ms: 3000 }); }
  }
  // ---- Hold or sell? ----
  async function decideDialog(p) {
    if (!p) return;
    let d; try { d = await api("/api/swing/decide", { id: p.id }); } catch (e) { window.toast?.(e.message, { kind: "error" }); return; }
    const money = v => (v >= 0 ? inr(v) : `−${inr(-v)}`);
    const card = (s, lean) => `<div class="dz-card${s.key === lean ? " lean" : ""}"><h4>${s.key === lean ? "👉 " : ""}${esc(s.title)}</h4>
      ${s.key === "lt" ? `<div class="dz-nums"><div><span>Tax saved</span><b class="buy">${inr(s.saved)}</b></div></div>`
        : `<div class="dz-nums">${fin(s.keepNow) && s.key === "split" ? `<div><span>Booked today</span><b>${money(s.keepNow)}</b></div>` : ""}<div><span>${s.key === "sell" ? "You keep" : "If the price holds"}</span><b class="${cls(s.typical)}">${money(s.typical)}</b></div>${s.key !== "sell" ? `<div><span>${s.key === "split" ? "Worst case (stop hit)" : "Bad week (−2σ)"}</span><b class="${cls(s.worst)}">${money(s.worst)}</b></div><div><span>Good week (+1σ)</span><b class="${cls(s.best)}">${money(s.best)}</b></div>` : ""}</div>`}
      <ul>${s.notes.map(n => `<li>${esc(n)}</li>`).join("")}</ul>
      ${s.key === "split" ? `<div class="dz-acts"><button type="button" class="primary" data-dz="sell" data-q="${s.partQty}">Sell ${s.partQty} now…</button><button type="button" class="ghost" data-dz="stop" data-sl="${s.stop}">Set stop-loss ₹${s.stop.toLocaleString("en-IN")} + alert</button></div>` : s.key === "sell" ? `<div class="dz-acts"><button type="button" class="ghost" data-dz="sell" data-q="${d.facts.qty}">Sell all ${d.facts.qty}…</button></div>` : ""}</div>`;
    const f = d.facts;
    await window.ui.dialog({ title: `Hold or sell? ${d.name}`, icon: "⚖", okText: "Close", hideCancel: true, wide: true,
      message: `${f.qty} shares at ${px(f.avgPrice)}, now ${px(f.price)}: ${sg(f.gainNow)} before costs, ${sg(f.netNow)} after STT, charges and tax if sold today.`,
      bodyHtml: `<div class="dz-lean ${d.lean}"><b>${esc(d.headline)}</b><ul>${d.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul></div>
        <div class="dz-grid">${d.scenarios.map(s => card(s, d.lean)).join("")}</div>
        <p class="vs-fine">Moves use this stock's own daily swings over the last 3 months (${f.volPct}% a day${f.volEstimated ? ", estimated" : ""}) for ${f.tradingDays} trading days: ±${f.movePct}% is a normal outcome (about 2 in 3), −${Math.round(f.movePct * 2 * 10) / 10}% a bad one (about 1 in 20). Dividend taxed at your ${f.slabPct}% slab (change it in ⚙ Settings). After STT, charges, STCG/LTCG and cess. A rule-based comparison to help you decide, not investment advice; the market can move more than this.</p>`,
      onOpen: (box, { setError }) => box.querySelectorAll("[data-dz]").forEach(b => { b.onclick = async () => {
        if (b.dataset.dz === "sell") { box.closest(".ui-scrim")?.querySelector('[data-ui="ok"]')?.click(); tradeDialog({ ...p, sellNow: Number(b.dataset.q) }, "sell"); return; }
        try { // stop-loss on the position, and a price alert at the same level
          const sl = Number(b.dataset.sl);
          sw = await api("/api/swing/position", { id: p.id, symbol: p.symbol, name: p.name, exchange: p.exchange, qty: p.qty, avgPrice: p.avgPrice, limit: p.limit || "", addAmount: p.addAmount || "", addBelow: p.addBelow || "", targets: p.ownTargets ? p.targets.map(t => t.pct).join(",") : "", stopLoss: sl, bookPlan: p.ownPlan ? p.bookPlan.join(",") : "", notes: p.notes || "" });
          await api("/api/rules/save", { symbol: p.symbol, type: "below", value: sl, note: "stop-loss from Hold or sell?" }).catch(() => {});
          render(); b.textContent = `✓ Stop-loss ₹${sl.toLocaleString("en-IN")} set, alert on`; b.disabled = true;
        } catch (e) { setError(e.message); }
      }; }) });
  }
  // ---- Journal: review of a sale (what went right or wrong) ----
  function reviewFields(t) {
    const ms = sw?.journal?.mistakes || {}, have = new Set(t?.review?.mistakes || []);
    return `<details class="sw-review"${t ? " open" : ""}><summary>📝 Journal: how did this trade go? <span class="hint">(optional)</span></summary>
      <div class="sw-mist">${Object.entries(ms).map(([k, l]) => `<label class="ui-opt sm"><input type="checkbox" name="mist" value="${k}"${have.has(k) ? " checked" : ""}><span>${esc(l)}</span></label>`).join("")}</div>
      <label class="ui-field"><span>Lesson / note</span><textarea class="ui-input" name="lesson" rows="2" maxlength="400" placeholder="e.g. sold at T1 into strength; should have trailed the stop">${esc(t?.review?.note || "")}</textarea></label></details>`;
  }
  const readReview = box => { const m = [...box.querySelectorAll("[name=mist]:checked")].map(i => i.value), note = box.querySelector("[name=lesson]")?.value.trim(); return m.length || note ? { mistakes: m, note } : null; };
  async function reviewDialog(t) {
    const out = await window.ui.dialog({ title: `Review: ${t.name}`, icon: "📝", okText: "Save review", wide: true,
      message: `${t.qty} shares bought at ${px(t.buyAvg)}, sold at ${px(t.sellPrice)} on ${new Date(t.closedAt).toLocaleDateString("en-IN")}: ${sg(t.pnl)} (${pct(t.pnlPct)})${t.reason ? `. Why you bought: “${t.reason}”` : ""}.`,
      bodyHtml: `<label class="ui-field"><span>Setup</span><select class="ui-input" name="setup"><option value="">Not tagged</option>${Object.entries(sw?.journal?.setups || {}).map(([k, l]) => `<option value="${k}"${t.setup === k ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></label>${reviewFields(t)}`,
      collect: box => api("/api/swing/review", { id: t.id, setup: box.querySelector("[name=setup]").value || null, ...(readReview(box) || { mistakes: [], note: "" }) }) });
    if (out) { sw = out; render(); window.toast?.("Review saved.", { kind: "ok", ms: 2500 }); }
  }
  function taxTable(e) {
    if (!e) return "";
    const row = (k, v, cl = "") => `<tr${cl ? ` class="${cl}"` : ""}><td>${k}</td><td class="num">${v}</td></tr>`;
    return `<table class="sw-taxt">${row(`Sale value (${e.qty} shares)`, inr(e.sellValue))}${row("Cost (bought for)", inr(e.buyValue))}${row("<b>Gross profit / loss</b>", `<b>${sg(e.gross)}</b> <small>${pct(e.grossPct)}</small>`, cls(e.gross))}
      ${row(`STT 0.1% (sell ${inr(e.charges.sttSell)} + buy ${inr(e.charges.sttBuy)})`, `− ${inr(e.charges.stt)}`)}${row(`Exchange, SEBI, stamp, GST, DP (₹${e.charges.dp})`, `− ${inr(e.charges.total - e.charges.stt)}`)}
      ${e.shortTerm.qty ? row(`STCG tax ${e.rules.stRate}% on ${inr(Math.max(0, e.shortTerm.gain))} (${e.shortTerm.qty} sh held ≤ 12 months)`, `− ${inr(e.shortTerm.tax)}`) : ""}
      ${e.longTerm.qty ? row(`LTCG tax ${e.rules.ltRate}% on ${inr(e.longTerm.taxable)} (${e.longTerm.qty} sh held > 12 months; ${inr(e.longTerm.exemptUsed)} covered by the ₹1.25 L yearly exemption)`, `− ${inr(e.longTerm.tax)}`) : ""}
      ${e.cess ? row(`Health & education cess ${e.rules.cessPct}%`, `− ${inr(e.cess)}`) : ""}
      ${row("<b>You keep</b>", `<b>${sg(e.net)}</b>${e.keepPct !== null ? `<small style="display:block">${e.keepPct}% of the gross profit</small>` : ""}`, `sw-keep ${cls(e.net)}`)}</table>
      <p class="hint" style="margin:6px 0 0">Estimate: Zerodha delivery charges; ${e.rules.asOf}. Surcharge (very high incomes) and your other gains/losses this year are not included. Not tax advice.</p>`;
  }
  function patDialog() {
    const p = sw.totals.pat; if (!p) return;
    const row = (k, v, c = "") => `<tr${c ? ` class="${c}"` : ""}><td>${k}</td><td class="num">${v}</td></tr>`;
    window.ui.dialog({ title: "Profit after tax if you book everything now", icon: "🧾", okText: "Close", hideCancel: true, wide: true,
      bodyHtml: `<table class="sw-taxt">${row(`Sale value of all ${p.positions} positions`, inr(p.sellValue))}${row("<b>Profit / loss before tax</b>", `<b class="${cls(p.gross)}">${sg(p.gross)}</b>`)}
        ${row("STT 0.1% (buy + sell)", `− ${inr(p.stt)}`)}${row("Exchange, SEBI, stamp, GST, DP charges", `− ${inr(p.otherCharges)}`)}
        ${p.stGain ? row(`STCG tax 20% on ${inr(p.stGain)} (shares held 12 months or less)`, `− ${inr(p.stTax)}`) : ""}
        ${p.ltGain ? row(`LTCG tax 12.5% on ${inr(p.ltGain - p.exemptUsed)} (${inr(p.exemptUsed)} of long-term gain covered by the ₹1.25 L yearly exemption)`, `− ${inr(p.ltTax)}`) : ""}
        ${p.cess ? row("Health & education cess 4%", `− ${inr(p.cess)}`) : ""}
        ${row("<b>Profit after tax (PAT)</b>", `<b class="${cls(p.net)}">${sg(p.net)}</b>${p.keepPct !== null ? `<small style="display:block">${p.keepPct}% of the profit</small>` : ""}`, "sw-keep")}</table>
        <p class="hint" style="margin:8px 0 0">Losses in one stock offset gains in another, and the LTCG exemption is counted once for the year (less what you have already used). Estimate: no surcharge, and your other sales this year are not included. Not tax advice.</p>`,
      collect: () => true });
  }
  // Tax calculator: any buy / sell, or the user's own numbers ("₹19,000 profit")
  async function taxCalculator(p = null) {
    await window.ui.dialog({
      title: "Tax on a sale", icon: "🧮", okText: "Close", hideCancel: true, wide: true,
      bodyHtml: `<div class="nw-form">${field("Quantity", "qty", p?.qty ?? 100, 'inputmode="numeric"')}${field("Bought at (₹ per share)", "buy", p?.avgPrice ?? 1000, 'inputmode="decimal"')}${field("Sell at (₹ per share)", "sell", p?.price ?? 1190, 'inputmode="decimal"')}
        ${field("Bought on", "bought", p?.openedAt ? p.openedAt.slice(0, 10) : new Date(Date.now() - 120 * 864e5).toISOString().slice(0, 10), `type="date" max="${todayIst()}"`)}${dateField("Sell on", "date")}</div><div data-out class="ui-hint"></div>`,
      onOpen: box => {
        let t = null; const v = n => box.querySelector(`[name=${n}]`).value;
        const upd = () => { clearTimeout(t); t = setTimeout(async () => { try { box.querySelector("[data-out]").innerHTML = taxTable(await api("/api/swing/tax", { qty: v("qty"), buyPrice: v("buy"), boughtOn: v("bought"), price: v("sell"), date: v("date") })); } catch (e) { box.querySelector("[data-out]").textContent = e.message; } }, 250); };
        box.querySelectorAll("input").forEach(i => { i.oninput = upd; }); upd();
      },
      collect: () => true
    });
  }
  // Buys of one position: the dates, quantities and prices you actually bought at (fix imported positions here).
  async function lotsDialog(p) {
    const st = sw.ledger?.entries?.filter(e => e.symbol === p.symbol) || [];
    const lots = (p.lots || []).map(l => ({ date: String(l.at).slice(0, 10), qty: l.qty, price: l.price }));
    const rowHtml = (l = { date: todayIst(), qty: "", price: "" }) => `<tr><td><input class="ui-input" type="date" max="${todayIst()}" data-k="date" value="${esc(l.date)}"></td><td><input class="ui-input" inputmode="numeric" data-k="qty" value="${esc(l.qty)}"></td><td><input class="ui-input" inputmode="decimal" data-k="price" value="${esc(l.price)}"></td><td><button type="button" class="ghost danger-text" data-rm title="Remove this buy">✕</button></td></tr>`;
    const sells = st.filter(e => e.type === "SELL");
    const out = await window.ui.dialog({
      title: `${p.name}: buys`, icon: "📒", okText: "Save buys", wide: true,
      message: "Each buy you still hold, with its date and price. Imported positions start as one buy on the import date: replace it with your real buys (split it into several rows if you bought on different days). Quantity and average price follow from these rows.",
      bodyHtml: `<table class="sw-prev sw-lots"><thead><tr><th>Bought on</th><th>Qty</th><th>Price (₹)</th><th></th></tr></thead><tbody data-rows>${(lots.length ? lots : [undefined]).map(rowHtml).join("")}</tbody></table>
        <div class="toolbar" style="margin:8px 0 0"><button type="button" class="ghost" data-add>+ Add a buy</button><span class="ui-hint" data-sum></span></div>
        ${sells.length ? `<h4 style="margin:14px 0 6px">Sold from this position</h4><table class="sw-prev"><tbody>${sells.map(e => `<tr><td>${dmy(e.date)}</td><td>Sold ${e.qty} @ ${px(e.price)}</td><td class="num ${cls(e.pnl)}">${sg(e.pnl)}</td></tr>`).join("")}</tbody></table>` : ""}`,
      onOpen: box => {
        const body = box.querySelector("[data-rows]");
        const sum = () => { let q = 0, v = 0; body.querySelectorAll("tr").forEach(tr => { const qq = Number(tr.querySelector("[data-k=qty]").value), pp = Number(tr.querySelector("[data-k=price]").value); if (qq > 0 && pp > 0) { q += qq; v += qq * pp; } }); box.querySelector("[data-sum]").textContent = q ? `${q} shares · average ${px(+(v / q).toFixed(2))} · cost ${amt(v)}${q !== p.qty ? ` (was ${p.qty})` : ""}` : ""; };
        box.querySelector("[data-add]").onclick = () => { body.insertAdjacentHTML("beforeend", rowHtml()); sum(); body.lastElementChild.querySelector("input").focus(); };
        body.addEventListener("click", e => { if (e.target.closest("[data-rm]") && body.children.length > 1) { e.target.closest("tr").remove(); sum(); } });
        body.addEventListener("input", sum); sum();
      },
      collect: box => api("/api/swing/lots", { id: p.id, lots: [...box.querySelectorAll("[data-rows] tr")].map(tr => ({ date: tr.querySelector("[data-k=date]").value, qty: tr.querySelector("[data-k=qty]").value, price: tr.querySelector("[data-k=price]").value })).filter(r => r.qty || r.price) })
    });
    if (out) { sw = out; render(); window.toast?.(`${p.name}: buys saved.`, { kind: "ok" }); }
  }
  let ledgerSym = "";
  // Booked-profit period (top of the page): a financial year (Apr–Mar) and a month range inside it; remembered
  let per = (() => { try { return JSON.parse(localStorage.getItem("sw-period") || "null") || {}; } catch { return {}; } })();
  const perSave = () => { try { localStorage.setItem("sw-period", JSON.stringify(per)); } catch { /* private mode */ } };
  function renderLedger() {
    const L = sw.ledger, box = $("#swLedgerBody"); if (!box || !L) return;
    $("#swLedgerSum").textContent = L.entries.length ? `${L.entries.filter(e => e.type === "BUY").length} buys · ${L.entries.filter(e => e.type === "SELL").length} sells` : "nothing yet";
    if (ledgerSym && !L.stocks.some(s => s.symbol === ledgerSym)) ledgerSym = "";
    const list = L.entries.filter(e => !ledgerSym || e.symbol === ledgerSym), st = ledgerSym && L.stocks.find(s => s.symbol === ledgerSym);
    box.innerHTML = `<div class="toolbar sw-ledger-tools"><label class="hint">Stock <select class="ui-input" id="swLedgerSym"><option value="">All stocks</option>${L.stocks.map(s => `<option value="${esc(s.symbol)}"${s.symbol === ledgerSym ? " selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      ${st ? `<span class="hint">Bought ${st.bought} for ${amt(st.boughtValue)} · sold ${st.sold} for ${amt(st.soldValue)} · booked <b class="${cls(st.realised)}">${sg(st.realised)}</b> · holding ${st.held} · ${dmy(st.first)} to ${dmy(st.last)}</span>` : ""}</div>
      <div class="table-wrap"><table class="sw-table sw-ledger"><thead><tr><th>Date</th><th>Stock</th><th>Type</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Value</th><th>Details</th></tr></thead><tbody>${list.length ? list.map(e => `<tr class="lg-${e.type.toLowerCase()}"><td>${dmy(e.date)}</td><td><div class="company">${esc(e.name)}</div><div class="ticker">${esc(e.symbol)}</div></td><td><span class="sw-sig ${e.type === "BUY" ? "dp" : "tp"}">${e.type === "BUY" ? "Buy" : "Sell"}</span></td><td class="num">${e.qty}</td><td class="num">${px(e.price)}</td><td class="num">${inr(e.value)}</td>
        <td>${e.type === "BUY" ? (e.sold ? `${e.held ? `${e.held} held · ` : ""}${e.sold} sold${e.soldOn.length ? ` (${e.soldOn.map(dmy).join(", ")})` : ""}` : "held") : `<b class="${cls(e.pnl)}">${sg(e.pnl)}</b> <small>${pct(e.pnlPct)}</small> · bought at ${px(e.buyAvg)} avg${e.atTarget ? " · at target" : ""}`}</td></tr>`).join("") : `<tr><td colspan="7" class="nw-empty-row">Buys and sells appear here with their dates.</td></tr>`}</tbody></table></div>`;
    $("#swLedgerSym").onchange = e => { ledgerSym = e.target.value; renderLedger(); };
  }
  async function boughtDialog(w) {
    const out = await window.ui.dialog({
      title: `Bought ${w.name}`, icon: "✅", okText: "Move to positions", message: "It leaves the swing watchlist and becomes a swing position.",
      bodyHtml: `<div class="nw-form">${field("Quantity", "qty", w.amount && w.price ? Math.floor(w.amount / w.price) : "", 'inputmode="numeric" autofocus')}${field("Average price (₹)", "price", w.price ?? "", 'inputmode="decimal"')}${dateField("Bought on")}</div>`,
      collect: box => api("/api/swing/promote", { id: w.id, qty: box.querySelector("[name=qty]").value, price: box.querySelector("[name=price]").value, date: box.querySelector("[name=date]").value })
    });
    if (out) { sw = out; render(); if (out.notice) window.toast?.(out.notice, { kind: "ok", ms: 6000 }); }
  }
  async function pasteDialog() {
    let rows = null;
    const out = await window.ui.dialog({
      title: "Paste from your sheet", icon: "📋", okText: "Import", wide: true,
      message: "Copy the rows from Google Sheets or Excel (stock, qty, purchase price, … , limit, “Add 2L below 4.7k”) and paste them here. Rows with qty and price become positions; the others go to the swing watchlist.",
      bodyHtml: `<textarea class="ui-input sw-paste" name="text" rows="7" placeholder="Hero Motocorp	21	4936.88	…	3L	Add 2L below 4.7k&#10;PB Fintech						Add 3L below 980"></textarea>
        <div class="toolbar" style="margin:8px 0 0"><button type="button" class="ghost" data-read>Read rows</button><span class="ui-hint" data-st></span></div><div class="sw-preview" data-prev></div>`,
      onOpen: (box, { setError }) => {
        box.querySelector("[data-read]").onclick = async () => {
          setError(""); box.querySelector("[data-st]").textContent = "Reading…";
          try {
            rows = (await api("/api/swing/parse", { text: box.querySelector("[name=text]").value })).rows;
            box.querySelector("[data-st]").textContent = `${rows.filter(r => r.kind === "position").length} positions, ${rows.filter(r => r.kind === "watch").length} watchlist rows. Check the symbols:`;
            box.querySelector("[data-prev]").innerHTML = `<table class="sw-prev"><thead><tr><th>From sheet</th><th>NSE symbol</th><th>Type</th><th>Qty @ price</th><th>Plan</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${esc(r.sheetName)}</td><td><input class="ui-input" data-i="${i}" value="${esc(r.symbol || "")}" placeholder="symbol?"><div class="ticker">${esc(r.name || "")}${r.how === "not found" ? ' <span class="avoid">not found</span>' : ""}</div></td><td>${r.kind === "position" ? "Position" : "Watchlist"}</td><td>${r.qty ? `${r.qty} @ ${px(r.avgPrice)}` : "—"}</td><td>${r.addAmount ? `Add ${amt(r.addAmount)}` : ""}${r.addBelow ? ` below ${px(r.addBelow)}` : ""}${r.limit ? ` · limit ${amt(r.limit)}` : ""}</td></tr>`).join("")}</tbody></table>`;
          } catch (e) { setError(e.message); box.querySelector("[data-st]").textContent = ""; }
        };
      },
      collect: async box => {
        if (!rows) throw new Error('Press "Read rows" first.');
        box.querySelectorAll("[data-i]").forEach(inp => { rows[Number(inp.dataset.i)].symbol = inp.value.trim().toUpperCase(); });
        const bad = rows.filter(r => !r.symbol); if (bad.length) throw new Error(`Type the NSE symbol for: ${bad.map(r => r.sheetName).join(", ")}`);
        return api("/api/swing/import", { rows: rows.map(r => ({ ...r, name: r.name || r.sheetName })) });
      }
    });
    if (out) { sw = out; render(); window.toast?.("Imported. Prices update every minute while this page is open.", { kind: "ok" }); }
  }
  async function settingsDialog(focus = null) {
    const out = await window.ui.dialog({
      title: "Swing settings", icon: "⚙", okText: "Save", wide: true,
      onOpen: box => { if (focus) setTimeout(() => box.querySelector(`[name=${focus}]`)?.focus(), 50); },
      bodyHtml: `<div class="nw-form">${[0, 1, 2].map(i => field(`Target ${i + 1} (T${i + 1}): % up from your average`, `t${i}`, sw.settings.targets[i] ?? "", `inputmode="decimal"${i ? ' placeholder="optional"' : ""}`)).join("")}${field("Booking plan: % of the position to sell at T1, T2, T3", "bookPlan", sw.settings.bookPlan.join(", "), 'placeholder="33, 33, 34"')}
        ${field("Deploy when down this % (stocks without an add level)", "dipPct", sw.settings.dipPct, 'inputmode="decimal"')}
        ${field("Risk per trade (% of swing cash lost if the stop is hit)", "riskPct", sw.settings.riskPct ?? 1, 'inputmode="decimal"')}${field("Max per trade (₹, e.g. 2L)", "perTrade", sw.settings.perTrade ? `${sw.settings.perTrade / 1e5}L` : "2L")}
        ${field("LTCG exemption already used elsewhere this year (₹)", "ltUsedElsewhere", sw.taxInfo?.ltUsedElsewhere || "", 'placeholder="0"')}${field("DP charge per stock sold (₹)", "dpPerSale", sw.taxInfo?.charges?.dpPerSale ?? 15.34, 'inputmode="decimal"')}
        ${field("Cash set aside for swing (₹, e.g. 5L; blank = don't track)", "cash", fin(sw.totals.cash) ? sw.totals.cash : "", 'placeholder="e.g. 5L"')}
        ${field("Your income-tax slab % (for dividends; e.g. 30)", "slabPct", sw.settings.slabPct ?? 30, 'inputmode="decimal"')}</div>
        <p class="ui-hint">The Targets column shows the price and the shares to sell at each level; you get an alert at T1, T2 and T3. Booking plan examples: <b>33, 33, 34</b> = a third at each target · <b>50, 50</b> = half at T1, the rest at T2 · <b>25, 25</b> = half in two steps, keep the rest as a runner. Cash goes down when you record a buy and up when you record a sale.</p>`,
      collect: box => api("/api/swing/settings", { targets: [0, 1, 2].map(i => box.querySelector(`[name=t${i}]`).value.trim()).filter(Boolean).join(","), bookPlan: box.querySelector("[name=bookPlan]").value, slabPct: box.querySelector("[name=slabPct]").value, dipPct: box.querySelector("[name=dipPct]").value, riskPct: box.querySelector("[name=riskPct]").value, perTrade: box.querySelector("[name=perTrade]").value, ltUsedElsewhere: box.querySelector("[name=ltUsedElsewhere]").value, dpPerSale: box.querySelector("[name=dpPerSale]").value, cash: box.querySelector("[name=cash]").value })
    });
    if (out) { sw = out; render(); loadIdeas(); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#swingView")) return;
    $("#viewSwing").onclick = () => setView("swing");
    $("#swAddPos").onclick = () => editPosition();
    $("#swAddWatch").onclick = () => editWatch();
    $("#swPaste").onclick = pasteDialog;
    $("#swDipAdd").onclick = () => dipAddDialog();
    $("#swDipBuy").onclick = () => bulkBuyDialog(sw.watch.filter(w => w.list === "dip" && w.status === "deploy"));
    $("#swSettings").onclick = () => settingsDialog();
    $("#swTaxCalc").onclick = () => taxCalculator();
    $("#swIdeasScan").onclick = () => loadIdeas(true);
    $("#swIdeasSetup").onchange = $("#swIdeasSrc").onchange = () => { ideasShown = 12; if (ideas) renderIdeas(); };
    $("#swIdeas").addEventListener("click", async e => {
      if (e.target.closest("[data-more]")) { ideasShown += 12; renderIdeas(); return; }
      const b = e.target.closest("[data-idea]"), card = e.target.closest("[data-sym]"); if (!b || !card || !ideas) return;
      const i = ideas.ideas.find(x => x.symbol === card.dataset.sym); if (!i) return;
      b.disabled = true; try { await ideaAction(i, b.dataset.idea); } catch (err) { window.toast?.(err.message, { kind: "error" }); } finally { b.disabled = b.dataset.idea === "watch" && i.watching; }
    });
    $("#swExport").onclick = () => { if (!sw?.realised?.count && !sw?.positions?.length) { window.toast?.("Nothing to export yet.", { kind: "info" }); return; } const a = document.createElement("a"); a.href = "/api/swing/export.xlsx"; a.download = ""; document.body.append(a); a.click(); a.remove(); };
    $("#swRefresh").onclick = () => load(false, true);
    $("#swingView").addEventListener("click", async e => {
      const mb = e.target.closest("[data-more]"); if (mb) { swMore = mb.dataset.more === "1"; try { localStorage.setItem("sw-more", swMore ? "1" : "0"); } catch { /* private mode */ } render(); return; }
      if (e.target.closest('[data-go="paste"]')) { pasteDialog(); return; }
      if (e.target.closest('[data-go="dip"]')) { dipAddDialog(); return; }
      if (e.target.closest('[data-go="pat"]')) { patDialog(); return; }
      if (e.target.closest('[data-go="taxpaid"]')) { taxPaidDialog(sw.booked?.currentFy); return; }
      const bm = e.target.closest("[data-bkm]"); if (bm) { const P = period(), m = bm.dataset.bkm; per = e.shiftKey ? { fy: P.fy, from: m < P.from ? m : P.from, to: m > P.to ? m : P.to } : { fy: P.fy, from: m, to: m }; perSave(); render(); return; }
      const pc = e.target.closest("[data-per]"); if (pc) { const [f, t] = pc.dataset.per.split("|"); per = { fy: period().fy, from: f, to: t }; perSave(); render(); return; }
      const nt = e.target.closest("[data-tax]"); if (nt) { const p = sw.positions.find(x => x.id === nt.dataset.tax); if (p) window.ui.dialog({ title: `${p.name}: if you sold all ${p.qty} now`, icon: "🧮", okText: "Close", hideCancel: true, wide: true, bodyHtml: taxTable(p.ifSold), collect: () => true }); return; }
      if (e.target.closest('[data-go="cash"]')) { settingsDialog("cash"); return; }
      const tb = e.target.closest("[data-tact]");
      if (tb) {
        const t = sw.closed.find(x => x.id === tb.dataset.tid); if (!t) return;
        if (tb.dataset.tact === "review") { reviewDialog(t); return; }
        const reopen = tb.dataset.tact === "reopen", held = sw.positions.find(x => x.symbol === t.symbol);
        const ok = await window.ui.confirm(reopen
          ? { title: `Reopen ${t.name}?`, message: `The ${t.qty} shares go back into your swing positions at ${px(t.buyAvg)}${held ? ` (added to the ${held.qty} you still hold)` : ""}, and ${sg(t.pnl)} comes off "Booked so far".${fin(sw.totals.cash) ? ` The sale value (${amt(t.qty * t.sellPrice)}) comes back out of your swing cash.` : ""}`, okText: "Reopen" }
          : { title: `Delete this ${t.name} trade?`, message: `${sg(t.pnl)} comes off "Booked so far". Your positions${fin(sw.totals.cash) ? " and swing cash" : ""} do not change. Use Reopen instead if the sale never happened.`, okText: "Delete", danger: true });
        if (ok) { try { sw = await api(`/api/swing/${tb.dataset.tact}`, { id: t.id }); render(); window.toast?.(reopen ? `${t.name} reopened.` : "Trade deleted.", { kind: "ok" }); } catch (err) { window.toast?.(err.message, { kind: "error" }); } }
        return;
      }
      const dz = e.target.closest("[data-decide]"); if (dz) { decideDialog(sw.positions.find(x => x.id === dz.dataset.decide)); return; }
      const btn = e.target.closest("[data-act]"), tr = e.target.closest("tr[data-id]"); if (!btn || !tr) return;
      const id = tr.dataset.id, p = sw.positions.find(x => x.id === id), w = sw.watch.find(x => x.id === id), act = btn.dataset.act;
      if (act === "edit") editPosition(p); else if (act === "wedit") editWatch(w); else if (act === "sell" || act === "buy") tradeDialog(p, act); else if (act === "bought") boughtDialog(w); else if (act === "dipbuy") bulkBuyDialog([w]); else if (act === "lots") lotsDialog(p);
      else if (act === "del" && await window.ui.confirm({ title: `Remove ${(p || w).name}?`, message: p ? "Only the swing tracking is removed; nothing changes at your broker. Use Sell to record a sale instead." : "It is removed from the swing watchlist.", okText: "Remove", danger: true })) { sw = await api("/api/swing/delete", { id }); render(); }
    });
  });
})();
