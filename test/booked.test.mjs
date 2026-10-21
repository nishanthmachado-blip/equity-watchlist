import test from "node:test";
import assert from "node:assert/strict";
import { bookedSummary, sanitizeTaxPayment } from "../swing.mjs";

const tr = (id, sym, qty, buy, sell, boughtAt, closedAt) => ({ id, symbol: sym, name: sym, qty, buyAvg: buy, sellPrice: sell, pnl: qty * (sell - buy), lots: [{ qty, price: buy, at: boughtAt }], closedAt });
test("booked profit: by IST month and FY; tax with set-off, cess and payments", () => {
  const closed = [
    tr("a", "TCS", 10, 3000, 3300, "2026-05-01T04:00:00Z", "2026-06-10T05:00:00Z"),   // +3000 short term, Jun FY26-27
    tr("b", "INFY", 100, 1500, 1400, "2026-06-01T04:00:00Z", "2026-07-02T05:00:00Z"), // −10000 short term, Jul
    tr("c", "ITC", 1000, 400, 500, "2026-07-01T04:00:00Z", "2026-09-30T19:00:00Z"),   // +100000 short term; 30 Sep 19:00 UTC = 1 Oct IST
    tr("d", "HDFCBANK", 200, 600, 700, "2025-01-10T04:00:00Z", "2026-03-20T05:00:00Z") // +20000 long term, FY 2025-26
  ];
  const b = bookedSummary(closed, { taxPaid: [{ id: "p1", amount: 5000, date: "2026-09-15", fy: "FY 2026-27" }], today: "2026-10-21" });
  assert.deepEqual(b.months.map(m => [m.month, m.fy, m.trades, m.pnl]), [["2026-10", "FY 2026-27", 1, 100000], ["2026-07", "FY 2026-27", 1, -10000], ["2026-06", "FY 2026-27", 1, 3000], ["2026-03", "FY 2025-26", 1, 20000]]);
  const cur = b.years.find(y => y.fy === "FY 2026-27"), prev = b.years.find(y => y.fy === "FY 2025-26");
  // short term 3000 − 10000 + 100000 = 93000 × 20% = 18600, + 4% cess = 19344
  assert.deepEqual([cur.netSt, cur.tax, cur.paid, cur.due, cur.pnl, cur.trades, cur.current], [93000, 19344, 5000, 14344, 93000, 3, true]);
  assert.deepEqual([prev.netLt, prev.taxableLt, prev.tax], [20000, 0, 0], "long-term gain inside the ₹1.25 L exemption");
  // exemption already used elsewhere this FY applies to the current year only
  const lt = bookedSummary([tr("e", "LT", 1000, 100, 300, "2025-01-01T04:00:00Z", "2026-08-01T05:00:00Z")], { ltUsedElsewhere: 100000, today: "2026-10-21" }).years.find(y => y.current);
  assert.deepEqual([lt.netLt, lt.taxableLt, lt.tax], [200000, 175000, Math.round(175000 * 0.125 * 1.04)]);
  // an FY with only a payment still shows, as overpaid
  assert.equal(bookedSummary([], { taxPaid: [{ id: "x", amount: 100, date: "2026-04-10", fy: "FY 2026-27" }], today: "2026-10-21" }).years[0].over, 100);
});
test("tax payment: amount in L / ₹, FY from the date, no future dates", () => {
  const p = sanitizeTaxPayment({ amount: "1.2L", date: "2026-03-14", note: "Advance tax" }, "2026-10-21");
  assert.deepEqual([p.amount, p.fy, p.note], [120000, "FY 2025-26", "Advance tax"]);
  assert.equal(sanitizeTaxPayment({ amount: "12,500", date: "2026-10-01", fy: "FY 2026-27" }, "2026-10-21").amount, 12500);
  assert.throws(() => sanitizeTaxPayment({ amount: "0" }, "2026-10-21"), /amount/);
  assert.throws(() => sanitizeTaxPayment({ amount: "100", date: "2026-12-01" }, "2026-10-21"), /future/);
});
