// Angel One and Dhan through an MCP server, like Zerodha's Kite MCP: the app connects to the broker's MCP server,
// passes your saved account details (client ID, access token, API key, …) to it, discovers its tools and reads your
// profile and holdings. Holdings land in the same table as every other broker.
//
// Where the server comes from (Integrations tab → broker card → Connection: MCP server):
//   - a hosted server URL (Streamable HTTP). Typed in the app or set as ANGEL_MCP_URL / DHAN_MCP_URL. Login is the
//     standard MCP OAuth consent page when the server asks for it; for Dhan the access token and client ID are also
//     sent as headers.
//   - a local server started from a command (stdio): ANGEL_MCP_COMMAND / DHAN_MCP_COMMAND in .env only. Commands are
//     deliberately not settable from the browser. Your saved details are passed to it as environment variables.
// Dhan publishes an official MCP server (docs.dhanhq.co/mcp). Angel One has none of its own; community servers
// (e.g. github.com/pyalgobot/angelone-mcp) can be run locally with the command option.
//
// SAFETY: only read-only tools can run (isReadOnlyTool). Anything that sounds like trading, order/GTT/alert changes,
// fund movement or margin is refused before a request is made, whatever the server offers.
import { dfsSync as fsSync } from "./storage.mjs";
import { dfs as fs } from "./storage.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpClient, createOAuth, McpError } from "./mcp-client.mjs";
import { extractLoginUrl } from "./kite-mcp.mjs";
import { makeHolding, BROKER_NAMES } from "./brokers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const MCP_BROKERS = Object.freeze(["angel", "dhan", "indmoney"]);
// Built-in server URLs (can still be changed in the card or .env).
export const DEFAULT_MCP_URLS = Object.freeze({ indmoney: "https://mcp.indmoney.com/mcp" });
// INDmoney's MCP server is read-only by design (no trading or money movement exists in it) and names its tools without
// a get_ prefix, so its read tools are allowed by name. The general deny-list still applies on top.
const INDMONEY_READ = new Set(["networth_snapshot", "networth_holdings", "networth_allocation_breakdown", "mf_sips", "indian_stocks_sips", "user_watchlist", "lookup_ind_keys", "get_mf_by_category", "get_mf_funds_details", "get_us_stocks_details"]);

const DENY = /order|gtt|trade|modify|cancel|place|convert|exit|square|kill|transfer|withdraw|pledge|create|delete|update|edit|set_|alert|forever|super|basket|bracket|cover|buy|sell|margin|payout|fund_?add|logout|subscribe|webhook|postback|execute|submit/i;
const READ = /^(get|fetch|list|search|view|show|read|find)([_\-.][a-z0-9_\-.]*)?$/i;
const LOGIN = /^(login|log_in|authenticate|auth|get_login_url|login_url|generate_session|connect)$/i;
export const isReadOnlyTool = (name, broker = null) => typeof name === "string" && name.length <= 80 && !DENY.test(name) && (READ.test(name) || LOGIN.test(name) || (broker === "indmoney" && INDMONEY_READ.has(name)));
const allowFor = id => name => isReadOnlyTool(name, id);

const PICK = {
  holdings: [/^networth_holdings$/i, /^get_?all_?holdings$/i, /^get_?holdings?$/i, /^holdings$/i, /^(get|fetch|list)_?(portfolio_?)?holdings?/i, /holding/i, /^(get|fetch)_?portfolio$/i],
  profile: [/^get_?profile$/i, /^(get_)?(user|client)_?(profile|details?|info)$/i, /profile/i]
};
export function pickTool(tools, kind, broker = null) {
  const usable = tools.filter(t => t.allowed !== false && isReadOnlyTool(t.name, broker));
  if (kind === "login") return usable.find(t => LOGIN.test(t.name))?.name || null;
  for (const re of PICK[kind]) { const t = usable.find(x => re.test(x.name)); if (t) return t.name; }
  return null;
}

