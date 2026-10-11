import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKiteClient, parseRpcBody, normalizeHoldings, normalizeLtp, normalizeProfile, looseJson, READ_ONLY_TOOLS, KiteError } from "../kite-mcp.mjs";

// A minimal fake Kite MCP server speaking Streamable HTTP. `mode` switches JSON vs SSE replies.
async function fakeServer({ sse = false } = {}) {
  const st = { sessions: new Set(), loggedIn: new Set(), calls: [], inits: 0, sse };
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const msg = JSON.parse(body), sid = req.headers["mcp-session-id"];
    const send = (obj, headers = {}) => {
      if (st.sse) { res.writeHead(200, { "Content-Type": "text/event-stream", ...headers }); res.end(`: keepalive\n\nevent: message\ndata: ${JSON.stringify(obj)}\n\n`); }
      else { res.writeHead(200, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(obj)); }
    };
    if (msg.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (msg.method === "initialize") { st.inits++; const id = `s${st.inits}`; st.sessions.add(id); return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } } }, { "Mcp-Session-Id": id }); }
    if (!st.sessions.has(sid)) { res.writeHead(404); return res.end("no such session"); }
    if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "get_holdings" }, { name: "place_order", description: "dangerous" }] } });
    const { name, arguments: args } = msg.params; st.calls.push({ name, args, sid });
    const text = t => send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t) }] } });
    if (name === "login") { st.loggedIn.add(sid); return text("Open this link to log in: https://kite.zerodha.com/connect/login?api_key=abc&v=3 then retry."); }
    if (!st.loggedIn.has(sid)) return send({ jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: "Please log in first using the login tool" }] } });
    if (name === "get_profile") return text({ user_id: "AB1234", user_name: "Test User", email: "t@example.com" });
    if (name === "get_holdings") return text([{ tradingsymbol: "INFY", exchange: "NSE", quantity: 10, t1_quantity: 2, average_price: 1500, last_price: 1600, pnl: 1200 }, { tradingsymbol: "ZERO", quantity: 0, average_price: 1, last_price: 1 }]);
    if (name === "get_ltp") return text(Object.fromEntries(args.instruments.map((i, k) => [i, { instrument_token: k, last_price: 100 + k }])));
    return text("{}");
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { st, url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => server.close() };
}
const tmp = async () => path.join(await fs.mkdtemp(path.join(os.tmpdir(), "kite-test-")), "session.json");

