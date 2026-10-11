// Alerts: a stock entering its buy zone, or its verdict changing class. Pure diff + a small event log.
// state = { SYMBOL: { key, label, inZone } } from the previous check; the first check only seeds it (no flood of alerts).
export const MAX_EVENTS = 200, REPEAT_HOURS = 24;
const rank = { none: 0, expensive: 1, wait: 2, buy: 3 };

export function diffAlerts(prevState, rows, { now = Date.now(), events = [] } = {}) {
  const seeded = prevState && Object.keys(prevState).length > 0;
  const nextState = {}, fresh = [];
  const recent = (sym, type) => events.some(e => e.symbol === sym && e.type === type && now - new Date(e.at).getTime() < REPEAT_HOURS * 3600e3);
  for (const r of rows) {
    const v = r.verdict; if (!v || !r.symbol) continue;
    const sym = String(r.symbol).toUpperCase();
    nextState[sym] = { key: v.key, label: v.label, inZone: !!v.inZone };
    const prev = prevState?.[sym];
    if (!seeded || !prev || prev.key === "none" || v.key === "none") continue;
    const base = { symbol: sym, company: r.company, price: r.price ?? null, at: new Date(now).toISOString(), read: false };
    if (v.inZone && !prev.inZone && !recent(sym, "buy-zone")) fresh.push({ ...base, type: "buy-zone", title: `${r.company} entered its buy zone`, detail: `Price ${r.price} is inside ${r.zoneLow}–${r.zoneHigh}. Verdict: ${v.label}.` });
    if (v.label !== prev.label && v.key !== prev.key && !recent(sym, "verdict")) {
      const up = rank[v.key] > rank[prev.key];
      fresh.push({ ...base, type: "verdict", title: `${r.company}: ${prev.label} → ${v.label}`, detail: up ? "The verdict improved." : "The verdict got worse: check whether your reason to hold still stands." });
    }
  }
  return { nextState, fresh };
}

export function mergeEvents(events, fresh) {
  let id = Math.max(0, ...events.map(e => e.id || 0));
  return [...fresh.map(e => ({ ...e, id: ++id })), ...events].slice(0, MAX_EVENTS);
}
