import { test } from "node:test";
import assert from "node:assert/strict";
import { isEtf, etfType, indexFor, etfLens, pctileFromQ, parseQ, parseAllIndices } from "../etf.mjs";
import { computeValuation, sanitizeEntry } from "../valuation.mjs";
import { classify } from "../classify.mjs";

// 5 years of daily closes: 12%/yr trend with a slow ±12% cycle around it (deterministic)
const bars = (n = 1250, start = 100) => Array.from({ length: n }, (_, i) => { const c = start * 1.12 ** (i / 252) * (1 + 0.12 * Math.sin(i / 60)); return { t: 1.6e9 + i * 86400, c, h: c * 1.005, l: c * 0.995 }; });

test("ETF detection, type and tracked index", () => {
  for (const s of ["NIFTYBEES", "JUNIORBEES", "GOLDBEES", "SILVERBEES", "BANKBEES", "LIQUIDBEES", "MON100", "SETFNIF50", "NIF100IETF"]) assert.ok(isEtf(s), s);
  assert.ok(isEtf("XYZ", "Mirae Asset Nifty Midcap 150 ETF")); assert.ok(!isEtf("TCS", "Tata Consultancy Services")); assert.ok(!isEtf("TIPSMUSIC", "Tips Music Ltd")); assert.ok(!isEtf("THANGAMAYL", "Thangamayil Jewellery"));
  assert.deepEqual(["GOLDBEES", "SILVERBEES", "LIQUIDBEES", "MON100", "NIFTYBEES"].map(s => etfType(s)), ["gold", "silver", "debt", "international", "equity"]);
  assert.deepEqual(["NIFTYBEES", "JUNIORBEES", "BANKBEES", "PSUBNKBEES", "ITBEES", "GOLDBEES"].map(s => indexFor(s)), ["NIFTY 50", "NIFTY NEXT 50", "NIFTY BANK", "NIFTY PSU BANK", "NIFTY IT", null]);
  assert.deepEqual(parseAllIndices({ data: [{ index: "NIFTY 50", pe: "22.1", pb: "3.6", dy: "1.2", last: 25000 }] })["NIFTY 50"], { pe: 22.1, pb: 3.6, dy: 1.2, last: 25000 });
});

test("ETF lens: 200-day gap history, percentile, returns; entry passes the fundamentals whitelist", () => {
  const e = etfLens(bars(), { symbol: "NIFTYBEES", name: "Nippon India ETF Nifty 50 BeES", index: "NIFTY 50", indexStats: { pe: 21.5, pb: 3.4, dy: 1.3 }, inav: null, today: "2026-10-13" });
  assert.equal(e.profile, "etf"); assert.equal(e.etfType, "equity"); assert.ok(e.dma200 > 0 && e.dma50 > 0);
  const q = parseQ(e.etfDevQ); assert.equal(q.length, 21); assert.ok(q.every((x, i) => i === 0 || x >= q[i - 1]), "quantiles ascend");
  assert.ok(e.cagr1 > 0 && e.cagr3 > 5 && e.cagr3 < 20, `3-yr return ${e.cagr3}`); assert.equal(e.indexPe, 21.5); assert.equal(e.histYears, 4.96);
  const clean = sanitizeEntry(e); assert.equal(clean.etfDevQ, e.etfDevQ); assert.equal(clean.dma200, e.dma200); assert.equal(clean.profile, "etf");
  assert.equal(pctileFromQ(q, q[0] - 1), 0); assert.equal(pctileFromQ(q, q[20] + 1), 100); assert.equal(pctileFromQ(q, q[10]), 50);
});

test("ETF valuation: cheap vs its trend = buy zone, stretched = expensive, debt ETF = no zone", () => {
  const e = sanitizeEntry(etfLens(bars(), { symbol: "NIFTYBEES", name: "Nifty BeES", index: "NIFTY 50", indexStats: { pe: 21.5 }, today: "2026-10-13" }));
  const q = parseQ(e.etfDevQ), at = dev => +(e.dma200 * (1 + dev)).toFixed(2);
  const cheap = computeValuation({ id: 1, company: "Nifty BeES", marketSymbol: "NIFTYBEES", price: at(q[2]) }, e);
  assert.equal(cheap.basis, "ETF trend"); assert.equal(cheap.view, "Undervalued"); assert.ok(cheap.status === "In zone" || cheap.status === "Below zone", cheap.status);
  assert.ok(cheap.zoneLow < cheap.zoneHigh); assert.ok(cheap.fairValue.bear <= cheap.fairValue.base && cheap.fairValue.base <= cheap.fairValue.bull);
  assert.equal(classify(cheap).key, "buy"); assert.match(classify(cheap).label, /accumulate/); assert.ok(classify(cheap).tags.includes("ETF"));
  assert.ok(cheap.reasons.some(x => /200-day average/.test(x)) && cheap.reasons.some(x => /NIFTY 50: P\/E 21.5/.test(x)));
  const fair = computeValuation({ id: 1, company: "Nifty BeES", marketSymbol: "NIFTYBEES", price: at(q[9]) }, e);
  assert.equal(fair.view, "Fair"); assert.equal(classify(fair).key, "wait");
  const rich = computeValuation({ id: 1, company: "Nifty BeES", marketSymbol: "NIFTYBEES", price: at(q[20] + 0.03) }, e);
  assert.equal(rich.view, "Very rich"); assert.equal(classify(rich).key, "expensive"); assert.ok(rich.upsideToBase < 0);
  const liquid = sanitizeEntry(etfLens(bars(400, 1000).map(b => ({ ...b, c: 1000, h: 1000, l: 1000 })), { symbol: "LIQUIDBEES", name: "Liquid BeES", today: "2026-10-13" }));
  const lv = computeValuation({ id: 2, company: "Liquid BeES", marketSymbol: "LIQUIDBEES", price: 1000 }, liquid);
  assert.equal(lv.status, "Cash-like"); assert.match(classify(lv).label, /parking cash/);
  const young = sanitizeEntry(etfLens(bars(120), { symbol: "NEWETF", name: "New ETF", today: "2026-10-13" }));
  const yv = computeValuation({ id: 3, company: "New ETF", marketSymbol: "NEWETF", price: young.low52 * 1.02 }, young);
  assert.equal(yv.confidence, "low"); assert.equal(yv.view, "Undervalued"); assert.match(classify(yv).label, /low confidence/);
  const gold = sanitizeEntry(etfLens(bars(), { symbol: "GOLDBEES", name: "Gold BeES", inav: 99, today: "2026-10-13" }));
  const gv = computeValuation({ id: 4, company: "Gold BeES", marketSymbol: "GOLDBEES", price: gold.price }, gold);
  assert.ok(gv.reasons.some(x => /hedge/.test(x))); assert.ok(Number.isFinite(gv.etf.premium));
});
