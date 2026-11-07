import test from "node:test";
import assert from "node:assert/strict";
import { findCup, snapshot, detectSetups, rankIdeas } from "../swingideas.mjs";

// 160 bars of a steady rise, a 60-bar rounded cup from 150 down 20% and back, a 10-bar handle, then today
function cupBars({ breakout = true } = {}) {
  const c = [];
  for (let i = 0; i < 160; i++) c.push(70 + i * 0.5); // 70 → 149.5
  for (let i = 0; i <= 60; i++) c.push(150 - 30 * Math.sin(Math.PI * i / 60)); // cup: 150 → 120 → 150
  for (let i = 1; i <= 10; i++) c.push(150 - 9 * Math.sin(Math.PI * i / 12)); // handle down to ~141 and back up
  c.push(breakout ? 153 : 147);
  return c.map((x, i) => ({ t: i, c: x, h: x * 1.005, l: x * 0.995, v: i === c.length - 1 ? 2_000_000 : i > 220 ? 600_000 : 1_000_000 }));
}

test("cup and handle: found with its depth, length, handle and buy point", () => {
  const cup = findCup(cupBars());
  assert.ok(cup, "cup expected");
  assert.ok(cup.depthPct >= 18 && cup.depthPct <= 22, `depth ${cup.depthPct}`);
  assert.ok(cup.cupWeeks >= 10 && cup.cupWeeks <= 14, `weeks ${cup.cupWeeks}`);
  assert.ok(cup.handleDepthPct > 3 && cup.handleDepthPct < 9, `handle ${cup.handleDepthPct}`);
  assert.ok(cup.pivot > 149 && cup.pivot < 152, `pivot ${cup.pivot}`);
  assert.equal(cup.quietHandle, true);
  // a V-shaped crash and rebound is not a cup
  const v = [];
  for (let i = 0; i < 160; i++) v.push(70 + i * 0.5);
  for (let i = 0; i <= 40; i++) v.push(i <= 20 ? 150 - i * 1.5 : 120 + (i - 20) * 1.5);
  for (let i = 1; i <= 10; i++) v.push(147);
  assert.equal(findCup(v.map((x, i) => ({ t: i, c: x, h: x, l: x, v: 1 }))), null);
});

test("cup setup: breakout gives a plan with a measured-move target; near the pivot gives a buy-above trigger", () => {
  const s = snapshot(cupBars());
  assert.equal(s.v, 3);
  const up = detectSetups(s).find(x => x.setup === "cup");
  assert.ok(up, "cup idea expected"); assert.equal(up.trigger, null);
  assert.ok(up.stop < up.entry && up.t1 > up.entry && up.rr >= 1.5);
  const near = detectSetups(snapshot(cupBars({ breakout: false }))).find(x => x.setup === "cup");
  assert.ok(near && near.trigger > near.entry, "a buy-above level expected");
  assert.match(near.why[0], /buy only on a close above/);
});

test("momentum above 200-DMA: steady leader near its 20-day average", () => {
  const c = []; for (let i = 0; i < 254; i++) c.push(100 * Math.pow(1.003, i) * (1 + 0.02 * Math.sin(i * 1.7)));
  const top = c.at(-1); c.push(top * 0.995, top * 0.99); // a two-day breather, still near the high
  const bars = c.map((x, i) => ({ t: i, c: x, h: x * 1.01, l: x * 0.99, v: 1e6 }));
  const nifty = c.map((x, i) => ({ c: 100 + i * 0.02 }));
  const s = snapshot(bars, nifty);
  const m = detectSetups(s).find(x => x.setup === "momentum");
  assert.ok(m, `momentum expected (rsi ${s.rsi}, ret3m ${s.ret3m}, rs ${s.rs3m}, ema20 ${s.ema20}, p ${s.price})`);
  assert.match(m.why[0], /above a rising 200-day average/);
  const ranked = rankIdeas([{ symbol: "LEAD", name: "Leader", snap: s }]);
  assert.ok(ranked[0].label);
});
