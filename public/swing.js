// Swing trading page: live P/L on swing positions, take-profit / deploy signals, and a swing watchlist to deploy into.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  let sw = null, timer = null;
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

  function render() {
    const v = sw, t = v.totals;
    $("#swTargetLbl").textContent = `${v.settings.targets.join(" / ")}%`;
    $("#swCards").innerHTML = `
      <div><span>Invested</span><strong>${amt(t.invested)}</strong></div>
      <div><span>Value now</span><strong>${amt(t.value)}</strong></div>
      <div class="${t.pnl > 0 ? "sw-up" : t.pnl < 0 ? "sw-down" : ""}"><span>Profit / loss</span><strong class="${cls(t.pnl)}">${sg(t.pnl)}</strong><small class="${cls(t.pnlPct)}">${pct(t.pnlPct)}</small></div>
      <div class="${t.takeProfit ? "sw-tp" : ""}"><span>🎯 To book profit</span><strong>${t.takeProfit}</strong>${t.stopHit ? `<small class="avoid">🛑 ${t.stopHit} at stop-loss</small>` : ""}</div>
      <div class="${t.deploy ? "sw-dp" : ""}"><span>💰 Deploy signals</span><strong>${t.deploy}</strong>${t.deployNow ? `<small>up to ${amt(t.deployNow)}</small>` : ""}</div>
      <div><span>Booked so far</span><strong class="${cls(v.realised.pnl)}">${sg(v.realised.pnl)}</strong><small>${v.realised.count} closed trade${v.realised.count === 1 ? "" : "s"}</small></div>
      ${fin(t.cash) ? `<div class="${t.cashShort ? "sw-short" : ""}" title="Buys take from it, sales add to it. Change it in ⚙ Settings."><span>💵 Free cash</span><strong>${amt(t.cash)}</strong><small>${t.cashShort ? `signals need ${amt(t.deployNow)}: short by ${amt(t.cashShort)}` : t.deployNow ? `signals need ${amt(t.deployNow)}` : "for new swing buys"}</small></div>`
        : `<div class="sw-setcash"><span>💵 Free cash</span><button type="button" class="linklike" data-go="cash">Set your swing cash</button><small>to see if you can cover deploy signals</small></div>`}`;
    renderScore(); renderLedger();
    const src = [...new Set([...v.positions, ...v.watch].map(r => r.priceSource).filter(Boolean))];
    $("#swStatus").textContent = `${v.marketOpen ? "Market open" : "Market closed"} · prices from ${src.join(", ") || "—"} · ${new Date(v.checkedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}${t.unpriced ? ` · ${t.unpriced} without a price` : ""}`;
    const order = { "stop-hit": -1, "take-profit": 0, "near-stop": 2.5, deploy: 1, "near-profit": 2, "near-deploy": 3, "deploy-limit": 4, hold: 5 };
    $("#swPosNote").textContent = v.positions.length ? `${v.positions.length} position${v.positions.length === 1 ? "" : "s"} · sorted by signal` : "";
    order.riding = 4.5;
    $("#swRows").innerHTML = v.positions.length ? [...v.positions].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.pnlPct ?? -999) - (a.pnlPct ?? -999)).map(r => {
      const used = r.limit ? Math.min(100, Math.round(r.invested / r.limit * 100)) : null;
      return `<tr class="sw-row ${(SIG[r.status] || [])[1] || ""}" data-id="${esc(r.id)}" data-sym="${esc(r.symbol)}">
        <td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)}${r.exchange === "BSE" ? " · BSE" : ""}</div></td>
        <td class="num">${r.qty}</td><td class="num">${px(r.avgPrice)}</td>
        <td class="num"><b>${px(r.price)}</b>${r.health ? `<div><span class="sw-health ${r.health.state}" title="${esc(r.health.note)}. Trailing stop idea: ₹${r.health.trail} (2 ATR under the price or the 20-day low, whichever is higher).">${{ strong: "▲ Uptrend", pause: "◆ Pausing", caution: "▼ Below 50-DMA", weak: "▼ Below 200-DMA" }[r.health.state]}</span></div>` : ""}${fin(r.dayPct) ? `<div class="ticker ${cls(r.dayPct)}">${pct(r.dayPct)} today</div>` : r.priceSource && !/Kite|Yahoo/.test(r.priceSource) ? `<div class="ticker">${esc(r.priceSource)}</div>` : ""}</td>
        <td class="num">${inr(r.invested)}</td><td class="num">${inr(r.value)}</td>
        <td class="num ${cls(r.pnl)}"><b>${sg(r.pnl)}</b><div>${pct(r.pnlPct)}</div></td>
        <td class="sw-tg">${r.targets.map(t => `<div class="${t.hit ? "hit" : r.nextTarget?.n === t.n ? "next" : ""}${t.done ? " done" : ""}" title="${t.sellQty ? `Plan: sell ${t.sellQty} share${t.sellQty === 1 ? "" : "s"} at T${t.n} (${t.planPct}%), about ${sg(t.profit)} profit` : `No sale planned at T${t.n}`}${t.done ? " · booked" : ""}"><i>T${t.n}</i><span>+${t.pct}%</span><b>${px(t.price)}</b><em>${t.sellQty ? `sell ${t.sellQty}` : "hold"}</em>${t.done ? "✓✓" : t.hit ? "✓" : ""}</div>`).join("")}${r.ownTargets || r.ownPlan ? `<div class="ticker">own ${[r.ownTargets && "targets", r.ownPlan && "plan"].filter(Boolean).join(" + ")}</div>` : ""}${r.sellNow ? `<div class="sw-sellnow">Sell ${r.sellNow} now</div>` : ""}${r.stopLoss ? `<div class="sw-sl${r.status === "stop-hit" ? " hit" : ""}">SL ${px(r.stopLoss)}</div>` : ""}</td>
        <td>${r.limit ? `<div class="fd-w"><span><i style="width:${used}%"></i></span>${used}%</div><div class="ticker">${amt(r.invested)} of ${amt(r.limit)}</div>` : "—"}</td>
        <td>${r.addBelow ? `Add ${amt(r.addAmount)} below ${px(r.addBelow)}<div class="ticker">${fin(r.distanceToAdd) ? `${r.distanceToAdd > 0 ? `${r.distanceToAdd}% away` : "reached"}` : ""}</div>` : r.addAmount ? `Add ${amt(r.addAmount)}` : "—"}</td>
        <td>${sig(r)}</td>
        <td class="sw-acts"><button type="button" class="ghost" data-act="sell" title="Sell / book profit">Sell</button><button type="button" class="ghost" data-act="buy" title="Bought more">Buy</button><button type="button" class="ghost" data-act="lots" title="Buys: dates, quantities and prices">📒</button><button type="button" class="ghost" data-act="edit" title="Edit">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button></td></tr>`;
    }).join("") : `<tr><td colspan="12" class="nw-empty-row">No swing positions yet. <button type="button" class="linklike" data-go="paste">Paste them from your sheet</button> or add one.</td></tr>`;
    $("#swWatchNote").textContent = v.watch.length ? `${v.watch.filter(w => w.status === "deploy").length} at your buy level now` : "";
    $("#swWatchRows").innerHTML = v.watch.length ? [...v.watch].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.distance ?? 999) - (b.distance ?? 999)).map(w => `<tr class="sw-row ${(SIG[w.status] || [])[1] || ""}" data-id="${esc(w.id)}" data-sym="${esc(w.symbol)}">
        <td><div class="company">${esc(w.name)}</div><div class="ticker">${esc(w.symbol)}${w.notes ? ` · ${esc(w.notes)}` : ""}</div>${w.idea ? `<div class="ticker">💡 ${esc(w.idea.label)}${w.stopLoss ? ` · SL ${px(w.stopLoss)}` : ""}${w.idea.t1 ? ` · T1 ${px(w.idea.t1)}` : ""}</div>` : w.stopLoss ? `<div class="ticker">SL ${px(w.stopLoss)}</div>` : ""}</td>
        <td class="num"><b>${px(w.price)}</b>${fin(w.dayPct) ? `<div class="ticker ${cls(w.dayPct)}">${pct(w.dayPct)} today</div>` : ""}</td>
        <td class="num">${w.buyBelow ? px(w.buyBelow) : '<span class="hint">not set</span>'}</td>
        <td class="num">${fin(w.distance) ? (w.distance <= 0 ? '<b class="buy">reached</b>' : `${w.distance}% above`) : "—"}</td>
        <td class="num">${amt(w.amount)}</td><td>${sig(w)}</td>
        <td class="sw-acts"><button type="button" class="ghost" data-act="bought" title="I bought it: move to positions">Bought</button><button type="button" class="ghost" data-act="wedit" title="Edit">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button></td></tr>`).join("")
      : `<tr><td colspan="7" class="nw-empty-row">Add stocks you want to buy on a dip, with the price to buy below and how much to deploy.</td></tr>`;
    $("#swClosedSum").textContent = v.closed.length ? `${v.closed.length} trade${v.closed.length === 1 ? "" : "s"}, ${sg(v.realised.pnl)}` : "none yet";
    $("#swClosedRows").innerHTML = v.closed.map(c => `<tr><td><div class="company">${esc(c.name)}</div><div class="ticker">${esc(c.symbol)}</div></td><td class="num">${c.qty}</td><td class="num">${px(c.buyAvg)}</td><td class="num">${px(c.sellPrice)}</td><td class="num ${cls(c.pnl)}">${sg(c.pnl)} <small>${pct(c.pnlPct)}</small></td><td>${new Date(c.closedAt).toLocaleDateString("en-IN")}</td>
      <td class="sw-acts"><button type="button" class="ghost" data-tact="reopen" data-tid="${esc(c.id)}" title="Closed by mistake: put the ${c.qty} shares back into positions">↩ Reopen</button><button type="button" class="ghost danger-text" data-tact="delete-trade" data-tid="${esc(c.id)}" title="Delete this record only">✕</button></td></tr>`).join("") || `<tr><td colspan="7" class="nw-empty-row">Sells you record appear here with their profit.</td></tr>`;
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
    ${sw.cash?.log?.length ? `<details class="sw-cashlog"><summary>Cash movements</summary><table class="sw-prev"><tbody>${sw.cash.log.map(l => `<tr><td>${new Date(l.at).toLocaleDateString("en-IN")}</td><td>${esc(l.why)}</td><td class="num ${cls(l.amount)}">${l.amount === null ? "" : sg(l.amount)}</td><td class="num">${amt(l.balance)}</td></tr>`).join("")}</tbody></table></details>` : ""}`;
  }
  async function load(quiet = false) {
    try { sw = await api("/api/swing"); render(); }
    catch (e) { if (!quiet) $("#swStatus").textContent = e.message; }
    clearTimeout(timer);
    if (!$("#swingView").hidden) timer = setTimeout(() => load(true), sw?.marketOpen ? 60e3 : 5 * 60e3);
  }
  window.openSwing = () => { if (!sw) { $("#swRows").innerHTML = `<tr><td colspan="12" class="nw-empty-row">Loading live prices…</td></tr>`; $("#swStatus").textContent = "Loading…"; } load(); loadIdeas(); };
  // ---- Swing ideas ----
  let ideas = null, ideasTimer = null, ideasShown = 12;
  async function loadIdeas(scan = false) {
    clearTimeout(ideasTimer);
    try { ideas = await api("/api/swing/ideas" + (scan ? "/scan" : ""), scan ? {} : undefined); renderIdeas(); }
    catch (e) { $("#swIdeasStatus").textContent = e.message; }
    if (!$("#swingView").hidden) ideasTimer = setTimeout(() => loadIdeas(), ideas?.scan?.running ? 6000 : 5 * 60e3);
  }
  function renderIdeas() {
    const x = ideas, sc = x.scan, setup = $("#swIdeasSetup").value, src = $("#swIdeasSrc").value;
    $("#swIdeasStatus").textContent = sc.running ? `Scanning charts… ${sc.done} of ${sc.total}` : sc.pausedUntil ? sc.error : `${sc.scanned} of ${sc.universe} stocks scanned${sc.lastRun ? ` · ${new Date(sc.lastRun).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}${sc.error ? ` · ${sc.error}` : ""}`;
    $("#swIdeasScan").disabled = sc.running;
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
    </article>`).join("") + (more > 0 ? `<button type="button" class="ghost sw-more" data-more>Show ${Math.min(more, 12)} more of ${more}</button>` : "") : `<p class="nw-empty-row">${sc.running ? "Scanning daily charts for setups… ideas appear as stocks are checked." : x.ideas.length ? "No ideas match these filters." : sc.scanned ? "No stock fits a setup today. That happens: no trade is a position too. The scan runs again after tomorrow's close." : "No charts scanned yet. Press Scan now (takes a few minutes for ~200 stocks)."}</p>`;
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
    if (out) { sw = out; render(); ideas.ideas = ideas.ideas.filter(x => x.symbol !== i.symbol); renderIdeas(); window.toast?.(`${i.name} added to your swing positions.`, { kind: "ok" }); }
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
        ${p?.lotCount > 1 ? "" : field("Bought on (for STCG / LTCG)", "boughtOn", p?.openedAt ? p.openedAt.slice(0, 10) : todayIst(), `type="date" max="${todayIst()}"`)}${field("Note", "notes", p?.notes)}</div>`,
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        const s = p ? { symbol: p.symbol, name: p.name, exchange: p.exchange } : await pickStock(box);
        return api("/api/swing/position", { id: p?.id, symbol: s.symbol, name: s.name, exchange: s.exchange, qty: v("qty"), avgPrice: v("avgPrice"), limit: v("limit"), addAmount: v("addAmount"), addBelow: v("addBelow"), targets: v("targets"), stopLoss: v("stopLoss"), bookPlan: v("bookPlan"), boughtOn: box.querySelector("[name=boughtOn]")?.value || undefined, notes: v("notes") });
      }
    });
    if (out) { sw = out; render(); }
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
      bodyHtml: `<div class="nw-form">${field("Quantity", "qty", side === "sell" ? (p.sellNow || p.qty) : "", 'inputmode="numeric" autofocus')}${field("Price (₹)", "price", p.price ?? "", 'inputmode="decimal"')}${dateField(side === "sell" ? "Sold on" : "Bought on")}</div><p class="ui-hint" data-prev></p>`,
      onOpen: box => {
        const upd = () => { const q = Number(box.querySelector("[name=qty]").value), pr = Number(box.querySelector("[name=price]").value); box.querySelector("[data-prev]").textContent = side === "sell" && q > 0 && pr > 0 ? `Profit / loss on this sale: ${sg((pr - p.avgPrice) * q)} (${pct(+((pr / p.avgPrice - 1) * 100).toFixed(2))})` : side === "buy" && q > 0 && pr > 0 ? `New average: ${px(+((p.qty * p.avgPrice + q * pr) / (p.qty + q)).toFixed(2))} on ${p.qty + q} shares` : ""; };
        box.querySelectorAll("input").forEach(i => { i.oninput = upd; }); upd();
      },
      collect: box => api(`/api/swing/${side}`, { id: p.id, qty: box.querySelector("[name=qty]").value, price: box.querySelector("[name=price]").value, date: box.querySelector("[name=date]").value })
    });
    if (out) { sw = out; render(); window.toast?.(side === "sell" ? "Sale recorded." : "Buy recorded.", { kind: "ok", ms: 3000 }); }
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
    if (out) { sw = out; render(); }
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
        ${field("Cash set aside for swing (₹, e.g. 5L; blank = don't track)", "cash", fin(sw.totals.cash) ? sw.totals.cash : "", 'placeholder="e.g. 5L"')}</div>
        <p class="ui-hint">The Targets column shows the price and the shares to sell at each level; you get an alert at T1, T2 and T3. Booking plan examples: <b>33, 33, 34</b> = a third at each target · <b>50, 50</b> = half at T1, the rest at T2 · <b>25, 25</b> = half in two steps, keep the rest as a runner. Cash goes down when you record a buy and up when you record a sale.</p>`,
      collect: box => api("/api/swing/settings", { targets: [0, 1, 2].map(i => box.querySelector(`[name=t${i}]`).value.trim()).filter(Boolean).join(","), bookPlan: box.querySelector("[name=bookPlan]").value, dipPct: box.querySelector("[name=dipPct]").value, riskPct: box.querySelector("[name=riskPct]").value, perTrade: box.querySelector("[name=perTrade]").value, cash: box.querySelector("[name=cash]").value })
    });
    if (out) { sw = out; render(); loadIdeas(); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#swingView")) return;
    $("#viewSwing").onclick = () => setView("swing");
    $("#swAddPos").onclick = () => editPosition();
    $("#swAddWatch").onclick = () => editWatch();
    $("#swPaste").onclick = pasteDialog;
    $("#swSettings").onclick = () => settingsDialog();
    $("#swIdeasScan").onclick = () => loadIdeas(true);
    $("#swIdeasSetup").onchange = $("#swIdeasSrc").onchange = () => { ideasShown = 12; if (ideas) renderIdeas(); };
    $("#swIdeas").addEventListener("click", async e => {
      if (e.target.closest("[data-more]")) { ideasShown += 12; renderIdeas(); return; }
      const b = e.target.closest("[data-idea]"), card = e.target.closest("[data-sym]"); if (!b || !card || !ideas) return;
      const i = ideas.ideas.find(x => x.symbol === card.dataset.sym); if (!i) return;
      b.disabled = true; try { await ideaAction(i, b.dataset.idea); } catch (err) { window.toast?.(err.message, { kind: "error" }); } finally { b.disabled = b.dataset.idea === "watch" && i.watching; }
    });
    $("#swExport").onclick = () => { if (!sw?.realised?.count && !sw?.positions?.length) { window.toast?.("Nothing to export yet.", { kind: "info" }); return; } const a = document.createElement("a"); a.href = "/api/swing/export.xlsx"; a.download = ""; document.body.append(a); a.click(); a.remove(); };
    $("#swRefresh").onclick = async () => { const b = $("#swRefresh"); b.classList.add("is-loading"); await load(); b.classList.remove("is-loading"); };
    $("#swingView").addEventListener("click", async e => {
      if (e.target.closest('[data-go="paste"]')) { pasteDialog(); return; }
      if (e.target.closest('[data-go="cash"]')) { settingsDialog("cash"); return; }
      const tb = e.target.closest("[data-tact]");
      if (tb) {
        const t = sw.closed.find(x => x.id === tb.dataset.tid); if (!t) return;
        const reopen = tb.dataset.tact === "reopen", held = sw.positions.find(x => x.symbol === t.symbol);
        const ok = await window.ui.confirm(reopen
          ? { title: `Reopen ${t.name}?`, message: `The ${t.qty} shares go back into your swing positions at ${px(t.buyAvg)}${held ? ` (added to the ${held.qty} you still hold)` : ""}, and ${sg(t.pnl)} comes off "Booked so far".${fin(sw.totals.cash) ? ` The sale value (${amt(t.qty * t.sellPrice)}) comes back out of your swing cash.` : ""}`, okText: "Reopen" }
          : { title: `Delete this ${t.name} trade?`, message: `${sg(t.pnl)} comes off "Booked so far". Your positions${fin(sw.totals.cash) ? " and swing cash" : ""} do not change. Use Reopen instead if the sale never happened.`, okText: "Delete", danger: true });
        if (ok) { try { sw = await api(`/api/swing/${tb.dataset.tact}`, { id: t.id }); render(); window.toast?.(reopen ? `${t.name} reopened.` : "Trade deleted.", { kind: "ok" }); } catch (err) { window.toast?.(err.message, { kind: "error" }); } }
        return;
      }
      const btn = e.target.closest("[data-act]"), tr = e.target.closest("tr[data-id]"); if (!btn || !tr) return;
      const id = tr.dataset.id, p = sw.positions.find(x => x.id === id), w = sw.watch.find(x => x.id === id), act = btn.dataset.act;
      if (act === "edit") editPosition(p); else if (act === "wedit") editWatch(w); else if (act === "sell" || act === "buy") tradeDialog(p, act); else if (act === "bought") boughtDialog(w); else if (act === "lots") lotsDialog(p);
      else if (act === "del" && await window.ui.confirm({ title: `Remove ${(p || w).name}?`, message: p ? "Only the swing tracking is removed; nothing changes at your broker. Use Sell to record a sale instead." : "It is removed from the swing watchlist.", okText: "Remove", danger: true })) { sw = await api("/api/swing/delete", { id }); render(); }
    });
  });
})();
