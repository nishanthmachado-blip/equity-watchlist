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
import { dfs as fs } from "./storage.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const READ_ONLY_TOOLS = Object.freeze(["login", "get_profile", "get_holdings", "get_mf_holdings", "get_positions", "get_margins", "get_quotes", "get_ltp", "get_ohlc", "get_historical_data", "search_instruments"]);
const here = path.dirname(fileURLToPath(import.meta.url));
const PROTOCOL = "2025-06-18";

export class KiteError extends Error {
  constructor(message, { loginRequired = false, network = false } = {}) { super(message); this.loginRequired = loginRequired; this.network = network; }
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
const unwrap = j => Array.isArray(j) ? j : (j && typeof j === "object" ? (j.holdings || j.data || j.result || j.items || j) : j);
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };
const r2 = v => v === null ? null : Math.round(v * 100) / 100;
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
  const p = unwrap(json) || {};
  const id = p.user_id || p.userId || p.client_id || null;
  return id ? { userId: String(id), name: p.user_name || p.user_shortname || p.name || null, email: p.email || null } : null;
}

// ---- client ----------------------------------------------------------------------------------------
export function createKiteClient({ url = process.env.KITE_MCP_URL || "https://mcp.kite.trade/mcp", enabled = process.env.KITE_MCP_ENABLED !== "0", fetchImpl = fetch, sessionFile = path.join(here, "data", "kite-session.json"), timeoutMs = 20000 } = {}) {
  let session = null, loaded = false, chain = Promise.resolve(), nextId = 1;
  const cfg = { url, enabled, timeoutMs };

  async function loadSession() {
    if (loaded) return; loaded = true;
    try { const s = JSON.parse(await fs.readFile(sessionFile, "utf8")); if (s.url === url && s.sessionId) session = s; } catch { /* none saved */ }
  }
  async function saveSession() { await fs.mkdir(path.dirname(sessionFile), { recursive: true }); await fs.writeFile(sessionFile, JSON.stringify(session), { mode: 0o600 }); }
  async function forget() { session = null; loaded = true; await fs.rm(sessionFile, { force: true }); }

  async function post(body, { withSession = true } = {}) {
    const headers = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": session?.protocol || PROTOCOL };
    if (withSession && session?.sessionId) headers["Mcp-Session-Id"] = session.sessionId;
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
    if (!response.ok) throw new KiteError(`Kite MCP HTTP ${response.status}${text ? `: ${text.slice(0, 160)}` : ""}`, { loginRequired: response.status === 401 || response.status === 403 });
    let msg; try { msg = parseRpcBody(text, response.headers.get("content-type"), id); } catch { throw new KiteError(`Kite MCP returned unreadable data: ${text.slice(0, 120)}`); }
    if (!msg) throw new KiteError("Kite MCP sent no response for the request.");
    if (msg.error) throw new KiteError(`Kite MCP error ${msg.error.code}: ${msg.error.message}`, { loginRequired: LOGIN_HINT.test(msg.error.message || "") });
    return { result: msg.result, response };
  }
  async function initialize() {
    session = null;
    const { result, response } = await rpc("initialize", { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "equity-watchlist", version: "1.5.0" } }, { withSession: false });
    session = { url, sessionId: response.headers.get("mcp-session-id") || null, protocol: result?.protocolVersion || PROTOCOL, createdAt: new Date().toISOString() };
    await post({ jsonrpc: "2.0", method: "notifications/initialized" }).then(r => r.text()).catch(() => {});
    await saveSession();
  }
  async function ensure() { await loadSession(); if (!session) await initialize(); }

  // One request at a time: the hosted server ties login state to the session, and interleaved initialize calls would reset it.
  function serial(fn) { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; }

  async function callTool(name, args = {}, { checkLogin = true } = {}) {
    if (!READ_ONLY_TOOLS.includes(name)) throw new KiteError(`Refusing to call "${name}": this app only uses read-only Kite tools.`);
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
    async listTools() { if (!cfg.enabled) throw new KiteError("Kite MCP is disabled."); return serial(async () => { await ensure(); const { result } = await rpc("tools/list", {}); return (result?.tools || []).map(t => ({ name: t.name, allowed: READ_ONLY_TOOLS.includes(t.name), description: (t.description || "").slice(0, 140) })); }); },
    async login() { const { text } = await callTool("login", {}, { checkLogin: false }); return { loginUrl: extractLoginUrl(text), message: text.slice(0, 600) }; },
    async profile() { const { json } = await callTool("get_profile"); return normalizeProfile(json); },
    async status() {
      if (!cfg.enabled) return { enabled: false, connected: false };
      try { const profile = await this.profile(); return { enabled: true, url, connected: true, profile }; }
      catch (e) { return { enabled: true, url, connected: false, loginRequired: !!e.loginRequired, error: e.loginRequired ? null : e.message }; }
    },
    async holdings() { const { json, text } = await callTool("get_holdings"); if (json === null) throw new KiteError(`Unrecognised holdings response: ${text.slice(0, 120)}`); return normalizeHoldings(json); },
    async mfHoldings() { const { json, text } = await callTool("get_mf_holdings"); if (json === null) { if (/no (mutual fund |mf )?holdings|\[\s*\]/i.test(text)) return []; throw new KiteError(`Unrecognised mutual fund holdings response: ${text.slice(0, 120)}`); } return normalizeMfHoldings(json); },
    async ltp(symbols, exchange = "NSE") {
      const instruments = [...new Set(symbols.map(s => String(s).toUpperCase()))].map(s => `${exchange}:${s}`);
      if (!instruments.length) return new Map();
      const { json, text } = await callTool("get_ltp", { instruments });
      if (json === null) throw new KiteError(`Unrecognised LTP response: ${text.slice(0, 120)}`);
      return normalizeLtp(json);
    },
    async quotes(symbols, exchange = "NSE") {
      const all = [...new Set(symbols.map(x => String(x).toUpperCase()))], out = new Map();
      for (let i = 0; i < all.length; i += 200) {
        const { json, text } = await callTool("get_quotes", { instruments: all.slice(i, i + 200).map(x => `${exchange}:${x}`) });
        if (json === null) throw new KiteError(`Unrecognised quotes response: ${text.slice(0, 120)}`);
        for (const [k, v] of normalizeQuotes(json)) out.set(k, v);
      }
      return out;
    },
    // Daily candles for one instrument (Kite instrument token), oldest first: [{ t, c, h, l, v }]
    async historical(token, days = 380) {
      const pad = n => String(n).padStart(2, "0"), fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
      const to = new Date(), from = new Date(to.getTime() - days * 864e5);
      const { json, text } = await callTool("get_historical_data", { instrument_token: Number(token), from_date: fmt(from), to_date: fmt(to), interval: "day" });
      return normalizeCandles(json, text);
    },
    // Step-by-step probe for "login does not work": shows exactly where the conversation with the server stops.
    async diagnose() {
      const steps = [], add = (step, ok, detail) => steps.push({ step, ok, detail: String(detail ?? "").slice(0, 400) });
      if (!cfg.enabled) return { steps: [{ step: "enabled", ok: false, detail: "KITE_MCP_ENABLED=0 switches Kite off" }] };
      try { const t = await this.listTools(); add("connect + tools/list", true, `${t.length} tools: ${t.map(x => x.name).join(", ")}`); } catch (e) { add("connect + tools/list", false, e.message); return { url, steps }; }
      try { const r = await this.login(); add("login tool", !!r.loginUrl, r.loginUrl ? `link received (${new URL(r.loginUrl).host}); session ${session?.sessionId ? "id issued" : "has NO session id"}` : `no link found in reply: ${r.message}`); } catch (e) { add("login tool", false, e.message); }
      try { const p = await this.profile(); add("get_profile (after login)", !!p, p ? `logged in as ${p.userId}` : "reply had no user id"); } catch (e) { add("get_profile (after login)", false, e.loginRequired ? `still not logged in: ${e.message} (expected until you finish signing in on Zerodha's page)` : e.message); }
      return { url, sessionId: session?.sessionId ? "present" : "missing", protocol: session?.protocol, steps };
    },
    forget,
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
