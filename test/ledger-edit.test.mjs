import test from "node:test";
import assert from "node:assert/strict";
import { editHeldBuy, editSale, buildLedger, sanitizePosition, applyBuy } from "../swing.mjs";

const pos = { id: "p1", symbol: "BBOX", name: "Black Box", exchange: "NSE", qty: 230, avgPrice: 897.08, lots: [{ qty: 22, price: 898.8, at: "2026-10-21T03:45:00.000Z" }, { qty: 200, price: 896.96, at: "2026-10-21T03:45:00.000Z" }, { qty: 8, price: 893.45, at: "2026-10-21T03:45:00.000Z" }], openedAt: "2026-10-21T03:45:00.000Z" };
const now = new Date("2026-10-21T08:00:00Z");
test("ledger: edit a held buy → position quantity, average and cost change follow", () => {
  const r = editHeldBuy(pos, { date: "2026-10-21", price: 896.96, newQty: 150, newPrice: 896.96 }, now);
  assert.equal(r.position.qty, 180);
  assert.equal(r.position.avgPrice, Math.round((22 * 898.8 + 150 * 896.96 + 8 * 893.45) / 180 * 100) / 100);
  assert.equal(r.costChange, -50 * 896.96);
  const d = editHeldBuy(pos, { date: "2026-10-21", price: 893.45, newDate: "2026-10-20", newQty: 8, newPrice: 890 }, now);
  assert.ok(d.position.lots.some(l => l.price === 890 && l.at.startsWith("2026-10-20")));
  assert.equal(d.costChange, Math.round(8 * (890 - 893.45) * 100) / 100);
  const led = buildLedger([d.position], []);
  assert.ok(led.entries.every(e => e.posId === "p1"));
});
test("ledger: delete a buy; deleting the last one leaves no position; bad input refused", () => {
  const r = editHeldBuy(pos, { date: "2026-10-21", price: 898.8, remove: true }, now);
  assert.equal(r.position.qty, 208); assert.equal(r.costChange, -22 * 898.8);
  const one = { id: "p2", symbol: "VBL", name: "VBL", qty: 24, avgPrice: 414, openedAt: "2026-10-21T04:00:00Z" };
  assert.equal(editHeldBuy(one, { date: "2026-10-21", price: 414, remove: true }, now).position, null);
  assert.throws(() => editHeldBuy(pos, { date: "2026-10-21", price: 896.96, newQty: 1.5, newPrice: 900 }, now), /whole number/);
  assert.throws(() => editHeldBuy(pos, { date: "2026-10-19", price: 896.96, newQty: 5, newPrice: 900 }, now), /no longer in the position/);
  assert.throws(() => editHeldBuy(pos, { date: "2026-10-21", price: 896.96, newQty: 5, newPrice: 900, newDate: "2026-12-01" }, now), /future/);
});
test("ledger: edit a sale's price and date → P/L and cash change", () => {
  const t = { id: "t1", symbol: "INFY", name: "Infosys", qty: 300, buyAvg: 1029.01, sellPrice: 1145.78, pnl: 35031, pnlPct: 11.35, closedAt: "2026-10-12T05:00:00Z" };
  const r = editSale(t, { newPrice: 1150, newDate: "2026-10-13" }, now);
  assert.deepEqual([r.trade.sellPrice, r.trade.pnl, r.trade.pnlPct, r.trade.closedAt.slice(0, 10), r.cashChange], [1150, 36297, 11.76, "2026-10-13", 1266]);
});
