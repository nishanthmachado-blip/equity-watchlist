import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseTick, encodeTick, subscribeMessage, createAngelStream } from "../angelstream.mjs";
import { attachWs } from "./wsfake.mjs";

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const wait = (cond, ms = 5000) => new Promise((ok, no) => { const t0 = Date.now(); const k = setInterval(() => { if (cond()) { clearInterval(k); ok(); } else if (Date.now() - t0 > ms) { clearInterval(k); no(new Error("timed out")); } }, 20); });

test("live feed ticks: Angel's binary layout is read correctly", () => {
  const b = encodeTick({ token: "11536", price: 3050.55, prevClose: 3020.1, open: 3000, high: 3061, low: 2990.5, volume: 123456, at: Date.parse("2026-10-21T09:59:59Z") });
  assert.equal(b.length, 123);
  const t = parseTick(b);
  assert.deepEqual([t.exchange, t.token, t.price, t.prevClose, t.open, t.high, t.low, t.volume, new Date(t.at).toISOString()], ["NSE", "11536", 3050.55, 3020.1, 3000, 3061, 2990.5, 123456, "2026-10-21T09:59:59.000Z"]);
  const l = parseTick(encodeTick({ mode: 1, exchange: "BSE", token: "500325", price: 1400.05 }));
  assert.deepEqual([l.exchange, l.token, l.price, l.prevClose], ["BSE", "500325", 1400.05, undefined]);
  assert.equal(parseTick(Buffer.from("pong")), null);
  assert.deepEqual(JSON.parse(subscribeMessage(1, [{ exchange: "NSE", token: "1" }, { exchange: "BSE", token: "2" }, { exchange: "NSE", token: "3" }])).params, { mode: 2, tokenList: [{ exchangeType: 1, tokens: ["1", "3"] }, { exchangeType: 3, tokens: ["2"] }] });
});

test("live feed connection: subscribes, batches ticks per second, follows list changes, reconnects", async () => {
  const conns = [];
  const srv = http.createServer(); attachWs(srv, { onConnect: c => { conns.push(c); c.onMessage = m => { if (m === "ping") c.send("pong"); }; } });
  const port = await freePort(); await new Promise(r => srv.listen(port, "127.0.0.1", r));
  const got = []; let auths = 0;
  const s = createAngelStream({ auth: async () => { auths++; return { url: `ws://127.0.0.1:${port}/smart-stream`, headers: { Authorization: "Bearer J", "x-api-key": "k", "x-client-code": "A1", "x-feed-token": "F" } }; }, onTicks: t => got.push(t), flushMs: 100, pingMs: 200, retryMs: 50 });
  try {
    s.setTokens([{ exchange: "NSE", token: "11" }, { exchange: "NSE", token: "22" }]); s.start();
    await wait(() => conns[0]?.received.some(m => typeof m === "string" && m.includes('"action":1')));
    assert.equal(conns[0].headers["x-feed-token"], "F"); assert.equal(conns[0].headers.authorization, "Bearer J");
    assert.deepEqual(JSON.parse(conns[0].received.find(m => m.includes('"action":1'))).params.tokenList, [{ exchangeType: 1, tokens: ["11", "22"] }]);
    for (const p of [100, 101, 102]) conns[0].send(encodeTick({ token: "11", price: p }));
    conns[0].send(encodeTick({ token: "22", price: 50 }));
    await wait(() => got.length);
    assert.deepEqual(got[0].map(t => [t.token, t.price]).sort(), [["11", 102], ["22", 50]], "only the newest tick per stock in each batch");
    assert.equal(s.status().state, "live"); assert.equal(s.status().tokens, 2);
    s.setTokens([{ exchange: "NSE", token: "22" }, { exchange: "NSE", token: "33" }]);
    await wait(() => conns[0].received.some(m => typeof m === "string" && m.includes('"action":0')));
    assert.ok(conns[0].received.some(m => typeof m === "string" && m.includes('"action":0') && m.includes('"11"')), "unsubscribed the dropped stock");
    await wait(() => conns[0].received.includes("ping"), 2000);
    conns[0].close(); // the server drops us: reconnect and subscribe again
    await wait(() => conns[1]?.received.some(m => typeof m === "string" && m.includes('"33"')), 5000);
    assert.equal(auths, 2); assert.ok(s.status().reconnects >= 1);
  } finally { s.stop(); for (const c of conns) c.close(); srv.close(); }
});

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIP = [{ token: "11536", symbol: "TCS-EQ", name: "TCS", exch_seg: "NSE", instrumenttype: "" }, { token: "1594", symbol: "INFY-EQ", name: "INFY", exch_seg: "NSE", instrumenttype: "" },
  ...Array.from({ length: 600 }, (_, i) => ({ token: String(50000 + i), symbol: `FILL${i}-EQ`, name: `FILL${i}`, exch_seg: "NSE", instrumenttype: "" }))];
