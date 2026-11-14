// Zerodha Kite via MCP: a small, dependency-free MCP client (Streamable HTTP transport).
//
// Talks to Zerodha's official Kite MCP server (https://github.com/zerodha/kite-mcp-server). The hosted
// endpoint is https://mcp.kite.trade/mcp; set KITE_MCP_URL to point at a self-hosted instance instead.
// Enabled by default (set KITE_MCP_ENABLED=0 to switch it off). Nothing is sent until you open the Integrations tab or
// press Log in; the 15-minute price refresh only asks Kite once a Kite session exists.
//
// SAFETY: this app only ever READS from Kite. Every call is checked against READ_ONLY_TOOLS below, so even
// a self-hosted server that exposes place_order / modify_order / cancel_order / GTT tools can never be
// driven from here. There is deliberately no way to extend this list from the UI or an environment variable.
//
// Auth: Kite has no API-key flow for this client. The `login` tool returns a Zerodha login URL; you open it,
// sign in (with your own credentials, on Zerodha's site), and the MCP session becomes authenticated. The
// session id is kept in data/kite-session.json so a server restart does not force a new login; Kite expires
// logins daily, after which login() is needed again. One session = one Zerodha account.
// Newer hosted servers answer HTTP 401 "no bearer token" until you sign in with OAuth: login() then returns the
// authorization URL (discovery, client registration and PKCE are done by createOAuth in mcp-client.mjs), the browser
// comes back to /api/kite/callback, and the token (kept in data/kite-oauth*.json, a secret file) rides on every call.
import { dfs as fs } from "./storage.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const READ_ONLY_TOOLS = Object.freeze(["login", "get_profile", "get_holdings", "get_mf_holdings", "get_positions", "get_margins", "get_quotes", "get_ltp", "get_ohlc", "get_historical_data", "search_instruments", "get_trades"]); // get_trades: today's executed trades (read-only)
const here = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL = "2025-06-18";

export class KiteError extends Error {
  constructor(message, { loginRequired = false, network = false, authRequired = false, wwwAuthenticate = null, noTool = false } = {}) { super(message); this.loginRequired = loginRequired; this.network = network; this.authRequired = authRequired; this.wwwAuthenticate = wwwAuthenticate; this.noTool = noTool; }
}
const LOGIN_HINT = /(please\s+)?log\s?in\b|login (is )?required|not (logged in|authenticated)|unauthori[sz]ed|session (has )?(expired|invalid)|invalid (session|access token)|token (is )?(expired|invalid)|TokenException/i;

