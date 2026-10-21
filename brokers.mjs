// Angel One (SmartAPI), Dhan (DhanHQ v2) and Groww (Trade API): read-only holdings sync over each broker's REST API.
// Dependency-free, like kite-mcp.mjs. Nothing is sent anywhere until you press Log in / Connect / Sync on the
// Integrations tab.
//
// SAFETY: this module only READS. Every request is checked against READ_ONLY_ROUTES below before it is sent: login /
// token, profile, holdings and last-traded price. Order, modify, cancel, GTT and fund-transfer endpoints are not in the
// list, so they can never be called from here, and there is deliberately no way to extend the list from the UI or env.
//
// Details (API key, client ID, optional PIN / TOTP secret / access token) are entered on the Integrations tab and saved on
// this machine only, in data/broker-credentials.json (git-ignored, mode 600); .env values work too, as a fallback. A
// 6-digit TOTP typed at login is used once. Session tokens are kept in data/broker-sessions.json (git-ignored, mode 600);
// every broker expires them daily, and the app logs in again by itself when the saved details allow it.
import crypto from "node:crypto";
import { dfs as fs } from "./storage.mjs";
import { dfsSync as fsSync } from "./storage.mjs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ANGEL_ROOT = "https://apiconnect.angelone.in";
export const DHAN_ROOT = "https://api.dhan.co";
export const DHAN_AUTH_ROOT = "https://auth.dhan.co";
export const GROWW_ROOT = "https://api.groww.in";
export const INDMONEY_ROOT = "https://api.indstocks.com"; // INDmoney's Indian-stocks trading API (INDstocks)

export const READ_ONLY_ROUTES = Object.freeze({
  angel: Object.freeze(["POST /rest/auth/angelbroking/user/v1/loginByPassword", "GET /rest/secure/angelbroking/user/v1/getProfile", "GET /rest/secure/angelbroking/portfolio/v1/getAllHolding",
    "POST /rest/secure/angelbroking/market/v1/quote/", "POST /rest/secure/angelbroking/historical/v1/getCandleData"]), // market data: read-only quotes and daily candles
  dhan: Object.freeze(["POST /app/generateAccessToken", "GET /v2/profile", "GET /v2/holdings", "POST /v2/marketfeed/ltp"]),
  groww: Object.freeze(["POST /v1/token/api/access", "GET /v1/user/detail", "GET /v1/holdings/user", "GET /v1/live-data/ltp"]),
  indmoney: Object.freeze(["GET /user/profile", "GET /portfolio/holdings"])
});
export const BROKER_NAMES = Object.freeze({ angel: "Angel One", dhan: "Dhan", groww: "Groww", indmoney: "INDmoney" });
// The details each broker needs, where to find them, and the .env name that can supply them instead.
export const CREDENTIAL_FIELDS = Object.freeze({
  angel: Object.freeze([
    { name: "apiKey", env: "ANGEL_API_KEY", label: "SmartAPI key", secret: true, help: "smartapi.angelone.in → sign in with your Angel One client ID → My Profile → My APIs → Create an App (Trading APIs). Copy the API key." },
    { name: "clientCode", env: "ANGEL_CLIENT_CODE", label: "Client ID", help: "Angel One app → tap your profile; the client ID is shown under your name (e.g. A1234567)." },
    { name: "pin", env: "ANGEL_PIN", label: "Login PIN (optional)", secret: true, optional: true, help: "Your Angel One login PIN. Save it together with the TOTP secret and the app logs in by itself every day; leave empty to type it when you connect." },
    { name: "totpSecret", env: "ANGEL_TOTP_SECRET", label: "TOTP secret (optional)", secret: true, optional: true, help: "smartapi.angelone.in/enable-totp → the text code shown with the QR code (also scan the QR into your authenticator app). Lets the app create the daily 6-digit code itself." }
  ]),
  dhan: Object.freeze([
    { name: "clientId", env: "DHAN_CLIENT_ID", label: "Client ID", help: "Dhan app → Profile; the Client ID is shown under your name." },
    { name: "accessToken", env: "DHAN_ACCESS_TOKEN", label: "Access token (optional)", secret: true, optional: true, help: "web.dhan.co → My Profile → Access DhanHQ APIs → Generate access token. Valid 24 h, so paste a new one daily, or save PIN + TOTP secret instead." },
    { name: "pin", env: "DHAN_PIN", label: "Dhan PIN (optional)", secret: true, optional: true, help: "Your Dhan login PIN. With the TOTP secret, the app creates the daily access token itself." },
    { name: "totpSecret", env: "DHAN_TOTP_SECRET", label: "TOTP secret (optional)", secret: true, optional: true, help: "web.dhan.co → My Profile → DhanHQ Trading APIs → Setup TOTP → the text code shown with the QR code." }
  ]),
  groww: Object.freeze([
    { name: "apiKey", env: "GROWW_API_KEY", label: "API key", secret: true, help: "groww.in → Profile → Settings → Trading APIs (needs Groww's Trade API subscription) → generate an API key." },
    { name: "apiSecret", env: "GROWW_API_SECRET", label: "API secret (optional)", secret: true, optional: true, help: "Shown once when you generate the API key. Key + secret works after you approve the key on Groww's Trading APIs page each day." },
    { name: "totpSecret", env: "GROWW_TOTP_SECRET", label: "TOTP secret (optional)", secret: true, optional: true, help: "Trading APIs page → generate a TOTP key → the text code shown with the QR code. Key + TOTP secret lets the app log in by itself daily." },
    { name: "accessToken", env: "GROWW_ACCESS_TOKEN", label: "Access token (optional)", secret: true, optional: true, help: "Trading APIs page → generate an access token. Expires 6 AM daily." }
  ]),
  indmoney: Object.freeze([
    { name: "accessToken", env: "INDMONEY_ACCESS_TOKEN", label: "Access token (optional)", secret: true, optional: true, help: "indstocks.com (log in with your INDmoney mobile number) → API Trading → Access Tokens (indstocks.com/app/api-trading/access-tokens); the first time, click Claim Your API Access. Generate and copy the token. It expires after 24 hours, so paste a fresh one each day (or just paste it in the Log in box)." }
  ])
});

