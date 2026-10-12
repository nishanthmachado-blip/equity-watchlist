import test from "node:test";
import assert from "node:assert/strict";
import { positionRow, gate, stress, exposure, sanitizeBuy, LADDERS } from "../plan.mjs";

const okV = { view: "Fair", flags: "", status: "Above zone", zoneHigh: 90 };
const buys = [{ date: "2026-01-01", price: 100, amount: 20000 }];

test("ladders match the plan", () => {
  assert.deepEqual(LADDERS.standard, [0.15, 0.25, 0.35, 0.45]); assert.deepEqual(LADDERS.smaller, [0.25, 0.4]);
});
test("no buys: START only when price is inside the valuation zone", () => {
  assert.match(positionRow("A", { ladder: "standard", buys: [] }, 100, { ...okV, status: "In zone" }).action, /^START/);
  assert.equal(positionRow("A", { ladder: "standard", buys: [] }, 100, okV).action, "Wait for zone");
});
test("triggers are measured from the FIRST buy price", () => {
  const r = positionRow("A", { ladder: "standard", buys }, 100, okV);
  assert.deepEqual(r.levels.map(l => l.trigger), [85, 75, 65, 55]);
  assert.equal(r.next.trigger, 85); assert.equal(r.action, "Wait"); assert.equal(r.maxAmount, 100000);
});
test("ADD when the trigger is hit and the gate is OK; HOLD when valuation is rich", () => {
  assert.match(positionRow("A", { ladder: "standard", buys }, 84, okV).action, /^ADD/);
  const hold = positionRow("A", { ladder: "standard", buys }, 84, { ...okV, view: "Rich" });
  assert.match(hold.action, /HOLD/);
});
test("gate blocks on data-check flags and flags unchecked stocks", () => {
  assert.equal(gate({ view: "Fair", flags: "CHECK: price mismatch" }).ok, false);
  assert.equal(gate(undefined).ok, null);
  assert.equal(gate({ view: "No fundamentals" }).ok, null);
});
test("tranche progress advances with each recorded buy; ladder completes", () => {
  const four = [...buys, { date: "d", price: 85, amount: 20000 }];
  assert.equal(positionRow("A", { ladder: "standard", buys: four }, 90, okV).next.trigger, 75);
  const all = [...buys, ...[85, 75, 65, 55].map(p => ({ date: "d", price: p, amount: 20000 }))];
  assert.equal(positionRow("A", { ladder: "standard", buys: all }, 90, okV).action, "Ladder complete");
});
test("average cost and P/L", () => {
  const r = positionRow("A", { ladder: "standard", buys: [...buys, { date: "d", price: 50, amount: 20000 }] }, 80, okV);
  assert.equal(r.invested, 40000); assert.equal(r.avgPrice, 66.67); assert.ok(r.pnlPct > 0);
});
test("stress sums pending tranches that would trigger", () => {
  const rows = [positionRow("A", { ladder: "standard", buys }, 100, okV), positionRow("B", { ladder: "smaller", buys }, 100, okV)];
  const s = stress(rows, [10, 20, 40]);
  assert.deepEqual(s.map(x => x.cash), [0, 20000, 100000]); // A:85,75,65,55  B:75,60 vs first buy 100
});
test("exposure flags a sector above 25% of the plan", () => {
  const rows = ["A", "B", "C", "D"].map(s => positionRow(s, { ladder: "standard", buys }, 100, okV));
  const ex = exposure(rows, s => (s === "D" ? "Tech" : "Jewellery"));
  assert.equal(ex[0].sector, "Jewellery"); assert.equal(ex[0].concentrated, true); assert.equal(ex[0].shareOfPlanned, 75);
});
test("sanitizeBuy validates input", () => {
  assert.throws(() => sanitizeBuy({ price: -1, amount: 100 })); assert.throws(() => sanitizeBuy({ price: 10, amount: 0 })); assert.throws(() => sanitizeBuy({ price: 10, amount: 5, date: "01/02/2026" }));
  assert.equal(sanitizeBuy({ price: "10.123", amount: "20000.4", date: "2026-02-03" }).price, 10.12);
});
