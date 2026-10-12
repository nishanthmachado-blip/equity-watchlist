import test from "node:test";
import assert from "node:assert/strict";
import { holdingStance, LIMITS } from "../stance.mjs";

const holding = { qty: 10, avgPrice: 100, invested: 1000, value: 1100, pnl: 100 };
const cheap = { view: "Undervalued", status: "In zone", ratio: 0.6, zoneLow: 90, zoneHigh: 105, upsideToBase: 0.3, fairValue: { base: 130 } };
const fair = { view: "Fair", status: "Above zone", ratio: 0.9, zoneLow: 80, zoneHigh: 95, upsideToBase: 0.05, fairValue: { base: 110 } };
const rich = { view: "Very rich", status: "Wait (far above)", ratio: 2.1, zoneLow: 50, zoneHigh: 60, upsideToBase: -0.4, fairValue: { base: 60 } };
const intact = { status: "Intact", conditions: [] }, broken = { status: "Broken", conditions: [{ state: "broken", label: "ROCE" }] };
const st = o => holdingStance({ holding, ...o });

test("cheap + intact thesis + buy action -> Accumulate with High confidence", () => {
  const r = st({ row: cheap, thesis: intact, stock: { action: "Buy gradually" }, weightPct: 5 });
  assert.equal(r.action, "Accumulate"); assert.equal(r.confidence, "High"); assert.ok(r.reasons.some(x => x.tone === "for"));
});
test("fair valuation holds; rich valuation says don't add", () => {
  assert.equal(st({ row: fair, thesis: intact, stock: { action: "Buy on dips" }, weightPct: 5 }).action, "Hold");
  assert.equal(st({ row: rich, thesis: intact, stock: { action: "Wait for correction" }, weightPct: 5 }).action, "Hold (don't add)");
});
test("a broken thesis turns Accumulate/Hold into Review", () => {
  assert.equal(st({ row: cheap, thesis: broken, stock: { action: "Buy gradually" }, weightPct: 5 }).action, "Review");
  assert.equal(st({ row: fair, thesis: broken, weightPct: 5 }).action, "Review");
});
test("concentration caps adding; Trim needs a big position AND a rich or broken name", () => {
  assert.equal(st({ row: cheap, thesis: intact, stock: { action: "Buy gradually" }, weightPct: LIMITS.noAddWeight }).action, "Hold (don't add)");
  assert.equal(st({ row: cheap, thesis: intact, weightPct: 30 }).action, "Hold (don't add)", "big but cheap and sound: no trim");
  assert.equal(st({ row: rich, thesis: intact, weightPct: 25 }).action, "Trim");
  assert.equal(st({ row: fair, thesis: broken, weightPct: 25 }).action, "Trim");
  assert.equal(st({ row: rich, thesis: intact, weightPct: 10 }).action, "Hold (don't add)", "rich but small: not a trim");
});
test("a stock you rated Avoid but hold is a Review, never Accumulate", () => {
  const r = st({ row: cheap, thesis: intact, stock: { action: "Avoid" }, weightPct: 3 });
  assert.equal(r.action, "Review"); assert.match(r.reasons.map(x => x.text).join(" "), /rated this Avoid/);
});
test("missing valuation gives No view with low confidence and a way forward; broken thesis still wins", () => {
  const a = st({}); assert.equal(a.action, "No view"); assert.equal(a.confidence, "Low"); assert.match(a.changes.join(" "), /Add it to the watchlist/);
  assert.match(st({ stock: { action: "Watch" } }).changes.join(" "), /Fetch fundamentals/);
  assert.equal(st({ thesis: broken }).action, "Review");
  assert.equal(st({ row: { view: "Unassessable" }, stock: {} }).action, "No view");
});
test("stale or thin data lowers confidence; no thesis caps it at Medium; losses get the cost-basis note", () => {
  assert.equal(st({ row: { ...cheap, stale: true }, thesis: intact }).confidence, "Low");
  assert.equal(st({ row: cheap }).confidence, "Medium");
  assert.match(holdingStance({ holding: { ...holding, pnl: -400 }, row: cheap }).reasons.map(r => r.text).join(" "), /Cost is not a reason/);
  assert.equal(holdingStance({ holding: { ...holding, pnl: -400 }, row: cheap }).pnlPct, -40);
});
