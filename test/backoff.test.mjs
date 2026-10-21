import test from "node:test";
import assert from "node:assert/strict";
import { createBackoff, isNetRefusal } from "../backoff.mjs";
import { fetchScreenerPrice, screenerCooldown, resetScreener } from "../screener.mjs";
import { fetchChart, chartCooldown, chartBackoff } from "../technicals.mjs";

test("backoff: 10 → 20 → 40 → 60 min on blocks in a row; a success clears it; a manual retry keeps the streak", () => {
  const b = createBackoff(), t = 1e12, m = 60e3;
  assert.deepEqual([b.block("x", t) - t, b.block("x", t) - t, b.block("x", t) - t, b.block("x", t) - t, b.block("x", t) - t], [10 * m, 20 * m, 40 * m, 60 * m, 60 * m]);
  b.reset(); assert.equal(b.until(t), 0); assert.equal(b.block("x", t) - t, 60 * m, "retry after a manual reset: still long");
  b.ok(); assert.equal(b.until(t), 0); assert.equal(b.block("x", t) - t, 10 * m);
  assert.equal(b.block("x", t, 2 * m) - t, 2 * m, "the site's Retry-After wins");
  assert.equal(b.block("x", t, 90 * m) - t, 60 * m, "capped at an hour");
});
test("a refused connection pauses Screener instead of being retried for every stock", async () => {
  resetScreener();
  const refuse = async () => { throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED 3.7.241.105:443"), { code: "ECONNREFUSED" }) }); };
  assert.ok(isNetRefusal(await refuse().catch(e => e)));
  await assert.rejects(fetchScreenerPrice({ symbol: "TCS" }, refuse), /connection refused/);
  assert.ok(screenerCooldown() > Date.now() + 9 * 60e3);
  let called = 0; await assert.rejects(fetchScreenerPrice({ symbol: "INFY" }, async () => { called++; }), /pausing Screener/);
  assert.equal(called, 0, "no request while paused");
  resetScreener();
});
test("Yahoo chart 429 pauses Yahoo charts; no requests until the pause ends", async () => {
  chartBackoff.ok();
  let calls = 0; const f = async () => { calls++; return { status: 429, ok: false, headers: new Map() }; };
  await assert.rejects(fetchChart("TCS", { fetchImpl: f }), e => e.rateLimited);
  const n = calls; assert.ok(chartCooldown() > Date.now());
  await assert.rejects(fetchChart("INFY", { fetchImpl: f }), e => e.paused);
  assert.equal(calls, n, "paused: not asked again");
  chartBackoff.ok();
});