export class BrokerError extends Error {
  constructor(message, { loginRequired = false, network = false, setup = false, status = null } = {}) { super(message); Object.assign(this, { loginRequired, network, setup, status }); }
}

// ---- pure helpers (exported for tests) -------------------------------------------------------------
export function base32Decode(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567", clean = String(input || "").toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0; const out = [];
  for (const ch of clean) {
    const i = alphabet.indexOf(ch); if (i < 0) throw new BrokerError("TOTP secret is not valid base32.", { setup: true });
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
// RFC 6238 TOTP (HMAC-SHA1, 30 s, 6 digits): the same code your authenticator app shows for this secret.
export function totp(secret, { time = Date.now(), step = 30, digits = 6 } = {}) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const h = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const off = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(off) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}
const num = v => { if (v === null || v === undefined || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const r2 = v => v === null ? null : Math.round(v * 100) / 100;
// Broker symbols carry the NSE series ("RELIANCE-EQ", "XYZ-BE"); the rest of the app uses the bare NSE symbol.
export const cleanSymbol = s => String(s || "").trim().toUpperCase().replace(/-(EQ|BE|BZ|BL|SM|ST|IL|GB|GS|E\d|N\d|X\d)$/, "");
export function makeHolding({ symbol, exchange, isin, qty, avg, last, pnl, close }) {
  const q = num(qty) || 0, a = num(avg), l = num(last) && num(last) > 0 ? num(last) : null, c = num(close);
  const invested = a !== null ? a * q : null, value = l !== null ? l * q : null;
  const p = num(pnl) ?? (invested !== null && value !== null ? value - invested : null);
  return { symbol: cleanSymbol(symbol), exchange: String(exchange || "NSE").toUpperCase(), isin: isin || null, qty: q, avgPrice: r2(a), lastPrice: r2(l), invested: r2(invested), value: r2(value), pnl: r2(p), dayChangePct: l !== null && c ? r2((l / c - 1) * 100) : null };
}
const keep = list => list.filter(h => h.symbol && h.qty > 0);

// ---- Angel One market data ----
// Angel's public instrument list (OpenAPIScripMaster.json) → "NSE:SYMBOL" / "BSE:SYMBOL" → instrument token.
// NSE cash stocks are listed as "TCS-EQ" (or -BE etc.); BSE ones by their symbol.
export function parseAngelScripMaster(list) {
  const map = {};
  for (const x of Array.isArray(list) ? list : []) {
    const ex = x.exch_seg, tok = String(x.token || ""); if (!tok || (ex !== "NSE" && ex !== "BSE") || (x.instrumenttype && x.instrumenttype !== "")) continue;
    const sym = String(x.symbol || ""), m = ex === "NSE" ? sym.match(/^(.+)-(EQ|BE|BZ|SM|ST)$/) : [null, sym];
    if (!m) continue;
    const key = `${ex}:${m[1].toUpperCase()}`;
    if (!map[key] || /-EQ$/.test(sym)) map[key] = tok; // the main EQ series wins
  }
  return map;
}
// market/v1/quote FULL answer → Map(token → quote)
export function normalizeAngelQuotes(json) {
  const out = new Map(), num = v => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
  for (const q of json?.data?.fetched || []) {
    const ltp = num(q.ltp); if (!(ltp > 0)) continue;
    const t = String(q.exchFeedTime || q.exchTradeTime || ""), m = t.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/);
    const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
    const asOf = m && m[2].toLowerCase() in MON ? new Date(Date.UTC(+m[3], MON[m[2].toLowerCase()], +m[1], +m[4], +m[5], +m[6]) - 5.5 * 3600e3).toISOString() : null; // exchange time is IST
    out.set(String(q.symbolToken), { price: ltp, prevClose: num(q.close), open: num(q.open), dayHigh: num(q.high), dayLow: num(q.low), high52: num(q["52WeekHigh"]), low52: num(q["52WeekLow"]), volume: num(q.tradeVolume), asOf });
  }
  return out;
}
// getCandleData answer → daily bars { t (seconds), o, h, l, c, v }, oldest first
export function normalizeAngelCandles(json) {
  return (Array.isArray(json?.data) ? json.data : []).map(r => ({ t: Math.floor(Date.parse(r[0]) / 1000), o: Number(r[1]), h: Number(r[2]), l: Number(r[3]), c: Number(r[4]), v: Number(r[5]) }))
    .filter(b => Number.isFinite(b.t) && b.c > 0).sort((a, b) => a.t - b.t);
}
export function normalizeAngelHoldings(json) {
  if (json?.data === null || json?.data === "") return []; // Angel answers data:null when the account holds nothing
  const list = Array.isArray(json?.data?.holdings) ? json.data.holdings : Array.isArray(json?.data) ? json.data : null;
  if (!list) throw new BrokerError("Unrecognised holdings response from Angel One.");
  // `quantity` may or may not include unsettled T1 shares depending on the day; realised + T1 covers both cases.
  return keep(list.map(h => makeHolding({ symbol: h.tradingsymbol, exchange: h.exchange, isin: h.isin, qty: Math.max(num(h.quantity) || 0, (num(h.realisedquantity) || 0) + (num(h.t1quantity) || 0)), avg: h.averageprice, last: h.ltp, pnl: null, close: h.close })));
}
export function normalizeDhanHoldings(json) {
  const list = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : null;
  if (!list) throw new BrokerError("Unrecognised holdings response from Dhan.");
  return keep(list.map(h => ({ ...makeHolding({ symbol: h.tradingSymbol, exchange: h.exchange === "ALL" ? "NSE" : h.exchange, isin: h.isin, qty: Math.max(num(h.totalQty) || 0, (num(h.dpQty) || 0) + (num(h.t1Qty) || 0)), avg: h.avgCostPrice, last: h.lastTradedPrice ?? h.ltp }), securityId: h.securityId != null ? String(h.securityId) : null })));
}
export function normalizeGrowwHoldings(json) {
  const list = json?.payload?.holdings ?? json?.holdings;
  if (!Array.isArray(list)) throw new BrokerError("Unrecognised holdings response from Groww.");
  return keep(list.map(h => makeHolding({ symbol: h.trading_symbol, exchange: "NSE", isin: h.isin, qty: h.quantity, avg: h.average_price })));
}
// INDstocks GET /portfolio/holdings: { status, data: [ { symbol, isin, total_qty, avg_price, ... } ] }. No live price in it.
export function normalizeIndmoneyHoldings(json) {
  const list = Array.isArray(json?.data) ? json.data : Array.isArray(json?.data?.holdings) ? json.data.holdings : Array.isArray(json) ? json : null;
  if (!list) throw new BrokerError("Unrecognised holdings response from INDmoney.");
  return keep(list.map(h => makeHolding({ symbol: h.symbol ?? h.trading_symbol, exchange: h.exchange || "NSE", isin: h.isin, qty: num(h.total_qty) ?? ((num(h.dp_qty) || 0) + (num(h.t1_qty) || 0)), avg: h.avg_price ?? h.dp_avg_price, last: h.ltp ?? h.last_price })));
}
// Fills lastPrice/value/pnl from an LTP map (symbol -> price) for holdings the broker returned without a price.
export function applyPrices(holdings, prices) {
  return holdings.map(h => {
    const p = prices.get(h.symbol) ?? (h.securityId ? prices.get(`#${h.securityId}`) : undefined);
    if (h.lastPrice !== null || !Number.isFinite(p) || p <= 0) return h;
    const priced = makeHolding({ symbol: h.symbol, exchange: h.exchange, isin: h.isin, qty: h.qty, avg: h.avgPrice, last: p });
    return h.securityId ? { ...priced, securityId: h.securityId } : priced;
  });
}
const LOGIN_HINT = /invalid (access )?token|token (is )?(expired|invalid|missing)|session (has )?expired|not authori[sz]ed|unauthori[sz]ed|login required|authentication failed/i;
function brokerMessage(json, text) {
  if (json && typeof json === "object") return json.error?.message || json.errorMessage || json.message || json.error_description || (typeof json.error === "string" ? json.error : "") || "";
  return String(text || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}
function macAddress() {
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (!i.internal && i.mac && i.mac !== "00:00:00:00:00:00") return i.mac;
  return "00:00:00:00:00:00";
}
const sixDigits = v => /^\d{6}$/.test(String(v || "").trim());

// ---- clients ---------------------------------------------------------------------------------------
export function createBrokerClients({ env = process.env, fetchImpl = fetch, sessionFile = path.join(here, "data", "broker-sessions.json"), credentialsFile = path.join(here, "data", "broker-credentials.json"), timeoutMs = 20000, now = () => Date.now(), roots = {} } = {}) {
  // Saved details: values entered on the Integrations tab win; .env is the fallback.
  let saved = {};
  try { saved = JSON.parse(fsSync.readFileSync(credentialsFile, "utf8")) || {}; } catch { /* none saved yet */ }
  const fieldOf = (id, name) => CREDENTIAL_FIELDS[id].find(f => f.name === name);
  const val = (id, name) => String(saved[id]?.[name] || env[fieldOf(id, name).env] || "").trim();
  const sourceOf = (id, name) => saved[id]?.[name] ? "app" : env[fieldOf(id, name).env] ? ".env" : null;
  const R = { angel: roots.angel || env.ANGEL_API_ROOT || ANGEL_ROOT, dhan: roots.dhan || DHAN_ROOT, dhanAuth: roots.dhanAuth || DHAN_AUTH_ROOT, groww: roots.groww || GROWW_ROOT, indmoney: roots.indmoney || INDMONEY_ROOT };
  let sessions = null;
  async function load() { if (!sessions) { try { sessions = JSON.parse(await fs.readFile(sessionFile, "utf8")) || {}; } catch { sessions = {}; } } return sessions; }
  async function save() { await fs.mkdir(path.dirname(sessionFile), { recursive: true }); await fs.writeFile(sessionFile, JSON.stringify(sessions, null, 2), { mode: 0o600 }); }
  async function setSession(id, value) { await load(); if (value) sessions[id] = { ...value, savedAt: new Date(now()).toISOString() }; else delete sessions[id]; await save(); }
  async function getSession(id) { await load(); return sessions[id] || null; }

  // The single exit point for every request: refuses anything that is not a read-only route.
  async function request(broker, method, root, route, { headers = {}, body, query = "" } = {}) {
    if (!READ_ONLY_ROUTES[broker].includes(`${method} ${route}`)) throw new BrokerError(`Refusing ${method} ${route}: this app only uses read-only ${BROKER_NAMES[broker]} endpoints.`);
    const url = `${root}${route}${query}`;
    let response;
    try { response = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new BrokerError(`Cannot reach ${BROKER_NAMES[broker]} (${new URL(root).host}): ${e.message}`, { network: true }); }
    const text = await response.text(); let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* HTML error page, handled below */ }
    return { status: response.status, ok: response.ok, json, text };
  }
  const fail = (broker, r, { loginCodes = [] } = {}) => {
    const msg = brokerMessage(r.json, r.text) || `HTTP ${r.status}`;
    const code = r.json?.errorcode || r.json?.errorCode || r.json?.error?.code || "";
    const loginRequired = r.status === 401 || r.status === 403 && LOGIN_HINT.test(msg) || loginCodes.includes(code) || LOGIN_HINT.test(msg);
    return new BrokerError(`${BROKER_NAMES[broker]}: ${msg}${code ? ` (${code})` : ""}${r.status >= 400 ? ` [HTTP ${r.status}]` : ""}`, { loginRequired, status: r.status });
  };
  const needLogin = broker => new BrokerError(`Not connected to ${BROKER_NAMES[broker]}. Log in from the Integrations tab.`, { loginRequired: true });

  // ---------------- Angel One SmartAPI ----------------
  const angelCfg = () => ({ apiKey: val("angel", "apiKey"), clientCode: val("angel", "clientCode"), pin: val("angel", "pin"), totpSecret: val("angel", "totpSecret") });
  const ANGEL_LOGIN_CODES = ["AG8001", "AG8002", "AG8003", "AB1010", "AB8050", "AB8051"];
  function angelHeaders(jwt) {
    const h = { "Content-Type": "application/json", Accept: "application/json", "X-UserType": "USER", "X-SourceID": "WEB", "X-ClientLocalIP": env.ANGEL_LOCAL_IP || "127.0.0.1", "X-ClientPublicIP": env.ANGEL_PUBLIC_IP || "127.0.0.1", "X-MACAddress": env.ANGEL_MAC || macAddress(), "X-PrivateKey": angelCfg().apiKey };
    if (jwt) h.Authorization = `Bearer ${jwt}`;
    return h;
  }
  async function angelGet(route) {
    const s = await getSession("angel"); if (!s?.jwt) throw needLogin("angel");
    const r = await request("angel", "GET", R.angel, route, { headers: angelHeaders(s.jwt) });
    if (!r.ok || !r.json || r.json.status === false) throw fail("angel", r, { loginCodes: ANGEL_LOGIN_CODES });
    return r.json;
  }
  async function angelPost(route, body) {
    const s = await getSession("angel"); if (!s?.jwt) throw needLogin("angel");
    const r = await request("angel", "POST", R.angel, route, { headers: angelHeaders(s.jwt), body });
    if (r.status === 429 || /exceeding access rate|rate limit/i.test(r.text || "")) throw new BrokerError("Angel One: too many requests just now", { rateLimited: true, status: r.status });
    if (!r.ok || !r.json || r.json.status === false) throw fail("angel", r, { loginCodes: ANGEL_LOGIN_CODES });
    return r.json;
  }
  const angel = {
    id: "angel", name: BROKER_NAMES.angel,
    modes() {
      const c = angelCfg(); if (!c.apiKey) return [];
      const modes = [];
      if (c.clientCode && c.pin && c.totpSecret) modes.push({ mode: "auto", label: "Log in with the saved client ID, PIN and TOTP secret (also happens automatically)", fields: [] });
      modes.push({ mode: "manual", label: "Log in", fields: [...(c.clientCode ? [] : [{ name: "clientCode", label: "Client ID", type: "text" }]), { name: "pin", label: "PIN", type: "password" }, ...(c.totpSecret ? [] : [{ name: "totp", label: "6-digit TOTP", type: "text" }])] });
      return modes;
    },
    setupHint: () => angelCfg().apiKey ? null : "Enter your SmartAPI key and client ID under Settings (each field says where to find it).",
    async login(input = {}) {
      const c = angelCfg(); if (!c.apiKey) throw new BrokerError(angel.setupHint(), { setup: true });
      const clientcode = String(input.clientCode || c.clientCode || "").trim().toUpperCase(), password = String(input.pin || c.pin || "").trim();
      const code = String(input.totp || "").trim() || (c.totpSecret ? totp(c.totpSecret, { time: now() }) : "");
      if (!clientcode || !password) throw new BrokerError("Angel One needs your client ID and PIN.", { setup: true });
      if (!sixDigits(code)) throw new BrokerError("Angel One needs the 6-digit TOTP from your authenticator app (or save the TOTP secret in Settings).", { setup: true });
      const r = await request("angel", "POST", R.angel, "/rest/auth/angelbroking/user/v1/loginByPassword", { headers: angelHeaders(), body: { clientcode, password, totp: code } });
      const jwt = String(r.json?.data?.jwtToken || "").replace(/^Bearer\s+/i, "");
      if (!r.ok || r.json?.status === false || !jwt) { const e = fail("angel", r); e.loginRequired = false; throw e; }
      await setSession("angel", { jwt, refreshToken: r.json.data.refreshToken || null, clientCode: clientcode });
      return { connected: true, profile: await angel.profile().catch(() => ({ userId: clientcode, name: null })) };
    },
    async profile() { const j = await angelGet("/rest/secure/angelbroking/user/v1/getProfile"); const p = j.data || {}; return { userId: String(p.clientcode || (await getSession("angel"))?.clientCode || ""), name: p.name || null, email: p.email || null }; },
    async holdings() { return { holdings: normalizeAngelHoldings(await angelGet("/rest/secure/angelbroking/portfolio/v1/getAllHolding")), priceNote: null }; },
    // Live quotes: { NSE: [tokens], BSE: [tokens] }, at most 50 tokens per request (Angel's limit)
    async quotes(exchangeTokens) {
      const out = new Map(), all = Object.entries(exchangeTokens).flatMap(([ex, toks]) => toks.map(t => [ex, String(t)]));
      for (let i = 0; i < all.length; i += 50) {
        const part = {}; for (const [ex, t] of all.slice(i, i + 50)) (part[ex] ||= []).push(t);
        for (const [k, v] of normalizeAngelQuotes(await angelPost("/rest/secure/angelbroking/market/v1/quote/", { mode: "FULL", exchangeTokens: part }))) out.set(k, v);
      }
      return out;
    },
    // Daily candles for one instrument, from / to as "YYYY-MM-DD"
    async candles(exchange, token, from, to) {
      return normalizeAngelCandles(await angelPost("/rest/secure/angelbroking/historical/v1/getCandleData", { exchange, symboltoken: String(token), interval: "ONE_DAY", fromdate: `${from} 09:15`, todate: `${to} 15:30` }));
    },
    connectedForData: async () => !!(await getSession("angel"))?.jwt || !!autoMode("angel"),
    forget: () => setSession("angel", null)
  };

  // ---------------- Dhan (DhanHQ v2) ----------------
  const dhanCfg = () => ({ clientId: val("dhan", "clientId"), accessToken: val("dhan", "accessToken"), pin: val("dhan", "pin"), totpSecret: val("dhan", "totpSecret") });
  const DHAN_LOGIN_CODES = ["DH-901"]; // DH-902 means "no Data API plan / no access", not an expired session
  async function dhanSession() { const s = await getSession("dhan"); if (s?.accessToken) return s; const c = dhanCfg(); return c.accessToken ? { accessToken: c.accessToken, clientId: c.clientId, fromEnv: true } : null; }
  const dhanHeaders = s => ({ "Content-Type": "application/json", Accept: "application/json", "access-token": s.accessToken, ...(s.clientId ? { "client-id": s.clientId } : {}) });
  async function dhanCall(method, route, body) {
    const s = await dhanSession(); if (!s) throw needLogin("dhan");
    const r = await request("dhan", method, R.dhan, route, { headers: dhanHeaders(s), body });
    if (!r.ok || r.json?.status === "failure" || r.json?.errorCode) throw fail("dhan", r, { loginCodes: DHAN_LOGIN_CODES });
    return r.json;
  }
  const dhan = {
    id: "dhan", name: BROKER_NAMES.dhan,
    modes() {
      const c = dhanCfg(), modes = [];
      if (c.clientId && c.pin && c.totpSecret) modes.push({ mode: "totp", label: "Log in with the saved client ID, PIN and TOTP secret (also happens automatically)", fields: [] });
      if (c.accessToken) modes.push({ mode: "env", label: "Use the saved access token", fields: [] });
      modes.push({ mode: "token", label: "Paste an access token (web.dhan.co → My Profile → Access DhanHQ APIs; valid 24 h)", fields: [{ name: "accessToken", label: "Access token", type: "password" }] });
      if (c.clientId && !(c.pin && c.totpSecret)) modes.push({ mode: "totp", label: "Generate a token with PIN + TOTP", fields: [...(c.pin ? [] : [{ name: "pin", label: "Dhan PIN", type: "password" }]), ...(c.totpSecret ? [] : [{ name: "totp", label: "6-digit TOTP", type: "text" }])] });
      return modes;
    },
    setupHint: () => null,
    async login(input = {}) {
      const c = dhanCfg(), mode = input.mode || "token";
      let session;
      if (mode === "env") { if (!c.accessToken) throw new BrokerError("No Dhan access token is saved.", { setup: true }); session = { accessToken: c.accessToken, clientId: c.clientId }; }
      else if (mode === "totp") {
        const pin = String(input.pin || c.pin || "").trim(), code = String(input.totp || "").trim() || (c.totpSecret ? totp(c.totpSecret, { time: now() }) : "");
        if (!c.clientId) throw new BrokerError("Save your Dhan client ID in Settings to log in with PIN + TOTP.", { setup: true });
        if (!pin || !sixDigits(code)) throw new BrokerError("Dhan needs your PIN and the 6-digit TOTP (set up TOTP under DhanHQ Trading APIs on web.dhan.co).", { setup: true });
        const q = `?dhanClientId=${encodeURIComponent(c.clientId)}&pin=${encodeURIComponent(pin)}&totp=${encodeURIComponent(code)}`;
        const r = await request("dhan", "POST", R.dhanAuth, "/app/generateAccessToken", { headers: { Accept: "application/json" }, query: q });
        if (!r.ok || !r.json?.accessToken) { const e = fail("dhan", r); e.loginRequired = false; throw e; }
        session = { accessToken: r.json.accessToken, clientId: String(r.json.dhanClientId || c.clientId), name: r.json.dhanClientName || null, expiresAt: r.json.expiryTime || null };
      } else {
        const token = String(input.accessToken || "").trim();
        if (token.length < 20) throw new BrokerError("Paste the full Dhan access token.", { setup: true });
        session = { accessToken: token, clientId: c.clientId || null };
      }
      // Validate before saving, and learn the client id from the token if .env did not give one.
      const r = await request("dhan", "GET", R.dhan, "/v2/profile", { headers: dhanHeaders(session) });
      if (!r.ok || r.json?.errorCode) throw fail("dhan", r, { loginCodes: DHAN_LOGIN_CODES });
      session.clientId = String(r.json?.dhanClientId || session.clientId || "");
      session.expiresAt = session.expiresAt || r.json?.tokenValidity || null;
      await setSession("dhan", session);
      return { connected: true, profile: await dhan.profile() };
    },
    async profile() { const j = await dhanCall("GET", "/v2/profile"); const s = await dhanSession(); return { userId: String(j?.dhanClientId || s?.clientId || ""), name: s?.name || null, tokenValidity: j?.tokenValidity || null }; },
    async holdings() {
      let holdings;
      try { holdings = normalizeDhanHoldings(await dhanCall("GET", "/v2/holdings")); }
      catch (e) { if (/no holding/i.test(e.message)) return { holdings: [], priceNote: null }; throw e; }
      // Dhan's holdings carry no price. Ask the market-quote API (needs Dhan's Data API plan; 1 request/second).
      const need = holdings.filter(h => h.lastPrice === null && h.securityId);
      if (!need.length) return { holdings, priceNote: null };
      try {
        const body = {}; for (const h of need) (body[h.exchange === "BSE" ? "BSE_EQ" : "NSE_EQ"] ||= []).push(Number(h.securityId));
        const j = await dhanCall("POST", "/v2/marketfeed/ltp", body), prices = new Map();
        for (const seg of Object.values(j?.data || {})) for (const [id, q] of Object.entries(seg || {})) if (num(q?.last_price)) prices.set(`#${id}`, num(q.last_price));
        return { holdings: applyPrices(holdings, prices), priceNote: null };
      } catch (e) { return { holdings, priceNote: `Dhan returned no prices (${e.message}); the watchlist price is used where available. Live quotes need Dhan's Data API plan.` }; }
    },
    forget: () => setSession("dhan", null)
  };

  // ---------------- Groww Trade API ----------------
  const growwCfg = () => ({ apiKey: val("groww", "apiKey"), apiSecret: val("groww", "apiSecret"), accessToken: val("groww", "accessToken"), totpSecret: val("groww", "totpSecret") });
  async function growwSession() { const s = await getSession("groww"); if (s?.accessToken) return s; const c = growwCfg(); return c.accessToken ? { accessToken: c.accessToken, fromEnv: true } : null; }
  const growwHeaders = token => ({ Accept: "application/json", "Content-Type": "application/json", "X-API-VERSION": "1.0", Authorization: `Bearer ${token}` });
  async function growwGet(route, query = "", token) {
    const s = token ? { accessToken: token } : await growwSession(); if (!s) throw needLogin("groww");
    const r = await request("groww", "GET", R.groww, route, { headers: growwHeaders(s.accessToken), query });
    if (!r.ok || r.json?.status === "FAILURE") throw fail("groww", r, { loginCodes: ["GA005"] });
    return r.json;
  }
  const groww = {
    id: "groww", name: BROKER_NAMES.groww,
    modes() {
      const c = growwCfg(), modes = [];
      if (c.apiKey && c.totpSecret) modes.push({ mode: "totp", label: "Log in with the saved API key and TOTP secret (also happens automatically)", fields: [] });
      if (c.accessToken) modes.push({ mode: "env", label: "Use the saved access token", fields: [] });
      modes.push({ mode: "token", label: "Paste an access token (groww.in → Trading APIs; expires 6 AM daily)", fields: [{ name: "accessToken", label: "Access token", type: "password" }] });
      if (c.apiKey && c.apiSecret) modes.push({ mode: "approval", label: "Get a token with API key + secret (approve the key on Groww's API Keys page first, each day)", fields: [] });
      if (c.apiKey && !c.totpSecret) modes.push({ mode: "totp", label: "Get a token with API key + 6-digit TOTP", fields: [{ name: "totp", label: "6-digit TOTP", type: "text" }] });
      return modes;
    },
    setupHint: () => null,
    async login(input = {}) {
      const c = growwCfg(), mode = input.mode || "token";
      let token, expiresAt = null;
      if (mode === "env") { if (!c.accessToken) throw new BrokerError("No Groww access token is saved.", { setup: true }); token = c.accessToken; }
      else if (mode === "approval" || mode === "totp") {
        if (!c.apiKey) throw new BrokerError("Save your Groww API key in Settings first.", { setup: true });
        let body;
        if (mode === "approval") {
          if (!c.apiSecret) throw new BrokerError("Save your Groww API secret in Settings for the key + secret flow.", { setup: true });
          const timestamp = String(Math.floor(now() / 1000));
          body = { key_type: "approval", checksum: crypto.createHash("sha256").update(c.apiSecret + timestamp).digest("hex"), timestamp };
        } else {
          const code = String(input.totp || "").trim() || (c.totpSecret ? totp(c.totpSecret, { time: now() }) : "");
          if (!sixDigits(code)) throw new BrokerError("Groww needs the 6-digit TOTP for your API key (or save the TOTP secret in Settings).", { setup: true });
          body = { key_type: "totp", totp: code };
        }
        const r = await request("groww", "POST", R.groww, "/v1/token/api/access", { headers: { ...growwHeaders(c.apiKey) }, body });
        const p = r.json?.payload || r.json || {};
        if (!r.ok || r.json?.status === "FAILURE" || !p.token) { const e = fail("groww", r); e.loginRequired = false; throw e; }
        token = p.token; expiresAt = p.expiry || null;
      } else {
        token = String(input.accessToken || "").trim();
        if (token.length < 20) throw new BrokerError("Paste the full Groww access token.", { setup: true });
      }
      const j = await growwGet("/v1/user/detail", "", token); // validate before saving
      await setSession("groww", { accessToken: token, expiresAt, userId: String(j?.payload?.ucc || j?.payload?.vendor_user_id || "") });
      return { connected: true, profile: await groww.profile() };
    },
    async profile() { const j = await growwGet("/v1/user/detail"); const p = j?.payload || {}; return { userId: String(p.ucc || p.vendor_user_id || ""), name: null }; },
    async ltp(symbols) {
      const prices = new Map(), list = [...new Set(symbols.map(cleanSymbol))].filter(Boolean);
      for (let i = 0; i < list.length; i += 50) {
        const batch = list.slice(i, i + 50);
        const j = await growwGet("/v1/live-data/ltp", `?segment=CASH&exchange_symbols=${batch.map(s => encodeURIComponent(`NSE_${s}`)).join(",")}`);
        for (const [k, v] of Object.entries(j?.payload || {})) { const p = num(v?.ltp ?? v); if (p) prices.set(k.replace(/^NSE_/, "").toUpperCase(), p); }
      }
      return prices;
    },
    async holdings() {
      const holdings = normalizeGrowwHoldings(await growwGet("/v1/holdings/user"));
      if (!holdings.length) return { holdings, priceNote: null };
      // Groww's holdings carry no price; fetch LTPs (50 per call). Live data may need Groww's Trade API subscription.
      try { return { holdings: applyPrices(holdings, await groww.ltp(holdings.map(h => h.symbol))), priceNote: null }; }
      catch (e) { return { holdings, priceNote: `Groww returned no prices (${e.message}); the watchlist price is used where available.` }; }
    },
    forget: () => setSession("groww", null)
  };

  // ---------------- INDmoney (INDstocks API) ----------------
  // Token-only: generate a 24-hour access token on indstocks.com and paste it (or save it under Settings). Read-only routes only.
  const indToken = async () => (await getSession("indmoney"))?.accessToken || val("indmoney", "accessToken");
  async function indGet(route, token) {
    const t = token || await indToken(); if (!t) throw needLogin("indmoney");
    const r = await request("indmoney", "GET", R.indmoney, route, { headers: { Authorization: t, Accept: "application/json" } });
    if (!r.ok || r.json?.status === "error" || r.json?.status === "failure") throw fail("indmoney", r);
    return r.json;
  }
  const indmoney = {
    id: "indmoney", name: BROKER_NAMES.indmoney,
    modes() {
      const modes = [];
      if (val("indmoney", "accessToken")) modes.push({ mode: "env", label: "Use the saved access token", fields: [] });
      modes.push({ mode: "token", label: "Paste today's access token (indstocks.com → API Trading → Access Tokens; valid 24 h)", fields: [{ name: "accessToken", label: "Access token", type: "password" }] });
      return modes;
    },
    setupHint: () => null,
    async login(input = {}) {
      const token = String(input.mode === "env" ? val("indmoney", "accessToken") : input.accessToken || "").trim();
      if (token.length < 20) throw new BrokerError("Paste the full INDmoney access token (indstocks.com → API Trading → Access Tokens).", { setup: true });
      const j = await indGet("/user/profile", token); // validate before saving
      const d = j?.data || {};
      await setSession("indmoney", { accessToken: token, clientId: String(d.user_id || d.demat_id || ""), name: [d.first_name, d.last_name].filter(Boolean).join(" ") || null });
      return { connected: true, profile: await indmoney.profile() };
    },
    async profile() { const d = (await indGet("/user/profile"))?.data || {}; return { userId: String(d.user_id || d.demat_id || ""), name: [d.first_name, d.last_name].filter(Boolean).join(" ") || null }; },
    async holdings() {
      const holdings = normalizeIndmoneyHoldings(await indGet("/portfolio/holdings"));
      return { holdings, priceNote: holdings.some(h => h.lastPrice === null) ? "INDmoney's holdings API has no live price: valued at another broker's price or the watchlist price." : null };
    },
    forget: () => setSession("indmoney", null)
  };

  const clients = { angel, dhan, groww, indmoney };

  // Automatic login: which mode can run with no typing, from the saved details.
  function autoMode(id) {
    if (id === "angel") { const c = angelCfg(); return c.apiKey && c.clientCode && c.pin && c.totpSecret ? "auto" : null; }
    if (id === "dhan") { const c = dhanCfg(); return c.clientId && c.pin && c.totpSecret ? "totp" : null; }
    if (id === "indmoney") return null; // INDmoney tokens are generated by hand each day
    const c = growwCfg(); return c.apiKey && c.totpSecret ? "totp" : c.apiKey && c.apiSecret ? "approval" : null;
  }
  const autoBusy = {}, autoLast = {};
  // Runs fn; when the broker says "not logged in" and the saved details allow it, logs in by itself once and retries.
  // Failed attempts are spaced 2 minutes apart so an expired secret cannot hammer the broker's login endpoint.
  async function withAutoLogin(c, fn) {
    try { return await fn(); }
    catch (e) {
      const mode = autoMode(c.id);
      if (!e.loginRequired || !mode || autoBusy[c.id] || now() - (autoLast[c.id] || 0) < 120000) throw e;
      autoBusy[c.id] = true; autoLast[c.id] = now();
      try { await c.login({ mode }); autoLast[c.id] = 0; console.log(`[${c.id}] Logged in automatically with the saved details.`); }
      catch (le) { throw new BrokerError(`${e.message} Automatic login also failed: ${le.message}`, { loginRequired: true }); }
      finally { autoBusy[c.id] = false; }
      return fn();
    }
  }
  for (const c of Object.values(clients)) {
    for (const k of ["profile", "holdings", "quotes", "candles"]) { const raw = c[k]; if (!raw) continue; c[k] = (...args) => autoBusy[c.id] ? raw.apply(c, args) : withAutoLogin(c, () => raw.apply(c, args)); }
    c.autoMode = () => autoMode(c.id);
    // Account details for this broker's MCP server (server-side only, never sent to the page): saved settings plus the
    // current day-session token when the REST login made one.
    c.accountInfo = async () => {
      const info = Object.fromEntries(CREDENTIAL_FIELDS[c.id].map(f => [f.name, val(c.id, f.name)]));
      const s = c.id === "dhan" ? await dhanSession() : c.id === "groww" ? await growwSession() : await getSession(c.id);
      if (s?.accessToken) info.accessToken = s.accessToken;
      if (s?.jwt) info.jwt = s.jwt;
      if (s?.clientId && !info.clientId) info.clientId = s.clientId;
      return info;
    };
    c.settings = () => CREDENTIAL_FIELDS[c.id].map(f => {
      const v = val(c.id, f.name), src = sourceOf(c.id, f.name);
      return { name: f.name, label: f.label, help: f.help, secret: !!f.secret, optional: !!f.optional, envName: f.env, set: !!v, source: src, preview: !v ? null : !f.secret ? v : f.name === "pin" || f.name === "totpSecret" || v.length < 16 ? "••••" : `••••${v.slice(-4)}` }; // PINs and TOTP secrets are never echoed back, not even in part
    });
    // Saves details typed on the Integrations tab. Empty values leave a field as it is; `clear` removes saved fields.
    c.saveSettings = async ({ values = {}, clear = [] } = {}) => {
      const next = { ...(saved[c.id] || {}) }, before = JSON.stringify(next);
      for (const f of CREDENTIAL_FIELDS[c.id]) {
        const v = String(values[f.name] ?? "").trim();
        if (clear.includes(f.name)) delete next[f.name];
        else if (v) {
          if (f.name === "totpSecret") base32Decode(v); // throws a readable error for a mistyped secret
          if (v.length > 2000) throw new BrokerError(`${f.label} is too long.`, { setup: true });
          next[f.name] = f.name === "clientCode" ? v.toUpperCase() : v;
        }
      }
      if (JSON.stringify(next) === before) return c.settings();
      const identity = ["apiKey", "clientCode", "clientId", "accessToken"].some(k => (saved[c.id]?.[k] || "") !== (next[k] || ""));
      saved = { ...saved, [c.id]: next }; if (!Object.keys(next).length) delete saved[c.id];
      await fs.mkdir(path.dirname(credentialsFile), { recursive: true });
      await fs.writeFile(credentialsFile, JSON.stringify(saved, null, 2), { mode: 0o600 });
      await fs.chmod(credentialsFile, 0o600).catch(() => {});
      if (identity) await setSession(c.id, null); // a different key or account: the old session no longer applies
      autoLast[c.id] = 0;
      return c.settings();
    };
    c.status = async function () {
      const modes = c.modes(), hint = c.setupHint(), s = c.id === "dhan" ? await dhanSession() : c.id === "groww" ? await growwSession() : await getSession(c.id);
      const base = { id: c.id, name: c.name, configured: modes.length > 0, setupHint: hint, modes, settings: c.settings(), autoLogin: !!autoMode(c.id), expiresAt: s?.expiresAt || null, tokenFromSettings: !!s?.fromEnv };
      if ((!s || (c.id === "angel" && !s.jwt)) && !autoMode(c.id)) return { ...base, connected: false, loginRequired: modes.length > 0 };
      try { return { ...base, connected: true, profile: await c.profile() }; }
      catch (e) { return { ...base, connected: false, loginRequired: !!e.loginRequired, error: e.loginRequired && !autoMode(c.id) ? null : e.message }; }
    };
  }
  return clients;
}
export const brokers = createBrokerClients();
