import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBrokerClients } from "../brokers.mjs";
import { createBrokerMcp, isReadOnlyTool, pickTool, normalizeMcpHoldings, normalizeMcpProfile } from "../broker-mcp.mjs";
import { splitCommand } from "../mcp-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tmpDir = () => fs.mkdtemp(path.join(os.tmpdir(), "bmcp-test-"));
async function setup(env) {
  const d = await tmpDir();
  const brokers = createBrokerClients({ env, sessionFile: path.join(d, "s.json"), credentialsFile: path.join(d, "c.json"), fetchImpl: async () => { throw new Error("REST must not be used in MCP tests"); } });
  return { d, brokers, mcp: createBrokerMcp({ brokers, env, file: path.join(d, "mcp.json"), redirectUri: () => "http://localhost:4173/api/brokers/mcp/callback", timeoutMs: 8000 }) };
}
const b64url = b => Buffer.from(b).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// A hosted MCP server protected by the MCP OAuth flow (protected-resource metadata, dynamic registration, PKCE).
async function fakeOAuthServer({ tools = null, answer = null } = {}) {
  const st = { codes: new Map(), tokens: new Set(), headers: [], calls: [], registered: [] };
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, `http://${req.headers.host}`), origin = `http://${req.headers.host}`;
    let body = ""; for await (const c of req) body += c;
    const json = (code, obj, h = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
    if (u.pathname === "/.well-known/oauth-protected-resource/mcp") return json(200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    if (u.pathname === "/.well-known/oauth-authorization-server") return json(200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` });
    if (u.pathname === "/register") { const r = JSON.parse(body); st.registered.push(r); return json(201, { client_id: "cid-1", redirect_uris: r.redirect_uris }); }
    if (u.pathname === "/authorize") { // the user approves: issue a code bound to the PKCE challenge
      const code = crypto.randomBytes(8).toString("hex"); st.codes.set(code, { challenge: u.searchParams.get("code_challenge"), redirect: u.searchParams.get("redirect_uri"), resource: u.searchParams.get("resource") });
      res.writeHead(302, { Location: `${u.searchParams.get("redirect_uri")}?code=${code}&state=${u.searchParams.get("state")}` }); return res.end();
    }
    if (u.pathname === "/token") {
      const f = new URLSearchParams(body), c = st.codes.get(f.get("code"));
      if (f.get("grant_type") !== "authorization_code" || !c || b64url(crypto.createHash("sha256").update(f.get("code_verifier")).digest()) !== c.challenge || f.get("client_id") !== "cid-1") return json(400, { error: "invalid_grant" });
      const t = "tok-" + crypto.randomBytes(6).toString("hex"); st.tokens.add(t); return json(200, { access_token: t, token_type: "Bearer", expires_in: 3600, refresh_token: "r1" });
    }
    if (u.pathname !== "/mcp") return json(404, {});
    st.headers.push(req.headers);
    if (!st.tokens.has(String(req.headers.authorization || "").replace(/^Bearer /, ""))) return json(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"` });
    const msg = JSON.parse(body);
    if (msg.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (msg.method === "initialize") return json(200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake-dhan" } } }, { "Mcp-Session-Id": "sess-1" });
    if (msg.method === "tools/list" && tools) return json(200, { jsonrpc: "2.0", id: msg.id, result: { tools: tools.map(t => (typeof t === "string" ? { name: t } : t)) } });
    if (msg.method === "tools/list") return json(200, { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "get_holdings" }, { name: "get_profile" }, { name: "place_order" }, { name: "modify_super_order" }] } });
    const { name } = msg.params; st.calls.push(name);
    const text = t => json(200, { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(t) }] } });
    if (answer) { const a = answer(name, msg.params.arguments || {}); if (a?.isError) return json(200, { jsonrpc: "2.0", id: msg.id, result: { isError: true, content: [{ type: "text", text: a.isError }] } }); return text(a); }
    if (name === "get_profile") return text({ dhanClientId: "1100", tokenValidity: "x" });
    if (name === "get_holdings") return text([{ exchange: "ALL", tradingSymbol: "HDFCBANK", securityId: "1333", totalQty: 5, dpQty: 5, t1Qty: 0, avgCostPrice: 1500 }]);
    return text({});
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { st, url: `http://127.0.0.1:${server.address().port}/mcp`, close: () => server.close() };
}

