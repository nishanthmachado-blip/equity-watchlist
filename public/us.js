// US stocks tab: your US list or a popular large-cap universe, screens, and a detail sheet with a growth override.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  let data = null, list = "mine", screen = "all", sort = { k: "upside", dir: -1 }, poll = null, sheet = null;
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok && r.status !== 202) throw new Error(j.message || `HTTP ${r.status}`); return Object.assign(j, { _status: r.status });
  };
  const usd = v => Number.isFinite(v) ? `$${v >= 1000 ? Math.round(v).toLocaleString("en-US") : v.toFixed(2)}` : "—";
  const big = v => !Number.isFinite(v) ? "—" : Math.abs(v) >= 1e12 ? `$${(v / 1e12).toFixed(2)} T` : Math.abs(v) >= 1e9 ? `$${(v / 1e9).toFixed(1)} B` : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)} M` : usd(v);
  const pct = (v, plus = false) => Number.isFinite(v) ? `${plus && v > 0 ? "+" : ""}${v}%` : "—";
  const SCREENS = [
    ["all", "All", () => true],
    ["under", "Undervalued", r => r.ratio !== null && r.ratio <= 0.9],
    ["quality", "Quality compounders", r => r.quality >= 70 && (r.roic ?? r.roe ?? 0) >= 15 && (r.revG ?? 0) >= 5],
    ["growth", "High growth", r => (r.revG ?? 0) >= 15 && (r.epsG ?? 0) >= 15],
    ["dividend", "Dividend payers", r => (r.divYield ?? 0) >= 2 && (r.payout ?? 100) < 75],
    ["value", "Low P/E value", r => r.pe > 0 && r.pe < 16 && (r.epsG ?? 0) >= 0]
  ];
  const valued = r => !r.pending && !r.error && r.verdict;
  function render() {
    if (!data) return;
    $("#usList").querySelectorAll("button").forEach(b => b.classList.toggle("active", b.dataset.list === list));
    const rowsAll = data.rows, ok = rowsAll.filter(valued);
    $("#usScreens").innerHTML = SCREENS.map(([k, l, f]) => `<button type="button" class="pf-chip${screen === k ? " active" : ""}" data-screen="${k}">${l}<b>${ok.filter(f).length}</b></button>`).join("");
    const f = SCREENS.find(x => x[0] === screen)[2];
    const shown = (screen === "all" ? rowsAll : ok.filter(f)).slice().sort((a, b) => { const x = a[sort.k], y = b[sort.k]; if (!Number.isFinite(x) && !Number.isFinite(y)) return String(a.symbol).localeCompare(b.symbol); if (!Number.isFinite(x)) return 1; if (!Number.isFinite(y)) return -1; return (x - y) * sort.dir; });
    const st = [];
    if (data.pending) st.push(`Fetching SEC filings for ${data.pending} stock${data.pending === 1 ? "" : "s"}…`);
    if (data.secError) st.push(`SEC: ${data.secError}`);
    if (data.priceErrors?.length && !rowsAll.some(r => r.price)) st.push(`Prices unavailable (${data.priceErrors[0]})`);
    $("#usStatus").textContent = st.join(" · ");
    $("#usRows").innerHTML = shown.length ? shown.map(r => {
      if (!valued(r)) return `<tr data-sym="${esc(r.symbol)}" class="us-pending"><td><div class="company">${esc(r.name || r.symbol)}</div><div class="ticker">${esc(r.symbol)}</div></td><td class="num">${usd(r.price)}</td><td colspan="11" class="hint">${r.pending ? "⏳ reading SEC filings…" : `⚠ ${esc(r.error || "no data")}`}</td></tr>`;
      return `<tr data-sym="${esc(r.symbol)}"><td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)} · ${big(r.marketCap)} · FY${r.asOfFy}</div></td>
        <td class="num">${usd(r.price)}</td><td class="num">${r.pe ?? "—"}${r.fairPE ? `<div class="ticker">fair ${r.fairPE}</div>` : ""}</td><td class="num">${usd(r.fairValue)}</td>
        <td class="num ${r.upside > 0 ? "buy" : r.upside < 0 ? "avoid" : ""}">${pct(r.upside, true)}</td><td><span class="chip ${esc(r.verdict.cls)}">${esc(r.verdict.label)}</span></td>
        <td class="num">${pct(r.revG)}</td><td class="num">${pct(r.epsG)}</td><td class="num">${pct(r.roic ?? r.roe)}${r.roic === null && r.roe !== null ? '<div class="ticker">ROE</div>' : ""}</td><td class="num">${pct(r.netMargin)}</td><td class="num">${r.de ?? "—"}</td><td class="num">${pct(r.divYield)}</td>
        <td>${r.tags.map(t => `<span class="chip v-none">${esc(t)}</span>`).join(" ")}</td></tr>`;
    }).join("") : `<tr><td colspan="13" class="nw-empty-row">${list === "mine" && !data.mine.length ? `Your US list is empty. Search above to add stocks, or switch to <button type="button" class="linklike" data-list="popular">Popular large caps</button>.` : "No stocks match this screen."}</td></tr>`;
    document.querySelectorAll(".us-table th[data-k]").forEach(th => th.classList.toggle("sorted", th.dataset.k === sort.k));
    clearTimeout(poll); if (data.pending && !$("#usView").hidden) poll = setTimeout(load, 4000);
  }
  async function load() { try { data = await api(`/api/us?list=${list}`); render(); } catch (e) { $("#usStatus").textContent = e.message; } }
  window.openUs = () => { load(); loadHold(); };

  // ---- my US holdings (INDmoney sync, Vested / broker statements, by hand) ----
  let hold = null;
  const fin = Number.isFinite;
  const inr = v => !fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`;
  const sgn = (v, f) => !fin(v) ? "—" : `${v >= 0 ? "+" : "−"}${f(Math.abs(v))}`;
  const usd2 = v => fin(v) ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
  const pl = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const fileB64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => bad(new Error("Could not read the file.")); r.readAsDataURL(f); });
  async function loadHold() { try { hold = await api("/api/us/holdings"); renderHold(); } catch (e) { $("#usHoldStatus").textContent = e.message; } }
  // broker tab, filters and sort (like My holdings), remembered in this browser
  const US_DEF = { acct: "all", pl: "all", inv: "0", pct: "", abs: "", sort: "value", dir: -1, q: "", cur: "inr" };
  let usOpt = (() => { try { return { ...US_DEF, ...JSON.parse(localStorage.getItem("us-opt") || "{}"), q: "" }; } catch { return { ...US_DEF }; } })();
  const usSave = () => { try { localStorage.setItem("us-opt", JSON.stringify({ ...usOpt, q: "" })); } catch { /* private mode */ } };
  const band = (spec, x) => { if (!spec) return true; if (!fin(x)) return false; const [lo, hi] = spec.split(":"); return (lo === "" || x >= Number(lo)) && (hi === "" || hi === undefined || x < Number(hi)); };
  // ₹ / $ toggle: every amount (cards, broker comparison, table, chips, filters) in the chosen currency, the other one
  // underneath. In $ a rupee-only cost (INDmoney sync) or a synced-only value is converted at today's rate (marked ≈).
  const isUsd = () => usOpt.cur === "usd";
  const M = r => {
    if (!isUsd()) return { value: r.valueInr, invested: r.investedInr, pnl: r.pnlInr, approx: false };
    const f = hold?.fx || null;
    const value = fin(r.valueUsd) ? r.valueUsd : fin(r.valueInr) && f ? r.valueInr / f : null;
    const invested = fin(r.investedUsd) ? r.investedUsd : fin(r.investedInr) && f ? r.investedInr / f : null;
    return { value, invested, pnl: fin(value) && fin(invested) ? value - invested : null, approx: (!fin(r.investedUsd) && fin(invested)) || (!fin(r.valueUsd) && fin(value)) };
  };
  const usd0 = v => !fin(v) ? "—" : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)} M` : `$${Math.round(v).toLocaleString("en-US")}`;
  const money = v => (isUsd() ? usd0(v) : inr(v)), moneyRow = v => (isUsd() ? usd2(v) : inr(v)), other = (usdV, inrV) => (isUsd() ? (fin(inrV) ? inr(inrV) : "") : (fin(usdV) ? usd2(usdV) : ""));
  const agg = rs => { const pr = rs.map(M).filter(m => fin(m.value) && fin(m.invested)), inv = pr.reduce((a, m) => a + m.invested, 0), val = pr.reduce((a, m) => a + m.value, 0); return { inv, val, pnl: val - inv, pct: inv > 0 ? Math.round((val / inv - 1) * 1000) / 10 : null, approx: rs.map(M).some(m => m.approx) }; };
  const pctInr = r => { const m = M(r); return fin(m.value) && m.invested > 0 ? (m.value / m.invested - 1) * 100 : isUsd() ? null : r.pnlPct ?? null; };
  const CUR_OPTS = {
    inr: { inv: [["0", "Any"], ["25000", "₹25 K+"], ["50000", "₹50 K+"], ["100000", "₹1 L+"], ["300000", "₹3 L+"], ["500000", "₹5 L+"], ["-50000", "Under ₹50 K"]], abs: [["", "Any"], ["100000:", "+₹1 L or more"], ["25000:", "+₹25 K or more"], [":-25000", "−₹25 K or worse"], [":-100000", "−₹1 L or worse"]] },
    usd: { inv: [["0", "Any"], ["500", "$500+"], ["1000", "$1K+"], ["2500", "$2.5K+"], ["5000", "$5K+"], ["10000", "$10K+"], ["-1000", "Under $1K"]], abs: [["", "Any"], ["1000:", "+$1K or more"], ["250:", "+$250 or more"], [":-250", "−$250 or worse"], [":-1000", "−$1K or worse"]] } };
  function curControls() {
    const o = CUR_OPTS[isUsd() ? "usd" : "inr"], sym = isUsd() ? "$" : "₹";
    for (const [id, list] of [["#usInv", o.inv], ["#usAbs", o.abs]]) { const el = $(id); if (el.dataset.cur !== usOpt.cur) { el.innerHTML = list.map(([v, l]) => `<option value="${v}">${l}</option>`).join(""); el.dataset.cur = usOpt.cur; } }
    $("#usAbs").closest("label").firstChild.textContent = `P/L ${sym}`;
    const po = $("#usSort").querySelector('option[value="pnl"]'); if (po) po.textContent = `P/L ${sym}`;
    $("#usCur").querySelectorAll("[data-cur]").forEach(b => b.classList.toggle("active", b.dataset.cur === usOpt.cur));
  }
  const xp = x => (fin(x) ? `<span class="${pl(x)}">${x > 0 ? "+" : ""}${x}%</span>` : "—");
  function renderHold() {
    const v = hold; if (!v) return;
    curControls();
    const accts = v.accounts || [];
    if (usOpt.acct !== "all" && !accts.some(a => a.key === usOpt.acct)) usOpt.acct = "all";
    const S = usOpt.acct === "all" ? v.all : accts.find(a => a.key === usOpt.acct);
    const inAcct = v.rows.filter(r => usOpt.acct === "all" || r.accountKey === usOpt.acct);
    $("#usHoldNote").textContent = v.fx ? `$1 = ₹${v.fx}` : v.rows.length ? "USD/INR rate not available yet" : "";
    const A = agg(inAcct), approxNote = isUsd() && A.approx ? " · ≈ some at today's rate" : "";
    // broker tabs
    $("#usAccTabs").innerHTML = accts.length > 1 ? [`<button type="button" class="viewTab${usOpt.acct === "all" ? " active" : ""}" data-acct="all">All brokers <span class="tab-badge">${v.rows.length}</span></button>`, ...accts.map(a => `<button type="button" class="viewTab${usOpt.acct === a.key ? " active" : ""}" data-acct="${esc(a.key)}">${esc(a.account)} <span class="tab-badge">${a.count}</span></button>`)].join("") : "";
    // cards for the chosen broker (or all)
    $("#usHoldCards").innerHTML = S && S.count ? [["Invested", money(A.inv), isUsd() ? `${inr(S.investedInr)} as paid in ₹${approxNote}` : S.investedUsd > 0 ? usd2(S.investedUsd) : "", ""], ["Current value", money(A.val), isUsd() ? inr(S.valueInr) : S.valueUsd > 0 ? usd2(S.valueUsd) : "", ""], ["P/L", sgn(A.pnl, money), fin(A.pct) ? `${A.pct > 0 ? "+" : ""}${A.pct}% on cost${isUsd() ? " in $" : ""}` : "", pl(A.pnl)], ["XIRR (a year)", fin(S.xirr) ? `${S.xirr > 0 ? "+" : ""}${S.xirr}%` : "—", S.dated ? `${S.dated < S.count ? `${S.dated} of ${S.count} holdings have a buy date` : "from your buy dates"}${isUsd() ? " · in ₹ terms" : ""}` : "add buy dates (📅) to see it", pl(S.xirr)]]
      .map(([k, a, b, c]) => `<div class="metric"><span>${k}</span><strong class="${c}">${a}</strong><small class="hint">${b}</small></div>`).join("") : "";
    // which broker is doing better
    if (accts.length > 1) {
      const best = (k) => { const ok = accts.map(a => (k === "pnlPct" && isUsd() ? { ...a, pnlPct: agg(v.rows.filter(r => r.accountKey === a.key)).pct } : a)).filter(a => fin(a[k])); return ok.length > 1 ? ok.reduce((m, a) => (a[k] > m[k] ? a : m)).key : null; };
      const bp = best("pnlPct"), bx = best("xirr");
      $("#usCompare").innerHTML = `<table class="us-cmp"><thead><tr><th>Broker</th><th class="num">Holdings</th><th class="num">Invested</th><th class="num">Value now</th><th class="num">P/L</th><th class="num">P/L %</th><th class="num">XIRR</th></tr></thead><tbody>${accts.map(a => { const g = agg(v.rows.filter(r => r.accountKey === a.key)); return `<tr data-acct="${esc(a.key)}" class="${usOpt.acct === a.key ? "on" : ""}"><td><b>${esc(a.account)}</b><div class="ticker">${a.source === "sync" ? "synced" : "imported"}</div></td><td class="num">${a.count}</td><td class="num">${money(g.inv)}</td><td class="num">${money(g.val)}</td><td class="num ${pl(g.pnl)}">${sgn(g.pnl, money)}</td><td class="num">${xp(isUsd() ? g.pct : a.pnlPct)}${a.key === bp ? ' <span class="us-best">best</span>' : ""}</td><td class="num">${xp(a.xirr)}${a.key === bx ? ' <span class="us-best">best</span>' : ""}${fin(a.xirr) && a.dated < a.count ? `<div class="ticker">${a.dated}/${a.count} dated</div>` : ""}</td></tr>`; }).join("")}</tbody></table><p class="hint">P/L % compares what you made on what you put in${isUsd() ? " (in $: the stocks alone, without the rupee's move)" : " (in ₹: includes the rupee's move against the dollar)"}; XIRR (in ₹ terms) also counts how long the money was invested (needs buy dates). Click a broker to see only its holdings.</p>`;
    } else $("#usCompare").innerHTML = "";
    // filters, sort
    const q = usOpt.q.trim().toLowerCase(), inv = Number(usOpt.inv), totalVal = inAcct.reduce((a, r) => a + (M(r).value || 0), 0);
    const shown = inAcct.filter(r => {
      const m = M(r);
      if (usOpt.pl === "profit" && !(m.pnl > 0)) return false;
      if (usOpt.pl === "loss" && !(m.pnl < 0)) return false;
      const iv = m.invested || 0; if (inv > 0 && iv < inv) return false; if (inv < 0 && iv >= -inv) return false;
      if (!band(usOpt.pct, pctInr(r)) || !band(usOpt.abs, m.pnl)) return false;
      return !q || `${r.symbol || ""} ${r.name || ""}`.toLowerCase().includes(q);
    });
    const key = { value: r => M(r).value, invested: r => M(r).invested, pnl: r => M(r).pnl, pnlPct: pctInr, xirr: r => r.xirr, day: r => r.dayPct, weight: r => M(r).value, name: r => String(r.name || r.symbol || "").toLowerCase() }[usOpt.sort] || (r => r.valueInr);
    shown.sort((a, b) => { const x = key(a), y = key(b); if (typeof x === "string" || typeof y === "string") return String(x).localeCompare(String(y)) * (usOpt.dir > 0 ? 1 : -1); if (!fin(x) && !fin(y)) return 0; if (!fin(x)) return 1; if (!fin(y)) return -1; return (x - y) * (usOpt.dir > 0 ? 1 : -1); });
    $("#usPl").querySelectorAll("[data-pl]").forEach(b => { b.classList.toggle("active", b.dataset.pl === usOpt.pl); const n = b.dataset.pl === "all" ? inAcct.length : inAcct.filter(r => (b.dataset.pl === "profit" ? M(r).pnl > 0 : M(r).pnl < 0)).length; b.innerHTML = `${{ all: "All", profit: "In profit", loss: "In loss" }[b.dataset.pl]} <b>${n}</b>`; });
    $("#usInv").value = usOpt.inv; $("#usPct").value = usOpt.pct; $("#usAbs").value = usOpt.abs; $("#usSort").value = usOpt.sort;
    $("#usDir").textContent = usOpt.sort === "name" ? (usOpt.dir > 0 ? "A to Z" : "Z to A") : usOpt.dir > 0 ? "↑ Low to high" : "↓ High to low";
    const filtered = usOpt.pl !== "all" || usOpt.inv !== "0" || usOpt.pct || usOpt.abs || q; $("#usReset").hidden = !filtered;
    { const g = agg(shown), sInv = g.inv, sVal = g.val, sPl = g.pnl;
      $("#usSum").innerHTML = inAcct.length ? `${filtered ? `Showing <b>${shown.length}</b> of ${inAcct.length}` : `<b>${shown.length}</b> holdings`}${usOpt.acct !== "all" ? ` in ${esc(S?.account || "")}` : ""} · invested ${money(sInv)} · now ${money(sVal)} · <span class="${pl(sPl)}">${sgn(sPl, money)}${sInv > 0 ? ` (${(sPl / sInv * 100).toFixed(1)}%)` : ""}</span>${filtered && totalVal > 0 ? ` · ${(sVal / totalVal * 100).toFixed(1)}% of these holdings` : ""}` : ""; }
    $("#usHoldRows").innerHTML = shown.length ? shown.map(r => `<tr data-hid="${esc(r.id || "")}" data-key="${esc(r.key)}">
      <td><div class="company">${esc(r.name || r.symbol || "")}</div><div class="ticker">${esc(r.symbol || "no ticker")}${fin(r.dayPct) ? ` · <span class="${pl(r.dayPct)}">${r.dayPct > 0 ? "+" : ""}${r.dayPct}% today</span>` : ""}${r.boughtOn ? ` · since ${esc(r.boughtOn)}` : ""}</div></td>
      <td class="num">${fin(r.qty) ? r.qty : "—"}</td><td class="num">${usd2(r.avgUsd)}</td>
      <td class="num"><b>${usd2(r.price)}</b>${r.stale ? '<div class="ticker">synced value</div>' : ""}</td>
      ${(m => `<td class="num">${m.approx && !fin(r.investedUsd) ? "≈ " : ""}${moneyRow(m.invested)}<div class="ticker">${other(r.investedUsd, r.investedInr)}${!isUsd() && r.investedInrAtToday ? " · at today's ₹" : ""}${isUsd() && !fin(r.investedUsd) && fin(m.invested) ? " paid · at today's $" : ""}</div></td>
      <td class="num"><b>${moneyRow(m.value)}</b><div class="ticker">${other(r.valueUsd, r.valueInr)}</div></td>
      <td class="num ${pl(m.pnl)}"><b>${sgn(m.pnl, moneyRow)}</b><div class="ticker">${fin(pctInr(r)) ? `${pctInr(r) > 0 ? "+" : ""}${pctInr(r).toFixed(1)}%` : ""}${isUsd() ? (fin(r.pnlInr) ? ` · ${sgn(r.pnlInr, inr)}` : "") : fin(r.pnlUsd) ? ` · ${sgn(r.pnlUsd, usd2)}` : ""}</div></td>`)(M(r))}
      <td class="num">${fin(r.xirr) ? xp(r.xirr) : r.boughtOn ? '<span class="hint" title="Needs a price and a cost">—</span>' : `<button type="button" class="linklike" data-hact="date" title="Add the buy date to see XIRR">add date</button>`}</td>
      <td class="num">${totalVal > 0 && fin(M(r).value) ? `${(M(r).value / totalVal * 100).toFixed(1)}%` : "—"}</td>
      <td>${esc(r.account)}<div class="ticker">${r.source === "sync" ? "synced" : r.source === "manual" ? "by hand" : "imported"}</div></td>
      <td class="sw-acts"><button type="button" class="ghost" data-hact="date" title="Buy date (for XIRR)">📅</button>${r.id ? `<button type="button" class="ghost" data-hact="edit" title="Edit">✎</button><button type="button" class="ghost danger-text" data-hact="del" title="Remove">✕</button>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="11" class="nw-empty-row">${inAcct.length ? "No holdings match these filters." : "No US holdings yet. Connect INDmoney (they arrive with its sync) or import your Vested statement."}</td></tr>`;
    const inr0 = x => `₹${Math.round(x || 0).toLocaleString("en-IN")}`;
    $("#usHoldAccts").innerHTML = [...accts.map(a => `<span class="us-acct">${esc(a.account)} <small>${a.source === "sync" ? "synced" : "imported"} · ${a.count} holding${a.count === 1 ? "" : "s"} · ${isUsd() ? usd0(agg(v.rows.filter(r => r.accountKey === a.key)).val || a.valueUsd) : inr0(a.valueInr)}</small><button type="button" class="ghost danger-text" data-rm-acct="${esc(a.source === "sync" ? a.accountId : a.account)}" data-src="${a.source}" data-label="${esc(a.account)}" data-n="${a.count}">Remove all</button></span>`),
      ...(v.hiddenAccounts || []).map(a => `<span class="us-acct off">${esc(a.account)} <small>synced · removed (${a.count})</small><button type="button" class="ghost" data-unhide="${esc(a.accountId)}">Show again</button></span>`)].join("");
    $("#usHoldClear").hidden = !v.rows.length;
    const st = []; if (v.priceErrors?.length && v.totals.unpriced.length) st.push(`Some prices unavailable (${v.priceErrors[0]})`);
    $("#usHoldStatus").textContent = st.join(" · ");
  }
  async function dateDialog(r) {
    const out = await window.ui.dialog({
      title: `${r.symbol || r.name}: when did you buy?`, icon: "📅", okText: "Save",
      message: "Used for XIRR (your yearly return, counting how long the money was invested). If you bought in several goes, use the date of your first or main purchase.",
      bodyHtml: `<div class="nw-form"><label class="ui-field"><span>Bought on</span><input class="ui-input" type="date" name="d" value="${esc(r.boughtOn || "")}" max="${new Date().toISOString().slice(0, 10)}"></label>${r.id ? `<label class="ui-field"><span>What you paid in ₹ (optional, includes the currency move)</span><input class="ui-input" name="inr" inputmode="decimal" value="${esc(r.investedInrAtToday ? "" : r.investedInr ?? "")}" placeholder="e.g. 1,25,000"></label>` : ""}</div>`,
      collect: box => api("/api/us/holdings/date", { key: r.key, boughtOn: box.querySelector("[name=d]").value || null, ...(r.id ? { investedInr: box.querySelector("[name=inr]").value } : {}) })
    });
    if (out) { hold = out; renderHold(); }
  }
  async function holdImport() {
    let file = null;
    const accts = [...new Set((hold?.rows || []).filter(r => r.source === "import").map(r => r.account))];
    const out = await window.ui.dialog({
      title: "Import US holdings", icon: "⬆", okText: "Import", wide: true,
      message: "A holdings statement from Vested (or any US broker): CSV or Excel with Symbol, Quantity and Average price columns. Or paste lines like “AAPL 10 150.25” (ticker, shares, average price in $). Importing again replaces that account's list.",
      bodyHtml: `<div class="nw-form"><label class="ui-field"><span>Account name</span><input class="ui-input" name="account" value="${esc(accts[0] || "Vested")}" list="usAccts"><datalist id="usAccts">${accts.map(a => `<option value="${esc(a)}">`).join("")}</datalist></label>
        <label class="ui-field"><span>Statement file (CSV / Excel)</span><input class="ui-input" type="file" name="file" accept=".csv,.xlsx,.xls,.txt"></label></div>
        <label class="ui-field"><span>…or paste</span><textarea class="ui-input sw-paste" name="text" rows="5" placeholder="AAPL 10 150.25&#10;MSFT 3.5 410&#10;VOO 2 480"></textarea></label>`,
      onOpen: box => { box.querySelector("[name=file]").onchange = e => { file = e.target.files[0] || null; }; },
      collect: async box => {
        const account = box.querySelector("[name=account]").value.trim() || "Vested", text = box.querySelector("[name=text]").value;
        if (!file && !text.trim()) throw new Error("Choose the statement file or paste the holdings.");
        return api("/api/us/holdings/import", file ? { account, data: await fileB64(file), filename: file.name } : { account, text });
      }
    });
    if (out) { hold = out; renderHold(); if (out.notice) window.toast?.(out.notice, { kind: "ok", ms: 6000 }); load(); }
  }
  async function holdEdit(r = null) {
    const f = (l, n, v, a = "") => `<label class="ui-field"><span>${l}</span><input class="ui-input" name="${n}" value="${esc(v ?? "")}" ${a}></label>`;
    const out = await window.ui.dialog({
      title: r ? `Edit ${r.symbol || r.name}` : "Add a US holding", icon: "🇺🇸", okText: "Save", wide: true,
      bodyHtml: `<div class="nw-form">${f("Ticker (e.g. AAPL, VOO)", "symbol", r?.symbol, 'autocapitalize="characters" autofocus')}${f("Shares (fractions are fine)", "qty", r?.qty, 'inputmode="decimal"')}${f("Average price paid ($ a share)", "avgUsd", r?.avgUsd, 'inputmode="decimal"')}${f("What you paid in ₹ (optional, for exact rupee P/L)", "investedInr", r?.investedInr, 'inputmode="decimal" placeholder="e.g. 1,25,000"')}${f("Account", "account", r?.account || "Vested")}</div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value.trim(); return api("/api/us/holdings/save", { id: r?.id, symbol: v("symbol"), qty: v("qty"), avgUsd: v("avgUsd"), investedInr: v("investedInr"), account: v("account"), name: r?.name }); }
    });
    if (out) { hold = out; renderHold(); load(); }
  }

  // ---- detail sheet ----
  function ensureSheet() {
    if (sheet) return sheet;
    const scrim = document.createElement("div"); scrim.className = "sheet-scrim"; scrim.hidden = true;
    const el = document.createElement("aside"); el.className = "stock-sheet"; el.hidden = true; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true");
    el.innerHTML = `<div class="sheet-bar"><button type="button" class="ghost sheet-back" data-close>← Back to US stocks</button><span class="sheet-hint">Esc to close</span><button type="button" class="modal-close" data-close aria-label="Close">&times;</button></div><div class="sheet-body"></div>`;
    document.body.append(scrim, el);
    const close = () => { el.hidden = true; scrim.hidden = true; document.body.classList.remove("sheet-open"); };
    scrim.onclick = close; el.querySelectorAll("[data-close]").forEach(b => { b.onclick = close; });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !el.hidden && !document.querySelector(".ui-scrim")) close(); });
    sheet = { el, scrim, body: el.querySelector(".sheet-body"), close };
    return sheet;
  }
  async function openStock(sym) {
    const s = ensureSheet(); s.el.hidden = false; s.scrim.hidden = false; document.body.classList.add("sheet-open");
    s.body.innerHTML = `<div class="vs-card vs-empty">Loading ${esc(sym)}…</div>`;
    let d;
    for (let i = 0; i < 20; i++) { d = await api(`/api/us/stock?symbol=${encodeURIComponent(sym)}`).catch(e => ({ error: e.message })); if (d._status !== 202 || d.error) break; s.body.innerHTML = `<div class="vs-card vs-empty">Reading ${esc(sym)}'s SEC filings…</div>`; await new Promise(r => setTimeout(r, 2500)); }
    if (d.error || !d.valuation) { s.body.innerHTML = `<div class="vs-card vs-empty">${esc(sym)}: ${esc(d.error || "no data yet, try again in a minute")}</div>`; return; }
    const v = d.valuation, row = (k, val) => `<div class="row"><span>${k}</span><strong>${val}</strong></div>`;
    const yrs = d.years;
    s.body.innerHTML = `<article class="vs-card">
      <div class="vs-top"><div><h2>${esc(d.name)} <small>(${esc(d.symbol)})</small></h2><p class="hint" style="margin:4px 0 0">${big(v.marketCap)} market cap · latest 10-K: FY${v.asOfFy} (year to ${esc(v.fyEnd)}) · SEC CIK ${d.cik}</p></div>
        <div class="vs-price"><span>Price</span><strong>${usd(d.price)}</strong><small>${esc(d.priceSource || "")} ${esc(d.priceDate || "")}</small></div></div>
      <div class="vs-verdict"><span class="vs-big chip ${esc(v.verdict.cls)}">${esc(v.verdict.label)}</span>${v.tags.map(t => `<span class="chip v-none">${esc(t)}</span>`).join(" ")}</div>
      <div class="vs-grid">
        <div class="vs-tile"><span>Fair value (bear · base · bull)</span><strong>${usd(v.bear)} · ${usd(v.fairValue)} · ${usd(v.bull)}</strong><small class="${v.upside >= 0 ? "buy" : "avoid"}">${pct(v.upside, true)} to base value</small></div>
        <div class="vs-tile"><span>P/E vs fair P/E</span><strong>${v.pe ?? "—"} vs ${v.fairPE ?? "—"}</strong><small>by P/E ${usd(v.byPE)} · by cash flow ${usd(v.byDcf)}</small></div>
        <div class="vs-tile"><span>Growth the price assumes</span><strong>${v.impliedGrowth !== null ? `${v.impliedGrowth}%/yr` : "—"}</strong><small>vs ${v.growthUsed ?? "—"}%/yr used here</small></div>
        <div class="vs-tile"><span>Quality score</span><strong>${v.quality ?? "—"}/100</strong><small>returns, margins, cash, debt, consistency</small></div>
      </div>
      <section class="gl-panel"><div class="gl-head"><div><h3>Your growth assumption</h3><p class="hint" style="margin:0">History says ${v.growthModel ?? "—"}%/yr. If you expect faster or slower growth for the next 5 years, set it here; fair value updates.</p></div></div>
        <div class="us-growth"><input type="range" min="-5" max="35" step="0.5" value="${v.growthUsed ?? 0}" id="usG" aria-label="Growth per year"><b id="usGv">${v.growthUsed ?? 0}%</b><button type="button" class="primary" id="usGsave">Save</button>${v.growthOverride !== null ? '<button type="button" class="ghost" id="usGreset">Use history</button>' : ""}</div></section>
      <div class="vs-cols"><div><h3>Why this verdict</h3><ul>${v.why.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
        <div><h3>Key numbers (FY${v.asOfFy})</h3>${row("Revenue", big(v.revenue))}${row("Net income", big(v.netIncome))}${row("Revenue growth (3 yr)", pct(v.revG))}${row("EPS growth (3 yr)", pct(v.epsG))}${row(v.roic !== null ? "ROIC" : "ROE", pct(v.roic ?? v.roe))}${row("ROE", pct(v.roe))}${row("Operating / net margin", `${pct(v.opMargin)} / ${pct(v.netMargin)}`)}${row("Free-cash-flow yield", pct(v.fcfYield))}${row("Debt / equity", v.de ?? "—")}${row("Dividend yield · payout", `${pct(v.divYield)} · ${pct(v.payout)}`)}${row("P/S · P/B", `${v.ps ?? "—"} · ${v.pb ?? "—"}`)}</div></div>
      <h3>Last ${yrs.length} fiscal years</h3>
      <div class="table-wrap"><table class="us-years"><thead><tr><th>FY</th><th class="num">Revenue</th><th class="num">Net income</th><th class="num">EPS</th><th class="num">Free cash flow</th><th class="num">Net margin</th></tr></thead><tbody>${yrs.map(y => `<tr><td>${y.fy}</td><td class="num">${big(y.revenue)}</td><td class="num">${big(y.netIncome)}</td><td class="num">${Number.isFinite(y.eps) ? usd(y.eps) : "—"}</td><td class="num">${Number.isFinite(y.cfo) ? big(y.cfo - (y.capex || 0)) : "—"}</td><td class="num">${y.revenue && Number.isFinite(y.netIncome) ? pct(Math.round(y.netIncome / y.revenue * 1000) / 10) : "—"}</td></tr>`).join("")}</tbody></table></div>
      <div class="toolbar" style="margin:16px 0 0"><button type="button" class="ghost" id="usToggle">${d.inList ? "✓ In my US list (remove)" : "+ Add to my US list"}</button><button type="button" class="ghost" id="usRef">Refresh from SEC</button></div>
      <p class="vs-fine">Fair value = average of (fair P/E × EPS) and a 10-year DCF of free cash flow per share (your growth for 5 years, fading to 3%; 9% discount rate). Rule-based screen from SEC filings, not investment advice.</p>
    </article>`;
    const rg = $("#usG"); rg.oninput = () => { $("#usGv").textContent = `${rg.value}%`; };
    $("#usGsave").onclick = async () => { await api("/api/us/growth", { symbol: sym, growth: Number(rg.value) }); openStock(sym); load(); };
    $("#usGreset")?.addEventListener("click", async () => { await api("/api/us/growth", { symbol: sym, growth: null }); openStock(sym); load(); });
    $("#usToggle").onclick = async () => { await api("/api/us/list", d.inList ? { remove: [sym] } : { add: [sym] }); window.toast?.(d.inList ? `${esc(sym)} removed from your US list.` : `✓ ${esc(sym)} added to your US list.`, { kind: "ok", ms: 3000 }); openStock(sym); load(); };
    $("#usRef").onclick = async () => { await api("/api/us/refresh", { symbols: [sym] }); window.toast?.("Refreshing from SEC…", { kind: "ok", ms: 2500 }); setTimeout(() => openStock(sym), 3000); };
  }

  // ---- search ----
  let sTimer = null, results = [], active = -1;
  function drawDrop() {
    const dd = $("#usDrop"); dd.hidden = !results.length;
    dd.innerHTML = results.map((r, i) => `<button type="button" class="us-opt${i === active ? " active" : ""}" data-i="${i}"><b>${esc(r.symbol)}</b> <span>${esc(r.name)}</span><em>${data?.mine?.includes(r.symbol) ? "in your list" : "+ add"}</em></button>`).join("");
  }
  async function addSym(sym) {
    results = []; drawDrop(); $("#usQ").value = "";
    try { await api("/api/us/list", { add: [sym] }); list = "mine"; window.toast?.(`✓ ${esc(sym)} added. Reading its SEC filings…`, { kind: "ok", ms: 3000 }); await load(); }
    catch (e) { window.toast?.(esc(e.message), { kind: "warn" }); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#usView")) return;
    $("#viewUs").onclick = () => setView("us");
    $("#usHoldImport").onclick = () => holdImport();
    $("#usHoldAdd").onclick = () => holdEdit();
    $("#usHoldClear").onclick = async () => {
      if (!await window.ui.confirm({ title: "Remove all US holdings?", message: `All ${hold?.rows?.length || 0} US holdings leave this app (and Net worth): imported and hand-added ones are deleted; INDmoney's synced ones are kept out of future syncs until you press Show again. Nothing changes at your broker.`, okText: "Remove all", danger: true })) return;
      try { hold = await api("/api/us/holdings/delete", { all: true }); renderHold(); window.toast?.(hold.notice || "Removed.", { kind: "ok" }); load(); } catch (err) { window.toast?.(err.message, { kind: "error" }); }
    };
    $("#usHoldAccts").addEventListener("click", async e => {
      const rm = e.target.closest("[data-rm-acct]"), un = e.target.closest("[data-unhide]");
      try {
        if (rm) {
          const sync = rm.dataset.src === "sync";
          if (!await window.ui.confirm({ title: `Remove all ${rm.dataset.label} holdings?`, message: sync ? `The ${rm.dataset.n} US holdings from the ${rm.dataset.label} sync are kept out of this app and Net worth until you press Show again. Nothing changes at your broker.` : `The ${rm.dataset.n} imported / hand-added holdings of ${rm.dataset.label} are deleted from this app. Nothing changes at your broker; you can import the statement again any time.`, okText: "Remove all", danger: true })) return;
          hold = await api("/api/us/holdings/delete", sync ? { syncId: rm.dataset.rmAcct } : { account: rm.dataset.rmAcct });
        } else if (un) hold = await api("/api/us/holdings/unhide", { syncId: un.dataset.unhide });
        else return;
        renderHold(); if (hold.notice) window.toast?.(hold.notice, { kind: "ok" }); load();
      } catch (err) { window.toast?.(err.message, { kind: "error" }); }
    });
    $("#usCur").addEventListener("click", e => { const b = e.target.closest("[data-cur]"); if (!b || b.dataset.cur === usOpt.cur) return; usOpt.cur = b.dataset.cur; usOpt.inv = "0"; usOpt.abs = ""; usSave(); renderHold(); });
    $("#usAccTabs").addEventListener("click", e => { const b = e.target.closest("[data-acct]"); if (b) { usOpt.acct = b.dataset.acct; usSave(); renderHold(); } });
    $("#usCompare").addEventListener("click", e => { const tr = e.target.closest("tr[data-acct]"); if (tr) { usOpt.acct = usOpt.acct === tr.dataset.acct ? "all" : tr.dataset.acct; usSave(); renderHold(); } });
    $("#usPl").addEventListener("click", e => { const b = e.target.closest("[data-pl]"); if (b) { usOpt.pl = b.dataset.pl; usSave(); renderHold(); } });
    for (const [id, k] of [["#usInv", "inv"], ["#usPct", "pct"], ["#usAbs", "abs"]]) $(id).onchange = e => { usOpt[k] = e.target.value; usSave(); renderHold(); };
    $("#usSort").onchange = e => { usOpt.sort = e.target.value; usOpt.dir = e.target.value === "name" ? 1 : -1; usSave(); renderHold(); };
    $("#usDir").onclick = () => { usOpt.dir = -usOpt.dir; usSave(); renderHold(); };
    $("#usQ").addEventListener("input", e => { usOpt.q = e.target.value; renderHold(); });
    $("#usReset").onclick = () => { usOpt = { ...US_DEF, acct: usOpt.acct }; $("#usQ").value = ""; usSave(); renderHold(); };
    $("#usHoldRows").addEventListener("click", async e => {
      const b = e.target.closest("[data-hact]"), tr = e.target.closest("tr[data-key]"); if (!b || !tr) return;
      const r = hold.rows.find(x => x.key === tr.dataset.key); if (!r) return;
      if (b.dataset.hact === "date") { dateDialog(r); return; }
      if (b.dataset.hact === "edit") holdEdit(r);
      else if (await window.ui.confirm({ title: `Remove ${r.symbol || r.name}?`, message: "Only removes it from this app.", okText: "Remove", danger: true })) { try { hold = await api("/api/us/holdings/delete", { id: r.id }); renderHold(); } catch (err) { window.toast?.(err.message, { kind: "error" }); } }
    });
    $("#usList").addEventListener("click", e => { const b = e.target.closest("[data-list]"); if (b) { list = b.dataset.list; load(); } });
    $("#usRows").addEventListener("click", e => { const l = e.target.closest("[data-list]"); if (l) { list = l.dataset.list; load(); return; } const tr = e.target.closest("tr[data-sym]"); if (tr) openStock(tr.dataset.sym); });
    $("#usScreens").addEventListener("click", e => { const b = e.target.closest("[data-screen]"); if (b) { screen = b.dataset.screen; render(); } });
    $("#usRefresh").onclick = async () => { if (!data) return; await api("/api/us/refresh", { symbols: data.rows.map(r => r.symbol) }); $("#usStatus").textContent = "Refreshing prices and SEC data…"; setTimeout(load, 1500); };
    // sortable numeric columns
    const keys = [null, "price", "pe", "fairValue", "upside", null, "revG", "epsG", "roic", "netMargin", "de", "divYield", null];
    document.querySelectorAll(".us-table thead th").forEach((th, i) => { if (!keys[i]) return; th.dataset.k = keys[i]; th.tabIndex = 0; th.title = "Sort"; const go = () => { sort = { k: keys[i], dir: sort.k === keys[i] ? -sort.dir : -1 }; render(); }; th.onclick = go; th.onkeydown = e => { if (e.key === "Enter") go(); }; });
    const q = $("#usQ");
    q.addEventListener("input", () => { clearTimeout(sTimer); const v = q.value.trim(); if (!v) { results = []; drawDrop(); return; } sTimer = setTimeout(async () => { try { results = (await api(`/api/us/search?q=${encodeURIComponent(v)}`)).results; active = results.length ? 0 : -1; drawDrop(); } catch (e) { $("#usStatus").textContent = e.message; } }, 200); });
    q.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { active = Math.min(results.length - 1, active + 1); drawDrop(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); drawDrop(); e.preventDefault(); }
      else if (e.key === "Enter") { e.preventDefault(); if (results[active]) addSym(results[active].symbol); else if (q.value.trim()) addSym(q.value.trim().toUpperCase()); }
      else if (e.key === "Escape") { results = []; drawDrop(); }
    });
    $("#usDrop").addEventListener("mousedown", e => { const b = e.target.closest("[data-i]"); if (b) { e.preventDefault(); addSym(results[Number(b.dataset.i)].symbol); } });
    q.addEventListener("blur", () => setTimeout(() => { results = []; drawDrop(); }, 150));
  });
})();
