import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parsePaste, ledgerView, sanitizeEntry, stockKey } from "../divledger.mjs";

const sheet = fs.readFileSync(new URL("./fixtures/dividend-sheet.tsv", import.meta.url), "utf8");

test("your sheet pasted from Excel: every amount under the right stock and month; totals and payer lists skipped", () => {
  const p = parsePaste(sheet);
  assert.deepEqual(p.years, [2025, 2026]); assert.equal(p.entries.length, 60); assert.deepEqual(p.skipped, []);
  const es = p.entries.map((e, i) => ({ ...e, id: `e${i}` }));
  const y25 = ledgerView(es, { year: 2025, today: "2026-11-08" });
  assert.deepEqual(y25.monthTotals, [659, 2062, 1180, 269, 657, 5401, 2807, 4505, 385, 0, 3429, 0]); // the sheet's own TOTAL row
  assert.equal(y25.total, 21354); assert.equal(y25.rows.length, 18);
  assert.deepEqual(y25.payers[5], ["HDFC AMC", "Infy", "Asian Paints", "Tata Motors", "Angel One", "Nuvama", "Tata Elxsi"]);
  const y26 = ledgerView(es, { year: 2026, today: "2026-11-08" });
  assert.deepEqual(y26.monthTotals.slice(0, 8), [760, 11559, 600, 600, 0, 5472, 11876, 8461]);
  assert.equal(y26.monthTotals[8], 195.1); // ONGC 50 and REC 3.1 counted (the sheet's Sep total of 142 left them out)
  assert.equal(y26.rows.find(r => r.stock === "TCS").total, 11581); assert.equal(y26.rows.find(r => r.stock === "TCS").lastYear, 2364);
  assert.equal(y26.prevSamePeriod, 21354); assert.equal(y26.growth, 92.71);
  assert.ok(y26.missing.some(m => m.stock === "Nestle" && m.months.join() === "Feb,Jul"));
});

test("recording one dividend; names match loosely across spellings", () => {
  const e = sanitizeEntry({ stock: "  Tata Consultancy  ", month: "2026-10", amount: "1,020" }, "2026-11-08");
  assert.deepEqual([e.stock, e.month, e.amount], ["Tata Consultancy", "2026-10", 1020]);
  assert.throws(() => sanitizeEntry({ stock: "TCS", month: "2026-12", amount: 5 }, "2026-11-08"), /hasn't come/);
  assert.throws(() => sanitizeEntry({ stock: "TCS", month: "2026-10", amount: 0 }, "2026-11-08"), /amount/);
  assert.equal(stockKey("HDFC Bank Ltd"), stockKey("hdfc bank"));
  const v = ledgerView([{ id: "a", stock: "Angel one", month: "2026-01", amount: 100 }, { id: "b", stock: "Angel One", month: "2026-01", amount: 60 }], { year: 2026, today: "2026-11-08" });
  assert.equal(v.rows.length, 1); assert.equal(v.rows[0].months[0].amount, 160); assert.equal(v.rows[0].months[0].ids.length, 2);
});

import { autoCredits, holdingMatcher } from "../divledger.mjs";
test("dividends from your holdings: added in the credit month, into your row's name; not twice; hidden ones stay hidden", () => {
  const received = [
    { symbol: "TCS", exDate: "2026-10-17", amount: 11, qty: 100, income: 1100, approx: false }, // credited ~Nov 7
    { symbol: "INFY", exDate: "2026-10-28", amount: 22, qty: 50, income: 1100, approx: true }, // ~Nov 18: expected, shown in Nov
    { symbol: "IOC", exDate: "2026-11-01", amount: 3, qty: 500, income: 1500, approx: true },
    { symbol: "ITC", exDate: "2026-05-28", amount: 7.85, qty: 1000, income: 7850, approx: false } // before "from"
  ];
  const entries = [{ id: "m1", stock: "Infy", month: "2026-06", amount: 25 }, { id: "m2", stock: "TCS", month: "2026-11", amount: 1100 }]; // TCS already typed in
  const rowName = s => ({ INFY: "Infy" })[s] || s;
  const a = autoCredits({ received, entries, rowName, from: "2026-10-01", today: "2026-11-08", dismissed: ["auto:IOC:2026-11-01"] });
  assert.deepEqual(a.map(x => [x.stock, x.month, x.amount, x.expected]), [["Infy", "2026-11", 1100, true]]);
  assert.equal(autoCredits({ received, entries: [...entries, { id: "c", stock: "Infy", month: "2026-11", amount: 1080, fromAuto: "auto:INFY:2026-10-28" }], rowName, from: "2026-10-01", today: "2026-11-08", dismissed: ["auto:IOC:2026-11-01"] }).length, 0);
  // in the grid: marked as auto, counted in totals, shares from holdings
  const match = holdingMatcher([{ symbol: "INFY", name: "Infosys", qty: 50 }, { symbol: "TCS", name: "Tata Consultancy Services", qty: 100 }]);
  const v = ledgerView([...entries, ...a], { year: 2026, today: "2026-11-08", shares: n => match(n)?.qty ?? null });
  const infy = v.rows.find(r => r.stock === "Infy");
  assert.deepEqual([infy.months[10].amount, infy.months[10].auto, infy.months[10].ids.length, infy.shares], [1100, 1100, 0, 50]);
  assert.deepEqual([v.autoCount, v.autoTotal, v.entries], [1, 1100, 2]);
});
