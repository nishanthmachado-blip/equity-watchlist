// Track record of the swing ideas scanner: every idea it showed is remembered with its entry, stop and target 1, then
// checked against the daily prices that followed. "Hit T1" = the high reached target 1 before the low touched the stop
// (a day that touched both counts as a stop, to stay conservative). Ideas still open after 20 trading days are closed
// at that day's close. Pure functions.
export const HORIZON = 20;
const r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
export const ideaKey = (i, day) => `${i.symbol}:${i.setup}:${day}`;
export function logIdeas(log, ideas, day) {
  const out = { ...(log || {}) }; let added = 0;
  for (const i of ideas) {
    if (!(i.entry > 0 && i.stop > 0 && i.t1 > 0) || !i.setup) continue;
    // the same stock and setup on consecutive days is one idea (the first day counts)
    const recent = Object.values(out).find(x => x.symbol === i.symbol && x.setup === i.setup && !x.outcome && x.day < day);
    if (recent) continue;
    const k = ideaKey(i, day); if (out[k]) continue;
    out[k] = { symbol: i.symbol, setup: i.setup, label: i.label || i.setup, day, entry: i.entry, stop: i.stop, t1: i.t1, t2: i.t2 ?? null, score: i.score ?? null, source: i.source || null };
    added++;
  }
  return { log: out, added };
}
// bars: [{t (unix s), c, h, l}] oldest first
export function judgeIdea(idea, bars) {
  const start = Date.parse(`${idea.day}T23:59:59Z`) / 1000, after = (bars || []).filter(b => b.t > start);
  for (let n = 0; n < Math.min(after.length, HORIZON); n++) {
    const b = after[n], hi = b.h ?? b.c, lo = b.l ?? b.c;
    if (lo <= idea.stop) return { outcome: "stop", days: n + 1, ret: r1((idea.stop / idea.entry - 1) * 100), on: new Date(b.t * 1000).toISOString().slice(0, 10) };
    if (hi >= idea.t1) return { outcome: "t1", days: n + 1, ret: r1((idea.t1 / idea.entry - 1) * 100), on: new Date(b.t * 1000).toISOString().slice(0, 10), t2: idea.t2 ? after.slice(n, HORIZON).some(x => (x.h ?? x.c) >= idea.t2) : null };
  }
  if (after.length >= HORIZON) { const b = after[HORIZON - 1]; return { outcome: "expired", days: HORIZON, ret: r1((b.c / idea.entry - 1) * 100), on: new Date(b.t * 1000).toISOString().slice(0, 10) }; }
  return null; // still running
}
export function ideaStats(log, labels = {}) {
  const list = Object.values(log || {}), by = new Map();
  for (const x of list) { const s = by.get(x.setup) || { setup: x.setup, label: labels[x.setup] || x.label || x.setup, ideas: 0, open: 0, t1: 0, stop: 0, expired: 0, rets: [] }; s.ideas++; if (!x.outcome) s.open++; else { s[x.outcome]++; s.rets.push(x.ret); } by.set(x.setup, s); }
  const fin = s => { const done = s.t1 + s.stop + s.expired; return { setup: s.setup, label: s.label, ideas: s.ideas, open: s.open, judged: done, hitRate: done ? r1(s.t1 / done * 100) : null, stopRate: done ? r1(s.stop / done * 100) : null, avgReturn: done ? r1(s.rets.reduce((a, b) => a + b, 0) / done) : null }; };
  const rows = [...by.values()].map(fin).sort((a, b) => (b.avgReturn ?? -99) - (a.avgReturn ?? -99));
  const all = fin({ setup: "all", label: "All setups", ideas: list.length, open: list.filter(x => !x.outcome).length, t1: list.filter(x => x.outcome === "t1").length, stop: list.filter(x => x.outcome === "stop").length, expired: list.filter(x => x.outcome === "expired").length, rets: list.filter(x => x.outcome).map(x => x.ret) });
  const recent = list.filter(x => x.outcome).sort((a, b) => (b.on || "").localeCompare(a.on || "")).slice(0, 15);
  return { all, rows, recent, since: list.length ? list.map(x => x.day).sort()[0] : null };
}
