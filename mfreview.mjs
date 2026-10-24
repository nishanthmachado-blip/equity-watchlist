// Mutual fund review: one call per fund you hold — Build, Keep, Hold (don't add), Exit / switch, or Review — with the
// reasons, the way a fund-review app does it, from data this app has:
//   returns      1, 3 and 5-year returns from the fund's NAV history, against the index its category follows
//   overlap      how much of the fund sits in the same stocks as your other funds (X-ray), and in your own stocks
//   duplicates   two funds of the same category: the weaker one is the one to fold into the other
//   valuation    the fund's stocks through this app's valuation: weighted P/E, % in a buy zone, % expensive
//   size         a fund under 3% of your fund money adds little but another line to track
//   buy zone     NAV under its 52-week high: 10%+ is a bulk-buy zone for a fund you mean to build, 20%+ a strong one
// Plus "needs your review": funds new in your portfolio, without an X-ray, whose portfolio changed a lot, or that lag.
// Pure functions: the server supplies NAV histories, index bars, X-ray holdings and your holdings. Not advice.
const fin = v => Number.isFinite(v);
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null), r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null), r0 = v => (fin(v) ? Math.round(v) : null);
const inr = v => `₹${Math.round(Math.abs(v)).toLocaleString("en-IN")}`;
export const FUND_RULES = Object.freeze({ lagPct: 3, beatPct: 2, overlapHigh: 60, overlapNote: 40, smallPct: 3, bulkDipPct: 10, strongDipPct: 20, nearDipPct: 7, maxEquityFunds: 7, churnPct: 30, newDays: 45, staleXrayDays: 45 });
export const VERDICTS = ["Exit / switch", "Review", "Build", "Hold (don't add)", "Keep"];
const DAY = 864e5;

// mfapi.in scheme JSON → { name, house, category, navs: [{ d, v }] oldest first }
export function parseMfapi(j) {
  const m = j?.meta || {}, navs = [];
  for (const x of Array.isArray(j?.data) ? j.data : []) {
    const mm = String(x.date || "").match(/^(\d{2})-(\d{2})-(\d{4})$/), v = Number(x.nav);
    if (mm && v > 0) navs.push({ d: `${mm[3]}-${mm[2]}-${mm[1]}`, v });
  }
  navs.sort((a, b) => a.d.localeCompare(b.d));
  return { name: m.scheme_name || null, house: m.fund_house || null, category: m.scheme_category || null, type: m.scheme_type || null, navs };
}
const shift = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
// value on or just before a day
function at(series, day) { let lo = 0, hi = series.length - 1, best = null; while (lo <= hi) { const m = (lo + hi) >> 1; if (series[m].d <= day) { best = series[m]; lo = m + 1; } else hi = m - 1; } return best; }
// series [{ d, v }] oldest first → returns (CAGR for 3y / 5y), 52-week high and the fall from it
export function seriesStats(series) {
  if (!series?.length) return null;
  const last = series.at(-1), today = last.d, cagr = yrs => { const p = at(series, shift(today, -Math.round(365.25 * yrs))); if (!p || Date.parse(today) - Date.parse(p.d) < (365.25 * yrs - 10) * DAY) return null; return r1((Math.pow(last.v / p.v, 1 / yrs) - 1) * 100); };
  if (series[0].d > shift(today, -360)) return { nav: last.v, asOf: today, ret1y: null, ret3y: null, ret5y: null, high52: null, fromHigh: null, young: true };
  const yr = series.filter(x => x.d >= shift(today, -365)), high = Math.max(...yr.map(x => x.v));
  return { nav: last.v, asOf: today, ret1y: cagr(1), ret3y: cagr(3), ret5y: cagr(5), high52: r2(high), fromHigh: r1((1 - last.v / high) * 100), low52: r2(Math.min(...yr.map(x => x.v))) };
}
export const barsToSeries = bars => (bars || []).filter(b => b.c > 0).map(b => ({ d: new Date((b.t + 19800) * 1000).toISOString().slice(0, 10), v: b.c }));

