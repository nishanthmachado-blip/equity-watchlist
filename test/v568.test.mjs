import test from "node:test";
import assert from "node:assert/strict";
import { reconcileSwing, applyBrokerFix, tradeFromBroker } from "../swingrecon.mjs";

const isin = { HDFCBANK: "INE040A01034", TCS: "INE467B01029", ITBEES: "INF109K012R6", SBIN: "INE062A01020", INFY: "INE009A01021" };
const J = (id, symbol, qty, buy, sell, buyDay, sellDay) => ({ id, symbol, name: symbol, qty, buyAvg: buy, sellPrice: sell, pnl: (sell - buy) * qty, openedAt: `${buyDay}T04:00:00.000Z`, closedAt: `${sellDay}T05:00:00.000Z`, lots: [{ qty, price: buy, at: `${buyDay}T04:00:00.000Z` }] });
const B = (symbol, qty, buy, sell, buyDate, sellDate, term = "STCG", extra = {}) => ({ account: "YJ1", accountLabel: "Zerodha", symbol, isin: isin[symbol], qty, buy, sell, gain: (sell - buy) * qty, buyDate, sellDate, term, kind: "stock", src: "Zerodha", ...extra });

test("journal vs broker: same, a typo in the buy price, a sale missing from the journal, one only in the journal", () => {
  const closed = [J("a", "HDFCBANK", 100, 1500, 1800, "2026-05-02", "2026-08-10"), J("b", "ITBEES", 2000, 2000, 31.94, "2026-06-01", "2026-07-01"), J("c", "SBIN", 10, 800, 850, "2026-06-01", "2026-09-01")];
  const brokerRows = [B("HDFCBANK", 100, 1500, 1800, "2026-05-02", "2026-08-11"), B("ITBEES", 2000, 30.175, 31.94, "2026-06-01", "2026-07-01"),
    B("TCS", 5, 3000, 3100, "2026-09-01", "2026-10-01"), B("INFY", 10, 1000, 1500, "2023-01-01", "2026-06-01", "LTCG")];
  const r = reconcileSwing({ closed, brokerRows, fy: "FY 2026-27", isinOf: s => isin[s], symbolOf: i => Object.keys(isin).find(k => isin[k] === i) });
  assert.equal(r.counts.matched, 2);
  const hd = r.matched.find(m => m.journal.symbol === "HDFCBANK"); assert.deepEqual(hd.diffs.map(x => x.field), ["date"]); // a day apart: still the same sale
  const it = r.matched.find(m => m.journal.symbol === "ITBEES"); assert.ok(it.fixable); assert.deepEqual(it.diffs.map(x => x.field), ["buy"]); assert.equal(it.diffs[0].broker, 30.18);
  assert.deepEqual(r.brokerOnly.map(b => b.symbol), ["TCS"]); assert.equal(r.investments, 1); // the long-term INFY sale is an investment, not swing
  assert.deepEqual(r.journalOnly.map(j => j.symbol), ["SBIN"]);
  // fixing: the journal takes the broker's prices; cash moves by the P&L change
  const f = applyBrokerFix(closed, it.journal.ids, { buyAvg: it.broker.buyAvg, sellAvg: it.broker.sellAvg, day: it.broker.day });
  const t = f.closed.find(x => x.id === "b"); assert.equal(t.buyAvg, 30.18); assert.equal(t.pnl, Math.round((31.94 - 30.18) * 2000 * 100) / 100);
  assert.equal(f.cashChange, Math.round((2000 - 30.18) * 2000 * 100) / 100);
  const nt = tradeFromBroker(r.brokerOnly[0], { symbol: "TCS", name: "TCS", id: "n1" }); assert.deepEqual([nt.qty, nt.buyAvg, nt.sellPrice, nt.pnl], [5, 3000, 3100, 500]);
  // hidden sales stay out
  assert.equal(reconcileSwing({ closed, brokerRows, fy: "FY 2026-27", isinOf: s => isin[s], ignore: [r.brokerOnly[0].k] }).brokerOnly.length, 0);
});

test("a report without dates (Dhan): the year's journal sales of a stock against the broker's total", () => {
  const closed = [J("a", "INFY", 100, 1000, 1100, "2026-05-01", "2026-06-01"), J("b", "INFY", 200, 1020, 1160, "2026-07-01", "2026-08-01")];
  const brokerRows = [{ account: "dhan", accountLabel: "Dhan", symbol: "Infosys", isin: isin.INFY, qty: 300, buy: 1013.33, sell: 1140, gain: 38000, sellDate: "2026-11-07", term: "STCG", kind: "stock", noDates: true }];
  const r = reconcileSwing({ closed, brokerRows, fy: "FY 2026-27", isinOf: s => isin[s], symbolOf: i => Object.keys(isin).find(k => isin[k] === i) });
  assert.equal(r.counts.matched, 1); assert.equal(r.matched[0].journal.qty, 300); assert.equal(r.matched[0].status, "same");
  assert.equal(r.totals.journal, 38000); assert.equal(r.totals.swingAtBroker, 38000);
});

test("a sale of old and new shares on one day: only the short-term part is swing; liquid ETFs are not swing", () => {
  const closed = [J("c", "CUB", 76, 164.59, 218.01, "2025-11-13", "2026-07-06")];
  const brokerRows = [B("CUB", 76, 164.59, 218.01, "2025-11-13", "2026-07-06"), B("CUB", 28, 138.09, 218.0, "2024-05-01", "2026-07-06", "LTCG"),
    { ...B("LIQUIDCASE", 435, 114.34, 114.87, "2026-06-01", "2026-07-07", "Other ST"), kind: "debt" }];
  isin.CUB = "INE491A01021"; isin.LIQUIDCASE = "INF0R8F01034";
  const r = reconcileSwing({ closed, brokerRows, fy: "FY 2026-27", isinOf: s => isin[s], symbolOf: i => Object.keys(isin).find(k => isin[k] === i) });
  assert.equal(r.matched[0].status, "same"); assert.equal(r.brokerOnly.length, 0); assert.equal(r.investments, 2);
});
