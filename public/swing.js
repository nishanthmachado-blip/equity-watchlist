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
    "take-profit": ["🎯 Book profit", "tp"], deploy: ["💰 Deploy", "dp"], "deploy-limit": ["Limit used", "lim"],
    "near-profit": ["Near target", "near"], "near-deploy": ["Near add level", "near"], hold: ["Hold", ""], watch: ["Watching", ""]
  };
  const sig = r => { const [t, c] = SIG[r.status] || [r.status, ""]; return `<span class="sw-sig ${c}">${t}</span>${r.note ? `<div class="sw-note">${esc(r.note)}</div>` : ""}`; };

  function render() {
    const v = sw, t = v.totals;
    $("#swTargetLbl").textContent = `${v.settings.targets.join(" / ")}%`;
    $("#swCards").innerHTML = `
      <div><span>Invested</span><strong>${amt(t.invested)}</strong></div>
      <div><span>Value now</span><strong>${amt(t.value)}</strong></div>
      <div class="${t.pnl > 0 ? "sw-up" : t.pnl < 0 ? "sw-down" : ""}"><span>Profit / loss</span><strong class="${cls(t.pnl)}">${sg(t.pnl)}</strong><small class="${cls(t.pnlPct)}">${pct(t.pnlPct)}</small></div>
      <div class="${t.takeProfit ? "sw-tp" : ""}"><span>🎯 Ready to book profit</span><strong>${t.takeProfit}</strong></div>
      <div class="${t.deploy ? "sw-dp" : ""}"><span>💰 Deploy signals</span><strong>${t.deploy}</strong>${t.deployNow ? `<small>up to ${amt(t.deployNow)}</small>` : ""}</div>
      <div><span>Booked so far</span><strong class="${cls(v.realised.pnl)}">${sg(v.realised.pnl)}</strong><small>${v.realised.count} closed trade${v.realised.count === 1 ? "" : "s"}</small></div>`;
    const src = [...new Set([...v.positions, ...v.watch].map(r => r.priceSource).filter(Boolean))];
    $("#swStatus").textContent = `${v.marketOpen ? "Market open" : "Market closed"} · prices from ${src.join(", ") || "—"} · ${new Date(v.checkedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}${t.unpriced ? ` · ${t.unpriced} without a price` : ""}`;
    const order = { "take-profit": 0, deploy: 1, "near-profit": 2, "near-deploy": 3, "deploy-limit": 4, hold: 5 };
    $("#swPosNote").textContent = v.positions.length ? `${v.positions.length} position${v.positions.length === 1 ? "" : "s"} · sorted by signal` : "";
    $("#swRows").innerHTML = v.positions.length ? [...v.positions].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (b.pnlPct ?? -999) - (a.pnlPct ?? -999)).map(r => {
      const used = r.limit ? Math.min(100, Math.round(r.invested / r.limit * 100)) : null;
      return `<tr class="sw-row ${(SIG[r.status] || [])[1] || ""}" data-id="${esc(r.id)}" data-sym="${esc(r.symbol)}">
        <td><div class="company">${esc(r.name)}</div><div class="ticker">${esc(r.symbol)}${r.exchange === "BSE" ? " · BSE" : ""}</div></td>
        <td class="num">${r.qty}</td><td class="num">${px(r.avgPrice)}</td>
        <td class="num"><b>${px(r.price)}</b>${fin(r.dayPct) ? `<div class="ticker ${cls(r.dayPct)}">${pct(r.dayPct)} today</div>` : r.priceSource && !/Kite|Yahoo/.test(r.priceSource) ? `<div class="ticker">${esc(r.priceSource)}</div>` : ""}</td>
        <td class="num">${inr(r.invested)}</td><td class="num">${inr(r.value)}</td>
        <td class="num ${cls(r.pnl)}"><b>${sg(r.pnl)}</b><div>${pct(r.pnlPct)}</div></td>
        <td class="sw-tg">${r.targets.map(t => `<div class="${t.hit ? "hit" : r.nextTarget?.n === t.n ? "next" : ""}" title="Profit at T${t.n}: ${sg(t.profit)}"><i>T${t.n}</i><span>+${t.pct}%</span><b>${px(t.price)}</b>${t.hit ? "✓" : ""}</div>`).join("")}${r.ownTargets ? '<div class="ticker">own targets</div>' : ""}</td>
        <td>${r.limit ? `<div class="fd-w"><span><i style="width:${used}%"></i></span>${used}%</div><div class="ticker">${amt(r.invested)} of ${amt(r.limit)}</div>` : "—"}</td>
        <td>${r.addBelow ? `Add ${amt(r.addAmount)} below ${px(r.addBelow)}<div class="ticker">${fin(r.distanceToAdd) ? `${r.distanceToAdd > 0 ? `${r.distanceToAdd}% away` : "reached"}` : ""}</div>` : r.addAmount ? `Add ${amt(r.addAmount)}` : "—"}</td>
        <td>${sig(r)}</td>
        <td class="sw-acts"><button type="button" class="ghost" data-act="sell" title="Sell / book profit">Sell</button><button type="button" class="ghost" data-act="buy" title="Bought more">Buy</button><button type="button" class="ghost" data-act="edit" title="Edit">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button></td></tr>`;
    }).join("") : `<tr><td colspan="12" class="nw-empty-row">No swing positions yet. <button type="button" class="linklike" data-go="paste">Paste them from your sheet</button> or add one.</td></tr>`;
    $("#swWatchNote").textContent = v.watch.length ? `${v.watch.filter(w => w.status === "deploy").length} at your buy level now` : "";
    $("#swWatchRows").innerHTML = v.watch.length ? [...v.watch].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || (a.distance ?? 999) - (b.distance ?? 999)).map(w => `<tr class="sw-row ${(SIG[w.status] || [])[1] || ""}" data-id="${esc(w.id)}" data-sym="${esc(w.symbol)}">
        <td><div class="company">${esc(w.name)}</div><div class="ticker">${esc(w.symbol)}${w.notes ? ` · ${esc(w.notes)}` : ""}</div></td>
        <td class="num"><b>${px(w.price)}</b>${fin(w.dayPct) ? `<div class="ticker ${cls(w.dayPct)}">${pct(w.dayPct)} today</div>` : ""}</td>
        <td class="num">${w.buyBelow ? px(w.buyBelow) : '<span class="hint">not set</span>'}</td>
        <td class="num">${fin(w.distance) ? (w.distance <= 0 ? '<b class="buy">reached</b>' : `${w.distance}% above`) : "—"}</td>
        <td class="num">${amt(w.amount)}</td><td>${sig(w)}</td>
        <td class="sw-acts"><button type="button" class="ghost" data-act="bought" title="I bought it: move to positions">Bought</button><button type="button" class="ghost" data-act="wedit" title="Edit">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button></td></tr>`).join("")
      : `<tr><td colspan="7" class="nw-empty-row">Add stocks you want to buy on a dip, with the price to buy below and how much to deploy.</td></tr>`;
    $("#swClosedSum").textContent = v.closed.length ? `${v.closed.length} trade${v.closed.length === 1 ? "" : "s"}, ${sg(v.realised.pnl)}` : "none yet";
    $("#swClosedRows").innerHTML = v.closed.map(c => `<tr><td><div class="company">${esc(c.name)}</div><div class="ticker">${esc(c.symbol)}</div></td><td class="num">${c.qty}</td><td class="num">${px(c.buyAvg)}</td><td class="num">${px(c.sellPrice)}</td><td class="num ${cls(c.pnl)}">${sg(c.pnl)} <small>${pct(c.pnlPct)}</small></td><td>${new Date(c.closedAt).toLocaleDateString("en-IN")}</td></tr>`).join("") || `<tr><td colspan="6" class="nw-empty-row">Sells you record appear here with their profit.</td></tr>`;
  }
  async function load(quiet = false) {
    try { sw = await api("/api/swing"); render(); }
    catch (e) { if (!quiet) $("#swStatus").textContent = e.message; }
    clearTimeout(timer);
    if (!$("#swingView").hidden) timer = setTimeout(() => load(true), sw?.marketOpen ? 60e3 : 5 * 60e3);
  }
  window.openSwing = () => load();

  // ---- dialogs ----
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
        ${field("Quantity", "qty", p?.qty, 'inputmode="numeric"')}${field("Average buy price (₹)", "avgPrice", p?.avgPrice, 'inputmode="decimal"')}
        ${field("Limit for this stock (₹, e.g. 3L)", "limit", p?.limit ? `${p.limit / 1e5}L` : "", 'placeholder="optional, e.g. 3L"')}
        ${field("Add amount (e.g. 2L)", "addAmount", p?.addAmount ? `${p.addAmount / 1e5}L` : "", 'placeholder="optional"')}${field("Add below price (₹, e.g. 4.7k)", "addBelow", p?.addBelow, 'placeholder="optional"')}
        ${field(`Targets % T1, T2, T3 (default ${(sw?.settings.targets || [10, 20, 40]).join(", ")})`, "targets", (p?.ownTargets ? p.targets.map(t => t.pct) : []).join(", "), 'placeholder="default"')}${field("Note", "notes", p?.notes)}</div>`,
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        const s = p ? { symbol: p.symbol, name: p.name, exchange: p.exchange } : await pickStock(box);
        return api("/api/swing/position", { id: p?.id, symbol: s.symbol, name: s.name, exchange: s.exchange, qty: v("qty"), avgPrice: v("avgPrice"), limit: v("limit"), addAmount: v("addAmount"), addBelow: v("addBelow"), targets: v("targets"), notes: v("notes") });
      }
    });
    if (out) { sw = out; render(); }
  }
  async function editWatch(w = null) {
    const out = await window.ui.dialog({
      title: w ? `Edit ${w.name}` : "Add to swing watchlist", icon: "👀", okText: w ? "Save" : "Add", wide: true,
      bodyHtml: `<div class="nw-form">${field("Stock (name or NSE symbol)", "stock", w ? w.symbol : "", w ? "readonly" : 'placeholder="e.g. PB Fintech" autofocus')}
        ${field("Buy below (₹)", "buyBelow", w?.buyBelow, 'placeholder="e.g. 980"')}${field("Amount to deploy (e.g. 3L)", "amount", w?.amount ? `${w.amount / 1e5}L` : "", 'placeholder="e.g. 3L"')}${field("Note", "notes", w?.notes)}</div>`,
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        const s = w ? { symbol: w.symbol, name: w.name, exchange: w.exchange } : await pickStock(box);
        return api("/api/swing/watch", { id: w?.id, symbol: s.symbol, name: s.name, exchange: s.exchange, buyBelow: v("buyBelow"), amount: v("amount"), notes: v("notes") });
      }
    });
    if (out) { sw = out; render(); }
  }
  async function tradeDialog(p, side) {
    const out = await window.ui.dialog({
      title: side === "sell" ? `Sell ${p.name}` : `Bought more ${p.name}`, icon: side === "sell" ? "🎯" : "➕", okText: side === "sell" ? "Record sale" : "Record buy",
      message: side === "sell" ? `You hold ${p.qty} at ${px(p.avgPrice)}. Profit on the shares you sell is added to Closed trades.` : `Your average price is recalculated.`,
      bodyHtml: `<div class="nw-form">${field("Quantity", "qty", side === "sell" ? p.qty : "", 'inputmode="numeric" autofocus')}${field("Price (₹)", "price", p.price ?? "", 'inputmode="decimal"')}</div><p class="ui-hint" data-prev></p>`,
      onOpen: box => {
        const upd = () => { const q = Number(box.querySelector("[name=qty]").value), pr = Number(box.querySelector("[name=price]").value); box.querySelector("[data-prev]").textContent = side === "sell" && q > 0 && pr > 0 ? `Profit / loss on this sale: ${sg((pr - p.avgPrice) * q)} (${pct(+((pr / p.avgPrice - 1) * 100).toFixed(2))})` : side === "buy" && q > 0 && pr > 0 ? `New average: ${px(+((p.qty * p.avgPrice + q * pr) / (p.qty + q)).toFixed(2))} on ${p.qty + q} shares` : ""; };
        box.querySelectorAll("input").forEach(i => { i.oninput = upd; }); upd();
      },
      collect: box => api(`/api/swing/${side}`, { id: p.id, qty: box.querySelector("[name=qty]").value, price: box.querySelector("[name=price]").value })
    });
    if (out) { sw = out; render(); window.toast?.(side === "sell" ? "Sale recorded." : "Buy recorded.", { kind: "ok", ms: 3000 }); }
  }
  async function boughtDialog(w) {
    const out = await window.ui.dialog({
      title: `Bought ${w.name}`, icon: "✅", okText: "Move to positions", message: "It leaves the swing watchlist and becomes a swing position.",
      bodyHtml: `<div class="nw-form">${field("Quantity", "qty", w.amount && w.price ? Math.floor(w.amount / w.price) : "", 'inputmode="numeric" autofocus')}${field("Average price (₹)", "price", w.price ?? "", 'inputmode="decimal"')}</div>`,
      collect: box => api("/api/swing/promote", { id: w.id, qty: box.querySelector("[name=qty]").value, price: box.querySelector("[name=price]").value })
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
  async function settingsDialog() {
    const out = await window.ui.dialog({
      title: "Swing signals", icon: "⚙", okText: "Save",
      bodyHtml: `<div class="nw-form">${[0, 1, 2].map(i => field(`Target ${i + 1} (T${i + 1}): % up from your average`, `t${i}`, sw.settings.targets[i] ?? "", `inputmode="decimal"${i ? ' placeholder="optional"' : ""}`)).join("")}${field("Deploy when down this % (stocks without an add level)", "dipPct", sw.settings.dipPct, 'inputmode="decimal"')}</div><p class="ui-hint">The Targets column shows the price for each level. You get an alert at T1, and again at T2 and T3. A position can have its own targets in its edit box.</p>`,
      collect: box => api("/api/swing/settings", { targets: [0, 1, 2].map(i => box.querySelector(`[name=t${i}]`).value.trim()).filter(Boolean).join(","), dipPct: box.querySelector("[name=dipPct]").value })
    });
    if (out) { sw = out; render(); }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#swingView")) return;
    $("#viewSwing").onclick = () => setView("swing");
    $("#swAddPos").onclick = () => editPosition();
    $("#swAddWatch").onclick = () => editWatch();
    $("#swPaste").onclick = pasteDialog;
    $("#swSettings").onclick = settingsDialog;
    $("#swRefresh").onclick = async () => { const b = $("#swRefresh"); b.classList.add("is-loading"); await load(); b.classList.remove("is-loading"); };
    $("#swingView").addEventListener("click", async e => {
      if (e.target.closest('[data-go="paste"]')) { pasteDialog(); return; }
      const btn = e.target.closest("[data-act]"), tr = e.target.closest("tr[data-id]"); if (!btn || !tr) return;
      const id = tr.dataset.id, p = sw.positions.find(x => x.id === id), w = sw.watch.find(x => x.id === id), act = btn.dataset.act;
      if (act === "edit") editPosition(p); else if (act === "wedit") editWatch(w); else if (act === "sell" || act === "buy") tradeDialog(p, act); else if (act === "bought") boughtDialog(w);
      else if (act === "del" && await window.ui.confirm({ title: `Remove ${(p || w).name}?`, message: p ? "Only the swing tracking is removed; nothing changes at your broker. Use Sell to record a sale instead." : "It is removed from the swing watchlist.", okText: "Remove", danger: true })) { sw = await api("/api/swing/delete", { id }); render(); }
    });
  });
})();
