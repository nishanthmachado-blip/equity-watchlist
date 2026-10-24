// Long-term plan by theme (Growth, Dividends, Others… your own names): the stocks you want to own for years, and a
// "buy in bulk now" signal when one gets cheap. Cheap means any of:
//   zone   the app's valuation puts the price in (or below) its buy zone
//   dip    the price is N% under its 52-week high (N per theme: growth stocks swing more than dividend payers)
//   yield  (themes with a minimum yield) the dividend yield is at or above it
// A dip or a high yield on a stock the valuation calls rich is not enough on its own. Signals: "strong" (below the
// buy zone, or in the zone after a big dip), "bulk", "near" (within 5% of a level), "wait". Pure functions.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v), r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const txt = (v, n) => String(v ?? "").replace(/[<>]/g, "").trim().slice(0, n);
const RICH = new Set(["Rich", "Very rich"]);
export const THEME_ICONS = ["🚀", "💰", "🧩", "🏦", "⚡", "🌱", "🛡️", "🏭"];
// sensible defaults by theme name
export function themeDefaults(name = "") {
  if (/divid|divident|income|yield/i.test(name)) return { icon: "💰", dipPct: 15, minYield: 3, targetPct: 30 };
  if (/growth|momentum|small|mid/i.test(name)) return { icon: "🚀", dipPct: 25, minYield: null, targetPct: 50 };
  return { icon: "🧩", dipPct: 20, minYield: null, targetPct: 20 };
}
const SYM = /^[A-Z0-9&-]{1,20}$/;
export function sanitizeThemePlan(b = {}, prev = null) {
  const num = (v, lo, hi, d) => { const x = Number(String(v ?? "").replace(/[,₹%\s]/g, "")); return v !== null && v !== "" && fin(x) && x >= lo && x <= hi ? x : d; };
  const themes = (Array.isArray(b.themes) ? b.themes : prev?.themes || []).slice(0, 8).map((t, i) => {
    const name = txt(t.name, 40) || `Theme ${i + 1}`, d = themeDefaults(name), old = prev?.themes?.find(x => x.id === t.id);
    const seen = new Set(), symbols = (Array.isArray(t.symbols) ? t.symbols : []).map(x => (typeof x === "string" ? { symbol: x } : x)).map(x => ({ symbol: String(x.symbol || "").toUpperCase().trim(), name: txt(x.name, 80) || null, exchange: x.exchange === "BSE" ? "BSE" : "NSE" }))
      .filter(x => SYM.test(x.symbol) && !seen.has(x.symbol) && seen.add(x.symbol)).slice(0, 60);
    return { id: /^[\w-]{1,24}$/.test(t.id || "") ? t.id : `t${Date.now().toString(36)}${i}`, name, icon: THEME_ICONS.includes(t.icon) ? t.icon : old?.icon || d.icon,
      targetPct: num(t.targetPct, 0, 100, old?.targetPct ?? d.targetPct), dipPct: num(t.dipPct, 3, 70, old?.dipPct ?? d.dipPct), minYield: t.minYield === null || t.minYield === "" ? null : num(t.minYield, 0.5, 20, old?.minYield ?? d.minYield),
      bulk: num(t.bulk, 1000, 1e8, old?.bulk ?? 50000), symbols };
  });
  return { themes, corpus: b.corpus === null || b.corpus === "" ? null : num(b.corpus, 10000, 1e11, prev?.corpus ?? null), alerts: b.alerts === undefined ? prev?.alerts ?? true : !!b.alerts, state: prev?.state || {}, updatedAt: new Date().toISOString() };
}

// A pasted list → [{ name, items: [names] }]. Understands a copied spreadsheet block with theme names as column
// headers (blank columns in between are fine), "Theme: A, B, C" lines, or a plain list (one theme).
export function parseThemePaste(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n").slice(0, 400);
  const colon = lines.map(l => l.match(/^\s*([^:\t,]{2,40}):\s*(.+)$/)).filter(Boolean);
  if (colon.length && colon.length === lines.filter(l => l.trim()).length) return colon.map(m => ({ name: m[1].trim(), items: m[2].split(/[,;]+/).map(x => x.trim()).filter(Boolean) }));
  const rows = lines.map(l => l.split("\t").map(c => c.trim()));
  const hi = rows.findIndex(r => r.some(Boolean)); if (hi < 0) return [];
  const head = rows[hi], cols = head.map((c, i) => (c ? i : -1)).filter(i => i >= 0);
  const looksHeader = cols.length >= 2 || /growth|divid|divident|income|other|theme|core|bet/i.test(head[cols[0]] || "");
  if (!looksHeader) return [{ name: "My stocks", items: rows.flatMap(r => r.filter(Boolean)).flatMap(c => c.split(/[,;]+/)).map(x => x.trim()).filter(Boolean) }];
  const out = cols.map(i => ({ name: head[i], items: [] }));
  for (const r of rows.slice(hi + 1)) r.forEach((c, i) => { if (!c) return; let k = cols.length - 1; while (k > 0 && cols[k] > i) k--; out[k].items.push(c); });
  return out.filter(t => t.items.length || t.name);
}

