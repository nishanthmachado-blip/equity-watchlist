import test from "node:test";
import assert from "node:assert/strict";
import { editSoldBuy } from "../swing.mjs";

const now = new Date("2026-10-31T05:00:00Z");
const itbees = { id: "t1", symbol: "ITBEES", name: "ITBEES", qty: 2000, buyAvg: 2000, sellPrice: 31.94, pnl: -3936120, pnlPct: -98.4, openedAt: "2026-07-16T04:00:00.000Z", closedAt: "2026-07-21T09:00:00.000Z", lots: [{ qty: 2000, price: 2000, at: "2026-07-16T04:00:00.000Z" }] };
test("fixing a mistyped buy price of a sold trade recalculates its P/L and the cost", () => {
  const r = editSoldBuy([itbees], { symbol: "ITBEES", date: "2026-07-16", price: 2000, newPrice: "30.5", newDate: "2026-07-16" }, now);
  const t = r.trades[0];
  assert.equal(t.buyAvg, 30.5); assert.equal(t.lots[0].price, 30.5); assert.equal(t.pnl, Math.round((31.94 - 30.5) * 2000 * 100) / 100); assert.equal(t.pnlPct, Math.round((31.94 / 30.5 - 1) * 10000) / 100);
  assert.equal(r.costChange, (30.5 - 2000) * 2000); assert.deepEqual(r.ids, ["t1"]);
});
test("a buy split across two sales, other lots untouched, date moves, bad input refused", () => {
  const a = { id: "a", symbol: "X", name: "X", qty: 10, buyAvg: 150, sellPrice: 200, pnl: 500, closedAt: "2026-08-01T09:00:00Z", lots: [{ qty: 5, price: 100, at: "2026-07-01T04:00:00Z" }, { qty: 5, price: 200, at: "2026-07-05T04:00:00Z" }] };
  const b = { id: "b", symbol: "X", name: "X", qty: 3, buyAvg: 100, sellPrice: 120, pnl: 60, closedAt: "2026-08-10T09:00:00Z", openedAt: "2026-07-01T04:00:00Z" }; // no lots: one implied lot
  const r = editSoldBuy([a, b, { ...itbees }], { symbol: "X", date: "2026-07-01", price: 100, newPrice: 110, newDate: "2026-07-02" }, now);
  const [na, nb, other] = r.trades;
  assert.deepEqual(na.lots.map(l => [l.qty, l.price, l.at.slice(0, 10)]), [[5, 110, "2026-07-02"], [5, 200, "2026-07-05"]]);
  assert.equal(na.buyAvg, 155); assert.equal(na.pnl, 450); assert.equal(na.openedAt.slice(0, 10), "2026-07-02");
  assert.equal(nb.buyAvg, 110); assert.equal(nb.pnl, 30); assert.equal(other, r.trades[2]); assert.equal(other.buyAvg, 2000);
  assert.equal(r.costChange, 10 * 5 + 10 * 3); assert.equal(r.touched, 2);
  assert.throws(() => editSoldBuy([a], { symbol: "X", date: "2026-07-01", price: 100, newPrice: 0 }, now), /buy price/);
  assert.throws(() => editSoldBuy([a], { symbol: "X", date: "2026-07-01", price: 100, newPrice: 110, newDate: "2026-08-05" }, now), /after the sale/);
  assert.throws(() => editSoldBuy([a], { symbol: "X", date: "2026-06-01", price: 100, newPrice: 110 }, now), /no longer/);
});
