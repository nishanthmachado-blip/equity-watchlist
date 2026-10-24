// Telegram digests: a morning note before the open and an evening summary after the close. Pure: takes data the server
// already has and returns Telegram HTML (short lines, no tables: it is read on a phone).
const he = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inr = v => `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
const sg = v => `${v >= 0 ? "+" : "−"}${inr(v)}`;
const pc = v => `${v >= 0 ? "+" : ""}${Math.round(v * 100) / 100}%`;
const fmt = d => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const evLine = e => `${e.kind === "results" || e.kind === "board-dividend" ? "📊" : e.kind === "dividend" ? "💰" : e.kind === "bonus" || e.kind === "split" ? "🎁" : "🗓"} ${he(e.symbol)} ${he(e.kind === "dividend" ? `${e.label}${e.amount ? ` ₹${e.amount}/share` : ""} ex-date` : e.label)} ${e.days === 0 ? "<b>today</b>" : e.days === 1 ? "tomorrow" : fmt(e.date)}${e.income ? ` (${inr(e.income)} for you)` : ""}`;
// The morning brief as sections (the Home card shows these; the Telegram note adds them below the swing lines).
// zones: valuation rows in / below the buy zone ({ symbol, company, price, zoneLow, zoneHigh, status, held });
// moves: holdings that moved 4%+ in the last session ({ symbol, company, pct }); orders: order-win announcements for
// your stocks in the last 3 days ({ symbol, name, day, valueCr, text, held }); trails: trailing stops raised since
// yesterday morning ({ symbol, name, from, to }).
const cr = v => (v >= 100 ? `₹${Math.round(v).toLocaleString("en-IN")} Cr` : `₹${Math.round(v * 10) / 10} Cr`);
const rp = v => `₹${(Math.round(v * 100) / 100).toLocaleString("en-IN")}`;
const zl = z => `${z.status === "Below zone" ? "below" : "in"} its buy zone ₹${Math.round(z.zoneLow).toLocaleString("en-IN")}–${Math.round(z.zoneHigh).toLocaleString("en-IN")} at ${rp(z.price)}`;
export function briefSections({ swing = null, events = [], rules = 0, zones = [], moves = [], orders = [], trails = [], themes = [], funds = [] } = {}) {
  const S = [], P = swing?.positions || [], W = swing?.watch || [], sec = (key, icon, title, items) => { if (items.length) S.push({ key, icon, title, items }); };
  sec("profit", "🎯", "Book profit", P.filter(p => p.status === "take-profit").map(p => ({ symbol: p.symbol, text: `${p.name || p.symbol}${p.sellNow ? `: sell ${p.sellNow} of ${p.qty}` : ""} (T${p.hitLevel || 1} reached)` })));
  sec("stop", "🛑", "At / near your stop-loss", P.filter(p => p.status === "stop-hit" || p.status === "near-stop").map(p => ({ symbol: p.symbol, text: `${p.name || p.symbol}: ${rp(p.price)} vs stop ${rp(p.stopLoss)}${p.status === "stop-hit" ? " (hit)" : ""}` })));
  sec("trail", "🪜", "Trailing stops raised", trails.map(t => ({ symbol: t.symbol, text: `${t.name || t.symbol}: stop ${t.from ? `${rp(t.from)} → ` : "set at "}${rp(t.to)}` })));
  sec("deploy", "💰", "At your swing buy level", [...P.filter(p => p.status === "deploy"), ...W.filter(w => w.status === "deploy")].map(p => ({ symbol: p.symbol, text: `${p.name || p.symbol}${p.price ? ` at ${rp(p.price)}` : ""}` })));
  sec("themes", "🧭", "Bulk-buy chances in your long-term plan", themes.slice(0, 10).map(x => ({ symbol: x.symbol, text: `${x.icon} ${x.name} (${x.theme})${x.signal === "strong" ? " · strong" : ""} at ${rp(x.price)}${x.amount ? `: about ${rp(x.amount).replace(/\.\d+$/, "")}` : ""} · ${x.reasons[0] || ""}` })));
  sec("funds", "🧺", "Mutual funds in a bulk-buy zone", funds.slice(0, 6).map(f => ({ symbol: null, text: `${f.name}: NAV ${f.fromHigh}% under its 52-week high${f.zone === "strong" ? " (strong)" : ""}` })));
  sec("zoneHeld", "🟢", "Your holdings in the buy zone", zones.filter(z => z.held).slice(0, 8).map(z => ({ symbol: z.symbol, text: `${z.company || z.symbol} is ${zl(z)}` })));
  sec("zoneWatch", "👀", "Watchlist stocks in the buy zone", zones.filter(z => !z.held).slice(0, 8).map(z => ({ symbol: z.symbol, text: `${z.company || z.symbol} is ${zl(z)}` })));
  sec("moves", "⚡", "Big moves in your holdings (last session)", [...moves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct)).slice(0, 6).map(m => ({ symbol: m.symbol, text: `${m.company || m.symbol} ${pc(m.pct)}` })));
  sec("orders", "🏗", "Order wins for your stocks", orders.slice(0, 6).map(o => ({ symbol: o.symbol, text: `${o.name || o.symbol}${o.valueCr ? `: ${cr(o.valueCr)}` : ""}${o.held ? " (you hold it)" : ""} · ${String(o.text || "").slice(0, 110)}` })));
  sec("events", "📅", "This week", events.filter(e => e.days >= 0 && e.days <= 7).slice(0, 8).map(e => ({ symbol: e.symbol, text: evLine(e).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") })));
  return { sections: S, rules, quiet: !S.length };
}
export function morningDigest({ day, swing, events = [], rules = 0, appUrl = "", zones = [], moves = [], orders = [], trails = [], themes = [], funds = [] }) {
  const L = [`☀️ <b>Good morning: ${fmt(day)}</b>`];
  const P = swing?.positions || [], W = swing?.watch || [];
  const by = s => P.filter(p => p.status === s);
  const tp = by("take-profit"), stop = P.filter(p => p.status === "stop-hit" || p.status === "near-stop"), dep = [...by("deploy"), ...W.filter(w => w.status === "deploy")];
  if (P.length) L.push("", `<b>Swing</b> ${P.length} position${P.length === 1 ? "" : "s"}, P/L ${sg(swing.totals?.pnl || 0)}`);
  if (tp.length) L.push(`🎯 Book profit: ${tp.map(p => `${he(p.symbol)}${p.sellNow ? ` (sell ${p.sellNow})` : ""}`).join(", ")}`);
  if (stop.length) L.push(`🛑 At / near stop-loss: ${stop.map(p => he(p.symbol)).join(", ")}`);
  if (dep.length) L.push(`💰 At your buy level: ${dep.map(p => he(p.symbol)).join(", ")}${swing.totals?.deployNow ? ` (up to ${inr(swing.totals.deployNow)}${swing.totals.cashShort ? `, cash short by ${inr(swing.totals.cashShort)}` : ""})` : ""}`);
  for (const p of P) if (p.events?.tone === "warn" || p.events?.tone === "bad" || /wait for the dividend/i.test(p.events?.headline || "")) L.push(`📅 ${he(p.symbol)}: ${he(p.events.headline)}`);
  const soon = events.filter(e => e.days >= 0 && e.days <= 7);
  if (soon.length) { L.push("", "<b>This week</b>"); for (const e of soon.slice(0, 10)) L.push(evLine(e)); if (soon.length > 10) L.push(`…and ${soon.length - 10} more`); }
  const extra = briefSections({ zones, moves, orders, trails, themes, funds }).sections;
  for (const x of extra) { L.push("", `${x.icon} <b>${he(x.title)}</b>`); for (const it of x.items) L.push(`• ${he(it.text)}`); }
  if (rules) L.push("", `🔔 ${rules} price alert${rules === 1 ? "" : "s"} armed.`);
  if (L.length === 1) L.push("Nothing needs you today.");
  if (appUrl) L.push("", `<a href="${he(appUrl)}/#swing">Open Equity Watchlist</a>`);
  return L.join("\n");
}
export function eveningDigest({ day, swing, holdings = null, booked = [], fired = [], ideas = [], events = [], appUrl = "" }) {
  const L = [`🌙 <b>Market close: ${fmt(day)}</b>`];
  const P = swing?.positions || [];
  if (P.length) {
    const dayPl = P.reduce((s, p) => s + (p.prevClose > 0 && p.price > 0 ? (p.price - p.prevClose) * p.qty : 0), 0);
    L.push("", `<b>Swing</b> today ${sg(dayPl)} · total P/L ${sg(swing.totals?.pnl || 0)}${swing.totals?.pat ? ` · after tax ${sg(swing.totals.pat.net)}` : ""}`);
    const movers = [...P].filter(p => Number.isFinite(p.dayPct)).sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct)).slice(0, 3);
    if (movers.length) L.push(`Movers: ${movers.map(p => `${he(p.symbol)} ${pc(p.dayPct)}`).join(", ")}`);
    const hit = P.filter(p => p.status === "take-profit"); if (hit.length) L.push(`🎯 At a target: ${hit.map(p => he(p.symbol)).join(", ")}`);
  }
  if (holdings && Number.isFinite(holdings.dayChange)) L.push("", `<b>Holdings</b> today ${sg(holdings.dayChange)} (${pc(holdings.dayPct)}) · value ${inr(holdings.value)}`, ...(holdings.movers?.length ? [`Movers: ${holdings.movers.map(m => `${he(m.symbol)} ${pc(m.dayPct)}`).join(", ")}`] : []));
  if (booked.length) L.push("", `<b>Booked today</b> ${booked.map(t => `${he(t.symbol)} ${sg(t.pnl)}`).join(", ")}`);
  if (fired.length) L.push("", `<b>Alerts today</b>`, ...fired.slice(0, 6).map(e => `🔔 ${he(e.title)}`));
  if (ideas.length) L.push("", `<b>Top swing ideas</b>`, ...ideas.slice(0, 3).map(i => `💡 ${he(i.symbol)}: ${he(i.label)}, entry ₹${i.entry}, stop ₹${i.stop}, T1 ₹${i.t1} (score ${i.score})`));
  const tomorrow = events.filter(e => e.days === 1 || (e.days >= 1 && e.days <= 3 && (e.kind === "results" || e.kind === "dividend")));
  if (tomorrow.length) L.push("", "<b>Coming up</b>", ...tomorrow.slice(0, 6).map(evLine));
  if (appUrl) L.push("", `<a href="${he(appUrl)}">Open Equity Watchlist</a>`);
  return L.join("\n");
}
