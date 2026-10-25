import test from "node:test";
import assert from "node:assert/strict";
import { buildSplit, sanitizeInvestPlan, DEFAULT_INVEST_PLAN } from "../investplan.mjs";

test("invest plan: fixed lines first, the rest by share, compared with today", () => {
  const r = buildSplit({ income: 253000, spend: 142000, current: [{ name: "MF", amount: 10500 }, { name: "PPF", amount: 12500 }, { name: "US Stocks", amount: 20000 }, { name: "Crypto", amount: 2000 }], plan: DEFAULT_INVEST_PLAN, spendMonths: 4 });
  assert.equal(r.available, 111000);
  const by = n => r.lines.find(l => l.name.startsWith(n));
  assert.equal(by("PPF").amount, 12500); assert.equal(by("Yearly").amount, 15000); assert.equal(by("Crypto").amount, 2000);
  const rest = 111000 - 29500; assert.equal(by("Parag").amount, Math.round(rest * 30 / 80 / 500) * 500);
  assert.ok(Math.abs(r.unallocated) <= 1500);
  assert.equal(by("PPF").current, 12500); assert.equal(by("US Stocks").current, 20000); assert.equal(by("Crypto").current, 2000);
  assert.deepEqual(r.other, [{ name: "MF", current: 10500 }]);
  assert.ok(r.equityPct > 70); assert.ok(r.notes.some(n => /no job yet/.test(n.text)));
});
test("invest plan: fixed lines scaled down when they exceed what's left; editing rules", () => {
  const r = buildSplit({ income: 100000, spend: 90000, plan: DEFAULT_INVEST_PLAN });
  assert.ok(r.total <= 10500); assert.ok(r.notes.some(n => /scaled down/.test(n.text)));
  assert.ok(buildSplit({ income: 0, spend: 0 }).notes.some(n => /No income/.test(n.text)));
  const p = sanitizeInvestPlan({ lines: [{ name: "Core", kind: "share", weight: "70" }, { name: "PPF", kind: "fixed", amount: "12,500" }, { name: "" }], buffer: "5000" });
  assert.equal(p.lines.length, 2); assert.equal(p.lines[1].amount, 12500); assert.equal(p.buffer, 5000);
  assert.throws(() => sanitizeInvestPlan({ lines: [] }));
});
