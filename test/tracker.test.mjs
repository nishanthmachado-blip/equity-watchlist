import test from "node:test";
import assert from "node:assert/strict";
import { addSnapshots, performance, compare } from "../tracker.mjs";

const row = (symbol, view, price) => ({ symbol, view, status: "In zone", price, fairValue: { base: price * 1.2 } });
test("one snapshot per symbol per day; skips unassessed rows", () => {
  const log = {};
  assert.equal(addSnapshots(log, [row("A", "Fair", 100), { symbol: "B", view: "No fundamentals", price: 5 }], "2026-10-01"), 1);
  assert.equal(addSnapshots(log, [row("A", "Fair", 101)], "2026-10-01"), 0);
  assert.equal(addSnapshots(log, [row("A", "Fair", 110)], "2026-10-02"), 1);
});
test("performance groups returns by first verdict and respects minDays", () => {
  const log = { A: [{ d: "2026-01-01", view: "Undervalued", status: "In zone", price: 100 }, { d: "2026-03-01", view: "Fair", status: "Above zone", price: 120 }], B: [{ d: "2026-01-01", view: "Rich", status: "Wait (far above)", price: 100 }, { d: "2026-03-01", view: "Rich", status: "Wait (far above)", price: 90 }], C: [{ d: "2026-02-28", view: "Fair", status: "In zone", price: 1 }, { d: "2026-03-01", view: "Fair", status: "In zone", price: 2 }] };
  const p = performance(log, 14);
  assert.equal(p.byView.find(e => e.key === "Undervalued").avgReturnPct, 20);
  assert.equal(p.byView.find(e => e.key === "Rich").avgReturnPct, -10);
  assert.equal(p.byView.find(e => e.key === "Fair"), undefined); // C too short
  assert.match(performance({}, 14).note, /No history yet/);
});
test("compare flags large differences only", () => {
  const c = compare({ A: { pe: 40, roce: 30, promoter: 50 } }, { A: { pe: 20, roce: 28, promoter: 50 }, Z: { pe: 1 } });
  assert.equal(c.rows.length, 1);
  const f = Object.fromEntries(c.rows[0].fields.map(x => [x.field, x]));
  assert.equal(f.pe.flag, true); assert.equal(f.pe.diff, 100); assert.equal(f.roce.flag, false); assert.equal(f.pb.diff, null);
});
