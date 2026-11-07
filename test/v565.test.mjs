import test from "node:test";
import assert from "node:assert/strict";
import { normalizeKiteTrades, READ_ONLY_TOOLS } from "../kite-mcp.mjs";
import { mergeTrades, parseTradebook } from "../tax.mjs";
import { oppView } from "../oppfund.mjs";

test("Kite get_trades: equity fills only, with trade ids; get_trades is the only new read-only tool", () => {
  const t = normalizeKiteTrades([
    { trade_id: "T1", exchange: "NSE", tradingsymbol: "NETWEB", transaction_type: "BUY", quantity: 50, average_price: 4100.5, product: "CNC", fill_timestamp: "2026-11-06 10:02:11" },
    { trade_id: "T2", exchange: "NFO", tradingsymbol: "NIFTY26NOVFUT", transaction_type: "SELL", quantity: 75, average_price: 24000, fill_timestamp: "2026-11-06 10:05:00" },
    { trade_id: "T3", exchange: "NSE", tradingsymbol: "SBIN", transaction_type: "SELL", quantity: 10, average_price: 800, product: "MIS", exchange_timestamp: "2026-11-06 14:00:00" }]);
  assert.deepEqual(t.map(x => [x.symbol, x.side, x.qty, x.price, x.date, x.tradeId, x.product || ""]), [["NETWEB", "buy", 50, 4100.5, "2026-11-06", "T1", ""], ["SBIN", "sell", 10, 800, "2026-11-06", "T3", "MIS"]]);
  assert.ok(READ_ONLY_TOOLS.includes("get_trades") && !READ_ONLY_TOOLS.some(n => /place|modify|cancel|order/i.test(n)));
});

test("merging by trade id: daily capture and a later tradebook file don't double count; two equal fills both count", () => {
  const a = { account: "Z1", key: "INE1", symbol: "X", date: "2026-11-06", side: "buy", qty: 10, price: 100 };
  let saved = mergeTrades([], [{ ...a, tradeId: "1" }, { ...a, tradeId: "2" }]); // two identical fills
  assert.equal(saved.length, 2);
  saved = mergeTrades(saved, [{ ...a, tradeId: "1" }, { ...a, tradeId: "2" }, { ...a, tradeId: "3", qty: 5 }]); // the Console file later
  assert.equal(saved.length, 3);
  // an older import without ids, then the same fills with ids: matched, not added again
  let old = mergeTrades([], [a, a]);
  old = mergeTrades(old, [{ ...a, tradeId: "9" }, { ...a, tradeId: "10" }]);
  assert.equal(old.length, 2);
  const p = parseTradebook([["symbol", "isin", "trade_date", "trade_type", "quantity", "price", "trade_id"], ["NETWEB", "INE0NT901020", "2026-11-06", "buy", "50", "4100.5", "T1"]]);
  assert.equal(p.trades[0].tradeId, "T1");
});

test("opportunity fund: a ready list for the next step even before any fall", () => {
  const picks = [{ symbol: "A", name: "Alpha", price: 100, zoneHigh: 110, action: "Buy" }, { symbol: "B", name: "Beta", price: 50, zoneHigh: 55, action: "Buy" }];
  const v = oppView({ plan: { pot: 1000000 }, nifty: { price: 290, high: 300, off: 3.3, live: false }, picks, today: "2026-11-07" });
  assert.equal(v.due, 0); assert.equal(v.deploy.length, 0);
  assert.equal(v.ready.off, 10); assert.equal(v.ready.amount, 330000);
  assert.deepEqual(v.ready.list.map(x => [x.where, x.amount]), [["Parag Parikh Flexi Cap", 165000], ["Alpha", 82500], ["Beta", 82500]]);
  const noPot = oppView({ nifty: { price: 290, high: 300, off: 3.3 }, picks: [], today: "2026-11-07" });
  assert.equal(noPot.picksCount, 0); assert.equal(noPot.ready.list[0].sharePct, 100);
});
