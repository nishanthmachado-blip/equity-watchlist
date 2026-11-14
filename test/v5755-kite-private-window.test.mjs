import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Two Zerodha accounts (mine and my wife's): Zerodha's sign-in page reuses the account the browser is logged in to, so the
// second card's sign-in is done in a private window. That window has no app session, so /api/kite/callback must finish
// the login for the card that started it, found by the OAuth state alone.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

test("a second Zerodha card signs in through a private window (no app cookie on the return)", async () => {
  const tokens = new Map(), codes = new Map(); let origin = "";
  const json = (res, status, obj, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
  const kite = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c; const u = new URL(req.url, origin);
    if (u.pathname.startsWith("/.well-known/oauth-protected-resource")) return json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] });
    if (u.pathname.startsWith("/.well-known/oauth-authorization-server")) return json(res, 200, { authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` });
    if (u.pathname === "/register") return json(res, 201, { client_id: "c1" });
    if (u.pathname === "/token") { const f = new URLSearchParams(body), c = codes.get(f.get("code")); if (!c || crypto.createHash("sha256").update(f.get("code_verifier") || "").digest("base64url") !== c.challenge) return json(res, 400, { error: "invalid_grant" }); const t = `at-${tokens.size + 1}`; tokens.set(t, c.who); return json(res, 200, { access_token: t, expires_in: 3600 }); }
    if (u.pathname !== "/mcp") return json(res, 404, {});
    const who = tokens.get((req.headers.authorization || "").slice(7));
    if (!who) { res.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` }); return res.end("no bearer token"); }
    const msg = JSON.parse(body);
    if (msg.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (msg.method === "initialize") return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18" } }, { "Mcp-Session-Id": `s-${who}` });
    const en = values => ({ type: "object", properties: { mode: { type: "string", enum: values } } });
    if (msg.method === "tools/list") return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "session", inputSchema: en(["profile"]) }, { name: "portfolio", inputSchema: en(["holdings"]) }, { name: "mutual_funds", inputSchema: en(["holdings"]) }] } });
    const { name } = msg.params, text = t => json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: JSON.stringify(t) }] } });
    if (name === "session") return text({ user_id: who, user_name: who === "ME0001" ? "Me" : "Wife" });
    if (name === "portfolio") return text([{ tradingsymbol: who === "ME0001" ? "INFY" : "TCS", exchange: "NSE", quantity: 10, average_price: 100, last_price: 110, pnl: 100 }]);
    return text([]);
  });
  await new Promise(r => kite.listen(0, "127.0.0.1", r)); origin = `http://127.0.0.1:${kite.address().port}`;
  // what Zerodha's page does once someone signs in there
  const approve = (authUrl, who) => { const q = new URL(authUrl).searchParams, code = `code-${codes.size + 1}`; codes.set(code, { challenge: q.get("code_challenge"), who }); return `/api/kite/callback?code=${code}&state=${q.get("state")}`; };
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-kpriv-")), port = await freePort(), base = `http://127.0.0.1:${port}`, dead = "http://127.0.0.1:9";
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c5755", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "1", KITE_MCP_URL: `${origin}/mcp`, EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: dead, YAHOO_BASE: dead, MFAPI_BASE: dead, AMFI_NAV_URL: `${dead}/nav` }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  try {
    for (let i = 0; i < 100 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(log.includes("running at"), log);
    const post = (p, body, cookie) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body || {}) });
    const setup = await post("/api/auth/setup", { code: "c5755", username: "kpriv", name: "K", password: "kpriv-pass-phrase-1" });
    const cookie = (setup.headers.get("set-cookie") || "").split(";")[0], get = async p => (await fetch(base + p, { headers: { Cookie: cookie } })).json();

    // card 1: normal window (the app cookie rides along)
    const l1 = await (await post("/api/kite/login?slot=main", {}, cookie)).json(); assert.equal(l1.oauth, true);
    const c1 = await fetch(base + approve(l1.loginUrl, "ME0001"), { headers: { Cookie: cookie } }); assert.equal(c1.status, 200); assert.match(await c1.text(), /Connected for &quot;Account 1&quot;|connected for "Account 1"/i);
    // card 2: private window → no cookie on the return
    const add = await (await post("/api/kite/slots/add", { label: "Zerodha - Wife" }, cookie)).json();
    const l2 = await (await post(`/api/kite/login?slot=${add.id}`, {}, cookie)).json(); assert.equal(l2.oauth, true);
    const ret = approve(l2.loginUrl, "WF0002");
    const c2 = await fetch(base + ret); assert.equal(c2.status, 200); assert.match(await c2.text(), /Zerodha - Wife/);
    const again = await fetch(base + ret); assert.equal(again.status, 400, "the return link works once");

    const slots = (await get("/api/kite/slots")).slots;
    assert.deepEqual(slots.map(s => [s.label, s.connected, s.profile?.userId]), [["Account 1", true, "ME0001"], ["Zerodha - Wife", true, "WF0002"]]);
    await post("/api/kite/sync?slot=main", {}, cookie);
    const v = await (await post(`/api/kite/sync?slot=${add.id}`, {}, cookie)).json();
    assert.deepEqual(v.accounts.map(a => a.userId).sort(), ["ME0001", "WF0002"]); assert.deepEqual(v.holdings.map(h => h.symbol).sort(), ["INFY", "TCS"]);
  } finally { child.kill(); kite.close(); await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {}); }
});
