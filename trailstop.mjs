// Automatic trailing stop-loss for swing positions. Switched on per position, it moves the stop-loss UP as the price
// rises and never lowers it:
//   atr    the highest price since the trail was switched on, less N × the 14-day average true range (default 2)
//   low20  the lowest low of the last 20 trading days
// Every raise is recorded (when, from, to, why) so the position shows how its stop got where it is. Pure functions:
// the server supplies the daily-bar snapshot (ATR, 20-day low) and the live price.
const fin = v => Number.isFinite(v);
export const TRAIL_RULES = { atr: "2 × ATR under the highest price", low20: "20-day low" };
const tick = v => Math.floor(v * 20) / 20; // NSE tick: ₹0.05, rounded down so the stop is never above the level

export function sanitizeTrail(b = {}, prev = null) {
  const on = b.on === undefined ? !!prev?.on : !!b.on;
  const rule = TRAIL_RULES[b.rule] ? b.rule : prev?.rule || "atr";
  const m = Number(b.mult), mult = fin(m) && m >= 1 && m <= 5 ? Math.round(m * 10) / 10 : prev?.mult || 2;
  const restart = on && (!prev?.on || rule !== prev.rule || mult !== prev.mult);
  return { on, rule, mult, since: on ? (restart ? new Date().toISOString() : prev.since) : null, peak: restart ? null : prev?.peak ?? null, history: (prev?.history || []).slice(0, 30), lastLevel: restart ? null : prev?.lastLevel ?? null };
}

// The level the rule asks for today. snap: { atr, low20, high20?, price } from daily bars; price: live price.
export function trailLevel(trail, { snap, price }) {
  if (!trail?.on || !(price > 0)) return null;
  if (trail.rule === "low20") return fin(snap?.low20) && snap.low20 > 0 ? { level: tick(snap.low20), peak: trail.peak, why: `20-day low ₹${snap.low20}` } : null;
  const atr = fin(snap?.atr) && snap.atr > 0 ? snap.atr : null; if (!atr) return null;
  const peak = Math.max(trail.peak || 0, price);
  return { level: tick(peak - trail.mult * atr), peak, why: `${trail.mult} × ATR (₹${Math.round(atr * 100) / 100}) under the high since the trail started, ₹${Math.round(peak * 100) / 100}` };
}

// Apply to one position: raise only, never above the current price (the stop would fire at once on stale data).
// Returns { position, raised: { from, to, why } | null }
export function applyTrail(position, { snap, price, now = new Date().toISOString(), minStepPct = 0.25 } = {}) {
  const t = position?.trail; if (!t?.on) return { position, raised: null };
  const lv = trailLevel(t, { snap, price }); if (!lv) return { position, raised: null };
  const trail = { ...t, peak: lv.peak ?? t.peak, lastLevel: lv.level };
  const cur = fin(position.stopLoss) ? position.stopLoss : 0;
  const step = cur > 0 ? (lv.level / cur - 1) * 100 : Infinity;
  if (!(lv.level > cur) || step < minStepPct || lv.level >= price) {
    const changed = trail.peak !== t.peak || trail.lastLevel !== t.lastLevel;
    return { position: changed ? { ...position, trail } : position, raised: null };
  }
  const raised = { at: now, from: cur || null, to: lv.level, why: lv.why };
  return { position: { ...position, stopLoss: lv.level, trail: { ...trail, history: [raised, ...(t.history || [])].slice(0, 30) } }, raised };
}

// Raises since a time (for the morning brief): [{ symbol, name, from, to, at }]
export function trailChanges(positions = [], sinceIso) {
  const out = []; // one line per position: from the first raise's old stop to the latest stop
  for (const p of positions) { const hs = (p.trail?.history || []).filter(h => h.at >= sinceIso); if (hs.length) out.push({ symbol: p.symbol, name: p.name, from: hs.at(-1).from, to: hs[0].to, at: hs[0].at, raises: hs.length }); }
  return out.sort((a, b) => b.at.localeCompare(a.at));
}
