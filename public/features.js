// v5 screens: results & dividends calendar (+ Home panel), returns vs index (XIRR), accumulation baskets, my price
// alerts and Telegram digests (Alerts screen), dividends received / forward calendar / share goals (Dividends screen).
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  };
  const fin = Number.isFinite;
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
  const amt = v => !fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : inr(v);
  const sg = v => (!fin(v) ? "—" : `${v >= 0 ? "+" : "−"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`);
  const pct = v => (!fin(v) ? "—" : `${v > 0 ? "+" : ""}${v}%`);
  const cls = v => (v > 0 ? "buy" : v < 0 ? "avoid" : "");
  const day = d => new Date(`${d}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  const when = e => e.days === 0 ? "today" : e.days === 1 ? "tomorrow" : e.days < 0 ? `${-e.days} d ago` : `in ${e.days} days`;
  const ICON = { results: "📊", "board-dividend": "📊", dividend: "💰", bonus: "🎁", split: "🎁", rights: "📌", buyback: "📌", "fund-raise": "📌", demerger: "📌", board: "🗓" };
  const evText = e => e.kind === "dividend" ? `${esc(e.label)}${e.amount ? ` ₹${e.amount} a share` : ""} · ex-date${e.income ? ` · <b>${inr(e.income)}</b> for your ${e.qty} shares` : ""}` : e.kind === "bonus" || e.kind === "split" ? `${esc(e.label)} · ex-date` : `${esc(e.label)}${e.estimate ? " (expected)" : ""}`;
  const whereChip = w => w.map(x => `<span class="ev-where ${x.replace(/\s/g, "-")}">${esc(x)}</span>`).join("");
  window.featureOpen = window.featureOpen || {};

  // ---- Events: Home panel + full calendar ----
  let evData = null, evFilter = "mine";
  async function loadEvents(force = false) { if (!evData || force || Date.now() - evData._at > 10 * 60e3) { evData = await api("/api/events/upcoming"); evData._at = Date.now(); } return evData; }
  async function homeEvents() {
    const el = $("#homeEvents"); if (!el) return;
    try {
      const x = await loadEvents(), list = x.events.filter(e => e.days >= 0 && e.days <= 14 && (e.where.includes("holding") || e.where.includes("swing")));
      el.hidden = !list.length; if (!list.length) return;
      el.innerHTML = `<div class="he-head"><b>📅 Coming up for your stocks</b><button type="button" class="linklike" data-go-events>All events ›</button></div><ul>${list.slice(0, 6).map(e => `<li><span class="he-day">${esc(day(e.date))}</span><span>${ICON[e.kind] || "🗓"} <b>${esc(e.symbol)}</b> ${evText(e)}</span><span class="hint">${when(e)}</span></li>`).join("")}</ul>${list.length > 6 ? `<p class="hint">+${list.length - 6} more in the next two weeks</p>` : ""}`;
      el.querySelector("[data-go-events]").onclick = () => setView("events");
    } catch { el.hidden = true; }
  }
  async function eventsPage(force = false) {
    const body = $("#evBody"); body.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const [x, eod] = await Promise.all([loadEvents(force), api("/api/eod/status").catch(() => null)]);
      const filters = { mine: "Holdings & swing", all: "Everything I track", swing: "Swing only", holding: "Holdings only" };
      $("#evTools").innerHTML = `<label class="hint">Show <select class="ui-input" id="evFilter">${Object.entries(filters).map(([k, l]) => `<option value="${k}"${k === evFilter ? " selected" : ""}>${l}</option>`).join("")}</select></label><button type="button" class="ghost" id="evRefresh">⟳ Check again</button>
        <span class="hint">${x.updatedAt ? `Updated ${new Date(x.updatedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "Not fetched yet"}${x.sources ? ` · corporate actions from ${esc(x.sources.actions)}, results dates from ${esc(x.sources.events)}` : ""}${eod?.lastDay ? ` · NSE daily prices to ${esc(eod.lastDay)}${eod.backfill && eod.running ? ` (filling history ${eod.backfill.done}/${eod.backfill.total})` : ""}` : ""}</span>`;
      $("#evFilter").onchange = e => { evFilter = e.target.value; eventsPage(); };
      $("#evRefresh").onclick = async () => { await api("/api/events/refresh", {}); window.toast?.("Checking NSE for new results dates and corporate actions…", { ms: 3000 }); setTimeout(() => eventsPage(true), 8000); };
      const keep = e => evFilter === "all" || (evFilter === "mine" ? e.where.includes("holding") || e.where.includes("swing") : e.where.includes(evFilter));
      const list = x.events.filter(keep), by = new Map();
      for (const e of list) (by.get(e.date) || by.set(e.date, []).get(e.date)).push(e);
      const income = list.filter(e => e.kind === "dividend" && e.days >= 0).reduce((s, e) => s + (e.income || 0), 0);
      body.innerHTML = list.length ? `${income ? `<p class="ev-income">💰 Dividends due to you in the next 30 days: <b>${inr(income)}</b> (if you hold the shares the day before each ex-date)</p>` : ""}
        <div class="ev-cal">${[...by].map(([d, es]) => `<section class="ev-day${es[0].days < 0 ? " past" : es[0].days === 0 ? " today" : ""}"><h4>${esc(day(d))} <span class="hint">${when(es[0])}</span></h4><ul>${es.map(e => `<li><span class="ev-ico">${ICON[e.kind] || "🗓"}</span><div><b>${esc(e.name)}</b> <span class="ticker">${esc(e.symbol)}</span><div>${evText(e)}</div>${e.detail && e.kind !== "dividend" ? `<div class="hint">${esc(e.detail.slice(0, 160))}</div>` : ""}</div><div class="ev-tags">${whereChip(e.where)}</div></li>`).join("")}</ul></section>`).join("")}</div>
        <p class="vs-fine">Ex-date: you get a dividend if you hold the shares at the end of the day before it (India settles trades the next day, so selling on the ex-date still gets it). Results dates are when the board meets; Yahoo dates are estimates. Swing positions show what to do on the Swing page.</p>`
        : `<div class="fd-empty"><div class="fd-empty-ico">📅</div><h2>Nothing in the next 30 days</h2><p class="hint">${x.updatedAt ? "No results, dividends or bonuses announced for these stocks yet." : "The calendar has not been fetched yet: press Check again."}${(x.errors || []).length ? ` (${esc(x.errors.join("; "))})` : ""}</p></div>`;
    } catch (e) { body.innerHTML = `<p class="avoid">${esc(e.message)}</p>`; }
  }
  window.featureOpen.events = () => eventsPage();

  // ---- Returns vs index ----
  let rtAccount = "all", rtBench = "NIFTY50", rt = null;
  async function returnsPage() {
    const body = $("#rtBody"); body.innerHTML = '<p class="hint">Working out returns…</p>'; $("#rtCards").innerHTML = "";
    try { rt = await api(`/api/returns?account=${encodeURIComponent(rtAccount)}`); } catch (e) { body.innerHTML = `<p class="avoid">${esc(e.message)}</p>`; return; }
    const B = rt.benchmarks, avail = Object.entries(B).filter(([, v]) => v.available);
    if (!B[rtBench]?.available && avail.length) rtBench = avail[0][0];
    $("#rtTools").innerHTML = `${rt.accounts.length > 1 ? `<label class="hint">Account <select class="ui-input" id="rtAcct"><option value="all">All accounts</option>${rt.accounts.map(a => `<option value="${esc(a.id)}"${a.id === rtAccount ? " selected" : ""}>${esc(a.label)}</option>`).join("")}</select></label>` : ""}
      <label class="hint">Compare with <select class="ui-input" id="rtBench">${Object.entries(B).map(([k, v]) => `<option value="${k}"${k === rtBench ? " selected" : ""}${v.available ? "" : " disabled"}>${esc(v.label)}${v.available ? "" : " (no data yet)"}</option>`).join("")}</select></label>`;
    $("#rtAcct") && ($("#rtAcct").onchange = e => { rtAccount = e.target.value; returnsPage(); });
    $("#rtBench").onchange = e => { rtBench = e.target.value; returnsPage(); };
    const T = rt.total, tb = T.bench?.[rtBench], bl = B[rtBench]?.label || "the index";
    const vs = (mine, idx) => fin(mine) && fin(idx?.xirr) ? `<small class="${mine >= idx.xirr ? "buy" : "avoid"}">${mine >= idx.xirr ? "beat" : "behind"} ${bl} by ${Math.abs(Math.round((mine - idx.xirr) * 10) / 10)} pts a year</small>` : idx?.tooShort ? `<small>${bl} history starts ${esc(idx.from)}</small>` : "";
    if (!rt.tradeCount) {
      body.innerHTML = `<div class="fd-empty"><div class="fd-empty-ico">📈</div><h2>Import your tradebook for dated returns</h2><p>XIRR needs the date of every buy and sell. Tax view → <b>Import tradebook</b> (Zerodha Console → Reports → Tradebook, one year at a time). Then this page shows your yearly return next to the index.</p><button type="button" class="primary" data-go-tax>Go to Tax view</button></div>${undatedHtml(rt.undated)}${swingHtml(rt.swing, bl)}`;
      body.querySelector("[data-go-tax]")?.addEventListener("click", () => setView("tax"));
      return;
    }
    $("#rtCards").innerHTML = `
      <div><span>Your return (XIRR) since ${esc(T.from || "")}</span><strong class="${cls(T.xirr)}">${fin(T.xirr) ? `${T.xirr}% a year` : "—"}</strong>${vs(T.xirr, tb)}</div>
      <div><span>Same money in ${esc(bl)}</span><strong>${fin(tb?.xirr) ? `${tb.xirr}% a year` : "—"}</strong><small>${tb?.value ? `would be worth ${amt(tb.value)} today` : ""}</small></div>
      <div><span>Put in · now worth</span><strong>${amt(T.invested)} → ${amt(T.value)}</strong><small>${T.soldFor ? `${amt(T.soldFor)} taken out by sales · ` : ""}${T.dividends ? `${amt(T.dividends)} dividends` : "dividends: none found"}</small></div>
      <div><span>Total gain</span><strong class="${cls(T.gain)}">${sg(T.gain)}</strong><small>value + sales + dividends − buys</small></div>
      ${rt.swing ? `<div><span>⚡ Swing book (XIRR)</span><strong class="${cls(rt.swing.xirr)}">${fin(rt.swing.xirr) ? `${rt.swing.xirr}% a year` : "—"}</strong>${vs(rt.swing.xirr, rt.swing.bench?.[rtBench])}</div>` : ""}`;
    body.innerHTML = `<section class="table-wrap"><table class="rt-table"><thead><tr><th>Stock</th><th>Since</th><th class="num">Put in</th><th class="num">Now / sold</th><th class="num">Dividends</th><th class="num">Gain</th><th class="num">XIRR</th><th class="num">${esc(bl)}</th><th class="num">Difference</th></tr></thead><tbody>
      ${rt.rows.map(r => { const b = r.bench?.[rtBench], d = fin(r.xirr) && fin(b?.xirr) ? Math.round((r.xirr - b.xirr) * 10) / 10 : null; return `<tr${r.open ? "" : ' class="rt-closed"'}><td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)}${r.open ? ` · ${r.qty} held` : " · sold"}</div></td><td>${esc(r.firstBuy)}</td><td class="num">${inr(r.invested)}</td><td class="num">${inr(r.value + r.soldFor)}</td><td class="num">${r.dividends ? inr(r.dividends) : "—"}</td><td class="num ${cls(r.gain)}">${sg(r.gain)}</td><td class="num ${cls(r.xirr)}"><b>${fin(r.xirr) ? `${r.xirr}%` : "—"}</b></td><td class="num">${fin(b?.xirr) ? `${b.xirr}%` : b?.tooShort ? '<span class="hint">n/a</span>' : "—"}</td><td class="num ${cls(d)}">${fin(d) ? `${d > 0 ? "+" : ""}${d} pts` : "—"}</td></tr>`; }).join("")}
      </tbody></table></section>
      ${rt.missingPrice?.length ? `<p class="hint">No current price for ${esc(rt.missingPrice.join(", "))}: left out until a price is available.</p>` : ""}
      ${undatedHtml(rt.undated)}${swingHtml(rt.swing, bl)}
      ${rt.untaggedTrades && rt.accounts.length > 1 ? `<p class="hint">${rt.untaggedTrades} tradebook trades are not linked to an account; per-account figures leave them out. Link them in Tax view.</p>` : ""}
      <p class="vs-fine">XIRR is the yearly return that makes all your buys (money in), sales and dividends (money out) and today's value add up, so the timing of every rupee counts. The index column puts exactly the same amounts in and out of ${esc(bl)} on the same days. Dividends use NSE corporate actions and Yahoo's history × the shares you held the day before each ex-date. Charges and taxes are not included.</p>`;
  }
  const undatedHtml = u => u?.length ? `<details class="rt-undated"><summary>${u.length} holding${u.length === 1 ? "" : "s"} with no dated buys in the tradebook (simple return only)</summary><table class="sw-prev"><tbody>${u.map(h => `<tr><td><b>${esc(h.symbol)}</b></td><td class="num">${h.qty}</td><td class="num">${inr(h.invested)} → ${inr(h.value)}</td><td class="num ${cls(h.gainPct)}">${pct(h.gainPct)}</td></tr>`).join("")}</tbody></table></details>` : "";
  const swingHtml = (s, bl) => s ? `<p class="hint">⚡ Swing book: ${fin(s.xirr) ? `<b>${s.xirr}% a year</b> (XIRR on every swing buy and sale)` : "not enough history yet"}${fin(s.bench?.[rtBench]?.xirr) ? `; the same money in ${esc(bl)}: ${s.bench[rtBench].xirr}% a year` : ""}.</p>` : "";
  window.featureOpen.returns = () => returnsPage();

  // ---- Accumulation baskets ----
  let acc = null;
  async function accPage() {
    try { acc = await api("/api/accumulate"); } catch (e) { $("#accBody").innerHTML = `<p class="avoid">${esc(e.message)}</p>`; return; }
    $("#accNew").onclick = () => basketDialog();
    $("#accBody").innerHTML = acc.baskets.length ? acc.baskets.map(v => basketHtml(v)).join("") : `<div class="fd-empty"><div class="fd-empty-ico">🪴</div><h2>Set up your first basket</h2><p>For example your 20 small caps: ₹20,000 first in each, then add on 10 / 20 / 30 / 40% dips up to ₹1 lakh per stock, with ₹50,000 a month to deploy.</p><button type="button" class="primary" data-acc-new>+ New basket</button></div>`;
    $("#accBody").querySelector("[data-acc-new]")?.addEventListener("click", () => basketDialog());
    $("#accBody").querySelectorAll("[data-acc-edit]").forEach(b => { b.onclick = () => basketDialog(acc.baskets.find(x => x.basket.id === b.dataset.accEdit).basket); });
    $("#accBody").querySelectorAll("[data-acc-del]").forEach(b => { b.onclick = async () => { if (!(await window.ui.confirm({ title: "Delete this basket?", message: "Only the plan is removed; your holdings are not touched.", okText: "Delete", danger: true }))) return; acc = await api("/api/accumulate/delete", { id: b.dataset.accDel }); accPage(); }; });
  }
  function basketHtml(v) {
    const b = v.basket, T = v.totals, P = v.plan;
    const state = r => ({ full: '<span class="buy">✓ target reached</span>', start: `<b class="buy">Start</b>${r.inZone ? " · in buy zone" : ""}`, add: `<b class="buy">Add now</b> · ${r.nextDip}% dip`, wait: r.nextLevel ? `Next add ≤ ${inr(r.nextLevel)} <span class="hint">(${r.distance > 0 ? `${r.distance}% away` : "reached"})</span>` : "—" }[r.state]);
    return `<section class="report-card acc-card"><div class="nw-head"><h3>${esc(b.name)} <span class="hint">${b.symbols.length} stocks · ${inr(b.initial)} first, up to ${inr(b.target)} each · dips ${b.dips.join(" / ")}%</span></h3><span><button type="button" class="ghost" data-acc-edit="${esc(b.id)}">✎ Edit</button><button type="button" class="ghost danger-text" data-acc-del="${esc(b.id)}">✕</button></span></div>
      <section class="metrics"><div><span>Invested</span><strong>${amt(T.invested)}</strong><small>of ${amt(T.target)} target (${T.progress}%)</small></div><div><span>Worth now</span><strong class="${cls(T.value - T.invested)}">${amt(T.value)}</strong><small>${sg(T.value - T.invested)}</small></div><div><span>Not started</span><strong>${T.notStarted}</strong><small>${T.full} at target</small></div><div><span>At an add level now</span><strong class="${T.atAddLevel ? "buy" : ""}">${T.atAddLevel}</strong></div></section>
      <div class="acc-plan"><h4>🛒 This month: ${amt(P.budget)} budget</h4>${P.buys.length ? `<ol>${P.buys.map(x => `<li><b>${esc(x.symbol)}</b> ${x.qty} sh ≈ ${inr(x.amount)} <span class="hint">at ${inr(x.price)} · ${esc(x.why)}</span></li>`).join("")}</ol><p class="hint">${amt(P.spend)} used, ${amt(P.leftover)} left for next month.</p>` : `<p class="hint">Nothing at an add level or in a buy zone right now: keep the cash for the next dip.</p>`}</div>
      <section class="table-wrap"><table class="acc-table"><thead><tr><th>Stock</th><th class="num">Held</th><th class="num">Avg</th><th class="num">Price</th><th style="min-width:160px">Towards target</th><th>Adds</th><th>Next step</th></tr></thead><tbody>${v.rows.map(r => `<tr class="acc-${r.state}"><td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)}${r.verdict ? ` · ${esc(r.verdict)}` : ""}</div></td><td class="num">${r.qty || "—"}</td><td class="num">${r.avgPrice ? inr(r.avgPrice) : "—"}</td><td class="num">${r.price ? inr(r.price) : "—"}${fin(r.gainPct) ? `<div class="ticker ${cls(r.gainPct)}">${pct(r.gainPct)}</div>` : ""}</td><td><div class="fd-w"><span><i style="width:${r.progress}%"></i></span>${r.progress}%</div><div class="ticker">${inr(r.invested)} of ${inr(r.target)}</div></td><td>${r.addsDone}/${r.addsTotal}</td><td>${state(r)}</td></tr>`).join("")}</tbody></table></section></section>`;
  }
  async function basketDialog(b = null) {
    const d = acc?.defaults || {}, lists = acc?.lists || [], accounts = acc?.accounts || [];
    const f = (label, name, val, extra = "") => `<label class="ui-field"><span>${label}</span><input class="ui-input" name="${name}" value="${esc(val ?? "")}" ${extra}></label>`;
    const out = await window.ui.dialog({ title: b ? `Edit ${b.name}` : "New accumulation basket", icon: "🪴", okText: b ? "Save" : "Create", wide: true,
      bodyHtml: `<div class="nw-form">${f("Name", "name", b?.name || d.name)}
        <label class="ui-field"><span>Stocks from</span><select class="ui-input" name="listId"><option value="">The symbols below</option>${lists.map(l => `<option value="${esc(l.id)}"${b?.listId === l.id ? " selected" : ""}>Watchlist: ${esc(l.name)} (${l.count})</option>`).join("")}</select></label>
        <label class="ui-field" style="grid-column:1/-1"><span>NSE symbols (comma or space separated)</span><textarea class="ui-input" name="symbols" rows="3" placeholder="HFCL STLTECH SKYGOLD …">${esc((b?.symbols || []).join(" "))}</textarea></label>
        ${f("First tranche per stock (₹)", "initial", b?.initial ?? d.initial, 'inputmode="numeric"')}${f("Target per stock (₹)", "target", b?.target ?? d.target, 'inputmode="numeric"')}
        ${f("Add on dips of (% under your average)", "dips", (b?.dips || d.dips || []).join(", "))}${f("Monthly budget (₹)", "monthly", b?.monthly ?? d.monthly, 'inputmode="numeric"')}
        ${accounts.length > 1 ? `<label class="ui-field"><span>Holdings from</span><select class="ui-input" name="account"><option value="all">All accounts</option>${accounts.map(a => `<option value="${esc(a.id)}"${b?.account === a.id ? " selected" : ""}>${esc(a.label)}</option>`).join("")}</select></label>` : ""}</div>
        <p class="ui-hint">The money between the first tranche and the target is split evenly over the dip levels. Each add level is measured from your average price at the time.</p>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`)?.value; return api("/api/accumulate/save", { id: b?.id, name: v("name"), listId: v("listId") || null, symbols: v("symbols"), initial: v("initial"), target: v("target"), dips: v("dips"), monthly: v("monthly"), account: v("account") || "all" }); } });
    if (out) { acc = out; accPage(); }
  }
  window.featureOpen.accumulate = () => accPage();

  // ---- My price alerts (Alerts screen) + digests ----
  let rules = null;
  async function rulesPanel() {
    const body = $("#rlBody"); if (!body) return;
    try { rules = await api("/api/rules"); } catch (e) { body.innerHTML = `<p class="avoid">${esc(e.message)}</p>`; return; }
    const T = rules.types;
    $("#rlSum").textContent = rules.rules.length ? `${rules.rules.filter(r => r.active).length} on · ${rules.rules.length} in all` : "none yet";
    body.innerHTML = `<form class="rl-form" id="rlForm"><input class="ui-input" name="symbol" placeholder="NSE symbol, e.g. INFY" required maxlength="20" autocomplete="off">
        <select class="ui-input" name="type">${Object.entries(T).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join("")}</select>
        <input class="ui-input" name="value" placeholder="₹ level" inputmode="decimal" maxlength="12">
        <select class="ui-input" name="repeat"><option value="once">Once</option><option value="daily">Every day it happens</option></select>
        <input class="ui-input" name="note" placeholder="Note (optional)" maxlength="120"><button type="submit" class="primary">+ Add alert</button></form>
      ${rules.rules.length ? `<ul class="rl-list">${rules.rules.map(r => `<li class="${r.active ? "" : "off"}"><label class="rl-tog" title="${r.active ? "On" : "Off"}"><input type="checkbox" data-rl-tog="${esc(r.id)}"${r.active ? " checked" : ""}><span></span></label><div><b>${esc(r.symbol)}</b> ${esc(r.text)}${r.note ? ` <span class="hint">· ${esc(r.note)}</span>` : ""}<div class="hint">${r.repeat === "daily" ? "every day it happens" : "once"}${r.lastFired ? ` · last fired ${new Date(r.lastFired).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}${T[r.type]?.eod && !T[r.type]?.live ? " · checked on the daily close" : ""}</div></div><button type="button" class="ghost danger-text" data-rl-del="${esc(r.id)}" title="Delete">✕</button></li>`).join("")}</ul>` : `<p class="hint">Price levels and moves are checked on every live price; volume, golden cross and 200-day rules on NSE's daily close (after 6 pm). Alerts appear here, in the browser and on Telegram.</p>`}
      <div class="toolbar" style="margin-top:10px"><button type="button" class="ghost" id="rlDigest">☀️🌙 Daily Telegram digests…</button></div>`;
    const form = $("#rlForm"), typeSel = form.querySelector("[name=type]"), val = form.querySelector("[name=value]");
    const sync = () => { const u = T[typeSel.value]?.unit; val.hidden = !u; val.placeholder = u === "₹" ? "₹ level" : u === "%" ? "% move, e.g. 4" : u === "×" ? "× volume, e.g. 3" : ""; }; typeSel.onchange = sync; sync();
    form.onsubmit = async e => { e.preventDefault(); const v = n => form.querySelector(`[name=${n}]`).value; try { rules = await api("/api/rules/save", { symbol: v("symbol"), type: v("type"), value: val.hidden ? null : v("value"), repeat: v("repeat"), note: v("note") }); window.toast?.("Alert added.", { kind: "ok", ms: 2500 }); rulesPanel(); } catch (err) { window.toast?.(err.message, { kind: "error" }); } };
    body.querySelectorAll("[data-rl-tog]").forEach(c => { c.onchange = async () => { await api("/api/rules/toggle", { id: c.dataset.rlTog, active: c.checked }); rulesPanel(); }; });
    body.querySelectorAll("[data-rl-del]").forEach(b => { b.onclick = async () => { await api("/api/rules/delete", { id: b.dataset.rlDel }); rulesPanel(); }; });
    $("#rlDigest").onclick = digestDialog;
  }
  async function digestDialog() {
    let st = {}; try { st = await api("/api/notify"); } catch {}
    const tg = st.telegram || {}, dg = st.digest || {};
    await window.ui.dialog({ title: "Daily Telegram digests", icon: "☀️", okText: "Save", wide: true,
      message: tg.connected ? `Sent to @${tg.bot} → ${tg.chat} on weekdays.` : "Connect Telegram first (📱 Phone alerts above), then switch these on.",
      bodyHtml: `<label class="ui-opt"><input type="checkbox" name="morning"${dg.morning ? " checked" : ""}><span><b>☀️ Morning brief, 9:00 am</b><small>Swing positions to book or watch, trailing stops raised, cash to deploy, holdings and watchlist stocks in the buy zone, big moves, order wins for your stocks, results and dividend dates this week.</small></span></label>
        <label class="ui-opt"><input type="checkbox" name="evening"${dg.evening ? " checked" : ""}><span><b>🌙 Evening, 4:00 pm</b><small>Today's P/L on swing and holdings, biggest movers, trades booked, alerts that fired, top new swing ideas, what's coming up.</small></span></label>
        <div class="toolbar"><button type="button" class="ghost" data-pv="morning">Preview morning</button><button type="button" class="ghost" data-pv="evening">Preview evening</button>${tg.connected ? '<button type="button" class="ghost" data-send="morning">Send morning now</button>' : ""}</div><pre class="dg-preview" data-out hidden></pre>`,
      onOpen: (box, { setError }) => {
        const out = box.querySelector("[data-out]");
        const show = html => { out.hidden = false; out.innerHTML = html.replace(/<a [^>]*>(.*?)<\/a>/g, "$1"); };
        box.querySelectorAll("[data-pv]").forEach(b => { b.onclick = async () => { try { show((await api(`/api/digest/preview?kind=${b.dataset.pv}`)).html); } catch (e) { setError(e.message); } }; });
        box.querySelectorAll("[data-send]").forEach(b => { b.onclick = async () => { try { await api("/api/notify/digest-test", { kind: b.dataset.send }); window.toast?.("Sent. Check Telegram.", { kind: "ok" }); } catch (e) { setError(e.message); } }; });
      },
      collect: box => api("/api/notify/digest", { morning: box.querySelector("[name=morning]").checked, evening: box.querySelector("[name=evening]").checked })
    });
  }

  // ---- Dividends received, next 12 months, share goals (Dividends screen) ----
  let dvAccount = "all";
  async function dividendIncome() {
    const el = $("#dvReceived"); if (!el) return;
    let x; try { x = await api(`/api/dividend-income?account=${encodeURIComponent(dvAccount)}`); } catch (e) { el.innerHTML = `<p class="avoid">${esc(e.message)}</p>`; return; }
    const R = x.received, F = x.forward, maxM = Math.max(1, ...F.months.map(m => m.income));
    el.innerHTML = `<section class="report-card"><div class="nw-head"><h3>💰 Dividends you received and what's next</h3>${x.accounts.length > 1 ? `<select class="ui-input" id="dvAcct"><option value="all">All accounts</option>${x.accounts.map(a => `<option value="${esc(a.id)}"${a.id === dvAccount ? " selected" : ""}>${esc(a.label)}</option>`).join("")}</select>` : ""}</div>
      <section class="metrics"><div><span>Last 12 months</span><strong>${inr(R.last12Total)}</strong><small>${R.last12.length} payout${R.last12.length === 1 ? "" : "s"}${R.approx ? " · some estimated from today's holdings" : ""}</small></div><div><span>This financial year (since ${esc(R.fyFrom)})</span><strong>${inr(R.fyTotal)}</strong></div><div><span>Next 12 months (expected)</span><strong class="buy">${inr(F.total)}</strong><small>announced + last year's pattern × shares held now</small></div><div><span>A month on average</span><strong>${inr(F.total / 12)}</strong></div></section>
      ${F.months.length ? `<div class="dv-months" role="img" aria-label="Expected dividends by month">${F.months.map(m => `<div title="${esc(m.month)}: ${inr(m.income)}${m.sure ? ` (${inr(m.sure)} announced)` : ""}\n${m.items.map(i => `${i.symbol} ${inr(i.income)}`).join("\n")}"><b>${m.income >= 1000 ? `${Math.round(m.income / 100) / 10}k` : Math.round(m.income)}</b><i style="height:${Math.max(4, Math.round(m.income / maxM * 70))}px"${m.sure ? ' class="sure"' : ""}></i><span>${new Date(`${m.month}-01`).toLocaleDateString("en-IN", { month: "short" })}</span></div>`).join("")}</div>` : ""}
      <div class="dv-cols"><div><h4>Received (last 12 months)</h4>${R.last12.length ? `<table class="sw-prev"><tbody>${R.last12.slice(0, 12).map(d => `<tr><td>${esc(d.exDate)}</td><td><b>${esc(d.symbol)}</b></td><td class="num">₹${d.amount} × ${d.qty}${d.approx ? "*" : ""}</td><td class="num"><b>${inr(d.income)}</b></td></tr>`).join("")}</tbody></table>${R.approx ? '<p class="hint">* shares held today (no tradebook for that stock)</p>' : ""}` : '<p class="hint">No dividends found for your holdings in the last 12 months.</p>'}</div>
        <div><h4>Biggest payers, next 12 months</h4>${F.rows.length ? `<table class="sw-prev"><tbody>${F.rows.slice(0, 10).map(r => `<tr><td><b>${esc(r.symbol)}</b></td><td class="num">₹${r.perShareYear}/sh × ${r.qty}</td><td class="num">${fin(r.yieldPct) ? `${r.yieldPct}%` : ""}</td><td class="num"><b>${inr(r.income)}</b></td></tr>`).join("")}</tbody></table>` : '<p class="hint">Sync your holdings to see this.</p>'}</div></div>
      <div class="dv-goals"><div class="nw-head"><h4>🎯 Share goals</h4><button type="button" class="ghost" id="dvGoalEdit">✎ Edit goals</button></div>${x.goals.length ? x.goals.map(g => `<div class="dv-goal"><div><b>${esc(g.symbol)}</b> <span class="hint">${g.market === "US" ? "US" : "India"}${g.note ? ` · ${esc(g.note)}` : ""}</span></div><div class="fd-w"><span><i style="width:${g.pct}%"></i></span>${g.pct}%</div><div class="hint">${g.have} of ${g.target} shares${g.held !== null ? " (from your holdings)" : g.current === null ? " (enter how many you have)" : ""}${g.left ? ` · ${g.left} to go` : " · reached 🎉"}</div></div>`).join("") : '<p class="hint">Set a target number of shares, for example 400 SCHD, and track it here.</p>'}</div></section>`;
    $("#dvAcct") && ($("#dvAcct").onchange = e => { dvAccount = e.target.value; dividendIncome(); });
    $("#dvGoalEdit").onclick = () => goalsDialog(x.goals);
  }
  async function goalsDialog(goals) {
    const row = (g = {}) => `<div class="dg-row"><input class="ui-input" name="gs" placeholder="Symbol (e.g. SCHD)" value="${esc(g.symbol || "")}"><select class="ui-input" name="gm"><option value="US"${g.market === "US" ? " selected" : ""}>US</option><option value="IN"${g.market === "IN" ? " selected" : ""}>India</option></select><input class="ui-input" name="gt" placeholder="Target shares" inputmode="numeric" value="${esc(g.target ?? "")}"><input class="ui-input" name="gc" placeholder="Have now (US)" inputmode="decimal" value="${esc(g.current ?? "")}"><input class="ui-input" name="gn" placeholder="Note" value="${esc(g.note || "")}"></div>`;
    const out = await window.ui.dialog({ title: "Share goals", icon: "🎯", okText: "Save", wide: true, message: "Indian stocks count the shares in your synced holdings; for US stocks enter how many you have.",
      bodyHtml: `<div data-rows>${(goals.length ? goals : [{ symbol: "SCHD", market: "US", target: 400 }]).map(row).join("")}</div><button type="button" class="ghost" data-add>+ Another goal</button>`,
      onOpen: box => { box.querySelector("[data-add]").onclick = () => box.querySelector("[data-rows]").insertAdjacentHTML("beforeend", row()); },
      collect: box => api("/api/share-goals", { goals: [...box.querySelectorAll(".dg-row")].map(r => ({ symbol: r.querySelector("[name=gs]").value, market: r.querySelector("[name=gm]").value, target: r.querySelector("[name=gt]").value, current: r.querySelector("[name=gc]").value === "" ? null : r.querySelector("[name=gc]").value, note: r.querySelector("[name=gn]").value })).filter(g => g.symbol.trim()) }) });
    if (out) dividendIncome();
  }

  // ---- wiring ----
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-goto]").forEach(b => { b.onclick = () => setView(b.dataset.goto); });
    const wrap = (name, fn) => { const orig = window[name]; window[name] = function () { const r = orig?.apply(this, arguments); try { fn(); } catch (e) { console.warn(e); } return r; }; };
    wrap("openAlerts", rulesPanel); wrap("openDividends", dividendIncome); wrap("openHome", homeEvents);
    homeEvents(); setInterval(() => { if (!$("#homeView")?.hidden) homeEvents(); }, 30 * 60e3);
    window.addEventListener("prices:alert", () => { if (!$("#alertsView")?.hidden) rulesPanel(); });
    const v = decodeURIComponent(location.hash.slice(1)); if (window.featureOpen[v]) setView(v); // deep link (#returns, #events, #accumulate)
  });
})();
