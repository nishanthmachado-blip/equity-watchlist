import test from "node:test";
import assert from "node:assert/strict";
import { METRICS, evaluateThesis, sanitizeThesis, trackBreaks } from "../thesis.mjs";

const ctx = (o = {}) => ({ row: { roce: 18, promoterChange3y: -2, pe: 30, ratio: 1.1, ...o.row }, f: { borrowings: 500, reserves: 1000, cfoToProfit3: 0.9, ...o.f }, s: { price: 80, high: 100, ...o.s } });
const th = conds => ({ conditions: conds.map(([metric, op, value], i) => ({ id: `c${i}`, metric, op, value })) });

test("a condition holds, breaks, or has no data", () => {
  const e = evaluateThesis(th([["roce", ">=", 15], ["promoterChange3y", ">=", -1], ["salesCagr3", ">=", 10]]), ctx());
  assert.deepEqual(e.conditions.map(c => c.state), ["ok", "broken", "nodata"]); assert.equal(e.status, "Broken"); assert.equal(e.broken, 1); assert.equal(e.nodata, 1);
});
test("status: Intact only with evidence, Unassessed with none", () => {
  assert.equal(evaluateThesis(th([["roce", ">=", 15], ["salesCagr3", ">=", 10]]), ctx()).status, "Intact");
  assert.equal(evaluateThesis(th([["salesCagr3", ">=", 10]]), ctx()).status, "Unassessed");
  assert.equal(evaluateThesis({ conditions: [] }, ctx()).status, "Unassessed");
});
test("derived metrics: borrowings/reserves, fall from 52w high, price vs fair", () => {
  assert.equal(METRICS.debtToReserves.get(ctx()), 0.5); assert.equal(METRICS.drawdown52.get(ctx()), 20); assert.equal(METRICS.priceToFair.get(ctx()), 1.1);
  assert.equal(METRICS.debtToReserves.get(ctx({ f: { reserves: 0 } })), null);
  assert.equal(evaluateThesis(th([["debtToReserves", "<=", 0.4]]), ctx()).status, "Broken");
});
test("boundary values are inclusive for >= and <=, exclusive for > and <", () => {
  assert.equal(evaluateThesis(th([["roce", ">=", 18]]), ctx()).status, "Intact"); assert.equal(evaluateThesis(th([["roce", ">", 18]]), ctx()).status, "Broken");
  assert.equal(evaluateThesis(th([["roce", "<=", 18]]), ctx()).status, "Intact"); assert.equal(evaluateThesis(th([["roce", "<", 18]]), ctx()).status, "Broken");
});
test("sanitize rejects bad metrics/operators/values and keeps ids of existing conditions", () => {
  assert.throws(() => sanitizeThesis({ reasons: "x", conditions: [{ metric: "nope", op: ">=", value: 1 }] }), /unknown metric/);
  assert.throws(() => sanitizeThesis({ reasons: "x", conditions: [{ metric: "roce", op: "=~", value: 1 }] }), /operator/);
  assert.throws(() => sanitizeThesis({ reasons: "x", conditions: [{ metric: "roce", op: ">=", value: "abc" }] }), /number/);
  assert.throws(() => sanitizeThesis({ reasons: "", conditions: [] }), /reason or add/);
  assert.throws(() => sanitizeThesis({ conditions: "x" }), /array/);
  const prev = { conditions: [{ id: "keep", metric: "roce", op: ">=", value: 15 }] };
  const s = sanitizeThesis({ reasons: " moat ", conditions: [{ id: "keep", metric: "roce", op: ">=", value: "16" }, { metric: "pe", op: "<=", value: 40 }] }, prev);
  assert.equal(s.reasons, "moat"); assert.equal(s.conditions[0].id, "keep"); assert.equal(s.conditions[0].value, 16); assert.notEqual(s.conditions[1].id, "keep");
});
test("trackBreaks records first-break date, clears it on recovery, and reports status flips once", () => {
  const t = th([["roce", ">=", 15]]); t.lastStatus = "Intact";
  let e = evaluateThesis(t, ctx({ row: { roce: 12 } }));
  let r = trackBreaks(t, e, "2026-10-08T00:00:00Z"); assert.equal(t.brokenSince.c0, "2026-10-08T00:00:00Z"); assert.deepEqual(r.flip, { from: "Intact", to: "Broken" });
  r = trackBreaks(t, evaluateThesis(t, ctx({ row: { roce: 11 } })), "2026-10-09T00:00:00Z"); assert.equal(t.brokenSince.c0, "2026-10-08T00:00:00Z"); assert.equal(r.flip, null); assert.equal(r.changed, false);
  r = trackBreaks(t, evaluateThesis(t, ctx()), "2026-10-10T00:00:00Z"); assert.equal(t.brokenSince.c0, undefined); assert.deepEqual(r.flip, { from: "Broken", to: "Intact" });
  const fresh = th([["roce", ">=", 15]]); assert.equal(trackBreaks(fresh, evaluateThesis(fresh, ctx()), "x").flip, null, "first evaluation is not a flip");
});
