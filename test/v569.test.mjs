import test from "node:test";
import assert from "node:assert/strict";
import { swingBook, sanitizeManualTrade } from "../swingbook.mjs";

const S = (symbol, qty, buy, sell, buyDate, sellDate, term = "STCG", extra = {}) => ({ account: "Z1", accountLabel: "Zerodha", symbol, isin: `IN${symbol}`, qty, buy, sell, gain: (sell - buy) * qty, buyDate, sellDate, term, kind: "stock", charges: 10, src: "Zerodha", ...extra });

test("swing book: only short-term and intraday sales of stocks / ETFs; stats from the broker's numbers", () => {
  const sales = [S("INFY", 10, 1000, 1100, "2026-05-01", "2026-06-01"), S("INFY", 5, 1000, 1100, "2026-05-02", "2026-06-01"), // two lots of one sale
    S("TCS", 10, 3000, 2900, "2026-07-01", "2026-08-01"), S("SBIN", 100, 800, 802, "2026-08-05", "2026-08-05", "Intraday"),
    S("ITC", 100, 200, 400, "2020-01-01", "2026-06-01", "LTCG"), S("LIQUIDCASE", 100, 100, 101, "2026-06-01", "2026-07-01", "Other ST", { kind: "debt" }), S("NAVI", 10, 10, 12, "2026-01-01", "2026-04-15", "STCG", { kind: "mf" }),
    S("Varun Beverages", 100, 400, 420, null, "2026-11-07", "STCG", { account: "dhan", accountLabel: "Dhan", noDates: true })];
  const b = swingBook({ sales, lots: [], fy: "FY 2026-27", today: "2026-11-07" });
  assert.equal(b.closed.length, 4);
  const infy = b.closed.find(c => c.symbol === "INFY"); assert.deepEqual([infy.qty, infy.gain, infy.days, infy.charges], [15, 1500, 31, 20]);
  assert.deepEqual([b.stats.trades, b.stats.wins, b.stats.losses, b.stats.gain], [4, 3, 1, 1500 - 1000 + 200 + 2000]);
  assert.equal(b.stats.winRate, 75); assert.equal(b.stats.profitFactor, 3.7);
  assert.deepEqual(b.months.map(m => m.month), ["2026-06", "2026-08"]); // the dateless Dhan total isn't put in a month
  assert.equal(b.stats.tax.estimate, Math.round((1500 - 1000 + 2000) * 0.2 + 200 * 0.3));
  assert.ok(b.notes.some(n => /without sale dates/.test(n)));
});

test("open swing positions: lots bought in the last 12 months, at today's price", () => {
  const lots = [{ account: "Z1", key: "INE1", symbol: "NETWEB", date: "2026-10-20", qty: 100, price: 4000 }, { account: "Z1", key: "INE1", symbol: "NETWEB", date: "2026-10-25", qty: 0, price: 4100 }, { account: "Z1", key: "INE2", symbol: "ITC", date: "2020-01-01", qty: 50, price: 200 }];
  const b = swingBook({ lots, price: s => (s === "NETWEB" ? 3800 : null), labels: new Map([["Z1", "Zerodha"]]), fy: "FY 2026-27", today: "2026-11-07" });
  assert.equal(b.open.length, 1); assert.deepEqual([b.open[0].qty, b.open[0].pnl, b.open[0].days, b.open[0].longFrom], [100, -20000, 18, "2027-10-21"]);
});

test("trades added by hand are checked", () => {
  const t = sanitizeManualTrade({ date: "2026-11-06", side: "buy", symbol: "nse:netweb", qty: "100", price: "4,100.5", account: "Z1" }, "2026-11-07");
  assert.deepEqual([t.symbol, t.qty, t.price, t.src], ["NETWEB", 100, 4100.5, "manual"]); assert.ok(t.tradeId);
  assert.throws(() => sanitizeManualTrade({ date: "2026-12-01", side: "buy", symbol: "X", qty: 1, price: 1, account: "Z1" }, "2026-11-07"), /future/);
  assert.throws(() => sanitizeManualTrade({ date: "2026-11-01", side: "buy", symbol: "X", qty: 1, price: 1 }, "2026-11-07"), /account/);
});