// rows: Map(SYM → valuation row { price, zoneLow, zoneHigh, status, view, fairValue, high, dividend }), held: Map(SYM → { qty, value, invested })
export function themeSignal(t, row, { hi52 = null } = {}) {
  const price = row?.price, out = { price: fin(price) ? price : null, reasons: [], signal: "wait", levels: {} };
  if (!fin(price) || price <= 0) { out.signal = "no-price"; out.reasons.push("No price yet."); return out; }
  const high = fin(row.high) && row.high >= price ? row.high : fin(hi52) && hi52 >= price ? hi52 : null;
  const view = row.view && row.view !== "No fundamentals" ? row.view : null, rich = RICH.has(view);
  const inZone = row.status === "In zone" || row.status === "Below zone", below = row.status === "Below zone";
  const dipLevel = high ? r2(high * (1 - t.dipPct / 100)) : null, offHigh = high ? r1((1 - price / high) * 100) : null, dipped = dipLevel !== null && price <= dipLevel;
  const yld = fin(row.dividend?.yield) ? r2(row.dividend.yield) : null, yieldHit = t.minYield && yld !== null && yld >= t.minYield;
  Object.assign(out.levels, { zoneLow: fin(row.zoneLow) ? row.zoneLow : null, zoneHigh: fin(row.zoneHigh) ? row.zoneHigh : null, dipLevel, high, offHigh, yield: yld, fair: row.fairValue?.base ?? null, view });
  if (inZone) out.reasons.push(below ? `Below its buy zone (₹${r0(row.zoneLow).toLocaleString("en-IN")}–${r0(row.zoneHigh).toLocaleString("en-IN")})` : `In its buy zone (₹${r0(row.zoneLow).toLocaleString("en-IN")}–${r0(row.zoneHigh).toLocaleString("en-IN")})`);
  if (dipped) out.reasons.push(`${offHigh}% under its 52-week high ₹${r0(high).toLocaleString("en-IN")} (your dip level: ${t.dipPct}%)`);
  if (yieldHit) out.reasons.push(`Dividend yield ${yld}% (your minimum: ${t.minYield}%)`);
  if ((dipped || yieldHit) && rich && !inZone) out.reasons.push(`but the valuation still says ${view}: wait for the buy zone`);
  if (below || (inZone && dipped)) out.signal = "strong";
  else if (inZone || ((dipped || yieldHit) && !rich)) out.signal = "bulk";
  else {
    const near = [fin(row.zoneHigh) && price <= row.zoneHigh * 1.05 ? `${r1((price / row.zoneHigh - 1) * 100)}% above the buy zone` : null, !rich && dipLevel && price <= dipLevel * 1.05 ? `${r1((price / dipLevel - 1) * 100)}% above your dip level ₹${r0(dipLevel).toLocaleString("en-IN")}` : null].filter(Boolean);
    if (near.length) { out.signal = "near"; out.reasons.push(`Close: ${near.join(", ")}`); }
  }
  // the price that turns it into a bulk buy: whichever level comes first on the way down
  const zoneBuy = fin(row.zoneHigh) ? row.zoneHigh : null, dipBuy = rich ? null : dipLevel;
  out.levels.buyAt = [zoneBuy, dipBuy].filter(fin).sort((a, b) => b - a)[0] ?? null;
  out.levels.toBuyPct = out.levels.buyAt && out.signal !== "bulk" && out.signal !== "strong" ? r1((out.levels.buyAt / price - 1) * 100) : null;
  return out;
}