const num = v => { if (v === null || v === undefined || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
function unwrapList(json) {
  let x = json;
  for (let i = 0; i < 5 && x && !Array.isArray(x) && typeof x === "object"; i++) x = x.holdings ?? x.data ?? x.payload ?? x.result ?? x.items ?? x.content ?? null;
  return Array.isArray(x) ? x : null;
}
// Holdings from any broker's MCP tool: Angel (SmartAPI), Dhan (v2), Kite and Groww field names are all recognised.
export function normalizeMcpHoldings(json) {
  const list = unwrapList(json);
  if (!list) throw new McpError("The MCP holdings tool did not return a list this app recognises (expected JSON).");
  return list.map(h => {
    let qty;
    if (h.totalQty !== undefined) qty = Math.max(num(h.totalQty) || 0, (num(h.dpQty) || 0) + (num(h.t1Qty) || 0));
    else if (h.realisedquantity !== undefined) qty = Math.max(num(h.quantity) || 0, (num(h.realisedquantity) || 0) + (num(h.t1quantity) || 0));
    else if (h.tradingsymbol !== undefined && h.t1_quantity !== undefined) qty = (num(h.quantity) || 0) + (num(h.t1_quantity) || 0);
    else qty = num(h.quantity ?? h.qty ?? h.net_quantity ?? h.netQty ?? h.holding_quantity ?? h.holdingQuantity) || 0;
    const exchange = h.exchange === "ALL" ? "NSE" : h.exchange;
    return makeHolding({ symbol: h.tradingsymbol ?? h.tradingSymbol ?? h.trading_symbol ?? h.symbol ?? h.ticker, exchange, isin: h.isin, qty,
      avg: h.averageprice ?? h.average_price ?? h.avgCostPrice ?? h.avg_price ?? h.averagePrice ?? h.avgPrice ?? h.buy_avg,
      last: h.ltp ?? h.last_price ?? h.lastTradedPrice ?? h.lastPrice ?? h.LTP, close: h.close ?? h.close_price ?? h.previousClose ?? h.prev_close });
  }).filter(h => h.symbol && h.qty > 0);
}
// INDmoney networth_holdings: positions across asset classes (Indian stocks, mutual funds, US stocks, others). The exact
// response shape is not published, so this walks any JSON and recognises positions by their fields and by the name of the
// group they sit in. Returns { stocks, mf, us, other }.
const NAME_K = ["name", "instrument_name", "scheme_name", "schemeName", "stock_name", "security_name", "company_name", "fund_name", "display_name", "displayName", "title", "asset_name"];
const VALUE_K = ["current_value", "currentValue", "market_value", "marketValue", "value", "current_amount", "currentAmount", "present_value", "networth", "amount"];
const pickK = (o, ks) => { for (const k of ks) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };
const classOf = s => { s = String(s || "").toLowerCase(); return /mutual|^mf|_mf|fund|scheme/.test(s) ? "mf" : /\bus\b|us_?stock|global|international|foreign|usa/.test(s) ? "us" : /stock|equity|share|ind(ian)?_?stocks?/.test(s) ? "stock" : s ? "other" : null; };
export function normalizeIndmoneyPositions(json, startClass = null) {
  const out = { stocks: [], mf: [], us: [], other: [] }, seen = new Set(), fixed = startClass && startClass !== "other" ? startClass : null;
  const visit = (x, ctx, depth) => {
    if (!x || depth > 7) return;
    if (Array.isArray(x)) { for (const y of x) visit(y, ctx, depth + 1); return; }
    if (typeof x !== "object") return;
    const name = pickK(x, NAME_K), value = num(pickK(x, VALUE_K)), qty = num(pickK(x, ["quantity", "qty", "units", "shares", "total_units", "totalUnits", "holding_quantity"]));
    const ownClass = classOf(pickK(x, ["asset_class", "assetClass", "asset_type", "assetType", "instrument_type", "instrumentType", "category", "segment", "type", "product"]));
    if (name && (value !== null || qty !== null) && !Object.values(x).some(v => Array.isArray(v) && v.length && typeof v[0] === "object")) {
      const cls = fixed || ownClass || ctx || "other", key = `${cls}|${name}|${x.isin || ""}|${x.folio || x.folio_number || ""}`;
      if (seen.has(key)) return; seen.add(key);
      const avg = num(pickK(x, ["avg_price", "average_price", "avgPrice", "averagePrice", "avg_buy_price", "buy_avg", "avg_nav", "average_nav", "avgNav", "purchase_nav", "avg_cost"]));
      const last = num(pickK(x, ["ltp", "last_price", "lastPrice", "current_price", "currentPrice", "price", "nav", "current_nav", "currentNav"]));
      const invested = num(pickK(x, ["invested_value", "investedValue", "invested_amount", "investedAmount", "invested", "cost_value", "costValue", "buy_value"]));
      const cur = value ?? (qty !== null && last !== null ? qty * last : null);
      const base = { name: String(name).trim(), isin: x.isin ? String(x.isin).toUpperCase() : null, qty, avg, last, invested: invested ?? (qty !== null && avg !== null ? qty * avg : null), value: cur, pnl: num(pickK(x, ["pnl", "total_pnl", "returns", "gain", "unrealised_pnl", "unrealized_pnl"])), xirr: num(pickK(x, ["xirr", "XIRR"])) };
      if (cls === "mf") out.mf.push({ isin: base.isin || `NAME:${base.name.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 40)}`, name: base.name, folio: x.folio ?? x.folio_number ?? x.folioNumber ?? null, units: qty, avgNav: avg, nav: last, navDate: x.nav_date || x.navDate || null, invested: base.invested, value: cur, pnl: base.pnl ?? (cur !== null && base.invested !== null ? cur - base.invested : null) });
      else if (cls === "us") out.us.push({ symbol: String(pickK(x, ["symbol", "ticker", "trading_symbol"]) || "").toUpperCase() || null, ...base });
      else if (cls === "stock") out.stocks.push({ symbol: String(pickK(x, ["symbol", "trading_symbol", "tradingsymbol", "nse_symbol", "nseSymbol", "ticker", "bse_code"]) || "").toUpperCase().replace(/-EQ$/, "") || null, exchange: x.exchange || "NSE", ...base });
      else out.other.push({ class: String(pickK(x, ["asset_class", "assetClass", "asset_type", "category", "type"]) || ctx || "other"), ...base });
      return;
    }
    for (const [k, v] of Object.entries(x)) if (v && typeof v === "object") visit(v, classOf(k) && classOf(k) !== "other" ? classOf(k) : ownClass && ownClass !== "other" ? ownClass : ctx, depth + 1);
  };
  visit(json, startClass, 0);
  return out;
}
// Values a tool's argument accepts, from its JSON schema (enum, anyOf/oneOf consts, $ref to an enum definition).
export function schemaChoices(schema, prop) {
  const p = schema?.properties?.[prop]; if (!p) return [];
  const resolve = x => { if (x?.$ref) { const k = x.$ref.split("/").pop(); return schema.$defs?.[k] || schema.definitions?.[k] || x; } return x; };
  const q = resolve(p), out = [];
  for (const x of [q, resolve(q.items), ...(q.anyOf || []), ...(q.oneOf || [])].filter(Boolean).map(resolve)) { if (Array.isArray(x.enum)) out.push(...x.enum); if (x.const !== undefined) out.push(x.const); }
  return [...new Set(out.filter(v => typeof v === "string" || typeof v === "number"))];
}
// Arguments for a tool call: the given ones, plus a sensible value for every other required argument (default, first choice).
export function argsFor(schema, given = {}) {
  const args = { ...given };
  for (const k of schema?.required || []) if (args[k] === undefined) { const p = schema.properties?.[k] || {}; const c = schemaChoices(schema, k); if (p.default !== undefined) args[k] = p.default; else if (c.length) args[k] = c[0]; else if (p.type === "boolean") args[k] = false; }
  return args;
}
const IND_ASSET_GUESSES = ["indian_stocks", "mutual_funds", "us_stocks", "INDIAN_STOCKS", "MUTUAL_FUNDS", "US_STOCKS", "stocks", "mf", "us"];
export function normalizeMcpProfile(json) {
  let p = json; for (let i = 0; i < 3 && p && typeof p === "object" && !Array.isArray(p) && (p.data || p.payload || p.result) && !(p.clientcode || p.dhanClientId); i++) p = p.data ?? p.payload ?? p.result;
  if (!p || typeof p !== "object") return null;
  const id = p.clientcode ?? p.clientCode ?? p.dhanClientId ?? p.client_id ?? p.clientId ?? p.user_id ?? p.userId ?? p.ucc;
  return id ? { userId: String(id), name: p.name ?? p.user_name ?? p.clientName ?? p.dhanClientName ?? null } : null;
}

// Saved account details -> what each kind of server expects.
function stdioEnv(id, a) {
  if (id === "angel") return Object.fromEntries(Object.entries({ ANGELONE_API_KEY: a.apiKey, ANGELONE_CLIENT_CODE: a.clientCode, ANGELONE_PIN: a.pin, ANGELONE_TOTP_SECRET: a.totpSecret, ANGEL_API_KEY: a.apiKey, ANGEL_CLIENT_CODE: a.clientCode, ANGEL_PIN: a.pin, ANGEL_TOTP_SECRET: a.totpSecret, SMARTAPI_API_KEY: a.apiKey, SMARTAPI_CLIENT_CODE: a.clientCode }).filter(([, v]) => v));
  return Object.fromEntries(Object.entries({ DHAN_CLIENT_ID: a.clientId, DHAN_ACCESS_TOKEN: a.accessToken }).filter(([, v]) => v));
}
function httpHeaders(id, a) {
  if (id === "dhan" && a.accessToken) return { "access-token": a.accessToken, ...(a.clientId ? { "client-id": a.clientId } : {}) };
  return {};
}

export function createBrokerMcp({ brokers, env = process.env, file = path.join(here, "data", "broker-mcp.json"), redirectUri = () => "http://localhost:4173/api/brokers/mcp/callback", fetchImpl = fetch, spawnImpl, now = () => Date.now(), timeoutMs } = {}) {
  let store = {};
  try { store = JSON.parse(fsSync.readFileSync(file, "utf8")) || {}; } catch { /* nothing yet */ }
  let writing = Promise.resolve();
  const persist = () => { writing = writing.then(async () => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(store, null, 2), { mode: 0o600 }); await fs.chmod(file, 0o600).catch(() => {}); }); return writing; };
  const part = (id, key) => ({ get: () => store[id]?.[key] ?? null, set: async v => { store[id] = { ...(store[id] || {}), [key]: v }; await persist(); } });

  const out = {};
  for (const id of MCP_BROKERS) {
    const ENV = id.toUpperCase();
    let client = null, clientKey = null, oauth = null, oauthUrl = null, toolCache = null;
    const config = () => {
      const savedUrl = store[id]?.url || "", envUrl = env[`${ENV}_MCP_URL`] || "", command = env[`${ENV}_MCP_COMMAND`] || "", builtIn = DEFAULT_MCP_URLS[id] || "";
      const url = savedUrl || envUrl || (command ? "" : builtIn), transport = url ? "http" : command ? "stdio" : null;
      return { via: store[id]?.via === "mcp" || (id === "indmoney" && store[id]?.via !== "api") ? "mcp" : "api", url, urlSource: savedUrl ? "app" : envUrl ? ".env" : url && url === builtIn ? "built-in" : null, command, transport, configured: !!transport };
    };
    const oauthFor = url => { if (!oauth || oauthUrl !== url) { oauth = createOAuth({ mcpUrl: url, store: part(id, "oauth"), fetchImpl, now }); oauthUrl = url; } return oauth; };
    async function getClient() {
      const c = config(); if (!c.transport) throw new McpError(`No ${BROKER_NAMES[id]} MCP server is set. Enter its URL in the card${id === "angel" ? " or set ANGEL_MCP_COMMAND in .env" : ""}.`);
      const account = await brokers[id].accountInfo();
      const key = JSON.stringify([c.transport, c.url, c.command, c.transport === "stdio" ? stdioEnv(id, account) : null]);
      if (!client || key !== clientKey) {
        await client?.close().catch(() => {});
        const label = `${BROKER_NAMES[id]} MCP`;
        client = c.transport === "stdio"
          ? createMcpClient({ label, transport: "stdio", command: c.command, env: stdioEnv(id, account), isAllowed: allowFor(id), spawnImpl, timeoutMs })
          : createMcpClient({ label, transport: "http", url: c.url, headers: async () => httpHeaders(id, await brokers[id].accountInfo()), oauth: oauthFor(c.url), isAllowed: allowFor(id), fetchImpl, session: part(id, "session"), timeoutMs });
        clientKey = key; toolCache = null;
      }
      return client;
    }
    async function tools() { const c = await getClient(); if (!toolCache) toolCache = await c.listTools(); return toolCache; }
    async function run(kind, args = {}) {
      const list = await tools(), name = pickTool(list, kind, id);
      if (!name) throw new McpError(`The ${BROKER_NAMES[id]} MCP server has no read-only ${kind} tool. Its tools: ${list.map(t => t.name).join(", ") || "(none)"}.`);
      return (await getClient()).callTool(name, args);
    }
    // Retries once after the server's own login tool when it reports "not logged in" (community servers log in with
    // the TOTP secret you saved; hosted ones answer with a link, which is passed back to the page).
    async function withLogin(fn) {
      try { return await fn(); }
      catch (e) {
        if (!e.loginRequired) throw e;
        const login = pickTool(await tools(), "login", id); if (!login) throw e;
        const r = await (await getClient()).callTool(login, {});
        const link = extractLoginUrl(r.text);
        if (link) { const err = new McpError(`Open the ${BROKER_NAMES[id]} login page to finish signing in.`, { loginRequired: true }); err.loginUrl = link; throw err; }
        return fn();
      }
    }
    // INDmoney's networth_holdings needs an asset_type: call it once per type the tool accepts (read from its schema),
    // and read each answer knowing which asset class it is.
    async function indmoneyHoldings() {
      const list = await tools(), t = list.find(x => x.name === "networth_holdings");
      if (!t) throw new McpError(`INDmoney's MCP server has no networth_holdings tool. Its tools: ${list.map(x => x.name).join(", ")}.`);
      const schema = t.inputSchema || {}, needs = (schema.required || []).includes("asset_type") || !!schema.properties?.asset_type;
      let choices = needs ? schemaChoices(schema, "asset_type").map(String) : [null];
      if (needs && !choices.length) choices = IND_ASSET_GUESSES;
      // An "all" choice would repeat everything: use the specific ones when there are any.
      const specific = choices.filter(v => v === null || !/^(all|total|overall|everything)$/i.test(v)); if (specific.length) choices = specific;
      const parts = [], errors = [];
      for (const v of choices) {
        try {
          const r = await withLogin(() => getClient().then(c => c.callTool("networth_holdings", argsFor(schema, v === null ? {} : { asset_type: v }))));
          if (r.json === null) { if (!/no (holdings|investments|data)|empty|not found/i.test(r.text)) errors.push(`${v}: ${String(r.text).slice(0, 120)}`); continue; }
          parts.push({ value: v, text: r.text, parsed: normalizeIndmoneyPositions(r.json, v ? classOf(v) : null) });
        } catch (e) { if (e.loginRequired || e.authRequired) throw e; errors.push(`${v}: ${String(e.message).slice(0, 160)}`); }
      }
      return { parts, errors, choices };
    }
    const api = {
      id, name: BROKER_NAMES[id], config,
      async setConfig({ via, url } = {}) {
        if (via !== undefined) store[id] = { ...(store[id] || {}), via: via === "mcp" ? "mcp" : "api" };
        if (url !== undefined) {
          const u = String(url || "").trim();
          if (u && !/^https:\/\/|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(u)) throw new McpError("The MCP server URL must start with https:// (or http://localhost for a server on this computer).", {});
          if (u !== (store[id]?.url || "")) { store[id] = { ...(store[id] || {}), url: u || undefined, session: null }; client = null; toolCache = null; }
        }
        await persist(); return config();
      },
      async status() {
        const c = config(), base = { id, name: BROKER_NAMES[id], ...c, readOnlyRule: "Only get/fetch/list/search/view tools and the login tool can run; anything about orders, trades, GTT, alerts, funds or margin is refused." };
        if (!c.configured) return { ...base, connected: false };
        try {
          const list = await tools();
          const allowed = list.filter(t => t.allowed).map(t => t.name), blocked = list.filter(t => !t.allowed).map(t => t.name);
          let profile = null, loginRequired = false;
          // A local server logs in with the saved details, so let it do that here; a hosted one waits for Connect.
          const viaLogin = fn => c.transport === "stdio" ? withLogin(fn) : fn();
          try { const p = pickTool(list, "profile", id); if (p) profile = normalizeMcpProfile((await viaLogin(() => (getClient()).then(cl => cl.callTool(p)))).json); } catch (e) { if (e.loginRequired || e.authRequired) loginRequired = true; else throw e; }
          return { ...base, connected: !loginRequired, loginRequired, profile, tools: { allowed, blocked, holdings: pickTool(list, "holdings", id), profile: pickTool(list, "profile", id), login: pickTool(list, "login", id) }, serverInfo: c.transport === "http" ? part(id, "session").get()?.serverInfo || null : null };
        } catch (e) { return { ...base, connected: false, authRequired: !!e.authRequired, loginRequired: !!e.loginRequired, error: e.authRequired ? null : e.message }; }
      },
      // Starts whatever login the server needs: an OAuth consent page, the server's own login link, or nothing.
      async connect() {
        const c = config();
        try { await tools(); }
        catch (e) {
          if (!e.authRequired || c.transport !== "http") throw e;
          toolCache = null;
          return { authUrl: (await oauthFor(c.url).start({ redirectUri: redirectUri(), wwwAuthenticate: e.wwwAuthenticate })).authUrl };
        }
        try { await withLogin(() => run("profile")); } catch (e) { if (e.loginUrl) return { loginUrl: e.loginUrl }; if (!/no read-only profile tool/.test(e.message)) throw e; }
        return { connected: true };
      },
      async finishOAuth({ code, state }) { const c = config(); await oauthFor(c.url).finish({ code, state }); client = null; toolCache = null; await part(id, "session").set(null); },
      ownsState: state => !!state && store[id]?.oauth?.pending?.state === state,
      async profile() {
        let p = null;
        try { p = normalizeMcpProfile((await withLogin(() => run("profile"))).json); } catch (e) { if (!/no read-only profile tool/.test(e.message)) throw e; }
        if (!p?.userId && id === "indmoney") return { userId: "INDMONEY", name: "INDmoney" }; // INDmoney's MCP has no profile tool: one account per login
        const a = await brokers[id].accountInfo(), fallback = a.clientCode || a.clientId;
        if (!p?.userId && !fallback) throw new McpError(`The ${BROKER_NAMES[id]} MCP server did not say which account this is. Save your client ID in Settings.`);
        return p?.userId ? p : { userId: String(fallback), name: null };
      },
      async holdings() {
        if (id === "indmoney") {
          const { parts, errors } = await indmoneyHoldings();
          if (!parts.length) throw new McpError(`INDmoney's networth_holdings returned nothing usable${errors.length ? `: ${errors.join(" | ").slice(0, 300)}` : "."}`);
          const p = { stocks: [], mf: [], us: [], other: [] };
          for (const x of parts) for (const k of Object.keys(p)) p[k].push(...x.parsed[k]);
          const dedupe = (arr, key) => [...new Map(arr.map(v => [key(v), v])).values()];
          p.stocks = dedupe(p.stocks, v => v.symbol || v.isin || v.name); p.mf = dedupe(p.mf, v => `${v.isin}|${v.folio || ""}`); p.us = dedupe(p.us, v => v.symbol || v.name);
          const holdings = p.stocks.map(h => makeHolding({ symbol: h.symbol, exchange: h.exchange, isin: h.isin, qty: h.qty, avg: h.avg, last: h.last })).filter(h => h.qty > 0);
          return { holdings, unresolved: p.stocks.filter(h => !h.symbol), mf: p.mf.filter(f => f.value > 0 || f.units > 0), us: p.us, other: p.other, priceNote: null };
        }
        const r = await withLogin(() => run("holdings"));
        if (r.json === null && /no holdings|not have any holdings|empty/i.test(r.text)) return { holdings: [], priceNote: null };
        const holdings = normalizeMcpHoldings(r.json);
        return { holdings, priceNote: holdings.some(h => h.lastPrice === null) ? `The ${BROKER_NAMES[id]} MCP server returned holdings without prices; another broker's live price or the watchlist price is used.` : null };
      },
      tools,
      // Raw look at the holdings tool's reply (first few KB) and how this app read it: for checking a new server's format.
      async preview() {
        if (id === "indmoney") {
          const { parts, errors, choices } = await indmoneyHoldings();
          const sum = k => parts.reduce((a, x) => a + x.parsed[k].length, 0);
          return { tool: "networth_holdings", choices, raw: [...parts.map(x => `── asset_type=${x.value} ──\n${String(x.text).slice(0, 1500)}`), ...errors.map(e => `── error ── ${e}`)].join("\n\n").slice(0, 6000), counts: { indianStocks: sum("stocks"), mutualFunds: sum("mf"), usStocks: sum("us"), other: sum("other") } };
        }
        const r = await withLogin(() => run("holdings"));
        let holdings = null; if (r.json !== null) { try { holdings = normalizeMcpHoldings(r.json).length; } catch { holdings = 0; } }
        return { tool: pickTool(await tools(), "holdings", id), raw: String(r.text || "").slice(0, 4000), counts: { holdings } };
      },
      async disconnect() { await client?.close().catch(() => {}); client = null; toolCache = null; store[id] = { ...(store[id] || {}), session: null, oauth: store[id]?.oauth ? { ...store[id].oauth, tokens: null, pending: null } : null }; await persist(); }
    };
    out[id] = api;
  }
  return out;
}