// The index a category follows (app's index keys); null for non-equity
export function benchFor(category = "", name = "") {
  const c = `${category} ${name}`.toLowerCase();
  const equityish = /equity|elss|index|etf|nifty|sensex|flexi|large|mid|small|multi|focused|value|contra|dividend yield|sectoral|thematic/.test(c);
  const other = /debt|liquid|gilt|money market|overnight|bond|credit|duration|arbitrage|hybrid|balanced|gold|silver|fund of funds/.test(c) && !/equity savings/.test(c);
  if (!equityish || other) return null;
  if (/small/.test(c)) return "SMALLCAP250";
  if (/mid/.test(c) && !/large & mid|large and mid/.test(c)) return "MIDCAP150";
  if (/large cap|large-cap|nifty 50\b|nifty50|sensex|bluechip/.test(c) && !/large & mid|large and mid/.test(c)) return "NIFTY50";
  return "NIFTY500";
}
export const BENCH_LABEL = { NIFTY50: "Nifty 50", NIFTY500: "Nifty 500", MIDCAP150: "Nifty Midcap 150", SMALLCAP250: "Nifty Smallcap 250" };
export const isIndexFund = (name = "", category = "") => /\bindex\b|\betf\b|nifty|sensex/i.test(`${name} ${category}`) && !/fund of fund/i.test(name);
const shortCat = c => String(c || "").replace(/^(equity|hybrid|debt|other) scheme\s*-\s*/i, "").trim() || null;

