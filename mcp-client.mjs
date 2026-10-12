// A small, dependency-free MCP client for any broker's MCP server (used for Angel One and Dhan; Zerodha keeps its own
// tested client in kite-mcp.mjs). Two transports:
//   - "http":  Streamable HTTP (JSON or SSE replies), with the standard MCP OAuth login (discovery, dynamic client
//              registration, PKCE, refresh) when the server answers 401, and extra headers for servers that take an
//              access token instead.
//   - "stdio": a local server process started from a command (newline-delimited JSON-RPC on stdin/stdout).
// The caller decides which tools may run (`isAllowed`); a refused tool never reaches the server.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { parseRpcBody, toolText, looseJson } from "./kite-mcp.mjs";

const PROTOCOL = "2025-06-18";
export class McpError extends Error {
  constructor(message, { authRequired = false, loginRequired = false, network = false, wwwAuthenticate = null } = {}) { super(message); Object.assign(this, { authRequired, loginRequired, network, wwwAuthenticate }); }
}
export const LOGIN_HINT = /(please\s+)?log\s?in\b|login (is )?required|not (logged in|authenticated)|unauthori[sz]ed|session (has )?(expired|invalid)|invalid (session|access token)|token (is )?(expired|invalid|missing)|authenticat/i;

// "python -m pkg.server --x 'a b'" -> ["python", "-m", "pkg.server", "--x", "a b"]
export function splitCommand(cmd) {
  const out = []; let cur = "", q = null, any = false;
  for (const ch of String(cmd || "").trim()) {
    if (q) { if (ch === q) q = null; else cur += ch; }
    else if (ch === '"' || ch === "'") { q = ch; any = true; }
    else if (/\s/.test(ch)) { if (cur || any) out.push(cur); cur = ""; any = false; }
    else cur += ch;
  }
  if (cur || any) out.push(cur);
  return out;
}
const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function pkcePair() { const verifier = b64url(crypto.randomBytes(32)); return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()) }; }

// ---- OAuth (MCP authorization spec) ------------------------------------------------------------------
// `store` is { get(): object|null, set(obj|null): Promise } holding { clientId, clientSecret, redirectUri, meta, resource, tokens, pending }.
export function createOAuth({ mcpUrl, store, fetchImpl = fetch, clientName = "Equity Watchlist (read-only)", now = () => Date.now(), timeoutMs = 15000 }) {
  const getJson = async (u, opts = {}) => {
    const r = await fetchImpl(u, { ...opts, headers: { Accept: "application/json", ...(opts.headers || {}) }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch { /* not JSON */ }
    return { ok: r.ok, status: r.status, json: j, text };
  };
  async function discover(wwwAuthenticate) {
    const u = new URL(mcpUrl), path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    const hinted = /resource_metadata="?([^",\s]+)"?/i.exec(wwwAuthenticate || "")?.[1];
    let prm = null;
    for (const c of [hinted, `${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`].filter(Boolean)) {
      try { const r = await getJson(c); if (r.ok && r.json?.authorization_servers?.length) { prm = r.json; break; } } catch { /* try next */ }
    }
    const as = new URL(prm?.authorization_servers?.[0] || u.origin), asPath = as.pathname === "/" ? "" : as.pathname.replace(/\/$/, "");
    for (const c of [`${as.origin}/.well-known/oauth-authorization-server${asPath}`, `${as.origin}/.well-known/openid-configuration${asPath}`, `${as.origin}${asPath}/.well-known/openid-configuration`]) {
      try { const r = await getJson(c); if (r.ok && r.json?.authorization_endpoint && r.json?.token_endpoint) return { meta: r.json, resource: prm?.resource || mcpUrl, scopes: prm?.scopes_supported || null }; } catch { /* try next */ }
    }
    throw new McpError(`The MCP server asked for a login, but no OAuth details were found at ${u.origin}/.well-known/… . Use the broker's access-token option instead.`);
  }
  async function start({ redirectUri, wwwAuthenticate }) {
    const st = store.get() || {};
    let { meta, resource, scopes } = st.meta && st.mcpUrl === mcpUrl ? st : await discover(wwwAuthenticate);
    let clientId = st.mcpUrl === mcpUrl && st.redirectUri === redirectUri ? st.clientId : null, clientSecret = clientId ? st.clientSecret : null;
    if (!clientId) {
      if (!meta.registration_endpoint) throw new McpError("The MCP server's login does not allow apps to register themselves (no registration endpoint). Use the broker's access-token option instead.");
      const r = await getJson(meta.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_name: clientName, redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) });
      if (!r.ok || !r.json?.client_id) throw new McpError(`Client registration failed (HTTP ${r.status}): ${r.text.slice(0, 160)}`);
      clientId = r.json.client_id; clientSecret = r.json.client_secret || null;
    }
    const { verifier, challenge } = pkcePair(), state = b64url(crypto.randomBytes(16));
    const auth = new URL(meta.authorization_endpoint);
    const params = { response_type: "code", client_id: clientId, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", state, resource };
    if (scopes?.length) params.scope = scopes.join(" ");
    for (const [k, v] of Object.entries(params)) auth.searchParams.set(k, v);
    await store.set({ ...st, mcpUrl, meta, resource, scopes, clientId, clientSecret, redirectUri, pending: { state, verifier, createdAt: now() } });
    return { authUrl: auth.toString(), state };
  }
  async function tokenRequest(form) {
    const st = store.get(); const body = new URLSearchParams({ ...form, client_id: st.clientId, ...(st.clientSecret ? { client_secret: st.clientSecret } : {}), resource: st.resource });
    const r = await getJson(st.meta.token_endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() });
    if (!r.ok || !r.json?.access_token) throw new McpError(`Token request failed (HTTP ${r.status}): ${(r.json?.error_description || r.json?.error || r.text).slice(0, 160)}`, { authRequired: true });
    const t = r.json;
    await store.set({ ...store.get(), pending: null, tokens: { accessToken: t.access_token, refreshToken: t.refresh_token || store.get()?.tokens?.refreshToken || null, expiresAt: t.expires_in ? now() + Number(t.expires_in) * 1000 : null } });
  }
  return {
    start,
    async finish({ code, state }) {
      const st = store.get();
      if (!st?.pending || st.pending.state !== state) throw new McpError("This login link is stale or was not started here. Press Connect again.");
      if (now() - st.pending.createdAt > 15 * 60_000) throw new McpError("The login took longer than 15 minutes. Press Connect again.");
      await tokenRequest({ grant_type: "authorization_code", code, redirect_uri: st.redirectUri, code_verifier: st.pending.verifier });
    },
    // A valid access token, refreshed if it is about to expire; null when there is none.
    async token() {
      const t = store.get()?.tokens; if (!t?.accessToken) return null;
      if (t.expiresAt && t.expiresAt - now() < 60_000) {
        if (!t.refreshToken) return null;
        try { await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refreshToken }); } catch { return null; }
        return store.get().tokens.accessToken;
      }
      return t.accessToken;
    },
    pendingState: () => store.get()?.pending?.state || null,
    hasTokens: () => !!store.get()?.tokens?.accessToken,
    async clearTokens() { const st = store.get(); if (st) await store.set({ ...st, tokens: null, pending: null }); }
  };
}