test("server: Angel One's live feed prices your stocks within a second and pushes them to the page", async () => {
  const conns = [], seen = [];
  const fake = http.createServer(async (req, res) => {
    let body = ""; for await (const ch of req) body += ch; seen.push(`${req.method} ${req.url}`);
    const send = o => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url === "/scrip") return send(SCRIP);
    if (req.url.endsWith("/loginByPassword")) return send({ status: true, data: { jwtToken: "JWT1", refreshToken: "R", feedToken: "FEED1" } });
    if (req.url.endsWith("/getProfile")) return send({ status: true, data: { clientcode: "A1", name: "Test" } });
    if (req.url.endsWith("/market/v1/quote/")) return send({ status: true, data: { fetched: [], unfetched: [] } });
    res.writeHead(404); res.end("{}");
  });
  attachWs(fake, { onConnect: (c, req) => { if (req.headers["x-feed-token"] !== "FEED1" || req.headers.authorization !== "Bearer JWT1") return false; conns.push(c); c.onMessage = m => { if (m === "ping") c.send("pong"); }; } });
  const fport = await freePort(); await new Promise(r => fake.listen(fport, "127.0.0.1", r));
  const F = `http://127.0.0.1:${fport}`, dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-stream-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "st-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", MARKET_ALWAYS_OPEN: "1",
    PRICE_SOURCES: "nse,yahoo", NSE_BASE: "http://127.0.0.1:9", YAHOO_CHART_BASE: "http://127.0.0.1:9", YAHOO_QUOTE_BASE: "http://127.0.0.1:9", SCREENER_BASE: "http://127.0.0.1:9",
    ANGEL_API_ROOT: F, ANGEL_SCRIP_URL: `${F}/scrip`, ANGEL_WS_URL: `ws://127.0.0.1:${fport}/smart-stream`, ANGEL_API_KEY: "key", ANGEL_CLIENT_CODE: "A1", ANGEL_PIN: "1234", ANGEL_TOTP_SECRET: "JBSWY3DPEHPK3PXP" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  const ac = new AbortController();
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "st-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    assert.equal((await call("/api/swing/position", { cookie: owner, body: { symbol: "TCS", name: "TCS", qty: 5, avgPrice: 3000 } })).status, 200);
    // the page's live stream
    const sse = await fetch(`http://127.0.0.1:${port}/api/events`, { headers: { Cookie: owner }, signal: ac.signal }); const reader = sse.body.getReader(); let sseText = "";
    (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; sseText += new TextDecoder().decode(value); } } catch { /* aborted */ } })();
    await wait(() => conns[0]?.received.some(m => typeof m === "string" && m.includes('"11536"')), 15000).catch(() => { throw new Error(`no subscription: ${log.slice(-900)}`); });
    conns[0].send(encodeTick({ token: "11536", price: 3123.45, prevClose: 3100, open: 3101, high: 3130, low: 3095, volume: 5000 }));
    await wait(() => sseText.includes("3123.45"), 5000).catch(() => { throw new Error(`no push: ${sseText.slice(-300)} ${log.slice(-600)}`); });
    assert.match(sseText, /"stream":true/);
    const st = await call("/api/prices/status", { cookie: owner });
    assert.equal(st.json.stream.state, "live"); assert.ok(st.json.stream.ticks >= 1);
    const sw = await call("/api/swing", { cookie: owner });
    const p = sw.json.positions.find(x => x.symbol === "TCS");
    assert.deepEqual([p.price, p.priceSource], [3123.45, "Angel One"]);
    assert.ok(seen.every(x => !/order|place|modify|cancel/i.test(x)), "only read-only endpoints");
  } finally { ac.abort(); child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); for (const c of conns) c.close(); fake.closeAllConnections(); fake.close(); }
});
