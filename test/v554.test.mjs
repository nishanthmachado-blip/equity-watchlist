import test from "node:test";
import assert from "node:assert/strict";
import { swingIncome } from "../swingincome.mjs";

const tr = (day, pnl, cost = 200000, held = 20) => ({ pnl, qty: 100, buyAvg: cost / 100, closedAt: `${day}T10:00:00Z`, openedAt: new Date(new Date(`${day}T10:00:00Z`).getTime() - held * 864e5).toISOString() });
test("swing income: months against the target, after tax", () => {
  const closed = [tr("2026-05-10", 80000), tr("2026-06-11", 140000), tr("2026-07-05", -30000), tr("2026-08-20", 60000), tr("2026-08-25", 70000), tr("2026-10-02", 50000)];
  const r = swingIncome(closed, { target: 100000, capital: 4000000, today: "2026-10-25" });
  assert.equal(r.preTax, Math.round(100000 / (1 - 0.208)));
  assert.deepEqual(r.series.map(s => s.month), ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  assert.equal(r.series.find(s => s.month === "2026-06").hit, true); assert.equal(r.series.find(s => s.month === "2026-05").hit, false);
  assert.equal(r.series.find(s => s.month === "2026-09").pnl, 0, "empty months shown");
  assert.equal(r.current.pnl, 50000); assert.equal(r.stats.hitMonths, 2); assert.equal(r.stats.lossMonths, 1); assert.equal(r.stats.closedMonths, 5);
  assert.equal(r.stats.trades, 6); assert.equal(r.stats.winRate, 83); assert.equal(r.stats.worstStreak, 1); assert.equal(r.stats.maxDip, 30000);
  assert.equal(r.stats.total, 370000); assert.equal(r.stats.perMonth, Math.round(370000 / 6));
  const yearly = 370000 / 6 * 12 / 4000000; assert.equal(r.capital.yearlyPct, Math.round(yearly * 1000) / 10);
  assert.equal(r.capital.needed, Math.round(100000 / (1 - 0.208) * 12 / yearly));
  assert.equal(r.enough, false, "6 trades is too few to plan on"); assert.match(r.verdict.text, /Too early/);
});
test("swing income: no trades, losing system, deployed capital when none is set", () => {
  assert.match(swingIncome([], { today: "2026-10-25" }).verdict.text, /No closed swing trades/);
  const losers = Array.from({ length: 24 }, (_, i) => tr(`2026-${String(1 + (i % 9)).padStart(2, "0")}-1${i % 9}`, i % 3 ? -5000 : 4000));
  const r = swingIncome(losers, { today: "2026-10-25" });
  assert.ok(r.stats.total < 0); assert.match(r.verdict.text, /Losing money/); assert.equal(r.capital.needed, null);
  assert.ok(r.capital.deployed > 0 && r.capital.yours === null);
  assert.ok(r.stats.worstStreak >= 2);
});
