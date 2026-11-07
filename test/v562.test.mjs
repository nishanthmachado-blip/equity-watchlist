import { test } from "node:test";
import assert from "node:assert/strict";
import { moveOf, playbook } from "../nowcall.mjs";

test("moveOf: 1, 2 and 5-day changes", () => {
  const m = moveOf([100, 100, 100, 100, 100, 102, 104]);
  assert.equal(m.d1, 2); assert.equal(m.d2, 4); assert.equal(m.d5, 4);
  assert.equal(moveOf([1, 2]), null);
});

const rows = [
  { symbol: "A", name: "A", lane: "buy", price: 100, awayPct: 0, quality: 80, move: { d5: 1 } },
  { symbol: "B", name: "B", lane: "wait", price: 200, awayPct: 12, zoneHigh: 180, move: { d5: 8 } },
  { symbol: "C", name: "C", lane: "hold", price: 300, awayPct: 40, value: 30, held: { pnlPct: 45 }, move: { d5: 3 } },
  { symbol: "D", name: "D", lane: "swing", price: 50, swing: { score: 70, setup: "breakout", label: "Breakout", entry: 50, stop: 46, t1: 58 }, move: { d5: 6 } }
];

test("playbook: a rally sorts stocks into the four groups", () => {
  const p = playbook(rows, { move: { d1: 1.2, d2: 2.6, d5: 3 } });
  assert.equal(p.kind, "rally");
  assert.deepEqual(p.laggards.map(r => r.symbol), ["A"]);
  assert.deepEqual(p.chase.map(r => r.symbol), ["B"]);
  assert.deepEqual(p.book.map(r => r.symbol), ["C"]);
  assert.deepEqual(p.breakouts.map(r => r.symbol), ["D"]);
  assert.ok(p.money.length >= 3);
});

test("playbook: fall and normal", () => {
  assert.equal(playbook(rows, { move: { d1: -1, d2: -1, d5: -4 } }).kind, "fall");
  assert.equal(playbook(rows, { move: { d1: 0.3, d2: 0.5, d5: 1 } }).kind, "normal");
  assert.equal(playbook(rows, null).kind, "normal");
});