export function themePlanView(plan, { rows = new Map(), held = new Map(), hiLo = new Map() } = {}) {
  const allHeld = [...held.values()].reduce((a, h) => a + (h.value || 0), 0);
  const planned = new Set(plan.themes.flatMap(t => t.symbols.map(s => s.symbol)));
  const themes = plan.themes.map(t => {
    const list = t.symbols.map(s => {
      const row = rows.get(s.symbol) || null, h = held.get(s.symbol) || null, sig = themeSignal(t, row, { hi52: hiLo.get(s.symbol)?.hi ?? null });
      return { symbol: s.symbol, name: row?.company || s.name || s.symbol, exchange: s.exchange, tracked: !!row, valued: !!(row?.view && row.view !== "No fundamentals"), held: h ? { qty: h.qty, value: r0(h.value || 0), invested: fin(h.invested) ? r0(h.invested) : null, pnlPct: h.invested > 0 ? r1((h.value / h.invested - 1) * 100) : null } : null, ...sig };
    });
    const value = list.reduce((a, r) => a + (r.held?.value || 0), 0);
    return { ...t, rows: list, value: r0(value) };
  });
  const planValue = themes.reduce((a, t) => a + t.value, 0), base = plan.corpus || 0; // room to a target only with a plan size
  for (const t of themes) {
    t.actualPct = planValue > 0 ? r1(t.value / planValue * 100) : 0;
    t.targetValue = base > 0 ? r0(base * t.targetPct / 100) : null;
    t.room = t.targetValue !== null ? Math.max(0, t.targetValue - t.value) : null;
    let left = t.room;
    for (const r of [...t.rows].sort((a, b) => (b.signal === "strong") - (a.signal === "strong"))) {
      if (r.signal !== "bulk" && r.signal !== "strong") { r.amount = 0; continue; }
      let amt = t.bulk * (r.signal === "strong" ? 1.5 : 1);
      if (left !== null && plan.corpus) { amt = Math.min(amt, left); left -= amt; }
      r.amount = r0(amt); r.qty = r.price ? Math.floor(r.amount / r.price) : 0;
    }
  }
  const order = { strong: 0, bulk: 1, near: 2, wait: 3, "no-price": 4 };
  for (const t of themes) t.rows.sort((a, b) => order[a.signal] - order[b.signal] || (a.levels.toBuyPct ?? 99) - (b.levels.toBuyPct ?? 99));
  const bulkNow = themes.flatMap(t => t.rows.filter(r => r.signal === "bulk" || r.signal === "strong").map(r => ({ theme: t.name, icon: t.icon, symbol: r.symbol, name: r.name, signal: r.signal, price: r.price, amount: r.amount, qty: r.qty, reasons: r.reasons })));
  return { themes, corpus: plan.corpus, alerts: plan.alerts, planValue: r0(planValue), outsidePlan: r0(Math.max(0, allHeld - planValue)), bulkNow, bulkTotal: r0(bulkNow.reduce((a, x) => a + x.amount, 0)),
    counts: { stocks: planned.size, strong: bulkNow.filter(x => x.signal === "strong").length, bulk: bulkNow.length, near: themes.reduce((a, t) => a + t.rows.filter(r => r.signal === "near").length, 0), unvalued: themes.reduce((a, t) => a + t.rows.filter(r => !r.valued).length, 0) } };
}

// New bulk-buy chances since the last check → alert events (one per stock per 3 days, and again if it turns strong)
export function diffThemeAlerts(state = {}, view, { now = Date.now() } = {}) {
  const next = {}, fresh = [];
  for (const t of view.themes) for (const r of t.rows) {
    const was = state[r.symbol] || {}, cur = { signal: r.signal, at: was.at || null };
    const hot = r.signal === "bulk" || r.signal === "strong", wasHot = was.signal === "bulk" || was.signal === "strong";
    const upgrade = r.signal === "strong" && was.signal === "bulk", quiet = was.at && now - was.at < 3 * 864e5;
    if (hot && (!wasHot || upgrade) && !(quiet && !upgrade)) {
      cur.at = now;
      fresh.push({ key: `theme-${r.symbol}-${r.signal}-${new Date(now + 19800e3).toISOString().slice(0, 10)}`, type: "theme-bulk", symbol: r.symbol, company: r.name, price: r.price, at: new Date(now).toISOString(), read: false,
        title: `${t.icon} ${r.name} (${t.name}): ${r.signal === "strong" ? "strong bulk-buy chance" : "bulk-buy chance"} at ₹${r.price.toLocaleString("en-IN")}`, detail: `${r.reasons.join("; ")}${r.amount ? `. Plan: about ₹${r.amount.toLocaleString("en-IN")} (${r.qty} shares).` : ""}` });
    }
    next[r.symbol] = cur;
  }
  return { next, fresh };
}
