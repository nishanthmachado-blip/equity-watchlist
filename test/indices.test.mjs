import test from "node:test";
import assert from "node:assert/strict";
import { parseIndexStocks, parseIndexCsv, fillFromBars, smartRows, indexSummary, normIndex, SMART_INDICES } from "../indices.mjs";

const NSE = { name: "NIFTY500 QUALITY 50", data: [
  { priority: 1, symbol: "NIFTY500 QUALITY 50", lastPrice: 24000, pChange: 0.4, perChange365d: 9.5 },
  { symbol: "AAA", lastPrice: 100, pChange: 1, perChange30d: 5, perChange365d: 40, yearHigh: 104, yearLow: 60, ffmc: 300, meta: { companyName: "Aaa Ltd", industry: "IT" } },
  { symbol: "BBB", lastPrice: 80, pChange: -1, perChange30d: -3, perChange365d: 10, yearHigh: 100, yearLow: 70, ffmc: 100, meta: { companyName: "Bbb Ltd", industry: "Banks" } },
  { symbol: "CCC", lastPrice: 55, pChange: -2, perChange30d: -9, perChange365d: -30, yearHigh: 100, yearLow: 52, ffmc: 100, meta: { companyName: "Ccc Ltd", industry: "IT" } }] };

test("index constituents from NSE: index row split out, weights from free-float market cap", () => {
  const r = parseIndexStocks(NSE);
  assert.equal(r.index.last, 24000); assert.equal(r.rows.length, 3);
  assert.deepEqual(r.rows.map(x => [x.symbol, x.weight, x.industry]), [["AAA", 60, "IT"], ["BBB", 20, "Banks"], ["CCC", 20, "IT"]]);
  assert.equal(normIndex("Nifty500 Quality 50"), normIndex("NIFTY500 QUALITY 50"));
  assert.ok(SMART_INDICES.some(x => x.name === "NIFTY200 MOMENTUM 30"));
});
test("niftyindices CSV fallback, priced from daily closes", () => {
  const rows = parseIndexCsv("Company Name,Industry,Symbol,Series,ISIN Code\nAaa Ltd.,Information Technology,AAA,EQ,INE1\nBbb Ltd.,Financial Services,BBB,EQ,INE2\n");
  assert.deepEqual(rows.map(r => [r.symbol, r.industry]), [["AAA", "Information Technology"], ["BBB", "Financial Services"]]);
  const bars = Array.from({ length: 260 }, (_, i) => ({ c: 100 + i, h: 101 + i, l: 99 + i }));
  const f = fillFromBars(rows[0], bars);
  assert.equal(f.price, 359); assert.equal(f.high52, 360); assert.ok(f.ch365d > 100); assert.ok(f.ch30d > 5);
});
test("smart score, tags and summary", () => {
  const rows = parseIndexStocks(NSE).rows;
  const val = new Map([["AAA", { view: "Undervalued", ratio: 0.6, upsideToBase: 0.4, roce: 30, fairValue: { base: 140 } }], ["CCC", { view: "Rich", ratio: 2, upsideToBase: -0.4, roce: 8 }]]);
  const s = smartRows(rows, { val, tech: new Map([["BBB", { sma200: 75, rsi: 48 }]]), held: new Set(["BBB"]), watch: new Set(["AAA"]) });
  const a = s.find(x => x.symbol === "AAA"), b = s.find(x => x.symbol === "BBB"), c = s.find(x => x.symbol === "CCC");
  assert.ok(a.score > 80 && !a.partial, `AAA ${a.score}`); assert.deepEqual(a.tags, ["undervalued", "momentum"]);
  assert.ok(b.partial && b.tags.includes("pullback") && b.above200 === true && b.held);
  assert.ok(c.score < 35 && c.tags.includes("near-low"), `CCC ${c.score}`);
  assert.ok(a.why.some(w => /Undervalued/.test(w)) && a.why.some(w => /1-year return 40%/.test(w)));
  const sum = indexSummary(s);
  assert.deepEqual([sum.count, sum.held, sum.heldWeight, sum.watching, sum.valued, sum.undervalued], [3, 1, 20, 1, 2, 1]);
  assert.equal(sum.industries[0].industry, "IT");
});
