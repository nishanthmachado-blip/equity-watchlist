import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeOppPlan, sanitizeDeployment, niftyState, oppView, oppTick } from "../oppfund.mjs";

const bars = (n, f) => Array.from({ length: n }, (_, i) => ({ c: f(i) }));
const rising = bars(260, i => 200 + i * 0.2); // high = last
const fallen = bars(260, i => (i < 230 ? 200 + i * 0.4 : 292 - (i - 229) * 1.6)); // high 291.6, then -16%
const picks = [{ symbol: "A", name: "Alpha", price: 100, zoneHigh: 110, action: "Buy in 3 parts" }, { symbol: "B", name: "Beta", price: 50, zoneHigh: 55, action: "Buy" }];
test("steps: nothing at a high; −16% reaches two steps; split across core fund and picks", () => {
  const plan = sanitizeOppPlan({ pot: "10L" === "10L" ? 1000000 : 0 });
  const calm = oppView({ plan, nifty: niftyState(rising), picks, today: "2026-11-07" });
  assert.equal(calm.nifty.off, 0); assert.equal(calm.due, 0); assert.ok(calm.tips.some(t => /Nothing to do/.test(t.text)));
  const N = niftyState(fallen); assert.ok(N.off >= 15 && N.off < 20, String(N.off));
  const v = oppView({ plan, nifty: N, picks, today: "2026-11-07" });
  assert.deepEqual(v.tiers.map(t => [t.off, t.reached, t.amount]), [[10, true, 330000], [15, true, 330000], [20, false, 340000]]);
  assert.equal(v.due, 660000); assert.equal(v.next.off, 20);
  assert.deepEqual(v.deploy.map(x => [x.where, x.amount]), [["Parag Parikh Flexi Cap", 330000], ["Alpha", 165000], ["Beta", 165000]]);
  const after = oppView({ plan, nifty: N, picks, today: "2026-11-07", state: { cycleStart: "2026-10-01", deployments: [{ id: "x", date: "2026-11-05", amount: 400000, where: "PPFAS" }, { id: "y", date: "2026-01-05", amount: 999999, where: "old cycle" }] } });
  assert.equal(after.deployed, 400000); assert.equal(after.due, 260000); assert.equal(after.left, 600000);
  assert.equal(niftyState(bars(10, () => 1)), null);
});
test("alerts once per step; a recovery resets the cycle; settings are checked", () => {
  const plan = sanitizeOppPlan({ pot: 1000000 }), v = oppView({ plan, nifty: niftyState(fallen), picks, today: "2026-11-07" });
  const t1 = oppTick({}, v, { today: "2026-11-07" });
  assert.equal(t1.fresh.length, 2); assert.match(t1.fresh[0].title, /step −10% reached/); assert.match(t1.fresh[0].detail, /₹3,30,000/);
  assert.equal(oppTick(t1.state, v, { today: "2026-11-08" }).fresh.length, 0, "no repeat");
  const back = oppView({ plan, nifty: niftyState(rising), picks, today: "2026-12-01" }), t2 = oppTick(t1.state, back, { today: "2026-12-01" });
  assert.equal(t2.reset, true); assert.deepEqual(t2.state.fired, {}); assert.equal(t2.state.cycleStart, "2026-12-01");
  assert.throws(() => sanitizeOppPlan({ tiers: [{ off: 10, share: 50 }, { off: 20, share: 30 }] }), /100%/);
  assert.deepEqual(sanitizeOppPlan({ tiers: [{ off: 20, share: 50 }, { off: 8, share: 50 }] }).tiers.map(t => t.off), [8, 20]);
  assert.throws(() => sanitizeDeployment({ amount: 0 }, "2026-11-07")); assert.throws(() => sanitizeDeployment({ amount: 5, date: "2026-12-01" }, "2026-11-07"));
});
