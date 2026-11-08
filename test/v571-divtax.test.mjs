import test from "node:test";
import assert from "node:assert/strict";
import { fyDividends, divTdsThreshold } from "../divledger.mjs";
import { pnlView } from "../pnl.mjs";

const fy = { label: "FY 2026-27", from: "2026-04-01", to: "2027-03-31" };
const entries = [
  { id: "a", stock: "TCS", month: "2026-02", amount: 5000 },            // last financial year: not counted
  { id: "b", stock: "TCS", month: "2026-07", amount: 9000 },            // credited after TDS
  { id: "c", stock: "TCS", month: "2026-10", amount: 2700 },
  { id: "d", stock: "ITC", month: "2026-06", amount: 4000 },            // under the ₹10,000 limit: no TDS
  { id: "auto:IOC:2026-11-03", auto: true, stock: "IOC", month: "2026-11", amount: 1200 } // shares × DPS, already gross
];

test("financial-year dividends: April–March, grossed up for TDS above the limit, auto credits already gross", () => {
  assert.equal(divTdsThreshold(2024), 5000); assert.equal(divTdsThreshold(2026), 10000);
  const D = fyDividends(entries, { fy });
  const tcs = D.stocks.find(s => s.stock === "TCS"), itc = D.stocks.find(s => s.stock === "ITC"), ioc = D.stocks.find(s => s.stock === "IOC");
  assert.equal(tcs.credited, 11700); assert.equal(tcs.gross, 13000); assert.equal(tcs.tds, 1300);
  assert.equal(itc.gross, 4000); assert.equal(itc.tds, 0);
  assert.equal(ioc.estimated, 1200); assert.equal(ioc.gross, 1200);
  assert.equal(D.gross, 18200); assert.equal(D.tds, 1300); assert.equal(D.count, 4); assert.equal(D.autoCount, 1);
});

test("Tax view: ledger dividends replace the broker report's, taxed at the slab rate, TDS taken off what's left to pay", () => {
  const reports = [{ id: "r1", account: "AB1", broker: "Zerodha", fy: "FY 2026-27", from: "2026-04-01", to: "2026-09-30", rows: [], other: { dividends: 3000, interest: 0, fno: 0 } }];
  const v = pnlView({ trades: [], accounts: [{ id: "AB1", label: "Zerodha", broker: "zerodha" }], reports, slabRate: 0.3, fy: "FY 2026-27", divLedger: f => fyDividends(entries, { fy: f }), today: "2026-11-08" });
  const h = v.holders.find(x => x.name === "Me");
  assert.equal(h.other.dividends, 18200); assert.equal(h.other.divFrom, "ledger"); assert.equal(h.other.reportDividends, 3000);
  assert.equal(h.tax.dividendTax, 5460); assert.equal(h.tax.tdsPaid, 1300); assert.equal(h.tax.afterTds, h.tax.tax - 1300);
  assert.equal(v.dividends.gross, 18200); assert.equal(v.dividends.holder, "Me");
  // nothing in the ledger for the year: the report's dividends are used
  const v2 = pnlView({ trades: [], accounts: [{ id: "AB1", label: "Zerodha", broker: "zerodha" }], reports, slabRate: 0.3, fy: "FY 2026-27", divLedger: () => null, today: "2026-11-08" });
  assert.equal(v2.holders[0].other.dividends, 3000); assert.equal(v2.holders[0].other.divFrom, "reports"); assert.equal(v2.dividends, null);
});

test("dividends go to the person you pick; a ledger with no trades anywhere still shows a tax card", () => {
  const v = pnlView({ trades: [], accounts: [], slabRate: 0.3, fy: "FY 2026-27", divLedger: f => fyDividends(entries, { fy: f }), divHolder: "Priya", today: "2026-11-08" });
  assert.equal(v.holders.length, 1); assert.equal(v.holders[0].name, "Priya"); assert.equal(v.holders[0].tax.tax, 5460);
});
