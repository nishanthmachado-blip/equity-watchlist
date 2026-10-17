// Telegram digests: a morning note before the open and an evening summary after the close. Pure: takes data the server
// already has and returns Telegram HTML (short lines, no tables: it is read on a phone).
const he = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inr = v => `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
const sg = v => `${v >= 0 ? "+" : "−"}${inr(v)}`;
const pc = v => `${v >= 0 ? "+" : ""}${Math.round(v * 100) / 100}%`;
const fmt = d => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const evLine = e => `${e.kind === "results" || e.kind === "board-dividend" ? "📊" : e.kind === "dividend" ? "💰" : e.kind === "bonus" || e.kind === "split" ? "🎁" : "🗓"} ${he(e.symbol)} ${he(e.kind === "dividend" ? `${e.label}${e.amount ? ` ₹${e.amount}/share` : ""} ex-date` : e.label)} ${e.days === 0 ? "<b>today</b>" : e.days === 1 ? "tomorrow" : fmt(e.date)}${e.income ? ` (${inr(e.income)} for you)` : ""}`;
export function morningDigest({ day, swing, events = [], rules = 0, appUrl = "" }) {
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