test("Dhan via a hosted MCP server: OAuth consent (PKCE), account headers, holdings, trading tools blocked", async () => {
  const srv = await fakeOAuthServer();
  try {
    const { mcp } = await setup({ DHAN_CLIENT_ID: "1100", DHAN_ACCESS_TOKEN: "dhan-token-abc" });
    assert.equal((await mcp.dhan.status()).configured, false);
    await assert.rejects(mcp.dhan.setConfig({ url: "http://example.com/mcp" }), /https/);
    await mcp.dhan.setConfig({ via: "mcp", url: srv.url.replace("127.0.0.1", "localhost") });
    let s = await mcp.dhan.status();
    assert.equal(s.connected, false); assert.equal(s.authRequired, true);
    const { authUrl } = await mcp.dhan.connect();
    assert.equal(new URL(authUrl).searchParams.get("code_challenge_method"), "S256");
    assert.deepEqual(srv.st.registered[0].redirect_uris, ["http://localhost:4173/api/brokers/mcp/callback"]);
    // The user approves on the broker's page, which redirects back with code + state.
    const r = await fetch(authUrl, { redirect: "manual" }); const back = new URL(r.headers.get("location"));
    assert.ok(mcp.dhan.ownsState(back.searchParams.get("state")));
    await assert.rejects(mcp.dhan.finishOAuth({ code: back.searchParams.get("code"), state: "forged" }), /stale/);
    await mcp.dhan.finishOAuth({ code: back.searchParams.get("code"), state: back.searchParams.get("state") });
    s = await mcp.dhan.status();
    assert.equal(s.connected, true); assert.equal(s.profile.userId, "1100");
    assert.deepEqual(s.tools.blocked.sort(), ["modify_super_order", "place_order"]); assert.equal(s.tools.holdings, "get_holdings");
    const { holdings } = await mcp.dhan.holdings();
    assert.deepEqual(holdings.map(h => [h.symbol, h.qty, h.invested]), [["HDFCBANK", 5, 7500]]);
    const last = srv.st.headers.at(-1);
    assert.equal(last["access-token"], "dhan-token-abc"); assert.equal(last["client-id"], "1100"); assert.equal(last["mcp-session-id"], "sess-1");
    assert.ok(!srv.st.calls.some(c => /order/.test(c)), "no trading tool was ever called");
    await mcp.dhan.disconnect();
    assert.equal((await mcp.dhan.status()).authRequired, true);
  } finally { srv.close(); }
});

test("Angel One via a local (stdio) MCP server: saved account details become its env, its login tool runs first", async () => {
  const cmd = `"${process.execPath}" "${path.join(here, "fixtures", "fake-stdio-mcp.mjs")}"`;
  const { mcp, brokers } = await setup({ ANGEL_MCP_COMMAND: cmd });
  await brokers.angel.saveSettings({ values: { apiKey: "akey", clientCode: "a777", pin: "1234", totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" } });
  await mcp.angel.setConfig({ via: "mcp" });
  assert.equal(mcp.angel.config().transport, "stdio");
  assert.equal((await mcp.angel.status()).connected, true, "a local server logs in by itself with the saved details");
  const { holdings, priceNote } = await mcp.angel.holdings(); // "not logged in" -> login tool -> retry
  assert.deepEqual(holdings.map(h => [h.symbol, h.qty, h.value]), [["ITC", 20, 9000]]); assert.equal(priceNote, null);
  assert.deepEqual(await mcp.angel.profile(), { userId: "A777", name: "Stdio User" });
  const s = await mcp.angel.status();
  assert.equal(s.connected, true); assert.deepEqual(s.tools.blocked.sort(), ["gtt_create_rule", "place_order"]);
  await mcp.angel.disconnect();
});

test("a server with its own login link (Kite-style) hands the link back", async () => {
  let loggedIn = false;
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c; const msg = JSON.parse(body);
    const json = (obj, h = {}) => { res.writeHead(200, { "Content-Type": "application/json", ...h }); res.end(JSON.stringify(obj)); };
    if (msg.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (msg.method === "initialize") return json({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {} } }, { "Mcp-Session-Id": "s" });
    if (msg.method === "tools/list") return json({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "login" }, { name: "get_profile" }, { name: "get_holdings" }] } });
    const t = (x, isError) => json({ jsonrpc: "2.0", id: msg.id, result: { isError, content: [{ type: "text", text: x }] } });
    if (msg.params.name === "login") { loggedIn = true; return t("Open https://login.example-broker.in/connect?id=1\\u0026v=2 to sign in"); }
    return loggedIn ? t(JSON.stringify({ clientcode: "Z1" })) : t("Please log in first", true);
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  try {
    const { mcp } = await setup({});
    await mcp.angel.setConfig({ via: "mcp", url: `http://localhost:${server.address().port}/mcp` });
    assert.deepEqual(await mcp.angel.connect(), { loginUrl: "https://login.example-broker.in/connect?id=1&v=2" });
  } finally { server.close(); }
});

