import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Sync holdings against a server like Zerodha's hosted one today: grouped tools with a "mode" argument, and a session
// reply that does not name the user. v5.75.3 answered 502 "Kite did not return a user id"; the sync must go through.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const en = values => ({ type: "object", properties: { mode: { type: "string", enum: values } }, required: ["mode"] });

test("Sync holdings works when the Kite server does not say who is logged in; a second sync replaces, never doubles", async () => {
  const calls = [], variant = new Map(); let login = "A", inits = 0; // which Zerodha login a new session lands on
  const kite = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c; const msg = JSON.parse(body);
    const send = (obj, headers = {}) => { res.writeHead(200, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
    if (msg.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (msg.method === "initialize") { const sid = `s${++inits}`; variant.set(sid, login); return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }, { "Mcp-Session-Id": sid }); }
    if (!variant.has(req.headers["mcp-session-id"])) { res.writeHead(404); return res.end("no such session"); }
    const who = variant.get(req.headers["mcp-session-id"]);
    if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "session", inputSchema: en(["status", "logout"]) }, { name: "portfolio", inputSchema: en(["holdings", "positions", "margins"]) }, { name: "mutual_funds", inputSchema: en(["holdings", "orders"]) }, { name: "market", inputSchema: en(["quote", "ltp", "historical"]) }, { name: "orders", inputSchema: en(["list", "trades", "place"]) }, { name: "gtt", inputSchema: en(["get", "create"]) }, { name: "alerts", inputSchema: en(["get", "create"]) }, { name: "help" }] } });
    const { name, arguments: a } = msg.params; calls.push(`${name}:${a.mode}`);
    const text = t => send({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(t) }] } });
    if (name === "session") return text({ authenticated: true, expires_in: 3600 });
    if (name === "portfolio" && a.mode === "holdings") return text({ data: [{ tradingsymbol: who === "A" ? "INFY" : "TCS", exchange: "NSE", isin: "INE009A01021", quantity: 10, t1_quantity: 0, average_price: 1500, last_price: 1600, pnl: 1000 }] });
    if (name === "mutual_funds" && a.mode === "holdings") return text({ data: [{ folio: "123", fund: "Some Fund Direct Growth", tradingsymbol: "INF000A01010", quantity: 100, average_price: 50, last_price: 60, pnl: 1000 }] });
    return text({});
  });
  await new Promise(r => kite.listen(0, "127.0.0.1", r));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-ksync-")), port = await freePort(), base = `http://127.0.0.1:${port}`, dead = "http://127.0.0.1:9";
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c5754", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "1", KITE_MCP_URL: `http://127.0.0.1:${kite.address().port}/mcp`, EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: dead, YAHOO_BASE: dead, MFAPI_BASE: dead, AMFI_NAV_URL: `${dead}/nav` }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  try {
    for (let i = 0; i < 100 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(log.includes("running at"), log);
    const post = (p, body, cookie) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body || {}) });
    const setup = await post("/api/auth/setup", { code: "c5754", username: "ksync", name: "K", password: "ksync-pass-phrase-1" }); assert.equal(setup.status, 200);
    const cookie = (setup.headers.get("set-cookie") || "").split(";")[0], get = async p => (await fetch(base + p, { headers: { Cookie: cookie } })).json();

    const slots = await get("/api/kite/slots"); assert.equal(slots.slots[0].connected, true); assert.equal(slots.slots[0].profile, null);
    const r1 = await post("/api/kite/sync?slot=main", { label: "Zerodha - Me" }, cookie), v1 = await r1.json();
    assert.equal(r1.status, 200, JSON.stringify(v1));
    assert.deepEqual(v1.accounts.map(a => [a.userId, a.label, a.count]), [["ZERODHA-1", "Zerodha - Me", 1]]);
    assert.equal(v1.holdings[0].symbol, "INFY"); assert.equal(v1.mfSynced, 1);
    const v2 = await (await post("/api/kite/sync?slot=main", {}, cookie)).json();
    assert.equal(v2.accounts.length, 1, "the same account is replaced"); assert.equal(v2.holdings[0].qty, 10);
    assert.ok(!calls.some(c => /^(gtt|alerts):|:(place|create|logout)$/.test(c)), calls.join(","));

    // an account synced on this slot before the change keeps its real Zerodha id (no second copy of the holdings)
    const users = await fs.readdir(path.join(dataDir, "users")), file = path.join(dataDir, "users", users[0], "kite-holdings.json");
    const st = JSON.parse(await fs.readFile(file, "utf8")); st.accounts = { AB1234: { ...st.accounts["ZERODHA-1"], clientId: "AB1234", slot: "main" } }; await fs.writeFile(file, JSON.stringify(st));
    const v3 = await (await post("/api/kite/sync?slot=main", {}, cookie)).json();
    assert.deepEqual(v3.accounts.map(a => a.userId), ["AB1234"]);

    // v5.75.6: a second card on a different Zerodha login syncs next to the first
    login = "B";
    const add = await (await post("/api/kite/slots/add", { label: "Zerodha - Wife" }, cookie)).json(), wife = `ZERODHA-${add.id}`.toUpperCase();
    const v4 = await (await post(`/api/kite/sync?slot=${add.id}`, {}, cookie)).json();
    assert.deepEqual(v4.accounts.map(a => a.userId).sort(), ["AB1234", wife]); assert.deepEqual(v4.holdings.map(h => h.symbol).sort(), ["INFY", "TCS"]);
    // both cards on the same login right now: neither syncs, and the message names the other card
    login = "A"; await post(`/api/kite/disconnect?slot=${add.id}`, {}, cookie);
    const r5 = await post(`/api/kite/sync?slot=${add.id}`, {}, cookie); assert.equal(r5.status, 502); assert.match((await r5.json()).message, /This card and "Account 1" are signed in to the same Zerodha account.*private \(incognito\) window/);
    const r6 = await post("/api/kite/sync?slot=main", {}, cookie); assert.equal(r6.status, 502); assert.match((await r6.json()).message, /"Zerodha - Wife"/);
    // older data must not block: the wife's card holds a stale copy of my holdings (synced while it was on my login), but it
    // is on her login now → my card syncs, and the stale copy is dropped instead of being counted twice
    login = "B"; await post(`/api/kite/disconnect?slot=${add.id}`, {}, cookie);
    const st2 = JSON.parse(await fs.readFile(file, "utf8")); st2.accounts[wife] = { ...st2.accounts.AB1234, clientId: wife, slot: add.id, label: "Account 2" }; await fs.writeFile(file, JSON.stringify(st2));
    const r7 = await post("/api/kite/sync?slot=main", {}, cookie), v7 = await r7.json(); assert.equal(r7.status, 200, JSON.stringify(v7));
    assert.deepEqual(v7.accounts.map(a => a.userId), ["AB1234"]);
    const v8 = await (await post(`/api/kite/sync?slot=${add.id}`, {}, cookie)).json();
    assert.deepEqual(v8.accounts.map(a => a.userId).sort(), ["AB1234", wife]); assert.deepEqual(v8.holdings.map(h => h.symbol).sort(), ["INFY", "TCS"]);
    // the OAuth return page answers without an app session (private window); an unknown state is refused politely
    const cb = await fetch(`${base}/api/kite/callback?code=x&state=nope`); assert.equal(cb.status, 400); assert.match(await cb.text(), /stale or was not started from this app/);
    assert.equal((await fetch(`${base}/api/kite/slots`)).status, 401, "everything else still needs a sign-in");
  } finally { child.kill(); kite.close(); await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {}); }
});
