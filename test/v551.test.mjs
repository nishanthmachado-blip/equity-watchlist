import test from "node:test";
import assert from "node:assert/strict";
import { defaultRate, matchContributions, projectLines, PPF_YEARLY_CAP } from "../bucketgrowth.mjs";
import { sanitizeBucketPlan } from "../buckets.mjs";

const lines = [
  { id: "epf", name: "EPF", category: "epf", bucket: "retirement", value: 3500000 },
  { id: "nps", name: "NPS", category: "nps", bucket: "retirement", value: 1400000 },
  { id: "ppf", name: "SBI PPF", category: "ppf", bucket: "short", value: 610000 },
  { id: "arb", name: "Kotak Arbitrage Fund", category: "mf", bucket: "safety", value: 1000000 },
  { id: "flexi", name: "Parag Parikh Flexi Cap", category: "mf", bucket: "long", value: 3000000 },
  { id: "small", name: "Nippon Small Cap", category: "mf", bucket: "long", value: 1000000 }
];
test("typical returns by asset", () => {
  assert.equal(defaultRate(lines[0]), 8.25); assert.equal(defaultRate(lines[2]), 7.1); assert.equal(defaultRate(lines[3]), 6.5);
  assert.equal(defaultRate(lines[4]), 12); assert.equal(defaultRate(lines[5]), 14); assert.equal(defaultRate({ category: "cash" }), 3.5);
});
test("Monthly expenses investment lines feed the matching net worth lines", () => {
  const m = matchContributions(lines, [{ name: "PPF", amount: 12500 }, { name: "MF", amount: 40000 }, { name: "NPS", amount: 5000 }, { name: "US Stocks", amount: 20000 }, { name: "Arbitrage", amount: 10000 }]);
  assert.equal(m.byLine.ppf, 12500); assert.equal(m.byLine.nps, 5000); assert.equal(m.byLine.arb, 10000);
  assert.equal(m.byLine.flexi, 30000); assert.equal(m.byLine.small, 10000, "split by size across equity funds");
  assert.ok(m.notes.find(n => n.plan === "US Stocks").unmatched);
});
test("projection: compounding, contributions, PPF cap, bucket totals", () => {
  const p = projectLines([{ ...lines[0], monthly: 0, rate: 8 }, { ...lines[2], monthly: 20000, rate: 0 }], { years: 10, stepUp: 0, inflation: 6 });
  const epf = p.lines.find(l => l.id === "epf"), ppf = p.lines.find(l => l.id === "ppf");
  assert.ok(Math.abs(epf.atRetire - 3500000 * Math.pow(1.08, 10)) < 5);
  assert.equal(ppf.added, PPF_YEARLY_CAP * 10, "PPF deposits stop at ₹1.5 L a year"); assert.ok(ppf.ppfCapped);
  assert.equal(p.byBucket.retirement.atRetire, epf.atRetire);
  assert.equal(p.total.atRetire, epf.atRetire + ppf.atRetire);
  assert.deepEqual(p.marks, [0, 1, 3, 5, 10]);
  assert.ok(p.total.real < p.total.atRetire);
  const up = projectLines([{ ...lines[3], value: 0, monthly: 10000, rate: 0 }], { years: 2, stepUp: 10 });
  assert.equal(up.total.added, 120000 + 132000);
});
test("bucket plan keeps per-line contributions and returns; empty resets", () => {
  let p = sanitizeBucketPlan({ contrib: { epf: "15000", bad: "x" }, rate: { epf: "8.1" }, stepUp: "5" }, {});
  assert.deepEqual(p.contrib, { epf: 15000 }); assert.deepEqual(p.rate, { epf: 8.1 }); assert.equal(p.stepUp, 5);
  p = sanitizeBucketPlan({ contrib: { epf: "" } }, p);
  assert.deepEqual(p.contrib, {}); assert.equal(p.rate.epf, 8.1); assert.equal(p.stepUp, 5);
});