test("read-only guard, tool picking and normalisers", () => {
  for (const n of ["get_holdings", "get_all_holdings", "get_profile", "fetch_portfolio", "get_ltp", "login", "get_fund_limits", "search_instruments"]) assert.equal(isReadOnlyTool(n), true, n);
  for (const n of ["place_order", "modify_order", "cancel_order", "get_order_book", "gtt_create_rule", "convert_position", "exit_all", "get_margin", "create_alert", "logout", "sell_holding", "transfer_funds", "kill_switch", "execute_trade"]) assert.equal(isReadOnlyTool(n), false, n);
  const tools = ["place_order", "get_holdings_summary", "get_all_holdings", "get_user_profile"].map(name => ({ name, allowed: isReadOnlyTool(name) }));
  assert.equal(pickTool(tools, "holdings"), "get_all_holdings"); assert.equal(pickTool(tools, "profile"), "get_user_profile"); assert.equal(pickTool(tools, "login"), null);
  assert.deepEqual(normalizeMcpHoldings({ data: [{ tradingsymbol: "INFY", quantity: 10, t1_quantity: 2, average_price: 1500, last_price: 1600 }] }).map(h => [h.symbol, h.qty, h.value]), [["INFY", 12, 19200]]);
  assert.deepEqual(normalizeMcpHoldings({ payload: { holdings: [{ trading_symbol: "TCS", quantity: 3, average_price: 3000 }] } }).map(h => [h.symbol, h.qty, h.lastPrice]), [["TCS", 3, null]]);
  assert.throws(() => normalizeMcpHoldings("RELIANCE 10 shares"), /recognise/);
  assert.deepEqual(normalizeMcpProfile({ status: true, data: { clientcode: "A1", name: "X" } }), { userId: "A1", name: "X" });
  assert.deepEqual(splitCommand(`"C:\\Program Files\\node.exe" -m pkg 'a b' ""`), ["C:\\Program Files\\node.exe", "-m", "pkg", "a b", ""]);
});

// ---- INDmoney MCP ----
import { normalizeIndmoneyPositions, DEFAULT_MCP_URLS } from "../broker-mcp.mjs";
test("INDmoney MCP: read tools allowed by name, holdings tool picked, built-in URL", async () => {
  const { isReadOnlyTool: ro, pickTool: pick } = await import("../broker-mcp.mjs");
  assert.equal(ro("networth_holdings", "indmoney"), true);
  assert.equal(ro("networth_holdings"), false, "only for INDmoney");
  assert.equal(ro("place_order", "indmoney"), false);
  assert.equal(pick([{ name: "lookup_ind_keys" }, { name: "networth_snapshot" }, { name: "networth_holdings" }], "holdings", "indmoney"), "networth_holdings");
  assert.equal(DEFAULT_MCP_URLS.indmoney, "https://mcp.indmoney.com/mcp");
});
test("INDmoney positions are split into Indian stocks, mutual funds, US stocks and others from any nesting", () => {
  const sample = { data: { asset_classes: [
    { asset_class: "Indian Stocks", holdings: [{ name: "Indian Oil Corporation Ltd", symbol: "IOC", isin: "INE242A01010", quantity: 100, avg_price: 120, ltp: 150, current_value: 15000, invested_value: 12000 }, { name: "Polycab India Ltd", quantity: 2, average_price: 5000, current_price: 7000 }] },
    { asset_class: "Mutual Funds", holdings: [{ scheme_name: "Helios Flexi Cap Fund Direct Growth", isin: "INF0R8F01034", folio_number: "9182/11", units: 1000, avg_nav: 11, nav: 14, current_value: 14000, invested_value: 11000, xirr: 18.2 }] },
    { asset_class: "US Stocks", holdings: [{ name: "Apple Inc", ticker: "AAPL", quantity: 3, current_value: 57000, invested_value: 45000 }] },
    { asset_class: "EPF", holdings: [{ name: "EPF - Acme", current_value: 900000 }] }] } };
  const p = normalizeIndmoneyPositions(sample);
  assert.deepEqual(p.stocks.map(x => [x.symbol, x.qty, x.value]), [["IOC", 100, 15000], [null, 2, 14000]]);
  assert.equal(p.mf[0].isin, "INF0R8F01034"); assert.equal(p.mf[0].folio, "9182/11"); assert.equal(p.mf[0].pnl, 3000);
  assert.equal(p.us[0].symbol, "AAPL"); assert.equal(p.us[0].value, 57000);
  assert.equal(p.other[0].value, 900000);
  // grouped by key name instead of a class field
  const q = normalizeIndmoneyPositions({ mutual_funds: [{ fund_name: "X Fund", units: 10, current_value: 500 }], indian_stocks: [{ stock_name: "TCS", nse_symbol: "TCS", qty: 1, current_value: 3000 }] });
  assert.equal(q.mf.length, 1); assert.ok(q.mf[0].isin.startsWith("NAME:")); assert.equal(q.stocks[0].symbol, "TCS");
});

