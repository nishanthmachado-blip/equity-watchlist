import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKiteClient, resolveKiteOp, resolveKiteOpAll, findKiteUser, toolChoices, oauthOnly, KITE_OPS } from "../kite-mcp.mjs";

// The hosted Kite MCP server now offers 8 grouped tools (alerts, gtt, help, market, mutual_funds, orders, portfolio,
// session) instead of get_profile / get_holdings / login. Each takes an action; the app must find the read-only action
// for each of its jobs from the published argument schema, and never pick a trading action.
const en = (prop, values, extra = {}) => ({ type: "object", properties: { [prop]: { type: "string", enum: values }, ...extra }, required: [prop] });
const GROUPED = [
  { name: "alerts", inputSchema: en("action", ["list", "create", "delete"]) },
  { name: "gtt", inputSchema: en("action", ["list", "place", "modify", "delete"]) },
  { name: "help", inputSchema: { type: "object", properties: { topic: { type: "string" } } } },
  { name: "market", inputSchema: en("action", ["quotes", "ltp", "ohlc", "historical_data", "search_instruments"], { instruments: { type: "array" } }) },
  { name: "mutual_funds", inputSchema: en("action", ["place_order", "holdings", "orders", "sips"]) },
  { name: "orders", inputSchema: en("action", ["place", "modify", "cancel", "list", "trades", "history"]) },
  { name: "portfolio", inputSchema: en("action", ["holdings", "positions", "margins"]) },
  { name: "session", inputSchema: en("action", ["profile", "logout"]) }
];
function fakeGrouped(tools = GROUPED, { loggedIn = true } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const res = (status, obj, headers = {}) => ({ status, ok: status < 300, headers: new Map(Object.entries({ "content-type": "application/json", ...headers })), text: async () => typeof obj === "string" ? obj : JSON.stringify(obj) });
    const ok = result => res(200, { jsonrpc: "2.0", id: body.id, result });
    if (body.method === "initialize") return res(200, { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }, { "mcp-session-id": "s1" });
    if (!body.id) return res(202, "");
    if (body.method === "tools/list") return ok({ tools });
    const { name, arguments: a } = body.params; calls.push({ name, a });
    if (!tools.some(t => t.name === name)) return res(200, { jsonrpc: "2.0", id: body.id, error: { code: -32602, message: `unknown tool "${name}"` } });
    const text = t => ok({ content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t) }] });
    const act = a.action ?? a.operation;
    if (name === "help") return text("portfolio: action=holdings|positions|margins …");
    if (!loggedIn) return ok({ isError: true, content: [{ type: "text", text: "Session expired. Please log in again." }] });
    if (name === "session" && act === "profile") return text({ user_id: "ZZ9999", user_name: "Grouped User" });
    if (name === "portfolio" && act === "holdings") return text({ data: [{ tradingsymbol: "INFY", exchange: "NSE", quantity: 5, average_price: 1400, last_price: 1500, pnl: 500 }] });
    if (name === "mutual_funds" && act === "holdings") return text([{ folio: "1", fund: "Some Fund", tradingsymbol: "INF000A01010", quantity: 10, average_price: 50, last_price: 60, pnl: 100 }]);
    if (name === "market" && act === "ltp") return text(Object.fromEntries(a.instruments.map((i, k) => [i, { last_price: 200 + k }])));
    if (name === "orders" && act === "trades") return text([]);
    return ok({ isError: true, content: [{ type: "text", text: `unsupported ${name} ${act}` }] });
  };
  return { fetchImpl, calls };
}
const mk = async (f) => createKiteClient({ url: "https://mcp.example/mcp", enabled: true, fetchImpl: f.fetchImpl, sessionFile: path.join(await fs.mkdtemp(path.join(os.tmpdir(), "kite-grp-")), "kite-session.json") });

