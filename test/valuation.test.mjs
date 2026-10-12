import test from "node:test";
import assert from "node:assert/strict";
import { capClass, computeValuation, MODEL, sanitizeEntry, parseCsv, ageDays } from "../valuation.mjs";

const stock = (o = {}) => ({ id: 1, company: "X", marketSymbol: "X", price: 100, low: 60, high: 140, ...o });
const base = { price: 100, pe: 20, roce: 15, salesCagr3: 15, profitCagr3: 15, asOf: "2026-10-01" };
const NOW = new Date("2026-10-03").getTime();

test("fair P/E = 10 + growth + ROCE adjustment", () => {
  const v = computeValuation(stock(), base, NOW);
  assert.equal(v.fairPE, 25); // 10 + 15 + 0
  assert.equal(v.ratio, 0.8);
  assert.equal(v.view, "Fair");
});
test("view bands", () => {
  const view = pe => computeValuation(stock(), { ...base, pe }, NOW).view;
  assert.equal(view(10), "Undervalued"); assert.equal(view(25), "Fair"); assert.equal(view(35), "Fair to rich"); assert.equal(view(50), "Rich"); assert.equal(view(120), "Very rich");
});
test("P/E is re-scaled when live price moves", () => {
  const v = computeValuation(stock({ price: 150 }), base, NOW);
  assert.equal(v.pe, 30);
});
test("cheap stock gets a zone around today's price and is In zone", () => {
  const v = computeValuation(stock(), { ...base, pe: 10 }, NOW);
  assert.equal(v.zoneLow, 90); assert.equal(v.zoneHigh, 105); assert.equal(v.status, "In zone");
});
test("rich stock: zone below price; far above -> Wait", () => {
  const v = computeValuation(stock({ low: 20, high: 140 }), { ...base, pe: 60 }, NOW);
  assert.ok(v.zoneHigh < 100); assert.equal(v.status, "Wait (far above)");
});
test("zone is floored near the 52-week low and flagged", () => {
  const v = computeValuation(stock({ low: 90 }), { ...base, pe: 200 }, NOW);
  assert.equal(v.floored, true); assert.ok(v.zoneHigh <= 90 * 1.05 + 0.01);
});
test("penalties reduce fair P/E", () => {
  const plain = computeValuation(stock(), base, NOW).fairPE;
  const pen = f => computeValuation(stock(), { ...base, ...f }, NOW).fairPE;
  assert.ok(pen({ borrowings: 200, reserves: 100 }) < plain);
  assert.ok(pen({ promoterChange3y: -10 }) < plain);
  assert.ok(pen({ cfoToProfit3: 0.3 }) < plain);
  assert.ok(pen({ fcfNegative: 1 }) < plain);
  assert.ok(pen({ debtorDays: 200 }) < plain);
  assert.ok(pen({ inventoryDays: 300 }) < plain);
  assert.equal(pen({ cfoToProfit3: 0.9, fcfNegative: 0, debtorDays: 60 }), plain);
});
test("sector P/E blends into fair P/E", () => {
  const v = computeValuation(stock(), { ...base, sectorPe: 45 }, NOW);
  assert.equal(v.fairPE, 30); // 0.75*25 + 0.25*45 = 30
});
test("lender profile uses P/B vs ROE", () => {
  const v = computeValuation(stock(), { price: 100, pe: 15, pb: 2.0, roe: 20, profile: "financial", asOf: "2026-10-01" }, NOW);
  assert.equal(v.basis, "P/B"); assert.equal(v.fairMultiple, 2); // (20-6)/7
  assert.equal(v.view, "Fair");
  const poor = computeValuation(stock(), { price: 100, pe: 15, pb: 2.0, roe: 9, profile: "financial", asOf: "2026-10-01" }, NOW);
  assert.ok(poor.fairMultiple < 1 && poor.view !== "Fair");
});
test("cyclical profile normalises P/E on average profit", () => {
  const peak = computeValuation(stock(), { ...base, pe: 10, profile: "cyclical", niLatest: 300, niAvg4: 100 }, NOW);
  const plain = computeValuation(stock(), { ...base, pe: 10 }, NOW);
  assert.equal(peak.multiple, 30); assert.ok(plain.multiple === 10 && peak.ratio > plain.ratio);
});
test("bear < base < bull fair value; upside to base computed", () => {
  const v = computeValuation(stock(), base, NOW);
  assert.ok(v.fairValue.bear < v.fairValue.base && v.fairValue.base < v.fairValue.bull);
  assert.equal(v.upsideToBase, Number((v.fairValue.base / 100 - 1).toFixed(3)));
});
test("stale data is flagged; age is computed", () => {
  const v = computeValuation(stock(), { ...base, asOf: "2026-05-01" }, NOW);
  assert.equal(v.stale, true); assert.ok(v.ageDays > MODEL.staleDays);
  assert.equal(ageDays("2026-10-01", NOW), 2);
});
test("missing or loss-making inputs degrade safely", () => {
  assert.equal(computeValuation(stock(), undefined, NOW).status, "Fetch needed");
  assert.equal(computeValuation(stock(), { ...base, pe: -5 }, NOW).status, "Needs P/E");
  assert.equal(computeValuation(stock({ price: null }), { asOf: "2026-10-01" }, NOW).status, "Needs price");
});
test("sanitizeEntry validates symbol, numbers and profile", () => {
  assert.throws(() => sanitizeEntry({ symbol: "bad sym" }));
  assert.throws(() => sanitizeEntry({ symbol: "A", pe: "abc" }));
  assert.throws(() => sanitizeEntry({ symbol: "A", profile: "weird" }));
  assert.deepEqual(sanitizeEntry({ symbol: "a", pe: "12.5", profile: "Cyclical", junk: 1 }), { symbol: "A", pe: 12.5, profile: "cyclical" });
});
test("CSV parser handles quotes and rejects unknown columns", () => {
  assert.deepEqual(parseCsv('symbol,flags\nA,"x, y"\n'), [{ symbol: "A", flags: "x, y" }]);
  assert.throws(() => parseCsv("symbol,foo\nA,1"));
  assert.throws(() => parseCsv("pe\n1"));
});

test("market-cap class from approximate SEBI/AMFI bands, scaled to live price", () => {
  assert.equal(capClass(250000), "Large"); assert.equal(capClass(50000), "Mid"); assert.equal(capClass(9000), "Small"); assert.equal(capClass(null), null);
  const v = computeValuation({ id: 1, company: "X", marketSymbol: "X", price: 200 }, { symbol: "X", price: 100, pe: 15, marketCap: 20000, asOf: new Date().toISOString().slice(0, 10) });
  assert.equal(v.marketCap, 40000); assert.equal(v.cap, "Mid");
});