// ---- pure helpers (exported for tests) -------------------------------------------------------------
// A response is either plain JSON or an SSE stream holding the JSON-RPC message with our id.
export function parseRpcBody(text, contentType, id) {
  const candidates = [];
  if (/text\/event-stream/i.test(contentType || "")) {
    for (const block of String(text).split(/\r?\n\r?\n/)) {
      const data = block.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).replace(/^ /, "")).join("\n");
      if (data.trim()) { try { candidates.push(JSON.parse(data)); } catch { /* ignore keep-alives */ } }
    }
  } else if (String(text).trim()) {
    const parsed = JSON.parse(text);
    candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  return candidates.find(m => m && m.id === id && ("result" in m || "error" in m)) || null;
}
export const toolText = result => (result?.content || []).filter(b => b.type === "text").map(b => b.text).join("\n").trim();
export function looseJson(text) {
  try { return JSON.parse(text); } catch { /* may be wrapped in prose or a code fence */ }
  const m = String(text).match(/[\[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  return null;
}
// The login tool's text may be prose, markdown, or a JSON document. Go's JSON encoder writes "&" as \u0026, which would
// corrupt the URL, so decode every string in a JSON reply first, then take the first link (preferring Zerodha's own).
export function extractLoginUrl(text) {
  const strings = [String(text || "")];
  const walk = v => { if (typeof v === "string") strings.push(v); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(looseJson(text));
  for (const raw of strings) {
    const t = raw.replace(/\\u0026/gi, "&").replace(/\\u003d/gi, "=").replace(/\\\//g, "/").replace(/&amp;/g, "&");
    const urls = (t.match(/https?:\/\/[^\s)>\]"'<\\]+/g) || []).map(u => u.replace(/[.,;:]+$/, ""));
    const pick = urls.find(u => /zerodha|kite\./i.test(u)) || urls[0];
    if (pick) return pick;
  }
  return null;
}
// ---- which tool does what -----------------------------------------------------------------------------
// Older servers have one tool per job (get_profile, get_holdings…). The hosted server now groups them into a few tools
// (session, portfolio, market, mutual_funds, orders, gtt, alerts, help) that take an action argument. Each job this app
// does is listed here with the old tool name, the grouped tools it may live in, and the read-only actions it may use;
// nothing else can be called, so order / GTT / alert actions stay out of reach whatever the server offers.
export const KITE_OPS = Object.freeze({
  login: { legacy: "login", tools: ["session"], actions: [/^login$/i], guess: "login" },
  profile: { legacy: "get_profile", tools: ["session", "portfolio"], actions: [/^(get_)?(user_)?profile$/i, /^(whoami|me|user|status|info)$/i], guess: "profile" },
  holdings: { legacy: "get_holdings", tools: ["portfolio"], actions: [/^(get_)?holdings$/i], guess: "holdings" },
  mfHoldings: { legacy: "get_mf_holdings", tools: ["mutual_funds"], actions: [/^(get_)?(mf_)?holdings$/i], guess: "holdings" },
  ltp: { legacy: "get_ltp", tools: ["market"], actions: [/^(get_)?ltp$/i], guess: "ltp" },
  quotes: { legacy: "get_quotes", tools: ["market"], actions: [/^(get_)?quotes?$/i], guess: "quotes" },
  historical: { legacy: "get_historical_data", tools: ["market"], actions: [/^(get_)?historical(_data)?$/i, /^(candles|history)$/i], guess: "historical_data" },
  trades: { legacy: "get_trades", tools: ["orders"], actions: [/^(get_)?trades$/i], guess: "trades" }
});
const WRITE_ACTION = /place|modify|cancel|delete|remove|create|update|buy|sell|exit|convert|logout|redeem|invest|sip/i;
const ACTION_PROP = /^(action|operation|op|command|cmd|method|kind|type|resource|what|mode)$/i;
// Arguments of a tool that take one of a fixed set of values: [{ prop, choices }], action-like names first.
export function toolChoices(schema) {
  const res = x => { if (x?.$ref) { const k = x.$ref.split("/").pop(); return schema.$defs?.[k] || schema.definitions?.[k] || x; } return x || {}; };
  const out = [];
  for (const [prop, raw] of Object.entries(schema?.properties || {})) {
    const q = res(raw), choices = [];
    for (const x of [q, ...(q.anyOf || []), ...(q.oneOf || [])].map(res)) { if (Array.isArray(x.enum)) choices.push(...x.enum); if (x.const !== undefined) choices.push(x.const); }
    out.push({ prop, choices: [...new Set(choices.filter(v => typeof v === "string"))], isString: q.type === "string" || choices.length > 0 });
  }
  return out.sort((a, b) => ACTION_PROP.test(b.prop) - ACTION_PROP.test(a.prop));
}
// tools: [{ name, inputSchema }] from tools/list. → every { name, args } that can do the job, best first.
export function resolveKiteOpAll(op, tools) {
  const o = KITE_OPS[op], out = [], seen = new Set(); if (!o) return out;
  const add = r => { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); out.push(r); } };
  if (tools.some(t => t.name === o.legacy)) add({ name: o.legacy, args: {} });
  for (const re of o.actions) for (const tn of o.tools) {
    const t = tools.find(x => x.name === tn); if (!t) continue;
    for (const { prop, choices } of toolChoices(t.inputSchema)) for (const c of choices) if (re.test(c) && !WRITE_ACTION.test(c)) add({ name: tn, args: { [prop]: c } });
  }
  // no list of values published: use the usual action name on an action-like text argument
  for (const tn of o.tools) {
    const t = tools.find(x => x.name === tn); if (!t) continue;
    const props = toolChoices(t.inputSchema), free = props.find(x => ACTION_PROP.test(x.prop) && !x.choices.length);
    if (free && !out.some(r => r.name === tn)) add({ name: tn, args: { [free.prop]: o.guess } });
  }
  return out;
}
export const resolveKiteOp = (op, tools) => resolveKiteOpAll(op, tools)[0] || null;
// A Kite user id anywhere in a reply (grouped servers nest it differently): { userId, name } or null.
export function findKiteUser(json, text = "") {
  let id = null, name = null;
  const walk = (v, d) => {
    if (!v || typeof v !== "object" || d > 5) return;
    for (const [k, x] of Object.entries(v)) {
      if (typeof x === "string" || typeof x === "number") {
        if (!id && /^(user_?id|client_?id|login_?id|ucc)$/i.test(k) && /^[A-Za-z0-9]{3,12}$/.test(String(x))) id = String(x);
        if (!name && /^(user_?name|user_?shortname|full_?name|name)$/i.test(k) && typeof x === "string" && x.trim()) name = x.trim();
      } else walk(x, d + 1);
    }
  };
  walk(json, 0);
  if (!id) id = /\b(?:user|client|login)[ _]?id\b["'`*\s:=-]{1,6}([A-Za-z]{2,3}\d{3,5}[A-Za-z]?)\b/i.exec(String(text))?.[1] || null;
  return id ? { userId: id.toUpperCase(), name, email: null } : null;
}
// True when the server is the grouped kind with no `login` tool: sign-in is by OAuth only.
export const oauthOnly = tools => !tools.some(t => t.name === "login") && tools.some(t => Object.values(KITE_OPS).some(o => o.tools.includes(t.name))) && !resolveKiteOp("login", tools);
const unwrap = j => Array.isArray(j) ? j : (j && typeof j === "object" ? (j.holdings || j.data || j.result || j.items || j) : j);
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const r2 = v => v === null ? null : Math.round(v * 100) / 100;
// get_trades → tradebook trades (cash equity only). Kite returns only today's trades; the server saves them every day.
export function normalizeKiteTrades(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const out = [];
  for (const t of list) {
    if (!t || !/^(NSE|BSE)$/.test(String(t.exchange || "NSE"))) continue;
    const side = /^BUY/i.test(t.transaction_type) ? "buy" : /^SELL/i.test(t.transaction_type) ? "sell" : null;
    const date = String(t.fill_timestamp || t.exchange_timestamp || t.order_timestamp || "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
    const qty = Number(t.quantity ?? t.filled_quantity), price = Number(t.average_price ?? t.price);
    const symbol = String(t.tradingsymbol || "").trim().toUpperCase().replace(/-(EQ|BE)$/, "");
    if (!side || !date || !(qty > 0) || !(price > 0) || !symbol || /\d{2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)|FUT$|(CE|PE)$/.test(symbol)) continue;
    out.push({ key: symbol, symbol, isin: null, date, side, qty, price, tradeId: t.trade_id ? String(t.trade_id) : null, ...(t.product === "MIS" ? { product: "MIS" } : {}), src: "kite-api" });
  }
  return out;
}
export function normalizeHoldings(json) {
  const list = unwrap(json);
  if (!Array.isArray(list)) throw new KiteError("Unrecognised holdings response from Kite MCP.");
  return list.map(h => {
    const symbol = String(h.tradingsymbol || h.trading_symbol || h.symbol || "").toUpperCase();
    const qty = (n(h.quantity) || 0) + (n(h.t1_quantity) || 0);
    const avg = n(h.average_price ?? h.avg_price), last = n(h.last_price ?? h.ltp ?? h.close_price);
    const invested = avg !== null ? avg * qty : null, value = last !== null ? last * qty : null;
    const pnl = n(h.pnl) ?? (invested !== null && value !== null ? value - invested : null);
    return { symbol, exchange: h.exchange || "NSE", isin: h.isin || null, qty, avgPrice: r2(avg), lastPrice: r2(last), invested: r2(invested), value: r2(value), pnl: r2(pnl), dayChangePct: r2(n(h.day_change_percentage)) };
  }).filter(h => h.symbol && h.qty > 0);
}
// get_mf_holdings (Zerodha Coin): [{ folio, fund, tradingsymbol: <scheme ISIN>, quantity, average_price, last_price, last_price_date, pnl }]
export function normalizeMfHoldings(json) {
  const list = unwrap(json);
  if (!Array.isArray(list)) throw new KiteError("Unrecognised mutual fund holdings response from Kite MCP.");
  return list.map(h => {
    const units = n(h.quantity ?? h.units), avg = n(h.average_price ?? h.avg_price), nav = n(h.last_price ?? h.nav);
    const invested = avg !== null && units !== null ? avg * units : null, value = nav !== null && units !== null ? nav * units : null;
    return { isin: String(h.tradingsymbol || h.isin || "").toUpperCase(), name: String(h.fund || h.scheme_name || h.name || h.tradingsymbol || "").trim(), folio: h.folio ? String(h.folio) : null, units: units === null ? null : Math.round(units * 1000) / 1000, avgNav: r2(avg), nav: r2(nav), navDate: h.last_price_date || null, invested: r2(invested), value: r2(value), pnl: r2(n(h.pnl) ?? (invested !== null && value !== null ? value - invested : null)) };
  }).filter(h => h.isin && h.units > 0);
}
export function normalizeLtp(json) {
  const body = json?.data && typeof json.data === "object" ? json.data : json;
  const out = new Map();
  for (const [key, v] of Object.entries(body || {})) {
    const price = n(v?.last_price ?? v?.ltp ?? v);
    if (price !== null && price > 0) out.set(key.includes(":") ? key.split(":")[1].toUpperCase() : key.toUpperCase(), price);
  }
  return out;
}
// get_quotes: { "NSE:INFY": { last_price, volume, average_price, net_change, ohlc: { open, high, low, close } }, ... }
export function normalizeQuotes(json) {
  const body = json?.data && typeof json.data === "object" ? json.data : json;
  const out = new Map();
  for (const [key, v] of Object.entries(body || {})) {
    if (!v || typeof v !== "object") continue;
    const price = n(v.last_price ?? v.ltp), close = n(v.ohlc?.close), vol = n(v.volume ?? v.volume_traded);
    if (price === null || price <= 0) continue;
    const sym = (key.includes(":") ? key.split(":")[1] : key).toUpperCase();
    out.set(sym, { symbol: sym, price, volume: vol, avgPrice: n(v.average_price ?? v.average_traded_price), open: n(v.ohlc?.open), high: n(v.ohlc?.high), low: n(v.ohlc?.low), close, pChange: close ? r2((price / close - 1) * 100) : null });
  }
  return out;
}
export function normalizeProfile(json) {
  let p = unwrap(json) || {};
  if (!(p.user_id || p.userId || p.client_id) && typeof p === "object") p = p.profile || p.user || p.session || p;
  const id = p.user_id || p.userId || p.client_id || null;
  return id ? { userId: String(id), name: p.user_name || p.user_shortname || p.name || null, email: p.email || null } : null;
}

// ---- client ----------------------------------------------------------------------------------------
export function createKiteClient({ url = process.env.KITE_MCP_URL || "https://mcp.kite.trade/mcp", enabled = process.env.KITE_MCP_ENABLED !== "0", fetchImpl = fetch, sessionFile = path.join(here, "data", "kite-session.json"), oauthFile = null, timeoutMs = 20000 } = {}) {
  let session = null, loaded = false, chain = Promise.resolve(), nextId = 1, toolCache = null;
  const cfg = { url, enabled, timeoutMs };
  // ---- OAuth (only used when the server answers 401) ----
  const oauthPath = oauthFile || (path.basename(sessionFile).startsWith("kite-session") ? path.join(path.dirname(sessionFile), path.basename(sessionFile).replace(/^kite-session/, "kite-oauth")) : `${sessionFile}.oauth.json`);
  let oauthState = null, oauthLoaded = false, oauth = null;
  const oauthStore = { get: () => oauthState, set: async v => { oauthState = v; if (v === null) await fs.rm(oauthPath, { force: true }); else { await fs.mkdir(path.dirname(oauthPath), { recursive: true }); await fs.writeFile(oauthPath, JSON.stringify(v), { mode: 0o600 }); } } };
  async function loadOauth() { if (oauthLoaded) return; oauthLoaded = true; try { oauthState = JSON.parse(await fs.readFile(oauthPath, "utf8")); } catch { /* none saved */ } }
  async function oauthFor() { await loadOauth(); if (!oauth) { const { createOAuth } = await import("./mcp-client.mjs"); oauth = createOAuth({ mcpUrl: url, store: oauthStore, fetchImpl, clientName: "Equity Watchlist (read-only)" }); } return oauth; }

  async function loadSession() {
    if (loaded) return; loaded = true;
    try { const s = JSON.parse(await fs.readFile(sessionFile, "utf8")); if (s.url === url && s.sessionId) session = s; } catch { /* none saved */ }
  }
  async function saveSession() { await fs.mkdir(path.dirname(sessionFile), { recursive: true }); await fs.writeFile(sessionFile, JSON.stringify(session), { mode: 0o600 }); }
  async function forget() { session = null; loaded = true; toolCache = null; await fs.rm(sessionFile, { force: true }); }

  async function post(body, { withSession = true } = {}) {
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": session?.protocol || PROTOCOL };
    if (withSession && session?.sessionId) headers["Mcp-Session-Id"] = session.sessionId;
    await loadOauth(); if (oauthState?.tokens?.accessToken) { const t = await (await oauthFor()).token(); if (t) headers.Authorization = `Bearer ${t}`; }
    let response;
    try { response = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new KiteError(`Cannot reach Kite MCP at ${url}: ${e.message}`, { network: true }); }
    return response;
  }
  async function rpc(method, params, { withSession = true } = {}) {
    const id = nextId++;
    const response = await post({ jsonrpc: "2.0", id, method, params }, { withSession });
    if (response.status === 404 || response.status === 410) throw new KiteError("session-gone", { network: false });
    const text = await response.text();
    // the hosted server answers an expired / unknown session with HTTP 400 "Invalid session ID": start a new one
    if (response.status === 400 && withSession && /invalid session|session (id )?(not found|expired|unknown)|unknown session/i.test(text)) throw new KiteError("session-gone", { network: false });
    if (!response.ok) throw new KiteError(`Kite MCP HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`, { loginRequired: response.status === 401 || response.status === 403, authRequired: response.status === 401, wwwAuthenticate: response.status === 401 ? response.headers.get("www-authenticate") : null });
    let msg; try { msg = parseRpcBody(text, response.headers.get("content-type"), id); } catch { throw new KiteError(`Kite MCP returned unreadable data: ${text.slice(0, 120)}`); }
    if (!msg) throw new KiteError("Kite MCP sent no response for the request.");
    if (msg.error) throw new KiteError(`Kite MCP error ${msg.error.code}: ${msg.error.message}`, { loginRequired: LOGIN_HINT.test(msg.error.message || "") });
    return { result: msg.result, response };
  }
  async function initialize() {
    session = null; toolCache = null;
    const { result, response } = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "equity-watchlist", version: "1.5.0" } }, { withSession: false });
    session = { url, sessionId: response.headers.get("mcp-session-id") || null, protocol: result?.protocolVersion || PROTOCOL, createdAt: new Date().toISOString() };
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).then(r => r.text()).catch(() => {});
    await saveSession();
  }
  async function ensure() { await loadSession(); if (!session) await initialize(); }

  // One request at a time: the hosted server ties login state to the session, and interleaved initialize calls would reset it.
  function serial(fn) { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; }

  async function callTool(name, args = {}, opts) {
    if (!READ_ONLY_TOOLS.includes(name)) throw new KiteError(`Refusing to call "${name}": this app only uses read-only Kite tools.`);
    return callRaw(name, args, opts);
  }
  // Everything the server offers, with each tool's argument schema (kept until the session changes).
  async function toolList() {
    if (!cfg.enabled) throw new KiteError("Kite MCP is switched off (KITE_MCP_ENABLED=0 in .env).");
    if (toolCache) return toolCache;
    return serial(async () => {
      await ensure();
      let r; try { r = await rpc("tools/list", {}); } catch (e) { if (e.message !== "session-gone") throw e; await initialize(); r = await rpc("tools/list", {}); }
      return (toolCache = (r.result?.tools || []).map(t => ({ name: t.name, description: t.description || "", inputSchema: t.inputSchema || null })));
    });
  }
  // One of this app's read-only jobs (KITE_OPS), on whichever tool the server has for it.
  async function callOp(op, args = {}, opts) {
    for (let attempt = 0; ; attempt++) {
      const tools = await toolList(), r = resolveKiteOp(op, tools) || { name: KITE_OPS[op].legacy, args: {}, fallback: true }; // not listed: try the usual name anyway
      try { return await callRaw(r.name, { ...r.args, ...args }, opts); }
      catch (e) {
        if (!/unknown tool|tool not found/i.test(e.message)) throw e;
        if (attempt || r.fallback) throw new KiteError(`Zerodha's server has no tool this app knows for "${op}" (it offers: ${tools.map(t => t.name).join(", ") || "nothing"}). Press Diagnose and share the result.`, { noTool: true });
        toolCache = null; // the server's tool list changed: read it again once
      }
    }
  }
  async function callRaw(name, args = {}, { checkLogin = true } = {}) {
    if (!cfg.enabled) throw new KiteError("Kite MCP is switched off (KITE_MCP_ENABLED=0 in .env).");
    return serial(async () => {
      await ensure();
      let out;
      try { out = await rpc("tools/call", { name, arguments: args }); }
      catch (e) {
        if (e.message !== "session-gone") throw e;
        await initialize(); // Zerodha ties the login to the session: a new session usually needs a new login
        try { out = await rpc("tools/call", { name, arguments: args }); }
        catch (e2) { if (e2.message === "session-gone") throw new KiteError("Kite session expired: log in to Kite again (Integrations → Zerodha → Log in).", { loginRequired: true }); throw e2; }
      }
      const text = toolText(out.result);
      if (checkLogin && (out.result?.isError || LOGIN_HINT.test(text.slice(0, 300))) && LOGIN_HINT.test(text)) throw new KiteError(text.slice(0, 300) || "Kite login required", { loginRequired: true });
      if (out.result?.isError) throw new KiteError(text.slice(0, 300) || `Kite tool ${name} failed`);
      return { text, json: looseJson(text) };
    });
  }

  return {
    config: cfg,
    callTool,
    async listTools() {
      const tools = await toolList(), used = new Map();
      for (const op of Object.keys(KITE_OPS)) { const r = resolveKiteOp(op, tools); if (r) used.set(r.name, [...(used.get(r.name) || []), Object.values(r.args)[0] || op]); }
      return tools.map(t => ({ name: t.name, allowed: READ_ONLY_TOOLS.includes(t.name) || used.has(t.name), uses: used.get(t.name) || [], description: t.description.slice(0, 140) }));
    },
    // The server's own `login` tool gives a Zerodha link. A server that wants OAuth first (HTTP 401) gets the OAuth
    // authorization URL instead: open it, sign in on Zerodha, and the browser returns to redirectUri.
    async login({ redirectUri } = {}) {
      try {
        if (oauthOnly(await toolList())) {
          // Sign-in is by OAuth only. Already signed in → nothing to do; signed out on Zerodha's side → sign in again.
          try { return { connected: true, profile: await this.profile(), message: "Already signed in to Zerodha." }; }
          catch (e) { if (e.loginRequired && !e.authRequired) e.reauth = true; throw e; }
        }
        const { text } = await callOp("login", {}, { checkLogin: false }); return { loginUrl: extractLoginUrl(text), message: text.slice(0, 600) };
      } catch (e) {
        if (!(e.authRequired || e.reauth) || !redirectUri) throw e;
        try {
          const { authUrl } = await (await oauthFor()).start({ redirectUri, wwwAuthenticate: e.wwwAuthenticate });
          return { loginUrl: authUrl, authUrl, oauth: true, message: "Zerodha's server asks for an OAuth sign-in." };
        } catch (e2) {
          throw new KiteError(`${e2.message} If you have a Kite Connect API key you can self-host the Kite MCP server and set KITE_MCP_URL.`);
        }
      }
    },
    // The browser came back from Zerodha with ?code=&state=: swap the code for a token and start a clean session.
    async finishOAuth({ code, state }) {
      await (await oauthFor()).finish({ code, state });
      session = null; loaded = true; toolCache = null; await fs.rm(sessionFile, { force: true });
    },
    async ownsState(state) { await loadOauth(); return !!state && oauthState?.pending?.state === state; },
    hasOAuthToken: async () => { await loadOauth(); return !!oauthState?.tokens?.accessToken; },
    // Who is logged in. Grouped servers may answer under more than one action (profile, status…): take the first reply
    // that names the user. null = the server answered but nowhere said who this is.
    async profile() {
      const tools = await toolList(), cands = resolveKiteOpAll("profile", tools);
      if (cands.length < 2) { const { json, text } = await callOp("profile"); return normalizeProfile(json) || findKiteUser(json, text); }
      let first = true;
      for (const r of cands.slice(0, 4)) {
        try { const { json, text } = await callRaw(r.name, r.args); const p = normalizeProfile(json) || findKiteUser(json, text); if (p) return p; }
        catch (e) { if (first || e.loginRequired || e.network) throw e; }
        first = false;
      }
      return null;
    },
    async status() {
      if (!cfg.enabled) return { enabled: false, connected: false };
      try { const profile = await this.profile(); return { enabled: true, url, connected: true, profile }; }
      catch (e) { return { enabled: true, url, connected: false, loginRequired: !!e.loginRequired, error: e.loginRequired ? null : e.message }; }
    },
    async holdings() { const { json, text } = await callOp("holdings"); if (json === null) throw new KiteError(`Unrecognised holdings response: ${text.slice(0, 120)}`); return normalizeHoldings(json); },
    async trades() { const { json, text } = await callOp("trades"); if (json === null) { if (/no trades|\[\s*\]/i.test(text)) return []; throw new KiteError(`Unrecognised trades response: ${text.slice(0, 120)}`); } return normalizeKiteTrades(json); },
    async mfHoldings() { const { json, text } = await callOp("mfHoldings"); if (json === null) { if (/no (mutual fund |mf )?holdings|\[\s*\]/i.test(text)) return []; throw new KiteError(`Unrecognised mutual fund holdings response: ${text.slice(0, 120)}`); } return normalizeMfHoldings(json); },
    async ltp(symbols, exchange = "NSE") {
      const instruments = [...new Set(symbols.map(s => String(s).toUpperCase()))].map(s => `${exchange}:${s}`);
      if (!instruments.length) return new Map();
      const { json, text } = await callOp("ltp", { instruments });
      if (json === null) throw new KiteError(`Unrecognised LTP response: ${text.slice(0, 120)}`);
      return normalizeLtp(json);
    },
    async quotes(symbols, exchange = "NSE") {
      const all = [...new Set(symbols.map(x => String(x).toUpperCase()))], out = new Map();
      for (let i = 0; i < all.length; i += 200) {
        const { json, text } = await callOp("quotes", { instruments: all.slice(i, i + 200).map(x => `${exchange}:${x}`) });
        if (json === null) throw new KiteError(`Unrecognised quotes response: ${text.slice(0, 120)}`);
        for (const [k, v] of normalizeQuotes(json)) out.set(k, v);
      }
      return out;
    },
    // Daily candles for one instrument (Kite instrument token), oldest first: [{ t, c, h, l, v }]
    async historical(token, days = 380) {
      const pad = n => String(n).padStart(2, "0"), fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
      const to = new Date(), from = new Date(to.getTime() - days * 864e5);
      const { json, text } = await callOp("historical", { instrument_token: Number(token), from_date: fmt(from), to_date: fmt(to), interval: "day" });
      return normalizeCandles(json, text);
    },
    // Step-by-step probe for "login does not work": shows exactly where the conversation with the server stops.
    async diagnose() {
      const steps = [], add = (step, ok, detail) => steps.push({ step, ok, detail: String(detail ?? "").slice(0, 1200) });
      if (!cfg.enabled) return { steps: [{ step: "enabled", ok: false, detail: "KITE_MCP_ENABLED=0 switches Kite off" }] };
      try { const t = await this.listTools(); add("connect + tools/list", true, `${t.length} tools: ${t.map(x => x.name).join(", ")}`); } catch (e) { add("connect + tools/list", false, e.authRequired ? `${e.message}. The server wants an OAuth sign-in first (${oauthState?.tokens?.accessToken ? "the saved token was rejected or expired" : "no token saved yet"}): press Log in on the account card.` : e.message); return { url, steps }; }
      const tools = await toolList().catch(() => []), short = (v, n) => { const t = typeof v === "string" ? v : JSON.stringify(v); return t.length > n ? `${t.slice(0, n)}…` : t; };
      const grouped = tools.some(t => Object.values(KITE_OPS).some(o => o.tools.includes(t.name)));
      add("how this app reads it", !grouped || Object.keys(KITE_OPS).filter(o => o !== "login").every(o => resolveKiteOp(o, tools)), Object.keys(KITE_OPS).map(o => { const r = resolveKiteOp(o, tools); return `${o} → ${r ? `${r.name}${Object.keys(r.args).length ? ` ${JSON.stringify(r.args)}` : ""}` : grouped ? "NOT FOUND" : `${KITE_OPS[o].legacy} (not listed, tried anyway)`}`; }).join("; "));
      if (!oauthOnly(tools)) { try { const { text } = await callOp("login", {}, { checkLogin: false }), u = extractLoginUrl(text); add("login tool", !!u, u ? `link received (${new URL(u).host}); session ${session?.sessionId ? "id issued" : "has NO session id"}` : `no link found in reply: ${text.slice(0, 300)}`); } catch (e) { add("login tool", false, e.message); } }
      else add("login tool", true, "none on this server: sign-in is by OAuth (Log in on the account card)");
      try {
        const p = await this.profile();
        if (p) add("profile", true, `logged in as ${p.userId}`);
        else { // say what came back (names of fields only, never their values) so the right field can be read next time
          const shape = (v, d = 0) => Array.isArray(v) ? `[${v.length ? shape(v[0], d + 1) : ""}]` : v && typeof v === "object" ? `{${Object.entries(v).slice(0, 25).map(([k, x]) => x && typeof x === "object" && d < 2 ? `${k}:${shape(x, d + 1)}` : k).join(",")}}` : typeof v;
          const seen = []; for (const r of resolveKiteOpAll("profile", tools).slice(0, 4)) { try { const { json, text } = await callRaw(r.name, r.args); seen.push(`${r.name} ${JSON.stringify(r.args)} → ${json === null ? `text of ${text.length} chars starting "${text.slice(0, 40).replace(/[A-Z]{2,3}\d{3,5}/g, "…")}"` : shape(json)}`); } catch (e) { seen.push(`${r.name} ${JSON.stringify(r.args)} → error: ${e.message.slice(0, 80)}`); } }
          add("profile", false, `no user id in the reply (Sync still works: the account is named after the slot). Reply fields: ${seen.join(" | ") || "none"}`);
        }
      } catch (e) { add("profile", false, e.loginRequired ? `not logged in: ${e.message}` : e.message); }
      for (const [op, label] of [["holdings", "holdings"], ["mfHoldings", "mutual fund holdings"]]) {
        try { const { json, text } = await callOp(op); const list = Array.isArray(json) ? json : json && typeof json === "object" ? (json.holdings || json.data || json.result || json.items) : null; add(label, Array.isArray(list), Array.isArray(list) ? `${list.length} row(s)${Array.isArray(json) ? "" : `; reply also has: ${Object.keys(json).filter(k => !Array.isArray(json[k])).slice(0, 10).map(k => `${k}=${typeof json[k] === "object" ? "{…}" : String(json[k]).slice(0, 20)}`).join(", ") || "nothing else"}`}; fields: ${Object.keys(list[0] || {}).slice(0, 14).join(", ") || "(none)"}` : `reply was not a list: ${short(text, 300)}`); }
        catch (e) { add(label, false, e.message); }
      }
      // What the server publishes about its tools (names of arguments and their allowed values; no account data).
      let schemas = tools.map(t => `■ ${t.name}: ${short(t.description, 500)}\n  arguments: ${short(t.inputSchema || {}, 2500)}`).join("\n");
      const help = tools.find(t => t.name === "help");
      if (help) { try { const req = Object.fromEntries((help.inputSchema?.required || []).map(k => [k, toolChoices(help.inputSchema).find(x => x.prop === k)?.choices[0] ?? ""])); const { text } = await callRaw("help", req, { checkLogin: false }); schemas += `\n■ help says:\n${short(text, 6000)}`; } catch (e) { schemas += `\n■ help failed: ${e.message}`; } }
      return { url, sessionId: session?.sessionId ? "present" : "missing", protocol: session?.protocol, steps, schemas };
    },
    async forget() { await forget(); await loadOauth(); if (oauthState) await oauthStore.set({ ...oauthState, tokens: null, pending: null }); },
    async hasSession() { await loadSession(); return !!session; }
  };
}
export const kite = createKiteClient();

// get_historical_data answers with an array of { date, open, high, low, close, volume } (or { data: { candles: [[date, o, h, l, c, v]] } }).
export function normalizeCandles(json, text = "") {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.candles) ? json.data.candles : Array.isArray(json?.candles) ? json.candles : null;
  if (!rows) throw new KiteError(`Unrecognised price-history response: ${String(text).slice(0, 120)}`);
  return rows.map(r => Array.isArray(r) ? { t: Date.parse(r[0]) / 1000, o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] } : { t: Date.parse(r.date) / 1000, o: +r.open, h: +r.high, l: +r.low, c: +r.close, v: +r.volume })
    .filter(b => Number.isFinite(b.c) && b.c > 0).sort((a, b) => a.t - b.t);
}