// ---- transports -------------------------------------------------------------------------------------
function httpTransport({ url, headers = () => ({}), fetchImpl = fetch, timeoutMs = 20000, session }) {
  let id = 1;
  async function post(body) {
    const h = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": session.get()?.protocol || PROTOCOL, ...(await headers()) };
    if (session.get()?.sessionId) h["Mcp-Session-Id"] = session.get().sessionId;
    try { return await fetchImpl(url, { method: "POST", headers: h, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new McpError(`Cannot reach the MCP server at ${url}: ${e.message}`, { network: true }); }
  }
  async function rpc(method, params) {
    const myId = id++, response = await post({ jsonrpc: "2.0", id: myId, method, params });
    if (response.status === 404 || response.status === 410) throw new McpError("session-gone");
    const text = await response.text();
    if (response.status === 401) throw new McpError("The MCP server needs you to log in.", { authRequired: true, wwwAuthenticate: response.headers.get("www-authenticate") });
    if (!response.ok) throw new McpError(`MCP HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`, { loginRequired: response.status === 403 });
    let msg; try { msg = parseRpcBody(text, response.headers.get("content-type"), myId); } catch { throw new McpError(`The MCP server returned unreadable data: ${text.slice(0, 120)}`); }
    if (!msg) throw new McpError("The MCP server sent no response for the request.");
    if (msg.error) throw new McpError(`MCP error ${msg.error.code}: ${msg.error.message}`, { loginRequired: LOGIN_HINT.test(msg.error.message || "") });
    return { result: msg.result, response };
  }
  return {
    async initialize(clientInfo) {
      await session.set(null);
      const { result, response } = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo });
      await session.set({ sessionId: response.headers.get("mcp-session-id") || null, protocol: result?.protocolVersion || PROTOCOL, serverInfo: result?.serverInfo || null });
      await post({ jsonrpc: "2.0", method: "notifications/initialized" }).then(r => r.text()).catch(() => {});
      return result;
    },
    request: (m, p) => rpc(m, p).then(x => x.result),
    ready: () => !!session.get(),
    close: async () => {}
  };
}

