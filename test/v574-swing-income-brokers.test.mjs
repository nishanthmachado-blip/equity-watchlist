import test from "node:test";
import assert from "node:assert/strict";
import { swingIncome } from "../swingincome.mjs";

test("Swing income from broker sales: each sale lands in its own month, across two financial years", () => {
  const sale = (sym, buy, sell, pnl) => ({ symbol: sym, qty: 10, buyAvg: 100, pnl, openedAt: `${buy}T06:00:00Z`, closedAt: `${sell}T06:00:00Z`, day: sell });
  const rows = [sale("BEL", "2026-03-02", "2026-03-31", 8400), sale("HAL", "2026-04-01", "2026-04-01", 3200), sale("IRFC", "2026-10-06", "2026-10-28", 13000), sale("SUZLON", "2026-10-09", "2026-10-30", 10000)];
  const d = swingIncome(rows, { target: 100000, today: "2026-11-08" });
  const by = Object.fromEntries(d.series.map(s => [s.month, s]));
  assert.equal(by["2026-03"].pnl, 8400); assert.equal(by["2026-04"].pnl, 3200); // 31 Mar stays in March (no time-zone slip)
  assert.equal(by["2026-10"].trades, 2); assert.equal(by["2026-10"].pnl, 23000);
  assert.equal(d.stats.trades, 4); assert.equal(d.current.month, "2026-11");
});
