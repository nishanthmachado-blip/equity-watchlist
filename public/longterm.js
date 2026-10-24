// Long-term themes: your Growth / Dividends / Others (any names) stock lists, with a "buy in bulk now" signal when a
// stock gets cheap (buy zone, a dip from its 52-week high, or a high dividend yield) and the amount your plan puts in.
// Alerts (bell, phone, morning brief) fire when a stock turns into a bulk-buy chance. Reads /api/themes. Not advice.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
  const px = v => (fin(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : "—");
  const amt = v => (!fin(v) ? "—" : v >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : inr(v));
  const api = async (url, body) => { const r = await fetch(url, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  const SIG = { strong: ["🔥 Strong bulk buy", "lt-strong"], bulk: ["💰 Bulk buy", "lt-bulk"], near: ["👀 Getting close", "lt-near"], wait: ["Wait", "lt-wait"], "no-price": ["No price yet", "lt-wait"] };
  let data = null, timer = null;
  async function load() {
    clearTimeout(timer);
    try { data = await api("/api/themes"); render(); } catch (e) { $("#ltBody").innerHTML = `<p class="hint">Could not load your plan: ${esc(e.message)}</p>`; }
    if (!$("#ltView").hidden && (data?.fetching || data?.marketOpen)) timer = setTimeout(load, data?.fetching ? 15000 : 120000);
  }
  const plainPlan = () => ({ corpus: data.corpus, alerts: data.alerts, themes: data.themes.map(t => ({ id: t.id, name: t.name, icon: t.icon, targetPct: t.targetPct, dipPct: t.dipPct, minYield: t.minYield, bulk: t.bulk, symbols: t.rows.map(r => ({ symbol: r.symbol, name: r.name, exchange: r.exchange })) })) });
  async function save(plan, msg) { try { data = await api("/api/themes/save", plan); render(); if (msg) window.toast?.(msg, { kind: "ok", ms: 3500 }); } catch (e) { window.toast?.(esc(e.message), { kind: "bad" }); } }

  function render() {
    const d = data;
    $("#ltTools").hidden = !d.themes.length;
    if (!d.themes.length) {
      $("#ltSum").innerHTML = "";
      $("#ltBody").innerHTML = `<div class="report-card lt-empty"><h3>🧭 Plan your long-term stocks by theme</h3><p>Put the stocks you want to own for years into themes (Growth, Dividends, Others…). The app watches them and tells you when one gets cheap enough to <b>buy in bulk</b>: in its buy zone, a set % under its 52-week high, or (for dividend themes) a high enough yield.</p>
        <p class="hint">Fastest way: copy the columns from your spreadsheet (theme names on the top row) and paste them here.</p><div class="toolbar"><button type="button" data-lt="paste">📋 Paste my list</button><button type="button" class="ghost" data-lt="new">+ Start an empty theme</button></div></div>`;
      $("#ltNotes").innerHTML = ""; return;
    }
    const c = d.counts;
    $("#ltSum").innerHTML = `<div class="lt-tiles">${d.themes.map(t => `<a class="lt-tile" href="#lt-${esc(t.id)}"><span>${t.icon} ${esc(t.name)}</span><strong>${amt(t.value)}</strong><small>${t.actualPct}% of plan · target ${t.targetPct}%</small><i class="lt-bar"><b style="width:${Math.min(100, t.actualPct)}%"></b><u style="left:${Math.min(100, t.targetPct)}%"></u></i><small>${t.rows.filter(r => r.signal === "bulk" || r.signal === "strong").length} to buy now · ${t.rows.filter(r => r.signal === "near").length} close</small></a>`).join("")}</div>`;
    const now = d.bulkNow.length ? `<section class="report-card lt-now"><div class="nw-head"><h3>💰 Buy in bulk now <span class="hint">${d.bulkNow.length} stock${d.bulkNow.length === 1 ? "" : "s"}${d.bulkTotal ? ` · about ${amt(d.bulkTotal)} by your plan` : ""}</span></h3></div><ul class="lt-now-list">${d.bulkNow.map(x => `<li data-sym="${esc(x.symbol)}"><div><b>${x.icon} ${esc(x.name)}</b> <span class="ticker">${x.name !== x.symbol ? `${esc(x.symbol)} · ` : ""}${esc(x.theme)}</span> <span class="lt-sig ${SIG[x.signal][1]}">${SIG[x.signal][0]}</span></div><div class="lt-now-amt">${px(x.price)}${x.amount ? ` · <b>${amt(x.amount)}</b> ≈ ${x.qty} shares` : ""}</div><div class="hint">${esc(x.reasons.join(" · "))}</div></li>`).join("")}</ul></section>`
      : `<p class="hint lt-none">Nothing is cheap enough for a bulk buy right now${c.near ? `: ${c.near} stock${c.near === 1 ? " is" : "s are"} getting close (👀 below)` : ""}. You get an alert ${d.alerts ? "the moment one is" : "(alerts are off: ⚙ Plan settings)"}.</p>`;
    $("#ltBody").innerHTML = now + d.themes.map(t => `<section class="report-card lt-theme" id="lt-${esc(t.id)}" data-theme-id="${esc(t.id)}">
      <div class="nw-head"><h3>${t.icon} ${esc(t.name)} <span class="hint">${t.rows.length} stock${t.rows.length === 1 ? "" : "s"} · you hold ${amt(t.value)} (${t.actualPct}% of plan, target ${t.targetPct}%)${t.room ? ` · room ${amt(t.room)}` : ""}</span></h3>
        <span class="hint">bulk ${amt(t.bulk)} · dip ${t.dipPct}% off the high${t.minYield ? ` · yield ≥ ${t.minYield}%` : ""} <button type="button" class="ghost lt-edit" data-lt="edit" data-id="${esc(t.id)}">⚙ Edit</button></span></div>
      ${t.rows.length ? `<div class="table-wrap"><table class="lt-table"><thead><tr><th>Stock</th><th class="num">Price</th><th>Signal</th><th class="num" title="The price that makes it a bulk buy: the top of the buy zone or your dip level, whichever comes first">Buy at</th><th class="num">Buy zone</th><th class="num" title="Distance from the 52-week high">Off high</th>${t.minYield ? '<th class="num">Yield</th>' : ""}<th class="num">You hold</th><th>Why</th></tr></thead><tbody>${t.rows.map(r => `<tr data-sym="${esc(r.symbol)}" class="${SIG[r.signal]?.[1] || ""}-row">
        <td><div class="company">${esc(r.name)} <button type="button" class="ch-mini" data-chart="${esc(r.symbol)}" data-chart-name="${esc(r.name)}" title="Price chart" aria-label="Chart">📈</button></div><div class="ticker">${r.name !== r.symbol ? `${esc(r.symbol)}` : ""}${r.levels.view ? ` · ${esc(r.levels.view)}` : r.tracked ? " · not valued yet" : " · fetching…"}</div></td>
        <td class="num"><b>${px(r.price)}</b></td><td><span class="lt-sig ${SIG[r.signal]?.[1] || ""}">${SIG[r.signal]?.[0] || r.signal}</span>${r.amount ? `<div class="ticker">${amt(r.amount)} ≈ ${r.qty} sh</div>` : ""}</td>
        <td class="num">${r.signal === "bulk" || r.signal === "strong" ? '<b class="pl-up">✓ now</b>' : r.levels.buyAt ? `${px(Math.round(r.levels.buyAt * 100) / 100)}${fin(r.levels.toBuyPct) ? `<div class="ticker">${r.levels.toBuyPct}%</div>` : ""}` : "—"}</td>
        <td class="num">${fin(r.levels.zoneLow) ? `${inr(r.levels.zoneLow)}–${inr(r.levels.zoneHigh)}` : "—"}</td>
        <td class="num">${fin(r.levels.offHigh) ? `−${r.levels.offHigh}%<div class="ticker">high ${inr(r.levels.high)}</div>` : "—"}</td>
        ${t.minYield ? `<td class="num">${fin(r.levels.yield) ? `${r.levels.yield}%` : "—"}</td>` : ""}
        <td class="num">${r.held ? `${amt(r.held.value)}${fin(r.held.pnlPct) ? `<div class="ticker ${r.held.pnlPct >= 0 ? "pl-up" : "pl-dn"}">${r.held.pnlPct >= 0 ? "+" : ""}${r.held.pnlPct}%</div>` : ""}` : '<span class="hint">—</span>'}</td>
        <td class="lt-why">${esc(r.reasons.join(" · ") || (r.levels.buyAt ? `Bulk buy at ${px(Math.round(r.levels.buyAt))} or lower` : ""))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">No stocks yet: ⚙ Edit to add some.</p>'}</section>`).join("");
    const notes = [];
    if (d.fetching) notes.push(`Fetching prices and fundamentals for ${d.fetching} stock${d.fetching === 1 ? "" : "s"} new to the app (they are tracked, not added to a watchlist). This page updates by itself.`);
    if (c.unvalued) notes.push(`${c.unvalued} stock${c.unvalued === 1 ? " has" : "s have"} no valuation yet, so only the dip ${d.themes.some(t => t.minYield) ? "and yield rules apply" : "rule applies"} to ${c.unvalued === 1 ? "it" : "them"}.`);
    if (d.outsidePlan > 0) notes.push(`${amt(d.outsidePlan)} of your holdings is in stocks outside these themes.`);
    $("#ltNotes").innerHTML = `${notes.map(n => `<p class="hint">${n}</p>`).join("")}<p class="vs-fine">Bulk buy = in the app's buy zone, or the price is your dip % under its 52-week high (or, for themes with a minimum yield, the dividend yield reaches it), unless the valuation still calls the stock rich. Strong = below the buy zone, or in it after a big dip: the plan puts 1.5× your bulk amount there. ${d.corpus ? `Amounts are capped by each theme's room to its target share of ${amt(d.corpus)}.` : "Set a plan size (⚙ Plan settings) to cap amounts by each theme's target share."} Alerts: bell, phone and the morning brief, at most once every 3 days per stock unless it turns strong. A screen, not advice.</p>`;
  }

  // ---- dialogs ----
  const field = (label, name, value, attrs = "") => `<label class="ui-field"><span>${label}</span><input class="ui-input" name="${name}" value="${esc(value ?? "")}" ${attrs}></label>`;
  async function editTheme(t) {
    const isNew = !t; t = t || { name: "", icon: "🚀", targetPct: "", dipPct: "", minYield: "", bulk: 50000, rows: [] };
    const out = await window.ui.dialog({ title: isNew ? "New theme" : `Edit ${t.name}`, icon: t.icon || "🧭", okText: "Save", wide: true,
      bodyHtml: `<div class="lt-form">${field("Theme name", "name", t.name, 'placeholder="e.g. Growth, Dividends, Others"')}
        <label class="ui-field"><span>Icon</span><select class="ui-input" name="icon">${(data?.icons || ["🚀", "💰", "🧩"]).map(i => `<option${i === t.icon ? " selected" : ""}>${i}</option>`).join("")}</select></label>
        ${field("Target share of the plan (%)", "targetPct", t.targetPct, 'inputmode="decimal" placeholder="default by theme"')}${field("Bulk buy when this % under the 52-week high", "dipPct", t.dipPct, 'inputmode="decimal" placeholder="growth 25, dividends 15, others 20"')}
        ${field("…or when the dividend yield is at least (%) — leave empty to skip", "minYield", t.minYield ?? "", 'inputmode="decimal" placeholder="e.g. 3"')}${field("Bulk amount per stock (₹)", "bulk", t.bulk, 'inputmode="numeric"')}</div>
        <label class="ui-field"><span>Stocks (NSE symbols, comma or space separated)</span><textarea class="ui-input" name="symbols" rows="4" placeholder="e.g. BSE, MCX, CDSL">${esc(t.rows.map(r => r.symbol).join(", "))}</textarea></label>
        ${isNew ? "" : '<label class="ui-opt"><input type="checkbox" name="del"><span><b>Delete this theme</b><small>Only the plan changes; nothing at your broker.</small></span></label>'}`,
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`)?.value ?? "", plan = plainPlan();
        if (box.querySelector("[name=del]")?.checked) { plan.themes = plan.themes.filter(x => x.id !== t.id); return { plan, msg: `${t.name} deleted.` }; }
        const name = v("name").trim(); if (!name) throw new Error("Give the theme a name.");
        const syms = v("symbols").toUpperCase().split(/[\s,;]+/).map(s => s.trim()).filter(Boolean);
        const bad = syms.filter(s => !/^[A-Z0-9&-]{1,20}$/.test(s)); if (bad.length) throw new Error(`Not NSE symbols: ${bad.slice(0, 5).join(", ")}. Use 📋 Paste my list to look up company names.`);
        const prev = new Map(t.rows.map(r => [r.symbol, r]));
        const theme = { id: t.id, name, icon: v("icon"), targetPct: v("targetPct"), dipPct: v("dipPct"), minYield: v("minYield"), bulk: v("bulk"), symbols: syms.map(s => ({ symbol: s, name: prev.get(s)?.name || null, exchange: prev.get(s)?.exchange || "NSE" })) };
        plan.themes = isNew ? [...plan.themes, theme] : plan.themes.map(x => (x.id === t.id ? theme : x));
        return { plan, msg: `${name} saved.` };
      } });
    if (out) await save(out.plan, out.msg);
  }
  async function settings() {
    const out = await window.ui.dialog({ title: "Plan settings", icon: "⚙️", okText: "Save",
      bodyHtml: `${field("Plan size (₹, optional): the total you mean to have in these stocks", "corpus", data.corpus ?? "", 'inputmode="numeric" placeholder="e.g. 50,00,000"')}
        <label class="ui-opt"><input type="checkbox" name="alerts"${data.alerts ? " checked" : ""}><span><b>Alert me on bulk-buy chances</b><small>Bell, phone (Telegram / push when set up) and the morning brief.</small></span></label>`,
      collect: box => ({ corpus: box.querySelector("[name=corpus]").value.trim() || null, alerts: box.querySelector("[name=alerts]").checked }) });
    if (out) await save({ ...plainPlan(), ...out }, "Plan settings saved.");
  }
  async function paste() {
    const text = await window.ui.dialog({ title: "Paste your list", icon: "📋", okText: "Look up the stocks", wide: true,
      message: "Copy the columns from your spreadsheet with the theme names on the top row (empty columns in between are fine) and paste them here. Company names or NSE symbols both work. Or type lines like <code>Growth: BSE, MCX, CDSL</code>.",
      bodyHtml: '<textarea class="ui-input" name="text" rows="10" placeholder="Growth&#9;Dividends&#9;Others&#10;GROWW&#9;HCL Tech&#9;Kayne&#10;BSE&#9;ITC&#9;KEI"></textarea>',
      collect: async box => { const t = box.querySelector("[name=text]").value; if (!t.trim()) throw new Error("Paste your list first."); return api("/api/themes/paste", { text: t }); } });
    if (!text) return;
    const groups = text.themes;
    const out = await window.ui.dialog({ title: "Check the stocks", icon: "🔎", okText: data.themes.length ? "Save" : "Create my plan", wide: true,
      message: `${groups.reduce((a, g) => a + g.items.length, 0)} stocks in ${groups.length} theme${groups.length === 1 ? "" : "s"}. Fix any that were matched wrongly or not found.`,
      bodyHtml: `${groups.map((g, gi) => `<h4 class="lt-pg">${g.icon} <input class="ui-input lt-gname" data-g="${gi}" value="${esc(g.name)}"></h4><table class="lt-pick"><tbody>${g.items.map((it, ii) => `<tr><td>${esc(it.input)}</td><td>→</td><td>${!it.symbol && !it.options?.length ? `<input class="ui-input" data-g="${gi}" data-i="${ii}" value="" placeholder="not found: type NSE symbol (or skip)">` : it.options?.length > 1 || !it.symbol ? `<select class="ui-input" data-g="${gi}" data-i="${ii}">${it.symbol ? "" : '<option value="">— not found: skip —</option>'}${[...(it.symbol ? [{ symbol: it.symbol, name: it.name }] : []), ...(it.options || []).filter(o => o.symbol !== it.symbol)].map(o => `<option value="${esc(o.symbol)}">${esc(o.symbol)} · ${esc(o.name)}</option>`).join("")}</select>` : `<input class="ui-input" data-g="${gi}" data-i="${ii}" value="${esc(it.symbol)}" title="${esc(it.name)}">`}${it.symbol && it.name && it.name !== it.symbol ? `<div class="hint lt-pn">${esc(it.name)}</div>` : ""}</td></tr>`).join("")}</tbody></table>`).join("")}
        ${data.themes.length ? '<label class="ui-opt"><input type="checkbox" name="replace"><span><b>Replace my current plan</b><small>Otherwise these are added to themes with the same name, or as new themes.</small></span></label>' : ""}`,
      collect: box => {
        const plan = plainPlan(), replace = !data.themes.length || box.querySelector("[name=replace]")?.checked;
        const fresh = groups.map((g, gi) => ({ name: box.querySelector(`.lt-gname[data-g="${gi}"]`).value.trim() || g.name, icon: g.icon, targetPct: g.targetPct, dipPct: g.dipPct, minYield: g.minYield, bulk: 50000,
          symbols: g.items.map((it, ii) => { const s = String(box.querySelector(`[data-g="${gi}"][data-i="${ii}"]`)?.value || "").toUpperCase().trim(); return s ? { symbol: s, name: s === it.symbol ? it.name : null } : null; }).filter(Boolean) }));
        if (replace) return { ...plan, themes: fresh };
        for (const f of fresh) { const same = plan.themes.find(t => t.name.toLowerCase() === f.name.toLowerCase()); if (same) { const have = new Set(same.symbols.map(s => s.symbol)); same.symbols.push(...f.symbols.filter(s => !have.has(s.symbol))); } else plan.themes.push(f); }
        return plan;
      } });
    if (out) await save(out, "Plan saved. Prices and valuations for new stocks load in the background.");
  }

  const init = () => {
    const v = $("#ltView"); if (!v) return;
    v.addEventListener("click", e => {
      const b = e.target.closest("[data-lt]");
      if (b) { const k = b.dataset.lt; if (k === "paste") paste(); else if (k === "new") editTheme(null); else if (k === "settings") settings(); else if (k === "reload") load(); else if (k === "edit") editTheme(data.themes.find(t => t.id === b.dataset.id)); return; }
      if (e.target.closest("button, a, input, select")) return;
      const row = e.target.closest("[data-sym]"); if (row && typeof window.openStockSheet === "function") window.openStockSheet(row.dataset.sym, { back: "Long-term themes" });
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init(); // loaded on demand (app.js LAZY_VIEWS)
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.longterm = () => load();
})();