function stdioTransport({ command, env = {}, cwd, timeoutMs = 30000, spawnImpl = spawn, idleMs = 10 * 60_000 }) {
  let child = null, buf = "", id = 1, pending = new Map(), stderr = "", initialized = false, idleTimer = null;
  const argv = splitCommand(command);
  if (!argv.length) throw new McpError("No MCP server command is set.");
  function failAll(err) { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); } pending.clear(); }
  function start() {
    stderr = ""; buf = ""; initialized = false;
    try { child = spawnImpl(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"], shell: process.platform === "win32", windowsHide: true }); }
    catch (e) { throw new McpError(`Could not start "${argv[0]}": ${e.message}`); }
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stderr.on("data", d => { stderr = (stderr + d).slice(-2000); });
    child.stdout.on("data", d => {
      buf += d; let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line.startsWith("{")) continue; // servers sometimes print banners/logs
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.id !== undefined && pending.has(msg.id) && ("result" in msg || "error" in msg)) { const p = pending.get(msg.id); pending.delete(msg.id); clearTimeout(p.timer); msg.error ? p.reject(new McpError(`MCP error ${msg.error.code}: ${msg.error.message}`, { loginRequired: LOGIN_HINT.test(msg.error.message || "") })) : p.resolve(msg.result); }
        else if (msg.method && msg.id !== undefined) child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Not supported by this client" } }) + "\n");
      }
    });
    const dead = why => { const c = child; child = null; initialized = false; failAll(new McpError(`The MCP server process ${why}.${stderr ? ` Its output: ${stderr.trim().slice(-400)}` : ""}`, { network: true })); if (c) c.removeAllListeners(); };
    child.on("error", e => dead(`could not start (${e.message}). Check the command`));
    child.on("exit", code => dead(`stopped (exit code ${code})`));
  }
  function send(method, params, withId = true) {
    if (!child) start();
    clearTimeout(idleTimer); idleTimer = setTimeout(() => { child?.kill(); }, idleMs); idleTimer.unref?.();
    if (!withId) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n"); return Promise.resolve(); }
    const myId = id++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(myId); reject(new McpError(`The MCP server did not answer "${method}" within ${Math.round(timeoutMs / 1000)} s.${stderr ? ` Its output: ${stderr.trim().slice(-300)}` : ""}`, { network: true })); }, timeoutMs);
      pending.set(myId, { resolve, reject, timer });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: myId, method, params }) + "\n");
    });
  }
  return {
    async initialize(clientInfo) { const r = await send("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo }); await send("notifications/initialized", undefined, false); initialized = true; return r; },
    request: (m, p) => send(m, p),
    ready: () => !!child && initialized,
    async close() { clearTimeout(idleTimer); failAll(new McpError("closed")); if (child) { const c = child; child = null; c.kill(); } }
  };
}

// ---- client -----------------------------------------------------------------------------------------
// transport: "http" | "stdio". isAllowed(name) gates every tools/call. headers(): extra HTTP headers (e.g. an access
// token). oauth: from createOAuth (http only). session: { get, set } for the HTTP session id.
export function createMcpClient({ label = "MCP server", transport, url, command, env, headers, oauth = null, isAllowed, fetchImpl = fetch, session, timeoutMs, spawnImpl, clientInfo = { name: "equity-watchlist", version: "1.5.0" } }) {
  const authHeaders = async () => { const t = oauth ? await oauth.token() : null; return { ...(headers ? await headers() : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) }; };
  const tx = transport === "stdio" ? stdioTransport({ command, env, timeoutMs, spawnImpl }) : httpTransport({ url, headers: authHeaders, fetchImpl, timeoutMs, session });
  let chain = Promise.resolve();
  const serial = fn => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
  async function ensure() { if (!tx.ready()) await tx.initialize(clientInfo); }
  async function call(method, params) {
    await ensure();
    try { return await tx.request(method, params); }
    catch (e) { if (e.message !== "session-gone") throw e; await tx.initialize(clientInfo); return tx.request(method, params); }
  }
  return {
    label, transport,
    async listTools() { return serial(async () => ((await call("tools/list", {}))?.tools || []).map(t => ({ name: t.name, description: (t.description || "").slice(0, 160), allowed: isAllowed(t.name), inputSchema: t.inputSchema || null }))); },
    async callTool(name, args = {}) {
      if (!isAllowed(name)) throw new McpError(`Refusing to call "${name}": this app only uses read-only ${label} tools.`);
      return serial(async () => {
        const result = await call("tools/call", { name, arguments: args });
        const text = toolText(result);
        if (result?.isError) throw new McpError(text.slice(0, 300) || `${label} tool ${name} failed`, { loginRequired: LOGIN_HINT.test(text) });
        return { text, json: looseJson(text) ?? result?.structuredContent ?? null };
      });
    },
    async reset() { await tx.close(); if (session) await session.set(null); },
    close: () => tx.close()
  };
}
