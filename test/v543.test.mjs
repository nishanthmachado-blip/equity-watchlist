import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseMfapi, seriesStats, benchFor, reviewFunds, diffFundAlerts, portfolioChurn, fundIdeas, isIndexFund } from "../mfreview.mjs";
import { openAiCollector, chatModelIds, pickModel, toOpenAiTools, TOOLS, sseParser } from "../ai.mjs";

// a NAV series: `yrs` years of daily points growing at `cagr`%/yr, the last `fallDays` days falling `fallPct`% in all
function navs({ yrs = 6, cagr = 12, fallPct = 0, fallDays = 40, end = "2026-10-23" } = {}) {
  const out = [], n = Math.round(yrs * 365), e = Date.parse(`${end}T00:00:00Z`);
  for (let i = n; i >= 0; i--) { const d = new Date(e - i * 864e5).toISOString().slice(0, 10); let v = 100 * Math.pow(1 + cagr / 100, (n - i) / 365); if (i < fallDays) v *= 1 - fallPct / 100 * (fallDays - i) / fallDays; out.push({ d, v }); }
  return out;
}
test("fund NAV history: mfapi parse, returns, 52-week high; category → index", () => {
  const p = parseMfapi({ meta: { scheme_name: "X Flexi Cap", scheme_category: "Equity Scheme - Flexi Cap Fund", fund_house: "X MF" }, data: [{ date: "02-01-2026", nav: "11.5" }, { date: "01-01-2026", nav: "11" }, { date: "bad", nav: "x" }] });
  assert.deepEqual(p.navs, [{ d: "2026-01-01", v: 11 }, { d: "2026-01-02", v: 11.5 }]); assert.equal(p.category, "Equity Scheme - Flexi Cap Fund");
  const s = seriesStats(navs({ cagr: 12 }));
  assert.ok(Math.abs(s.ret1y - 12) < 0.3 && Math.abs(s.ret3y - 12) < 0.3 && Math.abs(s.ret5y - 12) < 0.3, JSON.stringify(s)); assert.equal(s.fromHigh, 0);
  const f = seriesStats(navs({ cagr: 12, fallPct: 15 })); assert.ok(f.fromHigh >= 13 && f.fromHigh <= 15.5, `${f.fromHigh}`);
  assert.equal(seriesStats(navs({ yrs: 0.5 })).young, true);
  assert.equal(benchFor("Equity Scheme - Small Cap Fund"), "SMALLCAP250"); assert.equal(benchFor("Equity Scheme - Large Cap Fund"), "NIFTY50"); assert.equal(benchFor("Debt Scheme - Liquid Fund"), null);
  assert.ok(isIndexFund("UTI Nifty 50 Index Fund"));
});

