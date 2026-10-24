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
  // Reorder themes (drag a table by ⠿ or a tile at the top, or ↑ ↓): saved in your plan, so every screen and the
  // morning brief follow the same order
  async function reorder(ids, msg = "Order saved.") {
    const plan = plainPlan(), pos = new Map(ids.map((id, i) => [id, i]));
    plan.themes.sort((a, b) => (pos.get(a.id) ?? 99) - (pos.get(b.id) ?? 99));
    if (plan.themes.map(t => t.id).join() === data.themes.map(t => t.id).join()) return;
    data.themes.sort((a, b) => (pos.get(a.id) ?? 99) - (pos.get(b.id) ?? 99)); render(); // show it at once
    await save(plan, msg);
  }
  function wireDrag(root) {
    let dragId = null;
    const ids = () => data.themes.map(t => t.id);
    root.addEventListener("dragstart", e => {
      const el = e.target.closest?.(".lt-grip, .lt-tile"); if (!el) return;
      const item = el.closest("[data-drag-id]"); dragId = item.dataset.dragId;
      e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", dragId); } catch { /* old browsers */ }
      if (item.classList.contains("lt-theme")) try { e.dataTransfer.setDragImage(item, 30, 20); } catch { /* optional */ }
      requestAnimationFrame(() => item.classList.add("lt-dragging"));
    });
    root.addEventListener("dragover", e => {
      if (!dragId) return; const over = e.target.closest?.("[data-drag-id]"); if (!over) return;
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      root.querySelectorAll(".lt-drop-before,.lt-drop-after").forEach(x => x.classList.remove("lt-drop-before", "lt-drop-after"));
      if (over.dataset.dragId === dragId) return;
      const r = over.getBoundingClientRect(), tile = over.classList.contains("lt-tile"), after = tile ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
      over.classList.add(after ? "lt-drop-after" : "lt-drop-before");
    });
    root.addEventListener("drop", e => {
      if (!dragId) return; e.preventDefault();
      const over = root.querySelector(".lt-drop-before, .lt-drop-after"), from = dragId; dragId = null;
      if (!over) return render();
      const list = ids().filter(id => id !== from), at = list.indexOf(over.dataset.dragId) + (over.classList.contains("lt-drop-after") ? 1 : 0);
      list.splice(at, 0, from); reorder(list);
    });
    root.addEventListener("dragend", () => { dragId = null; root.querySelectorAll(".lt-dragging,.lt-drop-before,.lt-drop-after").forEach(x => x.classList.remove("lt-dragging", "lt-drop-before", "lt-drop-after")); });
  }
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
    $("#ltSum").innerHTML = `<div class="lt-tiles">${d.themes.map(t => `<div class="lt-tile" role="button" tabindex="0" draggable="true" data-drag-id="${esc(t.id)}" data-jump="${esc(t.id)}" title="Click to jump to ${esc(t.name)} · drag to reorder"><span>${t.icon} ${esc(t.name)}</span><strong>${amt(t.value)}</strong><small>${t.actualPct}% of plan · target ${t.targetPct}%</small><i class="lt-bar"><b style="width:${Math.min(100, t.actualPct)}%"></b><u style="left:${Math.min(100, t.targetPct)}%"></u></i><small>${t.rows.filter(r => r.signal === "bulk" || r.signal === "strong").length} to buy now · ${t.rows.filter(r => r.signal === "near").length} close</small></div>`).join("")}</div>`;
    const now = d.bulkNow.length ? `<section class="report-card lt-now"><div class="nw-head"><h3>💰 Buy in bulk now <span class="hint">${d.bulkNow.length} stock${d.bulkNow.length === 1 ? "" : "s"}${d.bulkTotal ? ` · about ${amt(d.bulkTotal)} by your plan` : ""}</span></h3></div><ul class="lt-now-list">${d.bulkNow.map(x => `<li data-sym="${esc(x.symbol)}"><div><b>${x.icon} ${esc(x.name)}</b> <span class="ticker">${x.name !== x.symbol ? `${esc(x.symbol)} · ` : ""}${esc(x.theme)}</span> <span class="lt-sig ${SIG[x.signal][1]}">${SIG[x.signal][0]}</span></div><div class="lt-now-amt">${px(x.price)}${x.amount ? ` · <b>${amt(x.amount)}</b> ≈ ${x.qty} shares` : ""}</div><div class="hint">${esc(x.reasons.join(" · "))}</div></li>`).join("")}</ul></section>`
      : `<p class="hint lt-none">Nothing is cheap enough for a bulk buy right now${c.near ? `: ${c.near} stock${c.near === 1 ? " is" : "s are"} getting close (👀 below)` : ""}. You get an alert ${d.alerts ? "the moment one is" : "(alerts are off: ⚙ Plan settings)"}.</p>`;
    $("#ltBody").innerHTML = now + d.themes.map(t => `<section class="report-card lt-theme" id="lt-${esc(t.id)}" data-theme-id="${esc(t.id)}" data-drag-id="${esc(t.id)}">
      <div class="nw-head"><h3><span class="lt-grip" draggable="true" title="Drag to move this table" aria-hidden="true">⠿</span>${t.icon} ${esc(t.name)} <span class="hint">${t.rows.length} stock${t.rows.length === 1 ? "" : "s"} · you hold ${amt(t.value)} (${t.actualPct}% of plan, target ${t.targetPct}%)${t.room ? ` · room ${amt(t.room)}` : ""}</span></h3>
        <span class="hint">bulk ${amt(t.bulk)} · dip ${t.dipPct}% off the high${t.minYield ? ` · yield ≥ ${t.minYield}%` : ""} <span class="lt-move"><button type="button" class="ghost" data-move="-1" data-id="${esc(t.id)}" title="Move up" aria-label="Move ${esc(t.name)} up"${d.themes[0].id === t.id ? " disabled" : ""}>↑</button><button type="button" class="ghost" data-move="1" data-id="${esc(t.id)}" title="Move down" aria-label="Move ${esc(t.name)} down"${d.themes.at(-1).id === t.id ? " disabled" : ""}>↓</button></span><button type="button" class="ghost lt-edit" data-lt="edit" data-id="${esc(t.id)}">⚙ Edit</button></span></div>
      ${t.rows.length ? `<div class="table-wrap"><table class="lt-table"><thead><tr><th>Stock</th><th class="num">Price</th><th>Signal</th><th class="num" title="The price that makes it a bulk buy: the top of the buy zone or your dip level, whichever comes first">Buy at</th><th class="num">Buy zone</th><th class="num" title="Distance from the 52-week high">Off high</th>${t.minYield ? '<th class="num">Yield</th>' : ""}<th class="num">You hold</th><th>Why</th></tr></thead><tbody>${t.rows.map(r => `<tr data-sym="${esc(r.symbol)}" class="${SIG[r.signal]?.[1] || ""}-row">
        <td><div class="company">${esc(r.name)} <button type="button" class="ch-mini" data-chart="${esc(r.symbol)}" data-chart-name="${esc(r.name)}" title="Price chart" aria-label="Chart">📈</button></div><div class="ticker">${r.known === false ? '<b class="pl-dn">⚠ not found on NSE: ⚙ Edit to replace</b> · ' : ""}${[r.name !== r.symbol ? esc(r.symbol) : "", r.levels.view ? esc(r.levels.view) : r.tracked ? "not valued yet" : "fetching…"].filter(Boolean).join(" · ")}</div></td>
        <td class="num"><b>${px(r.price)}</b></td><td><span class="lt-sig ${SIG[r.signal]?.[1] || ""}">${SIG[r.signal]?.[0] || r.signal}</span>${r.amount ? `<div class="ticker">${amt(r.amount)} ≈ ${r.qty} sh</div>` : ""}</td>
        <td class="num">${r.signal === "bulk" || r.signal === "strong" ? '<b class="pl-up">✓ now</b>' : r.levels.buyAt ? `${px(Math.round(r.levels.buyAt * 100) / 100)}${fin(r.levels.toBuyPct) ? `<div class="ticker">${r.levels.toBuyPct}%</div>` : ""}` : "—"}</td>
        <td class="num">${fin(r.levels.zoneLow) ? `${inr(r.levels.zoneLow)}–${inr(r.levels.zoneHigh)}` : "—"}</td>
        <td class="num">${fin(r.levels.offHigh) ? `−${r.levels.offHigh}%<div class="ticker">high ${inr(r.levels.high)}</div>` : "—"}</td>
        ${t.minYield ? `<td class="num">${fin(r.levels.yield) ? `${r.levels.yield}%` : "—"}</td>` : ""}
        <td class="num">${r.held?.value > 0 ? `${amt(r.held.value)}${fin(r.held.pnlPct) ? `<div class="ticker ${r.held.pnlPct >= 0 ? "pl-up" : "pl-dn"}">${r.held.pnlPct >= 0 ? "+" : ""}${r.held.pnlPct}%</div>` : ""}` : '<span class="hint">—</span>'}</td>
        <td class="lt-why">${esc(r.reasons.join(" · ") || (r.levels.buyAt ? `Bulk buy at ${px(Math.round(r.levels.buyAt))} or lower` : ""))}</td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">No stocks yet: ⚙ Edit to add some.</p>'}</section>`).join("");
    const notes = [];
    if (d.unknown) notes.push(`<b class="pl-dn">${d.unknown} symbol${d.unknown === 1 ? " is" : "s are"} not a listed NSE stock</b> (marked ⚠): open ⚙ Edit on the theme, remove ${d.unknown === 1 ? "it" : "them"} and add the right company from the search box.`);
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
        <div class="ui-field lt-stocks"><span>Stocks <small class="hint" data-count>${t.rows.length}</small></span>
          <div class="lt-srch"><input class="ui-input" data-lt-q placeholder="Add a stock: type a company name or NSE symbol" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-autocomplete="list"><div class="lt-drop" role="listbox" hidden></div></div>
          <ul class="lt-slist" data-lt-list></ul></div>
        ${isNew ? "" : '<label class="ui-opt"><input type="checkbox" name="del"><span><b>Delete this theme</b><small>Only the plan changes; nothing at your broker.</small></span></label>'}`,
      onOpen: box => { const by = new Map(t.rows.map(r => [r.symbol, r])); stockPicker(box, (t.symbols || t.rows).map(x => { const r = by.get(x.symbol) || x; return { symbol: x.symbol, name: r.name || x.name, exchange: x.exchange || r.exchange, unknown: r.known === false }; })); }, // in the order you added them
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`)?.value ?? "", plan = plainPlan();
        if (box.querySelector("[name=del]")?.checked) { plan.themes = plan.themes.filter(x => x.id !== t.id); return { plan, msg: `${t.name} deleted.` }; }
        const name = v("name").trim(); if (!name) throw new Error("Give the theme a name.");
        const list = box._ltStocks || [], bad = list.filter(x => x.unknown);
        if (bad.length) throw new Error(`Not found on NSE: ${bad.map(x => x.symbol).slice(0, 5).join(", ")}. Remove ${bad.length === 1 ? "it" : "them"} (✕) and add the right stock from the search box.`);
        const theme = { id: t.id, name, icon: v("icon"), targetPct: v("targetPct"), dipPct: v("dipPct"), minYield: v("minYield"), bulk: v("bulk"), symbols: list.map(x => ({ symbol: x.symbol, name: x.name || null, exchange: x.exchange || "NSE" })) };
        plan.themes = isNew ? [...plan.themes, theme] : plan.themes.map(x => (x.id === t.id ? theme : x));
        return { plan, msg: `${name} saved.` };
      } });
    if (out) await save(out.plan, out.msg);
  }
  // One row per stock, plus a search box that suggests companies as you type: ↑ ↓ to move, Enter adds the highlighted
  // one (the best match is highlighted as you type), Esc closes the list. Stocks not found on NSE are flagged.
  function stockPicker(box, initial) {
    const list = box._ltStocks = initial.slice(), q = box.querySelector("[data-lt-q]"), drop = box.querySelector(".lt-drop"), ul = box.querySelector("[data-lt-list]");
    let res = [], act = 0, seq = 0, tm = null;
    const draw = () => {
      ul.innerHTML = list.length ? list.map((x, i) => `<li class="${x.unknown ? "lt-bad" : ""}"><span class="lt-sn">${esc(x.name && x.name !== x.symbol ? x.name : x.symbol)}</span><small>${esc(x.symbol)}${x.exchange === "BSE" ? " · BSE" : ""}</small>${x.unknown ? '<em>⚠ not found on NSE</em>' : ""}<button type="button" class="lt-rm" data-rm="${i}" aria-label="Remove ${esc(x.symbol)}" title="Remove">✕</button></li>`).join("") : '<li class="hint lt-empty-row">No stocks yet: search above to add them.</li>';
      const c = box.querySelector("[data-count]"); if (c) c.textContent = list.length ? `${list.length}` : "";
    };
    const drawDrop = () => {
      drop.hidden = !res.length && !q.value.trim(); q.setAttribute("aria-expanded", String(!drop.hidden));
      drop.innerHTML = res.length ? res.map((r, i) => { const have = list.some(x => x.symbol === r.symbol); return `<button type="button" role="option" class="lt-opt${i === act ? " act" : ""}${have ? " have" : ""}" data-i="${i}" aria-selected="${i === act}"><b>${esc(r.name || r.symbol)}</b><small>${esc(r.symbol)}${r.exchange && r.exchange !== "NSE" ? ` · ${esc(r.exchange)}` : ""}${have ? " · already in this theme" : ""}</small></button>`; }).join("") : q.value.trim().length >= 2 ? '<div class="hint lt-opt">No match yet…</div>' : "";
    };
    const pick = i => {
      const r = res[i]; if (!r) return;
      if (!list.some(x => x.symbol === r.symbol)) list.push({ symbol: r.symbol, name: r.name || r.symbol, exchange: r.exchange || "NSE" });
      else window.toast?.(`${esc(r.symbol)} is already in this theme.`, { ms: 2000 });
      q.value = ""; res = []; act = 0; drawDrop(); draw(); q.focus(); ul.lastElementChild?.scrollIntoView?.({ block: "nearest" });
    };
    q.addEventListener("input", () => {
      clearTimeout(tm); const v = q.value.trim(); if (v.length < 1) { res = []; drawDrop(); return; }
      tm = setTimeout(async () => {
        const my = ++seq;
        try { const x = await api(`/api/search?q=${encodeURIComponent(v)}`); if (my !== seq) return; res = (x.results || []).filter(r => r.symbol && /^[A-Z0-9&-]{1,20}$/i.test(r.symbol)).map(r => ({ symbol: String(r.symbol).toUpperCase(), name: r.name || r.company || r.longname || r.symbol, exchange: r.exchange || "NSE" })).slice(0, 8); }
        catch { res = []; }
        act = 0; drawDrop();
      }, 150);
    });
    // Enter / arrows / Esc in the search box must not reach the dialog (which saves on Enter and closes on Esc)
    const onKey = e => {
      if (!box.isConnected) { window.removeEventListener("keydown", onKey, true); return; }
      if (e.target !== q) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { if (!res.length) return; e.preventDefault(); act = (act + (e.key === "ArrowDown" ? 1 : res.length - 1)) % res.length; drawDrop(); }
      else if (e.key === "Enter") { e.preventDefault(); e.stopImmediatePropagation(); if (res.length) pick(act); }
      else if (e.key === "Escape" && !drop.hidden) { e.preventDefault(); e.stopImmediatePropagation(); res = []; q.value = ""; drawDrop(); }
    };
    window.addEventListener("keydown", onKey, true);
    drop.addEventListener("mousedown", e => e.preventDefault()); // keep focus in the box
    drop.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (b) pick(Number(b.dataset.i)); });
    ul.addEventListener("click", e => { const b = e.target.closest("[data-rm]"); if (!b) return; list.splice(Number(b.dataset.rm), 1); draw(); });
    q.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== q) { drop.hidden = true; q.setAttribute("aria-expanded", "false"); } }, 150));
    q.addEventListener("focus", () => { if (res.length) drawDrop(); });
    draw();
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
    wireDrag(v);
    v.addEventListener("keydown", e => { const j = e.target.closest?.("[data-jump]"); if (j && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); j.click(); } });
    v.addEventListener("click", e => {
      const mv = e.target.closest("[data-move]");
      if (mv) { const list = data.themes.map(t => t.id), i = list.indexOf(mv.dataset.id), j = i + Number(mv.dataset.move); if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; reorder(list); return; }
      const jump = e.target.closest("[data-jump]"); if (jump) { document.getElementById(`lt-${jump.dataset.jump}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); return; }
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
