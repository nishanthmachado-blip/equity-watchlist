import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshot, detectSetups, scoreIdea, sizeIdea, rankIdeas, positionHealth } from "../swingideas.mjs";
import { sanitizePosition, sanitizeWatch, evaluateSwing, diffSwingAlerts } from "../swing.mjs";

// Synthetic daily bars: f(i) → close; highs/lows ±1%, volume 1e6 (last bar's volume configurable)
const noise = i => 1 + 0.012 * Math.sin(i * 1.7) + 0.008 * Math.sin(i * 0.9 + 1); // day-to-day wiggle, like real prices
const make = (n, f, lastVol = 1e6) => Array.from({ length: n }, (_, i) => { const c = f(i) * noise(i); return { c, h: c * 1.01, l: c * 0.99, v: i === n - 1 ? lastVol : 1e6 }; });
const nifty = make(260, i => 100 * 1.0004 ** i);

test("pullback: uptrend that dips to its 20/50-day average", () => {
  // steady uptrend, then a 3-week pullback of ~7%
  const b = make(260, i => (i < 245 ? 100 * 1.0025 ** i : 100 * 1.0025 ** 245 * (1 - 0.003 * (i - 245))));
  const s = snapshot(b, nifty);
  assert.ok(s.sma50 > s.sma200 && s.price > s.sma200, "uptrend");
  const ideas = detectSetups(s); const pb = ideas.find(x => x.setup === "pullback");
  assert.ok(pb, `pullback found (RSI ${s.rsi}, price ${s.price}, ema20 ${s.ema20}, sma50 ${s.sma50})`);
  assert.ok(pb.stop < pb.entry && pb.t1 > pb.entry && pb.rr >= 1.5 && pb.riskPct <= 12);
});

test("breakout: close above the 55-day high on volume, and none without volume", () => {
  const f = i => (i < 200 ? 100 * 1.002 ** i : 100 * 1.002 ** 200) * (i === 259 ? 1.04 : 1);
  const s = snapshot(make(260, f, 2.4e6), nifty);
  const bo = detectSetups(s).find(x => x.setup === "breakout");
  assert.ok(bo, `breakout found (price ${s.price}, high55 ${s.high55}, vol× ${s.volRatio}, rsi ${s.rsi})`);
  assert.ok(bo.stop >= s.high55 * 0.97 - 0.01 && bo.rr >= 1.9);
  assert.ok(!detectSetups(snapshot(make(260, f, 1e6), nifty)).some(x => x.setup === "breakout"), "no volume, no breakout");
});

test("oversold bounce above the 200-day average; value turn needs the app's buy zone", () => {
  const b = make(260, i => (i < 245 ? 100 * 1.003 ** i : 100 * 1.003 ** 245 * (1 - 0.011 * (i - 245))));
  const s = snapshot(b, nifty); assert.ok(s.rsi <= 35, `rsi ${s.rsi}`);
  assert.ok(detectSetups(s).some(x => x.setup === "bounce"));
  // value: a flat stock that just crossed back above its 20-day EMA
  const v = make(260, i => (i < 252 ? 100 - 0.03 * i : 92.4 + (i - 252) * 0.5));
  const sv = snapshot(v, nifty);
  assert.ok(!detectSetups(sv).some(x => x.setup === "value"), "no verdict, no value idea");
  const vi = detectSetups(sv, { key: "buy", inZone: true, label: "Value buy", fairBase: 125, fairBull: 140 }).find(x => x.setup === "value");
  assert.ok(vi && vi.t1 <= sv.price * 1.25 + 0.01 && vi.rr >= 1.5);
});

test("score, size, ranking and position health", () => {
  const idea = { setup: "pullback", entry: 100, stop: 95, t1: 112, rr: 2.4 };
  const s = { sma50: 90, sma200: 80, rs3m: 8, volRatio: 1, turnoverCr: 50, atrPct: 2 };
  const a = scoreIdea(idea, s), b = scoreIdea(idea, { ...s, turnoverCr: 2 }), c = scoreIdea(idea, s, { key: "expensive" });
  assert.ok(a.score > b.score && a.score > c.score); assert.ok(b.notes.some(n => /Thinly/.test(n)));
  assert.deepEqual(sizeIdea(idea, { capital: 500000, riskPct: 1, perTrade: 200000 }), { qty: 1000, amount: 100000, riskAmount: 5000, cappedByRisk: true });
  assert.equal(sizeIdea(idea, { perTrade: 200000 }).qty, 2000);
  const up = snapshot(make(260, i => (i < 245 ? 100 * 1.0025 ** i : 100 * 1.0025 ** 245 * (1 - 0.003 * (i - 245)))), nifty);
  const r = rankIdeas([{ symbol: "AAA", name: "A", snap: up }, { symbol: "BBB", name: "B", snap: up }], { held: new Set(["BBB"]), watching: new Set(["AAA"]) });
  assert.deepEqual(r.map(x => [x.symbol, x.watching]), [["AAA", true]], "held stocks are skipped; one idea per stock");
  assert.equal(positionHealth({ price: 90, sma200: 100, sma50: 95, ema20: 92, atr: 2, low20: 85 }).state, "weak");
  assert.equal(positionHealth({ price: 120, sma200: 100, sma50: 110, ema20: 115, atr: 2, low20: 112 }, 100).trail, 116);
});

test("stop-loss on a swing position: alert once, carried from the swing watchlist", () => {
  const p = sanitizePosition({ symbol: "TCS", qty: 10, avgPrice: 3000, stopLoss: 2850 });
  const v = evaluateSwing({ positions: [p], prices: new Map([["TCS", { price: 2840 }]]) });
  assert.equal(v.positions[0].status, "stop-hit"); assert.equal(v.totals.stopHit, 1); assert.match(v.positions[0].note, /cap the loss/);
  const a = diffSwingAlerts({}, v); assert.equal(a.fresh[0].type, "swing-stop"); assert.equal(diffSwingAlerts(a.next, v, { events: a.fresh }).fresh.length, 0);
  assert.equal(evaluateSwing({ positions: [p], prices: new Map([["TCS", { price: 2900 }]]) }).positions[0].status, "near-stop");
  const w = sanitizeWatch({ symbol: "TCS", buyBelow: 3010, amount: "1L", stopLoss: 2900, idea: { setup: "pullback", label: "Pullback in an uptrend", t1: 3300, t2: 3500 } });
  assert.equal(w.stopLoss, 2900); assert.equal(w.idea.t1, 3300);
  assert.equal(sanitizePosition({ symbol: "TCS", qty: 10, avgPrice: 3000, notes: "x" }, p).stopLoss, 2850, "edits keep the stop");
});
