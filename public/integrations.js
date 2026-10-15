// Integrations tab: price-source status, Google Finance / Yahoo / Kite comparison, Zerodha Kite (MCP) login + holdings sync,
// and read-only Angel One / Dhan / Groww holdings sync. Holdings from every broker are shown together.
// Loaded after app.js; app.js calls window.loadIntegrations() when the tab opens.
(() => {
  const $ = s => document.querySelector(s);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = v => Number.isFinite(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—";
  const tone = v => v > 0 ? "buy" : v < 0 ? "avoid" : "";
  const api = async (path, opts) => {
    const r = await fetch(path, opts); const x = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(x.message || `HTTP ${r.status}`); e.loginRequired = !!x.loginRequired; e.loginUrl = x.loginUrl || null; throw e; }
    return x;
  };
  const post = (path, body = {}) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  let kiteOn = false;

  async function renderSources() {
    const h = await api("/api/health").catch(() => null);
    if (!h) { $("#intSources").innerHTML = '<p class="hint">Start the local server.</p>'; return; }
    const names = { kite: "Kite MCP (Zerodha LTP)", nse: "NSE (exchange quote)", yahoo: "Yahoo Finance", google: "Google Finance" };
    const cool = { nse: h.nseCooldownUntil, yahoo: h.yahooCooldownUntil, google: h.googleCooldownUntil };
    $("#intSources").innerHTML = `<ol class="flag-list">${h.priceSources.map(s => {
      const note = s === "kite" && !h.kiteEnabled ? "switched off (KITE_MCP_ENABLED=0)" : cool[s] ? `cooling down until ${new Date(cool[s]).toLocaleTimeString("en-IN")}` : "active";
      return `<li><div class="fcompany">${esc(names[s])}</div><div class="fnote">${esc(note)}</div></li>`;
    }).join("")}</ol><p class="hint">Change the order with <code>PRICE_SOURCES</code>, e.g. <code>PRICE_SOURCES=google,yahoo</code>.</p>`;
  }

  async function compare() {
    const sym = $("#intCmpSymbol").value.trim().toUpperCase(), out = $("#intCmpOut");
    if (!sym) { out.innerHTML = '<p class="hint">Enter an NSE symbol.</p>'; return; }
    out.innerHTML = '<p class="hint">Asking each source in turn (can take up to a minute)…</p>';
    try {
      const x = await api(`/api/price-compare?symbol=${encodeURIComponent(sym)}`);
      const label = { nse: "NSE", yahoo: "Yahoo Finance", screener: "Screener", google: "Google Finance", kite: "Kite (Zerodha)" };
      const why = e => /fetch failed|ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|certificate/i.test(e) ? " · could not connect: check internet / firewall / proxy" : /403|401/.test(e) ? " · the site is blocking this machine" : /429|rate/i.test(e) ? " · rate-limited: too many requests, wait a few minutes" : /timeout|aborted/i.test(e) ? " · timed out" : /layout|no price|no current price/i.test(e) ? " · page changed or returned no price" : "";
      const row = k => { const q = x.sources[k] || {}; const ok = Number.isFinite(q.price); return `<tr><td>${label[k]}${x.order.includes(k) ? ` <small class="hint">#${x.order.indexOf(k) + 1}</small>` : ' <small class="hint">not used</small>'}</td><td><b>${ok ? inr(q.price) : "—"}</b></td><td>${q.low && q.high ? `${inr(q.low)} – ${inr(q.high)}` : "—"}</td><td>${q.ms ?? "—"} ms</td><td class="${ok ? "buy" : q.skipped ? "" : "avoid"}">${ok ? "OK" : esc(q.skipped || q.error || "—")}${!ok && q.error ? `<small class="hint">${why(q.error)}</small>` : ""}</td></tr>`; };
      out.innerHTML = `<div class="table-wrap"><table style="min-width:0"><thead><tr><th>Source</th><th>Price</th><th>52W range</th><th>Time</th><th>Result</th></tr></thead><tbody>${Object.keys(label).map(row).join("")}</tbody></table></div>
        <p class="hint">${x.working.length ? `Working: <b>${x.working.map(k => label[k]).join(", ")}</b>. A refresh uses the first working source in the order shown.` : "<b>No source answered.</b> This machine cannot reach any price site right now (see the reasons above)."}${x.maxSpreadPct !== null ? ` Sources differ by up to ${x.maxSpreadPct}%.` : ""}${x.proxy ? ` Proxy in use: ${esc(x.proxy)}.` : ""}</p>`;
    } catch (e) { out.innerHTML = `<p class="hint">Failed: ${esc(e.message)}</p>`; }
  }
  // Debug log (owner): the server's recent log lines, filterable, with a copy button.
  async function showLog() {
    const out = $("#intLogOut"), f = $("#intLogFilter").value;
    out.innerHTML = '<p class="hint">Loading…</p>';
    try {
      const x = await api(`/api/debug/log?lines=400${f ? `&filter=${encodeURIComponent(f)}` : ""}`);
      out.innerHTML = `<p class="hint">${x.lines.length} line(s) · price sources ${esc(x.priceSources.join(" → "))} · Node ${esc(x.node)} · market ${x.marketOpen ? "open" : "closed"} <button type="button" class="ghost" id="intLogCopy">Copy</button></p><pre class="dbg-log">${esc(x.lines.join("\n") || "(nothing logged yet: press Refresh on the watchlist, then show the log again)")}</pre>`;
      $("#intLogCopy").onclick = async () => { try { await navigator.clipboard.writeText(x.lines.join("\n")); $("#intLogCopy").textContent = "Copied"; } catch { $("#intLogCopy").textContent = "Select the text and copy"; } };
      const pre = out.querySelector("pre"); pre.scrollTop = pre.scrollHeight;
    } catch (e) { out.innerHTML = `<p class="hint">${esc(e.message)}</p>`; }
  }
  document.addEventListener("click", e => { if (e.target.id === "intLogBtn") showLog(); });

  let holdingsView = null;
  const stanceCls = a => ({ Accumulate: "v-under", Hold: "v-fair", "Hold (don't add)": "v-rich1", Review: "v-rich", Trim: "v-rich", "No view": "v-none" }[a] || "v-none");
  const stanceChip = a => `<span class="chip ${stanceCls(a)}">${esc(a)}</span>`;
  const pct = v => Number.isFinite(v) ? `${v}%` : "—";
  // After a sync: toast naming the account just synced (latest syncedAt) with a shortcut to its own tab in My holdings.
  function announceSync(v) {
    const a = [...(v.accounts || [])].sort((x, y) => String(y.syncedAt).localeCompare(String(x.syncedAt)))[0];
    if (!a) return;
    window.toast?.(`✓ Synced ${a.count} holding${a.count === 1 ? "" : "s"} from <b>${esc(a.brokerName)} · ${esc(a.label)}</b>`, { kind: "ok", action: { label: "View holdings", fn: () => window.openHoldingsFor?.(a.userId) } });
  }
  function renderHoldings(v) {
    holdingsView = v;
    $("#intKiteAccounts").innerHTML = v.accounts.length ? `<ul class="flag-list">${v.accounts.map(a => `<li><div class="fcompany"><span class="chip v-none">${esc(a.brokerName || "Zerodha")}</span> ${esc(a.label)} <small>(${esc(a.clientId || a.userId)})</small></div><div class="fnote">${a.count} holdings · synced ${new Date(a.syncedAt).toLocaleString("en-IN")} <button type="button" class="ghost" data-remove="${esc(a.userId)}">Remove</button>${a.priceNote ? `<br><span class="wait">${esc(a.priceNote)}</span>` : ""}</div></li>`).join("")}</ul>` : '<p class="hint">No account synced yet. Sync Zerodha, Angel One, Dhan or Groww above.</p>';
    const t = v.totals, sc = t.stance || {};
    $("#intKiteCards").innerHTML = v.holdings.length ? `<div><span>Holdings</span><strong>${t.count}</strong></div><div><span>Invested</span><strong>${inr(t.invested)}</strong></div><div><span>Value</span><strong>${inr(t.value)}</strong></div><div><span>P/L</span><strong class="${tone(t.pnl)}">${inr(t.pnl)}</strong></div>` : "";
    $("#intKiteStances").innerHTML = v.holdings.length ? `<span class="hint">Stance: </span>${[["Accumulate", sc.accumulate], ["Hold", sc.hold], ["Hold (don't add)", sc.dontAdd], ["Review", sc.review], ["Trim", sc.trim], ["No view", sc.noView]].filter(x => x[1]).map(x => `${stanceChip(x[0])} ${x[1]}`).join(" &nbsp; ")}` : "";
    $("#intKiteRows").innerHTML = v.holdings.map(h => `<tr data-sym="${esc(h.symbol)}" title="Click for details"><td><b>${esc(h.symbol)}</b></td><td>${esc(h.company || "—")}</td><td>${h.qty}</td><td>${inr(h.avgPrice)}</td><td>${inr(h.invested)}</td><td>${inr(h.value)}</td><td class="${tone(h.pnl)}">${inr(h.pnl)}</td><td>${pct(h.weightPct)}</td><td>${stanceChip(h.stance.action)}</td><td>${h.accounts.map(a => `${esc(a.label)} (${a.qty})`).join(", ")}${h.priceFromWatchlist ? ' <small class="wait" title="The broker sent no price; valued at the watchlist price">*</small>' : ""}</td><td>${h.inWatchlist ? "✓ on watchlist" : '<span class="wait">not on watchlist</span>'}</td></tr>`).join("") || '<tr style="cursor:default"><td colspan="11">Sync a broker account to see your holdings here.</td></tr>';
    $("#intKiteNote").textContent = v.holdings.length ? `Click a row for details and a rule-based stance (accumulate / hold / review / trim). ${t.notInWatchlist} held stock(s) are not on the watchlist; ${t.watchlistNotHeld} watchlist stock(s) are not held in any synced account. ${v.holdings.some(h => h.priceFromWatchlist) ? " * = the broker sent no price, so the watchlist price is used." : ""} Holdings from all brokers are stored only in data/kite-holdings.json on this machine.` : "";
  }

  // ---- Holding popup (same look as the stock popup on the Watchlist tab) ----
  const row = (k, vv) => `<div class="row"><span>${k}</span><strong>${vv}</strong></div>`;
  const toneMark = t => t === "for" ? '<span class="buy">✓</span>' : t === "against" ? '<span class="avoid">✗</span>' : "•";
  function holdingHtml(h) {
    const st = h.stance, v = h.valuation, th = h.thesis, si = h.stockInfo;
    const plPct = Number.isFinite(st.pnlPct) ? ` <span class="${tone(h.pnl)}">(${st.pnlPct >= 0 ? "+" : ""}${st.pnlPct}%)</span>` : "";
    const fv = v?.fairValue ? `${inr(v.fairValue.bear)} · ${inr(v.fairValue.base)} · ${inr(v.fairValue.bull)}` : "—";
    const stance = `<div class="detail-block"><h3>Suggested stance ${stanceChip(st.action)} <small class="hint">${esc(st.confidence)} confidence</small></h3><p><b>${esc(st.summary)}</b></p>
      <ul class="flag-list">${st.reasons.map(r => `<li><div class="fnote">${toneMark(r.tone)} ${esc(r.text)}</div></li>`).join("")}</ul>
      ${st.changes.length ? `<h4 style="margin:10px 0 4px">What would change this</h4><ul class="flag-list">${st.changes.map(c => `<li><div class="fnote">${esc(c)}</div></li>`).join("")}</ul>` : ""}</div>`;
    const position = `<div class="detail-block"><h3>Your position</h3>${row("Quantity", h.qty)}${row("Average cost", inr(h.avgPrice))}${row("Invested", inr(h.invested))}${row("Current value", inr(h.value))}${row("P/L", `<span class="${tone(h.pnl)}">${inr(h.pnl)}</span>${plPct}`)}${row("Share of synced holdings", pct(h.weightPct))}${row(h.priceFromWatchlist ? "Price (watchlist; broker sent none)" : "Price at last sync", inr(h.syncPrice ?? h.kitePrice))}${h.watchlistPrice && h.watchlistPrice !== (h.syncPrice ?? h.kitePrice) ? row("Watchlist price", inr(h.watchlistPrice)) : ""}
      ${h.accounts.map(a => row(`${esc(a.label)} <small>(${esc(a.brokerName || "Zerodha")})</small>`, `${a.qty} @ ${inr(a.avgPrice)}`)).join("")}</div>`;
    const valuation = v ? `<div class="detail-block"><h3>Valuation</h3>${row("View", esc(v.view) + (v.confidence === "low" ? " <small>(low confidence)</small>" : ""))}${row("Status vs buy zone", esc(v.status))}${row(`${esc(v.basis || "P/E")} vs fair`, `${v.pe ?? "—"} vs ${v.fairMultiple ?? "—"}`)}${row("Buy zone", `${inr(v.zoneLow)} – ${inr(v.zoneHigh)}`)}${row("Fair value bear · base · bull", fv)}${row("ROCE / ROE", `${pct(v.roce)} / ${pct(v.roe)}`)}${row("3-yr sales / profit growth", `${pct(v.salesCagr3)} / ${pct(v.profitCagr3)}`)}${row("Promoter holding", pct(v.promoter))}${row("Fundamentals as of", esc(v.dataAsOf || "—") + (v.stale ? " ⚠ stale" : ""))}</div>`
      : `<div class="detail-block"><h3>Valuation</h3><p class="hint">${h.inWatchlist ? "No fundamentals fetched yet." : "Not on your watchlist yet."}</p></div>`;
    const thesis = `<div class="detail-block"><h3>Thesis</h3>${th ? `<p><span class="chip ${th.status === "Broken" ? "v-rich" : th.status === "Intact" ? "v-under" : "v-none"}">${th.status === "Unassessed" ? "No data yet" : esc(th.status)}</span> ${esc(th.reasons || "")}</p><ul class="flag-list">${th.conditions.map(c => `<li><div class="fnote">${c.state === "broken" ? '<span class="avoid">✗</span>' : c.state === "ok" ? '<span class="buy">✓</span>' : "…"} ${esc(c.label)} ${esc(c.op)} ${c.value} · now ${c.actual ?? "no data"}</div></li>`).join("")}</ul>` : '<p class="hint">No thesis written for this stock.</p>'}<button type="button" class="ghost" id="hmThesis">${th ? "Edit" : "Write"} thesis</button></div>`;
    const watch = si ? `<div class="detail-block"><h3>On your watchlist</h3>${row("Bucket / style", `${esc(si.bucket)}${si.style ? ` / ${esc(si.style)}` : ""}`)}${row("Action", esc(si.action))}${row("Valuation label", esc(si.valuationLabel))}<p>${esc(si.note)}</p>${si.latestNews ? `<p class="hint">Latest news: ${esc(si.latestNews)}</p>` : ""}</div>` : "";
    const actions = `<div class="val-actions">${h.inWatchlist ? '<button type="button" class="ghost" id="hmFetch">Fetch / refresh fundamentals</button>' : '<button type="button" class="primary" id="hmAdd">Add to watchlist &amp; fetch valuation</button>'}<span id="hmStatus" class="hint"></span></div>`;
    return `<h2 style="margin:0 40px 4px 0">${esc(h.company || h.symbol)} <small>(${esc(h.symbol)})</small></h2>
      <div class="detail val-detail" style="grid-template-columns:1fr 1fr;gap:24px"><div>${stance}${thesis}</div><div>${position}${valuation}${watch}</div></div>${actions}
      <p class="hint">A rule-based checklist from cached fundamentals, your thesis and portfolio weight. It ignores your tax position, goals and other investments, and is not investment advice.</p>`;
  }
  function openHolding(sym) {
    const h = holdingsView?.holdings.find(x => x.symbol === sym); if (!h) return;
    $("#holdingBody").innerHTML = holdingHtml(h); $("#holdingModal").hidden = false; document.body.classList.add("modal-open");
    const status = m => { $("#hmStatus").textContent = m; };
    const refresh = async fn => { try { await fn(); holdingsView = await api("/api/kite/holdings"); renderHoldings(holdingsView); openHolding(sym); } catch (e) { status(`Failed: ${e.message}`); } };
    const fetchFund = async id => { const x = await post("/api/fundamentals/fetch", { ids: [id], force: true }); const r = x.results?.[0]; if (r?.error) throw new Error(r.error); };
    if ($("#hmFetch")) $("#hmFetch").onclick = () => { status("Fetching…"); refresh(() => fetchFund(h.stockInfo.id)); };
    if ($("#hmAdd")) $("#hmAdd").onclick = () => { status("Adding and fetching…"); refresh(async () => { const a = await post("/api/stocks/add", { symbol: h.symbol, company: h.company || h.symbol }).catch(e => { if (/already/.test(e.message)) return null; throw e; }); const id = a?.stock?.id ?? (await api("/api/stocks")).stocks.find(s => (s.marketSymbol || s.ticker || "").toUpperCase() === h.symbol)?.id; await fetchFund(id); }); };
    $("#hmThesis").onclick = () => { closeHolding(); if (typeof setView === "function") setView("thesis"); };
  }
  function closeHolding() { $("#holdingModal").hidden = true; document.body.classList.remove("modal-open"); }
  $("#holdingClose").onclick = closeHolding;
  $("#holdingModal").onclick = e => { if (e.target.id === "holdingModal") closeHolding(); };
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#holdingModal").hidden) closeHolding(); });
  $("#intKiteRows").onclick = e => { const tr = e.target.closest("tr[data-sym]"); if (tr) openHolding(tr.dataset.sym); };

  const slotMsgs = {}; // per-slot status text (login link etc.)
  async function renderKite() {
    const [sl, v] = await Promise.all([api("/api/kite/slots").catch(e => ({ enabled: false, slots: [], error: e.message })), api("/api/kite/holdings").catch(() => ({ accounts: [], holdings: [], totals: {} }))]);
    kiteOn = !!sl.enabled;
    $("#intKiteAdd").disabled = !kiteOn; $("#intKiteDiagnose").disabled = !kiteOn;
    $("#intKiteSlots").innerHTML = !kiteOn ? "Switched off by <code>KITE_MCP_ENABLED=0</code> in <code>.env</code>. Remove that line and restart to use Kite."
      : sl.slots.map(s => {
        const state = s.connected ? `Connected as <b>${esc(s.profile?.name || s.profile?.userId || "your account")}</b> (${esc(s.profile?.userId || "")})`
          : s.loginRequired ? "Not logged in" : `Unreachable: ${esc(s.error || "unknown error")}`;
        return `<div class="kslot" data-slot="${esc(s.id)}"><div class="kslot-head"><strong>${esc(s.label)}</strong><span class="hint">${state}</span></div>
          <div class="toolbar" style="margin:6px 0 0"><button type="button" class="primary" data-act="login">Log in</button><button type="button" class="primary" data-act="sync"${s.connected ? "" : " disabled"}>Sync holdings</button><button type="button" class="ghost" data-act="disconnect">Disconnect</button>${s.removable ? '<button type="button" class="ghost" data-act="remove">Remove slot</button>' : ""}<input data-label placeholder="Account label (optional), e.g. Zerodha - Nishanth" value="" style="min-width:240px;flex:none"></div>
          <div class="hint kmsg">${slotMsgs[s.id] || ""}</div></div>`;
      }).join("");
    renderHoldings(v);
  }

  async function busy(btn, label, fn) {
    const old = btn.textContent; btn.disabled = true; btn.textContent = label;
    try { await fn(); } finally { btn.textContent = old; btn.disabled = !kiteOn && btn.id !== "intCmpBtn"; }
  }

  $("#intCmpBtn").onclick = compare;
  $("#intCmpSymbol").onkeydown = e => { if (e.key === "Enter") compare(); };
  const pollTimers = {};
  const slotQ = id => `?slot=${encodeURIComponent(id)}`;
  // After the login link is opened, check every 3 s (up to 3 min) so the card says "Connected" as soon as Zerodha finishes.
  function pollLogin(id) {
    clearInterval(pollTimers[id]); let tries = 0;
    pollTimers[id] = setInterval(async () => {
      tries++;
      const s = await api(`/api/kite/status${slotQ(id)}`).catch(() => null);
      if (s?.connected) { clearInterval(pollTimers[id]); slotMsgs[id] = ""; renderKite(); }
      else if (tries >= 60) { clearInterval(pollTimers[id]); slotMsgs[id] = "<b>Still not logged in after 3 minutes.</b> Press Diagnose and share the result."; renderKite(); }
    }, 3000);
  }
  $("#intKiteSlots").onclick = async e => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const card = btn.closest(".kslot"), id = card.dataset.slot, act = btn.dataset.act, msg = card.querySelector(".kmsg");
    const old = btn.textContent; btn.disabled = true;
    try {
      if (act === "login") {
        btn.textContent = "Requesting link…";
        const x = await post(`/api/kite/login${slotQ(id)}`);
        if (x.loginUrl) {
          window.open(x.loginUrl, "_blank", "noopener"); // may be blocked by a popup blocker, so the link is always shown too
          slotMsgs[id] = `1. <a href="${esc(x.loginUrl)}" target="_blank" rel="noopener"><b>Open the Zerodha login page</b></a> (use this link if no tab opened) and sign in with <b>this</b> account.<br>2. Keep this tab open: it turns to "Connected" by itself, then press <b>Sync holdings</b>.`;
          msg.innerHTML = slotMsgs[id]; pollLogin(id);
        } else msg.innerHTML = `Kite replied but no login link was found: <code>${esc(x.message || "(empty)")}</code>`;
      } else if (act === "sync") {
        btn.textContent = "Syncing…"; btn.classList.add("is-loading");
        const v = await post(`/api/kite/sync${slotQ(id)}`, { label: card.querySelector("[data-label]").value });
        renderHoldings(v); slotMsgs[id] = ""; await renderKite(); announceSync(v);
      } else if (act === "disconnect") { await post(`/api/kite/disconnect${slotQ(id)}`); slotMsgs[id] = ""; await renderKite(); }
      else if (act === "remove") { if (await ui.confirm({ title: "Remove this Zerodha account slot?", message: "Its login is forgotten. Synced holdings stay until you remove them under Synced accounts.", okText: "Remove slot", danger: true })) { await post("/api/kite/slots/remove", { slot: id }); await renderKite(); } }
    } catch (err) { if (act === "sync") window.toast?.(`Sync failed: ${esc(err.loginRequired ? "not logged in, press Log in first" : err.message)}`, { kind: "bad" }); msg.textContent = act === "login" ? `Login failed: ${err.message}` : err.loginRequired ? "Not logged in yet: press Log in first." : `${act === "sync" ? "Sync" : "Action"} failed: ${err.message}`; }
    finally { btn.textContent = old; btn.disabled = false; btn.classList.remove("is-loading"); }
  };
  $("#intKiteAdd").onclick = async () => {
    const label = await ui.prompt({ title: "Add a Zerodha account", message: "Each account gets its own login, so several can stay connected at once.", label: "Account name", placeholder: "e.g. Zerodha - Sophia", chips: ["Zerodha - Nishanth", "Zerodha - Sophia", "Zerodha - HUF"], okText: "Add account", icon: "🔗", required: false }); if (label === null) return;
    try { await post("/api/kite/slots/add", { label }); await renderKite(); } catch (err) { $("#intKiteDiag").innerHTML = `<p class="hint">Could not add: ${esc(err.message)}</p>`; }
  };
  $("#intKiteDiagnose").onclick = e => busy(e.target, "Checking…", async () => {
    const out = $("#intKiteDiag");
    try { const d = await api("/api/kite/diagnose"); out.innerHTML = `<pre style="white-space:pre-wrap;font-size:12px;background:#f3f6fa;border:1px solid var(--line,#dce4ee);border-radius:8px;padding:10px">${esc(d.steps.map(x => `${x.ok ? "OK  " : "FAIL"} ${x.step}: ${x.detail}`).join("\n"))}</pre>`; }
    catch (err) { out.innerHTML = `<p class="hint">Diagnose failed: ${esc(err.message)}</p>`; }
  });
  $("#intKiteAccounts").onclick = async e => {
    const id = e.target?.dataset?.remove; if (!id || !(await ui.confirm({ title: "Remove these synced holdings?", message: "Only this app's copy is removed; nothing changes at your broker.", okText: "Remove", danger: true }))) return;
    renderHoldings(await post("/api/kite/remove-account", { userId: id }));
  };

  // ---- Angel One / Dhan / Groww ----
  const BROKER_INFO = {
    angel: "SmartAPI (free). Enter your SmartAPI key and client ID in Settings. Save your PIN and TOTP secret too and the app logs in by itself every day. Prices come with the holdings.",
    dhan: "DhanHQ API v2 (free). Enter your client ID, then either paste the daily access token or save PIN + TOTP secret for automatic login. Live prices need Dhan's paid Data API plan; without it, another broker's or the watchlist price is used.",
    groww: "Groww Trade API (needs Groww's Trade API subscription). Enter your API key with its TOTP secret for automatic login, or with its secret (approve daily on Groww), or paste the daily access token."
  };
  function settingsBlock(b) {
    const any = b.settings.some(f => f.set), auto = b.autoLogin ? '<span class="buy">Automatic login is on</span>: the app reconnects by itself when the daily session expires.' : "Tip: save the optional PIN/TOTP fields to let the app log in by itself every day.";
    return `<details class="bsettings" ${any ? "" : "open"}><summary>Settings: your ${esc(b.name)} details${any ? ` <small class="hint">(${b.settings.filter(f => f.set).length} saved)</small>` : ""}</summary>
      <p class="hint" style="margin:6px 0 10px">${auto} Saved only on this computer (<code>data/broker-credentials.json</code>). Leave a field empty to keep what is saved.</p>
      ${b.settings.map(f => `<div class="bfield"><label>${esc(f.label)}<input name="${esc(f.name)}" type="${f.secret ? "password" : "text"}" autocomplete="off" placeholder="${f.set ? `saved: ${esc(f.preview)}${f.source === ".env" ? " (from .env)" : ""}` : f.optional ? "optional" : "required"}"></label>
        <div class="hint">${esc(f.help)}${f.set && f.source === "app" ? ` <button type="button" class="ghost linkish" data-act="clear" data-field="${esc(f.name)}">Remove saved</button>` : ""}</div></div>`).join("")}
      <div class="toolbar" style="margin:8px 0 4px"><button type="button" class="primary" data-act="save">Save details</button></div></details>`;
  }
  const MCP_HINT = {
    dhan: "Dhan's official MCP server: copy its URL from docs.dhanhq.co/mcp → Installation. Your saved client ID and access token are sent with each request; if the server asks for consent, a Dhan login page opens.",
    indmoney: "INDmoney's official MCP server (mcp.indmoney.com, read-only by design). Press Connect: INDmoney's own page opens; sign in with mobile, OTP and MPIN and approve. No API key or daily token needed. Sync brings Indian stocks into My holdings, mutual funds and US stocks into Net worth.",
    angel: "Angel One has no official MCP server. Enter the URL of one you run, or set ANGEL_MCP_COMMAND in .env to start a local one (e.g. a community SmartAPI MCP server); your saved API key, client ID, PIN and TOTP secret are passed to it."
  };
  function mcpBlock(b) {
    const m = b.mcp; if (!m) return "";
    const on = m.via === "mcp";
    const toggle = `<div class="seg" role="group" aria-label="Connection"><span class="hint">Connection:</span> <button type="button" data-act="via" data-via="api" class="${on ? "ghost" : "primary"}">Broker API</button><button type="button" data-act="via" data-via="mcp" class="${on ? "primary" : "ghost"}">MCP server</button></div>`;
    if (!on) return toggle;
    const src = m.transport === "stdio" ? `Local server: <code>${esc(m.command)}</code> (from .env)` : m.url ? `Server: <code>${esc(m.url)}</code>${m.urlSource === ".env" ? " (from .env)" : m.urlSource === "built-in" ? " (official, built in)" : ""}` : '<span class="wait">No MCP server set yet.</span>';
    return `${toggle}<div class="mcpbox"><p class="hint">${esc(MCP_HINT[b.id])}</p><div class="hint">${src}</div>
      <div class="toolbar" style="margin:6px 0"><input name="mcpUrl" placeholder="${esc(m.url || "https://… MCP server URL")}" style="min-width:180px"><button type="button" class="ghost" data-act="mcpurl">Save URL</button>${m.urlSource === "app" ? '<button type="button" class="ghost" data-act="mcpurlclear">Clear</button>' : ""}</div>
      <div class="hint mcpstate">${m.configured ? "Checking the MCP server…" : ""}</div>
      ${m.configured ? '<div class="toolbar" style="margin:6px 0"><button type="button" class="primary" data-act="mcpconnect">Connect</button><button type="button" class="ghost" data-act="mcptools">Show tools</button><button type="button" class="ghost" data-act="mcppreview" title="Read the holdings tool once and show what came back">Test holdings</button><button type="button" class="ghost" data-act="mcpdisconnect">Disconnect</button></div><div class="mcptools"></div>' : ""}</div>`;
  }
  async function renderMcpState(id) {
    const box = $(`[data-broker="${id}"] .mcpstate`); if (!box) return null;
    const s = await api(`/api/brokers/${id}/mcp/status`).catch(e => ({ error: e.message }));
    const who = s.profile ? ` as <b>${esc(s.profile.name || s.profile.userId)}</b>${s.profile.name ? ` (${esc(s.profile.userId)})` : ""}` : "";
    box.innerHTML = s.connected ? `<span class="buy">MCP connected</span>${who} · holdings tool: <code>${esc(s.tools?.holdings || "none found")}</code> · ${s.tools?.allowed?.length || 0} read-only tools usable, ${s.tools?.blocked?.length || 0} trading/other tools blocked`
      : s.authRequired ? '<span class="wait">The MCP server needs you to log in.</span> Press <b>Connect</b>.'
      : s.loginRequired ? '<span class="wait">Not logged in on the MCP server.</span> Press <b>Connect</b>.'
      : `<span class="avoid">MCP not reachable:</span> ${esc(s.error || "unknown error")}`;
    return s;
  }
  function brokerCard(b) {
    const who = b.profile ? `${esc(b.profile.name || b.profile.userId)}${b.profile.name ? ` (${esc(b.profile.userId)})` : ""}` : "";
    const state = b.connected ? `<span class="buy">Connected</span> as <b>${who}</b>${b.tokenFromSettings ? " (saved access token)" : ""}${b.autoLogin ? " · auto-login on" : ""}${b.expiresAt ? ` · token valid until ${esc(new Date(b.expiresAt).toString() === "Invalid Date" ? b.expiresAt : new Date(b.expiresAt).toLocaleString("en-IN"))}` : ""}`
      : b.setupHint ? `<span class="wait">Not set up.</span> ${esc(b.setupHint)}`
      : b.error ? `<span class="avoid">Error:</span> ${esc(b.error)}` : "Not connected. Choose a login method below.";
    const forms = b.modes.map(m => `<div class="broker-mode" data-mode="${esc(m.mode)}"><div class="hint">${esc(m.label)}</div><div class="toolbar" style="margin:6px 0 10px">${m.fields.map(f => `<input name="${esc(f.name)}" type="${f.type === "password" ? "password" : "text"}" placeholder="${esc(f.label)}" autocomplete="off" ${f.name === "totp" ? 'inputmode="numeric" maxlength="6" style="min-width:110px;flex:none"' : 'style="min-width:150px"'}>`).join("")}<button type="button" class="${b.connected ? "ghost" : "primary"}" data-act="login">${m.fields.length ? "Connect" : "Connect now"}</button></div></div>`).join("");
    const login = !b.modes.length ? "" : b.connected ? `<details><summary class="hint" style="cursor:pointer">Reconnect or switch account</summary>${forms}</details>` : forms;
    const viaMcp = b.mcp?.via === "mcp";
    return `<div class="report-card" data-broker="${esc(b.id)}"><h3>${esc(b.name)}${viaMcp ? ' <span class="chip v-fair">via MCP</span>' : ""}</h3><p class="hint">${BROKER_INFO[b.id] || ""}</p>${b.id === "indmoney" && viaMcp ? "" : settingsBlock(b)}${mcpBlock(b)}${viaMcp ? "" : `<div class="hint bstate">${state}</div>${login}`}
      <div class="toolbar" style="margin:8px 0 0"><button type="button" class="primary" data-act="sync" ${b.connected || (viaMcp && b.mcp.configured) ? "" : "disabled"}>Sync holdings</button>${viaMcp ? "" : `<button type="button" class="ghost" data-act="disconnect" ${b.connected && !b.tokenFromSettings ? "" : "disabled"}>Disconnect</button>`}<input name="label" placeholder="Account label (optional)" style="min-width:150px"></div><div class="hint bmsg"></div></div>`;
  }
  async function renderBrokers() {
    const box = $("#intBrokers"); if (!box) return;
    try { const x = await api("/api/brokers/status"); box.innerHTML = x.brokers.map(brokerCard).join(""); x.brokers.filter(b => b.mcp?.via === "mcp" && b.mcp.configured).forEach(b => renderMcpState(b.id)); }
    catch (e) { box.innerHTML = `<div class="report-card"><p class="hint">Broker status unavailable: ${esc(e.message)}</p></div>`; }
  }
  $("#intBrokers").onclick = async e => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const card = btn.closest("[data-broker]"), id = card.dataset.broker, msg = m => { card.querySelector(".bmsg").innerHTML = m; };
    const act = btn.dataset.act, old = btn.textContent; btn.disabled = true;
    try {
      if (act === "login") {
        const mode = btn.closest(".broker-mode"), body = { mode: mode.dataset.mode };
        mode.querySelectorAll("input").forEach(i => { body[i.name] = i.value.trim(); });
        btn.textContent = "Connecting…"; await post(`/api/brokers/${id}/login`, body);
        await renderBrokers(); $(`[data-broker="${id}"] .bmsg`).innerHTML = '<span class="buy">Connected.</span> Press Sync holdings.';
        return;
      }
      if (act === "sync") { btn.textContent = "Syncing…"; btn.classList.add("is-loading"); try { const v = await post(`/api/brokers/${id}/sync`, { label: card.querySelector('input[name="label"]').value }); renderHoldings(v); await renderBrokers(); $(`[data-broker="${id}"] .bmsg`).innerHTML = '<span class="buy">Synced.</span> Open My holdings to see them.'; announceSync(v); } finally { btn.classList.remove("is-loading"); } return; }
      if (act === "disconnect") { await post(`/api/brokers/${id}/disconnect`); await renderBrokers(); }
      if (act === "via") { await post(`/api/brokers/${id}/mcp/config`, { via: btn.dataset.via }); await renderBrokers(); return; }
      if (act === "mcpurl" || act === "mcpurlclear") {
        const u = act === "mcpurl" ? card.querySelector('input[name="mcpUrl"]').value.trim() : "";
        if (act === "mcpurl" && !u) { msg("Paste the MCP server URL first."); return; }
        await post(`/api/brokers/${id}/mcp/config`, { url: u }); await renderBrokers(); return;
      }
      if (act === "mcptools") {
        btn.textContent = "Loading…"; const x = await api(`/api/brokers/${id}/mcp/tools`);
        card.querySelector(".mcptools").innerHTML = `<ul class="flag-list">${x.tools.map(t => `<li><div class="fnote">${t.allowed ? '<span class="buy">✓ usable</span>' : '<span class="avoid">✗ blocked</span>'} <code>${esc(t.name)}</code> ${esc(t.description)}</div></li>`).join("")}</ul>`; return;
      }
      if (act === "mcppreview") {
        btn.textContent = "Reading…"; btn.disabled = true;
        try { const x = await api(`/api/brokers/${id}/mcp/preview`); card.querySelector(".mcptools").innerHTML = `<p class="hint">Tool <code>${esc(x.tool || "?")}</code> answered${x.choices?.length && x.choices[0] !== null ? ` (asset types read: ${x.choices.map(esc).join(", ")})` : ""}. This app read: ${Object.entries(x.counts).map(([k, v]) => `${esc(k)} ${v}`).join(" · ")}. If something is missing, send the reply below to whoever maintains the app.</p><pre class="mcp-raw">${esc(x.raw)}</pre>`; }
        finally { btn.textContent = "Test holdings"; btn.disabled = false; }
        return;
      }
      if (act === "mcpdisconnect") { await post(`/api/brokers/${id}/mcp/disconnect`); await renderBrokers(); return; }
      if (act === "mcpconnect") {
        btn.textContent = "Connecting…";
        let x; try { x = await post(`/api/brokers/${id}/mcp/connect`); } catch (e2) { if (!e2.loginUrl) throw e2; x = { loginUrl: e2.loginUrl }; }
        const link = x.authUrl || x.loginUrl;
        if (!link) { await renderMcpState(id); msg('<span class="buy">Connected.</span> Press Sync holdings.'); return; }
        window.open(link, "_blank", "noopener");
        msg(`<a href="${esc(link)}" target="_blank" rel="noopener"><b>Open the ${esc(card.querySelector("h3").firstChild.textContent.trim())} login page</b></a> (use this link if no tab opened) and approve. This card updates by itself when you are done.`);
        let tries = 0; const t = setInterval(async () => { tries++; const s2 = await renderMcpState(id); if (s2?.connected || tries >= 60) { clearInterval(t); if (s2?.connected) msg('<span class="buy">MCP connected.</span> Press Sync holdings.'); } }, 3000);
        return;
      }
      if (act === "save" || act === "clear") {
        const values = {}; if (act === "save") card.querySelectorAll(".bsettings input").forEach(i => { if (i.value.trim()) values[i.name] = i.value.trim(); });
        if (act === "save" && !Object.keys(values).length) { msg("Type at least one detail to save."); return; }
        if (act === "clear" && !(await ui.confirm({ title: "Remove this saved detail?", message: "It is deleted from this computer only.", okText: "Remove", danger: true }))) return;
        btn.textContent = act === "save" ? "Saving & connecting…" : "Removing…";
        const st = await post(`/api/brokers/${id}/settings`, act === "save" ? { values } : { clear: [btn.dataset.field] });
        await renderBrokers();
        $(`[data-broker="${id}"] .bmsg`).innerHTML = act === "clear" ? "Removed." : st.connected ? '<span class="buy">Saved and connected.</span> Press Sync holdings.' : `Saved.${st.error ? ` <span class="avoid">${esc(st.error)}</span>` : " Now connect below."}`;
      }
    } catch (err) {
      msg(err.loginUrl ? `<a href="${esc(err.loginUrl)}" target="_blank" rel="noopener"><b>Open the login page</b></a> to finish signing in, then press Sync holdings again.` : `<span class="avoid">${err.loginRequired ? "Session expired or not logged in — connect again." : "Failed:"}</span> ${esc(err.message)}`);
      if (err.loginRequired && !err.loginUrl && act !== "login" && !act.startsWith("mcp")) renderBrokers().then(() => $(`[data-broker="${id}"] .bmsg`).innerHTML = `<span class="avoid">Session expired — connect again.</span> ${esc(err.message)}`);
    } finally { if (btn.isConnected) { btn.textContent = old; btn.disabled = false; } }
  };

  window.loadIntegrations = () => { renderSources(); renderKite(); renderBrokers(); };
})();