test("fund review: laggard and copy → exit; beating + bulk zone → build; expensive → hold; alerts once", () => {
  const S = o => ({ stats: seriesStats(navs(o)), category: "Equity Scheme - Flexi Cap Fund" });
  const funds = [
    { key: "A", name: "Alpha Flexi", value: 500000, invested: 400000, fundId: "fa" },
    { key: "B", name: "Beta Flexi", value: 300000, invested: 280000, fundId: "fb" },
    { key: "C", name: "Gamma Small", value: 200000, invested: 150000, fundId: "fc" },
    { key: "D", name: "Delta Mid", value: 150000, invested: 120000, fundId: "fd" }
  ];
  const nav = new Map([["A", S({ cagr: 24, fallPct: 15 })], ["B", S({ cagr: 9 })], ["C", { stats: seriesStats(navs({ cagr: 5 })), category: "Equity Scheme - Small Cap Fund" }], ["D", { stats: seriesStats(navs({ cagr: 14 })), category: "Equity Scheme - Mid Cap Fund" }]]);
  const bench = new Map([["NIFTY500", seriesStats(navs({ cagr: 13 }))], ["SMALLCAP250", seriesStats(navs({ cagr: 14 }))], ["MIDCAP150", seriesStats(navs({ cagr: 14 }))]]);
  const ov = { "fa|fb": 70, "fa|fc": 10, "fb|fc": 12, "fa|fd": 20, "fb|fd": 22, "fc|fd": 15 };
  const summary = new Map([["fd", { coverage: 90, weightedPE: 48, mix: { buy: 5, wait: 30, expensive: 65 } }], ["fa", { coverage: 90, weightedPE: 22, mix: { buy: 45, wait: 40, expensive: 15 } }]]);
  const r = reviewFunds({ funds, nav, bench, summary, overlap: (a, b) => ov[[a, b].sort().join("|")] ?? null, today: "2026-10-23" }), by = Object.fromEntries(r.rows.map(x => [x.key, x]));
  assert.equal(by.A.verdict, "Build"); assert.equal(by.A.bulk, "bulk"); assert.match(by.A.lean, /Bulk buy now/);
  assert.equal(by.B.verdict, "Exit / switch"); assert.match(by.B.exitWhy, /Mostly a copy of Alpha Flexi|lagged/);
  assert.equal(by.C.verdict, "Exit / switch"); assert.match(by.C.exitWhy, /lagged the Nifty Smallcap 250/);
  assert.equal(by.D.verdict, "Hold (don't add)", "stocks mostly expensive");
  assert.deepEqual(r.bulkNow.map(x => x.key), ["A"]); assert.equal(r.pairs[0].pct, 70);
  const a = diffFundAlerts({}, r, { now: Date.parse("2026-10-23T05:00:00Z") });
  assert.equal(a.fresh.length, 1); assert.match(a.fresh[0].title, /Alpha Flexi: bulk-buy zone/);
  assert.equal(diffFundAlerts(a.next, r, { now: Date.parse("2026-10-24T05:00:00Z") }).fresh.length, 0);
  // new fund and missing X-ray are flagged for review
  const r2 = reviewFunds({ funds: [{ key: "N", name: "New Fund", value: 1000, fundId: null, firstSeen: "2026-10-20" }], nav: new Map([["N", S({ cagr: 12 })]]), bench, today: "2026-10-23" });
  assert.deepEqual(r2.review[0].why, ["new in your portfolio", "no X-ray portfolio"]);
});

test("portfolio churn between two months and low-overlap ideas", () => {
  const c = portfolioChurn([{ symbol: "A", weight: 50 }, { symbol: "B", weight: 50 }], [{ symbol: "A", weight: 50 }, { symbol: "C", weight: 50 }]);
  assert.equal(c.pct, 50); assert.deepEqual(c.added, ["C"]); assert.deepEqual(c.removed, ["B"]);
  const ideas = fundIdeas({ library: [{ id: "x", name: "X" }, { id: "y", name: "Y Nifty 50 Index" }, { id: "h", name: "Held" }], heldIds: new Set(["h"]), overlapWithMine: id => ({ x: 40, y: 12 })[id] });
  assert.deepEqual(ideas.map(i => i.id), ["y", "x"]); assert.equal(ideas[0].index, true);
});