for (const sse of [false, true]) {
  test(`login → profile → holdings → ltp over ${sse ? "SSE" : "JSON"}`, async () => {
    const srv = await fakeServer({ sse }); const k = createKiteClient({ url: srv.url, enabled: true, sessionFile: await tmp() });
    try {
      assert.deepEqual(await k.status(), { enabled: true, url: srv.url, connected: false, loginRequired: true, error: null });
      const login = await k.login(); assert.equal(login.loginUrl, "https://kite.zerodha.com/connect/login?api_key=abc&v=3");
      const s = await k.status(); assert.equal(s.connected, true); assert.equal(s.profile.userId, "AB1234");
      const h = await k.holdings(); assert.equal(h.length, 1, "zero-quantity rows are dropped");
      assert.deepEqual(h[0], { symbol: "INFY", exchange: "NSE", isin: null, qty: 12, avgPrice: 1500, lastPrice: 1600, invested: 18000, value: 19200, pnl: 1200, dayChangePct: null });
      const p = await k.ltp(["infy", "TCS", "INFY"]); assert.equal(p.get("INFY"), 100); assert.equal(p.get("TCS"), 101);
      assert.deepEqual(srv.st.calls.filter(c => c.name === "get_ltp")[0].args.instruments, ["NSE:INFY", "NSE:TCS"]);
      assert.equal(srv.st.inits, 1, "one session is reused");
    } finally { srv.close(); }
  });
}
test("write tools are refused before any network call, and so are unknown ones", async () => {
  let hits = 0; const k = createKiteClient({ url: "http://127.0.0.1:1/mcp", enabled: true, sessionFile: await tmp(), fetchImpl: async () => { hits++; throw new Error("net"); } });
  for (const name of ["place_order", "modify_order", "cancel_order", "place_gtt_order", "anything_else"]) await assert.rejects(() => k.callTool(name, {}), /read-only/);
  assert.equal(hits, 0);
  assert.ok(!READ_ONLY_TOOLS.some(n => /order|gtt|delete|modify|cancel/i.test(n)));
});
test("disabled client never touches the network", async () => {
  let hits = 0; const k = createKiteClient({ url: "http://x/mcp", enabled: false, sessionFile: await tmp(), fetchImpl: async () => { hits++; } });
  assert.deepEqual(await k.status(), { enabled: false, connected: false }); await assert.rejects(() => k.holdings(), /switched off/); assert.equal(hits, 0);
});
test("session survives a restart; an expired session is re-created and reports login required", async () => {
  const srv = await fakeServer(); const file = await tmp();
  try {
    const a = createKiteClient({ url: srv.url, enabled: true, sessionFile: file }); await a.login(); assert.equal((await a.status()).connected, true);
    const b = createKiteClient({ url: srv.url, enabled: true, sessionFile: file }); assert.equal((await b.status()).connected, true); assert.equal(srv.st.inits, 1, "restart reuses the saved session");
    srv.st.sessions.clear(); // server forgets us (e.g. it restarted)
    const s = await b.status(); assert.equal(s.connected, false); assert.equal(s.loginRequired, true); assert.equal(srv.st.inits, 2);
    await b.forget(); await assert.rejects(() => fs.stat(file));
  } finally { srv.close(); }
});
test("unreachable server is a network error, not a login prompt", async () => {
  const k = createKiteClient({ url: "http://127.0.0.1:1/mcp", enabled: true, sessionFile: await tmp(), timeoutMs: 2000 });
  const s = await k.status(); assert.equal(s.connected, false); assert.ok(!s.loginRequired); assert.match(s.error, /Cannot reach Kite MCP/);
});
test("listTools flags which tools this app is allowed to use", async () => {
  const srv = await fakeServer(); const k = createKiteClient({ url: srv.url, enabled: true, sessionFile: await tmp() });
  try { const t = await k.listTools(); assert.equal(t.find(x => x.name === "get_holdings").allowed, true); assert.equal(t.find(x => x.name === "place_order").allowed, false); } finally { srv.close(); }
});
test("parsers: SSE with notifications first, bare/wrapped JSON, holdings and LTP shapes", () => {
  const sse = `data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":1}}\n\n`;
  assert.deepEqual(parseRpcBody(sse, "text/event-stream", 7).result, { ok: 1 }); assert.equal(parseRpcBody(sse, "text/event-stream", 8), null);
  assert.deepEqual(looseJson('Here you go:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]); assert.equal(looseJson("no json"), null);
  assert.equal(normalizeHoldings({ holdings: [{ trading_symbol: "tcs", quantity: 1, average_price: 10, last_price: 12 }] })[0].pnl, 2);
  assert.throws(() => normalizeHoldings({ weird: true }), KiteError);
  assert.equal(normalizeLtp({ data: { "NSE:TCS": { last_price: 3500 }, "NSE:BAD": { last_price: 0 } } }).get("TCS"), 3500);
  assert.equal(normalizeProfile({ data: { user_id: "ZZ9" } }).userId, "ZZ9"); assert.equal(normalizeProfile({}), null);
});
import { extractLoginUrl } from "../kite-mcp.mjs";
test("login link is found in prose, markdown and JSON with Go-style \\u0026 escaping", () => {
  const u = "https://kite.zerodha.com/connect/login?api_key=kitemcp&v=3&redirect_params=session_id%3Dabc";
  for (const t of [`Open this link: ${u} then retry.`, `[Log in](${u}).`, JSON.stringify({ url: u }), JSON.stringify({ url: u }).replace(/&/g, "\\u0026"), `{"msg":"x","login_url":"${u.replace(/&/g, "\\u0026")}"}`]) assert.equal(extractLoginUrl(t), u);
  assert.equal(extractLoginUrl("no link here"), null);
});
test("diagnose reports each step and where it stops", async () => {
  const srv = await fakeServer(); const k = createKiteClient({ url: srv.url, enabled: true, sessionFile: await tmp() });
  try { const d = await k.diagnose(); assert.deepEqual(d.steps.map(s => [s.step, s.ok]), [["connect + tools/list", true], ["login tool", true], ["get_profile (after login)", true]]); } finally { srv.close(); }
  const dead = createKiteClient({ url: "http://127.0.0.1:1/mcp", enabled: true, sessionFile: await tmp(), timeoutMs: 1500 });
  const d2 = await dead.diagnose(); assert.equal(d2.steps.length, 1); assert.equal(d2.steps[0].ok, false);
});