test("grouped tools: every job maps to a read-only action; trading tools are never chosen", () => {
  assert.deepEqual(resolveKiteOp("profile", GROUPED), { name: "session", args: { action: "profile" } });
  assert.deepEqual(resolveKiteOp("holdings", GROUPED), { name: "portfolio", args: { action: "holdings" } });
  assert.deepEqual(resolveKiteOp("mfHoldings", GROUPED), { name: "mutual_funds", args: { action: "holdings" } });
  assert.deepEqual(resolveKiteOp("ltp", GROUPED), { name: "market", args: { action: "ltp" } });
  assert.deepEqual(resolveKiteOp("quotes", GROUPED), { name: "market", args: { action: "quotes" } });
  assert.deepEqual(resolveKiteOp("historical", GROUPED), { name: "market", args: { action: "historical_data" } });
  assert.deepEqual(resolveKiteOp("trades", GROUPED), { name: "orders", args: { action: "trades" } });
  assert.equal(resolveKiteOp("login", GROUPED), null); assert.equal(oauthOnly(GROUPED), true);
  for (const op of Object.keys(KITE_OPS)) { const r = resolveKiteOp(op, GROUPED); if (r) { assert.ok(!["gtt", "alerts", "help"].includes(r.name)); assert.ok(!/place|modify|cancel|delete|create|logout/.test(Object.values(r.args)[0])); } }
  // a tool that only offers trading actions gives nothing
  assert.equal(resolveKiteOp("trades", [{ name: "orders", inputSchema: en("action", ["place", "modify", "cancel"]) }]), null);
  assert.equal(resolveKiteOp("mfHoldings", [{ name: "mutual_funds", inputSchema: en("action", ["place_order", "cancel_order"]) }]), null);
  // old servers keep their own tool names
  assert.deepEqual(resolveKiteOp("holdings", [{ name: "get_holdings" }, { name: "portfolio", inputSchema: en("action", ["holdings"]) }]), { name: "get_holdings", args: {} });
  assert.equal(oauthOnly([{ name: "login" }, { name: "get_profile" }]), false); assert.equal(oauthOnly([]), false);
});
test("grouped tools: other schema shapes (another argument name, oneOf consts, $ref, no published values)", () => {
  assert.deepEqual(resolveKiteOp("holdings", [{ name: "portfolio", inputSchema: en("operation", ["get_holdings", "get_positions"]) }]), { name: "portfolio", args: { operation: "get_holdings" } });
  assert.deepEqual(resolveKiteOp("profile", [{ name: "session", inputSchema: { properties: { action: { oneOf: [{ const: "status" }, { const: "logout" }] } } } }]), { name: "session", args: { action: "status" } });
  assert.deepEqual(resolveKiteOp("ltp", [{ name: "market", inputSchema: { properties: { action: { $ref: "#/$defs/A" } }, $defs: { A: { enum: ["ltp", "quotes"] } } } }]), { name: "market", args: { action: "ltp" } });
  assert.deepEqual(resolveKiteOp("holdings", [{ name: "portfolio", inputSchema: { properties: { action: { type: "string", description: "holdings | positions" } } } }]), { name: "portfolio", args: { action: "holdings" } });
  assert.equal(resolveKiteOp("holdings", [{ name: "portfolio", inputSchema: { properties: { limit: { type: "number" } } } }]), null);
  assert.deepEqual(toolChoices(en("action", ["a", "b"], { segment: { type: "string", enum: ["x"] } })).map(x => x.prop), ["action", "segment"]);
});
test("grouped server: status, holdings, mutual funds, prices and trades work; Log in says already signed in", async () => {
  const f = fakeGrouped(), k = await mk(f);
  const s = await k.status(); assert.equal(s.connected, true); assert.equal(s.profile.userId, "ZZ9999");
  assert.equal((await k.holdings())[0].symbol, "INFY");
  assert.equal((await k.mfHoldings()).length, 1);
  assert.equal((await k.ltp(["INFY", "TCS"])).get("TCS"), 201);
  assert.deepEqual(await k.trades(), []);
  const x = await k.login({ redirectUri: "http://localhost:4173/api/kite/callback" }); assert.equal(x.connected, true); assert.equal(x.profile.userId, "ZZ9999");
  assert.deepEqual(f.calls.map(c => `${c.name}:${c.a.action}`), ["session:profile", "portfolio:holdings", "mutual_funds:holdings", "market:ltp", "orders:trades", "session:profile"]);
  const tools = await k.listTools();
  assert.deepEqual(tools.filter(t => t.allowed).map(t => t.name), ["market", "mutual_funds", "orders", "portfolio", "session"]);
  await assert.rejects(k.callTool("orders", { action: "place" }), /read-only/, "grouped tools cannot be called directly with any action");
});
test("grouped server: Diagnose shows the mapping, the tool schemas and the help text", async () => {
  const f = fakeGrouped(), k = await mk(f), d = await k.diagnose();
  assert.deepEqual(d.steps.map(x => [x.step, x.ok]), [["connect + tools/list", true], ["how this app reads it", true], ["login tool", true], ["profile", true], ["holdings", true], ["mutual fund holdings", true]]);
  assert.match(d.steps[1].detail, /profile → session \{"action":"profile"\}/);
  assert.match(d.schemas, /■ portfolio/); assert.match(d.schemas, /"enum":\["holdings","positions","margins"\]/); assert.match(d.schemas, /help says:/);
  assert.ok(!f.calls.some(c => ["gtt", "alerts"].includes(c.name) || /place|modify|cancel|delete|create|logout/.test(c.a.action || "")));
});
test("a job the server has no tool for gives a clear message; a signed-out grouped server asks for login", async () => {
  const k = await mk(fakeGrouped([{ name: "help" }, { name: "portfolio", inputSchema: en("action", ["positions"]) }]));
  await assert.rejects(k.holdings(), e => e.noTool === true && /no tool this app knows for "holdings" \(it offers: help, portfolio\)/.test(e.message));
  const out = await mk(fakeGrouped(GROUPED, { loggedIn: false }));
  assert.deepEqual(await out.status(), { enabled: true, url: "https://mcp.example/mcp", connected: false, loginRequired: true, error: null });
});