// funds: [{ key, name, value, invested, isin, fundId, firstSeen }]; nav: Map(key → { stats, category, house }); bench: Map(benchKey → stats);
// xray: Map(fundId → { holdings, asOf, updatedAt, churn }); summary: Map(fundId → fundSummary); overlap(a, b) → % (fund ids);
// directPct: Map(fundId → % of the fund in stocks you hold directly)
export function reviewFunds({ funds = [], nav = new Map(), bench = new Map(), xray = new Map(), summary = new Map(), overlap = () => null, directPct = new Map(), today = new Date().toISOString().slice(0, 10), rules = FUND_RULES } = {}) {
  const total = funds.reduce((a, f) => a + (f.value > 0 ? f.value : 0), 0);
  const rows = funds.map(f => {
    const n = nav.get(f.key) || {}, s = n.stats || null, cat = n.category || null, bk = benchFor(cat || "", f.name), b = bk ? bench.get(bk) || null : null;
    const index = isIndexFund(f.name, cat), equity = !!bk, x = f.fundId ? xray.get(f.fundId) : null, sm = f.fundId ? summary.get(f.fundId) : null;
    const share = total > 0 && f.value > 0 ? r1(f.value / total * 100) : null;
    return { key: f.key, name: f.name, fundId: f.fundId || null, xrayName: f.xrayName || null, value: r0(f.value), invested: r0(f.invested), pnlPct: f.invested > 0 && f.value > 0 ? r1((f.value / f.invested - 1) * 100) : null, share, category: shortCat(cat), house: n.house || null, equity, index, bench: bk, benchLabel: BENCH_LABEL[bk] || null, stats: s, benchStats: b, xray: x, summary: sm, directPct: f.fundId ? directPct.get(f.fundId) ?? null : null, firstSeen: f.firstSeen || null, navPending: !!n.pending };
  });
  // pairwise overlap between equity funds with an X-ray
  const withX = rows.filter(r => r.fundId && r.equity !== false), pairs = [];
  for (let i = 0; i < withX.length; i++) for (let j = i + 1; j < withX.length; j++) { if (withX[i].fundId === withX[j].fundId) continue; const o = overlap(withX[i].fundId, withX[j].fundId); if (fin(o)) pairs.push({ a: withX[i].key, b: withX[j].key, pct: o }); }
  // how good a fund has been: 3-year (else 1-year) return over its index; without index history, its own return
  // (only ever compared between funds, and the two-funds-one-category check compares like with like)
  const quality = r => { const s = r.stats, b = r.benchStats; if (!s || s.young) return -99; const a3 = fin(s.ret3y) && fin(b?.ret3y) ? s.ret3y - b.ret3y : null, a1 = fin(s.ret1y) && fin(b?.ret1y) ? s.ret1y - b.ret1y : null; return (a3 ?? a1 ?? s.ret3y ?? s.ret1y ?? 0) + (s.ret5y ?? 0) / 100; };
  const byKey = new Map(rows.map(r => [r.key, r]));
  for (const r of rows) {
    const R = [], add = (tone, text) => R.push({ tone, text }), s = r.stats, b = r.benchStats;
    let exit = null, build = 0, dontAdd = false, review = false;
    // returns vs the category's index (price index: dividends are not in it, so the index is ~1% a year easier to beat)
    if (!r.equity && r.category) add("info", `${r.category}: not an equity fund, so returns and stock valuation are not judged here.`);
    else if (!s) { add("info", r.navPending ? "Fetching the fund's NAV history…" : "No NAV history yet (needs the fund's scheme code from AMFI)."); review = !r.navPending && !r.fundId; }
    else if (s.young) add("info", "Less than a year of NAV history: too new to judge on returns.");
    else {
      const a1 = fin(s.ret1y) && fin(b?.ret1y) ? r1(s.ret1y - b.ret1y) : null, a3 = fin(s.ret3y) && fin(b?.ret3y) ? r1(s.ret3y - b.ret3y) : null;
      const txt = `${fin(s.ret1y) ? `1y ${s.ret1y}%` : ""}${fin(s.ret3y) ? ` · 3y ${s.ret3y}%/yr` : ""}${fin(s.ret5y) ? ` · 5y ${s.ret5y}%/yr` : ""}`.replace(/^ · /, "");
      if (!b) add("info", `Returns: ${txt} (no ${r.benchLabel || "index"} history yet to compare).`);
      else if (r.index) add("info", `Index fund: ${txt} vs the ${r.benchLabel} ${fin(b.ret3y) ? `${b.ret3y}%/yr over 3y` : `${b.ret1y}% over 1y`}. Index funds are judged on cost and tracking, not on beating it.`);
      else {
        const lag = (a3 === null || a3 <= -rules.lagPct) && (a1 === null || a1 <= -rules.lagPct) && (a3 !== null || a1 !== null);
        const beat = a3 !== null ? a3 >= rules.beatPct : a1 !== null && a1 >= rules.beatPct + 2;
        add(lag ? "against" : beat ? "for" : "info", `Returns ${txt} vs the ${r.benchLabel} ${[fin(b.ret1y) ? `1y ${b.ret1y}%` : "", fin(b.ret3y) ? `3y ${b.ret3y}%/yr` : ""].filter(Boolean).join(" · ")}: ${lag ? `behind by ${Math.abs(a3 ?? a1)}%/yr` : beat ? `ahead by ${a3 ?? a1}%${a3 !== null ? "/yr over 3 years" : " this year"}` : "about in line"}.`);
        if (lag) exit = `It has lagged the ${r.benchLabel} over ${a3 !== null && a1 !== null ? "both 1 and 3 years" : a3 !== null ? "3 years" : "the last year"}: an index fund on the same index would have done better.`;
        if (beat) build += 2;
      }
    }
    // overlap with your other funds
    const mine = pairs.filter(p => p.a === r.key || p.b === r.key).map(p => ({ other: byKey.get(p.a === r.key ? p.b : p.a), pct: p.pct })).sort((x, y) => y.pct - x.pct);
    const top = mine[0];
    if (top && top.pct >= rules.overlapNote) {
      const better = quality(top.other) >= quality(r) && (top.other.value || 0) >= (r.value || 0) * 0.5;
      add(top.pct >= rules.overlapHigh ? "against" : "info", `${top.pct}% of it is in the same stocks as ${top.other.name}${mine.length > 1 && mine[1].pct >= rules.overlapNote ? ` (and ${mine[1].pct}% with ${mine[1].other.name})` : ""}.`);
      if (top.pct >= rules.overlapHigh && better && !exit) exit = `Mostly a copy of ${top.other.name}, which ${quality(top.other) > quality(r) ? "has done better" : "you hold more of"}: fold it into that one.`;
      else if (top.pct >= rules.overlapHigh) add("info", `Of the two, this is the one to keep: put new money here rather than in ${top.other.name}.`);
    } else if (top) add("for", `Low overlap with your other funds (at most ${top.pct}% with ${top.other.name}): it adds variety.`);
    else if (r.equity && !r.fundId) { add("info", "No X-ray portfolio linked: overlap with your other funds can't be checked (Mutual fund X-ray → Auto-fetch)."); review = true; }
    // same category twice
    const twin = rows.find(o => o !== r && o.category && o.category === r.category && r.equity && !r.index && !o.index);
    if (twin) { const weaker = quality(r) < quality(twin) || (quality(r) === quality(twin) && (r.value || 0) < (twin.value || 0)); add(weaker ? "against" : "info", `You hold two ${r.category} funds (also ${twin.name})${weaker ? `: this is the weaker one` : ""}.`); if (weaker && !exit && quality(r) < quality(twin) - 1) exit = `Two ${r.category} funds do the same job: keep ${twin.name}.`; }
    // what it holds, through this app's valuation
    const sm = r.summary;
    if (sm && sm.coverage >= 40) {
      add(sm.mix.buy >= 40 ? "for" : sm.mix.expensive >= 50 ? "against" : "info", `Its stocks: ${sm.mix.buy}% in a buy zone, ${sm.mix.expensive}% expensive${fin(sm.weightedPE) ? `, weighted P/E ${sm.weightedPE}` : ""} (${sm.coverage}% of the fund valued).`);
      if (sm.mix.buy >= 40) build += 1; if (sm.mix.expensive >= 50) dontAdd = true;
    }
    if (fin(r.directPct) && r.directPct >= 15) add("info", `${r.directPct}% of the fund is in stocks you also hold directly.`);
    if (r.xray?.churn?.pct >= rules.churnPct) { add("warn", `Its portfolio changed a lot in the last update (${r.xray.churn.pct}% of the money moved${r.xray.churn.added?.length ? `; new: ${r.xray.churn.added.slice(0, 3).join(", ")}` : ""}).`); review = true; }
    // size
    const small = fin(r.share) && r.share < rules.smallPct && rows.length > 3;
    if (small) add("info", `Small: ${r.share}% of your fund money (${inr(r.value || 0)}).`);
    // bulk-buy zone on the NAV
    let zone = null;
    if (s && fin(s.fromHigh) && r.equity) {
      zone = s.fromHigh >= rules.strongDipPct ? "strong" : s.fromHigh >= rules.bulkDipPct ? "bulk" : s.fromHigh >= rules.nearDipPct ? "near" : null;
      if (zone) add(zone === "near" ? "info" : "for", `NAV is ${s.fromHigh}% under its 52-week high (₹${s.high52}): ${zone === "strong" ? "a strong bulk-buy zone" : zone === "bulk" ? "a bulk-buy zone" : `close to the ${rules.bulkDipPct}% bulk-buy zone`}.`);
    }
    let verdict;
    if (exit) verdict = "Exit / switch";
    else if (review && !s) verdict = "Review";
    else if (dontAdd) verdict = "Hold (don't add)";
    else if (build >= 2 || (build >= 1 && (zone === "bulk" || zone === "strong"))) verdict = "Build";
    else verdict = "Keep";
    if (small && verdict === "Keep" && rows.length > rules.maxEquityFunds) { verdict = "Exit / switch"; exit = "Too small to matter and you hold many funds: fold it into a fund you are building."; }
    if (verdict === "Exit / switch") add("warn", "Before you switch: check the exit load (often 1% within a year of buying) and the tax on gains (equity funds: 20% if held under a year, 12.5% above ₹1.25 lakh a year after that). Switching in stages, or stopping the SIP first, softens both.");
    r.verdict = verdict; r.exitWhy = exit; r.reasons = R;
    r.bulk = verdict === "Build" || verdict === "Keep" ? zone : null;
    r.lean = verdict === "Build" ? (r.bulk === "strong" || r.bulk === "bulk" ? "Bulk buy now (NAV is in its buy zone)" : "Build with your SIP; add lump sums on 10%+ dips") : verdict === "Keep" ? (r.bulk === "bulk" || r.bulk === "strong" ? "Good time for a lump sum" : "Keep the SIP running") : verdict === "Hold (don't add)" ? "Keep what you have; send new money elsewhere" : verdict === "Exit / switch" ? exit : "Link its X-ray / wait for its NAV history, then review";
    r.needsReview = [r.firstSeen && r.firstSeen >= shift(today, -rules.newDays) ? "new in your portfolio" : null, r.equity && !r.fundId ? "no X-ray portfolio" : null, r.xray && r.xray.updatedAt && Date.parse(today) - Date.parse(r.xray.updatedAt) > rules.staleXrayDays * DAY ? "X-ray portfolio is old" : null, r.xray?.churn?.pct >= rules.churnPct ? "portfolio changed a lot" : null, verdict === "Exit / switch" ? "the review says exit / switch" : null].filter(Boolean);
  }
  rows.sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) || (b.value || 0) - (a.value || 0));
  const equityFunds = rows.filter(r => r.equity).length;
  const counts = Object.fromEntries(VERDICTS.map(v => [v, rows.filter(r => r.verdict === v).length]));
  const notes = [];
  if (equityFunds > rules.maxEquityFunds) notes.push(`You hold ${equityFunds} equity funds: beyond 5–7 most of them overlap and the portfolio behaves like an expensive index fund.`);
  const hi = pairs.filter(p => p.pct >= rules.overlapHigh);
  return { rows, counts, total: r0(total), pairs: pairs.sort((a, b) => b.pct - a.pct).slice(0, 12).map(p => ({ a: byKey.get(p.a).name, b: byKey.get(p.b).name, pct: p.pct })), highOverlap: hi.length,
    bulkNow: rows.filter(r => r.bulk === "bulk" || r.bulk === "strong").map(r => ({ key: r.key, name: r.name, zone: r.bulk, fromHigh: r.stats.fromHigh, nav: r.stats.nav, high52: r.stats.high52 })),
    review: rows.filter(r => r.needsReview.length).map(r => ({ key: r.key, name: r.name, why: r.needsReview })), notes, rules };
}

