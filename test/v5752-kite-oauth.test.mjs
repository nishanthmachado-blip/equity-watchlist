import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKiteClient } from "../kite-mcp.mjs";

// A fake Kite MCP server that behaves like the hosted one now does: every /mcp call without a valid bearer token gets
// HTTP 401 "no bearer token" (with a WWW-Authenticate pointing at the OAuth metadata), plus the OAuth endpoints
// (protected-resource + authorization-server metadata, dynamic client registration, PKCE token exchange, refresh).
async function fakeOAuthKite({ discovery = true } = {}) {
  const st = { tokens: new Set(), refresh: new Map(), codes: new Map(), clients: [], mcp: [], sessions: new Set(), registrations: 0 };
  let origin = "";
  const json = (res, status, obj, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(obj)); };
  const server = http.createServer(async (req, res) => {
    let body = ""; for await (const c of req) body += c;
    const u = new URL(req.url, origin);
    if (u.pathname.startsWith("/.well-known/oauth-protected-resource")) return discovery ? json(res, 200, { resource: `${origin}/mcp`, authorization_servers: [origin] }) : json(res, 404, {});
    if (u.pathname.startsWith("/.well-known/oauth-authorization-server")) return discovery ? json(res, 200, { issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, registration_endpoint: `${origin}/register` }) : json(res, 404, {});
    if (u.pathname === "/.well-known/openid-configuration") return json(res, 404, {});
    if (u.pathname === "/register") { st.registrations++; const j = JSON.parse(body); st.clients.push(j); return json(res, 201, { client_id: `client-${st.registrations}` }); }
    if (u.pathname === "/token") {
      const f = new URLSearchParams(body);
      if (f.get("grant_type") === "authorization_code") {
        const c = st.codes.get(f.get("code"));
        if (!c || crypto.createHash("sha256").update(f.get("code_verifier") || "").digest("base64url") !== c.challenge) return json(res, 400, { error: "invalid_grant" });
        const access = `at-${st.tokens.size + 1}`, refresh = `rt-${st.refresh.size + 1}`; st.tokens.add(access); st.refresh.set(refresh, true);
        return json(res, 200, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: "Bearer" });
      }
      if (f.get("grant_type") === "refresh_token" && st.refresh.has(f.get("refresh_token"))) { const access = `at-${st.tokens.size + 1}`; st.tokens.add(access); return json(res, 200, { access_token: access, expires_in: 3600, token_type: "Bearer" }); }
      return json(res, 400, { error: "invalid_grant" });
    }
    if (u.pathname !== "/mcp") return json(res, 404, {});
    const auth = req.headers.authorization || ""; st.mcp.push({ auth, body });
    if (!auth.startsWith("Bearer ") || !st.tokens.has(auth.slice(7))) { res.writeHead(401, { "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"` }); return res.end("no bearer token"); }
    const msg = JSON.parse(body);
    if (msg.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
    if (msg.method === "initialize") { const id = `s${st.sessions.size + 1}`; st.sessions.add(id); return json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake" } } }, { "Mcp-Session-Id": id }); }
    const { name } = msg.params || {}, text = t => json(res, 200, { jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t) }] } });
    if (name === "get_profile") return text({ user_id: "AB1234", user_name: "Test User" });
    if (name === "get_holdings") return text([{ tradingsymbol: "INFY", exchange: "NSE", quantity: 10, average_price: 1500, last_price: 1600, pnl: 1000 }]);
    return text("{}");
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  origin = `http://127.0.0.1:${server.address().port}`;
  // What the browser does on Zerodha's page: the user approves and the server hands back a code bound to the PKCE challenge.
  const approve = authUrl => { const q = new URL(authUrl).searchParams, code = `code-${st.codes.size + 1}`; st.codes.set(code, { challenge: q.get("code_challenge") }); return { code, state: q.get("state"), q }; };
  return { st, origin, url: `${origin}/mcp`, approve, close: () => server.close() };
}
const REDIRECT = "http://localhost:4173/api/kite/callback";
const mk = async name => { const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kite-oauth-")); return { dir, sessionFile: path.join(dir, name || "kite-session.json") }; };

test("401 'no bearer token' → Log in returns an OAuth URL → callback → connected, token on every call", async () => {
  const srv = await fakeOAuthKite(), { dir, sessionFile } = await mk();
  const k = createKiteClient({ url: srv.url, enabled: true, sessionFile });
  try {
    assert.deepEqual(await k.status(), { enabled: true, url: srv.url, connected: false, loginRequired: true, error: null });
    const x = await k.login({ redirectUri: REDIRECT });
    assert.equal(x.oauth, true);
    const { code, state, q } = srv.approve(x.loginUrl);
    assert.equal(q.get("client_id"), "client-1"); assert.equal(q.get("redirect_uri"), REDIRECT); assert.equal(q.get("code_challenge_method"), "S256"); assert.equal(q.get("response_type"), "code");
    assert.equal(srv.st.clients[0].redirect_uris[0], REDIRECT, "the app registers its own return URL");
    assert.equal(await k.ownsState(state), true); assert.equal(await k.ownsState("someone-else"), false);
    await assert.rejects(k.finishOAuth({ code, state: "stale" }), /stale|not started here/);
    await k.finishOAuth({ code, state });
    const s = await k.status(); assert.equal(s.connected, true); assert.equal(s.profile.userId, "AB1234");
    assert.equal((await k.holdings())[0].symbol, "INFY");
    const after = srv.st.mcp.slice(srv.st.mcp.findIndex(m => m.auth.startsWith("Bearer ")));
    assert.ok(after.length >= 4 && after.every(m => m.auth.startsWith("Bearer at-")), "every call after the sign-in carries the token");
    assert.equal((await fs.stat(path.join(dir, "kite-oauth.json"))).isFile(), true, "token is kept next to the session file");
    // a restart keeps the login (token + session on disk)
    const k2 = createKiteClient({ url: srv.url, enabled: true, sessionFile });
    assert.equal((await k2.status()).connected, true);
    // Disconnect forgets the token: back to "not logged in"
    await k.forget();
    assert.equal(JSON.parse(await fs.readFile(path.join(dir, "kite-oauth.json"), "utf8")).tokens, null);
    const k3 = createKiteClient({ url: srv.url, enabled: true, sessionFile });
    assert.deepEqual(await k3.status(), { enabled: true, url: srv.url, connected: false, loginRequired: true, error: null });
  } finally { srv.close(); }
});

test("each Zerodha slot keeps its own OAuth file; a second login reuses the registered client", async () => {
  const srv = await fakeOAuthKite(), { dir, sessionFile } = await mk("kite-session-acct1.json");
  const k = createKiteClient({ url: srv.url, enabled: true, sessionFile });
  try {
    const a = srv.approve((await k.login({ redirectUri: REDIRECT })).loginUrl); await k.finishOAuth({ code: a.code, state: a.state });
    assert.equal((await k.status()).connected, true);
    assert.deepEqual((await fs.readdir(dir)).filter(n => n.startsWith("kite-oauth")), ["kite-oauth-acct1.json"]);
    // the token is rejected (revoked): Kite answers 401 again → status says log in; a new Log in does not register a new client
    srv.st.tokens.clear();
    assert.equal((await k.status()).loginRequired, true);
    const b = srv.approve((await k.login({ redirectUri: REDIRECT })).loginUrl); await k.finishOAuth({ code: b.code, state: b.state });
    assert.equal(srv.st.registrations, 1);
    assert.equal((await k.status()).connected, true);
  } finally { srv.close(); }
});

test("an expired access token is refreshed with the refresh token", async () => {
  const srv = await fakeOAuthKite(), { dir, sessionFile } = await mk();
  const k = createKiteClient({ url: srv.url, enabled: true, sessionFile });
  try {
    const a = srv.approve((await k.login({ redirectUri: REDIRECT })).loginUrl); await k.finishOAuth({ code: a.code, state: a.state });
    const f = path.join(dir, "kite-oauth.json"), st = JSON.parse(await fs.readFile(f, "utf8")); st.tokens.expiresAt = Date.now() - 1000; await fs.writeFile(f, JSON.stringify(st));
    const k2 = createKiteClient({ url: srv.url, enabled: true, sessionFile });
    assert.equal((await k2.status()).connected, true);
    assert.notEqual(JSON.parse(await fs.readFile(f, "utf8")).tokens.accessToken, st.tokens.accessToken, "a new access token was saved");
  } finally { srv.close(); }
});

test("OAuth details missing on the server → a clear message that mentions self-hosting; no return URL → plain login-required error", async () => {
  const srv = await fakeOAuthKite({ discovery: false }), { sessionFile } = await mk();
  const k = createKiteClient({ url: srv.url, enabled: true, sessionFile });
  try {
    await assert.rejects(k.login({ redirectUri: REDIRECT }), e => /no OAuth details|self-host/i.test(e.message) && /KITE_MCP_URL/.test(e.message));
    await assert.rejects(k.login(), e => e.loginRequired === true && e.authRequired === true && /401/.test(e.message));
    const d = await k.diagnose(); assert.match(d.steps[0].detail, /OAuth/);
  } finally { srv.close(); }
});

test("the OAuth file is treated as a secret (excluded from backups and sharing)", async () => {
  const { SECRET_FILE_RE } = await import("../secrets.mjs");
  for (const n of ["kite-oauth.json", "kite-oauth-acct1abc.json", "kite-session.json"]) assert.ok(SECRET_FILE_RE.test(n), n);
});