// v5.75.4: the real server uses "mode" and its profile reply did not carry a user id where the app looked.
test("the user id is found wherever the reply puts it; several profile actions are tried", async () => {
  assert.deepEqual(findKiteUser({ data: { session: { user: { user_id: "ab1234", user_name: "A B" } } } }), { userId: "AB1234", name: "A B", email: null });
  assert.deepEqual(findKiteUser(null, "Logged in. User ID: YJ4133 (Zerodha)"), { userId: "YJ4133", name: null, email: null });
  assert.equal(findKiteUser({ status: "ok", holdings: [{ tradingsymbol: "INFY" }] }, "all good"), null);
  const tools = [{ name: "session", inputSchema: en("mode", ["status", "profile", "logout"]) }, { name: "portfolio", inputSchema: en("mode", ["holdings", "positions", "margins", "profile"]) }];
  assert.deepEqual(resolveKiteOpAll("profile", tools), [{ name: "session", args: { mode: "profile" } }, { name: "portfolio", args: { mode: "profile" } }, { name: "session", args: { mode: "status" } }]);
  // session:profile answers without an id, portfolio:profile has it
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body), res = (status, obj, headers = {}) => ({ status, ok: status < 300, headers: new Map(Object.entries({ "content-type": "application/json", ...headers })), text: async () => typeof obj === "string" ? obj : JSON.stringify(obj) });
    if (body.method === "initialize") return res(200, { jsonrpc: "2.0", id: body.id, result: {} }, { "mcp-session-id": "s1" });
    if (!body.id) return res(202, "");
    if (body.method === "tools/list") return res(200, { jsonrpc: "2.0", id: body.id, result: { tools } });
    const { name, arguments: a } = body.params; calls.push(`${name}:${a.mode}`);
    const reply = name === "portfolio" && a.mode === "profile" ? { profile: { user_id: "QQ1111", user_name: "Q" } } : { authenticated: true };
    return res(200, { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify(reply) }] } });
  };
  const k = await mk({ fetchImpl });
  assert.equal((await k.profile()).userId, "QQ1111"); assert.deepEqual(calls, ["session:profile", "portfolio:profile"]);
  // nobody names the user: profile is null, the card still says connected, Diagnose lists field names only
  const k2 = await mk({ fetchImpl: async (u, o) => { const b = JSON.parse(o.body); if (b.method === "tools/call" && b.params.arguments.mode === "profile") b.params.name = "session"; return fetchImpl(u, { ...o, body: JSON.stringify(b) }); } });
  assert.equal(await k2.profile(), null);
  const s = await k2.status(); assert.equal(s.connected, true); assert.equal(s.profile, null);
  const d = await k2.diagnose(), step = d.steps.find(x => x.step === "profile");
  assert.equal(step.ok, false); assert.match(step.detail, /Reply fields: session \{"mode":"profile"\} → \{authenticated\}/);
});