test("OpenAI-compatible streaming: text and tool calls split across chunks; model list and pick", () => {
  const got = []; const col = openAiCollector(t => got.push(t)), feed = sseParser(col.on);
  const ev = o => `data: ${JSON.stringify(o)}\n\n`;
  feed(ev({ choices: [{ delta: { content: "Hello " } }] }) + ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "stock_", arguments: "{\"sym" } }] } }] }));
  feed(ev({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "detail", arguments: "bol\":\"TCS\"}" } }] }, finish_reason: "tool_calls" }] }) + ev({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 40 } }) + "data: [DONE]\n\n");
  const out = col.result();
  assert.equal(out.text, "Hello "); assert.deepEqual(got, ["Hello "]); assert.deepEqual(out.toolCalls, [{ id: "c1", name: "stock_detail", input: { symbol: "TCS" } }]);
  assert.deepEqual(out.usage, { input: 900, output: 40 }); assert.equal(out.finish, "tool_calls");
  const ids = chatModelIds({ data: [{ id: "models/gemini-2.5-flash" }, { id: "gemini-2.5-flash-lite" }, { id: "text-embedding-004" }, { id: "gemini-2.5-pro" }] });
  assert.deepEqual(ids, ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"]); assert.equal(pickModel("gemini", ids), "gemini-2.5-flash");
  assert.equal(pickModel("openrouter", ["a/b", "meta/llama:free", "x/y:free-long"]), "meta/llama:free");
  assert.equal(toOpenAiTools(TOOLS)[0].type, "function"); assert.ok(TOOLS.some(t => t.name === "fund_review"));
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: Ask AI with an OpenAI-compatible provider (key checked by listing models, tools run here, key never sent back)", async () => {
  const seen = [];
  const fake = http.createServer(async (req, res) => {
    let body = ""; for await (const ch of req) body += ch;
    seen.push({ url: req.url, auth: req.headers.authorization, body });
    if (req.url === "/v1/models") { if (req.headers.authorization !== "Bearer gsk_test_key_123456") { res.writeHead(401, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ error: { message: "bad key" } })); } res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }] })); }
    if (req.url === "/v1/chat/completions") {
      const b = JSON.parse(body), hasTool = b.messages.some(m => m.role === "tool");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const ev = o => res.write(`data: ${JSON.stringify(o)}\n\n`);
      if (!hasTool) ev({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "fund_review", arguments: "{}" } }] }, finish_reason: "tool_calls" }] });
      else { ev({ choices: [{ delta: { content: "You hold no funds yet." } }] }); ev({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 8 } }); }
      res.write("data: [DONE]\n\n"); return res.end();
    }
    res.writeHead(404); res.end();
  }).listen(0, "127.0.0.1");
  await new Promise(r => fake.once("listening", r));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-543-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c543", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav", AI_BASE_GROQ: `http://127.0.0.1:${fake.address().port}/v1` }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* text */ } return { status: r.status, json, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c543", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const st0 = (await call("/api/ai/status", { cookie: owner })).json;
    assert.ok(st0.providers.some(p => p.id === "gemini" && p.free) && st0.providers.some(p => p.id === "ollama")); assert.equal(st0.provider, "anthropic");
    const bad = await call("/api/ai/provider", { cookie: owner, body: { provider: "groq", key: "gsk_wrong_key_000000" } }); assert.equal(bad.status, 400); assert.match(bad.json.message, /rejected the API key/);
    const ok = await call("/api/ai/provider", { cookie: owner, body: { provider: "groq", key: "gsk_test_key_123456" } });
    assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.provider, "groq"); assert.equal(ok.json.configured, true); assert.equal(ok.json.model, "llama-3.3-70b-versatile");
    assert.deepEqual(ok.json.models.map(m => m.id), ["llama-3.3-70b-versatile"], "speech models left out"); assert.ok(!ok.text.includes("gsk_test_key_123456"), "the key is never sent back");
    const sealed = await fs.readFile(path.join(dataDir, "users", (await call("/api/auth/me", { cookie: owner })).json?.user?.id || "x", "ai-keys.json"), "utf8").catch(() => null);
    if (sealed) assert.ok(!sealed.includes("gsk_test_key_123456"), "stored encrypted");
    const chat = await call("/api/ai/chat", { cookie: owner, body: { message: "Which of my funds should I exit?" } });
    assert.match(chat.text, /event: tool\ndata: {"name":"fund_review"/); assert.match(chat.text, /You hold no funds yet\./); assert.match(chat.text, /event: done/);
    const req1 = JSON.parse(seen.find(s => s.url === "/v1/chat/completions").body);
    assert.equal(req1.model, "llama-3.3-70b-versatile"); assert.equal(req1.messages[0].role, "system"); assert.match(req1.messages[0].content, /The user's portfolio now/); assert.ok(req1.tools.some(t => t.function.name === "stock_detail"));
    const req2 = JSON.parse(seen.filter(s => s.url === "/v1/chat/completions")[1].body);
    assert.equal(req2.messages.at(-1).role, "tool"); assert.equal(req2.messages.at(-1).tool_call_id, "t1");
    assert.ok(!seen.some(s => s.body.includes("owner-pass-phrase")));
    const st1 = (await call("/api/ai/status", { cookie: owner })).json; assert.ok(st1.usage.input >= 1200);
    // members can't point the app at their own server
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    assert.ok(!(await call("/api/ai/status", { cookie: friend })).json.providers.some(p => p.id === "custom"));
    assert.equal((await call("/api/ai/provider", { cookie: friend, body: { provider: "ollama", base: "http://10.0.0.5:11434/v1" } })).status, 400);
    const rv = await call("/api/mf/review", { cookie: owner }); assert.equal(rv.status, 200); assert.deepEqual(rv.json.rows, []);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); fake.close(); await fs.rm(dataDir, { recursive: true, force: true }); }
});
