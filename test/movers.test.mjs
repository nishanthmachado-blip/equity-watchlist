import test from "node:test";
import assert from "node:assert/strict";
import { addMarketDay, movers, indexChanges } from "../movers.mjs";

test("market days: kept in order, oldest dropped", () => {
  let s = { days: [], closes: {} };
  for (let i = 1; i <= 30; i++) s = addMarketDay(s, `2026-09-${String(i).padStart(2, "0")}`, [{ symbol: "AAA", close: 100 + i, volume: 1e6 }], 26);
  assert.equal(s.days.length, 26); assert.equal(s.days[0], "2026-09-05"); assert.equal(Object.keys(s.closes).length, 26);
});
test("top gainers and losers over a week, liquid stocks or a chosen universe", () => {
  let s = { days: [], closes: {} };
  const px = { UP: [100, 101, 102, 103, 104, 123], DOWN: [100, 99, 98, 97, 96, 85], FLAT: [50, 50, 50, 50, 50, 50], TINY: [5, 5, 5, 5, 5, 9], ILLIQ: [100, 100, 100, 100, 100, 150] };
  for (let d = 0; d < 6; d++) s = addMarketDay(s, `2026-10-0${d + 1}`, Object.entries(px).map(([k, v]) => ({ symbol: k, close: v[d], volume: k === "ILLIQ" ? 10 : 1e7 })));
  const w = movers(s, { period: "week", names: new Map([["UP", "Up Ltd"]]) });
  assert.equal(w.from, "2026-10-01"); assert.equal(w.asOf, "2026-10-06");
  assert.deepEqual(w.gainers.map(r => [r.symbol, r.change]), [["UP", 23], ["FLAT", 0], ["DOWN", -15]]); // TINY (price < 10) and ILLIQ (< ₹5 Cr traded) left out
  assert.equal(w.gainers[0].name, "Up Ltd"); assert.equal(w.losers[0].symbol, "DOWN"); assert.deepEqual(w.breadth, { up: 1, down: 1 });
  const d = movers(s, { period: "day", universe: new Set(["UP", "ILLIQ"]) });
  assert.deepEqual(d.gainers.map(r => r.symbol), ["ILLIQ", "UP"]); // a chosen universe ignores the liquidity filter
  assert.equal(movers(s, { period: "month" }).partial, true);
  assert.equal(movers({ days: ["2026-10-01"], closes: {} }).ready, false);
});
test("index changes from daily closes, with or without a live level", () => {
  const bars = Array.from({ length: 30 }, (_, i) => ({ t: 1790000000 + i * 86400, c: 100 + i }));
  const a = indexChanges(bars);
  assert.deepEqual([a.last, a.day, a.week], [129, 0.78, 4.03]);
  const b = indexChanges(bars, { last: 135, pChange: 4.65 });
  assert.deepEqual([b.last, b.day, b.week], [135, 4.65, 8]);
});