// Library funds you don't hold, least overlapping with what you hold: [{ id, name, overlapPct, stats }]
export function fundIdeas({ library = [], heldIds = new Set(), overlapWithMine = () => null, stats = new Map() } = {}) {
  return library.filter(f => !heldIds.has(f.id)).map(f => ({ id: f.id, name: f.name, overlapPct: overlapWithMine(f.id), stats: stats.get(f.id) || null, index: isIndexFund(f.name) }))
    .filter(x => fin(x.overlapPct)).sort((a, b) => a.overlapPct - b.overlapPct).slice(0, 8);
}

// Bulk-buy zone alerts for funds you mean to keep or build (once per fund per 5 days, again when it turns strong)
export function diffFundAlerts(state = {}, review, { now = Date.now() } = {}) {
  const next = {}, fresh = [];
  for (const r of review.rows) {
    const was = state[r.key] || {}, cur = { zone: r.bulk || null, at: was.at || null };
    const hot = r.bulk === "bulk" || r.bulk === "strong", wasHot = was.zone === "bulk" || was.zone === "strong", up = r.bulk === "strong" && was.zone === "bulk";
    if (hot && (!wasHot || up) && !(was.at && now - was.at < 5 * DAY && !up)) {
      cur.at = now;
      fresh.push({ key: `mf-${r.key}-${r.bulk}-${new Date(now + 19800e3).toISOString().slice(0, 10)}`, type: "mf-bulk", symbol: null, company: r.name, at: new Date(now).toISOString(), read: false,
        title: `🧺 ${r.name}: ${r.bulk === "strong" ? "strong bulk-buy zone" : "bulk-buy zone"} (NAV ${r.stats.fromHigh}% under its high)`, detail: `${r.verdict}. ${r.lean}. NAV ₹${r.stats.nav}, 52-week high ₹${r.stats.high52}.` });
    }
    next[r.key] = cur;
  }
  return { next, fresh };
}

// Portfolio change between two X-ray snapshots of one fund: % of the money that moved, stocks added / removed
export function portfolioChurn(prev = [], next = []) {
  const key = h => h.symbol || h.isin || String(h.name || "").toLowerCase();
  const norm = hs => { const m = new Map(); let t = 0; for (const h of hs || []) if (h.weight > 0) { m.set(key(h), { name: h.name, symbol: h.symbol, w: (m.get(key(h))?.w || 0) + h.weight }); t += h.weight; } for (const v of m.values()) v.w = t > 0 ? v.w / t * 100 : 0; return m; };
  const A = norm(prev), B = norm(next); if (!A.size || !B.size) return null;
  let moved = 0; for (const k of new Set([...A.keys(), ...B.keys()])) moved += Math.abs((A.get(k)?.w || 0) - (B.get(k)?.w || 0));
  const big = (X, Y) => [...X].filter(([k, v]) => !Y.has(k) && v.w >= 1).sort((a, b) => b[1].w - a[1].w).map(([, v]) => v.symbol || v.name);
  return { pct: r1(moved / 2), added: big(B, A).slice(0, 6), removed: big(A, B).slice(0, 6) };
}
