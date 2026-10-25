// "Till you retire": how each bucket line grows from today's value with what you add every month, at its own expected
// return, until your retirement age. Contributions start from your Monthly expenses (investment lines matched to the
// net worth line they feed: PPF → your PPF, NPS → NPS, EPF / VPF → EPF, SIP / MF → your equity funds …); returns start
// from typical long-run rates for the asset. Both can be changed per line. Monthly compounding; contributions rise by the
// yearly step-up; PPF deposits stop at the ₹1.5 L a year limit. Pre-tax, nominal rupees (today's money shown too). Pure.
const fin = v => Number.isFinite(v);
const r0 = v => Math.round(v || 0);
export const PPF_YEARLY_CAP = 150000;

// typical long-run yearly return by asset (editable per line): small-saving rates as of 2025-26 (EPF 8.25%, PPF 7.1%)
export function defaultRate(l) {
  const c = l.category, n = `${l.fundCategory || ""} ${l.name || ""}`.toLowerCase();
  if (c === "cash") return 3.5;
  if (c === "fd") return 7;
  if (c === "bonds") return 7.5;
  if (c === "ppf") return 7.1;
  if (c === "epf") return 8.25;
  if (c === "nps") return 10;
  if (c === "gold") return 9;
  if (c === "crypto") return 12;
  if (c === "intl") return 12;
  if (c === "stocks") return 12;
  if (c === "mf") {
    if (/arbitrage|liquid|overnight|money market/.test(n)) return 6.5;
    if (/ultra short|low duration|short duration|corporate bond|banking (and|&) psu|gilt|debt|bond|duration|credit/.test(n)) return 7.2;
    if (/balanced advantage|dynamic asset|hybrid|equity savings|multi asset|asset allocation/.test(n)) return 9.5;
    if (/small ?cap/.test(n)) return 14;
    if (/mid ?cap/.test(n)) return 13;
    return 12;
  }
  return 6;
}

// which of your investment lines (Monthly expenses → plan, type "invest") feed which net worth line
const FEEDS = [
  [/\bppf\b/i, l => l.category === "ppf"],
  [/\b(epf|vpf|pf|provident)\b/i, l => l.category === "epf"],
  [/\bnps\b/i, l => l.category === "nps"],
  [/\b(us|usa|vested|indmoney|nasdaq|s&p|international|global)\b/i, l => l.category === "intl"],
  [/crypto|bitcoin|btc|coindcx|coinswitch|wazirx/i, l => l.category === "crypto"],
  [/gold|sgb/i, l => l.category === "gold" || (l.category === "mf" && /gold/i.test(l.name))],
  [/arbitrage|liquid|emergency/i, l => l.category === "mf" && /arbitrage|liquid|overnight|money market/i.test(`${l.fundCategory || ""} ${l.name}`)],
  [/\bfd\b|fixed deposit|\brd\b|recurring/i, l => l.category === "fd"],
  [/stock|share|equity|smallcase|direct/i, l => l.category === "stocks"],
  [/\bmf\b|sip|mutual|fund|flexi|index|nifty|elss|small ?cap|mid ?cap|large ?cap/i, l => l.category === "mf" && !/arbitrage|liquid|overnight|money market|debt|bond|gilt/i.test(`${l.fundCategory || ""} ${l.name}`)]
];
const GENERIC = new Set(["fund", "direct", "plan", "growth", "sip", "the", "and", "regular", "option", "index", "kids", "education", "stocks", "liquid", "yearly", "expenses"]);
// planLines: [{ name, amount }] (monthly). Returns { byLine: { id: amount }, notes: [{ plan, amount, to:[names] } | { plan, amount, unmatched:true }] }
export function matchContributions(lines = [], planLines = []) {
  const byLine = {}, notes = [];
  for (const p of planLines) {
    if (!(p.amount > 0)) continue;
    // a line named after the fund itself ("Parag Parikh Flexi Cap", "UTI Nifty200 Momentum 30") goes to that fund only
    const words = String(p.name).toLowerCase().replace(/\(.*?\)/g, " ").split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !GENERIC.has(w));
    const named = words.length >= 2 ? lines.filter(l => { const n = String(l.name || "").toLowerCase(); return words.every(w => n.includes(w)); }) : [];
    const hit = named.length ? null : FEEDS.find(([re]) => re.test(p.name));
    const targets = named.length ? named : hit ? lines.filter(hit[1]) : [];
    if (!targets.length) { notes.push({ plan: p.name, amount: p.amount, unmatched: true }); continue; }
    const tot = targets.reduce((a, l) => a + Math.max(l.value, 0), 0); // split across matching lines by size (equally when all are zero)
    for (const l of targets) byLine[l.id] = (byLine[l.id] || 0) + (tot > 0 ? p.amount * l.value / tot : p.amount / targets.length);
    notes.push({ plan: p.name, amount: p.amount, to: targets.map(l => l.name) });
  }
  for (const k of Object.keys(byLine)) byLine[k] = Math.round(byLine[k]);
  return { byLine, notes };
}

