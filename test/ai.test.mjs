import test from "node:test";
import assert from "node:assert/strict";
import { sealKey, openKey, looksLikeKey, buildContext, sseParser, messageCollector, friendlyApiError } from "../ai.mjs";

test("API key: sealed at rest, opens only with the same secret", () => {
  const k = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123";
  const s = sealKey(k, "server-secret");
  assert.ok(!JSON.stringify(s).includes("abcdefghij")); assert.equal(s.hint, "…0123");
  assert.equal(openKey(s, "server-secret"), k);
  assert.equal(openKey(s, "other-secret"), null);
  assert.equal(openKey({}, "server-secret"), null);
  assert.ok(looksLikeKey(k)); assert.ok(!looksLikeKey("hello"));
});

const snap = {
  today: "2026-10-17",
  networth: { assets: 1e7, liabilities: 0, mix: [{ label: "Equity", pct: 60 }] },
  holdings: [{ symbol: "TCS", qty: 10, avgPrice: 3000, price: 3100, invested: 30000, value: 31000, pnlPct: 3.3, view: "Fair", fair: 3300, zone: "2800-3000", pe: 25, sectorPe: 28, stance: "Hold: client AB1234 PAN ABCDE1234F mail me@x.com" }],
  swing: { positions: [{ symbol: "INFY", qty: 250, avgPrice: 1030, price: 1161, pnlPct: 12.6, pnl: 32500, targets: [{ n: 1, price: 1134, hit: true }], status: "take-profit", note: "T1 hit", events: { headline: "Dividend", items: [{ text: "Interim dividend ₹23 ex-date 27 Oct" }] }, ifSold: { net: 26000 } }],
    watch: [{ symbol: "HCLTECH", list: "dip", price: 1190, buyBelow: 1200, distance: -0.8, status: "deploy", amount: 1e5 }], totals: { cash: 376000 } },
  us: { fx: 88, rows: [{ symbol: "AAPL", qty: 10, avgUsd: 150, price: 230, pnlPct: 53, valueInr: 202400 }] },
  mf: [{ name: "Axis ELSS", invested: 100000, value: 125000 }],
  events: [{ date: "2026-10-20", symbol: "HEROMOTOCO", label: "Results" }]
};
test("context: what Claude sees, with PAN / email / account ids masked", () => {
  const t = buildContext(snap);
  for (const s of ["INFY | 250 | 1030 | 1161", "HCLTECH | 1190 | 1200 | -0.8% (REACHED)", "Interim dividend ₹23", "AAPL | 10 | 150 | 230", "Axis ELSS", "2026-10-20 HEROMOTOCO", "swing cash ₹3.76L"]) assert.ok(t.includes(s), s);
  assert.ok(!t.includes("ABCDE1234F") && !t.includes("me@x.com"));
  assert.ok(t.includes("[PAN]") && t.includes("[email]"));
});
test("context: percent mode hides quantities and rupee amounts", () => {
  const t = buildContext(snap, { privacy: "percent" });
  assert.ok(!/\| 250 \|/.test(t)); assert.ok(!t.includes("₹3.76L")); assert.ok(!t.includes("₹31,000"));
  assert.ok(t.includes("TCS | 3100 | 0.3%")); assert.ok(t.includes("INFY | 1030 | 1161 | 12.6%"));
});
test("streaming: text deltas and a tool call are collected", () => {
  const got = []; const col = messageCollector(t => got.push(t)); const feed = sseParser(col.on);
  const ev = e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
  const stream = [ev({ type: "message_start", message: { usage: { input_tokens: 100, cache_read_input_tokens: 50 } } }), ev({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }), ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me " } }), ev({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "check." } }), ev({ type: "content_block_stop", index: 0 }),
    ev({ type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "t1", name: "stock_detail", input: {} } }), ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"sym' } }), ev({ type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: 'bol":"TCS"}' } }), ev({ type: "content_block_stop", index: 1 }), ev({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 30 } })].join("");
  for (let i = 0; i < stream.length; i += 37) feed(stream.slice(i, i + 37)); // arrives in odd-sized chunks
  const r = col.result();
  assert.equal(got.join(""), "Let me check."); assert.equal(r.stop_reason, "tool_use");
  assert.deepEqual(r.content[1], { type: "tool_use", id: "t1", name: "stock_detail", input: { symbol: "TCS" } });
  assert.deepEqual([r.usage.input, r.usage.cacheRead, r.usage.output], [100, 50, 30]);
  assert.match(friendlyApiError(401, {}), /rejected the API key/);
});
