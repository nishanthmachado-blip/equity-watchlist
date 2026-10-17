// Your own alerts: "tell me when X crosses ₹Y", a big daily move, a new 52-week high or low, a volume spike, a golden
// cross with RSI above 50, crossing the 200-day average. Price rules are checked on every live quote; chart rules once a
// day on the NSE end-of-day prices. Pure functions.
export const RULE_TYPES = {
  above: { label: "Price rises to or above", unit: "₹", live: true },
  below: { label: "Price falls to or below", unit: "₹", live: true },
  move: { label: "Moves more than ±% in a day", unit: "%", live: true },
  high52: { label: "Makes a new 52-week high", live: true, eod: true },
  low52: { label: "Makes a new 52-week low", live: true, eod: true },
  volume: { label: "Volume spike (× its 20-day average)", unit: "×", eod: true },
  golden: { label: "Golden cross (50-DMA over 200-DMA) with RSI(14) above 50", eod: true },
  dma200up: { label: "Closes back above its 200-day average", eod: true },
  dma200down: { label: "Closes below its 200-day average", eod: true }
};
const txt = (v, n) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const r2 = v => Math.round(v * 100) / 100;
export function sanitizeRule(b = {}, prev = null) {
  const symbol = txt(b.symbol, 20).toUpperCase(); if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) throw new Error("Pick the stock (NSE symbol).");
  const type = RULE_TYPES[b.type] ? b.type : null; if (!type) throw new Error("Pick what to watch for.");
  let value = b.value === undefined || b.value === "" ? null : Number(String(b.value).replace(/[₹,%×x\s]/g, ""));
  if (["above", "below", "move", "volume"].includes(type) && !(value > 0)) throw new Error(type === "move" ? "Enter the % move (for example 4)." : type === "volume" ? "Enter how many times the usual volume (for example 3)." : "Enter the price level.");
  if (!["above", "below", "move", "volume"].includes(type)) value = null;
  return { id: prev?.id || `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, symbol, exchange: b.exchange === "BSE" ? "BSE" : "NSE", name: txt(b.name, 80) || prev?.name || symbol, type, value, note: txt(b.note, 120) || null, repeat: b.repeat === "daily" ? "daily" : "once", active: b.active !== false, createdAt: prev?.createdAt || new Date().toISOString(), lastFired: prev?.lastFired || null, firedCount: prev?.firedCount || 0 };
}
export const describeRule = r => `${RULE_TYPES[r.type].label}${r.value !== null ? ` ${r.type === "move" ? `${r.value}%` : r.type === "volume" ? `${r.value}×` : `₹${r.value.toLocaleString("en-IN")}`}` : ""}`;
const firedToday = (r, day) => r.lastFired && r.lastFired.slice(0, 10) === day;
// Live check: q = { price, prevClose, high, low } (52-week range when known). Returns an alert or null.
export function checkLiveRule(r, q, day) {
  if (!r.active || !RULE_TYPES[r.type].live || !(q?.price > 0) || firedToday(r, day)) return null;
  const p = q.price, chg = q.prevClose > 0 ? (p / q.prevClose - 1) * 100 : null;
  let hit = false, detail = "";
  if (r.type === "above" && p >= r.value) { hit = true; detail = `Now ₹${p} (your level ₹${r.value}).`; }
  else if (r.type === "below" && p <= r.value) { hit = true; detail = `Now ₹${p} (your level ₹${r.value}).`; }
  else if (r.type === "move" && chg !== null && Math.abs(chg) >= r.value) { hit = true; detail = `${chg > 0 ? "Up" : "Down"} ${Math.abs(r2(chg))}% today at ₹${p}.`; }
  else if (r.type === "high52" && q.high > 0 && p > q.high) { hit = true; detail = `₹${p} is above the 52-week high of ₹${q.high}.`; }
  else if (r.type === "low52" && q.low > 0 && p < q.low) { hit = true; detail = `₹${p} is below the 52-week low of ₹${q.low}.`; }
  return hit ? fire(r, detail, day) : null;
}
const sma = (c, n, end = c.length) => (end >= n ? c.slice(end - n, end).reduce((a, b) => a + b, 0) / n : null);
function rsi(c, n = 14) { if (c.length <= n) return null; let g = 0, l = 0; for (let i = c.length - n; i < c.length; i++) { const d = c[i] - c[i - 1]; if (d > 0) g += d; else l -= d; } return l === 0 ? 100 : 100 - 100 / (1 + g / l); }
// End-of-day check on daily bars [{t, c, h, l, v}] (oldest first; the last bar is the day being checked)
export function checkEodRule(r, bars, day) {
  if (!r.active || !RULE_TYPES[r.type].eod || !bars?.length || bars.length < 22 || firedToday(r, day)) return null;
  const c = bars.map(b => b.c), last = bars.at(-1), n = c.length;
  let detail = null;
  if (r.type === "high52" || r.type === "low52") { const prev = bars.slice(-253, -1); if (prev.length < 100) return null; const hi = Math.max(...prev.map(b => b.h ?? b.c)), lo = Math.min(...prev.map(b => b.l ?? b.c)); if (r.type === "high52" && last.c > hi) detail = `Closed at ₹${last.c}, above the 52-week high of ₹${hi}.`; if (r.type === "low52" && last.c < lo) detail = `Closed at ₹${last.c}, below the 52-week low of ₹${lo}.`; }
  else if (r.type === "volume") { const vs = bars.slice(-21, -1).map(b => b.v).filter(v => v > 0); if (vs.length >= 10 && last.v > 0) { const avg = vs.reduce((a, b) => a + b, 0) / vs.length; if (last.v >= r.value * avg) detail = `Volume ${Math.round(last.v / avg * 10) / 10}× its 20-day average; closed at ₹${last.c}.`; } }
  else if (r.type === "golden") { const a50 = sma(c, 50), a200 = sma(c, 200), p50 = sma(c, 50, n - 1), p200 = sma(c, 200, n - 1), rs = rsi(c); if (a50 && a200 && p50 && p200 && p50 <= p200 && a50 > a200 && rs > 50) detail = `50-DMA (₹${r2(a50)}) crossed above the 200-DMA (₹${r2(a200)}); RSI(14) ${Math.round(rs)}; closed at ₹${last.c}.`; }
  else if (r.type === "dma200up" || r.type === "dma200down") { const a = sma(c, 200), p = sma(c, 200, n - 1); if (a && p) { const prevC = c[n - 2]; if (r.type === "dma200up" && prevC <= p && last.c > a) detail = `Closed at ₹${last.c}, back above its 200-day average (₹${r2(a)}).`; if (r.type === "dma200down" && prevC >= p && last.c < a) detail = `Closed at ₹${last.c}, below its 200-day average (₹${r2(a)}).`; } }
  return detail ? fire(r, detail, day) : null;
}
function fire(r, detail, day) {
  return { rule: { ...r, lastFired: new Date().toISOString(), firedCount: (r.firedCount || 0) + 1, active: r.repeat === "daily" ? r.active : false },
    event: { key: `rule-${r.id}-${day}`, at: new Date().toISOString(), type: "rule", symbol: r.symbol, title: `${r.name}: ${describeRule(r).toLowerCase()}`, detail: `${detail}${r.note ? ` Note: ${r.note}` : ""}${r.repeat === "once" ? " (alert switched off; turn it on again in Alerts)" : ""}` } };
}