// lines: [{ id, name, category, bucket, value, monthly, rate }]; years: to retirement
export function projectLines(lines = [], { years = 25, stepUp = 0, inflation = 6 } = {}) {
  const months = Math.max(12, Math.round(years * 12)), marks = [...new Set([0, 1, 3, 5, 10, 15, 20, 25, 30, 35, 40].filter(y => y < years).concat([Math.round(years * 10) / 10]))];
  const out = lines.map(l => {
    const g = Math.pow(1 + (l.rate || 0) / 100, 1 / 12) - 1; let v = l.value || 0, put = 0, yearPut = 0; const at = { 0: r0(v) };
    for (let m = 1; m <= months; m++) {
      if ((m - 1) % 12 === 0) yearPut = 0;
      let c = (l.monthly || 0) * Math.pow(1 + stepUp / 100, Math.floor((m - 1) / 12));
      if (l.category === "ppf") c = Math.max(0, Math.min(c, PPF_YEARLY_CAP - yearPut));
      yearPut += c; put += c; v = v * (1 + g) + c;
      if (m % 12 === 0 || m === months) at[Math.round(m / 12 * 10) / 10] = r0(v);
    }
    return { id: l.id, name: l.name, category: l.category, bucket: l.bucket, now: r0(l.value), monthly: r0(l.monthly), rate: l.rate, added: r0(put), atRetire: r0(v), growth: r0(v - (l.value || 0) - put), at, ppfCapped: l.category === "ppf" && (l.monthly || 0) * 12 > PPF_YEARLY_CAP };
  });
  const sumAt = (rows, y) => rows.reduce((a, r) => a + (r.at[y] ?? 0), 0);
  const deflate = y => Math.pow(1 + inflation / 100, y);
  const buckets = {}; for (const r of out) (buckets[r.bucket] ||= []).push(r);
  const byBucket = Object.fromEntries(Object.entries(buckets).map(([b, rows]) => [b, { now: rows.reduce((a, r) => a + r.now, 0), monthly: rows.reduce((a, r) => a + r.monthly, 0), atRetire: rows.reduce((a, r) => a + r.atRetire, 0), added: rows.reduce((a, r) => a + r.added, 0), marks: marks.map(y => ({ y, value: sumAt(rows, y) })) }]));
  const total = { now: out.reduce((a, r) => a + r.now, 0), monthly: out.reduce((a, r) => a + r.monthly, 0), atRetire: out.reduce((a, r) => a + r.atRetire, 0), added: out.reduce((a, r) => a + r.added, 0), marks: marks.map(y => ({ y, value: sumAt(out, y), real: r0(sumAt(out, y) / deflate(y)) })) };
  total.real = r0(total.atRetire / deflate(years)); total.growth = total.atRetire - total.now - total.added;
  return { years, marks, lines: out, byBucket, total };
}