test("INDmoney via its hosted MCP server: OAuth consent, no API key, positions split, write tools never callable", async () => {
  const seenArgs = [];
  const srv = await fakeOAuthServer({ tools: ["lookup_ind_keys", "networth_snapshot", { name: "networth_holdings", inputSchema: { type: "object", required: ["asset_type"], properties: { asset_type: { $ref: "#/$defs/AssetType" } }, $defs: { AssetType: { enum: ["INDIAN_STOCKS", "MUTUAL_FUNDS", "US_STOCKS", "ALL"] } } } }, "networth_allocation_breakdown", "mf_sips", "place_order"], answer: (name, args) => {
    if (name !== "networth_holdings") return {};
    seenArgs.push(args);
    if (!args.asset_type) return { isError: "asset_type Field required" };
    if (args.asset_type === "INDIAN_STOCKS") return { data: [{ name: "Indian Oil Corporation Ltd", symbol: "IOC", quantity: 100, avg_price: 120, ltp: 150 }] };
    // a fund whose category says "Equity" must still count as a mutual fund
    if (args.asset_type === "MUTUAL_FUNDS") return { data: [{ scheme_name: "Helios Flexi Cap Fund", category: "Equity", isin: "INF0R8F01034", units: 1000, avg_nav: 11, nav: 14, current_value: 14000 }] };
    if (args.asset_type === "US_STOCKS") return { data: [{ name: "Apple Inc", ticker: "AAPL", quantity: 3, current_value: 57000 }] };
    return { data: [] };
  } });
  try {
    const { mcp } = await setup({});
    assert.equal(mcp.indmoney.config().url, "https://mcp.indmoney.com/mcp", "official server built in");
    await mcp.indmoney.setConfig({ via: "mcp", url: srv.url.replace("127.0.0.1", "localhost") });
    const { authUrl } = await mcp.indmoney.connect();
    const back = new URL((await fetch(authUrl, { redirect: "manual" })).headers.get("location"));
    await mcp.indmoney.finishOAuth({ code: back.searchParams.get("code"), state: back.searchParams.get("state") });
    const s = await mcp.indmoney.status();
    assert.equal(s.connected, true); assert.deepEqual(s.tools.blocked, ["place_order"]); assert.equal(s.tools.holdings, "networth_holdings");
    assert.deepEqual(await mcp.indmoney.profile(), { userId: "INDMONEY", name: "INDmoney" });
    const h = await mcp.indmoney.holdings();
    assert.deepEqual(h.holdings.map(x => [x.symbol, x.qty]), [["IOC", 100]]);
    assert.equal(h.mf[0].isin, "INF0R8F01034"); assert.equal(h.us[0].symbol, "AAPL");
    const pv = await mcp.indmoney.preview(); assert.deepEqual(pv.counts, { indianStocks: 1, mutualFunds: 1, usStocks: 1, other: 0 });
    assert.ok(!srv.st.calls.includes("place_order"));
    assert.deepEqual([...new Set(seenArgs.map(x => x.asset_type))].sort(), ["INDIAN_STOCKS", "MUTUAL_FUNDS", "US_STOCKS"], "one call per type; ALL skipped");
  } finally { srv.close(); }
});
