import { loadedFromEnvFile } from "./env.mjs"; // must stay first: loads .env before other modules read process.env
import http from "node:http";
import zlib from "node:zlib";
import { EventEmitter } from "node:events";
import { AsyncLocalStorage } from "node:async_hooks";
import { createAuth, publicUser } from "./auth.mjs";
import { dfs as fs, initStorage, flushStorage, closeStorage, pingStorage, info as storageInfo } from "./storage.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFundamentalsForStock, yahooCooldown, yahooQuotes, yahooSummary } from "./fundamentals-yahoo.mjs";
import { MODEL, computeAll, computeValuation, sanitizeEntry, parseCsv, FIELDS } from "./valuation.mjs";
import { fetchScreener, screenerCooldown, screenerConfig, fetchScreenerExtras, searchScreener, resetScreener, fetchScreenerPrice } from "./screener.mjs";
import { readSheetFile, sheetInfo, parseDelimited, extractHoldings, fundSummary } from "./funds.mjs";
import { fetchNseQuote, mergeNse, refreshFromNse, nseCooldown, fetchNseJson, fetchNseHistory, resetNse, lastNseStatus, NSE_ARCHIVE_BASE } from "./nse.mjs";
import { LADDERS, DEFAULT_SETTINGS, sanitizeBuy, positionRow, stress, exposure } from "./plan.mjs";
import { addSnapshots, performance, compare } from "./tracker.mjs";
import { fetchGoogleQuote, googleCooldown, googleConfig, resetGoogle } from "./googlefinance.mjs";
import { kite as kiteDefaults, READ_ONLY_TOOLS, createKiteClient } from "./kite-mcp.mjs";
import { createBrokerClients, BROKER_NAMES, READ_ONLY_ROUTES, cleanSymbol, makeHolding } from "./brokers.mjs";
import { createBrokerMcp, MCP_BROKERS } from "./broker-mcp.mjs";
import { holdingStance } from "./stance.mjs";
import { classify } from "./classify.mjs";
import { growthLens } from "./growthlens.mjs";
import { computeDividends, fetchDividendEvents, dividendsFromAnnual } from "./dividends.mjs";
import { computeTechnicals, fetchBars, fetchChart } from "./technicals.mjs";
import { peerCompare } from "./peers.mjs";
import { diffAlerts, mergeEvents } from "./alerts.mjs";
import { allocate } from "./allocate.mjs";
import { portfolioHealth } from "./health.mjs";
import { mergeSuggestions } from "./search.mjs";
import { sanitizePlan, buildPlan, sanitizeGoal, goalPlan } from "./divplan.mjs";
import { rankFocus } from "./focus.mjs";
import { ASSET_CATEGORIES, LIABILITY_CATEGORIES, sanitizeItem, buildNetworth, addSnapshot, changeSince, matchFund, lookThrough, sanitizeGoal as sanitizeNwGoal, goalStatus } from "./networth.mjs";
import { TAX_RULES, parseTradebook, mergeTrades, taxView } from "./tax.mjs";
import { PROFILES, STYLES, buildModel, assetMix } from "./model.mjs";
import { SWING_DEFAULTS, parseTargets, parseBookPlan, parseAmount as parseSwingAmount, sanitizePosition, sanitizeWatch, parseDipText, DIP_ALIASES, applyBuy, applySell, reopenTrade, parseSheet, evaluateSwing, diffSwingAlerts, moveCash, scorecard, swingTaxRows, bookedSummary, sanitizeTaxPayment, tradeDate, setLots, buildLedger, mergePositions, dedupePositions, SETUPS, MISTAKES, sanitizeReview, journalStats, sellTaxEstimate, lotsForSale, ltExemptionLeft, lotsOf, CHARGE_DEFAULTS } from "./swing.mjs";
import { buildXlsx } from "./xlsx.mjs";
import { isEtf, indexFor, parseAllIndices, etfLens, etfType } from "./etf.mjs";
import { parseNseActions, parseYahooEvents, mergeActions, adjustPosition, adjustWatch } from "./corpactions.mjs";
import { parseNseEvents, parseYahooCalendar, eventsFor, swingEventAdvice } from "./events.mjs";
import { returnsView, indexTwin, swingFlows, dividendsReceived, forwardDividends, xirr } from "./returns.mjs";
import { logIdeas, judgeIdea, ideaStats } from "./ideastrack.mjs";
import { RULE_TYPES, sanitizeRule, describeRule, checkLiveRule, checkEodRule } from "./alertrules.mjs";
import { morningDigest, eveningDigest } from "./digest.mjs";
import { DEFAULT_BASKET, sanitizeBasket, basketView } from "./accumulate.mjs";
import { backupConfig, gz, gunz, verifyBackup, writeLocal, listLocal, readLocal, pruneLocal, s3Put } from "./backup.mjs";
import { staticAsset, sendStatic } from "./static.mjs";
import { decideHoldSell, dailyVol } from "./decide.mjs";
import { fetchBhavcopy, fetchIndexCloses, mergeBars, weekdaysBack, dayToT, INDEX_KEYS } from "./eod.mjs";
import { snapshot as swingSnapshot, rankIdeas, positionHealth } from "./swingideas.mjs";
import { validToken, maskToken, botInfo, findChat, sendTelegram, pushAlerts } from "./notify.mjs";
import { SEED as SCRIP_SEED, parseKiteInstruments, parseNseEquityList, mergeMaster, searchMaster } from "./scripmaster.mjs";
import { US_POPULAR, cleanUsSymbol, parseSecTickers, searchTickers, seriesFromFacts, usValuation, fetchUsPrices, fetchSecJson, companyFactsUrl, SEC_TICKERS_URL } from "./us.mjs";
import { LISTS as MARKET_LISTS, parseNseList, rankFromQuotes } from "./market.mjs";
import { ensureLists, createList, renameList, deleteList, setMembers, prune, DEFAULT_ID } from "./lists.mjs";
import { METRICS, OPS, PRESETS, sanitizeThesis, evaluateThesis, trackBreaks } from "./thesis.mjs";
import { AI_MODELS, AI_DEFAULTS, PRIVACY as AI_PRIVACY, sealKey, openKey, looksLikeKey, buildContext, SYSTEM as AI_SYSTEM, TOOLS as AI_TOOLS, sseParser, messageCollector, monthKey, friendlyApiError } from "./ai.mjs";
import { addMarketDay, movers as marketMovers, indexChanges } from "./movers.mjs";
import { fetchFromApi, fetchFromLink } from "./fundsource.mjs";
import { SMART_INDICES, normIndex, parseAllIndices as parseIndexList, parseIndexStocks, parseIndexCsv, fillFromBars, smartRows, indexSummary } from "./indices.mjs";
import { parseUsHoldings, usHoldingsView, cleanUsTicker, parseAmfiNav, searchAmfi, pdfLines, parseCas, parseMfRows, valueFund } from "./holdings-extra.mjs";

// ---- Debug log: the last 1500 console lines kept in memory (owner can read them at /api/debug/log) ----
const DEBUG_LOG = [];
for (const level of ["log", "warn", "error"]) {
  const orig = console[level].bind(console);
  console[level] = (...a) => {
    try { DEBUG_LOG.push(`${new Date().toISOString().slice(11, 23)} ${level === "log" ? "   " : level === "warn" ? "WRN" : "ERR"} ${a.map(x => (typeof x === "string" ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(" ").slice(0, 600)}`); if (DEBUG_LOG.length > 1500) DEBUG_LOG.splice(0, DEBUG_LOG.length - 1500); } catch { /* never break logging */ }
    orig(...a);
  };
}
// One request at a time per site, spaced out: NSE and Screener block bursts (a refresh asks for many stocks at once).
const paceChains = new Map();
function paced(site, gapMs, fn) {
  const prev = paceChains.get(site) || Promise.resolve();
  const run = prev.catch(() => {}).then(async () => { try { return await fn(); } finally { await new Promise(r => setTimeout(r, gapMs)); } });
  paceChains.set(site, run.catch(() => {}));
  return run;
}

const root = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, "data"));
// MongoDB when MONGO_URL is set (data survives redeploys and container rebuilds), else JSON files in DATA_DIR.
const STORAGE = await initStorage({ dataDir: DATA_DIR });
console.log(`[storage] ${STORAGE.mode === "mongo" ? `MongoDB (${STORAGE.documents} documents)` : `files in ${DATA_DIR}`}`);
// ---- Who is asking: every request runs inside its signed-in user's context; their files live in data/users/<id>/ ----
const userCtx = new AsyncLocalStorage();
const currentUser = () => userCtx.getStore()?.user || null;
function userDir(u = currentUser()) {
  // Never fall back to a shared folder: a request without a user must fail rather than read someone's data.
  if (!u?.id || !/^[a-f0-9]{16}$/.test(u.id)) throw new Error("No signed-in user for this request.");
  return path.join(DATA_DIR, "users", u.id);
}
const userFile = name => path.join(userDir(), name);
const asUser = (user, fn, sessionKey = null) => userCtx.run({ user, sessionKey }, fn);
const currentSessionKey = () => userCtx.getStore()?.sessionKey || null;
// One instance per user (Kite / broker logins, the refresh job), reached through a proxy so existing code keeps its names.
function perUser(make) {
  const cache = new Map();
  const get = () => { const u = currentUser(); userDir(u); if (!cache.has(u.id)) cache.set(u.id, make(u)); return cache.get(u.id); };
  const proxy = new Proxy({}, {
    get: (_, k) => { const t = get(), v = Reflect.get(t, k); return typeof v === "function" ? v.bind(t) : v; },
    set: (_, k, v) => Reflect.set(get(), k, v),
    has: (_, k) => Reflect.has(get(), k),
    ownKeys: () => Reflect.ownKeys(get()),
    getOwnPropertyDescriptor: (_, k) => { const d = Reflect.getOwnPropertyDescriptor(get(), k); return d && { ...d, configurable: true }; }
  });
  return { get, proxy, drop: id => cache.delete(id) };
}
// Broker API keys in .env belong to the owner. Other accounts never see them; they enter their own on the Integrations tab.
const OWNER_ONLY_ENV = /^(ANGEL_(API_KEY|CLIENT_CODE|PIN|TOTP_SECRET)|DHAN_|GROWW_|INDMONEY_|INDSTOCKS_)/;
const memberEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !OWNER_ONLY_ENV.test(k) || /_MCP_URL$/.test(k)));
const envFor = u => u.role === "owner" ? process.env : memberEnv;
const brokersU = perUser(u => createBrokerClients({ env: envFor(u), sessionFile: path.join(userDir(u), "broker-sessions.json"), credentialsFile: path.join(userDir(u), "broker-credentials.json") }));
const brokers = brokersU.proxy;
const kiteMain = perUser(u => createKiteClient({ sessionFile: path.join(userDir(u), "kite-session.json") }));
const kite = kiteMain.proxy;
const auth = createAuth({ dir: path.join(DATA_DIR, "auth") });
const U = Object.freeze({
  get notifyFile() { return userFile("notify.json"); },
  get dataFile() { return userFile("watchlist.json"); },
  get historyFile() { return userFile("history.json"); },
  get positionsFile() { return userFile("positions.json"); },
  get valuationLogFile() { return userFile("valuation-log.json"); },
  get customListFile() { return userFile("custom-list.json"); },
  get thesesFile() { return userFile("theses.json"); },
  get kiteHoldingsFile() { return userFile("kite-holdings.json"); },
  get listsFile() { return userFile("lists.json"); },
  get divPlanFile() { return userFile("dividend-plan.json"); },
  get growthOverridesFile() { return userFile("growth-overrides.json"); },
  get fundsFile() { return userFile("funds.json"); },
  get alertsFile() { return userFile("alerts.json"); },
  get kiteSlotsFile() { return userFile("kite-slots.json"); },
});
const fundamentalsFile = path.join(DATA_DIR, "fundamentals-cache.json"); // written by the Yahoo/NSE fetch or CSV import; starts empty
const referenceFile = path.join(DATA_DIR, "reference-check.json");
// Private: holdings from every synced broker account (Zerodha, Angel One, Dhan, Groww), written only by "Sync holdings".
// The file keeps its v1.1 name so existing Zerodha syncs carry over. Zerodha accounts are keyed by Kite user id, the
// others by "<broker>:<client id>".

// Price sources, tried in this order until one returns a price. "kite" is skipped until you log in to Kite (and when
// KITE_MCP_ENABLED=0). Override with e.g. PRICE_SOURCES=google,yahoo. Unknown names are ignored.
// Kite is no longer a default price source: its quotes go stale when the MCP connection drops. Add it back with PRICE_SOURCES=nse,kite,… if wanted.
const PRICE_SOURCES = (process.env.PRICE_SOURCES || "nse,yahoo,screener,google").split(",").map(s => s.trim().toLowerCase()).filter(s => ["kite", "nse", "yahoo", "screener", "google"].includes(s));
const KITE_PRICES = PRICE_SOURCES.includes("kite");
const RANGE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // re-read the 52-week range from Yahoo/Google at most daily when the price came from Kite
const port = Number(process.env.PORT || 4173);
// Angel One / Dhan through an MCP server (broker-mcp.mjs). The OAuth redirect comes back to this server.
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
const brokerMcpU = perUser(u => createBrokerMcp({ brokers: brokersU.get(), env: envFor(u), file: path.join(userDir(u), "broker-mcp.json"), redirectUri: () => `${PUBLIC_URL}/api/brokers/mcp/callback` }));
const brokerMcp = brokerMcpU.proxy;
const types = { ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

// Fields treated as "research judgement" for the change log. Price/updated/feedStatus/
// news fields are handled separately (as a once-a-day price point) so a 15-minute
// price refresh doesn't flood the audit trail.
const RESEARCH_FIELDS = ["bucket", "action", "valuation", "kpi", "note", "style"];
const MAX_CHANGE_LOG = 2000;
const MAX_PRICE_POINTS = 400; // ~1.5 trading years per stock

// --- AI financial-advisor engine -------------------------------------------------
// Calls the real Claude API (your own key, your own cost) to suggest a refreshed
// valuation, a Core/Satellite/Growth/Momentum style tag, and a long-term-story
// verdict for one stock. Suggestions are never applied automatically — the client
// always shows them for review first, then POSTs an explicit apply.
const ADVISOR_MODEL = process.env.ADVISOR_MODEL || "claude-sonnet-5";
const ACTION_OPTIONS = ["Buy gradually", "Buy on dips", "Buy on correction", "Wait for correction", "Watch", "Avoid", "Small accumulation", "Small buy only", "Small turnaround position"];
const STYLE_OPTIONS = ["Core", "Satellite", "Growth", "Momentum"];
const VERDICT_OPTIONS = ["Intact", "Weakening", "Broken", "Too early to tell"];
const ADVISOR_LENSES = {
  balanced: "Balance business quality, valuation, sustainable growth, available momentum evidence, and downside risk.",
  value: "Prioritize valuation against normalized earnings and cash flow, balance-sheet strength, and margin of safety. Distinguish a value opportunity from a value trap. If verified financial metrics are absent, say valuation cannot be established from this watchlist.",
  growth: "Prioritize durable revenue and earnings growth, reinvestment runway, execution, and cash conversion. Explain whether the valuation already assumes unusually strong growth; do not treat growth alone as evidence of value.",
  momentum: "Prioritize price trend, relative strength, trading volume, and catalysts. This watchlist provides only a latest close and 52-week range, not a time series, relative benchmark, or volume; explicitly mark momentum as unassessed when those inputs are missing and do not infer a trend from a single price."
};
const ADVISOR_SYSTEM_PROMPT = `You are a disciplined equity research assistant helping a long-term Indian-equity (NSE) investor maintain a personal watchlist. You are not a licensed financial advisor; your output is a starting point for the investor's own review, not a directive, and it is never shown to anyone without their explicit review.

Your knowledge has a training cutoff and no live market data feed — say so plainly wherever it limits your confidence, rather than guessing at very recent numbers.

Classify the company into exactly one "style":
- Core: high-quality, durable-moat business suited to a large, long-hold allocation.
- Satellite: smaller or thematic position that diversifies the portfolio but carries more idiosyncratic/concentration risk; sized smaller than Core.
- Growth: prioritises revenue/earnings expansion over current profitability; priced for future growth.
- Momentum: the case rests mainly on price action or a near-term re-rating catalyst rather than durable compounding quality; needs tighter risk management.

Suggest an investment action: exactly one of "Buy gradually", "Buy on dips", "Buy on correction", "Wait for correction", "Watch", or "Avoid":
- Buy gradually: high-quality compounder with fair/acceptable valuation to accumulate steadily.
- Buy on dips: high-quality compounder with slightly rich valuation; accumulate on minor dips.
- Buy on correction: good business with rich valuation; wait for a meaningful correction (15–25%).
- Wait for correction: rich or euphoric valuation; hold off on new allocation until price corrects.
- Watch: thesis or growth is unproven, turnaround needing more proof, or pending key regulatory/operating catalysts.
- Avoid: structural headwinds, poor capital allocation, loss-making unit economics without a clear path to profitability, or unappealing risk/reward.

Also give a short valuation label (e.g. "Fair", "Fair to rich", "Rich", "Very rich", "Rich / loss-making", "Uncertain") and a verdict on whether the long-term investment story is still intact: exactly one of "Intact", "Weakening", "Broken", or "Too early to tell" — with one evidence-specific paragraph of reasoning.

Respond with ONLY a JSON object, no markdown fences, no commentary before or after, in exactly this shape:
{"action": "Buy gradually|Buy on dips|Buy on correction|Wait for correction|Watch|Avoid", "valuation": "...", "style": "Core|Satellite|Growth|Momentum", "longTermStory": {"verdict": "Intact|Weakening|Broken|Too early to tell", "reasoning": "..."}, "keyRisk": "one short sentence", "confidence": "High|Medium|Low", "caveat": "one short sentence on data or knowledge limitations for this specific call"}`;

function fundamentalsBlock(stock, f) {
  if (!f) return "Fundamentals on file: none (valuation cannot be established from the watchlist alone).";
  const v = computeValuation(stock, f);
  return `Fundamentals on file (${f.source || "unknown source"}, as of ${f.asOf || "unknown date"}): P/E ${v.pe ?? "n/a"}, P/B ${f.pb ?? "n/a"}, ROCE ${f.roce ?? "n/a"}%, ROE ${f.roe ?? "n/a"}%, promoter ${f.promoter ?? "n/a"}%, 3-yr sales CAGR ${f.salesCagr3 ?? "n/a"}%, 3-yr profit CAGR ${f.profitCagr3 ?? "n/a"}%, borrowings ${f.borrowings ?? "n/a"} vs reserves ${f.reserves ?? "n/a"} (Rs Cr). Flags: ${f.flags || "none"}.
Rule-based valuation view from the app: ${v.view}${v.zoneLow ? `, buy zone Rs${v.zoneLow}-Rs${v.zoneHigh}, status ${v.status}` : ""}.`;
}
function buildAdvisorPrompt(stock, lens, fundamentals) {
  return `Company: ${stock.company} (${stock.ticker}${stock.marketSymbol ? `, NSE: ${stock.marketSymbol}` : ""})
Selected research lens: ${lens}
Lens criteria: ${ADVISOR_LENSES[lens]}
Current bucket: ${stock.bucket}
Current action: ${stock.action}
Current valuation label: ${stock.valuation}
Latest close on file: ${Number.isFinite(stock.price) ? `₹${stock.price}` : "not available"}
52-week range on file: ${Number.isFinite(stock.low) && Number.isFinite(stock.high) ? `₹${stock.low}–₹${stock.high}` : "not available"}
Existing order book / KPI note: ${stock.kpi || "none on file"}
Existing research note: ${stock.note || "none on file"}
Most recent headline on file: ${stock.latestNews || "none on file"}
${fundamentalsBlock(stock, fundamentals)}

Reassess this company now.`;
}
async function callAdvisor(stock, lens, fundamentals) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server. Export your own Anthropic API key before starting the app to use the advisor.");
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: ADVISOR_MODEL, max_tokens: 700, system: ADVISOR_SYSTEM_PROMPT, messages: [{ role: "user", content: buildAdvisorPrompt(stock, lens, fundamentals) }] })
  });
  if (!response.ok) { const text = await response.text().catch(() => ""); throw new Error(`Advisor API HTTP ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`); }
  const data = await response.json();
  const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  const cleaned = text.replace(/^```(json)?/i, "").replace(/```$/, "").trim();
  let parsed;
  try { parsed = JSON.parse(cleaned); } catch { throw new Error(`Advisor returned non-JSON output: ${cleaned.slice(0, 200)}`); }
  if (!ACTION_OPTIONS.includes(parsed.action)) parsed.action = null;
  if (!STYLE_OPTIONS.includes(parsed.style)) parsed.style = null;
  if (!parsed.longTermStory || !VERDICT_OPTIONS.includes(parsed.longTermStory.verdict)) parsed.longTermStory = parsed.longTermStory || { verdict: null, reasoning: "" };
  return parsed;
}

function reply(res, status, body, type = "application/json; charset=utf-8") {
  let data = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body);
  const headers = { "Content-Type": type, "Cache-Control": "no-store" };
  // Compress larger text answers (valuation rows, swing view…): typically 5–10× smaller over the internet
  if (res.acceptsGzip && /json|text|javascript/.test(type) && Buffer.byteLength(data) > 1500) { data = zlib.gzipSync(data, { level: 5 }); headers["Content-Encoding"] = "gzip"; headers.Vary = "Accept-Encoding"; }
  res.writeHead(status, headers);
  res.end(data);
}
const MAX_BODY = 30 * 1024 * 1024;
async function readBody(req) { let text = ""; for await (const chunk of req) { text += chunk; if (text.length > MAX_BODY) throw Object.assign(new Error("Request is too large."), { status: 413 }); } return text ? JSON.parse(text) : {}; }
async function readWatchlist() { try { return JSON.parse(await fs.readFile(U.dataFile, "utf8")); } catch { return []; } }
async function writeWatchlist(stocks) { await fs.mkdir(path.dirname(U.dataFile), { recursive: true }); await fs.writeFile(U.dataFile, JSON.stringify(stocks, null, 2)); }
async function readFundamentals() { try { return JSON.parse(await fs.readFile(fundamentalsFile, "utf8")).fundamentals || {}; } catch { return {}; } }
async function writeFundamentals(map) { await fs.mkdir(path.dirname(fundamentalsFile), { recursive: true }); await fs.writeFile(fundamentalsFile, JSON.stringify({ fundamentals: map }, null, 2)); }
async function readJson(file, fallback) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return fallback; } }
async function writeJson(file, value) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, JSON.stringify(value, null, 2)); }
const symOf = s => (s.marketSymbol || s.ticker || "").toUpperCase();
async function readLists() { return ensureLists(await readJson(U.listsFile, {}), (await readWatchlist()).map(symOf)); }
// "My holdings": a list that follows your broker holdings (every account, removed accounts left out). Not stored with
// your lists, so it cannot drift; stocks you hold that are not tracked yet are added to the pool and valued in the background.
const HOLDINGS_LIST_ID = "holdings";
const holdTrackAt = new Map();
async function withHoldingsList(st) {
  const store = await readHoldStore(), held = new Map();
  for (const a of Object.values(store.accounts || {})) for (const h of a.holdings || []) if (h.symbol && !held.has(h.symbol)) held.set(h.symbol, { exchange: h.exchange === "BSE" ? "BSE" : "NSE", name: h.name || null });
  if (!held.size) return st;
  const uid = currentUser().id, key = [...held.keys()].sort().join(",");
  if (holdTrackAt.get(uid) !== key) { // only when the holdings changed
    holdTrackAt.set(uid, key);
    (async () => {
      const pool = new Set((await readWatchlist()).map(symOf)), add = [...held].filter(([sym]) => !pool.has(sym));
      for (const [sym, h] of add) await ensureInPool(sym, h.exchange, h.name, "Added because you hold it (My holdings).");
      if (add.length) queueFill(add.map(([sym]) => sym)).catch(() => {});
    })().catch(e => { holdTrackAt.delete(uid); console.warn(`[lists] holdings: ${e.message}`); });
  }
  return { lists: [...st.lists, { id: HOLDINGS_LIST_ID, name: "My holdings", default: false, auto: "holdings", symbols: [...held.keys()].sort() }] };
}
async function addToList(id, symbols) { if (id === "__none__" || id === HOLDINGS_LIST_ID) return; const st = await readLists(); await writeJson(U.listsFile, setMembers(st, st.lists.some(l => l.id === id) ? id : DEFAULT_ID, { add: symbols })); }
// Tracks a stock (no watchlist membership) so its price, fundamentals and dividend history can be fetched.
async function ensureInPool(symbol, exchange = "NSE", name = null, note = "Added from the dividend planner.") {
  const list = await readWatchlist(); if (list.some(st => symOf(st) === symbol)) return false;
  const stock = { id: Math.max(0, ...list.map(st => st.id)) + 1, company: name || symbol, ticker: symbol, marketSymbol: symbol, exchange: exchange === "BSE" ? "BSE" : "NSE", bucket: "Imported", action: "Watch", valuation: "Fair", price: null, low: null, high: null, kpi: "", note, updated: "Needs refresh", accounts: [] };
  await persistWatchlist([...list, stock], list); return true;
}
async function dividendPlanView() {
  const plan = sanitizePlan(await readJson(U.divPlanFile, {}));
  const [{ rows, stocks }, view, divCache, sxAll] = await Promise.all([computeRows(), kiteHoldingsView(), readJson(dividendsFile, {}), readJson(screenerExtraFile, {})]);
  const bySym = new Map(rows.map(r => [String(r.symbol).toUpperCase(), r])), held = new Map(view.holdings.map(h => [h.symbol, h]));
  const info = {};
  for (const r of plan.rows) {
    const v = bySym.get(r.symbol), h = held.get(r.symbol), st = stocks.find(x => symOf(x) === r.symbol);
    const price = v?.price ?? h?.syncPrice ?? st?.price ?? null;
    const sxd = sxAll[r.symbol]?.div;
    const dividend = divCache[r.symbol]?.events ? computeDividends(divCache[r.symbol].events, { price, pe: v?.pe ?? null, profitCagr3: v?.profitCagr3 ?? null }) : sxd?.annual?.length ? dividendsFromAnnual(sxd.annual, { price, profitCagr3: v?.profitCagr3 ?? null, dividendYield: sxd.yield }) : null;
    info[r.symbol] = { company: v?.company || h?.company || st?.company || r.symbol, price, dividend, held: h ? h.qty : null, dataError: divCache[r.symbol]?.error || null };
  }
  const missing = plan.rows.filter(r => !divFresh(divCache[r.symbol]) && !sxAll[r.symbol]?.div?.annual?.length).map(r => r.symbol);
  if (missing.length) fetchDividendsFor(missing).catch(() => {});
  const inPlan = new Set(plan.rows.map(r => r.symbol));
  const ideas = rows.filter(r => r.dividend && ["Safe", "Watch"].includes(r.dividend.safety) && r.dividend.yield > 0 && !inPlan.has(String(r.symbol).toUpperCase()))
    .sort((a, b) => b.dividend.yield - a.dividend.yield).slice(0, 10)
    .map(r => ({ symbol: r.symbol, company: r.company, exchange: r.exchange, price: r.price, yield: r.dividend.yield, dps: r.dividend.ttm, safety: r.dividend.safety, streakYears: r.dividend.streakYears, verdict: r.verdict?.label || null, verdictCls: r.verdict?.cls || null }));
  // Goal planner: live price / trailing dividend for tracked stocks unless the person typed their own figure.
  const rawGoal = sanitizeGoal((await readJson(U.divPlanFile, {})).goal);
  const goalCands = rawGoal.candidates.map(c => {
    const v = bySym.get(c.symbol), ev = divCache[c.symbol]?.events, live = v?.price ?? null, sxd = sxAll[c.symbol]?.div;
    const d = ev ? computeDividends(ev, { price: live ?? c.price }) : sxd?.annual?.length ? dividendsFromAnnual(sxd.annual, { price: live ?? c.price, dividendYield: sxd.yield }) : null;
    const price = !c.priceManual && live ? live : c.price, div = !c.divManual && d && d.ttm > 0 ? d.ttm : c.div;
    return { ...c, price, div, yield: price > 0 ? Math.round(div / price * 10000) / 100 : 0, priceSource: !c.priceManual && live ? "live" : c.priceManual ? "yours" : "snapshot", divSource: !c.divManual && d && d.ttm > 0 ? "last 12 months" : c.divManual ? "yours" : "snapshot", safety: d?.safety || null };
  });
  const goal = { monthlyGoal: rawGoal.monthlyGoal, method: rawGoal.method, candidates: goalCands, plan: goalPlan({ monthlyGoal: rawGoal.monthlyGoal, method: rawGoal.method, candidates: goalCands }) };
  return { ...buildPlan(plan, info), goal, ideas, pendingData: divCooldownUntil > Date.now() ? 0 : missing.length, cooling: divCooldownUntil > Date.now(), dividendDataCount: Object.keys(divCache).length };
}
// ---- Market today: NSE-style lists (52-week highs/lows, most active by volume/value, volume gainers) ----
const marketCache = new Map();
let lastPriceRefreshAt = null;
async function marketList(list, source = "auto") {
  const key = `${currentUser().id}:${list}:${source}`, hit = marketCache.get(key), ttl = (marketIsOpen() ? 5 : 30) * 60e3;
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const def = MARKET_LISTS[list]; let rows = null, used = null, note = null;
  if (source === "nse") {
    for (const path of def.nse) {
      try { const r = parseNseList(list, await fetchNseJson(path, { referer: def.referer })); if (r.length) { rows = r; used = "nse"; break; } note = "NSE returned an empty list."; }
      catch (e) { note = `NSE did not answer (${String(e.message).slice(0, 120)}).`; }
    }
  }
  if (!rows) {
    // Your own stocks (watchlist + holdings): Yahoo quotes (Kite only if PRICE_SOURCES includes it),
    // else the saved watchlist prices. 52-week range = saved range widened by today's high / low.
    const [stocks, view] = await Promise.all([readWatchlist(), kiteHoldingsView()]);
    const items = new Map(stocks.filter(st => symOf(st)).map(st => [symOf(st), { symbol: symOf(st), exchange: st.exchange || "NSE", name: st.company, high52: st.high, low52: st.low }]));
    for (const h of view.holdings) if (!items.has(h.symbol)) items.set(h.symbol, { symbol: h.symbol, exchange: "NSE", name: h.company || h.symbol });
    const kc = KITE_PRICES ? await anyKiteWithSession() : null, errs = [];
    if (kc && list !== "volgainers") {
      try {
        const qs = await kc.quotes([...items.values()].filter(i => i.exchange !== "BSE").map(i => i.symbol));
        const merged = [...qs.values()].map(q => { const i = items.get(q.symbol) || {}; return { ...q, name: i.name, high52: Math.max(i.high52 || 0, q.high || 0) || null, low52: i.low52 && q.low ? Math.min(i.low52, q.low) : i.low52 || null }; });
        if (merged.length) { rows = rankFromQuotes(list, merged); used = "kite"; }
      } catch (e) { errs.push(`Kite quotes failed (${String(e.message).slice(0, 100)})`); }
    } else if (!kc && KITE_PRICES) errs.push("Kite is not logged in");
    if (!rows) {
      try { const qs = await yahooQuotes([...items.values()]); rows = rankFromQuotes(list, [...qs.values()]); used = "yahoo"; }
      catch (e) {
        errs.push(`Yahoo quotes failed (${String(e.message).slice(0, 90)})`);
        if (list === "52high" || list === "52low") { rows = rankFromQuotes(list, stocks.map(st => ({ symbol: symOf(st), name: st.company, price: st.price, high52: st.high, low52: st.low }))); used = "saved"; }
        else { rows = []; used = "none"; }
      }
    }
    note = [source === "nse" ? note : null, ...errs].filter(Boolean).join(". ") + (errs.length ? "." : "");
  }
  const data = { list, label: def.label, source: used, note: used === "nse" ? null : note, asOf: new Date().toISOString(), rows: rows.slice(0, 100) };
  marketCache.set(key, { at: Date.now(), data });
  return data;
}
const screenerExtraFile = path.join(DATA_DIR, "screener-extra.json"), nameMapFile = path.join(DATA_DIR, "name-map.json");
// Per stock: Screener page ids, yearly dividends, peer table, swing figures. Written after fundamentals fetches and on demand.
let sxChain = Promise.resolve();
function saveScreenerExtra(symbol, patch) { const run = async () => { const all = await readJson(screenerExtraFile, {}); all[symbol] = { ...(all[symbol] || {}), ...patch }; await writeJson(screenerExtraFile, all); }; sxChain = sxChain.then(run, run); return sxChain; }
// ---- Mutual fund X-ray ----
const normName = s => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/\b(limited|ltd|the|india|co|company|corporation|corp|inc|industries|industry)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
// ---- ISIN → NSE symbol, offline (shared, public data): NSE's list of every listed company with its ISIN
// (EQUITY_L.csv, refreshed weekly). Fund portfolios carry ISINs, so most holdings match exactly with no search.
const isinFile = path.join(DATA_DIR, "isin-master.json");
let isinMem = null, isinLoading = null, isinTriedAt = 0;
function refreshIsinMaster() {
  if (isinLoading) return isinLoading;
  isinTriedAt = Date.now();
  isinLoading = (async () => {
    try {
      const r = await fetch(`${NSE_ARCHIVE_BASE()}/content/equities/EQUITY_L.csv`, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", Referer: "https://www.nseindia.com/" }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const map = {}; for (const x of parseNseEquityList(await r.text())) if (/^INE[A-Z0-9]{9}$/.test(x.isin || "")) map[x.isin] = x.symbol;
      if (Object.keys(map).length < 500) throw new Error("list too short");
      isinMem = { fetchedAt: Date.now(), map }; await writeJson(isinFile, isinMem);
      console.log(`[x-ray] ISIN list: ${Object.keys(map).length} NSE companies`);
    } catch (e) { console.warn(`[x-ray] Could not download NSE's company list (${e.message}); matching by name / Screener search.`); }
  })().finally(() => { isinLoading = null; });
  return isinLoading;
}
// wait: on a user action (upload, fetch), wait a few seconds the very first time; never on page loads
async function isinMaster({ wait = 0 } = {}) {
  if (!isinMem) { const saved = await readJson(isinFile, null); if (saved?.map) isinMem = saved; }
  const stale = !isinMem || Date.now() - isinMem.fetchedAt > 7 * 864e5;
  if (stale && Date.now() - isinTriedAt > 6 * 3600e3) { const p = refreshIsinMaster(); if (!isinMem && wait) await Promise.race([p, new Promise(r => setTimeout(r, wait))]); }
  return isinMem?.map || {};
}
// Matching order: names you confirmed before → ISIN (NSE list) → your watchlist / known companies → listed-company
// list by exact name → Screener search (only for what is left, a limited number per call: it rate-limits long runs).
async function resolveHoldingSymbols(items, { searchBudget = 15, wait = 6000 } = {}) {
  const [map, stocks, fund, isins, master] = await Promise.all([readJson(nameMapFile, {}), readWatchlist(), readFundamentals(), isinMaster({ wait }), scripMaster().catch(() => ({ list: [] }))]);
  const byName = new Map();
  for (const st of stocks) if (symOf(st)) byName.set(normName(st.company), { symbol: symOf(st), exchange: st.exchange || "NSE" });
  for (const [sym, f] of Object.entries(fund)) if (f.companyName && !byName.has(normName(f.companyName))) byName.set(normName(f.companyName), { symbol: sym, exchange: "NSE" });
  // listed companies by normalised name; a name shared by two NSE symbols is ambiguous and skipped
  const byListed = new Map();
  for (const x of master.list || []) {
    const k = normName(x.name); if (!k) continue; const cur = byListed.get(k);
    if (!cur) byListed.set(k, { symbol: x.symbol, exchange: x.exchange || "NSE" });
    else if (cur.exchange === x.exchange && cur.symbol !== x.symbol) byListed.set(k, { ...cur, ambiguous: true });
    else if (cur.exchange === "BSE" && x.exchange === "NSE") byListed.set(k, { symbol: x.symbol, exchange: "NSE" });
  }
  const out = []; let changed = false, searches = 0;
  for (const it of items) {
    const key = it.isin || normName(it.name), n = normName(it.name);
    if (map[key]?.symbol) { out.push({ ...map[key], how: "saved" }); continue; }
    let hit = null, how = null;
    if (it.isin && isins[it.isin]) { hit = { symbol: isins[it.isin], exchange: "NSE" }; how = "isin"; }
    if (!hit) { hit = byName.get(n) || [...byName.entries()].find(([k]) => k && n && (k.startsWith(n) || n.startsWith(k)) && Math.min(k.length, n.length) >= 6)?.[1] || null; if (hit) how = "watchlist"; }
    if (!hit) { const l = byListed.get(n); if (l && !l.ambiguous) { hit = l; how = "list"; } }
    if (!hit && searches < searchBudget) {
      try {
        for (const q of [it.isin, it.name].filter(Boolean)) { searches++; const res = await searchScreener(q); if (res.length) { hit = { symbol: res[0].symbol, exchange: res[0].exchange, label: res[0].name }; how = "screener"; break; } await new Promise(r => setTimeout(r, 300)); }
      } catch (e) { searches = searchBudget; out.push({ symbol: null, how: "later", error: e.message }); continue; } // rate-limited: stop searching this round
      await new Promise(r => setTimeout(r, 300));
    }
    if (hit) { map[key] = { symbol: hit.symbol, exchange: hit.exchange || "NSE", label: hit.label || null }; changed = true; }
    out.push(hit ? { ...map[key], how } : { symbol: null, how: searches >= searchBudget ? "later" : "none" });
  }
  if (changed) await writeJson(nameMapFile, map);
  return out;
}
// Saved X-ray funds with holdings that still have no symbol (an earlier upload when Screener was rate-limiting, or
// before the ISIN list): match them again in the background, at most once an hour per fund, and value the new ones.
const fundFixAt = new Map(), fundFixRun = new Set();
const fundFixRunning = id => fundFixRun.has(`${currentUser().id}:${id}`);
function fixFundSymbols(fundId) {
  const key = `${currentUser().id}:${fundId}`;
  if (Date.now() - (fundFixAt.get(key) || 0) < 3600e3) return false;
  fundFixAt.set(key, Date.now()); fundFixRun.add(key);
  (async () => {
    const st0 = await readJson(U.fundsFile, { funds: [] }), f0 = st0.funds.find(f => f.id === fundId); if (!f0) return;
    const miss = f0.holdings.filter(h => !h.symbol); if (!miss.length) return;
    const found = new Map();
    for (let i = 0; i < miss.length; i += 25) {
      const chunk = miss.slice(i, i + 25), res = await resolveHoldingSymbols(chunk.map(h => ({ name: h.name, isin: /^INE[A-Z0-9]{9}$/.test(h.isin || "") ? h.isin : null })), { searchBudget: 4, wait: 15000 });
      res.forEach((x, k) => { if (x?.symbol) found.set(chunk[k].isin || chunk[k].name, x); });
    }
    if (!found.size) return;
    const st = await readJson(U.fundsFile, { funds: [] }), f = st.funds.find(x => x.id === fundId); if (!f) return;
    const added = [];
    f.holdings = f.holdings.map(h => { const x = !h.symbol && found.get(h.isin || h.name); if (!x) return h; added.push({ ...h, symbol: x.symbol, exchange: x.exchange || "NSE" }); return added.at(-1); });
    await writeJson(U.fundsFile, st);
    for (const h of added) await ensureInPool(h.symbol, h.exchange, h.name, `Added from fund X-ray (${f.name}).`);
    queueFill(added.map(h => h.symbol), 150).catch(() => {});
    console.log(`[x-ray] ${f.name}: matched ${added.length} more holding(s)`);
  })().catch(e => console.warn(`[x-ray] symbol fix failed: ${e.message}`)).finally(() => { fundFixAt.set(key, Date.now()); fundFixRun.delete(key); });
  return true;
}
const dividendsFile = path.join(DATA_DIR, "dividends-cache.json"), technicalsFile = path.join(DATA_DIR, "technicals-cache.json");
// Every valuation row also carries its dividend lens (from the cached dividend history) and the Value / Growth / Buy verdict.
async function computeRows() {
  const [stocks, fundamentals, divCache, sx, glOv] = await Promise.all([syncLivePrices().then(r => r.stocks), readFundamentals(), readJson(dividendsFile, {}), readJson(screenerExtraFile, {}), readJson(U.growthOverridesFile, {})]);
  const exOf = new Map(stocks.map(st => [symOf(st), st.exchange || "NSE"]));
  const rows = computeAll(stocks, fundamentals).map(r => {
    const sym = String(r.symbol || "").toUpperCase(), ev = divCache[sym]?.events;
    r.exchange = exOf.get(sym) || "NSE";
    // Dated Yahoo history when we have it (gives payment months); otherwise Screener's yearly dividend per share.
    if (ev) r.dividend = { ...computeDividends(ev, { price: r.price, pe: r.pe, profitCagr3: r.profitCagr3 }), source: "Yahoo (payment dates)" };
    else if (sx[sym]?.div?.annual?.length) r.dividend = dividendsFromAnnual(sx[sym].div.annual, { price: r.price, profitCagr3: r.profitCagr3, dividendYield: sx[sym].div.yield });
    r.growthLens = growthLens(r, glOv[sym] || {});
    r.verdict = classify(r);
    return r;
  });
  // Sector P/E fallback for display only: median P/E of the other stocks you track in the same sector (3 or more).
  const bySector = new Map();
  for (const r of rows) if (r.sector && r.pe > 0) { if (!bySector.has(r.sector)) bySector.set(r.sector, []); bySector.get(r.sector).push(r); }
  for (const r of rows) {
    if (r.sectorPe || !r.sector) continue;
    const pes = (bySector.get(r.sector) || []).filter(x => x !== r).map(x => x.pe).sort((x, y) => x - y);
    if (pes.length >= 3) { const m = pes.length >> 1; r.sectorPeEst = Math.round((pes.length % 2 ? pes[m] : (pes[m - 1] + pes[m]) / 2) * 10) / 10; r.sectorPeEstN = pes.length; }
  }
  return { stocks, fundamentals, rows };
}
// Dividend history: cached 7 days per stock, fetched one at a time (best effort; failures never block valuation).
let divChain = Promise.resolve(), divCooldownUntil = 0;
// Cache entry: { fetchedAt, events } on success, { fetchedAt, events: null, error } on failure (retried after 6 hours, not on every
// page view). A Yahoo rate-limit pauses all dividend requests for 10 minutes.
const divFresh = (e, force) => e && !force && Date.now() - e.fetchedAt < (e.error ? 6 * 3600e3 : 7 * 864e5);
function fetchDividendsFor(symbols, force = false) {
  const run = async () => {
    if (divCooldownUntil > Date.now()) return;
    const cache = await readJson(dividendsFile, {}); let changed = false;
    const exOf = new Map((await readWatchlist()).map(st => [symOf(st), st.exchange || "NSE"]));
    for (const sym of [...new Set(symbols.map(x => String(x).toUpperCase()))]) {
      if (divFresh(cache[sym], force)) continue;
      try { cache[sym] = { fetchedAt: Date.now(), events: await fetchDividendEvents(sym, { exchange: exOf.get(sym) }) }; changed = true; }
      catch (e) { if (e.rateLimited) { divCooldownUntil = Date.now() + 10 * 60e3; break; } cache[sym] = { fetchedAt: Date.now(), events: null, error: String(e.message || e).slice(0, 160) }; changed = true; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (changed) await writeJson(dividendsFile, cache);
  };
  divChain = divChain.then(run, run); return divChain;
}
// Stocks on a watchlist but with no fundamentals yet (e.g. just added) get them fetched in the background, one at a time.
let fillChain = Promise.resolve();
function queueFill(symbols, limit = 25) {
  const want = new Set(symbols.map(x => String(x).toUpperCase()));
  const run = async () => {
    const [stocks, map] = await Promise.all([readWatchlist(), readFundamentals()]);
    const due = stocks.filter(st => want.has(symOf(st)) && !map[symOf(st)]).slice(0, limit);
    if (due.length) console.log(`[fundamentals] Filling ${due.length} watchlist stock(s) with no data yet.`);
    for (const st of due) { if (job.running) break; try { const [r] = await runFundamentalsFetch([st], false); if (r?.rateLimited) break; } catch { /* next time */ } }
  };
  fillChain = fillChain.then(run, run); return fillChain;
}
// Alerts: compare each stock's verdict with the last check and log buy-zone entries and verdict changes.
const alertsBusy = new Set();
async function runAlerts(rows) {
  const me = currentUser().id; if (alertsBusy.has(me)) return; alertsBusy.add(me);
  try {
    const store = await readJson(U.alertsFile, { state: {}, events: [] });
    const { nextState, fresh } = diffAlerts(store.state, rows, { events: store.events });
    if (fresh.length || JSON.stringify(nextState) !== JSON.stringify(store.state)) await writeJson(U.alertsFile, { state: nextState, events: mergeEvents(store.events, fresh) });
    if (fresh.length) { console.log(`[alerts] ${fresh.map(e => e.title).join(" | ")}`); phonePush(fresh); }
  } finally { alertsBusy.delete(me); }
}
async function logVerdicts(rows) { const log = await readJson(U.valuationLogFile, {}); if (addSnapshots(log, rows, istDay())) await writeJson(U.valuationLogFile, log); }

// Fetch fundamentals for the given stocks and cache them. Sources (source = auto | screener | yahoo | nse):
// auto tries Screener.in, then Yahoo, then NSE; a cached entry is kept and only its market fields refreshed if every
// full source fails and NSE answers. Each source has its own cooldown after a 403/429 and is skipped while it is cooling.
async function runFundamentalsFetch(targets, force = false, source = process.env.FUNDAMENTALS_SOURCE || "auto") {
  const map = await readFundamentals();
  const fresh = e => e?.asOf && !(e.profile === "etf" && e.thin) && !(e.profile !== "etf" && !(e.pe > 0) && !(e.salesTtm > 0)) /* loss-maker saved before v5.2: fetch the sales figures */ && Date.now() - new Date(e.asOf).getTime() < (e.profile === "etf" ? 864e5 : 7 * 864e5); // ETFs: daily; a range-only ETF is always retried
  const order = source === "auto" ? ["screener", "yahoo", "nse"] : [source];
  const results = await mapLimit(targets, 1, async stock => {
    const symbol = symOf(stock);
    if (!force && fresh(map[symbol])) return { id: stock.id, company: stock.company, symbol, skipped: "Fetched within the last 7 days" };
    let entry = null, warnings = [], completeness = null, how = null, rateLimited = false, usedNetwork = false;
    const errors = [], hardErrors = [];
    let nse = null;
    // ETFs have no earnings (and no Screener page): value them on their own price trend instead.
    const etf = isEtf(symbol, stock.company) || map[symbol]?.profile === "etf";
    if (etf) {
      usedNetwork = true;
      try { entry = await fetchEtfEntry(stock, { force }); how = "ETF lens"; completeness = "ETF"; }
      catch (error) { errors.push(`ETF price history: ${error.message}`); if (error.rateLimited) rateLimited = true; else hardErrors.push("etf"); }
      if (!entry && map[symbol]?.profile === "etf" && map[symbol].etfDevQ) { // a full trend reading saved earlier beats a range-only one (today's price comes from the live feed)
        entry = map[symbol]; how = "ETF lens"; completeness = "ETF (52-week range)"; warnings.push(`Price history unavailable right now; kept the trend data from ${map[symbol].asOf}. Retried in 20 minutes.`); errors.length = 0; hardErrors.length = 0;
      }
      if (!entry) { // no history anywhere: 52-week range from a live quote, and try the full lens again later
        try { const r = await etfRangeEntry(stock); if (r) { entry = r; how = "ETF lens"; completeness = "ETF (52-week range)"; warnings.push(`Price history unavailable (${errors.join("; ").slice(0, 200)}); valued on the 52-week range for now, full trend view retried in 20 minutes.`); errors.length = 0; hardErrors.length = 0; } } catch { /* keep the errors */ }
      }
    }
    for (const src of etf ? [] : order) {
      if (entry) break;
      if (src === "nse" && stock.exchange === "BSE") { errors.push("NSE: not listed there (BSE stock)"); continue; }
      try {
        if (src === "screener") {
          if (screenerCooldown()) { errors.push("Screener cooling down"); rateLimited = true; continue; }
          usedNetwork = true; const r = await fetchScreener(stock); entry = r.entry; warnings = [...warnings, ...r.warnings]; how = "Screener"; completeness = "Screener";
          if (r.extra) saveScreenerExtra(symbol, { ids: { companyId: r.extra.companyId, warehouseId: r.extra.warehouseId }, div: { yield: r.extra.dividendYield, annual: r.extra.divAnnual, at: Date.now() }, ...(r.peersTable ? { peers: { table: r.peersTable, at: Date.now() } } : {}) }).catch(() => {});
        } else if (src === "yahoo") {
          if (yahooCooldown() > Date.now()) { errors.push("Yahoo cooling down"); rateLimited = true; continue; }
          usedNetwork = true; const r = await fetchFundamentalsForStock(stock); entry = r.entry; warnings = [...warnings, ...r.warnings]; completeness = r.completeness; how = "Yahoo";
        } else {
          usedNetwork = true; nse = await fetchNseQuote(symbol);
          const cached = map[symbol];
          if (cached && nse) { entry = refreshFromNse(cached, nse); how = "NSE refresh of cached statements"; completeness = "Cached + NSE"; }
          else if (nse) { entry = mergeNse(null, nse, stock); how = "NSE only (low confidence)"; completeness = "NSE-only"; }
        }
      } catch (error) { errors.push(`${src}: ${error.message}`); if (error.rateLimited) rateLimited = true; else hardErrors.push(src); }
    }
    // Not on Screener: maybe an ETF we did not recognise by name. Yahoo says so in its chart details.
    if (!entry && !etf && errors.some(e => /no page for/i.test(e)) && yahooCooldown() <= Date.now()) {
      try { const e2 = await fetchEtfEntry(stock, { requireEtf: true }); if (e2) { entry = e2; how = "ETF lens"; completeness = "ETF"; errors.length = 0; hardErrors.length = 0; } } catch { /* not an ETF */ }
    }
    // "Busy, retrying" only when every source that was tried was rate-limited; a real error (no page, bad symbol) is shown.
    if (hardErrors.length) rateLimited = false;
    // Light NSE supplement for sector P/E when a full source succeeded and NSE is not cooling down.
    if (entry && how !== "ETF lens" && stock.exchange !== "BSE" && how !== "NSE only (low confidence)" && !how.startsWith("NSE") && order.includes("nse") && !nseCooldown()) {
      try { nse = await fetchNseQuote(symbol); entry = mergeNse(entry, nse, stock); how += "+NSE"; } catch { /* optional */ }
    }
    if (usedNetwork) await new Promise(r => setTimeout(r, how?.startsWith("Screener") || order[0] === "screener" ? screenerConfig.spacingMs : 1200));
    if (!entry) { console.error(`[fundamentals] ${stock.company}: ${errors.join(" | ") || "no data"}`); return { id: stock.id, company: stock.company, symbol, error: errors.join("; ") || "No data from any source", rateLimited }; }
    if (errors.length) warnings = [...warnings, `Fallback used (${errors.join("; ")})`];
    return { id: stock.id, company: stock.company, symbol, entry: sanitizeEntry(entry), warnings, completeness, sources: how, rateLimited: false, retryLater: completeness === "ETF (52-week range)" };
  });
  const latest = await readFundamentals();
  for (const r of results) if (r.entry) latest[r.symbol] = r.entry;
  await writeFundamentals(latest);
  // A stock added by symbol only is named after its symbol; use the real company name once a source supplies it.
  const named = results.filter(r => r.entry?.companyName);
  if (named.length) {
    const list = await readWatchlist(); let changed = false;
    for (const r of named) { const st = list.find(x => x.id === r.id); if (st && st.company.toUpperCase() === symOf(st)) { st.company = r.entry.companyName; changed = true; } }
    if (changed) await writeWatchlist(list);
  }
  if (results.some(r => r.entry)) { await logVerdicts(computeAll(await readWatchlist(), latest)); fetchDividendsFor(results.filter(r => r.entry).map(r => r.symbol)).then(async () => runAlerts((await computeRows()).rows)).catch(() => {}); }
  return results;
}

// ---- Background "refresh all" job: walks the whole watchlist one stock at a time, survives page reloads ----
const job = perUser(() => ({ running: false, cancel: false, total: 0, done: 0, saved: 0, skipped: 0, failed: [], current: null, startedAt: null, finishedAt: null, source: "auto", note: "" })).proxy;
async function runJob(stocks, force, source) {
  Object.assign(job, { running: true, cancel: false, total: stocks.length, done: 0, saved: 0, skipped: 0, failed: [], current: null, startedAt: new Date().toISOString(), finishedAt: null, source, note: "" });
  let hardBlocks = 0;
  for (const stock of stocks) {
    if (job.cancel) { job.note = "Cancelled."; break; }
    job.current = stock.company;
    try {
      const [r] = await runFundamentalsFetch([stock], force, source);
      if (r.skipped) job.skipped++;
      else if (r.entry) { job.saved++; hardBlocks = 0; }
      else { job.failed.push({ company: r.company, error: r.error }); if (r.rateLimited) hardBlocks++; else hardBlocks = 0; }
    } catch (e) { job.failed.push({ company: stock.company, error: e.message }); }
    job.done++;
    if (hardBlocks >= 3) { job.note = "Paused: every source is rate-limiting. Run Refresh all again in 30-60 minutes; stocks already saved are skipped."; break; }
  }
  Object.assign(job, { running: false, current: null, finishedAt: new Date().toISOString() });
  if (!job.note) job.note = `Finished: ${job.saved} saved, ${job.skipped} already fresh, ${job.failed.length} failed.`;
}
// ---- Kite account slots: each slot is its own MCP session, so several Zerodha accounts can be logged in at once ----
const kiteClients = new Map(); // "<user id>:<slot>" -> client
async function kiteSlotList() {
  const saved = (await readJson(U.kiteSlotsFile, { slots: [] })).slots || [];
  return [{ id: "main", label: "Account 1" }, ...saved.filter(x => x.id !== "main")].map((x, i) => ({ id: x.id, label: x.label || `Account ${i + 1}` }));
}
async function kiteFor(id = "main") {
  if (id === "main") return kiteMain.get();
  const key = `${currentUser().id}:${id}`;
  if (kiteClients.has(key)) return kiteClients.get(key);
  const list = await kiteSlotList();
  if (!list.some(x => x.id === id)) throw Object.assign(new Error("Unknown Kite account slot."), { badSlot: true });
  const client = createKiteClient({ sessionFile: userFile(`kite-session-${id}.json`) });
  kiteClients.set(key, client); return client;
}
async function anyKiteWithSession() {
  for (const slot of await kiteSlotList()) { const c = await kiteFor(slot.id); if (c.config.enabled && await c.hasSession()) return c; }
  return null;
}
const BROKER_LABELS = { zerodha: "Zerodha", ...BROKER_NAMES, indmoney: "INDmoney", other: "Imported" };
// Minimal CSV reader for broker statements: quoted cells, CRLF, blank lines skipped, any header names.
function parseCsvLoose(text) {
  const rows = []; let row = [], cell = "", q = false;
  const end = () => { row.push(cell.trim()); cell = ""; if (row.some(Boolean)) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === "," || c === "\t") { row.push(cell.trim()); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; end(); }
    else cell += c;
  }
  if (cell || row.length) end();
  return rows;
}
const brokerOf = a => a.broker || "zerodha";
// Indian broker holdings removed in the app: imported (CSV) accounts are deleted; synced ones are listed in store.hiddenEq and
// their stock holdings are left out everywhere (holdings, net worth, swing, Ask AI...) until "Show again". Funds and US
// holdings of the same account are not touched. A sync keeps refreshing them, so Show again brings back current data.
const isImportedAcct = a => a?.via === "csv" || a?.via === "manual";
function visibleHoldStore(store) {
  const hid = new Set(store?.hiddenEq || []); if (!hid.size) return store;
  const accounts = {}; for (const [id, a] of Object.entries(store.accounts || {})) accounts[id] = hid.has(id) ? { ...a, holdings: [], hiddenEq: true } : a;
  return { ...store, accounts };
}
const readHoldStore = async () => visibleHoldStore(await readJson(U.kiteHoldingsFile, { accounts: {} }));
function kiteAccountsSummary(store) { return Object.entries(store.accounts || {}).filter(([id]) => !(store.hiddenEq || []).includes(id)).map(([userId, a]) => ({ userId, broker: brokerOf(a), brokerName: BROKER_LABELS[brokerOf(a)] || brokerOf(a), clientId: a.clientId || userId, label: a.label, syncedAt: a.syncedAt, count: a.holdings?.length || 0, priceNote: a.priceNote || null, via: a.via || (brokerOf(a) === "zerodha" ? "mcp" : "api") })); }
// Combines every synced broker account into one row per symbol, and attaches what the rest of the app knows about it:
// valuation, thesis status, watchlist rating and a rule-based stance (accumulate / hold / ...).
async function kiteHoldingsView() {
  const [store, { stocks, fundamentals, rows: vrows }] = await Promise.all([readHoldStore(), computeRows()]);
  const accounts = Object.entries(store.accounts || {});
  const thesisBySym = accounts.length ? new Map((await thesisView()).rows.map(r => [r.symbol, r])) : new Map();
  const bySym = new Map(stocks.map(s => [symOf(s), s])), vBySym = new Map(vrows.map(r => [String(r.symbol || "").toUpperCase(), r]));
  const merged = new Map(), accTot = new Map();
  // Dhan and Groww may return holdings without a price (no data plan). Value those at a live price another broker returned
  // for the same symbol, else at the watchlist price, and say so.
  const livePrice = new Map();
  for (const [, acct] of accounts) for (const h of acct.holdings || []) if (Number.isFinite(h.lastPrice) && !livePrice.has(h.symbol)) livePrice.set(h.symbol, h.lastPrice);
  for (const [userId, acct] of accounts) for (const h00 of acct.holdings || []) {
    // invested / value / P/L from quantity × average cost and × price when a broker or an import did not supply them
    const inv0 = Number.isFinite(h00.invested) ? h00.invested : Number.isFinite(h00.avgPrice) ? h00.avgPrice * h00.qty : null;
    const val0 = Number.isFinite(h00.value) ? h00.value : Number.isFinite(h00.lastPrice) ? h00.lastPrice * h00.qty : null;
    const h0 = { ...h00, invested: inv0, value: val0, pnl: Number.isFinite(h00.pnl) ? h00.pnl : inv0 !== null && val0 !== null ? val0 - inv0 : null };
    let h = h0, priceFromWatchlist = false;
    const lp = livePrice.get(h.symbol);
    if (!Number.isFinite(h.lastPrice) && Number.isFinite(lp)) { const value = lp * h.qty; h = { ...h, lastPrice: lp, value, pnl: Number.isFinite(h.invested) ? value - h.invested : null }; }
    const wp = bySym.get(h.symbol)?.price;
    if (!Number.isFinite(h.lastPrice) && Number.isFinite(wp) && wp > 0) {
      const value = wp * h.qty; priceFromWatchlist = true;
      h = { ...h, lastPrice: wp, value, pnl: Number.isFinite(h.invested) ? value - h.invested : null };
    }
    const row = merged.get(h.symbol) || { symbol: h.symbol, qty: 0, invested: 0, value: 0, pnl: 0, dayChangePct: h.dayChangePct, kitePrice: h.lastPrice, syncPrice: h.lastPrice, priceFromWatchlist: false, accounts: [] };
    if (row.syncPrice == null && h.lastPrice != null) { row.syncPrice = row.kitePrice = h.lastPrice; row.dayChangePct ??= h.dayChangePct; }
    row.qty += h.qty; row.invested += h.invested || 0; row.value += h.value || 0; row.pnl += h.pnl || 0;
    row.priceFromWatchlist ||= priceFromWatchlist;
    { const t = accTot.get(userId) || { invested: 0, value: 0 }; t.invested += h.invested || 0; t.value += h.value || 0; accTot.set(userId, t); }
    row.accounts.push({ userId, broker: brokerOf(acct), brokerName: BROKER_LABELS[brokerOf(acct)] || brokerOf(acct), label: acct.label, qty: h.qty, avgPrice: h.avgPrice });
    merged.set(h.symbol, row);
  }
  const r2 = v => Math.round(v * 100) / 100;
  const totalValue = [...merged.values()].reduce((a, r) => a + r.value, 0);
  const holdings = [...merged.values()].map(r => {
    const stock = bySym.get(r.symbol) || null, v = vBySym.get(r.symbol) || null, th = thesisBySym.get(r.symbol) || null;
    const base = { ...r, invested: r2(r.invested), value: r2(r.value), pnl: r2(r.pnl), avgPrice: r.qty ? r2(r.invested / r.qty) : null };
    const weightPct = totalValue > 0 ? Math.round((r.value / totalValue) * 1000) / 10 : null;
    const stance = holdingStance({ holding: base, weightPct, row: v, stock, thesis: th });
    return { ...base, weightPct, company: stock?.company || null, inWatchlist: !!stock, watchlistPrice: stock?.price ?? null, stance,
      stockInfo: stock ? { id: stock.id, bucket: stock.bucket, action: stock.action, valuationLabel: stock.valuation, style: stock.style || null, note: stock.note || "", kpi: stock.kpi || "", latestNews: stock.latestNews || null, priceSource: stock.priceSource || null, updated: stock.updated || null } : null,
      valuation: v && v.view !== "No fundamentals" ? { view: v.view, status: v.status, ratio: v.ratio, pe: v.pe, fairMultiple: v.fairMultiple, basis: v.basis, fairValue: v.fairValue, upsideToBase: v.upsideToBase, zoneLow: v.zoneLow, zoneHigh: v.zoneHigh, gapToZone: v.gapToZone, confidence: v.confidence || null, stale: !!v.stale, roce: v.roce, roe: v.roe, promoter: v.promoter, salesCagr3: v.salesCagr3, profitCagr3: v.profitCagr3, low: v.low, high: v.high, rangePos: v.rangePos, cap: v.cap || null, reasons: v.reasons || [], dataAsOf: fundamentals[r.symbol]?.asOf || null } : null,
      thesis: th ? { status: th.status, reasons: th.reasons, conditions: th.conditions } : null };
  }).sort((a, b) => b.value - a.value);
  const sum = k => r2(holdings.reduce((a, h) => a + h[k], 0)), count = a => holdings.filter(h => h.stance.action === a).length;
  const brokersHeld = [...new Set(accounts.filter(([, a]) => !a.hiddenEq).map(([, a]) => brokerOf(a)))].map(b => BROKER_LABELS[b] || b);
  const raw = store.hiddenEq?.length ? await readJson(U.kiteHoldingsFile, { accounts: {} }) : null;
  const hiddenAccounts = (store.hiddenEq || []).map(id => { const a = raw?.accounts?.[id] || {}; return { userId: id, broker: brokerOf(a), brokerName: BROKER_LABELS[brokerOf(a)] || brokerOf(a), label: a.label || id, count: (a.holdings || []).length, syncedAt: a.syncedAt || null }; });
  return { accounts: kiteAccountsSummary(store).map(a => ({ ...a, imported: isImportedAcct(store.accounts[a.userId]), invested: r2(accTot.get(a.userId)?.invested || 0), value: r2(accTot.get(a.userId)?.value || 0) })), hiddenAccounts, brokers: brokersHeld, holdings, totals: { invested: sum("invested"), value: sum("value"), pnl: sum("pnl"), count: holdings.length, notInWatchlist: holdings.filter(h => !h.inWatchlist).length, watchlistNotHeld: stocks.filter(s => symOf(s) && !merged.has(symOf(s))).length, stance: { accumulate: count("Accumulate"), hold: count("Hold"), dontAdd: count("Hold (don't add)"), review: count("Review"), trim: count("Trim"), noView: count("No view") } } };
}
// Re-checks every thesis against the latest numbers. First-break dates and status flips are stored, and a flip is
// written to the change history (field "thesis") so it appears in Reports -> Change history.
async function thesisView() {
  const [store, { stocks, fundamentals, rows }, kiteStore] = await Promise.all([readJson(U.thesesFile, {}), computeRows(), readHoldStore()]);
  const rowBySym = new Map(rows.map(r => [String(r.symbol || "").toUpperCase(), r])), bySym = new Map(stocks.map(x => [symOf(x), x]));
  const held = new Set(Object.values(kiteStore.accounts || {}).flatMap(a => (a.holdings || []).map(h => h.symbol)));
  const now = new Date().toISOString(); let dirty = false; const flips = [], out = [];
  for (const [symbol, thesis] of Object.entries(store)) {
    const stock = bySym.get(symbol); if (!stock) continue;
    const ev = evaluateThesis(thesis, { row: rowBySym.get(symbol), f: fundamentals[symbol], s: stock });
    const r = trackBreaks(thesis, ev, now); if (r.changed) dirty = true; if (r.flip) flips.push({ stock, ...r.flip });
    out.push({ symbol, id: stock.id, company: stock.company, held: held.has(symbol), reasons: thesis.reasons, updatedAt: thesis.updatedAt, status: ev.status, broken: ev.broken, ok: ev.ok, nodata: ev.nodata, dataAsOf: fundamentals[symbol]?.asOf || null, conditions: ev.conditions.map(c => ({ ...c, brokenSince: thesis.brokenSince?.[c.id] || null })) });
  }
  if (flips.length) { const h = await readHistory(); for (const f of flips) h.changes.push({ id: f.stock.id, company: f.stock.company, field: "thesis", from: f.from, to: f.to, at: now }); h.changes = h.changes.slice(-MAX_CHANGE_LOG); await writeHistory(h); }
  if (dirty) await writeJson(U.thesesFile, store);
  const rank = { Broken: 0, Unassessed: 1, Intact: 2 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || Number(b.held) - Number(a.held) || a.company.localeCompare(b.company));
  return { rows: out, summary: { total: out.length, broken: out.filter(x => x.status === "Broken").length, intact: out.filter(x => x.status === "Intact").length, unassessed: out.filter(x => x.status === "Unassessed").length, brokenAndHeld: out.filter(x => x.status === "Broken" && x.held).length, withoutThesis: stocks.filter(x => symOf(x) && !store[symOf(x)]).length }, metrics: Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label, unit: m.unit, hint: m.hint || "" })), ops: Object.keys(OPS), presets: PRESETS };
}
function clean(text) { return String(text || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim(); }

async function readHistory() { try { return JSON.parse(await fs.readFile(U.historyFile, "utf8")); } catch { return { changes: [], priceSeries: {} }; } }
async function writeHistory(history) { await fs.mkdir(path.dirname(U.historyFile), { recursive: true }); await fs.writeFile(U.historyFile, JSON.stringify(history, null, 2)); }
// One Zerodha login: stocks (get_holdings) and mutual funds (get_mf_holdings, Coin) stored together, keyed by Kite user id.
async function syncKiteSlot(kc, slotId, slotLabel, label) {
  const profile = await kc.profile(); if (!profile) throw new Error("Kite did not return a user id for this login.");
  const holdings = await kc.holdings();
  let mf = null, mfError = null;
  try { mf = await kc.mfHoldings(); } catch (e) { if (e.loginRequired) throw e; mfError = String(e.message || e).slice(0, 200); }
  const store = await readJson(U.kiteHoldingsFile, { accounts: {} }); store.accounts ||= {};
  const prev = store.accounts[profile.userId] || {};
  store.accounts[profile.userId] = { ...prev, broker: "zerodha", slot: slotId, clientId: profile.userId, label: String(label || "").trim().slice(0, 60) || prev.label || (slotId !== "main" ? slotLabel : null) || profile.name || profile.userId, name: profile.name, syncedAt: new Date().toISOString(), holdings,
    ...(mf ? { mf, mfSyncedAt: new Date().toISOString(), mfError: null } : { mfError }) };
  await writeJson(U.kiteHoldingsFile, store);
  console.log(`[kite] Synced ${holdings.length} holding(s)${mf ? ` and ${mf.length} mutual fund(s)` : ` (mutual funds: ${mfError})`} for ${profile.userId}.`);
  return { profile, holdings, mf: mf || prev.mf || [], mfError };
}

// ---- Backup / restore: one JSON file with every file in your private folder ----
const BACKUP_SECRET_FILES = /^(kite-session(-[\w-]+)?|broker-sessions|broker-credentials|broker-mcp|notify|ai-key)\.json$/;
const BACKUP_NAME_RE = /^[a-z0-9][\w-]{0,60}\.json$/i;
async function makeBackup(includeSecrets) {
  const dir = userDir(), files = {};
  for (const name of (await fs.readdir(dir).catch(() => [])).sort()) {
    if (!BACKUP_NAME_RE.test(name) || (!includeSecrets && BACKUP_SECRET_FILES.test(name))) continue;
    try { files[name] = JSON.parse(await fs.readFile(path.join(dir, name), "utf8")); } catch { /* skip unreadable */ }
  }
  const u = currentUser();
  return { app: "equity-watchlist", kind: "account-backup", version: 1, createdAt: new Date().toISOString(), account: u.username, includesBrokerLogins: !!includeSecrets, files };
}
async function restoreBackup(b, { replace = false } = {}) {
  if (b?.app !== "equity-watchlist" || b.kind !== "account-backup" || typeof b.files !== "object" || !b.files) throw new Error("That is not a backup file from this app.");
  const names = Object.keys(b.files);
  if (!names.length) throw new Error("The backup is empty.");
  if (names.some(n => !BACKUP_NAME_RE.test(n))) throw new Error("The backup contains unexpected file names; nothing was restored.");
  const dir = userDir(); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // Keep a copy of what is here now, so a restore can be undone by restoring this file.
  const safety = await makeBackup(true); await fs.writeFile(path.join(dir, ".before-restore.json"), JSON.stringify(safety), { mode: 0o600 });
  if (replace) for (const name of await fs.readdir(dir)) if (BACKUP_NAME_RE.test(name) && !names.includes(name) && !BACKUP_SECRET_FILES.test(name)) await fs.rm(path.join(dir, name), { force: true });
  for (const name of names) { await fs.writeFile(path.join(dir, name), JSON.stringify(b.files[name], null, 2), { mode: BACKUP_SECRET_FILES.test(name) ? 0o600 : 0o644 }); }
  for (const s of [brokersU, kiteMain, brokerMcpU]) s.drop(currentUser().id);
  for (const k of [...kiteClients.keys()]) if (k.startsWith(`${currentUser().id}:`)) kiteClients.delete(k);
  return names;
}

// ---- Automatic daily backups (02:30 IST): every account, kept BACKUP_KEEP_DAYS days, optional S3 copy, read back and checked ----
const backupState = { running: false, last: null };
const backupDir = () => backupConfig().dir || path.join(DATA_DIR, "backups");
async function runBackups() {
  if (backupState.running) return backupState.last; backupState.running = true;
  const cfg = backupConfig(), day = istDay(), report = { day, at: new Date().toISOString(), accounts: [], errors: [], s3: cfg.s3 ? `s3://${cfg.s3.bucket}/${cfg.s3.prefix}` : null, dir: backupDir() };
  try {
    await forEachUser(async () => {
      const u = currentUser(), b = await makeBackup(cfg.includeSecrets), n = Object.keys(b.files).length, buf = gz(b), name = u.username.replace(/[^\w.-]/g, "_");
      try {
        const f = await writeLocal(backupDir(), day, name, buf); verifyBackup(await readLocal(backupDir(), day, name), n); // read back and check
        const row = { account: u.username, files: n, bytes: buf.length, file: f, checked: true };
        if (cfg.s3) { try { row.s3 = await s3Put(cfg.s3, `${day}/${name}.json.gz`, buf); } catch (e) { row.s3Error = e.message; report.errors.push(`${u.username} S3: ${e.message}`); } }
        report.accounts.push(row);
      } catch (e) { report.errors.push(`${u.username}: ${e.message}`); }
    });
    report.pruned = await pruneLocal(backupDir(), cfg.keepDays, day);
    console.log(`[backup] ${report.accounts.length} account(s) backed up${cfg.s3 ? " (+S3)" : ""}${report.errors.length ? `; problems: ${report.errors.join("; ")}` : ""}`);
  } catch (e) { report.errors.push(e.message); }
  finally { backupState.running = false; backupState.last = report; await writeJson(path.join(DATA_DIR, "backup-status.json"), report).catch(() => {}); }
  return report;
}
let lastBackupDay = null;
setInterval(() => { const n = new Date(Date.now() + 5.5 * 3600e3), m = n.getUTCHours() * 60 + n.getUTCMinutes(), day = n.toISOString().slice(0, 10); if (process.env.BACKUP !== "0" && m >= 150 && m <= 240 && lastBackupDay !== day) { lastBackupDay = day; runBackups().catch(() => {}); } }, 10 * 60e3).unref();

// ---- Freshness: tell the user when numbers are old or a broker login has lapsed ----
const kiteStatusCache = new Map();
const weekdaysSince = (iso, now = new Date()) => { if (!iso) return Infinity; let d = new Date(`${istDay(new Date(iso))}T00:00:00Z`), n = 0; const end = istDay(now); while (true) { d = new Date(d.getTime() + 864e5); const day = d.toISOString().slice(0, 10); if (day > end) break; const wd = d.getUTCDay(); if (wd !== 0 && wd !== 6) n++; } return n; };
const ageText = iso => { const h = (Date.now() - new Date(iso).getTime()) / 36e5; return h < 1 ? "less than an hour ago" : h < 24 ? `${Math.round(h)} h ago` : `${Math.round(h / 24)} day${Math.round(h / 24) === 1 ? "" : "s"} ago`; };
async function freshnessView() {
  const warnings = [], uid = currentUser().id;
  // Security: sign-ins from a device not seen before (last 7 days) and bursts of wrong passwords (last 24 h).
  const act = auth.activity(currentUser(), currentSessionKey()), cur = act.sessions.find(x => x.current);
  const ok = act.events.filter(e => e.kind === "signed in" || e.kind === "account created");
  const fresh = ok.filter((e, i) => Date.now() - e.at < 7 * 864e5 && !ok.slice(i + 1).some(o => o.device === e.device) && !(cur && cur.device === e.device && Math.abs(cur.signedInAt - e.at) < 5000));
  if (fresh.length && ok.length > fresh.length) warnings.push({ id: `newdev:${fresh[0].at}`, level: "bad", text: `New sign-in to your account from ${fresh[0].device}${fresh[0].place ? ` in ${fresh[0].place}` : fresh[0].ip ? ` (${fresh[0].ip})` : ""} on ${new Date(fresh[0].at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}. If this was not you, sign out other devices and change your password.`, action: { label: "Review sign-ins", account: "activity" } });
  const bad = act.events.filter(e => e.kind === "wrong password" && Date.now() - e.at < 864e5);
  if (bad.length >= 3) warnings.push({ id: `badpw:${bad[0].at}`, level: "warn", text: `${bad.length} wrong-password attempts on your account in the last 24 hours (latest from ${bad[0].device}${bad[0].ip ? `, ${bad[0].ip}` : ""}).`, action: { label: "Review sign-ins", account: "activity" } });
  const store = await readHoldStore();
  for (const [id, a] of Object.entries(store.accounts || {})) {
    if (a.hiddenEq && !(a.mf || []).length && !(a.us || []).length) continue; // removed in the app: no sync reminders
    const broker = BROKER_LABELS[a.broker || "zerodha"] || a.broker || "Zerodha";
    if (weekdaysSince(a.syncedAt) >= 2) warnings.push({ id: `sync:${id}`, level: "warn", text: `${broker} · ${a.label || id}: holdings last synced ${a.syncedAt ? ageText(a.syncedAt) : "never"}. Values and P/L on My holdings and Net worth may be out of date.`, action: { label: "Sync now", view: "integrations" } });
    if (a.mfError && (a.broker || "zerodha") === "zerodha") warnings.push({ id: `mf:${id}`, level: "info", text: `Zerodha · ${a.label || id}: mutual funds could not be read on the last sync (${a.mfError}).`, action: { label: "Net worth", view: "networth" } });
  }
  if (kiteDefaults.config.enabled) for (const sl of await kiteSlotList()) {
    const c = await kiteFor(sl.id); if (!(await c.hasSession())) continue;
    const key = `${uid}:${sl.id}`; let hit = kiteStatusCache.get(key);
    if (!hit || Date.now() - hit.at > 10 * 60e3) { let st; try { st = await Promise.race([c.status(), new Promise(r => setTimeout(() => r(null), 8000))]); } catch { st = null; } hit = { at: Date.now(), st }; kiteStatusCache.set(key, hit); }
    if (hit.st?.loginRequired) warnings.push({ id: `kite:${sl.id}`, level: "bad", text: `Zerodha login for ${sl.label} has expired (Kite logins end every morning). Log in again to sync holdings and use live prices.`, action: { label: "Log in to Kite", view: "integrations" } });
  }
  const stocks = await readWatchlist();
  if (stocks.length) {
    // newest of the last full refresh and the newest live price written to the watchlist (the live stream updates prices without a full refresh)
    const meta = await readJson(userFile("meta.json"), {}), newest = Math.max(Date.parse(meta.lastPriceRefresh || "") || 0, ...stocks.map(x => Math.min(Date.parse(x.priceAt || "") || 0, Date.now())));
    const last = newest ? new Date(newest).toISOString() : null;
    if (weekdaysSince(last) >= 2) warnings.push({ id: "prices", level: "warn", text: `Watchlist prices were last refreshed ${last ? ageText(last) : "a while ago"}. Verdicts and buy zones use those prices.`, action: { label: "Refresh prices", refresh: true } });
    const map = await readFundamentals(), stale = stocks.filter(st => { const f = map[symOf(st)]; return f?.asOf && Date.now() - new Date(f.asOf).getTime() > 30 * 864e5; }).length;
    if (stale >= 5) warnings.push({ id: "fund", level: "info", text: `${stale} stocks have fundamentals older than 30 days.`, action: { label: "Valuation table", view: "valuation" } });
  }
  return { warnings, checkedAt: new Date().toISOString() };
}

// ---- Tax view: Zerodha Console tradebook → FIFO lots → long / short term, harvesting ideas ----
const taxFile = () => userFile("tradebook.json");
async function taxHoldings(account = "all") {
  const [view0, store] = await Promise.all([kiteHoldingsView(), readHoldStore()]);
  // one account: its own holdings (each PAN has its own ₹1.25 L exemption), priced like the combined view
  const view = account === "all" ? view0 : { holdings: (store.accounts?.[account]?.holdings || []).map(h => { const v = view0.holdings.find(x => x.symbol === h.symbol); const price = v && v.qty ? v.value / v.qty : h.lastPrice || h.avgPrice; return { ...h, company: v?.company || h.symbol, value: price * h.qty }; }) };
  if (account !== "all") store.accounts = { [account]: store.accounts?.[account] || {} };
  const isinOf = new Map(); for (const a of Object.values(store.accounts || {})) for (const h of a.holdings || []) if (h.isin) isinOf.set(h.symbol, h.isin);
  const out = view.holdings.map(h => ({ key: h.symbol, symbol: h.symbol, isin: isinOf.get(h.symbol) || null, name: h.company || h.symbol, qty: h.qty, price: h.qty ? h.value / h.qty : null, avgPrice: h.avgPrice, kind: "stock" }));
  const mf = new Map();
  for (const a of Object.values(store.accounts || {})) for (const f of a.mf || []) { const m = mf.get(f.isin) || { key: f.isin, symbol: null, isin: f.isin, name: f.name, qty: 0, cost: 0, price: f.nav, kind: "mf" }; m.qty += f.units; m.cost += (f.avgNav || 0) * f.units; mf.set(f.isin, m); }
  for (const m of mf.values()) out.push({ ...m, avgPrice: m.qty ? m.cost / m.qty : null });
  return out;
}
async function taxPage(account = "all") {
  const [st, accounts] = await Promise.all([readJson(taxFile(), { trades: [], imports: [] }), accountsList()]);
  const single = accounts.length === 1 ? accounts[0].id : null;
  const trades = account === "all" ? st.trades : st.trades.filter(x => (x.account || single) === account);
  return { ...taxView({ trades, holdings: await taxHoldings(account), today: istDay() }), imports: st.imports || [], accounts, account, untaggedTrades: st.trades.filter(x => !x.account).length,
    perAccount: account === "all" && accounts.length > 1 ? "Each account holder (PAN) has their own ₹1.25 lakh long-term exemption: pick an account above to see its own harvesting room." : null };
}

// ---- Returns (XIRR) vs the index, dividends received, forward dividend calendar ----
// Index history: our NSE end-of-day files, topped up for older years from Yahoo (shared cache, weekly).
const indexHistFile = path.join(DATA_DIR, "index-history.json");
const BENCH = { NIFTY50: { label: "Nifty 50", yahoo: "^NSEI" }, NIFTY500: { label: "Nifty 500", yahoo: "^CRSLDX" }, SMALLCAP250: { label: "Nifty Smallcap 250", yahoo: "^CNXSC", yahooLabel: "Nifty Smallcap 100 (older years)" } };
const indexFetch = new Map(); // index key -> { at: last try, p: running fetch }
async function indexBars(key) {
  const own = await eodBars(`_index-${key}`), cache = await readJson(indexHistFile, {}), c = cache[key];
  // Yahoo's 10-year history, refreshed weekly in the background (pages never wait for it, except a first-ever fetch for up
  // to 3 s); a failed try is not repeated for 30 minutes
  const job = indexFetch.get(key);
  if ((!c || Date.now() - c.at > 7 * 864e5) && BENCH[key]?.yahoo && !(barSources.yahoo > Date.now()) && !job?.p && !(job?.at > Date.now() - 30 * 60e3)) {
    const p = (async () => {
      try { const { bars } = await fetchChart(BENCH[key].yahoo, { raw: true, range: "10y" }); if (bars.length > 200) { const cc = await readJson(indexHistFile, {}); cc[key] = { at: Date.now(), bars: bars.map(b => ({ t: b.t, c: b.c })) }; await writeJson(indexHistFile, cc); } }
      catch (e) { if (e.rateLimited) barSources.yahoo = Date.now() + 15 * 60e3; }
      finally { indexFetch.set(key, { at: Date.now(), p: null }); }
    })();
    indexFetch.set(key, { at: Date.now(), p });
    if (!c && !own.length && !job) await Promise.race([p, new Promise(r => setTimeout(r, 2000))]);
  }
  // Yahoo for the years before our own data starts; ours from then on (scaled to Yahoo's level when the index differs)
  const yb = (c ? cache : await readJson(indexHistFile, {}))[key]?.bars || [];
  if (!own.length) return yb;
  const start = own[0].t, older = yb.filter(b => b.t < start - 43200);
  if (!older.length) return own;
  const overlap = yb.find(b => Math.abs(b.t - start) < 4 * 86400), k = overlap ? own[0].c / overlap.c : 1;
  return [...older.map(b => ({ t: b.t, c: b.c * k })), ...own];
}
// Holdings of one account (or all) with today's price
async function holdingsOf(account = "all") {
  const [store, stocks] = await Promise.all([readHoldStore(), readWatchlist()]);
  const wl = new Map(stocks.map(x => [symOf(x), x])), merged = new Map();
  for (const [id, a] of Object.entries(store.accounts || {})) {
    if (account !== "all" && id !== account) continue;
    for (const h of a.holdings || []) {
      const sym = String(h.symbol || "").toUpperCase(); if (!sym || !(h.qty > 0)) continue;
      const price = livePriceCache.get(`${h.exchange || "NSE"}:${sym}`)?.price ?? wl.get(sym)?.price ?? h.lastPrice ?? null;
      const m = merged.get(sym) || { symbol: sym, name: wl.get(sym)?.company || h.company || sym, qty: 0, cost: 0, price };
      m.qty += h.qty; m.cost += (h.avgPrice || 0) * h.qty; merged.set(sym, m);
    }
  }
  return [...merged.values()].map(m => ({ ...m, avgPrice: m.qty ? m.cost / m.qty : null }));
}
// Every known dividend (NSE corporate actions + Yahoo's dated history) as [{symbol, exDate, amount}]
async function allDividends(symbols) {
  const [ce, divCache] = await Promise.all([corpEvents(), readJson(dividendsFile, {})]);
  const m = new Map();
  for (const sym of symbols) for (const e of divCache[sym]?.events || []) if (e.a > 0) m.set(`${sym}:${e.d}`, { symbol: sym, exDate: e.d, amount: e.a, source: "Yahoo" });
  for (const a of ce.actions || []) if (a.kind === "dividend" && a.amount > 0 && symbols.has(a.symbol)) m.set(`${a.symbol}:${a.exDate}`, { symbol: a.symbol, exDate: a.exDate, amount: a.amount, source: "NSE" });
  return [...m.values()];
}
const accountsList = async () => Object.entries((await readHoldStore()).accounts || {}).map(([id, a]) => ({ id, label: a.label || id, broker: a.brokerName || a.broker || "" }));
async function returnsPage(account = "all") {
  const [tb, holdings, accounts, sw] = await Promise.all([readJson(taxFile(), { trades: [] }), holdingsOf(account), accountsList(), readJson(swingFile(), {})]);
  const single = accounts.length === 1 ? accounts[0].id : null;
  const trades = (tb.trades || []).filter(x => x.symbol && (account === "all" || (x.account || single) === account));
  const syms = new Set([...trades.map(x => x.symbol), ...holdings.map(h => h.symbol)]);
  const [dividends, ...benchBars] = await Promise.all([allDividends(syms), ...Object.keys(BENCH).map(k => indexBars(k))]);
  const benchmarks = Object.fromEntries(Object.keys(BENCH).map((k, i) => [k, benchBars[i]]).filter(([, b]) => b.length));
  const today = istDay(), view = returnsView({ trades, holdings, dividends, benchmarks, today, label: account === "all" ? "All accounts" : accounts.find(a => a.id === account)?.label || account });
  // Swing book: its own XIRR and index twin
  const swPrices = await livePrices([...(sw.positions || [])], 60e3, { budgetMs: 0 });
  const swf = swingFlows(sw, swPrices, today);
  const swing = (sw.closed || []).length || (sw.positions || []).length ? { xirr: swf.xirr, value: swf.value, bench: Object.fromEntries(Object.entries(benchmarks).map(([k, b]) => [k, indexTwin(swf.flows, b, today)])) } : null;
  return { ...view, swing, accounts, account, benchmarks: Object.fromEntries(Object.entries(BENCH).map(([k, v]) => [k, { label: v.label, available: !!benchmarks[k], from: benchmarks[k]?.[0] ? new Date(benchmarks[k][0].t * 1000).toISOString().slice(0, 10) : null }])), tradeCount: trades.length, untaggedTrades: (tb.trades || []).filter(x => !x.account).length, today };
}
async function dividendIncomePage(account = "all") {
  const [tb, holdings, accounts, goals] = await Promise.all([readJson(taxFile(), { trades: [] }), holdingsOf(account), accountsList(), readJson(userFile("share-goals.json"), { goals: [] })]);
  const single = accounts.length === 1 ? accounts[0].id : null;
  const trades = (tb.trades || []).filter(x => x.symbol && (account === "all" || (x.account || single) === account));
  const syms = new Set([...trades.map(x => x.symbol), ...holdings.map(h => h.symbol)]), dividends = await allDividends(syms), today = istDay();
  const fyStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  const last12 = dividendsReceived({ trades, holdings, dividends, from: new Date(Date.parse(today) - 365 * 864e5).toISOString().slice(0, 10), to: today });
  const fy = last12.filter(d => d.exDate >= fyStart);
  return { account, accounts, today, received: { last12: last12, last12Total: last12.reduce((s, d) => s + d.income, 0), fyTotal: fy.reduce((s, d) => s + d.income, 0), fyFrom: fyStart, approx: last12.some(d => d.approx) }, forward: forwardDividends({ holdings, dividends, today }), goals: (goals.goals || []).map(g => { const held = g.market === "IN" ? holdings.find(h => h.symbol === g.symbol)?.qty ?? null : null, have = held ?? g.current ?? 0; return { ...g, held, have, pct: Math.min(100, Math.round(have / g.target * 1000) / 10), left: Math.max(0, g.target - have) }; }) };
}

// ---- Accumulation tracker (long-term basket: start small, add on dips up to a target per stock) ----
const accFile = () => userFile("accumulate.json");
async function accumulatePage() {
  const st = await readJson(accFile(), { baskets: [] }), lists = await readLists().catch(() => ({ lists: [] })), { rows } = await computeRows(), accounts = await accountsList();
  const bySym = new Map(rows.map(r => [String(r.symbol).toUpperCase(), r]));
  const out = [];
  for (const b of st.baskets || []) {
    const symbols = b.listId ? (lists.lists.find(l => l.id === b.listId)?.symbols || b.symbols) : b.symbols;
    const hold = await holdingsOf(b.account || "all"), held = new Map(hold.map(h => [h.symbol, { qty: h.qty, avgPrice: h.avgPrice }]));
    const prices = await livePrices(symbols.map(s => ({ symbol: s, exchange: "NSE" })), 60e3, { budgetMs: 1500 });
    const quotes = new Map(symbols.map(s => { const r = bySym.get(s), p = prices.get(s); return [s, { price: p?.price ?? r?.price ?? null, name: r?.company || hold.find(h => h.symbol === s)?.name || s, inZone: !!r?.verdict?.inZone, verdict: r?.verdict?.label || null }]; }));
    out.push(basketView({ ...b, symbols }, held, quotes));
  }
  return { baskets: out, lists: (lists.lists || []).map(l => ({ id: l.id, name: l.name, count: l.symbols.length })), accounts, defaults: DEFAULT_BASKET };
}

// ---- Listed-company list for search (shared, refreshed weekly) ----
const scripFile = path.join(DATA_DIR, "scrip-master.json");
let scripMem = null, scripLoading = null;
async function scripMaster() {
  if (scripMem && Date.now() - scripMem.fetchedAt < 7 * 864e5) return scripMem;
  const saved = await readJson(scripFile, null);
  if (saved?.list?.length > 500) { scripMem = saved; if (Date.now() - saved.fetchedAt > 7 * 864e5 || (/Zerodha/.test(saved.source || "") && !saved.list.some(x => x.token))) refreshScripMaster(); return saved; } // older lists lack Kite instrument tokens
  refreshScripMaster();
  return scripMem || { fetchedAt: 0, source: "built-in list", list: SCRIP_SEED };
}
function refreshScripMaster() {
  if (scripLoading) return scripLoading;
  scripLoading = (async () => {
    const got = [], notes = [], get = async (u, h = {}) => { const r = await fetch(u, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36", ...h }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };
    for (const ex of ["NSE", "BSE"]) { try { const l = parseKiteInstruments(await get(`https://api.kite.trade/instruments/${ex}`)); if (l.length) got.push(l); } catch (e) { notes.push(`Kite ${ex}: ${e.message}`); } }
    if (!got.length) { try { const l = parseNseEquityList(await get("https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv", { Referer: "https://www.nseindia.com/" })); if (l.length) got.push(l); } catch (e) { notes.push(`NSE: ${e.message}`); } }
    if (got.length) { scripMem = { fetchedAt: Date.now(), source: got.length > 1 ? "Zerodha instrument list (NSE + BSE)" : "listed companies list", list: mergeMaster(...got, SCRIP_SEED) }; await writeJson(scripFile, scripMem); console.log(`[search] Company list refreshed: ${scripMem.list.length} stocks.`); }
    else console.warn(`[search] Could not download the company list (${notes.join("; ")}); using the built-in list of ${SCRIP_SEED.length}.`);
  })().finally(() => { scripLoading = null; });
  return scripLoading;
}
// Yahoo online search, with a 10-minute pause after a rate-limit and a per-query cache.
const ySearchCache = new Map(); let ySearchPauseUntil = 0;
async function yahooSearch(q) {
  const k = q.toLowerCase(), hit = ySearchCache.get(k); if (hit && Date.now() - hit.at < 864e5) return { quotes: hit.quotes };
  if (ySearchPauseUntil > Date.now()) return { quotes: [], error: "Online search is paused (Yahoo rate limit)." };
  try {
    const r = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&listsCount=0`, { headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" }, signal: AbortSignal.timeout(8000) });
    if (r.status === 429) { ySearchPauseUntil = Date.now() + 10 * 60e3; return { quotes: [], error: "Online search is busy (Yahoo rate limit)." }; }
    if (!r.ok) return { quotes: [], error: `Online search unavailable (HTTP ${r.status}).` };
    const quotes = (await r.json()).quotes || []; ySearchCache.set(k, { at: Date.now(), quotes }); if (ySearchCache.size > 500) ySearchCache.delete(ySearchCache.keys().next().value);
    return { quotes };
  } catch { return { quotes: [], error: "Online search unavailable." }; }
}

// ---- Swing trading: live prices (Kite quotes → Yahoo → saved prices), positions, swing watchlist, alerts ----
const swingFile = () => userFile("swing.json");
const livePriceCache = new Map(); // "EX:SYM" -> { price, prevClose, source, at } (shared: prices are public)
// Live prices for the Swing page: NSE (the exchange's own quote) → Yahoo (batch, then live chart price) → Screener →
// the last saved price (marked). Kite only when PRICE_SOURCES includes it. maxAgeMs 0 = always fetch (Refresh).
const livePending = new Map(); // "EX:SYM" -> promise of a fetch already under way (no duplicate requests)
// Last good live price per stock, kept on disk (shared: prices are public) so a restart or a bad patch for every source
// still leaves a dated price to show instead of a blank.
const lastPricesFile = path.join(DATA_DIR, "last-prices.json");
const lastPrices = new Map(); let lastPricesTimer = null;
// Every new quote is announced here; each open page listens over /api/events (server-sent events) for its own stocks,
// so prices appear in the browser the moment they arrive instead of on the next poll.
const priceBus = new EventEmitter(); priceBus.setMaxListeners(0);
function setLive(key, v) {
  const prev = livePriceCache.get(key); v.at = v.at || Date.now();
  livePriceCache.set(key, v); rememberPrice(key, v);
  if (!prev || prev.price !== v.price || prev.asOf !== v.asOf || prev.stale) priceBus.emit("quote", key, v);
}
const notifyUser = (uid, event, data) => priceBus.emit("user", uid, event, data);
function rememberPrice(key, q) {
  lastPrices.set(key, { price: q.price, source: q.source, at: Date.now() });
  if (!lastPricesTimer) lastPricesTimer = setTimeout(async () => { lastPricesTimer = null; try { const all = await readJson(lastPricesFile, {}); for (const [k, v] of lastPrices) all[k] = v; lastPrices.clear(); await writeJson(lastPricesFile, all); } catch { /* best effort */ } }, 30e3); lastPricesTimer.unref?.();
}
async function fetchLiveQuote(i) {
  const ex = i.exchange || "NSE", key = `${ex}:${i.symbol}`;
  if (livePending.has(key)) return livePending.get(key);
  liveTried.set(key, Date.now());
  const run = (async () => {
    const tries = [];
    if (PRICE_SOURCES.includes("nse") && ex === "NSE" && !nseCooldown()) tries.push(async () => { const q = await paced("nse", 350, () => fetchNseQuote(i.symbol)); return q.price > 0 ? { price: q.price, prevClose: q.prevClose ?? null, low: q.low52 || null, high: q.high52 || null, source: "NSE", asOf: q.asOf || null } : null; });
    if (PRICE_SOURCES.includes("yahoo")) tries.push(async () => { const q = await yahooQuote(i.symbol, ex); return { price: q.price, prevClose: q.prevClose ?? null, low: q.low, high: q.high, source: "Yahoo", asOf: q.asOf }; });
    if (PRICE_SOURCES.includes("google")) tries.push(async () => { if (googleCooldown()) return null; const q = await paced("google", 500, () => fetchGoogleQuote(i.symbol, { exchange: ex === "BSE" ? "BOM" : googleConfig.exchange })); return { price: q.price, prevClose: q.prevClose ?? null, low: q.low || null, high: q.high || null, source: "Google", asOf: q.asOf }; });
    // Yahoo's quote service is a separate endpoint from its chart service and often still answers when charts are rate-limited
    if (PRICE_SOURCES.includes("yahoo")) tries.push(async () => { if (yahooCooldown() > Date.now()) return null; const q = (await yahooQuotes([{ symbol: i.symbol, exchange: ex }])).get(i.symbol); return q?.price > 0 ? { price: q.price, prevClose: Number.isFinite(q.pChange) ? Number((q.price / (1 + q.pChange / 100)).toFixed(2)) : null, low: q.low52 ?? null, high: q.high52 ?? null, source: "Yahoo", asOf: q.time || null } : null; });
    if (PRICE_SOURCES.includes("screener") && ex === "NSE" && !isEtf(i.symbol, i.name || "")) tries.push(async () => { if (screenerCooldown()) return null; const q = await paced("screener", 1200, () => fetchScreenerPrice({ symbol: i.symbol })); return { price: q.price, prevClose: null, source: "Screener", asOf: null }; }); // Screener has no ETF pages
    const errs = []; let best = null;
    for (const t of tries) {
      try { const v = await t(); if (!v) continue; best = pickFresher(best, v); if (isFresh(best)) break; } catch (e) { errs.push(errText(e).slice(0, 80)); }
    }
    if (best && i.last > 0 && /Google|Screener/.test(best.source) && Math.abs(best.price / i.last - 1) > 0.4) { errs.push(`${best.source} ₹${best.price} is >40% from ₹${i.last}; ignored`); best = null; }
    if (best) { best.at = Date.now(); setLive(key, best); }
    console.log(`[live] ${i.symbol}: ${best ? `${best.source} ₹${best.price}${best.asOf ? ` @ ${new Date(best.asOf).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}` : "no price"}${errs.length ? ` (failed: ${errs.join(" | ")})` : ""}`);
    return best;
  })().finally(() => livePending.delete(key));
  livePending.set(key, run);
  return run;
}
// Live prices for the Swing page. NSE first (the exchange's own quote); otherwise the freshest of Yahoo / Google by their
// market timestamps, then Screener. Waits at most budgetMs: whatever is still loading finishes in the background (so the
// next check has it) and the saved price stands in, marked, meanwhile. maxAgeMs 0 = ignore the cache (Refresh).
// Never makes a page wait for a price site: a stock already in the cache is answered from memory at once (and refreshed
// in the background when older than maxAgeMs; the new price is pushed to the page over /api/events). Only a stock with
// no price at all yet is waited for, at most budgetMs, before the newest saved price stands in.
const liveTried = new Map(); // "EX:SYM" -> when a fetch was last started (so a stock no source can price is not waited for every time)
async function livePrices(items, maxAgeMs = 45e3, { budgetMs = 1500 } = {}) {
  const out = new Map(), need = [], lateNeed = [];
  for (const it of items) {
    const c = livePriceCache.get(`${it.exchange || "NSE"}:${it.symbol}`);
    if (c) { out.set(it.symbol, c); if (Date.now() - c.at >= maxAgeMs) fetchLiveQuote(it).catch(() => {}); }
    else if (liveTried.has(`${it.exchange || "NSE"}:${it.symbol}`)) { lateNeed.push(it); if (!livePending.has(`${it.exchange || "NSE"}:${it.symbol}`) && Date.now() - liveTried.get(`${it.exchange || "NSE"}:${it.symbol}`) >= maxAgeMs) fetchLiveQuote(it).catch(() => {}); } // asked before and still no price: do not wait again
    else need.push(it);
  }
  let pending = items.filter(i => out.has(i.symbol) && livePending.has(`${i.exchange || "NSE"}:${i.symbol}`)).length;
  if (need.length || lateNeed.length) {
    if (KITE_PRICES && need.length) { const kc = await anyKiteWithSession().catch(() => null); if (kc) { try { for (const [k, q] of await kc.quotes(need.filter(i => (i.exchange || "NSE") === "NSE").map(i => i.symbol))) if (q.price > 0) { const v = { price: q.price, prevClose: q.close ?? null, source: "Kite", at: Date.now() }; out.set(k, v); setLive(`NSE:${k}`, v); } } catch { /* next */ } } }
    const jobs = need.filter(i => !out.has(i.symbol)).map(i => fetchLiveQuote(i).then(v => { if (v) out.set(i.symbol, v); }).catch(() => {}));
    if (jobs.length) await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, budgetMs))]);
    const still = [...need.filter(i => !out.has(i.symbol)), ...lateNeed]; pending += still.filter(i => livePending.has(`${i.exchange || "NSE"}:${i.symbol}`)).length;
    if (still.length) { // meanwhile: the newest saved price we have anywhere, marked with its date
      const [stocks, view, last, fund, etfBars] = await Promise.all([readWatchlist(), kiteHoldingsView().catch(() => ({ holdings: [] })), readJson(lastPricesFile, {}), readFundamentals(), readJson(etfBarsFile, {})]);
      const when = t => new Date(t).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
      for (const i of still) {
        const ex = i.exchange || "NSE", st = stocks.find(x => symOf(x) === i.symbol), h = view.holdings.find(x => x.symbol === i.symbol), lp = last[`${ex}:${i.symbol}`], f = fund[i.symbol], eb = etfBars[`${ex}:${i.symbol}`]?.bars?.at(-1);
        const cands = [
          st?.price > 0 && { price: st.price, t: Date.parse(st.priceAt || "") || 0, label: "saved price" },
          lp?.price > 0 && { price: lp.price, t: lp.at || 0, label: `last ${lp.source} price` },
          f?.price > 0 && { price: f.price, t: Date.parse(f.priceDate || f.asOf || "") || 0, label: "price in the valuation data" },
          eb?.c > 0 && { price: eb.c, t: (eb.t || 0) * 1000, label: "last close in the price history" },
          h?.syncPrice > 0 && { price: h.syncPrice, t: 0, label: "last broker sync" }
        ].filter(Boolean).sort((a, b) => b.t - a.t);
        const c = cands[0];
        if (c) out.set(i.symbol, { price: c.price, prevClose: null, source: `${c.label}${c.t ? ` (${when(c.t)})` : ""}`, at: Date.now(), stale: true });
      }
    }
  }
  out.pending = pending;
  return out;
}
// One price store for every screen. Whatever the live path fetched (Swing page, header refresh, the minute timer,
// Get valuation) sits in livePriceCache; this copies any quote newer than the saved one into this account's watchlist,
// so Valuation, Home, Portfolio and Swing always show the same price. Returns the (possibly updated) watchlist.
const liveTime = q => Math.min(Date.parse(q.asOf || "") || q.at || 0, q.at || Date.now());
async function syncLivePrices() {
  const stocks = await readWatchlist(), patch = new Map(), bySource = {};
  for (const x of stocks) {
    const sym = symOf(x); if (!sym) continue;
    const q = livePriceCache.get(`${x.exchange || "NSE"}:${sym}`);
    if (!q || q.stale || !(q.price > 0)) continue;
    let saved = Date.parse(x.priceAt || "") || 0; if (saved > Date.now() + 60e3) saved = 0; // a bad future stamp must not freeze the price
    const t = liveTime(q);
    if (t <= saved) continue;
    if (/google|screener/i.test(q.source) && x.price > 0 && Math.abs(q.price / x.price - 1) > 0.4) continue; // scraped page resolved the wrong instrument
    const hasRange = q.low > 0 && q.high > 0;
    patch.set(x.id, { price: q.price, ...(hasRange ? { low: q.low, high: q.high, rangeUpdated: new Date().toISOString() } : { low: x.low > 0 ? Math.min(x.low, q.price) : q.price, high: x.high > 0 ? Math.max(x.high, q.price) : q.price }), prevClose: q.prevClose ?? x.prevClose ?? null, priceAt: new Date(t).toISOString(), priceSource: q.source, feedStatus: "Price refreshed", updated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) });
    bySource[q.source] = (bySource[q.source] || 0) + 1;
  }
  if (!patch.size) return { stocks, changed: 0, bySource };
  const fresh = await readWatchlist(); // re-read right before writing so an edit made meanwhile is not lost
  const next = fresh.map(x => (patch.has(x.id) ? { ...x, ...patch.get(x.id) } : x));
  await persistWatchlist(next, fresh);
  return { stocks: next, changed: patch.size, bySource };
}
// A quote is "fresh" when its market timestamp is within 3 minutes (or the market is closed); NSE counts as fresh.
function isFresh(q) { if (!q) return false; if (q.source === "NSE") return true; if (!marketIsOpen()) return !!q.asOf || q.source !== "Screener"; return !!q.asOf && Date.now() - Date.parse(q.asOf) < 3 * 60e3; }
function pickFresher(a, b) { if (!a) return b; const ta = Date.parse(a.asOf || "") || 0, tb = Date.parse(b.asOf || "") || 0; return tb > ta ? b : a; }
// Profit after tax if every position were sold now: charges add up per position; tax is worked out once for the whole
// portfolio, so a loss in one stock offsets gains in another and the ₹1.25 L LTCG exemption is used only once.
function portfolioPat(list, exemptLeft, charges) {
  if (!list.length) return null;
  const sum = k => list.reduce((s, e) => s + k(e), 0);
  const gross = sum(e => e.gross), stt = sum(e => e.charges.stt), other = sum(e => e.charges.total - e.charges.stt);
  let st = sum(e => e.shortTerm.gain), lt = sum(e => e.longTerm.gain);
  if (st < 0) { lt += st; st = 0; } lt = Math.max(0, lt);
  const exemptUsed = Math.min(lt, exemptLeft), stTax = st * TAX_RULES.stRate, ltTax = (lt - exemptUsed) * TAX_RULES.ltRate, cess = (stTax + ltTax) * (charges.cessPct ?? 4) / 100;
  const tax = stTax + ltTax + cess, net = gross - stt - other - tax, R = v => Math.round(v);
  return { positions: list.length, sellValue: R(sum(e => e.sellValue)), gross: R(gross), stt: R(stt), otherCharges: R(other), stGain: R(st), ltGain: R(lt), exemptUsed: R(exemptUsed), stTax: R(stTax), ltTax: R(ltTax), cess: R(cess), tax: R(tax), net: R(net), keepPct: gross > 0 ? Math.round(net / gross * 1000) / 10 : null };
}
// Booked profit after charges and tax, per financial year (the ₹1.25L LTCG exemption applies once per year).
function realisedAfterTax(closed, charges) {
  const tx = swingTaxRows(closed); let ch = 0;
  for (const t of closed) { const e = sellTaxEstimate({ lots: Array.isArray(t.lots) && t.lots.length ? t.lots : [{ qty: t.qty, price: t.buyAvg, at: t.openedAt || t.closedAt }], sellPrice: t.sellPrice, sellDate: t.closedAt, ltExemptLeft: 0, charges }); if (e) ch += e.charges.total; }
  const tax = tx.years.reduce((s, y) => s + y.tax, 0) * (1 + (charges.cessPct ?? 4) / 100), gross = closed.reduce((s, t) => s + (Number(t.pnl) || 0), 0);
  return { gross: Math.round(gross), charges: Math.round(ch), tax: Math.round(tax), net: Math.round(gross - ch - tax) };
}
// Alerts to the phone (Telegram), in the background: a slow or failing Telegram never holds up the app.
function phonePush(fresh) {
  const user = currentUser();
  (async () => {
    const cfg = await readJson(U.notifyFile, {});
    try { const n = await pushAlerts(cfg, fresh); if (n) await writeJson(U.notifyFile, { ...cfg, lastSent: new Date().toISOString(), lastError: null }); }
    catch (e) { console.error(`[telegram] ${user?.username}: ${e.message}`); await writeJson(U.notifyFile, { ...cfg, lastError: e.message, lastErrorAt: new Date().toISOString() }); }
  })().catch(() => {});
}
// ---- Alerts you set yourself, event heads-ups, and Telegram digests ----
const rulesFile = () => userFile("price-rules.json");
const userLocks = new Map(); // one rules / alerts update at a time per account
function withUserLock(fn) { const u = currentUser(), prev = userLocks.get(u.id) || Promise.resolve(); const run = prev.catch(() => {}).then(fn); userLocks.set(u.id, run.catch(() => {})); return run; }
// New alerts into the account's alert list (once per key), the open page (live stream) and Telegram
async function fireEvents(evs) {
  if (!evs.length) return [];
  const store = await readJson(U.alertsFile, { state: {}, events: [] }), have = new Set(store.events.map(e => e.key).filter(Boolean));
  const fresh = evs.filter(e => !e.key || !have.has(e.key)); if (!fresh.length) return [];
  await writeJson(U.alertsFile, { ...store, events: mergeEvents(store.events, fresh) });
  console.log(`[alerts] ${currentUser().username}: ${fresh.map(e => e.title).join(" | ")}`);
  phonePush(fresh); notifyUser(currentUser().id, "alert", { count: fresh.length, titles: fresh.map(e => e.title).slice(0, 3) });
  return fresh;
}
const rulesIndex = new Map(); // symbol -> Set of users with an active live rule on it
async function loadRulesIndex() {
  rulesIndex.clear();
  await forEachUser(async () => { const u = currentUser(); for (const r of (await readJson(rulesFile(), { rules: [] })).rules || []) if (r.active && RULE_TYPES[r.type]?.live) (rulesIndex.get(r.symbol) || rulesIndex.set(r.symbol, new Map()).get(r.symbol)).set(u.id, u); });
}
if (!process.env.NODE_TEST_CONTEXT) setTimeout(() => loadRulesIndex().catch(() => {}), 2000).unref();
const range52 = new Map(); // symbol -> { day, hi, lo } from our end-of-day history (yesterday and before)
async function hiLo52(sym) {
  const day = istDay(), c = range52.get(sym); if (c?.day === day) return c;
  const bars = (await eodBars(sym)).filter(b => new Date(b.t * 1000).toISOString().slice(0, 10) < day).slice(-252);
  const v = bars.length >= 100 ? { day, hi: Math.max(...bars.map(b => b.h ?? b.c)), lo: Math.min(...bars.map(b => b.l ?? b.c)) } : { day, hi: null, lo: null };
  range52.set(sym, v); return v;
}
priceBus.on("quote", (key, q) => {
  const sym = key.slice(key.indexOf(":") + 1), users = rulesIndex.get(sym); if (!users?.size || q.stale || !(q.price > 0)) return;
  for (const u of users.values()) asUser(u, () => withUserLock(async () => {
    const st = await readJson(rulesFile(), { rules: [] }), day = istDay(), hl = await hiLo52(sym), evs = []; let changed = false;
    st.rules = (st.rules || []).map(r => { if (r.symbol !== sym) return r; const x = checkLiveRule(r, { price: q.price, prevClose: q.prevClose, high: hl.hi, low: hl.lo }, day); if (!x) return r; changed = true; evs.push(x.event); return x.rule; });
    if (changed) { await writeJson(rulesFile(), st); await fireEvents(evs); loadRulesIndex().catch(() => {}); }
  })).catch(e => console.error(`[rules] ${e.message}`));
});
// Chart rules (volume, golden cross, 200-DMA, 52-week on the close): once a day, after the NSE end-of-day file
async function checkEodRules() {
  await forEachUser(() => withUserLock(async () => {
    const st = await readJson(rulesFile(), { rules: [] }); if (!(st.rules || []).some(r => r.active && RULE_TYPES[r.type]?.eod)) return;
    const day = istDay(), evs = []; let changed = false;
    for (let i = 0; i < st.rules.length; i++) { const r = st.rules[i]; if (!r.active || !RULE_TYPES[r.type]?.eod || RULE_TYPES[r.type]?.live && r.type !== "high52" && r.type !== "low52") continue; const x = checkEodRule(r, await eodBars(r.symbol), day); if (x) { st.rules[i] = x.rule; evs.push(x.event); changed = true; } }
    if (changed) { await writeJson(rulesFile(), st); await fireEvents(evs); }
  }));
}
// Everything you track with its upcoming events (shared by the Home panel, heads-up alerts and the digests)
async function upcomingEvents({ pastDays = 3, aheadDays = 30 } = {}) {
  const [ce, stocks, sw, hold] = await Promise.all([corpEvents(), readWatchlist(), readJson(swingFile(), {}), readHoldStore()]);
  const today = istDay(), where = new Map(), qty = new Map();
  const tag = (sym, t) => { if (!sym) return; sym = String(sym).toUpperCase(); (where.get(sym) || where.set(sym, new Set()).get(sym)).add(t); };
  for (const a of Object.values(hold.accounts || {})) for (const h of a.holdings || []) { tag(h.symbol, "holding"); const k = String(h.symbol).toUpperCase(); qty.set(k, (qty.get(k) || 0) + (Number(h.qty) || 0)); }
  for (const p of sw.positions || []) { tag(p.symbol, "swing"); qty.set(p.symbol, (qty.get(p.symbol) || 0) + p.qty); }
  for (const w of sw.watch || []) tag(w.symbol, "swing watchlist");
  for (const x of stocks) tag(symOf(x), "watchlist");
  const names = new Map([...stocks.map(x => [symOf(x), x.company]), ...(sw.positions || []).map(p => [p.symbol, p.name])]);
  const out = [];
  for (const [sym, tags] of where) for (const e of eventsFor(sym, { events: ce.events || [], actions: ce.actions || [], today, pastDays, aheadDays })) {
    const q = qty.get(sym) || 0;
    out.push({ symbol: sym, name: names.get(sym) || sym, kind: e.kind, label: e.label, date: e.date, days: e.days, amount: e.amount ?? null, factor: e.factor ?? null, estimate: !!e.estimate, detail: e.detail || null, where: [...tags], qty: q || null, income: e.kind === "dividend" && e.amount && q ? Math.round(e.amount * q) : null });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return { events: out, sources: ce.sources || null, updatedAt: ce.at || null, errors: ce.errors || [] };
}
// Heads-up alerts: results within 2 days or an ex-dividend date within 3, for what you hold or swing-trade
async function eventHeadsUps() {
  await forEachUser(() => withUserLock(async () => {
    const { events } = await upcomingEvents({ pastDays: 0, aheadDays: 3 }), evs = [];
    for (const e of events) {
      const mine = e.where.includes("holding") || e.where.includes("swing"); if (!mine) continue;
      const swing = e.where.includes("swing"), when = e.days === 0 ? "today" : e.days === 1 ? "tomorrow" : `in ${e.days} days`;
      if ((e.kind === "results" || e.kind === "board-dividend") && e.days <= 2) evs.push({ key: `ev-${e.symbol}-${e.kind}-${e.date}`, at: new Date().toISOString(), type: swing ? "swing-event" : "event-results", symbol: e.symbol, title: `${e.name}: results ${when}`, detail: swing ? "Swing position: open the Swing page for what to do before the results." : "Expect a bigger move than usual." });
      if (e.kind === "dividend" && e.days <= 3) evs.push({ key: `ev-${e.symbol}-div-${e.date}`, at: new Date().toISOString(), type: swing ? "swing-event" : "event-dividend", symbol: e.symbol, title: `${e.name}: ex-dividend ${when}${e.income ? ` (${"₹" + e.income.toLocaleString("en-IN")} for you)` : ""}`, detail: `${e.label}${e.amount ? ` ₹${e.amount} a share` : ""}. Hold the shares at the end of the day before the ex-date to get it; selling on the ex-date still gets it.` });
      if ((e.kind === "bonus" || e.kind === "split") && e.days <= 3) evs.push({ key: `ev-${e.symbol}-${e.kind}-${e.date}`, at: new Date().toISOString(), type: swing ? "swing-event" : "event-capital", symbol: e.symbol, title: `${e.name}: ${e.label} ${when}`, detail: "Share count goes up and the price down by the same factor; swing positions are adjusted automatically." });
    }
    await fireEvents(evs);
  }));
}
// Digests (Telegram): morning 08:45 IST and evening 16:00 IST on weekdays, when switched on
async function digestData(kind) {
  const day = istDay(), [swing, up, cfg] = await Promise.all([swingView({ alerts: false }).catch(() => null), upcomingEvents({ pastDays: 0, aheadDays: 7 }), readJson(U.notifyFile, {})]);
  const appUrl = process.env.APP_URL || process.env.PUBLIC_URL || "";
  if (kind === "morning") { const rules = ((await readJson(rulesFile(), { rules: [] })).rules || []).filter(r => r.active).length; return { html: morningDigest({ day, swing, events: up.events, rules, appUrl }), cfg }; }
  const hold = await holdingsOf("all"); let dayChange = 0, value = 0, prevValue = 0; const movers = [];
  for (const h of hold) { const q = livePriceCache.get(`NSE:${h.symbol}`); if (!(h.price > 0)) continue; value += h.price * h.qty; if (q?.prevClose > 0) { dayChange += (h.price - q.prevClose) * h.qty; prevValue += q.prevClose * h.qty; movers.push({ symbol: h.symbol, dayPct: (h.price / q.prevClose - 1) * 100 }); } }
  const store = await readJson(U.alertsFile, { events: [] }), fired = store.events.filter(e => String(e.at || "").slice(0, 10) === day && (e.type === "rule" || String(e.type).startsWith("swing")));
  const booked = (swing?.closed || []).filter(t => String(t.closedAt || "").slice(0, 10) === day);
  const ideas = await swingIdeas().then(x => x.ideas.filter(i => i.score >= 60)).catch(() => []);
  return { html: eveningDigest({ day, swing, holdings: hold.length ? { value, dayChange, dayPct: prevValue ? dayChange / prevValue * 100 : 0, movers: movers.sort((a, b) => Math.abs(b.dayPct) - Math.abs(a.dayPct)).slice(0, 3) } : null, booked, fired, ideas, events: up.events, appUrl }), cfg };
}
async function sendDigest(kind) {
  const { html, cfg } = await digestData(kind), t = cfg.telegram;
  if (!t?.enabled || !t.token || !t.chatId) throw new Error("Connect Telegram first (Alerts → Phone alerts).");
  await sendTelegram(t.token, t.chatId, html); return html;
}
let lastDigestTick = { morning: null, evening: null, headsUp: null, eodRules: null };
setInterval(() => {
  const n = new Date(Date.now() + 5.5 * 3600e3), m = n.getUTCHours() * 60 + n.getUTCMinutes(), w = n.getUTCDay(), day = n.toISOString().slice(0, 10);
  if (w === 0 || w === 6) return;
  if (m >= 510 && lastDigestTick.headsUp !== day) { lastDigestTick.headsUp = day; eventHeadsUps().catch(e => console.error(`[events] heads-up: ${e.message}`)); }
  for (const [kind, from, to] of [["morning", 525, 560], ["evening", 960, 1020]]) {
    if (m < from || m > to || lastDigestTick[kind] === day) continue; lastDigestTick[kind] = day;
    forEachUser(async () => { const cfg = await readJson(U.notifyFile, {}); if (!cfg.digest?.[kind] || !cfg.telegram?.enabled) return; try { await sendDigest(kind); console.log(`[digest] ${kind} sent to ${currentUser().username}`); } catch (e) { console.error(`[digest] ${currentUser().username}: ${e.message}`); } }).catch(() => {});
  }
}, 5 * 60e3).unref();

// ---- Corporate actions and company events (shared: public data), refreshed daily ----
// NSE's market-wide lists first (one request each for all stocks): corporate actions from 30 days back to 90 ahead, and
// the board-meeting calendar (results). If NSE does not answer, Yahoo's calendar and split / dividend history are asked
// for the stocks you hold or swing-trade only.
const corpEventsFile = path.join(DATA_DIR, "corp-events.json");
const ceState = { running: false, lastError: null };
const ddmmyyyy = d => { const [y, m, dd2] = d.split("-"); return `${dd2}-${m}-${y}`; };
const shiftDay = (day, n) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
async function corpUniverse() { // symbols the decisions are needed for: swing positions / watchlist and holdings, every account
  const set = new Set();
  await forEachUser(async () => { const [st, hold] = await Promise.all([readJson(swingFile(), {}), readHoldStore()]); for (const x of [...(st.positions || []), ...(st.watch || [])]) set.add(x.symbol); for (const a of Object.values(hold.accounts || {})) for (const h of a.holdings || []) if (h.symbol) set.add(String(h.symbol).toUpperCase()); });
  return set;
}
async function refreshCorpEvents({ force = false } = {}) {
  if (ceState.running) return; ceState.running = true; ceState.lastError = null;
  try {
    const cur = await readJson(corpEventsFile, { actions: [], events: [] });
    if (!force && cur.at && Date.now() - cur.at < 12 * 3600e3) return;
    const today = istDay(), errs = [];
    let nseActions = null, nseEvents = null;
    try { nseActions = parseNseActions(await fetchNseJson(`/api/corporates-corporateActions?index=equities&from_date=${ddmmyyyy(shiftDay(today, -30))}&to_date=${ddmmyyyy(shiftDay(today, 90))}`, { referer: "https://www.nseindia.com/companies-listing/corporate-filings-actions" })); } catch (e) { errs.push(`NSE actions: ${errText(e).slice(0, 80)}`); }
    try { nseEvents = parseNseEvents(await fetchNseJson(`/api/event-calendar?index=equities&from_date=${ddmmyyyy(shiftDay(today, -14))}&to_date=${ddmmyyyy(shiftDay(today, 60))}`, { referer: "https://www.nseindia.com/companies-listing/corporate-filings-event-calendar" })); } catch (e) { errs.push(`NSE events: ${errText(e).slice(0, 80)}`); }
    let yActions = [], yEvents = [];
    if (!nseActions || !nseEvents) { // Yahoo for the stocks that matter to you
      const syms = [...await corpUniverse()].slice(0, 80);
      for (const sym of syms) {
        if (!nseEvents && !(yahooCooldown() > Date.now())) { try { yEvents.push(...parseYahooCalendar(sym, await yahooSummary(sym, ["calendarEvents", "summaryDetail", "defaultKeyStatistics"]))); } catch (e) { if (e.rateLimited || /rate/i.test(e.message)) break; } }
        if (!nseActions && !(barSources.yahoo > Date.now())) { try { const { events } = await fetchChart(sym, { range: "2y", events: true }); yActions.push(...parseYahooEvents(sym, events)); } catch (e) { if (e.rateLimited) barSources.yahoo = Date.now() + 15 * 60e3; } }
        await new Promise(r => setTimeout(r, 1200));
      }
    }
    // keep older actions (dividends received use a year of history); drop events older than 30 days
    const actions = mergeActions(cur.actions || [], nseActions || [], yActions).filter(a => a.exDate >= shiftDay(today, -400));
    const events = [...(nseEvents || (cur.events || []).filter(e => e.source === "NSE")), ...yEvents, ...(nseEvents ? [] : (cur.events || []).filter(e => e.source === "Yahoo" && !yEvents.some(y => y.symbol === e.symbol)))].filter(e => e.date >= shiftDay(today, -30));
    await writeJson(corpEventsFile, { at: Date.now(), actions, events, sources: { actions: nseActions ? "NSE" : yActions.length ? "Yahoo" : "none", events: nseEvents ? "NSE" : yEvents.length ? "Yahoo" : "none" }, errors: errs });
    console.log(`[events] ${actions.length} corporate actions (${nseActions ? "NSE" : "Yahoo"}), ${events.length} events${errs.length ? ` (${errs.join("; ")})` : ""}`);
  } catch (e) { ceState.lastError = e.message; console.error(`[events] ${e.message}`); }
  finally { ceState.running = false; }
}
setInterval(() => refreshCorpEvents().catch(() => {}), 3 * 3600e3).unref();
if (!process.env.NODE_TEST_CONTEXT) setTimeout(() => refreshCorpEvents().catch(() => {}), 12e3).unref();
let ceMem = { at: 0, data: null };
async function corpEvents() { if (!ceMem.data || Date.now() - ceMem.at > 60e3) ceMem = { at: Date.now(), data: await readJson(corpEventsFile, { actions: [], events: [] }) }; return ceMem.data; }

// "Hold or sell?" for one swing position (by id or symbol): used by the ⚖ dialog and by Ask AI
async function decideFor(b) {
  const view = await swingView({ alerts: false }), st = await readJson(swingFile(), {});
  const r = view.positions.find(x => x.id === b.id || (b.symbol && x.symbol === b.symbol)), p = r && (st.positions || []).find(x => x.id === r.id);
  if (!r || !p) throw Object.assign(new Error("That position no longer exists."), { status: 404 });
  if (!(r.price > 0)) throw Object.assign(new Error("No price for this stock right now."), { status: 400 });
  const ce = await corpEvents(), today = istDay(), evs = eventsFor(r.symbol, { events: ce.events || [], actions: ce.actions || [], today, pastDays: 0, aheadDays: 30 });
  const div = evs.find(e => e.kind === "dividend" && e.amount > 0), res2 = evs.find(e => e.kind === "results" || e.kind === "board-dividend");
  const bars = await eodBars(r.symbol), snap = (await readJson(swingScanFile, { snaps: {} })).snaps?.[r.symbol]?.s;
  const vol = dailyVol(bars.filter(x => Date.now() / 1000 - x.t < 120 * 86400).map(x => x.c)) ?? (snap?.atrPct ? snap.atrPct / 100 / 1.25 : null);
  const slabPct = b.slabPct !== undefined && b.slabPct !== "" ? Math.min(42.74, Math.max(0, Number(b.slabPct) || 0)) : st.settings?.slabPct ?? 30;
  const out = decideHoldSell({ qty: p.qty, avgPrice: p.avgPrice, price: r.price, lots: lotsOf(p), today, dividend: div ? { amount: div.amount, date: div.date, days: div.days } : null, results: res2 ? { date: res2.date, days: res2.days } : null, vol, health: r.health || (snap ? positionHealth(snap, p.avgPrice) : null), targets: r.targets || [], planQty: r.sellNow || r.targets?.find(t => !t.done && t.sellQty)?.sellQty || null, slabPct, exemptLeft: ltExemptionLeft(st.closed || [], st.settings?.ltUsedElsewhere || 0), charges: { ...CHARGE_DEFAULTS, ...(st.settings?.charges || {}) } });
  return { ...out, symbol: r.symbol, name: r.name, priceSource: r.priceSource || null };
}
async function swingView({ alerts = true, fresh = false } = {}) {
  const st = await readJson(swingFile(), {}); let watch = st.watch || [];
  const dd = dedupePositions(st.positions || []); let positions = dd.list; // older versions could hold one stock twice: merge them
  if (dd.merged.length) { st.positions = positions; await writeJson(swingFile(), st); console.log(`[swing] merged duplicate positions: ${dd.merged.join(", ")}`); }
  // Bonuses and splits whose ex-date has passed: adjust quantity, average, lots and stop-loss (once per action)
  const ce = await corpEvents(), today = istDay(), adjusted = [];
  positions = positions.map(p => { const r = adjustPosition(p, ce.actions || [], today); adjusted.push(...r.applied.map(a => ({ ...a, symbol: p.symbol, name: p.name }))); return r.position; });
  watch = watch.map(w => adjustWatch(w, ce.actions || [], today).watch);
  if (adjusted.length || watch.some((w, i) => w !== (st.watch || [])[i])) {
    st.positions = positions; st.watch = watch; await writeJson(swingFile(), st);
    if (adjusted.length) {
      console.log(`[swing] corporate actions applied: ${adjusted.map(a => `${a.symbol} ${a.label}`).join(", ")}`);
      const store = await readJson(U.alertsFile, { state: {}, events: [] }), evs = adjusted.map(a => ({ key: `ca-${a.key}`, at: new Date().toISOString(), type: "swing-corp-action", symbol: a.symbol, title: `${a.name || a.symbol}: adjusted for ${a.label}`, detail: `${a.from.qty} → ${a.to.qty} shares, average ₹${a.from.avgPrice} → ₹${a.to.avgPrice} (ex-date ${a.exDate}). Targets and stop-loss moved with it.` }));
      await writeJson(U.alertsFile, { ...store, events: mergeEvents(store.events, evs) }); phonePush(evs);
    }
  }
  const prices = await livePrices([...positions, ...watch], fresh ? 0 : 45e3);
  syncLivePrices().catch(() => {}); // the same quotes go to the watchlist, so Valuation and Home match this page
  const pricePending = prices.pending || 0;
  const view = evaluateSwing({ positions, watch, prices, settings: st.settings || {}, cash: st.cash?.balance ?? null });
  if (alerts && (positions.length || watch.length)) {
    const store = await readJson(U.alertsFile, { state: {}, events: [] });
    const { next, fresh } = diffSwingAlerts(st.alertState || {}, view, { events: store.events });
    if (fresh.length) { await writeJson(U.alertsFile, { ...store, events: mergeEvents(store.events, fresh) }); console.log(`[swing] ${fresh.map(e => e.title).join(" | ")}`); phonePush(fresh); }
    if (JSON.stringify(next) !== JSON.stringify(st.alertState || {})) await writeJson(swingFile(), { ...st, alertState: next });
  }
  const all = st.closed || [], closed = all.slice(0, 100);
  const scan = await readJson(swingScanFile, { snaps: {} });
  for (const r of view.positions) { const sn = scan.snaps?.[r.symbol]; r.health = sn?.s ? { ...positionHealth(sn.s, r.avgPrice), asOf: sn.at } : null; const q = prices.get(r.symbol); r.priceAsOf = q?.asOf || null; r.priceStale = !!q?.stale; }
  view.totals.staleNames = view.positions.filter(r => r.priceStale).map(r => r.symbol);
  // Results, dividends, bonuses: what they mean for each position (and what is coming up for the swing watchlist)
  for (const r of view.positions) { const pos = positions.find(p => p.id === r.id); r.adjustments = pos?.adjustments || []; r.events = swingEventAdvice(r, eventsFor(r.symbol, { events: ce.events || [], actions: ce.actions || [], today })); }
  for (const w of view.watch) { const ev = eventsFor(w.symbol, { events: ce.events || [], actions: ce.actions || [], today, pastDays: 0, aheadDays: 30 }); w.upcoming = ev.slice(0, 3).map(e => ({ kind: e.kind, label: e.label, date: e.date, days: e.days, amount: e.amount ?? null })); }
  view.eventsSource = ce.sources || null; view.eventsAt = ce.at || null;
  // If sold now: charges, STT and tax on the whole position, and on the booking plan's "sell now" quantity
  const charges = { ...CHARGE_DEFAULTS, ...(st.settings?.charges || {}) }, exemptLeft = ltExemptionLeft(st.closed || [], st.settings?.ltUsedElsewhere || 0);
  for (const r of view.positions) if (r.price > 0) {
    const p = positions.find(x => x.id === r.id) || r;
    r.ifSold = sellTaxEstimate({ lots: lotsForSale(p, r.qty), sellPrice: r.price, exchange: r.exchange, ltExemptLeft: exemptLeft, charges });
    if (r.sellNow > 0 && r.sellNow < r.qty) r.ifSellNow = sellTaxEstimate({ lots: lotsForSale(p, r.sellNow), sellPrice: r.price, exchange: r.exchange, ltExemptLeft: exemptLeft, charges });
  }
  view.totals.pat = portfolioPat(view.positions.map(r => r.ifSold).filter(Boolean), exemptLeft, charges);
  return { ...view, closed, realised: { count: all.length, pnl: Math.round(all.reduce((a, t) => a + (Number(t.pnl) || 0), 0)) }, score: scorecard(all), journal: { ...journalStats(all), setups: SETUPS, mistakes: MISTAKES }, ledger: buildLedger(positions, all), booked: bookedSummary(all, { taxPaid: st.taxPaid || [], ltUsedElsewhere: st.settings?.ltUsedElsewhere || 0, cessPct: charges.cessPct ?? 4 }), taxInfo: { exemptLeft, charges, ltUsedElsewhere: st.settings?.ltUsedElsewhere || 0 }, realisedNet: realisedAfterTax(all, charges), pricePending, cash: st.cash ? { balance: st.cash.balance, setAt: st.cash.setAt, log: (st.cash.log || []).slice(0, 12) } : null, marketOpen: marketIsOpen(), checkedAt: new Date().toISOString() };
}
// Closed swing trades as an Excel file: one row per FIFO buy lot (short / long term), a yearly tax estimate and the scorecard.
async function sendSwingExport(res) {
  const st = await readJson(swingFile(), {}), closed = st.closed || [], tx = swingTaxRows(closed), sc = scorecard(closed); // also exported when nothing is closed yet (ledger of buys)
  const sumBy = (k, f = () => true) => Math.round(tx.rows.filter(f).reduce((a, r) => a + r[k], 0) * 100) / 100;
  const sheets = [
    { name: "Closed trades (FIFO)", columns: [
        { header: "FY", key: "fy", width: 11 }, { header: "Stock", key: "name", width: 24 }, { header: "Symbol", key: "symbol", width: 13 }, { header: "Qty", key: "qty", type: "int", width: 7 },
        { header: "Buy date", key: "buyDay", type: "date", width: 13 }, { header: "Buy price", key: "buyPrice", type: "money", width: 12 }, { header: "Sell date", key: "sellDay", type: "date", width: 13 }, { header: "Sell price", key: "sellPrice", type: "money", width: 12 },
        { header: "Cost", key: "cost", type: "money", width: 14 }, { header: "Sale value", key: "proceeds", type: "money", width: 14 }, { header: "Gain / loss", key: "gain", type: "money", width: 14 }, { header: "Days held", key: "days", type: "int", width: 10 },
        { header: "Term", key: "term", width: 8 }, { header: "At target", key: "tgt", width: 10 }],
      rows: tx.rows.map(r => ({ ...r, tgt: r.atTarget ? "Yes" : "" })),
      totals: { fy: "Total", cost: sumBy("cost"), proceeds: sumBy("proceeds"), gain: sumBy("gain") },
      notes: [`Each sale is matched to your oldest swing buys first (FIFO). Held more than ${tx.rules.ltMonths} months = LTCG, otherwise STCG.`, "Buy dates come from the dates you entered (Bought on) or recorded buys; positions imported from a sheet use the import date unless you set it.", "Brokerage, STT and other charges are not included. Check against your broker's tax P&L before filing."] },
    { name: "Tax by year", columns: [
        { header: "FY", key: "fy", width: 11 }, { header: "STCG gains", key: "stGain", type: "money", width: 14 }, { header: "STCG losses", key: "stLoss", type: "money", width: 14 }, { header: "LTCG gains", key: "ltGain", type: "money", width: 14 }, { header: "LTCG losses", key: "ltLoss", type: "money", width: 14 },
        { header: "Net STCG", key: "netSt", type: "money", width: 13 }, { header: "Net LTCG", key: "netLt", type: "money", width: 13 }, { header: "LTCG exemption used", key: "exemptUsed", type: "money", width: 20 }, { header: "Estimated tax", key: "tax", type: "money", width: 14 }],
      rows: tx.years,
      notes: [`Rates: STCG ${tx.rules.stRate * 100}%, LTCG ${tx.rules.ltRate * 100}% above ₹${tx.rules.ltExemption.toLocaleString("en-IN")} a year (${tx.rules.asOf}); before cess and surcharge.`, "These are your swing trades alone. The LTCG exemption and losses are shared with all your other sales in the year (see the Tax view)."] },
    { name: "Ledger", columns: [{ header: "Date", key: "date", type: "date", width: 13 }, { header: "Stock", key: "name", width: 24 }, { header: "Symbol", key: "symbol", width: 13 }, { header: "Type", key: "type", width: 7 }, { header: "Qty", key: "qty", type: "int", width: 7 }, { header: "Price", key: "price", type: "money", width: 12 }, { header: "Value", key: "value", type: "money", width: 14 }, { header: "P/L (sells)", key: "pnl", type: "money", width: 13 }, { header: "Details", key: "det", width: 40 }],
      rows: buildLedger(st.positions || [], closed).entries.map(e => ({ ...e, pnl: e.type === "SELL" ? e.pnl : null, det: e.type === "BUY" ? (e.sold ? `${e.held} held, ${e.sold} sold${e.soldOn.length ? ` (${e.soldOn.join(", ")})` : ""}` : "held") : `bought at ₹${e.buyAvg} avg${e.atTarget ? ", at target" : ""}` })) },
    { name: "Scorecard", columns: [{ header: "Measure", key: "k", width: 28 }, { header: "Value", key: "v", width: 18 }],
      rows: [["Closed trades", sc.trades], ["Wins / losses", `${sc.wins} / ${sc.losses}`], ["Win rate %", sc.winRate], ["Average win ₹", sc.avgWin], ["Average loss ₹", sc.avgLoss], ["Average win %", sc.avgWinPct], ["Average loss %", sc.avgLossPct], ["Profit factor", sc.profitFactor], ["Average P/L per trade ₹", sc.expectancy], ["Average days held", sc.avgHoldDays], ["Sold at a target", sc.atTargets], ["Total booked ₹", sc.total], ["Best trade", sc.best ? `${sc.best.name} ₹${sc.best.pnl} (${sc.best.pnlPct}%)` : null], ["Worst trade", sc.worst ? `${sc.worst.name} ₹${sc.worst.pnl} (${sc.worst.pnlPct}%)` : null]].map(([k, v]) => ({ k, v })) }
  ];
  const buf = buildXlsx(sheets);
  res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Length": buf.length, "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="swing-trades-${istDay()}.xlsx"` });
  return res.end(buf);
}
// ETF entry: 5 years of daily prices (Yahoo), the iNAV (NSE quote) and the tracked index's P/E (NSE allIndices, cached 1 h).
let nseIndices = { at: 0, map: null };
// ETF price history from whichever source answers: Yahoo (5 years) → Kite (a logged-in account, ~5 years) → NSE's
// historical API → Screener's chart. Every success is saved (shared file: prices are public), so when all sources are
// busy the saved history plus today's live price still values the ETF. Yahoo answering 429 also rests the swing-ideas
// scan's use of Yahoo, which is what usually exhausts it.
const etfBarsFile = path.join(DATA_DIR, "etf-bars.json");
async function etfHistory(stock, { force = false } = {}) {
  const symbol = symOf(stock), exchange = stock.exchange || "NSE", errs = []; let limited = false;
  // Our own NSE end-of-day history: enough years and up to date → no other source needed
  const own = exchange === "NSE" ? await eodBars(symbol) : [];
  if (own.length >= 1000 && eodRecent(own)) return { bars: own, source: "NSE end-of-day", meta: {} };
  const ok = (bars, source, meta = {}) => (bars?.length >= 200 ? { bars, source, meta } : (errs.push(`${source}: only ${bars?.length || 0} days`), null));
  const tries = [
    async () => {
      if (barSources.yahoo > Date.now() && !force) { errs.push("Yahoo: resting after a rate limit"); limited = true; return null; } // you asked: one request is fine
      try { const r = await fetchChart(symbol, { exchange, range: "5y" }); return ok(r.bars, "Yahoo", r.meta); }
      catch (e) { if (e.rateLimited) { limited = true; barSources.yahoo = Date.now() + 15 * 60e3; } throw e; }
    },
    async () => {
      const kc = await anyKiteWithSession().catch(() => null); if (!kc) { errs.push("Kite: not logged in"); return null; }
      const token = (await scripMaster()).list.find(m => m.symbol === symbol && m.exchange === exchange && m.token)?.token; if (!token) { errs.push("Kite: no instrument token"); return null; }
      return ok(await kc.historical(token, 1850), "Kite");
    },
    async () => {
      if (exchange !== "NSE") return null;
      if (nseCooldown()) { errs.push("NSE: paused"); limited = true; return null; }
      return ok(await fetchNseHistory(symbol, { pace: fn => paced("nse", 500, fn) }), "NSE");
    },
    async () => {
      if (exchange !== "NSE") return null;
      if (screenerCooldown()) { errs.push("Screener: cooling down"); limited = true; return null; }
      const r = await fetchScreenerExtras({ marketSymbol: symbol, exchange }, { want: ["chart"] }); return ok(r.bars, "Screener");
    }
  ];
  for (const t of tries) {
    try { const r = await t(); if (r) { eodSeed(symbol, r.bars); const all = await readJson(etfBarsFile, {}); all[`${exchange}:${symbol}`] = { at: Date.now(), source: r.source, bars: r.bars.slice(-1300).map(b => ({ t: b.t, c: b.c, h: b.h ?? null, l: b.l ?? null })) }; await writeJson(etfBarsFile, all).catch(() => {}); return r; } }
    catch (e) { errs.push(errText(e).slice(0, 120)); if (e.rateLimited) limited = true; }
  }
  if (own.length >= 200 && eodRecent(own)) { console.log(`[etf] ${symbol}: sources unavailable; using our NSE end-of-day history (${own.length} days)`); return { bars: own, source: "NSE end-of-day", meta: {} }; }
  // Every source busy or failing: the saved history, with today's live price added as the latest day
  const saved = (await readJson(etfBarsFile, {}))[`${exchange}:${symbol}`];
  if (saved?.bars?.length >= 200) {
    const bars = [...saved.bars], live = (await livePrices([{ symbol, exchange }], 60e3, { budgetMs: 6000 }).catch(() => new Map())).get(symbol);
    const today = Math.floor(Date.now() / 1000);
    if (live && !live.stale && live.price > 0) { if (bars.at(-1).t > today - 18 * 3600) bars[bars.length - 1] = { ...bars.at(-1), c: live.price }; else bars.push({ t: today, c: live.price, h: live.price, l: live.price }); }
    console.log(`[etf] ${symbol}: sources unavailable (${errs.join(" | ")}); using saved history from ${new Date(saved.at).toISOString().slice(0, 10)}`);
    return { bars, source: `saved ${saved.source} history (${new Date(saved.at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}) + live price`, meta: {}, fromCache: true };
  }
  const err = new Error(errs.join("; ") || "no price-history source answered"); err.rateLimited = limited; throw err;
}
async function fetchEtfEntry(stock, { requireEtf = false, force = false } = {}) {
  const symbol = symOf(stock), exchange = stock.exchange || "NSE";
  let bars, meta, source;
  if (requireEtf) { ({ bars, meta } = await fetchChart(symbol, { exchange, range: "5y" })); if (meta.instrumentType !== "ETF") return null; source = "Yahoo"; }
  else ({ bars, meta, source } = await etfHistory(stock, { force }));
  const name = stock.company && stock.company.toUpperCase() !== symbol ? stock.company : meta.longName || symbol;
  let inav = null, indexStats = null; const index = indexFor(symbol, name);
  if (exchange === "NSE" && !nseCooldown()) {
    try { inav = (await fetchNseQuote(symbol)).inav; } catch { /* optional */ }
    if (index) {
      try { if (!nseIndices.map || Date.now() - nseIndices.at > 3600e3) nseIndices = { at: Date.now(), map: parseAllIndices(await fetchNseJson("/api/allIndices")) }; indexStats = nseIndices.map[index] || null; } catch { /* optional */ }
    }
  }
  const out = etfLens(bars, { symbol, name, inav, index, indexStats, today: istDay() });
  out.source = /^saved/.test(source) ? `ETF lens: ${source}` : `ETF lens: ${source} price history`;
  return out;
}
// Last resort when no price history at all can be had: value the ETF on where it sits in its 52-week range, from a live
// quote (NSE / Google / Yahoo all report the range). Low confidence; the full trend lens is tried again in 20 minutes.
async function etfRangeEntry(stock) {
  const symbol = symOf(stock), exchange = stock.exchange || "NSE";
  let q = null;
  if (exchange === "NSE" && !nseCooldown()) try { const n = await fetchNseQuote(symbol); if (n.price > 0 && n.high52 > 0 && n.low52 > 0) q = { price: n.price, high: n.high52, low: n.low52, inav: n.inav, source: "NSE" }; } catch { /* next */ }
  if (!q && !googleCooldown()) try { const g = await paced("google", 500, () => fetchGoogleQuote(symbol, { exchange: googleExchange(stock) })); if (g.price > 0 && g.high > 0 && g.low > 0) q = { ...g, source: "Google" }; } catch { /* next */ }
  if (!q) try { const y = await yahooQuote(symbol, exchange); if (y.high > 0 && y.low > 0) q = { ...y, source: "Yahoo" }; } catch { /* none */ }
  if (!q) return null;
  const name = stock.company && stock.company.toUpperCase() !== symbol ? stock.company : symbol;
  return { symbol, companyName: name, price: q.price, high52: q.high, low52: q.low, ...(q.inav > 0 ? { inav: q.inav, premium: Math.round((q.price / q.inav - 1) * 1e4) / 100 } : {}), profile: "etf", etfType: etfType(symbol, name), indexName: indexFor(symbol, name) || undefined, asOf: istDay(), priceDate: istDay(), thin: 1, source: `ETF: 52-week range only (${q.source} quote; price history unavailable right now)`, flags: "ETF valued on its 52-week range only until its price history can be fetched" };
}
// ---- NSE end-of-day data: the official daily price file → our own price history (shared: prices are public) ----
// Every evening the bhavcopy adds one bar to each tracked stock's history (eod/SYMBOL.json) and the index closes to
// eod/_index-*.json. A one-time backfill (about 15 months, one file every few seconds) seeds it. The swing scan and the
// ETF valuation read this history first, so they no longer need Yahoo; closing prices reach every screen as "NSE close".
const eodDir = path.join(DATA_DIR, "eod"), eodStateFile = path.join(DATA_DIR, "eod-state.json"), eodLatestFile = path.join(DATA_DIR, "eod-latest.json");
const eodFile = sym => path.join(eodDir, `${sym.replace(/[^A-Z0-9&-]/gi, "_")}.json`);
const eodState = { running: false, backfill: null, lastError: null };
const eodMem = new Map(); // symbol -> bars (read-through cache)
async function eodBars(sym) { if (eodMem.has(sym)) return eodMem.get(sym); const b = (await readJson(eodFile(sym), { bars: [] })).bars || []; eodMem.set(sym, b); return b; }
async function eodSave(sym, add) { const bars = mergeBars(await eodBars(sym), add); eodMem.set(sym, bars); await writeJson(eodFile(sym), { symbol: sym, bars }); return bars; }
const eodRecent = (bars, days = 6) => bars.length && Date.now() / 1000 - bars.at(-1).t < days * 86400;
// Everything worth keeping a history for: every account's watchlist, swing positions / watchlist and holdings, the scan list
async function eodUniverse() {
  const set = new Set(["NIFTYBEES"]);
  await forEachUser(async () => {
    const [stocks, st, hold] = await Promise.all([readWatchlist(), readJson(swingFile(), {}), readHoldStore()]);
    for (const x of stocks) if (symOf(x) && (x.exchange || "NSE") === "NSE") set.add(symOf(x));
    for (const x of [...(st.positions || []), ...(st.watch || [])]) if ((x.exchange || "NSE") === "NSE") set.add(x.symbol);
    for (const a of Object.values(hold.accounts || {})) for (const h of a.holdings || []) if (h.symbol) set.add(String(h.symbol).toUpperCase());
  });
  for (const x of SEED_STOCKS) set.add(x.symbol);
  return set;
}
// One trading day → bars for the tracked symbols (returned, so a backfill can batch the writes)
async function eodFetchDay(day, universe) {
  const [bhav, idx] = await Promise.all([fetchBhavcopy(day), fetchIndexCloses(day).catch(() => null)]);
  if (!bhav) return null; // holiday or not published yet
  const t = dayToT(bhav.day || day), bars = new Map();
  for (const r of bhav.rows) if (universe.has(r.symbol)) bars.set(r.symbol, { t, c: r.close, h: r.high ?? r.close, l: r.low ?? r.close, v: r.volume ?? null, p: r.prev ?? null });
  const idxBars = new Map();
  for (const r of idx?.rows || []) { const k = INDEX_KEYS[String(r.name).toUpperCase()]; if (k) idxBars.set(k, { t, c: r.close, pe: r.pe, pb: r.pb, dy: r.dy }); }
  return { day: bhav.day || day, bars, idxBars, all: bhav.rows };
}
async function eodIngest(day, universe) {
  const got = await eodFetchDay(day, universe); if (!got) return null;
  for (const [sym, b] of got.bars) await eodSave(sym, [b]);
  for (const [k, b] of got.idxBars) await eodSave(`_index-${k}`, [b]);
  // the full day's closes (every listed stock) for quick lookups, and the official close into the live store
  const prevLatest = await readJson(eodLatestFile, { day: "" });
  if (!prevLatest.day || got.day >= prevLatest.day) await writeJson(eodLatestFile, { day: got.day, prices: Object.fromEntries(got.all.map(r => [r.symbol, { c: r.close, p: r.prev, h: r.high, l: r.low, v: r.volume }])) }); // a backfilled older day must not replace it
  await recordMarketDay(got.day, got.all).catch(() => {});
  const asOf = new Date(`${got.day}T10:00:00Z`).toISOString();
  for (const [sym, b] of got.bars) { const k = `NSE:${sym}`, c = livePriceCache.get(k); if (!c || (Date.parse(c.asOf || "") || 0) < Date.parse(asOf) || /saved/.test(c.source || "")) setLive(k, { price: b.c, prevClose: b.p, low: null, high: null, source: "NSE close", asOf }); }
  return got;
}
async function runEod({ backfillDays = Number(process.env.EOD_BACKFILL_DAYS) || 320 } = {}) {
  if (eodState.running) return eodState; eodState.running = true; eodState.lastError = null;
  try {
    const st = await readJson(eodStateFile, { days: [] }), have = new Set(st.days || []), universe = await eodUniverse();
    // 1. the latest days (today after 18:00 IST, and anything missed in the last two weeks)
    const now = new Date(Date.now() + 5.5 * 3600e3), today = now.toISOString().slice(0, 10), afterPublish = now.getUTCHours() * 60 + now.getUTCMinutes() >= 18 * 60 + 10;
    for (const day of weekdaysBack(today, 10)) {
      if (have.has(day) || (day === today && !afterPublish)) continue;
      try { const g = await eodIngest(day, universe); if (g) { have.add(g.day); if (g.day === today) checkEodRules().catch(e => console.error(`[rules] ${e.message}`)); st.lastDay = [st.lastDay || "", g.day].sort().at(-1); console.log(`[eod] ${g.day}: ${g.bars.size} stocks, ${g.idxBars.size} indices`); } else if (day !== today) have.add(day); }
      catch (e) { eodState.lastError = e.message; if (e.rateLimited) break; }
      await new Promise(r => setTimeout(r, 1500));
    }
    st.days = [...have].sort().slice(-1500); await writeJson(eodStateFile, st);
    // 2. one-time backfill, oldest gaps last; bars are batched in memory and written every 20 days
    if (!st.backfilled && backfillDays > 0) {
      const todo = weekdaysBack(today, backfillDays).filter(d => !have.has(d) && d < today);
      eodState.backfill = { done: 0, total: todo.length };
      const pend = new Map(); const flush = async () => { for (const [sym, add] of pend) await eodSave(sym, add); pend.clear(); st.days = [...have].sort().slice(-1500); await writeJson(eodStateFile, st); };
      for (const day of todo) {
        try { const g = await eodFetchDay(day, universe); have.add(day); if (g) { for (const [s, b] of g.bars) (pend.get(s) || pend.set(s, []).get(s)).push(b); for (const [k, b] of g.idxBars) (pend.get(`_index-${k}`) || pend.set(`_index-${k}`, []).get(`_index-${k}`)).push(b); } }
        catch (e) { eodState.lastError = e.message; if (e.rateLimited) { await flush(); throw Object.assign(new Error("NSE archives are rate-limiting; backfill resumes later"), { soft: true }); } }
        eodState.backfill.done++;
        if (eodState.backfill.done % 20 === 0) await flush();
        await new Promise(r => setTimeout(r, Number(process.env.EOD_SPACING_MS) || 2500));
      }
      await flush(); st.backfilled = new Date().toISOString(); await writeJson(eodStateFile, st);
      console.log(`[eod] backfill finished: ${todo.length} days`);
    }
  } catch (e) { eodState.lastError = e.message; if (!e.soft) console.error(`[eod] ${e.message}`); }
  finally { eodState.running = false; }
  return eodState;
}
// Evenings after the file is published (18:10–23:30 IST, weekdays), every 30 minutes until today's day is in; and once at start.
setInterval(() => { const n = new Date(Date.now() + 5.5 * 3600e3), m = n.getUTCHours() * 60 + n.getUTCMinutes(), w = n.getUTCDay(); if (w > 0 && w < 6 && m >= 1090 && m <= 1410) runEod().catch(() => {}); }, 30 * 60e3).unref();
if (!process.env.NODE_TEST_CONTEXT && process.env.EOD !== "0") setTimeout(() => runEod().catch(() => {}), 20e3).unref();
// Other sources' history (Yahoo, Kite, NSE API, Screener) is kept too, so a stock fetched once never needs that site again
function eodSeed(sym, bars) { if (bars?.length && /^[A-Z0-9&-]+$/.test(sym)) eodSave(sym, bars.map(b => ({ t: b.t, c: b.c, h: b.h ?? b.c, l: b.l ?? b.c, v: b.v ?? null }))).catch(() => {}); }

// ---- Swing ideas: a daily scan of daily charts (shared cache: prices are public), ranked per account ----
const swingScanFile = path.join(DATA_DIR, "swing-scan.json");
const scanState = { running: false, done: 0, total: 0, startedAt: null, finishedAt: null, pausedUntil: 0, lastError: null };
const SEED_STOCKS = SCRIP_SEED.filter(x => x.exchange !== "BSE" && !isEtf(x.symbol, x.name)).map(x => ({ symbol: x.symbol, name: x.name, exchange: "NSE" }));
async function scanUniverse() {
  const mine = new Map(), kiteUsers = [];
  await forEachUser(async () => {
    const [stocks, st] = await Promise.all([readWatchlist(), readJson(swingFile(), {})]);
    for (const x of [...(st.positions || []), ...(st.watch || [])]) if (!mine.has(x.symbol)) mine.set(x.symbol, { symbol: x.symbol, name: x.name, exchange: x.exchange || "NSE" });
    for (const x of stocks) { const sym = symOf(x); if (sym && !mine.has(sym) && !isEtf(sym, x.company)) mine.set(sym, { symbol: sym, name: x.company || sym, exchange: x.exchange || "NSE" }); }
    if (!kiteUsers.length && await anyKiteWithSession().catch(() => null)) kiteUsers.push(currentUser());
  });
  for (const x of SEED_STOCKS) if (!mine.has(x.symbol)) mine.set(x.symbol, x); // your own lists first, then the market list
  return { list: [...mine.values()].slice(0, 600), kiteUser: kiteUsers[0] || null };
}
const scanFresh = (e, force) => !!(e?.at && Date.now() - e.at < (e.s ? (force ? 6 : 18) : force ? 0 : 6) * 3600e3); // misses retried after 6 h (or on Scan now)
// Daily bars from whichever source answers: Yahoo, then Screener's price chart, then Kite (a logged-in account) to fill gaps. A source that rate-limits is rested for 15 minutes while the others carry on.
const barSources = { yahoo: 0, kite: 0 }; // cool-down until (ms); Screener keeps its own
function barsCooling() { return { kite: barSources.kite > Date.now(), yahoo: barSources.yahoo > Date.now(), screener: !!screenerCooldown() }; }
async function dailyBars(x, { kiteUser, tokens, sx }) {
  const errs = [], cool = barsCooling();
  // Our own NSE end-of-day history first: no network at all
  if ((x.exchange || "NSE") === "NSE") { const own = await eodBars(x.symbol); if (own.length >= 200 && eodRecent(own)) return { bars: own, source: "NSE EOD" }; }
  const seeded = r => { eodSeed(x.symbol, r.bars); return r; };
  const token = tokens.get(`${x.exchange || "NSE"}:${x.symbol}`);
  if (!cool.yahoo) {
    try { const { bars } = await fetchChart(x.symbol, { exchange: x.exchange, range: "1y" }); if (bars.length >= 60) return seeded({ bars, source: "Yahoo" }); errs.push("Yahoo: too little history"); }
    catch (e) { errs.push(`Yahoo: ${e.message}`); if (e.rateLimited) barSources.yahoo = Date.now() + 15 * 60e3; }
  }
  if (!screenerCooldown() && x.exchange !== "BSE") {
    try {
      const ids = sx[x.symbol]?.ids?.companyId ? sx[x.symbol].ids : null;
      const r = await fetchScreenerExtras({ marketSymbol: x.symbol, exchange: x.exchange }, { ids, want: ["chart"] });
      if (r.ids?.companyId && !ids) saveScreenerExtra(x.symbol, { ids: r.ids }).catch(() => {});
      if (r.bars?.length >= 60) return seeded({ bars: r.bars, source: "Screener" });
      errs.push("Screener: no chart");
    } catch (e) { errs.push(`Screener: ${e.message}`); }
  }
  // Kite last: its feed can lag when the connection is unstable, so it only fills gaps
  if (kiteUser && token && !cool.kite) {
    try { const b = await asUser(kiteUser, async () => { const kc = await anyKiteWithSession(); if (!kc) throw Object.assign(new Error("Kite login expired"), { off: true }); return kc.historical(token); }); if (b.length >= 60) return seeded({ bars: b, source: "Kite" }); errs.push("Kite: too little history"); }
    catch (e) { errs.push(`Kite: ${e.message}`); if (e.off || e.loginRequired || /historical|permission|not (enabled|allowed|subscribed)|Unrecognised/i.test(e.message)) barSources.kite = Date.now() + 6 * 3600e3; else if (/rate|429|too many/i.test(e.message)) barSources.kite = Date.now() + 5 * 60e3; }
  }
  const c = barsCooling();
  const err = new Error(errs.join("; ") || "No price-history source available right now");
  err.allCooling = (c.yahoo || barSources.yahoo > Date.now()) && !!screenerCooldown() && (!kiteUser || !token || c.kite);
  throw err;
}
function startSwingScan({ force = false } = {}) {
  if (force && !scanState.running) { scanState.pausedUntil = 0; barSources.kite = 0; barSources.yahoo = 0; resetScreener(); } // Scan now: try again (e.g. right after a Kite login)
  if (scanState.running || scanState.pausedUntil > Date.now()) return false;
  scanState.running = true; scanState.done = 0; scanState.startedAt = Date.now(); scanState.lastError = null; scanState.sources = {};
  (async () => {
    const cache = await readJson(swingScanFile, { snaps: {} }); cache.snaps ||= {};
    const save = () => writeJson(swingScanFile, cache);
    const spacing = { Kite: 400, Yahoo: 2000, Screener: 2500 }, gap = Number(process.env.SWING_SCAN_SPACING_MS);
    try {
      const { list, kiteUser } = await scanUniverse();
      const master = await scripMaster(), tokens = new Map(master.list.filter(m => m.token).map(m => [`${m.exchange}:${m.symbol}`, m.token]));
      const sx = await readJson(screenerExtraFile, {});
      scanState.kite = !!kiteUser && tokens.size > 0;
      if (force || !cache.nifty?.at || Date.now() - cache.nifty.at > 18 * 3600e3) {
        try { const r = await dailyBars({ symbol: "NIFTYBEES", exchange: "NSE" }, { kiteUser, tokens, sx: {} }); cache.nifty = { at: Date.now(), source: r.source, bars: r.bars.slice(-260).map(b => ({ c: b.c })) }; } catch { /* strength vs Nifty is optional */ }
      }
      const due = list.filter(x => !scanFresh(cache.snaps[x.symbol], force));
      scanState.total = due.length;
      for (const x of due) {
        let src = null;
        try { const r = await dailyBars(x, { kiteUser, tokens, sx }); src = r.source; cache.snaps[x.symbol] = { s: swingSnapshot(r.bars, cache.nifty?.bars), at: Date.now(), name: x.name, exchange: x.exchange, source: r.source }; scanState.sources[r.source] = (scanState.sources[r.source] || 0) + 1; }
        catch (e) {
          if (e.allCooling) { const c = [barSources.yahoo, screenerCooldown(), kiteUser ? barSources.kite : 0].filter(t => t > Date.now()); const until = c.length ? Math.min(...c) : Date.now() + 15 * 60e3; throw Object.assign(new Error("all-cooling"), { until }); }
          cache.snaps[x.symbol] = { s: null, at: Date.now(), name: x.name, exchange: x.exchange, error: String(e.message).slice(0, 160) };
        }
        scanState.done++;
        if (scanState.done % 15 === 0) await save();
        await new Promise(r => setTimeout(r, Number.isFinite(gap) ? gap : spacing[src] || 1200));
      }
      cache.lastRun = Date.now(); scanState.finishedAt = Date.now();
    } catch (e) {
      if (e.until) {
        scanState.pausedUntil = e.until; scanState.lastError = `Price sources are busy (Yahoo / Screener rate limits)${scanState.kite ? "" : "; logging in to Zerodha in the app lets the scan fill gaps from Kite"}. Resumes at ${new Date(e.until).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })}.`;
        setTimeout(() => { scanState.pausedUntil = 0; startSwingScan(); }, Math.max(60e3, e.until - Date.now() + 2000)).unref();
      } else scanState.lastError = e.message;
    } finally { await save().catch(() => {}); scanState.running = false; console.log(`[swing-scan] ${scanState.done}/${scanState.total} charts ${JSON.stringify(scanState.sources)}${scanState.lastError ? ` (${scanState.lastError})` : ""}`); }
  })();
  return true;
}
// After the close on weekdays, once a day; and whenever someone opens the ideas with a stale scan.
setInterval(() => {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts().reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  const mins = Number(t.hour) * 60 + Number(t.minute);
  if (!["Sat", "Sun"].includes(t.weekday) && mins >= 950 && mins <= 1320) readJson(swingScanFile, {}).then(c => { if (!c.lastRun || istDay(new Date(c.lastRun)) !== istDay() || new Date(c.lastRun).getTime() < Date.now() - 6 * 3600e3) startSwingScan(); }).catch(() => {});
}, 15 * 60e3).unref();
// Scanner track record (shared: same ideas for everyone): log today's ideas, judge older ones against the prices since
const ideasLogFile = path.join(DATA_DIR, "ideas-log.json");
let ideasJudgedAt = 0;
async function trackIdeas(ideas) {
  const day = istDay(); let { log } = logIdeas((await readJson(ideasLogFile, { log: {} })).log, ideas.filter(i => i.score >= 50), day);
  if (Date.now() - ideasJudgedAt > 3600e3) { // judge open ideas at most hourly
    ideasJudgedAt = Date.now();
    for (const [k, x] of Object.entries(log)) { if (x.outcome) continue; const v = judgeIdea(x, await eodBars(x.symbol)); if (v) log[k] = { ...x, ...v }; }
    const cutoff = new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10); for (const k of Object.keys(log)) if (log[k].day < cutoff) delete log[k];
  }
  await writeJson(ideasLogFile, { log });
  return ideaStats(log);
}
async function swingIdeas() {
  const [cache, st, stocks, { rows }] = await Promise.all([readJson(swingScanFile, { snaps: {} }), readJson(swingFile(), {}), readWatchlist(), computeRows()]);
  const snaps = cache.snaps || {};
  const mine = new Map(SEED_STOCKS.map(x => [x.symbol, { ...x, src: "market" }]));
  for (const x of stocks) { const sym = symOf(x); if (sym && !isEtf(sym, x.company)) mine.set(sym, { symbol: sym, name: x.company || sym, exchange: x.exchange || "NSE", src: "watchlist" }); }
  for (const x of st.watch || []) mine.set(x.symbol, { symbol: x.symbol, name: x.name, exchange: x.exchange, src: "swing watchlist" });
  const bySym = new Map(rows.map(r => [String(r.symbol).toUpperCase(), r]));
  const items = [...mine.values()].map(x => { const r = bySym.get(x.symbol), v = r?.verdict; return { ...x, snap: snaps[x.symbol]?.s || null, verdict: v ? { key: v.key, label: v.label, inZone: v.inZone, fairBase: r.fairValue?.base ?? null, fairBull: r.fairValue?.bull ?? null } : null }; });
  const scanned = items.filter(i => i.snap).length, stale = items.filter(i => !scanFresh(snaps[i.symbol])).length;
  if (stale > items.length * 0.2 && !scanState.running) startSwingScan();
  const sizing = { capital: st.cash?.balance ?? null, riskPct: st.settings?.riskPct ?? 1, perTrade: st.settings?.perTrade ?? 200000 };
  const ideas = rankIdeas(items, { held: new Set((st.positions || []).map(p => p.symbol)), watching: new Set((st.watch || []).map(w => w.symbol)), sizing, limit: 40 })
    .map(i => ({ ...i, source: mine.get(i.symbol)?.src || "market", asOf: snaps[i.symbol]?.at || null }));
  const failed = items.filter(i => !snaps[i.symbol]?.s && snaps[i.symbol]?.error).length;
  const track = await trackIdeas(ideas).catch(e => { console.error(`[ideas-track] ${e.message}`); return null; });
  return { ideas, sizing, track, scan: { running: scanState.running, done: scanState.done, total: scanState.total, scanned, failed, universe: items.length, lastRun: cache.lastRun || null, error: scanState.lastError, pausedUntil: scanState.pausedUntil > Date.now() ? scanState.pausedUntil : null, sources: scanState.sources || {}, kite: !!scanState.kite } };
}
// Resolve names typed in a dip list: short names traders use (HDFC → HDFCBANK, HCL → HCLTECH), exact NSE symbols, then the company list
async function resolveDipNames(names) {
  const master = await scripMaster(), bySym = new Map(master.list.filter(x => x.exchange === "NSE").map(x => [x.symbol, x]));
  const rest = [], out = names.map((n, i) => {
    const k = String(n).toUpperCase().replace(/\s+/g, " ").replace(/\s+(LTD|LIMITED)\.?$/, "").trim(), alias = DIP_ALIASES[k], sym = alias || k.replace(/\s+/g, "");
    const hit = bySym.get(sym) || (alias ? { symbol: alias, name: alias, exchange: "NSE" } : null);
    if (hit) return { symbol: hit.symbol, name: hit.name, exchange: "NSE", how: alias ? "short name" : "NSE symbol", options: [] };
    rest.push(i); return null;
  });
  if (rest.length) { const found = await resolveNames(rest.map(i => names[i])); rest.forEach((i, j) => { out[i] = { ...found[j], options: searchMaster(master.list, names[i], 4).filter(x => x.exchange === "NSE").map(x => ({ symbol: x.symbol, name: x.name })) }; }); }
  return out;
}
// A swing-watchlist (or buy-the-dip) stock was bought: it becomes a swing position, or adds to the one you hold
function promoteWatch(st, w, b) {
  const bp = Number(b.price), ideaT = w.idea && bp > 0 ? [w.idea.t1, w.idea.t2].filter(t => t > bp * 1.005).map(t => Math.round((t / bp - 1) * 1000) / 10) : [];
  const p = sanitizePosition({ symbol: w.symbol, exchange: w.exchange, name: w.name, qty: b.qty, avgPrice: b.price, limit: b.limit ?? w.amount, notes: [w.notes, w.idea && !String(w.notes || "").includes(w.idea.label) ? `From swing idea: ${w.idea.label}` : "", w.list === "dip" ? `Bought the dip (level ₹${w.buyBelow})` : ""].filter(Boolean).join(" · ") || null, boughtOn: b.date || undefined, stopLoss: w.stopLoss ?? null, targets: ideaT.length ? ideaT.join(",") : undefined, setup: b.setup });
  if (!b.keep) st.watch = st.watch.filter(x => x.id !== w.id);
  let notice = null;
  const held = st.positions.find(x => x.symbol === p.symbol && (x.exchange || "NSE") === p.exchange);
  if (held) { const m = mergePositions(held, p); st.positions = st.positions.map(x => (x.id === held.id ? m : x)); notice = `${p.name}: added to your existing position. Now ${m.qty} shares at an average of ₹${m.avgPrice.toLocaleString("en-IN")}.`; }
  else { if (st.positions.length >= 100) throw new Error("At most 100 swing positions."); st.positions.push(p); }
  moveCash(st, -p.qty * p.avgPrice, `Bought ${p.qty} ${p.symbol} @ ₹${p.avgPrice}`);
  return notice;
}
async function resolveNames(names) {
  const [master, stocks] = await Promise.all([scripMaster(), readWatchlist()]);
  const norm = x => String(x).toLowerCase().replace(/\b(ltd|limited|the|india|co)\b|[^a-z0-9&]/g, "");
  return names.map(n => {
    const tracked = stocks.find(s => norm(s.company) === norm(n) || symOf(s) === String(n).toUpperCase().replace(/\s+/g, ""));
    if (tracked) return { symbol: symOf(tracked), name: tracked.company, exchange: tracked.exchange || "NSE", how: "your watchlist" };
    const hit = searchMaster(master.list, n, 3)[0];
    return hit ? { symbol: hit.symbol, name: hit.name, exchange: hit.exchange, how: "company list" } : { symbol: null, name: n, exchange: "NSE", how: "not found" };
  });
}

// ---- Model portfolio (Indian stocks this app has valued) ----
async function modelView(b = {}) {
  const [{ rows }, view, nw] = await Promise.all([computeRows(), kiteHoldingsView(), readJson(networthFile(), {})]);
  const goals = (nw.goals || []).map(g => { const [y, m] = g.by.split("-").map(Number), [ty, tm] = istDay().split("-").map(Number); return { id: g.id, name: g.name, target: g.target, by: g.by, years: Math.round(((y - ty) * 12 + (m - tm)) / 12 * 10) / 10 }; });
  const goal = goals.find(g => g.id === b.goalId) || null;
  const years = goal ? goal.years : Number.isFinite(Number(b.years)) && Number(b.years) > 0 ? Number(b.years) : null;
  const profile = PROFILES[b.profile] ? b.profile : "balanced", style = STYLES[b.style] ? b.style : "blend";
  const amount = Math.max(0, Math.min(1e11, Number(String(b.amount ?? "").replace(/[,₹\s]/g, "")) || 0));
  const model = buildModel({ rows, profile, style, amount, n: Number(b.n) || null, years, held: new Set(view.holdings.map(h => h.symbol)) });
  // Dividend style needs each stock's dividend history: fetch what is missing in the background.
  let dividendPending = 0;
  if (style === "dividend") { const miss = rows.filter(r => Number.isFinite(r.ratio) && !r.dividend).map(r => r.symbol); dividendPending = miss.length; if (miss.length) fetchDividendsFor(miss).catch(() => {}); }
  // Your current mix, from Net worth (equity / debt incl. EPF, PPF, NPS, FDs, cash / gold), to compare with the target.
  let current = null;
  try {
    const nwv = await networthView(); const c = Object.fromEntries(nwv.classes.map(x => [x.id, x.value]));
    const eq = (c.equity || 0), debt = (c.debt || 0) + (c.retire || 0) + (c.cash || 0), gold = c.gold || 0, tot = eq + debt + gold;
    if (tot > 0) current = { equity: Math.round(eq / tot * 100), debt: Math.round(debt / tot * 100), gold: Math.round(gold / tot * 100), total: Math.round(tot) };
  } catch { /* no net worth yet */ }
  return { ...model, dividendPending, goal, goals, current, profiles: Object.fromEntries(Object.entries(PROFILES).map(([k, v]) => [k, { label: v.label, mix: v.mix, expected: v.expected }])), styles: STYLES };
}

// ---- US stocks: SEC EDGAR fundamentals (shared cache), Stooq / Yahoo prices ----
const usCacheFile = path.join(DATA_DIR, "us-cache.json"), usTickersFile = path.join(DATA_DIR, "us-tickers.json"), usPricesFile = path.join(DATA_DIR, "us-prices.json");
const usListFile = () => userFile("us-list.json"), usGrowthFile = () => userFile("us-growth.json");
let usTickers = null, usQueue = new Set(), usBusy = false, usLastError = null;
async function loadUsTickers(force = false) {
  if (usTickers && !force && Date.now() - usTickers.fetchedAt < 7 * 864e5) return usTickers.list;
  const saved = await readJson(usTickersFile, null);
  if (saved?.list?.length && !force && Date.now() - saved.fetchedAt < 7 * 864e5) { usTickers = saved; return saved.list; }
  try { const list = parseSecTickers(await fetchSecJson(SEC_TICKERS_URL)); usTickers = { fetchedAt: Date.now(), list }; await writeJson(usTickersFile, usTickers); return list; }
  catch (e) { usLastError = e.message; if (saved?.list) { usTickers = saved; return saved.list; } throw e; }
}
const usFresh = e => e && Date.now() - e.fetchedAt < (e.error ? 6 * 3600e3 : 7 * 864e5);
function queueUs(symbols, force = false) {
  readJson(usCacheFile, {}).then(cache => { for (const s of symbols) if (force || !usFresh(cache[s])) usQueue.add(s); drainUs(); });
}
async function drainUs() {
  if (usBusy || !usQueue.size) return; usBusy = true;
  try {
    let list; try { list = await loadUsTickers(); } catch (e) { usLastError = `SEC ticker list: ${e.message}`; usQueue.clear(); return; }
    const byTicker = new Map(list.map(t => [t.symbol, t]));
    while (usQueue.size) {
      const sym = usQueue.values().next().value; usQueue.delete(sym);
      const t = byTicker.get(sym); const cache = await readJson(usCacheFile, {});
      if (!t) { cache[sym] = { fetchedAt: Date.now(), error: "Not a US-listed SEC filer (check the ticker)." }; await writeJson(usCacheFile, cache); continue; }
      try { const series = seriesFromFacts(await fetchSecJson(companyFactsUrl(t.cik))); cache[sym] = { fetchedAt: Date.now(), cik: t.cik, name: series.name || t.name, series }; console.log(`[us] ${sym}: ${series.years.length} fiscal years from SEC`); usLastError = null; }
      catch (e) { cache[sym] = { ...(cache[sym] || {}), fetchedAt: Date.now(), error: e.message, name: cache[sym]?.name || t.name }; usLastError = e.message; if (e.rateLimited) { usQueue.clear(); } }
      await writeJson(usCacheFile, cache);
      await new Promise(r => setTimeout(r, 350)); // SEC asks for at most 10 requests a second
    }
  } finally { usBusy = false; }
}
let usPriceMem = null;
async function usPrices(symbols, force = false) {
  usPriceMem ||= await readJson(usPricesFile, {});
  const ttl = 20 * 60e3, due = symbols.filter(s => force || !usPriceMem[s] || Date.now() - usPriceMem[s].at > ttl);
  let errors = [];
  if (due.length) {
    const r = await fetchUsPrices(due); errors = r.errors;
    for (const [k, v] of r.prices) usPriceMem[k] = { ...v, at: Date.now() };
    if (r.prices.size) await writeJson(usPricesFile, usPriceMem);
  }
  return { prices: usPriceMem, errors };
}
// Prices for pages: saved prices at once, a refresh in the background; waits (at most budgetMs) only for never-priced symbols
let usPricesPending = null; const usTried = new Set();
async function usPricesFast(symbols, budgetMs = 1500) {
  usPriceMem ||= await readJson(usPricesFile, {});
  const stale = symbols.filter(s => !usPriceMem[s] || Date.now() - usPriceMem[s].at > 20 * 60e3);
  if (!stale.length) return { prices: usPriceMem, errors: [] };
  const run = usPricesPending ||= usPrices(stale).catch(e => ({ prices: usPriceMem, errors: [e.message] })).finally(() => { usPricesPending = null; });
  // wait (once) only for symbols that were never priced or tried
  const fresh = stale.filter(s => !usPriceMem[s] && !usTried.has(s)); for (const s of stale) usTried.add(s);
  if (!fresh.length) return { prices: usPriceMem, errors: [] };
  return Promise.race([run, new Promise(r => setTimeout(() => r({ prices: usPriceMem, errors: [] }), budgetMs))]);
}
async function usRows(symbols) {
  const [cache, ov] = await Promise.all([readJson(usCacheFile, {}), readJson(usGrowthFile(), {})]);
  const { prices, errors } = await usPricesFast(symbols);
  const rows = symbols.map(sym => {
    const c = cache[sym], p = prices[sym];
    if (!c?.series) return { symbol: sym, name: c?.name || null, price: p?.price ?? null, pending: !c || (!c.series && !c.error) || usQueue.has(sym), error: c?.error || null };
    const v = usValuation(c.series, p?.price ?? null, { growth: ov[sym] ?? null });
    return { symbol: sym, name: c.name, price: p?.price ?? null, priceDate: p?.date || null, priceSource: p?.source || null, high52: p?.high52 ?? null, low52: p?.low52 ?? null, fetchedAt: c.fetchedAt, error: v.error || null, ...v, why: undefined, years: undefined };
  });
  return { rows, priceErrors: errors };
}

// ---- Holdings outside Indian brokers: US stocks (INDmoney sync, Vested import) and mutual funds (CAS / CSV / by hand) ----
const otherFile = () => userFile("other-holdings.json");
const fxFile = path.join(DATA_DIR, "fx.json"), amfiFile = path.join(DATA_DIR, "amfi-nav.json");
let fxMem = null, fxPending = null, fxTried = false;
// Rupees per US dollar (Yahoo USDINR=X), refreshed every 30 minutes; the last rate is kept for when Yahoo does not answer.
async function usdInr() {
  fxMem ||= await readJson(fxFile, {});
  if (fxMem.rate > 0 && Date.now() - (fxMem.at || 0) < 30 * 60e3) return fxMem;
  fxPending ||= (async () => {
    try {
      const base = (process.env.YAHOO_CHART_BASE || "https://query1.finance.yahoo.com").replace(/\/+$/, "");
      const r = await fetch(`${base}/v8/finance/chart/USDINR%3DX?range=5d&interval=1d`, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0" } });
      const m = r.ok ? (await r.json())?.chart?.result?.[0]?.meta : null;
      if (m?.regularMarketPrice > 50 && m.regularMarketPrice < 200) { fxMem = { rate: Math.round(m.regularMarketPrice * 1e4) / 1e4, at: Date.now(), source: "Yahoo USDINR" }; await writeJson(fxFile, fxMem); }
    } catch { /* keep the last rate */ } finally { fxPending = null; }
    return fxMem;
  })();
  // answer with the saved rate at once when there is one; the very first time wait at most 1.5 s
  if (fxMem.rate > 0 || fxTried) return fxMem;
  fxTried = true; return Promise.race([fxPending, new Promise(r => setTimeout(() => r(fxMem), 1500))]);
}
let amfiMem = null, amfiPending = null;
// AMFI's daily NAV file for every scheme (about 2 MB), shared by all users; refreshed every 6 hours when funds are viewed.
async function amfiNav({ wait = false } = {}) {
  amfiMem ||= await readJson(amfiFile, { at: 0, byIsin: {} });
  const fresh = Date.now() - (amfiMem.at || 0) < 6 * 3600e3;
  if (!fresh && !amfiPending) amfiPending = (async () => {
    try {
      const r = await fetch(process.env.AMFI_NAV_URL || "https://www.amfiindia.com/spages/NAVAll.txt", { signal: AbortSignal.timeout(25000), headers: { "User-Agent": "Mozilla/5.0" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const byIsin = parseAmfiNav(await r.text());
      if (Object.keys(byIsin).length > 10) { amfiMem = { at: Date.now(), byIsin }; await writeJson(amfiFile, amfiMem); console.log(`[amfi] NAVs for ${Object.keys(byIsin).length} ISINs`); }
    } catch (e) { console.warn(`[amfi] ${e.message}`); amfiMem.at = Date.now() - 5 * 3600e3; /* retry in an hour */ } finally { amfiPending = null; }
  })();
  // pages never wait for AMFI: they use the last NAVs (or the statement / sync NAV) while the file downloads in the background;
  // only a search / import (which needs the list) waits, up to 15 s
  if (wait && amfiPending) await Promise.race([amfiPending, new Promise(r => setTimeout(r, 15000))]);
  return amfiMem.byIsin;
}
// US holdings: INDmoney (from its sync: its values are in rupees) + statements you imported (Vested, any broker) + by hand
async function usHoldingItems() {
  const [store, other] = await Promise.all([readHoldStore(), readJson(otherFile(), {})]);
  const items = [];
  const hidden = new Set(other.hiddenUs || []);
  for (const [id, a] of Object.entries(store.accounts || {})) for (const [i, u] of (a.us || []).entries()) {
    if (hidden.has(id)) continue; // removed by the user: the sync keeps them out until shown again
    const sym = cleanUsTicker(u.symbol) || null;
    items.push({ key: `${id}:${sym || i}`, id: null, source: "sync", accountId: id, account: a.label || id, symbol: sym, name: u.name || sym, qty: Number.isFinite(u.qty) ? u.qty : null, avgUsd: null, investedUsd: null, investedInr: Number.isFinite(u.invested) ? u.invested : null, valueInr: Number.isFinite(u.value) ? u.value : null, syncedAt: a.syncedAt || null });
  }
  for (const u of other.us || []) items.push({ key: `us:${u.id}`, ...u, source: u.source || "import", syncedAt: u.importedAt || null });
  const dates = other.usDates || {}; // buy dates set from the page (synced holdings carry none)
  for (const it of items) it.boughtOn = dates[it.key] || it.boughtOn || null;
  return items;
}
async function usHoldings() {
  const items = await usHoldingItems(), syms = [...new Set(items.map(i => i.symbol).filter(Boolean))];
  const [{ prices, errors }, fx] = await Promise.all([syms.length ? usPricesFast(syms) : { prices: {}, errors: [] }, items.length ? usdInr() : null]);
  const v = usHoldingsView(items, prices, fx?.rate || null);
  const groupKey = i => (i.source === "sync" ? `sync|${i.accountId}` : `own|${i.account}`);
  // XIRR in rupees from the buy date (cost in ₹ as paid, or at today's rate when only $ is known) to today's value
  const today = istDay();
  const flowsOf = rs => rs.filter(r => r.boughtOn && r.boughtOn < today && r.investedInr > 0 && r.valueInr > 0).flatMap(r => [{ date: r.boughtOn, amount: -r.investedInr }, { date: today, amount: r.valueInr }]);
  const pct = x => (Number.isFinite(x) ? Math.round(x * 1000) / 10 : null);
  for (const r of v.rows) { r.accountKey = groupKey(r); const f = flowsOf([r]); r.xirr = f.length ? pct(xirr(f)) : null; }
  const summary = rs => { const pr = rs.filter(r => Number.isFinite(r.valueInr) && Number.isFinite(r.investedInr)), inv = pr.reduce((a, r) => a + r.investedInr, 0), val = pr.reduce((a, r) => a + r.valueInr, 0), f = flowsOf(rs), dated = rs.filter(r => r.boughtOn).length;
    return { count: rs.length, investedInr: Math.round(inv), valueInr: Math.round(val), pnlInr: Math.round(val - inv), pnlPct: inv > 0 ? Math.round((val / inv - 1) * 1000) / 10 : null, xirr: f.length ? pct(xirr(f)) : null, dated, investedUsd: Math.round(rs.reduce((a, r) => a + (r.investedUsd || 0), 0) * 100) / 100, valueUsd: Math.round(rs.reduce((a, r) => a + (r.valueUsd || 0), 0) * 100) / 100 }; };
  const accounts = [...new Map(items.map(i => [groupKey(i), { key: groupKey(i), source: i.source === "sync" ? "sync" : "own", accountId: i.accountId || null, account: i.account, at: i.syncedAt }])).values()].map(a => ({ ...a, ...summary(v.rows.filter(r => r.accountKey === a.key)) }));
  v.all = summary(v.rows);
  const [store, other] = await Promise.all([readHoldStore(), readJson(otherFile(), {})]);
  const hiddenAccounts = (other.hiddenUs || []).map(id => ({ accountId: id, account: store.accounts?.[id]?.label || id, count: (store.accounts?.[id]?.us || []).length }));
  return { ...v, fxAt: fx?.at || null, accounts, hiddenAccounts, priceErrors: errors.slice(0, 3) };
}
// Imported / hand-entered funds, valued at the latest AMFI NAV; funds a broker sync already brings are skipped (no double count)
const fundKeyName = n => String(n || "").toLowerCase().replace(/\b(plan|option|fund|scheme|the|direct|regular|growth|idcw|dividend|payout|reinvestment)\b|[^a-z0-9]/g, "");
async function importedFunds(syncedRaw = null) {
  const [other, amfi] = await Promise.all([readJson(otherFile(), {}), amfiNav()]);
  const synced = syncedRaw || Object.values((await readHoldStore()).accounts || {}).flatMap(a => a.mf || []);
  const syncedIsins = new Set(synced.map(f => f.isin).filter(i => /^INF/.test(i || ""))), syncedNames = new Set(synced.map(f => fundKeyName(f.name)));
  return (other.mf || []).map(f => {
    const v = valueFund(f, amfi), dup = syncedIsins.has(f.isin) || (!!f.name && syncedNames.has(fundKeyName(v.amfiName || f.name)));
    return { ...v, name: f.name || v.amfiName || f.isin, invested: Number.isFinite(f.cost) ? f.cost : null, avgNav: Number.isFinite(f.cost) && f.units > 0 ? Math.round(f.cost / f.units * 1e4) / 1e4 : null, pnl: Number.isFinite(f.cost) && Number.isFinite(v.value) ? Math.round((v.value - f.cost) * 100) / 100 : null, duplicate: dup };
  });
}

// ---- This week: key indices and top gainers / losers (whole market, from NSE's daily files) ----
const eodMarketFile = path.join(DATA_DIR, "eod-market.json");
let mktMem = null, mktBackfill = { running: false, at: 0, done: 0, error: null };
async function marketStore() { return (mktMem ||= await readJson(eodMarketFile, { days: [], closes: {} })); }
async function recordMarketDay(day, rows) { mktMem = addMarketDay(await marketStore(), day, rows); await writeJson(eodMarketFile, mktMem); }
// The last ~5 weeks of whole-market closes, fetched once in the background (one file every 1.5 s); never waited for
async function ensureMarketDays() {
  const st = await marketStore();
  if (mktBackfill.running || st.days.length >= 22 || Date.now() - mktBackfill.at < 3 * 3600e3) return;
  mktBackfill = { running: true, at: Date.now(), done: 0, error: null };
  (async () => {
    const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    for (const day of weekdaysBack(today, 34)) {
      if ((await marketStore()).days.includes(day)) continue;
      try { const b = await fetchBhavcopy(day); if (b?.rows?.length) { await recordMarketDay(b.day || day, b.rows); mktBackfill.done++; } }
      catch (e) { mktBackfill.error = e.message; if (e.rateLimited) break; }
      if ((await marketStore()).days.length >= 23) break;
      await new Promise(r => setTimeout(r, Number(process.env.EOD_SPACING_MS) || 1500));
    }
  })().finally(() => { mktBackfill.running = false; });
}
const KEY_INDICES = [["NIFTY 50", "NIFTY50", "^NSEI"], ["SENSEX", null, "^BSESN"], ["NIFTY BANK", "BANKNIFTY", "^NSEBANK"], ["NIFTY NEXT 50", "NEXT50", "^NSMIDCP"], ["NIFTY MIDCAP 150", "MIDCAP150", null], ["NIFTY SMALLCAP 250", "SMALLCAP250", null], ["NIFTY 500", "NIFTY500", "^CRSLDX"], ["NIFTY IT", "NIFTYIT", "^CNXIT"]];
const yIdxFile = path.join(DATA_DIR, "yahoo-index.json"); let yIdxMem = null; const yIdxJobs = new Map();
// Yahoo daily history for an index (Sensex, or an NSE index before our own daily files cover a month): background, 6-hourly
async function yahooIndexBars(ysym) {
  yIdxMem ||= await readJson(yIdxFile, {});
  const c = yIdxMem[ysym], job = yIdxJobs.get(ysym);
  if ((!c || Date.now() - c.at > 6 * 3600e3) && !job?.p && !(job?.at > Date.now() - 30 * 60e3) && !(barSources.yahoo > Date.now())) {
    const p = fetchChart(ysym, { raw: true, range: "2y" }).then(async ({ bars }) => { if (bars?.length > 20) { yIdxMem[ysym] = { at: Date.now(), bars: bars.map(b => ({ t: b.t, c: b.c })) }; await writeJson(yIdxFile, yIdxMem); } })
      .catch(e => { if (e.rateLimited) barSources.yahoo = Date.now() + 15 * 60e3; }).finally(() => yIdxJobs.set(ysym, { at: Date.now(), p: null }));
    yIdxJobs.set(ysym, { at: Date.now(), p });
  }
  return yIdxMem[ysym]?.bars || [];
}
async function weekView({ period = "week", universe = "nifty500" } = {}) {
  ensureMarketDays().catch(() => {});
  const [store, idx, live, master] = await Promise.all([marketStore(), idxStore(), allIndexNames().catch(() => []), scripMaster().catch(() => ({ list: [] }))]);
  const today = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10), liveBy = new Map(live.map(x => [normIndex(x.name), x]));
  const indices = [];
  for (const [name, key, ysym] of KEY_INDICES) {
    const own = key ? await eodBars(`_index-${key}`) : [], yb = ysym ? await yahooIndexBars(ysym) : [];
    const bars = own.length >= 22 || !yb.length ? own : yb;
    const lastDay = bars.length ? new Date(bars.at(-1).t * 1000 + 5.5 * 3600e3).toISOString().slice(0, 10) : "";
    const l = liveBy.get(normIndex(name)), useLive = l?.last > 0 && lastDay < today && marketIsOpen();
    const ch = indexChanges(bars, useLive ? { last: l.last, pChange: l.pChange } : null);
    indices.push({ name, ...(ch || { last: l?.last ?? null, day: l?.pChange ?? null }), source: useLive ? "NSE live" : own.length >= 22 || !yb.length ? "NSE daily" : "Yahoo" });
  }
  // which stocks: an index's constituents (from Smart indices), your own, or every liquid stock
  let set = null, label = "All stocks trading ₹5 Cr+ a day";
  if (universe === "nifty500" || universe === "nifty50") {
    const nm = universe === "nifty500" ? "NIFTY 500" : "NIFTY 50", c = idx.lists[normIndex(nm)];
    if (c?.rows?.length) { set = new Set(c.rows.map(r => r.symbol)); label = universe === "nifty500" ? "Nifty 500" : "Nifty 50"; } else { indexData(nm).catch(() => {}); label += ` (the ${nm} list is still loading)`; }
  } else if (universe === "mine") {
    const [stocks, hold, sw] = await Promise.all([readWatchlist(), readHoldStore(), readJson(swingFile(), {})]);
    set = new Set([...stocks.map(symOf), ...Object.values(hold.accounts || {}).flatMap(a => (a.holdings || []).map(h => String(h.symbol).toUpperCase())), ...(sw.positions || []).map(p => p.symbol), ...(sw.watch || []).map(w => w.symbol)]);
    label = "My watchlist, holdings and swing";
  }
  const names = new Map((master.list || []).filter(x => x.exchange === "NSE").map(x => [x.symbol, x.name]));
  const m = marketMovers(store, { period, universe: set, names });
  const watch = new Set((await readWatchlist()).map(symOf));
  for (const r of [...(m.gainers || []), ...(m.losers || [])]) r.watching = watch.has(r.symbol);
  return { indices, movers: m, universe, universeLabel: label, backfill: { ...mktBackfill, days: store.days.length } };
}

// ---- Smart indices: the stocks inside any NSE index, valued and scored (shared public cache) ----
const indexCacheFile = path.join(DATA_DIR, "index-cache.json");
let idxMem = null; const idxJobs = new Map(); // index key -> { p, at, error }
let idxValueJob = { running: false, name: null, done: 0, total: 0, failed: 0, at: null };
async function idxStore() { return (idxMem ||= await readJson(indexCacheFile, { lists: {}, all: null })); }
const idxTtl = () => (marketIsOpen() ? 15 * 60e3 : 6 * 3600e3);
// best-effort file names of the constituents CSV on NSE's archive (niftyindices format), tried when the live API is blocked
// The constituents file (niftyindices.com format) for an index: known file names first, then the usual patterns.
// Used when NSE's live API refuses the request (it often throttles or blocks servers) — no NSE session needed.
const IDX_FILES = { NIFTY50: "ind_nifty50list.csv", NIFTYNEXT50: "ind_niftynext50list.csv", NIFTY100: "ind_nifty100list.csv", NIFTY200: "ind_nifty200list.csv", NIFTYMIDCAP150: "ind_niftymidcap150list.csv", NIFTYSMALLCAP250: "ind_niftysmallcap250list.csv", NIFTY500: "ind_nifty500list.csv",
  NIFTY200MOMENTUM30: "ind_nifty200Momentum30_list.csv", NIFTY500MOMENTUM50: "ind_nifty500Momentum50_list.csv", NIFTY500QUALITY50: "ind_nifty500Quality50_list.csv", NIFTY100QUALITY30: "ind_nifty100Quality30list.csv", NIFTY200QUALITY30: "ind_nifty200Quality30_list.csv",
  NIFTYMIDCAP150QUALITY50: "ind_niftymidcap150quality50list.csv", NIFTYALPHA50: "ind_nifty_Alpha_Index.csv", NIFTY500VALUE50: "ind_nifty500Value50_list.csv", NIFTY200VALUE30: "ind_nifty200Value30_list.csv", NIFTY100LOWVOLATILITY30: "ind_Nifty100LowVolatility30list.csv",
  NIFTYDIVIDENDOPPORTUNITIES50: "ind_niftydivopp50list.csv", NIFTYALPHALOWVOLATILITY30: "ind_nifty_Alpha_LowVol30list.csv", NIFTYBANK: "ind_niftybanklist.csv", NIFTYIT: "ind_niftyitlist.csv", NIFTYPHARMA: "ind_niftypharmalist.csv", NIFTYAUTO: "ind_niftyautolist.csv", NIFTYFMCG: "ind_niftyfmcglist.csv", NIFTYMETAL: "ind_niftymetallist.csv" };
const NIFTYINDICES_BASE = () => (process.env.NIFTYINDICES_BASE || "https://www.niftyindices.com").replace(/\/+$/, "");
const idxCsvUrls = name => {
  const words = String(name).trim().split(/[\s-]+/).filter(Boolean);
  const camel = words.map((w, i) => (i === 0 ? w.toLowerCase() : /^[A-Za-z]/.test(w) ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w)).join("");
  const lower = words.join("").toLowerCase();
  const files = [...new Set([IDX_FILES[normIndex(name)], `ind_${camel}_list.csv`, `ind_${camel}list.csv`, `ind_${lower}list.csv`, `ind_${lower}_list.csv`].filter(Boolean))];
  return [...files.map(f => `${NIFTYINDICES_BASE()}/IndexConstituent/${f}`), ...files.map(f => `${NSE_ARCHIVE_BASE()}/content/indices/${f}`)];
};
// Prices for a constituents file: the live store, then NSE's daily closes for the whole market (last ~5 weeks), then saved history
async function priceIndexRows(rows) {
  const mk = await marketStore(), days = mk.days || [], last = days.at(-1), C = d => mk.closes?.[d] || {};
  const back = k => days[Math.max(0, days.length - 1 - k)];
  const out = [];
  for (const row of rows) {
    let r = fillFromBars(row, await eodBars(row.symbol));
    const l = C(last)[row.symbol]?.[0], p1 = C(back(1))[row.symbol]?.[0], p21 = C(back(21))[row.symbol]?.[0];
    if (!(r.price > 0) && l > 0) r = { ...r, price: l };
    if (r.pChange == null && l > 0 && p1 > 0) r.pChange = Math.round((l / p1 - 1) * 1e4) / 100;
    if (r.ch30d == null && l > 0 && p21 > 0 && days.length > 21) r.ch30d = Math.round((l / p21 - 1) * 1e4) / 100;
    const q = livePriceCache.get(`NSE:${row.symbol}`); if (q?.price > 0 && !(r.price > 0)) r = { ...r, price: q.price };
    out.push(r);
  }
  return out;
}
const idxNseSkip = new Map();
async function fetchIndexNow(name) {
  // NSE's exact name for the index (from its index list), so the live API gets what it expects
  const live = (await idxStore()).all?.list || [], exact = live.find(x => normIndex(x.name) === normIndex(name))?.name || name;
  let err = null;
  // after NSE refuses an index list, go straight to the constituents file for 30 minutes (no hammering NSE)
  if (Date.now() < (idxNseSkip.get(normIndex(exact)) || 0)) err = "NSE refused this index list earlier";
  else try { const j = parseIndexStocks(await fetchNseJson(`/api/equity-stockIndices?index=${encodeURIComponent(exact)}`, { referer: "https://www.nseindia.com/market-data/live-equity-market", soft: true })); if (j.rows.length) return { ...j, source: "NSE live", at: Date.now() }; err = "NSE returned no stocks for this index"; }
  catch (e) { err = e.message; if (e.refused) idxNseSkip.set(normIndex(exact), Date.now() + 30 * 60e3); }
  for (const u of idxCsvUrls(exact)) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(8000), headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", Accept: "text/csv,*/*", Referer: `${NIFTYINDICES_BASE()}/` } }); if (!r.ok) continue;
      const rows = parseIndexCsv(await r.text()); if (!rows.length) continue;
      return { index: null, rows: await priceIndexRows(rows), source: `${u.includes("niftyindices") ? "niftyindices.com" : "NSE archive"} list + daily closes (NSE live: ${String(err).slice(0, 60)})`, at: Date.now() };
    } catch { /* next */ }
  }
  throw new Error(`${err || "not available"}; the niftyindices.com list could not be downloaded either`);
}
// Cached constituents; refreshed in the background. Waits (up to 4 s) only the first time an index was never loaded.
async function indexData(name, { force = false } = {}) {
  const st = await idxStore(), key = normIndex(name), c = st.lists[key], job = idxJobs.get(key);
  if ((force || !c || Date.now() - c.at > idxTtl()) && !job?.p && !(job?.at > Date.now() - (force ? 0 : 5 * 60e3))) {
    const p = fetchIndexNow(name).then(async d => { const s2 = await idxStore(); s2.lists[key] = { name, ...d }; await writeJson(indexCacheFile, s2); idxJobs.set(key, { at: Date.now(), p: null }); })
      .catch(e => { idxJobs.set(key, { at: Date.now(), p: null, error: e.message }); console.warn(`[index] ${name}: ${e.message}`); });
    idxJobs.set(key, { at: Date.now(), p });
    if (!c && !job) await Promise.race([p, new Promise(r => setTimeout(r, 4000))]);
  }
  return { cached: (await idxStore()).lists[key] || null, pending: !!idxJobs.get(key)?.p, error: idxJobs.get(key)?.error || null };
}
async function allIndexNames() {
  const st = await idxStore();
  if ((!st.all || Date.now() - st.all.at > 24 * 3600e3) && !idxJobs.get("__all")?.p && !(idxJobs.get("__all")?.at > Date.now() - 30 * 60e3)) {
    const p = fetchNseJson("/api/allIndices", { referer: "https://www.nseindia.com/market-data/live-market-indices" }).then(async j => { const list = parseIndexList(j); if (list.length) { const s2 = await idxStore(); s2.all = { at: Date.now(), list }; await writeJson(indexCacheFile, s2); } })
      .catch(() => {}).finally(() => idxJobs.set("__all", { at: Date.now(), p: null }));
    idxJobs.set("__all", { at: Date.now(), p });
  }
  return st.all?.list || [];
}
async function indicesHome() {
  const all = await allIndexNames(), st = await idxStore(), byKey = new Map(all.map(x => [normIndex(x.name), x]));
  const curated = SMART_INDICES.map(x => { const live = byKey.get(normIndex(x.name)), c = st.lists[normIndex(x.name)]; return { ...x, last: live?.last ?? c?.index?.last ?? null, pChange: live?.pChange ?? c?.index?.pChange ?? null, count: c?.rows?.length ?? null }; });
  const known = new Set(SMART_INDICES.map(x => normIndex(x.name)));
  return { curated, others: all.filter(x => !known.has(normIndex(x.name))).map(x => ({ name: x.name, category: x.category, last: x.last, pChange: x.pChange })), valueJob: idxValueJob };
}
async function indexView(name, opts = {}) {
  const meta = SMART_INDICES.find(x => normIndex(x.name) === normIndex(name)) || { name, group: "NSE index", blurb: null };
  ensureMarketDays().catch(() => {}); // daily closes price an index that came from a constituents file
  const { cached, pending, error } = await indexData(meta.name, opts);
  if (!cached) return { name: meta.name, meta, rows: [], summary: null, pending, error, valueJob: idxValueJob };
  const [fundamentals, stocks, hold, sw, scan] = await Promise.all([readFundamentals(), readWatchlist(), readHoldStore(), readJson(swingFile(), {}), readJson(swingScanFile, { snaps: {} })]);
  const live = new Map(); for (const r of cached.rows) { const q = livePriceCache.get(`NSE:${r.symbol}`); if (q?.price > 0 && (!r.price || (q.at || 0) > cached.at)) live.set(r.symbol, q.price); }
  const rows0 = cached.rows.map(r => (live.has(r.symbol) ? { ...r, price: live.get(r.symbol) } : r));
  const unpriced = rows0.filter(r => !(r.price > 0)).slice(0, 80);
  if (unpriced.length) livePrices(unpriced.map(r => ({ symbol: r.symbol, exchange: "NSE", name: r.name })), 10 * 60e3, { budgetMs: 0 }).catch(() => {}); // prices fill in on the next refresh
  // this app's valuation for every constituent whose fundamentals are known (fetched for anyone's watchlist, or by "Value this index")
  const withF = rows0.filter(r => fundamentals[r.symbol]);
  const vrows = withF.length ? computeAll(withF.map((r, i) => ({ id: `idx${i}`, company: r.name, ticker: r.symbol, marketSymbol: r.symbol, price: r.price, low: r.low52, high: r.high52 })), fundamentals) : [];
  const val = new Map(vrows.filter(v => v.view && v.view !== "No fundamentals").map(v => { v.verdict = classify(v); return [String(v.symbol).toUpperCase(), v]; }));
  const tech = new Map(Object.entries(scan.snaps || {}).filter(([, v]) => v?.s).map(([k, v]) => [k, v.s]));
  const held = new Set([...Object.values(hold.accounts || {}).flatMap(a => (a.holdings || []).map(h => String(h.symbol).toUpperCase())), ...(sw.positions || []).map(p => p.symbol)]);
  const watch = new Set(stocks.map(symOf));
  const rows = smartRows(rows0, { val, tech, held, watch });
  return { name: meta.name, meta, index: cached.index, rows, summary: indexSummary(rows), source: cached.source, at: cached.at, pending, error, valueJob: idxValueJob, fundamentalsMissing: rows.filter(r => !fundamentals[r.symbol]).length };
}
// Fetch fundamentals for an index's stocks that have none (largest weight first), one at a time, in the background
function startIndexValuation(view, limit = 120) {
  if (idxValueJob.running) return idxValueJob;
  const targets = view.rows.filter(r => !r.valuation).sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)).slice(0, limit).map((r, i) => ({ id: `idx-${i}`, company: r.name, ticker: r.symbol, marketSymbol: r.symbol }));
  idxValueJob = { running: true, name: view.name, done: 0, total: targets.length, failed: 0, at: Date.now() };
  (async () => {
    for (const t of targets) {
      try { const [r] = await runFundamentalsFetch([t], false); if (!r?.entry && !r?.skipped) idxValueJob.failed++; if (r?.rateLimited) { idxValueJob.note = "Data sites are rate-limiting: paused; press again later to continue."; break; } }
      catch { idxValueJob.failed++; }
      idxValueJob.done++;
    }
  })().finally(() => { idxValueJob.running = false; idxValueJob.endedAt = Date.now(); });
  return idxValueJob;
}

// ---- Mutual fund X-ray: fetch a fund's portfolio automatically (holdings API, or the fund house's monthly file) ----
async function saveXrayFund({ id = null, name, asOf = null, holdings, source = null }) {
  const st = await readJson(U.fundsFile, { funds: [] });
  const fid = id && st.funds.some(f => f.id === id) ? id : `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const prev = st.funds.find(f => f.id === fid);
  const fund = { id: fid, name: String(name).slice(0, 80), asOf: asOf ? String(asOf).slice(0, 30) : null, updatedAt: new Date().toISOString(), holdings, source: source || prev?.source || null };
  st.funds = [...st.funds.filter(f => f.id !== fid), fund]; await writeJson(U.fundsFile, st);
  const map = await readJson(nameMapFile, {}); for (const h of holdings) if (h.symbol) map[h.isin || normName(h.name)] = { symbol: h.symbol, exchange: h.exchange || "NSE", label: null }; await writeJson(nameMapFile, map);
  for (const h of holdings) if (h.symbol) await ensureInPool(h.symbol, h.exchange || "NSE", h.name, `Added from fund X-ray (${fund.name}).`);
  queueFill(holdings.filter(h => h.symbol).map(h => h.symbol), 150).catch(() => {});
  return fund;
}
// ids: { id, name, isin, link } → tries the fund house link (given or saved), then the holdings API; saves on success
async function autoFetchFund(ids) {
  const amfi = await amfiNav({ wait: true }), st = await readJson(U.fundsFile, { funds: [] }), prev = ids.id ? st.funds.find(f => f.id === ids.id) : null;
  let isin = /^INF[0-9A-Z]{9}$/.test(ids.isin || "") ? ids.isin : prev?.source?.isin || null;
  if (!isin && ids.name) isin = searchAmfi(amfi, ids.name, 1)[0]?.isin || null;
  const a = isin ? amfi[isin] : null, code = a?.[2] || prev?.source?.code || null, name = String(ids.name || prev?.name || a?.[3] || "").trim();
  if (!name && !isin) throw new Error("Pick the fund (type its name).");
  const link = String(ids.link || prev?.source?.link || "").trim() || null;
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) throw new Error("The portfolio link must start with http(s)://");
  const tried = [];
  let got = null;
  if (link) { const r = await fetchFromLink(link, name); tried.push(...r.tried); if (r.holdings?.length) got = r; }
  if (!got) { const r = await fetchFromApi({ isin, code, name }); tried.push(...r.tried); if (r.holdings?.length) got = r; }
  if (!got) return { ok: false, name, isin, tried };
  // NSE symbols for the holdings (ISIN / name, the same matching as an upload)
  const holdings = got.holdings.map(h => ({ ...h, exchange: "NSE" }));
  for (let i = 0; i < holdings.length; i += 15) {
    const chunk = holdings.slice(i, i + 15), res = await resolveHoldingSymbols(chunk.map(h => ({ name: h.name, isin: /^INE[A-Z0-9]{9}$/.test(h.isin || "") ? h.isin : null })));
    res.forEach((x, k) => { if (!chunk[k].symbol && x?.symbol) { chunk[k].symbol = x.symbol; chunk[k].exchange = x.exchange || "NSE"; } });
  }
  const fund = await saveXrayFund({ id: prev?.id || null, name: prev?.name || name.replace(/\s*-\s*(direct|regular).*$/i, "").slice(0, 80), asOf: got.asOf || null, holdings: holdings.map(h => ({ name: h.name, isin: h.isin, weight: h.weight, sector: h.sector || null, symbol: h.symbol || null, exchange: h.exchange })),
    source: { kind: got.source.kind, url: got.source.url, page: got.source.page || null, link, isin, code, fetchedAt: new Date().toISOString() } });
  return { ok: true, fund: { id: fund.id, name: fund.name, count: fund.holdings.length, asOf: fund.asOf, source: fund.source }, tried };
}
const xrayJobs = new Map(); // per user
const XJ = () => { const id = currentUser().id; if (!xrayJobs.has(id)) xrayJobs.set(id, { running: false, done: 0, total: 0, ok: [], failed: [], at: null, kind: null }); return xrayJobs.get(id); };
// every fund you hold (Zerodha / INDmoney sync, CAS, by hand) that has no X-ray portfolio yet: fetch and link it
function startXrayAll() {
  const xrayJob = XJ(); if (xrayJob.running) return xrayJob;
  Object.assign(xrayJob, { running: true, done: 0, total: 0, ok: [], failed: [], at: Date.now(), kind: "all", endedAt: null });
  (async () => {
    const held = (await syncedMutualFunds()).filter(f => !f.fundId);
    const seen = new Set(), todo = held.filter(f => { const k = f.isin || normName(f.name); if (seen.has(k)) return false; seen.add(k); return true; });
    xrayJob.total = todo.length;
    for (const f of todo) {
      try {
        const r = await autoFetchFund({ name: f.amfiName || f.name, isin: /^INF/.test(f.isin || "") ? f.isin : null });
        if (r.ok) {
          xrayJob.ok.push(f.name);
          const nw = await readJson(networthFile(), {}); const links = { ...(nw.links || {}) };
          for (const g of held) if ((g.isin && g.isin === f.isin) || normName(g.name) === normName(f.name)) links[g.key] = r.fund.id;
          await writeJson(networthFile(), { ...nw, links });
        } else xrayJob.failed.push({ name: f.name, why: r.tried.slice(-2).join("; ") || "not found" });
      } catch (e) { xrayJob.failed.push({ name: f.name, why: e.message }); }
      xrayJob.done++;
    }
  })().finally(() => { xrayJob.running = false; xrayJob.endedAt = Date.now(); });
  return xrayJob;
}
// funds with an automatic source are refreshed when their portfolio is over a month old (new month's disclosure)
function refreshStaleXray(funds) {
  const xrayJob = XJ(); if (xrayJob.running) return;
  const due = funds.filter(f => f.source && Date.now() - Date.parse(f.updatedAt || 0) > 32 * 864e5 && !(Date.now() - Date.parse(f.source.lastTry || 0) < 24 * 3600e3)).slice(0, 6);
  if (!due.length) return;
  Object.assign(xrayJob, { running: true, done: 0, total: due.length, ok: [], failed: [], at: Date.now(), kind: "refresh", endedAt: null });
  (async () => {
    for (const f of due) {
      try { const r = await autoFetchFund({ id: f.id, name: f.name }); if (r.ok) xrayJob.ok.push(f.name); else { xrayJob.failed.push({ name: f.name, why: r.tried.slice(-1)[0] || "not found" }); const st = await readJson(U.fundsFile, { funds: [] }); const g = st.funds.find(x => x.id === f.id); if (g?.source) { g.source.lastTry = new Date().toISOString(); await writeJson(U.fundsFile, st); } } }
      catch (e) { xrayJob.failed.push({ name: f.name, why: e.message }); }
      xrayJob.done++;
    }
  })().finally(() => { xrayJob.running = false; xrayJob.endedAt = Date.now(); });
}

// ---- Favourites: stocks you heart anywhere in the app (per user) ----
const favFile = () => userFile("favourites.json");
async function favouritesView() {
  const fav = (await readJson(favFile(), { symbols: [] })).symbols || [];
  if (!fav.length) return { symbols: [], rows: [] };
  const [{ rows }, hv, sw, ce, master] = await Promise.all([computeRows(), kiteHoldingsView(), readJson(swingFile(), {}), corpEvents(), scripMaster().catch(() => ({ list: [] }))]);
  const bySym = new Map(rows.map(r => [String(r.symbol).toUpperCase(), r])), held = new Map(hv.holdings.map(h => [h.symbol, h]));
  const names = new Map((master.list || []).filter(x => x.exchange === "NSE").map(x => [x.symbol, x.name]));
  const prices = await livePrices(fav.map(sym => ({ symbol: sym, exchange: "NSE" })), 60e3, { budgetMs: 1200 });
  const today = istDay();
  return { symbols: fav, rows: fav.map(sym => {
    const r = bySym.get(sym), q = prices.get(sym), h = held.get(sym), p = (sw.positions || []).find(x => x.symbol === sym), w = (sw.watch || []).find(x => x.symbol === sym);
    const price = q?.price ?? r?.price ?? null, ev = eventsFor(sym, { events: ce.events || [], actions: ce.actions || [], today, pastDays: 0, aheadDays: 30 })[0] || null;
    return { symbol: sym, name: r?.company || names.get(sym) || sym, price, prevClose: q?.prevClose ?? null, dayPct: q?.prevClose > 0 && price ? Math.round((price / q.prevClose - 1) * 1e4) / 100 : null, priceSource: q?.source || null,
      inWatchlist: !!r, view: r?.view && r.view !== "No fundamentals" ? r.view : null, verdict: r?.verdict?.label || null, verdictCls: r?.verdict?.cls || null, fair: r?.fairValue?.base ?? null, upside: Number.isFinite(r?.upsideToBase) ? Math.round(r.upsideToBase * 100) : null, zone: r?.zoneLow ? [r.zoneLow, r.zoneHigh] : null, pe: r?.pe ?? null,
      held: h ? { qty: h.qty, value: h.value, pnl: h.pnl, pnlPct: h.invested ? Math.round((h.value / h.invested - 1) * 1000) / 10 : null } : null,
      swing: p ? { qty: p.qty, avg: p.avgPrice, pnlPct: price ? Math.round((price / p.avgPrice - 1) * 1000) / 10 : null } : w ? { watch: true, buyBelow: w.buyBelow, dip: w.list === "dip" } : null,
      event: ev ? { label: ev.label, date: ev.date, days: ev.days, kind: ev.kind, amount: ev.amount ?? null } : null };
  }) };
}

// ---- Ask AI: Claude with the user's own Anthropic key ----
// The key is stored per user, encrypted (AES-256-GCM) with AI_KEY_SECRET or a random server secret, never sent to the
// browser and left out of backups. Only the owner may fall back to the server's ANTHROPIC_API_KEY.
const aiFile = () => userFile("ai.json"), aiKeyFile = () => userFile("ai-key.json"), aiChatsFile = () => userFile("ai-chats.json");
const ANTHROPIC_BASE = () => (process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
let aiSecretMem = null;
async function aiSecret() {
  if (process.env.AI_KEY_SECRET) return process.env.AI_KEY_SECRET;
  if (aiSecretMem) return aiSecretMem;
  const f = path.join(DATA_DIR, "ai-secret.json"); let v = await readJson(f, null);
  if (!v?.secret) { v = { secret: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(32))).toString("base64") }; await writeJson(f, v); }
  return (aiSecretMem = v.secret);
}
async function aiSettings() { const st = await readJson(aiFile(), {}); return { ...AI_DEFAULTS, ...st, usage: st.usage?.month === monthKey() ? st.usage : { month: monthKey(), input: 0, output: 0, questions: 0 } }; }
async function aiKey() {
  const own = openKey(await readJson(aiKeyFile(), null), await aiSecret());
  if (own) return { key: own, source: "yours" };
  if (currentUser().role === "owner" && process.env.ANTHROPIC_API_KEY) return { key: process.env.ANTHROPIC_API_KEY, source: "server" };
  return { key: null, source: null };
}
async function aiStatus() {
  const [st, k, sealed] = await Promise.all([aiSettings(), aiKey(), readJson(aiKeyFile(), null)]);
  return { configured: !!k.key, keySource: k.source, keyHint: sealed?.hint || null, model: st.model, models: AI_MODELS, privacy: st.privacy, privacyOptions: AI_PRIVACY, monthlyTokens: st.monthlyTokens, usage: st.usage };
}
// Everything the AI sees, gathered from the same views the pages use (no outside calls beyond what pages make)
async function aiSnapshot() {
  const [hv, sw, nw, us, mf, ev] = await Promise.all([kiteHoldingsView(), swingView({ alerts: false }), networthView().catch(() => null), usHoldings().catch(() => null), syncedMutualFunds().catch(() => []), upcomingEvents().catch(() => ({ events: [] }))]);
  const holdings = hv.holdings.map(h => ({ symbol: h.symbol, qty: h.qty, avgPrice: h.avgPrice, price: h.qty && h.value > 0 ? h.value / h.qty : null, invested: h.invested, value: h.value > 0 ? h.value : null, pnlPct: h.invested && h.value > 0 ? (h.value / h.invested - 1) * 100 : null,
    view: h.valuation?.view || null, fair: h.valuation?.fairValue?.base ?? null, zone: h.valuation?.zoneLow ? `${h.valuation.zoneLow}-${h.valuation.zoneHigh}` : null, pe: h.valuation?.pe ?? null, sectorPe: h.valuation?.fairMultiple ?? null, stance: h.stance ? `${h.stance.action}: ${h.stance.summary || ""}` : null }));
  const mistakes = (sw.journal?.byMistake || []).filter(g => g.trades && !/unreviewed|none/i.test(g.key || g.label || "")).sort((a, b) => b.trades - a.trades).slice(0, 3).map(g => `${g.label || g.key} (${g.trades} trades, ₹${g.pnl})`).join(", ");
  return {
    today: istDay(), holdings, favourites: (await readJson(favFile(), { symbols: [] })).symbols || [],
    swing: { positions: sw.positions, watch: sw.watch, totals: sw.totals, score: sw.score ? { trades: sw.score.trades, winRate: sw.score.winRate, avgWinPct: sw.score.avgWinPct, avgLossPct: sw.score.avgLossPct, avgHoldDays: sw.score.avgHoldDays } : null, realised: sw.realised?.pnl, mistakes },
    networth: nw ? { assets: nw.totals?.assets, liabilities: nw.totals?.liabilities, mix: (nw.classes || []).map(c => ({ label: c.label, pct: c.pct })) } : null,
    us, mf: mf.map(f => ({ name: f.name, invested: f.invested, value: f.value })),
    events: (ev.events || []).filter(e => e.days >= 0).map(e => ({ date: e.date, symbol: e.symbol, label: e.label, amount: e.amount }))
  };
}
async function aiTool(name, input = {}) {
  const sym = String(input.symbol || "").toUpperCase().replace(/[^A-Z0-9&-]/g, "").slice(0, 20);
  if (name === "stock_detail") {
    if (!sym) return { error: "symbol needed" };
    const [{ rows }, scan, ce, bars] = await Promise.all([computeRows(), readJson(swingScanFile, { snaps: {} }), corpEvents(), eodBars(sym)]);
    const r = rows.find(x => String(x.symbol || "").toUpperCase() === sym);
    let tech = scan.snaps?.[sym]?.s || null; if (!tech && bars.length >= 60) tech = swingSnapshot(bars);
    const ev = eventsFor(sym, { events: ce.events || [], actions: ce.actions || [], today: istDay(), pastDays: 5, aheadDays: 45 }).map(e => ({ kind: e.kind, label: e.label, date: e.date, days: e.days, amount: e.amount ?? null }));
    if (!r && !tech) return { symbol: sym, note: "Not in the user's watchlist and no price history here: no valuation available. Suggest adding it to the watchlist in the app." , events: ev };
    const pick = r ? Object.fromEntries(["company", "price", "view", "status", "ratio", "pe", "fairMultiple", "basis", "fairValue", "upsideToBase", "zoneLow", "zoneHigh", "gapToZone", "confidence", "roce", "roe", "promoter", "salesCagr3", "profitCagr3", "debtToEquity", "dividendYield", "low", "high", "rangePos", "sector", "industry", "growthStage"].map(k => [k, r[k]]).filter(([, v]) => v !== undefined && v !== null)) : null;
    if (pick?.reasons === undefined && r?.reasons) pick.reasons = r.reasons.slice(0, 6);
    return { symbol: sym, valuation: pick, technicals: tech && { price: tech.price, changePct: tech.changePct, sma20: tech.sma20, sma50: tech.sma50, sma200: tech.sma200, rsi: tech.rsi, atrPct: tech.atrPct, high52: tech.high52, low52: tech.low52, ret1m: tech.ret1m, ret3m: tech.ret3m, rs3mVsNifty: tech.rs3m ?? null, volRatio: tech.volRatio }, events: ev };
  }
  if (name === "hold_or_sell") {
    if (!sym) return { error: "symbol needed" };
    try { const d = await decideFor({ symbol: sym }); return { symbol: sym, headline: d.headline, lean: d.lean, why: d.why, scenarios: d.scenarios.map(x => ({ title: x.title, keep: x.keep, worst: x.worst, typical: x.typical, best: x.best, keepNow: x.keepNow, saved: x.saved, notes: x.notes })), facts: d.facts }; }
    catch (e) { return { symbol: sym, error: e.message }; }
  }
  if (name === "index_stocks") {
    const v = await indexView(String(input.index || "NIFTY 50").slice(0, 80)), f = input.filter || "all";
    if (!v.rows.length) return { index: v.name, error: v.error || "The index list is not available yet (NSE did not answer)." };
    const rows = v.rows.filter(r => f === "all" || (f === "top" ? r.score >= 65 : f === "not-watching" ? !r.watching : r.tags.includes(f))).sort((a, b) => (b.score ?? -1) - (a.score ?? -1)).slice(0, 40);
    return { index: v.name, about: v.meta?.blurb || null, summary: v.summary, stocks: rows.map(r => ({ symbol: r.symbol, industry: r.industry, price: r.price, ch1m: r.ch30d, ch1y: r.ch365d, fromHigh: r.fromHigh, weight: r.weight, valuation: r.valuation ? `${r.valuation.view}${r.valuation.upside != null ? ` (${r.valuation.upside}% to fair)` : ""}${r.valuation.pe ? `, P/E ${r.valuation.pe}` : ""}` : "not valued", score: r.score, partial: r.partial, tags: r.tags, held: r.held, watching: r.watching })) };
  }
  if (name === "swing_ideas") {
    const x = await swingIdeas(), want = input.setup && input.setup !== "any" ? input.setup : null;
    return { ideas: x.ideas.filter(i => !want || i.setup === want).slice(0, 12).map(i => ({ symbol: i.symbol, setup: i.label || i.setup, entry: `${i.entryLow ?? i.entry}-${i.entryHigh ?? i.entry}`, stop: i.stop, t1: i.t1, t2: i.t2, score: i.score, verdict: i.verdict, rsi: i.snap?.rsi, rs3m: i.snap?.rs3m, watching: i.watching })), trackRecord: x.track?.summary || null, scannedAt: x.scan?.lastRun || null };
  }
  return { error: `unknown tool ${name}` };
}
// One call to the Messages API, streamed. onText gets text as it arrives.
async function anthropicStream({ key, model, system, messages, tools, maxTokens, signal, onText }) {
  const r = await fetch(`${ANTHROPIC_BASE()}/v1/messages`, { method: "POST", signal, headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools, stream: true }) });
  if (!r.ok) { const body = await r.json().catch(() => ({})); throw Object.assign(new Error(friendlyApiError(r.status, body)), { status: r.status }); }
  const col = messageCollector(onText), feed = sseParser(col.on), dec = new TextDecoder();
  for await (const chunk of r.body) feed(dec.decode(chunk, { stream: true }));
  const out = col.result(); if (out.error) throw new Error(`Anthropic: ${out.error}`);
  return out;
}
async function aiChat(req, res, b) {
  const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
  const ac = new AbortController(); res.on("close", () => ac.abort());
  try {
    const [st, k] = await Promise.all([aiSettings(), aiKey()]);
    if (!k.key) throw new Error("Add your Anthropic API key first (Ask AI → Settings).");
    if (st.usage.input + st.usage.output >= st.monthlyTokens) throw new Error(`This month's AI limit (${st.monthlyTokens.toLocaleString("en-IN")} tokens) is used up. Raise it in Ask AI → Settings.`);
    const question = String(b.message || "").trim().slice(0, 4000); if (!question) throw new Error("Type a question.");
    const chats = await readJson(aiChatsFile(), { chats: [] });
    let chat = chats.chats.find(c => c.id === b.chatId);
    if (!chat) { chat = { id: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(6))).toString("hex"), title: question.slice(0, 70), at: new Date().toISOString(), messages: [] }; chats.chats.unshift(chat); }
    send("chat", { id: chat.id, title: chat.title });
    send("status", { text: "Reading your portfolio…" });
    const context = buildContext(await aiSnapshot(), { privacy: st.privacy });
    const focus = b.focus?.symbol ? `\n\nThe user asked this from the ${String(b.focus.where || "app").slice(0, 30)} screen about ${String(b.focus.symbol).toUpperCase().slice(0, 20)}.` : "";
    const system = [{ type: "text", text: AI_SYSTEM }, { type: "text", text: `# The user's portfolio now\n${context}`, cache_control: { type: "ephemeral" } }];
    const messages = [...chat.messages.slice(-16).map(m => ({ role: m.role, content: m.text })), { role: "user", content: question + focus }];
    const usage = { input: 0, output: 0, cacheRead: 0 }, tools = [];
    let answer = "";
    for (let round = 0; round < 6; round++) {
      send("status", { text: round ? "Thinking it through…" : "Asking Claude…" });
      const out = await anthropicStream({ key: k.key, model: st.model, system, messages, tools: AI_TOOLS, maxTokens: st.maxAnswerTokens, signal: ac.signal, onText: t => { answer += t; send("delta", { text: t }); } });
      usage.input += out.usage.input + out.usage.cacheWrite; usage.cacheRead += out.usage.cacheRead; usage.output += out.usage.output;
      const calls = out.content.filter(c => c.type === "tool_use");
      if (out.stop_reason !== "tool_use" || !calls.length) break;
      messages.push({ role: "assistant", content: out.content });
      const results = [];
      for (const c of calls) {
        send("tool", { name: c.name, symbol: c.input?.symbol || null }); tools.push(`${c.name}${c.input?.symbol ? ` ${c.input.symbol}` : ""}`);
        const r = await aiTool(c.name, c.input).catch(e => ({ error: e.message }));
        results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(r).slice(0, 12000) });
      }
      messages.push({ role: "user", content: results });
      if (answer && !answer.endsWith("\n")) { answer += "\n\n"; send("delta", { text: "\n\n" }); }
    }
    chat.messages.push({ role: "user", text: question, at: new Date().toISOString() }, { role: "assistant", text: answer || "(no answer)", at: new Date().toISOString(), model: st.model, tools });
    chat.messages = chat.messages.slice(-40); chat.at = new Date().toISOString();
    chats.chats = chats.chats.slice(0, 30); await writeJson(aiChatsFile(), chats);
    const cur = await readJson(aiFile(), {}), u = cur.usage?.month === monthKey() ? cur.usage : { month: monthKey(), input: 0, output: 0, questions: 0 };
    await writeJson(aiFile(), { ...cur, usage: { ...u, input: u.input + usage.input + usage.cacheRead, output: u.output + usage.output, questions: (u.questions || 0) + 1 } });
    send("done", { usage, tools, model: st.model });
  } catch (e) { if (!ac.signal.aborted) send("error", { message: e.name === "TimeoutError" ? "Claude took too long to answer." : e.message }); }
  res.end();
}

// ---- Net worth: synced stocks + Kite mutual funds + everything entered by hand ----
const networthFile = () => userFile("networth.json");
async function syncedMutualFunds() {
  const store = await readHoldStore(), links = (await readJson(networthFile(), {})).links || {};
  const xr = (await readJson(U.fundsFile, { funds: [] })).funds;
  const out = [], amfi = await amfiNav();
  const add = (f, key, account, accountLabel, syncedAt, extra = {}) => {
    const link = Object.hasOwn(links, key) ? links[key] : undefined;
    const auto = link === undefined ? matchFund(f.name, xr) : null;
    const fundId = link === undefined ? auto?.id || null : link && xr.some(x => x.id === link) ? link : null;
    out.push({ ...f, key, account, accountLabel, syncedAt, fundId, autoLinked: !!auto && link === undefined, xrayName: xr.find(x => x.id === fundId)?.name || null, ...extra });
  };
  const synced = [];
  for (const [userId, acct] of Object.entries(store.accounts || {})) for (const f0 of acct.mf || []) {
    synced.push(f0);
    // a newer official NAV than the sync carried (units × today's AMFI NAV)
    const syncDay = String(acct.mfSyncedAt || acct.syncedAt || "").slice(0, 10), f = f0.units > 0 ? valueFund({ ...f0, navDate: f0.navDate || syncDay || null }, amfi) : f0;
    if (f.navSource === "AMFI" && Number.isFinite(f.invested)) f.pnl = Math.round((f.value - f.invested) * 100) / 100;
    if (!Number.isFinite(f.avgNav) && Number.isFinite(f.invested) && f.units > 0) f.avgNav = Math.round(f.invested / f.units * 1e4) / 1e4;
    add(f, `${userId}:${f.isin}:${f.folio || ""}`, userId, acct.label || userId, acct.mfSyncedAt || acct.syncedAt, { source: "sync" });
  }
  for (const f of await importedFunds(synced)) if (!f.duplicate) add(f, `import:${f.id}`, "import", f.source === "manual" ? "Added by hand" : f.source === "cas" ? "CAS statement" : "Imported file", f.importedAt, { source: f.source });
  return out.sort((a, b) => (b.value || 0) - (a.value || 0));
}
async function networthView() {
  const [view, mf, st, xrFile] = await Promise.all([kiteHoldingsView(), syncedMutualFunds(), readJson(networthFile(), {}), readJson(U.fundsFile, { funds: [] })]);
  const items = Array.isArray(st.items) ? st.items : [];
  const per = new Map();
  for (const h of view.holdings) {
    const px = h.qty ? h.value / h.qty : 0;
    for (const a of h.accounts) { const r = per.get(a.userId) || { value: 0, invested: 0 }; r.value += px * a.qty; r.invested += (a.avgPrice || 0) * a.qty; per.set(a.userId, r); }
  }
  const stocks = view.accounts.map(a => ({ account: a.userId, label: `${a.brokerName || "Zerodha"} · ${a.label}`, value: Math.round(per.get(a.userId)?.value || 0), invested: Math.round(per.get(a.userId)?.invested || 0) || null, syncedAt: a.syncedAt }));
  const accts = Object.entries((await readHoldStore()).accounts || {});
  let intl;
  try { intl = (await usHoldings()).rows.filter(r => Number.isFinite(r.valueInr)).map(r => ({ key: r.key, name: `${r.name}${r.symbol && r.symbol !== r.name ? ` (${r.symbol})` : ""} · ${r.account}`, value: Math.round(r.valueInr), invested: Number.isFinite(r.investedInr) ? Math.round(r.investedInr) : null, syncedAt: r.priceDate || r.syncedAt })); }
  catch { intl = accts.flatMap(([id, a]) => (a.us || []).map((u, i) => ({ key: `${id}:${u.symbol || i}`, name: `${u.name}${u.symbol ? ` (${u.symbol})` : ""} · ${a.label || id}`, value: u.value, invested: u.invested, syncedAt: a.syncedAt }))); }
  const nw = buildNetworth({ stocks, intl, mf: mf.map(f => ({ key: f.key, name: f.name, value: f.value, invested: f.invested, syncedAt: f.syncedAt, fundId: f.fundId, isin: f.isin })), items });
  // Look-through uses synced funds plus hand-entered funds that are linked to an X-ray portfolio.
  const xray = new Map(xrFile.funds.map(f => [f.id, { name: f.name, holdings: f.holdings }]));
  const fundsForLook = [...mf.map(f => ({ key: f.key, name: f.name, value: f.value, fundId: f.fundId })), ...items.filter(i => i.category === "mf").map(i => ({ key: `manual:${i.id}`, name: i.name, value: i.value, fundId: i.fundId }))];
  const look = lookThrough({ direct: view.holdings.map(h => ({ symbol: h.symbol, name: h.company || h.symbol, value: h.value })), funds: fundsForLook, xray });
  let history = Array.isArray(st.history) ? st.history : [];
  const today = istDay();
  if (nw.totals.assets > 0) {
    const next = addSnapshot(history, today, nw.totals);
    if (JSON.stringify(next.at(-1)) !== JSON.stringify(history.find(h => h.day === today))) { history = next; await writeJson(networthFile(), { ...st, items, history }); }
  }
  const mfAccounts = Object.entries((await readHoldStore()).accounts || {}).filter(([, a]) => (a.broker || "zerodha") === "zerodha" || Array.isArray(a.mf)).map(([id, a]) => ({ userId: id, label: a.label, mfSyncedAt: a.mfSyncedAt || null, mfError: a.mfError || null, mfCount: (a.mf || []).length }));
  const goals = (Array.isArray(st.goals) ? st.goals : []).map(g => goalStatus(g, { net: nw.totals.net, investable: nw.totals.investable, history, today }));
  const staleManual = items.filter(i => Date.now() - new Date(i.updatedAt).getTime() > 90 * 864e5).length;
  const otherAssets = accts.flatMap(([, a]) => (a.otherAssets || []).map(o => ({ ...o, account: a.label }))).filter(o => o.value > 0);
  return { ...nw, goals, staleManual, otherAssets, today, history: history.slice(-400), change: { d30: changeSince(history, today, 30), d365: changeSince(history, today, 365) }, assetCategories: ASSET_CATEGORIES, liabilityCategories: LIABILITY_CATEGORIES, mf, mfAccounts, xrayFunds: xrFile.funds.map(f => ({ id: f.id, name: f.name, count: f.holdings.length })), lookThrough: { ...look, rows: look.rows.slice(0, 60) }, kiteConnected: view.accounts.some(a => (a.broker || "zerodha") === "zerodha") };
}
function istDay(date = new Date()) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(date); } // yyyy-mm-dd

// Diffs `next` against `previous` and records (1) any change to a research field as a
// timestamped event, and (2) at most one price point per stock per IST calendar day.
// This keeps the log a meaningful research audit trail rather than a price firehose.
async function recordChanges(previous, next) {
  const history = await readHistory();
  const prevById = new Map(previous.map(s => [s.id, s]));
  const now = new Date().toISOString();
  const today = istDay();
  let touched = false;

  for (const stock of next) {
    const prev = prevById.get(stock.id);
    if (prev) {
      for (const field of RESEARCH_FIELDS) {
        const before = prev[field] ?? null, after = stock[field] ?? null;
        if (before !== after) { history.changes.push({ id: stock.id, company: stock.company, field, from: before, to: after, at: now }); touched = true; }
      }
      const beforeVerdict = prev.longTermStory?.verdict ?? null, afterVerdict = stock.longTermStory?.verdict ?? null;
      if (beforeVerdict !== afterVerdict) { history.changes.push({ id: stock.id, company: stock.company, field: "longTermStory", from: beforeVerdict, to: afterVerdict, at: now }); touched = true; }
    }
    if (Number.isFinite(stock.price)) {
      const series = history.priceSeries[stock.id] ||= [];
      const last = series.at(-1);
      if (!last || last.date !== today) { series.push({ date: today, price: stock.price }); touched = true; if (series.length > MAX_PRICE_POINTS) series.shift(); }
      else if (last.price !== stock.price) { last.price = stock.price; touched = true; }
    }
  }
  if (history.changes.length > MAX_CHANGE_LOG) history.changes = history.changes.slice(-MAX_CHANGE_LOG);
  if (touched) await writeHistory(history);
  return history;
}
// The page sends back its own copy of the watchlist (edits, refresh). If it was open for a while, its prices are older than
// the ones the server fetched since: keep, per stock, whichever price is newer (priceAt), so a stale tab never undoes a refresh.
// "fetch failed" hides the reason; Node keeps it in e.cause (ENOTFOUND = DNS, ECONNREFUSED, ETIMEDOUT, certificate errors…).
const errText = e => { const c = e?.cause; const why = c ? (c.code || c.message || "").toString() : ""; return `${e?.message || e}${why && !String(e?.message).includes(why) ? ` (${why}${c?.hostname ? ` ${c.hostname}` : ""})` : ""}`; };
const PRICE_FIELDS = ["price", "low", "high", "rangeUpdated", "priceAt", "priceSource", "feedStatus", "updated"];
const priceTime = s => { const t = Date.parse(s?.priceAt || ""); return Number.isFinite(t) ? t : 0; };
function keepNewerPrices(incoming, stored) {
  const byId = new Map(stored.map(s => [s.id, s])), bySym = new Map(stored.map(s => [symOf(s), s]));
  let kept = 0;
  const out = incoming.map(s => {
    const old = byId.get(s.id) || (symOf(s) && bySym.get(symOf(s)));
    if (!old || priceTime(old) <= priceTime(s)) return s;
    kept++; const next = { ...s }; for (const k of PRICE_FIELDS) if (old[k] !== undefined) next[k] = old[k];
    return next;
  });
  if (kept) console.log(`[watchlist] kept ${kept} newer server price(s) over an older copy sent by the page`);
  return out;
}
async function persistWatchlist(nextStocks, previousStocks) {
  const previous = previousStocks || await readWatchlist();
  await recordChanges(previous, nextStocks);
  await writeWatchlist(nextStocks);
  const u = currentUser(); if (u && previous.length !== nextStocks.length) notifyUser(u.id, "symbols");
}

// Yahoo: the live price field of the chart endpoint (regularMarketPrice), not the last daily bar, which can lag.
async function yahooQuote(marketSymbol, exchange = "NSE") {
  const { bars, meta } = await fetchChart(marketSymbol, { exchange, range: "5d" });
  const price = meta.price > 0 ? meta.price : bars.at(-1)?.c;
  if (!(price > 0)) throw new Error("no price returned");
  return { price: Number(price.toFixed(2)), prevClose: meta.prevClose > 0 ? meta.prevClose : null, low: meta.low52 > 0 ? meta.low52 : null, high: meta.high52 > 0 ? meta.high52 : null, asOf: meta.time ? new Date(meta.time * 1000).toISOString() : null, source: "Yahoo Finance" };
}
// Google Finance is scraped, so guard against it resolving the wrong instrument: a price >40% away from the last
// stored close is rejected and the next source is tried (a genuine split or crash can be fixed with a manual refresh).
function plausible(stock, quote) {
  if (!Number.isFinite(stock.price) || stock.price <= 0) return;
  const move = Math.abs(quote.price / stock.price - 1);
  if (move > 0.4) throw new Error(`price ₹${quote.price} is ${(move * 100).toFixed(0)}% away from the last close ₹${stock.price}; ignored`);
}
// Returns a quote from the first working source in PRICE_SOURCES. `kitePrices` holds LTPs already fetched in one batch call.
async function getQuote(stock, kitePrices) {
  const sym = String(stock.marketSymbol).toUpperCase(), errors = [], trail = [];
  let quote = null, best = null;
  for (const src of PRICE_SOURCES) {
    const t0 = Date.now();
    try {
      if (src === "kite") { const p = kitePrices.get(sym); if (!p) { trail.push("kite: no LTP"); continue; } quote = { price: Number(p.toFixed(2)), source: "Kite MCP (Zerodha LTP)" }; }
      else if (src === "nse") { if (stock.exchange === "BSE") { trail.push("nse: BSE stock, skipped"); continue; } if (nseCooldown()) { trail.push(`nse: cooling down until ${new Date(nseCooldown()).toLocaleTimeString("en-IN")} (${lastNseStatus || "blocked"})`); errors.push("nse: cooling down"); continue; } const q = await paced("nse", 350, () => fetchNseQuote(sym)); if (!(q.price > 0)) throw new Error("answered without a price"); quote = { price: q.price, low: q.low52 || null, high: q.high52 || null, asOf: q.asOf || null, source: "NSE" }; plausible(stock, quote); }
      else if (src === "yahoo") quote = await yahooQuote(stock.marketSymbol, stock.exchange);
      else if (src === "screener") { if (stock.exchange === "BSE") { trail.push("screener: BSE stock, skipped"); continue; } if (screenerCooldown()) { trail.push(`screener: cooling down until ${new Date(screenerCooldown()).toLocaleTimeString("en-IN")}`); errors.push("screener: cooling down"); continue; } quote = await paced("screener", 1200, () => fetchScreenerPrice(stock)); plausible(stock, quote); }
      else { if (googleCooldown()) { trail.push("google: cooling down"); errors.push("google: cooling down"); continue; } quote = await paced("google", 500, () => fetchGoogleQuote(sym, { exchange: googleExchange(stock) })); plausible(stock, quote); }
      trail.push(`${src}: ✓ ₹${quote.price}${quote.asOf ? ` @ ${new Date(quote.asOf).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""} (${Date.now() - t0} ms)`);
    } catch (e) { quote = null; errors.push(`${src}: ${errText(e)}`); trail.push(`${src}: ✗ ${errText(e).slice(0, 160)} (${Date.now() - t0} ms)`); }
    // NSE is the exchange's own price: done. Other sites can lag (Yahoo's NSE feed is often ~15 min behind, Screener has no
    // time stamp), so while the market is open keep asking the next source and use the most recent quote.
    if (quote) { best = pickFresher(best, quote); quote = null; if (isFresh({ ...best, source: best.source === "NSE" ? "NSE" : best.source })) break; }
  }
  quote = best;
  if (quote && quote.source !== "NSE" && marketIsOpen() && !(quote.asOf && Date.now() - Date.parse(quote.asOf) < 3 * 60e3)) trail.push(`using ${quote.source} (${quote.asOf ? `${Math.round((Date.now() - Date.parse(quote.asOf)) / 60e3)} min old` : "no time stamp"})`);
  console.log(`[price] ${sym}: ${trail.join(" → ") || "no sources configured"}`);
  if (!quote) throw new Error(errors.join(" | ") || "no price source available (check PRICE_SOURCES)");
  // Kite's LTP has no 52-week range. Borrow it from Yahoo/Google when the stored range is missing or older than a day.
  if (!(quote.low > 0 && quote.high > 0)) {
    const stale = !(stock.low > 0 && stock.high > 0) || Date.now() - new Date(stock.rangeUpdated || 0).getTime() > RANGE_MAX_AGE_MS;
    if (stale) for (const src of PRICE_SOURCES.filter(s => s === "yahoo" || s === "google")) {
      try { const r = src === "yahoo" ? await yahooQuote(stock.marketSymbol, stock.exchange) : await fetchGoogleQuote(sym, { exchange: googleExchange(stock) }); if (r.low > 0 && r.high > 0) { quote.low = r.low; quote.high = r.high; quote.rangeSource = r.source; break; } } catch { /* range is optional */ }
    }
  }
  return { ...quote, fallbackErrors: errors };
}
// BSE-only stocks (often newly listed, usually a numeric scrip code) are priced from Yahoo ".BO" / Google "BOM"; Kite LTP is asked for NSE stocks only.
const googleExchange = stock => (stock.exchange === "BSE" ? "BOM" : googleConfig.exchange);
async function fetchKitePrices(stocks) {
  const kc = PRICE_SOURCES.includes("kite") ? await anyKiteWithSession() : null;
  if (!kc) return new Map(); // never logged in: do not contact Kite
  try { return await kc.ltp(stocks.filter(s => s.exchange !== "BSE").map(s => s.marketSymbol).filter(Boolean)); }
  catch (e) { console.warn(`[kite] LTP unavailable, using the next price source: ${e.loginRequired ? "login required (Integrations tab)" : e.message}`); return new Map(); }
}
async function refreshOne(stock, withNews, kitePrices = new Map()) {
  if (!stock.marketSymbol) { console.warn(`[refresh] ${stock.company}: skipped — ticker confirmation needed`); return { ...stock, feedStatus: "Ticker confirmation needed" }; }
  try {
    console.log(`[refresh] ${stock.company} (${stock.marketSymbol}): fetching price${withNews ? " and news" : ""}`);
    const quote = await getQuote(stock, kitePrices);
    if (quote.fallbackErrors.length) console.warn(`[refresh] ${stock.company}: used ${quote.source} after ${quote.fallbackErrors.join(" | ")}`);
    const hasRange = quote.low > 0 && quote.high > 0;
    // Keep the stored range when the source did not supply one, but never let the price sit outside it.
    const low = hasRange ? quote.low : (stock.low > 0 ? Math.min(stock.low, quote.price) : quote.price), high = hasRange ? quote.high : (stock.high > 0 ? Math.max(stock.high, quote.price) : quote.price);
    const values = { ...stock, price: quote.price, low, high, ...(hasRange ? { rangeUpdated: new Date().toISOString() } : {}), updated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), priceAt: quote.asOf || new Date().toISOString(), priceSource: quote.source, feedStatus: "Price refreshed" };
    const newsAge = Date.now() - new Date(stock.newsUpdated || 0).getTime();
    if (withNews && newsAge > 6 * 60 * 60 * 1000) {
      try {
        const q = encodeURIComponent(`${stock.company} India stock`);
        const rss = await (await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-IN&gl=IN&ceid=IN:en`, { headers: { "User-Agent": "EquityWatchlist/0.1 research@localhost" } })).text();
        const item = rss.match(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]>/i) || rss.match(/<item>[\s\S]*?<title>(.*?)<\/title>/i);
        if (item) { values.latestNews = clean(item[1]); values.newsUpdated = new Date().toISOString(); values.newsSource = "Google News RSS"; }
      } catch { values.newsSource = "News refresh unavailable"; }
    }
    console.log(`[refresh] ${stock.company}: ₹${values.price}; 52W ₹${values.low}–₹${values.high}${values.latestNews ? "; news updated" : ""}`);
    return values;
  } catch (error) { console.error(`[refresh] ${stock.company}: ${error.message}`); return { ...stock, feedStatus: `Refresh failed: ${error.message}` }; }
}
async function mapLimit(items, limit, worker) { const results = new Array(items.length); let cursor = 0; async function run() { while (cursor < items.length) { const i = cursor++; results[i] = await worker(items[i]); } } await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run)); return results; }
async function refreshWatchlist(stocks, withNews = true) { console.log(`[refresh] Starting ${stocks.length}-stock refresh${withNews ? " with news" : ""} (sources: ${PRICE_SOURCES.join(" → ")}).`); const kitePrices = await fetchKitePrices(stocks); const refreshed = await mapLimit(stocks, 3, stock => refreshOne(stock, withNews, kitePrices)); await persistWatchlist(refreshed, stocks); if (refreshed.some(s => s.feedStatus === "Price refreshed")) { lastPriceRefreshAt = new Date().toISOString(); await writeJson(userFile("meta.json"), { ...(await readJson(userFile("meta.json"), {})), lastPriceRefresh: lastPriceRefreshAt }); } const bySrc = {}; for (const r of refreshed) if (r.feedStatus === "Price refreshed") bySrc[r.priceSource] = (bySrc[r.priceSource] || 0) + 1; console.log(`[refresh] Finished: ${refreshed.filter(s => s.feedStatus === "Price refreshed").length}/${stocks.length} prices refreshed ${JSON.stringify(bySrc)}; ${refreshed.filter(s => String(s.feedStatus).startsWith("Refresh failed")).length} failed.`); return refreshed; }
function marketIsOpen() { if (process.env.MARKET_ALWAYS_OPEN === "1") return true; // testing only
  return marketIsOpenNow(); }
function marketIsOpenNow() { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts().filter(p => p.type !== "literal").map(p => [p.type, p.value])); const minutes = Number(parts.hour) * 60 + Number(parts.minute); return !["Sat", "Sun"].includes(parts.weekday) && minutes >= 555 && minutes <= 930; }
// Swing alerts: every 5 minutes during market hours, per account (positions hitting the profit target or add levels).
setInterval(() => { if (marketIsOpen()) forEachUser(async () => { const st = await readJson(swingFile(), {}); if ((st.positions || []).length || (st.watch || []).length) await swingView(); }); }, 5 * 60 * 1000).unref();
// Background work runs once per account, each inside that account's own context (its files, its Kite login).
async function forEachUser(fn) { for (const u of auth.listUsers()) { try { await asUser(u, fn); } catch (e) { console.error(`[background] ${u.username}: ${e.message}`); } } }
// ---- Live prices for every account, every PRICE_REFRESH_SECONDS (default 60) while the market is open ----
// Each stock is fetched once for all accounts: NSE one by one (paced), then Yahoo in batches of 40, then Yahoo's chart,
// Google and Screener for what is left, inside a time budget. A run that takes longer simply delays the next one.
const PRICE_REFRESH_SEC = Math.max(30, Number(process.env.PRICE_REFRESH_SECONDS) || 60);
const priceState = { running: false, lastRun: null, lastDurationMs: null, lastCount: 0, lastFailed: 0, bySource: {}, lastError: null };
const quoteCache = new Map(); // "EX:SYM" -> { price, low, high, prevClose, asOf, source, at }
let priceRun = null;
async function fetchQuotesFast(items, budgetMs) {
  const out = new Map(), key = i => `${i.exchange}:${i.symbol}`, deadline = Date.now() + budgetMs;
  const fresh = q => q && (q.source === "NSE" || (q.asOf && Date.now() - Date.parse(q.asOf) < 3 * 60e3) || !marketIsOpen());
  const ok = (i, q) => { if (!(q?.price > 0)) return false; if (i.last > 0 && Math.abs(q.price / i.last - 1) > 0.4) return false; return true; }; // a quote 40% off the last price = wrong instrument
  // 1. Head start: one Yahoo request for every stock at once (a few hundred ms when it works).
  if (PRICE_SOURCES.includes("yahoo") && items.length > 3 && !(yahooCooldown() > Date.now())) {
    try { const qs = await yahooQuotes(items.map(i => ({ symbol: i.symbol, exchange: i.exchange }))); for (const i of items) { const q = qs.get(i.symbol); const v = q && { price: q.price, low: q.low52 ?? null, high: q.high52 ?? null, prevClose: Number.isFinite(q.pChange) && q.price ? Number((q.price / (1 + q.pChange / 100)).toFixed(2)) : null, asOf: q.time || null, source: "Yahoo" }; if (ok(i, v)) { out.set(key(i), v); setLive(key(i), { ...v, at: Date.now() }); } } } catch (e) { console.log(`[prices] Yahoo batch unavailable (${errText(e).slice(0, 80)}); going stock by stock`); }
  }
  // 2. Exactly the Swing page's path for everything else (NSE → Yahoo → Google → Screener, newest quote wins), four
  //    stocks at a time; each site keeps its own pacing. Whatever is unfinished at the deadline completes in the
  //    background into the shared cache, and syncLivePrices() writes it to the watchlists on the next check.
  const todo = items.filter(i => !fresh(out.get(key(i))));
  let next = 0;
  const worker = async () => { while (next < todo.length && Date.now() < deadline) { const i = todo[next++]; try { const v = await fetchLiveQuote(i); if (ok(i, v)) out.set(key(i), pickFresher(out.get(key(i)), v)); } catch { /* next stock */ } } };
  await Promise.race([Promise.all(Array.from({ length: Math.min(4, todo.length) }, worker)), new Promise(r => setTimeout(r, Math.max(0, deadline - Date.now())))]);
  if (next < todo.length) { const rest = todo.slice(next); next = todo.length; (async () => { for (const i of rest) await fetchLiveQuote(i).catch(() => {}); })(); }
  return out;
}
async function refreshAllPrices({ user = null, force = false } = {}) {
  if (priceRun) { await priceRun.catch(() => {}); if (!force) return priceState; }
  priceRun = (async () => {
    const t0 = Date.now(); priceState.running = true; priceState.lastError = null;
    try {
      // Everything to price: watchlists + swing positions and swing watchlists, of one account or all
      const items = new Map(), accounts = [];
      const collect = async () => {
        const [stocks, st] = await Promise.all([readWatchlist(), readJson(swingFile(), {})]);
        accounts.push(currentUser());
        for (const x of stocks) { const sym = symOf(x); if (sym) items.set(`${x.exchange || "NSE"}:${sym}`, { symbol: sym, exchange: x.exchange || "NSE", last: x.price }); }
        for (const x of [...(st.positions || []), ...(st.watch || [])]) { const k = `${x.exchange || "NSE"}:${x.symbol}`; if (!items.has(k)) items.set(k, { symbol: x.symbol, exchange: x.exchange || "NSE" }); }
      };
      if (user) await asUser(user, collect); else await forEachUser(collect);
      const all = [...items.values()], need = all.filter(i => force || !(livePriceCache.get(`${i.exchange}:${i.symbol}`)?.at > Date.now() - 45e3));
      // The header button waits ~12 s (the rest finishes in the background); the timer allows most of its interval.
      const got = await fetchQuotesFast(need, force ? 12e3 : Math.max(20e3, PRICE_REFRESH_SEC * 800));
      for (const [k, q] of got) quoteCache.set(k, { ...q, at: Date.now() });
      // Write each account's watchlist from the shared live cache (same store the Swing page reads) and check its alerts
      const bySource = {};
      for (const q of got.values()) bySource[q.source] = (bySource[q.source] || 0) + 1;
      for (const u of accounts) await asUser(u, async () => {
        const r = await syncLivePrices();
        if (r.changed) await runAlerts((await computeRows()).rows).catch(() => {});
      });
      Object.assign(priceState, { lastRun: new Date().toISOString(), lastDurationMs: Date.now() - t0, lastCount: got.size, lastFailed: Math.max(0, need.length - got.size), bySource });
      if (got.size) lastPriceRefreshAt = priceState.lastRun;
      if (need.length) console.log(`[prices] ${got.size}/${need.length} quotes in ${((Date.now() - t0) / 1000).toFixed(1)} s ${JSON.stringify(bySource)}${need.length - got.size ? `; ${need.length - got.size} without a price` : ""}${user ? ` (asked by ${user.username})` : ""}`);
    } catch (e) { priceState.lastError = e.message; console.error(`[prices] ${e.message}`); }
    finally { priceState.running = false; }
    return priceState;
  })();
  try { return await priceRun; } finally { priceRun = null; }
}
setInterval(() => { if (marketIsOpen() && !priceRun) refreshAllPrices().catch(() => {}); }, PRICE_REFRESH_SEC * 1000).unref();
// After the close (15:40–17:00 IST, weekdays), once a day: the official closing price, which is only published after 15:30.
// Without it the last automatic price of the day would be the one from 15:15–15:30.
let lastCloseRefreshDay = null;
setInterval(() => {
  const t = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts().reduce((a, p) => ({ ...a, [p.type]: p.value }), {});
  const mins = Number(t.hour) * 60 + Number(t.minute), day = istDay();
  if (["Sat", "Sun"].includes(t.weekday) || mins < 940 || mins > 1020 || lastCloseRefreshDay === day) return;
  lastCloseRefreshDay = day; console.log("[refresh] Closing-price refresh for every account.");
  forEachUser(async () => { const stocks = await readWatchlist(); if (stocks.length) { await refreshWatchlist(stocks, false); await runAlerts((await computeRows()).rows); } });
}, 5 * 60 * 1000).unref();

// Daily (after 19:00 IST) refresh of stale or missing fundamentals, a few at a time. Disable with AUTO_FUNDAMENTALS=0.
let lastAutoDay = null;
async function autoFundamentals() {
  if (process.env.AUTO_FUNDAMENTALS === "0") return;
  const day = istDay(), hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format());
  if (hour < 19 || lastAutoDay === day || yahooCooldown()) return;
  lastAutoDay = day;
  await forEachUser(autoFundamentalsForUser);
}
async function autoFundamentalsForUser() {
  const [stocks, map] = await Promise.all([readWatchlist(), readFundamentals()]);
  const due = stocks.filter(s => symOf(s) && !(map[symOf(s)]?.asOf && Date.now() - new Date(map[symOf(s)].asOf).getTime() < 7 * 864e5)).slice(0, 15);
  if (!due.length) return;
  console.log(`[fundamentals] Scheduled refresh of ${due.length} stale/missing stock(s).`);
  for (let i = 0; i < due.length; i += 5) await runFundamentalsFetch(due.slice(i, i + 5), false).catch(e => console.error(`[fundamentals] scheduled run failed: ${e.message}`));
}
setInterval(() => { autoFundamentals().catch(() => {}); }, 30 * 60 * 1000).unref();
// On start, fill any watchlist stock that has never been valued (AUTO_FUNDAMENTALS=0 switches this off too).
if (process.env.AUTO_FUNDAMENTALS !== "0" && !process.env.NODE_TEST_CONTEXT) setTimeout(() => forEachUser(async () => { const st = await readLists(); await queueFill([...new Set(st.lists.flatMap(l => l.symbols))]); }), 15000).unref();

async function appHandler(req, res, url) {
  try {
    if (url.pathname === "/api/health") return reply(res, 200, { ok: true, lastPriceRefreshAt, marketOpen: marketIsOpen(), provider: `${PRICE_SOURCES.join(" → ")} price feeds + Google News RSS`, priceSources: PRICE_SOURCES, kiteEnabled: kite.config.enabled, scheduledRefresh: `Every ${PRICE_REFRESH_SEC} seconds during NSE cash-market hours, plus once after the close`, yahooCooldownUntil: yahooCooldown() || null, googleCooldownUntil: googleCooldown() || null, nseCooldownUntil: nseCooldown() || null });
    // "version" changes whenever any of this account's prices changes (also quotes that finished in the background).
    const priceVersion = stocks => stocks.reduce((m, x) => Math.max(m, Date.parse(x.updatedAt || "") || 0, Date.parse(x.priceAt || "") || 0), 0) + ":" + stocks.reduce((s, x) => s + (Number(x.price) || 0), 0).toFixed(2);
    const myPending = stocks => stocks.filter(x => livePending.has(`${x.exchange || "NSE"}:${symOf(x)}`)).length;
    // Results, dividends, bonuses for everything you track, next 30 days (and the last few)
    if (url.pathname === "/api/events/upcoming" && req.method === "GET") return reply(res, 200, await upcomingEvents());
    if (url.pathname === "/api/events/refresh" && req.method === "POST") { refreshCorpEvents({ force: true }).catch(() => {}); return reply(res, 202, { started: true }); }
    if (url.pathname === "/api/eod/status" && req.method === "GET") { const st = await readJson(eodStateFile, {}); return reply(res, 200, { lastDay: st.lastDay || null, daysStored: (st.days || []).length, backfilled: st.backfilled || null, running: eodState.running, backfill: eodState.backfill, lastError: eodState.lastError }); }
    if (url.pathname === "/api/eod/run" && req.method === "POST") { if (currentUser().role !== "owner") return reply(res, 403, { message: "Owner only." }); runEod().catch(() => {}); return reply(res, 202, { started: true }); }
    if (url.pathname === "/api/prices/status" && req.method === "GET") {
      const { stocks } = await syncLivePrices(), latest = stocks.reduce((m, x) => Math.max(m, Date.parse(x.priceAt || "") || 0), 0);
      return reply(res, 200, { ...priceState, intervalSec: PRICE_REFRESH_SEC, marketOpen: marketIsOpen(), myLatestPriceAt: latest ? new Date(latest).toISOString() : null, version: priceVersion(stocks), pending: myPending(stocks) });
    }
    // Refresh now: answers at once; prices stream to the page over /api/events as they arrive, then a "refresh" event
    // carries the summary (wait=1 keeps the old behaviour of answering when done, for scripts).
    if (url.pathname === "/api/prices/refresh" && req.method === "POST") {
      const user = currentUser(), t0 = Date.now();
      const finish = async () => {
        const st = await refreshAllPrices({ user, force: true });
        return asUser(user, async () => {
          const { stocks } = await syncLivePrices(), latest = stocks.reduce((m, x) => Math.max(m, Date.parse(x.priceAt || "") || 0), 0);
          const pending = myPending(stocks);
          // Not priced in this refresh and not still loading = the sources had nothing for it
          const failedStocks = stocks.filter(x => symOf(x)).filter(x => !(livePriceCache.get(`${x.exchange || "NSE"}:${symOf(x)}`)?.at >= t0) && !livePending.has(`${x.exchange || "NSE"}:${symOf(x)}`)).map(symOf);
          const out = { ...st, intervalSec: PRICE_REFRESH_SEC, marketOpen: marketIsOpen(), myLatestPriceAt: latest ? new Date(latest).toISOString() : null, version: priceVersion(stocks), pending, failedStocks: failedStocks.slice(0, 8), failedCount: failedStocks.length, tookMs: Date.now() - t0 };
          notifyUser(user.id, "refresh", out);
          return out;
        });
      };
      // Start this account's quotes right away, even while the minute-timer's run is still busy (the two share in-flight requests)
      { const [stocks, sw] = await Promise.all([readWatchlist(), readJson(swingFile(), {})]); const items = new Map();
        for (const x of stocks) if (symOf(x)) items.set(`${x.exchange || "NSE"}:${symOf(x)}`, { symbol: symOf(x), exchange: x.exchange || "NSE", last: x.price });
        for (const x of [...(sw.positions || []), ...(sw.watch || [])]) items.set(`${x.exchange || "NSE"}:${x.symbol}`, { symbol: x.symbol, exchange: x.exchange || "NSE" });
        if (!priceRun) { /* the forced run below fetches them */ } else (async () => { const list = [...items.values()]; let k = 0; const w = async () => { while (k < list.length) await fetchLiveQuote(list[k++]).catch(() => {}); }; await Promise.all([w(), w(), w(), w()]); })(); }
      if (url.searchParams.get("wait") === "1") return reply(res, 200, await finish());
      finish().catch(e => notifyUser(user.id, "refresh", { error: e.message }));
      return reply(res, 202, { started: true });
    }
    // Live updates for this page: new prices for this account's stocks, refresh results. One stream per open tab.
    if (url.pathname === "/api/events" && req.method === "GET") {
      const user = currentUser(); let syms = new Set();
      const loadSyms = async () => { const [stocks, st] = await Promise.all([readWatchlist(), readJson(swingFile(), {})]); syms = new Set([...stocks.filter(x => symOf(x)).map(x => `${x.exchange || "NSE"}:${symOf(x)}`), ...[...(st.positions || []), ...(st.watch || [])].map(x => `${x.exchange || "NSE"}:${x.symbol}`)]); };
      await loadSyms();
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", "X-Accel-Buffering": "no" });
      const send = (event, data) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ } };
      let batch = {}, timer = null;
      const onQuote = (key, q) => {
        if (!syms.has(key)) return;
        batch[key.slice(key.indexOf(":") + 1)] = { price: q.price, asOf: q.asOf || null, source: q.source, prevClose: q.prevClose ?? null };
        if (!timer) timer = setTimeout(() => { timer = null; const b = batch; batch = {}; send("prices", { quotes: b, at: Date.now() }); }, 300);
      };
      const onUser = (uid, event, data) => { if (uid === user.id) { if (event === "symbols") asUser(user, loadSyms).catch(() => {}); else send(event, data); } };
      priceBus.on("quote", onQuote); priceBus.on("user", onUser);
      const hb = setInterval(() => { try { res.write(": keep-alive\n\n"); } catch { /* closed */ } }, 25e3);
      const rs = setInterval(() => asUser(user, loadSyms).catch(() => {}), 60e3);
      send("hello", { marketOpen: marketIsOpen(), intervalSec: PRICE_REFRESH_SEC, symbols: syms.size });
      req.on("close", () => { priceBus.off("quote", onQuote); priceBus.off("user", onUser); clearInterval(hb); clearInterval(rs); clearTimeout(timer); });
      return;
    }
    // Live price for a few stocks right now (Get valuation, opening a stock): the Swing page's path, then saved for every screen
    if (url.pathname === "/api/prices/live" && req.method === "POST") {
      const { symbols } = await readBody(req); const stocks = await readWatchlist();
      const items = (Array.isArray(symbols) ? symbols : []).slice(0, 20).map(s => String(s).toUpperCase()).map(sym => { const x = stocks.find(y => symOf(y) === sym); return { symbol: sym, exchange: x?.exchange || "NSE", last: x?.price }; });
      if (!items.length) return reply(res, 400, { message: "symbols required" });
      const got = await livePrices(items, 20e3, { budgetMs: 8000 });
      await syncLivePrices();
      return reply(res, 200, { prices: Object.fromEntries([...got].filter(([, v]) => !v.stale).map(([k, v]) => [k, { price: v.price, source: v.source, asOf: v.asOf || null }])), pending: got.pending });
    }
    if (url.pathname === "/api/price-compare" && req.method === "GET") {
      // Every source for one symbol, one at a time, ignoring cool-downs: shows exactly what each site answers from this machine.
      const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
      if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return reply(res, 400, { message: "Pass ?symbol=NSE_SYMBOL, for example ?symbol=RELIANCE." });
      const ex = url.searchParams.get("exchange") === "BSE" ? "BSE" : "NSE";
      const timed = async fn => { const t0 = Date.now(); try { const r = await fn(); return { ...r, ms: Date.now() - t0 }; } catch (e) { return { error: errText(e), ms: Date.now() - t0, rateLimited: !!e.rateLimited }; } };
      resetNse(); resetScreener(); resetGoogle();
      const out = { symbol, exchange: ex, at: new Date().toISOString(), order: PRICE_SOURCES, proxy: process.env.HTTPS_PROXY || process.env.https_proxy || null, sources: {} };
      out.sources.nse = ex === "BSE" ? { error: "BSE stock" } : await timed(async () => { const q = await fetchNseQuote(symbol); return { price: q.price, high: q.high52, low: q.low52, source: "NSE" }; });
      out.sources.yahoo = await timed(() => yahooQuote(symbol, ex));
      out.sources.screener = ex === "BSE" ? { error: "BSE stock" } : await timed(() => fetchScreenerPrice({ marketSymbol: symbol }));
      out.sources.google = await timed(() => fetchGoogleQuote(symbol, { exchange: ex === "BSE" ? "BOM" : googleConfig.exchange }));
      out.sources.kite = !KITE_PRICES ? { skipped: "not used for prices (add kite to PRICE_SOURCES to use it)" } : await timed(async () => { const kc = await anyKiteWithSession(); if (!kc) throw new Error("not logged in"); const p = (await kc.ltp([symbol])).get(symbol); if (!p) throw new Error("no LTP returned"); return { price: p, source: "Kite" }; });
      const prices = Object.values(out.sources).map(x => x.price).filter(Number.isFinite);
      out.maxSpreadPct = prices.length > 1 ? Number(((Math.max(...prices) / Math.min(...prices) - 1) * 100).toFixed(2)) : null;
      out.working = Object.entries(out.sources).filter(([, v]) => Number.isFinite(v.price)).map(([k]) => k);
      console.log(`[price-test] ${symbol}: ${Object.entries(out.sources).map(([k, v]) => `${k} ${Number.isFinite(v.price) ? `✓ ₹${v.price}` : v.skipped ? "–" : `✗ ${String(v.error).slice(0, 80)}`} (${v.ms ?? 0} ms)`).join(" | ")}`);
      return reply(res, 200, out);
    }
    if (url.pathname === "/api/debug/log" && req.method === "GET") {
      if (currentUser()?.role !== "owner") return reply(res, 403, { message: "Owner only (the log covers every account)." });
      const f = String(url.searchParams.get("filter") || "").toLowerCase(), n = Math.min(1500, Number(url.searchParams.get("lines")) || 400);
      const lines = DEBUG_LOG.filter(l => !f || l.toLowerCase().includes(f)).slice(-n);
      return reply(res, 200, { lines, total: DEBUG_LOG.length, priceSources: PRICE_SOURCES, node: process.version, marketOpen: marketIsOpen() });
    }
    if (url.pathname === "/api/thesis" && req.method === "GET") return reply(res, 200, await thesisView());
    if (url.pathname === "/api/thesis/save" && req.method === "POST") {
      const body = await readBody(req), symbol = String(body.symbol || "").trim().toUpperCase();
      if (!(await readWatchlist()).some(x => symOf(x) === symbol)) return reply(res, 404, { message: `${symbol || "(none)"} is not in the watchlist.` });
      const store = await readJson(U.thesesFile, {}); let clean;
      try { clean = sanitizeThesis(body, store[symbol]); } catch (error) { return reply(res, 400, { message: error.message }); }
      const prev = store[symbol];
      store[symbol] = { ...(prev || {}), ...clean, createdAt: prev?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
      await writeJson(U.thesesFile, store);
      return reply(res, 200, await thesisView());
    }
    if (url.pathname === "/api/thesis/remove" && req.method === "POST") {
      const { symbol } = await readBody(req), store = await readJson(U.thesesFile, {}), key = String(symbol || "").toUpperCase();
      if (!store[key]) return reply(res, 404, { message: "No thesis for that stock." });
      delete store[key]; await writeJson(U.thesesFile, store);
      return reply(res, 200, await thesisView());
    }
    if (url.pathname === "/api/holdings" && req.method === "GET") return reply(res, 200, await kiteHoldingsView());
    if (url.pathname.startsWith("/api/brokers/")) {
      // Angel One / Dhan / Groww: read-only login, holdings sync and disconnect (brokers.mjs). Secrets stay in .env.
      const fail = e => reply(res, e.setup ? 400 : e.loginRequired || e.authRequired ? 401 : 502, { message: e.message, loginRequired: !!(e.loginRequired || e.authRequired), loginUrl: e.loginUrl || null });
      if (url.pathname === "/api/brokers/mcp/callback" && req.method === "GET") {
        // The broker's OAuth consent page sends you back here; finish the login and tell the user to return to the app.
        const code = url.searchParams.get("code"), state = url.searchParams.get("state"), err = url.searchParams.get("error_description") || url.searchParams.get("error");
        const owner = MCP_BROKERS.map(id => brokerMcp[id]).find(b => b.ownsState(state));
        const page = (ok, msg) => reply(res, ok ? 200 : 400, `<!doctype html><meta charset="utf-8"><title>${ok ? "Connected" : "Login failed"}</title><body style="font:15px system-ui;margin:40px;max-width:560px"><h2>${ok ? "✓ Connected" : "Login did not finish"}</h2><p>${msg.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]))}</p><p>You can close this tab and return to the Integrations tab.</p></body>`, "text/html; charset=utf-8");
        if (err) return page(false, `The broker said: ${err}`);
        if (!owner || !code) return page(false, "This login link is stale or was not started from this app. Press Connect again.");
        try { await owner.finishOAuth({ code, state }); return page(true, `${owner.name} MCP is connected. Press Sync holdings in the ${owner.name} card.`); }
        catch (e) { return page(false, e.message); }
      }
      const mm = url.pathname.match(/^\/api\/brokers\/(angel|dhan|indmoney)\/mcp\/(status|config|connect|disconnect|tools|preview)$/);
      if (mm) {
        const b = brokerMcp[mm[1]], op = mm[2];
        try {
          if (op === "status" && req.method === "GET") return reply(res, 200, await b.status());
          if (op === "tools" && req.method === "GET") return reply(res, 200, { tools: await b.tools() });
          if (op === "preview" && req.method === "GET") return reply(res, 200, await b.preview());
          if (req.method !== "POST") return reply(res, 405, { message: "Use POST." });
          if (op === "config") { const body = await readBody(req); await b.setConfig(body); return reply(res, 200, b.config()); }
          if (op === "connect") return reply(res, 200, await b.connect());
          if (op === "disconnect") { await b.disconnect(); return reply(res, 200, { ok: true }); }
        } catch (e) { return reply(res, e.authRequired || e.loginRequired ? 401 : e.network ? 502 : 400, { message: e.message, loginRequired: !!e.loginRequired, authRequired: !!e.authRequired, loginUrl: e.loginUrl || null }); }
      }
      if (url.pathname === "/api/brokers/status" && req.method === "GET") {
        const list = (await Promise.all(Object.values(brokers).map(c => c.status()))).map(s => brokerMcp[s.id] ? { ...s, mcp: brokerMcp[s.id].config() } : s);
        return reply(res, 200, { brokers: list, readOnlyRoutes: READ_ONLY_ROUTES, accounts: kiteAccountsSummary(await readHoldStore()) });
      }
      const m = url.pathname.match(/^\/api\/brokers\/(angel|dhan|groww|indmoney)\/(login|sync|disconnect|settings)$/);
      if (!m || req.method !== "POST") return reply(res, 404, { message: "Unknown broker operation." });
      const viaMcp = op0 => op0 === "sync" && brokerMcp[m[1]]?.config().via === "mcp";
      const client = viaMcp(m[2]) ? brokerMcp[m[1]] : brokers[m[1]], op = m[2];
      try {
        if (op === "login") return reply(res, 200, await client.login(await readBody(req)));
        if (op === "disconnect") { await client.forget(); return reply(res, 200, { ok: true }); }
        // Saves the details typed on the Integrations tab (data/broker-credentials.json, mode 600), then reports the new
        // status, which logs in by itself when the saved details allow it.
        if (op === "settings") { const body = await readBody(req); await client.saveSettings({ values: body.values || {}, clear: Array.isArray(body.clear) ? body.clear : [] }); return reply(res, 200, await client.status()); }
        const { label } = await readBody(req);
        const profile = await client.profile(); if (!profile?.userId) throw new Error(`${client.name} did not return a client id for this login.`);
        const got = await client.holdings(), priceNote = got.priceNote; let holdings = got.holdings;
        // INDmoney may name a stock without its NSE symbol: match it against the listed-companies list by name.
        let unmatched = [];
        if (got.unresolved?.length) {
          const master = (await scripMaster()).list, norm = x => String(x).toLowerCase().replace(/\b(ltd|limited|the|india|co)\b|[^a-z0-9]/g, "");
          for (const u of got.unresolved) { const hit = searchMaster(master, u.name, 5).find(m => norm(m.name) === norm(u.name)) || searchMaster(master, u.name, 1)[0]; const h = hit && makeHolding({ symbol: hit.symbol, exchange: hit.exchange, isin: u.isin, qty: u.qty, avg: u.avg, last: u.last }); if (h?.qty > 0) holdings.push(h); else unmatched.push(u.name); }
        }
        const key = `${client.id}:${profile.userId}`, store = await readJson(U.kiteHoldingsFile, { accounts: {} }); store.accounts ||= {};
        const prev = store.accounts[key];
        const extra = got.mf || got.us ? { mf: got.mf || [], mfSyncedAt: new Date().toISOString(), us: got.us || [], otherAssets: (got.other || []).slice(0, 50), unmatched } : {};
        store.accounts[key] = { ...extra, broker: client.id, via: viaMcp(op) ? "mcp" : "api", clientId: profile.userId, label: String(label || "").trim().slice(0, 60) || prev?.label || `${client.name} - ${profile.name || profile.userId}`, name: profile.name || null, syncedAt: new Date().toISOString(), priceNote: priceNote || null, holdings };
        await writeJson(U.kiteHoldingsFile, store);
        console.log(`[${client.id}] Synced ${holdings.length} holding(s) for ${profile.userId}${viaMcp(op) ? " via MCP" : ""}.${priceNote ? ` ${priceNote}` : ""}`);
        return reply(res, 200, await kiteHoldingsView());
      } catch (e) { return fail(e); }
    }
    if (url.pathname.startsWith("/api/kite/")) {
      const op = url.pathname.slice("/api/kite/".length);
      const fail = e => reply(res, e.loginRequired ? 401 : 502, { message: e.message, loginRequired: !!e.loginRequired });
      if (op === "slots" && req.method === "GET") {
        const list = await kiteSlotList();
        const slots = await Promise.all(list.map(async sl => { const c = await kiteFor(sl.id); return { ...sl, removable: sl.id !== "main", ...(await c.status()) }; }));
        return reply(res, 200, { slots, enabled: kite.config.enabled });
      }
      if (op === "slots/add" && req.method === "POST") {
        const { label } = await readBody(req); const list = await kiteSlotList();
        if (list.length >= 8) return reply(res, 400, { message: "At most 8 Zerodha accounts." });
        const id = `acct${Date.now().toString(36)}`;
        await writeJson(U.kiteSlotsFile, { slots: [...list.filter(x => x.id !== "main"), { id, label: String(label || "").trim().slice(0, 60) || `Account ${list.length + 1}` }] });
        return reply(res, 200, { ok: true, id });
      }
      if (op === "slots/remove" && req.method === "POST") {
        const { slot } = await readBody(req); if (!slot || slot === "main") return reply(res, 400, { message: "The first account cannot be removed (disconnect it instead)." });
        try { await (await kiteFor(slot)).forget(); } catch {}
        kiteClients.delete(`${currentUser().id}:${slot}`); await fs.rm(userFile(`kite-session-${slot}.json`), { force: true });
        await writeJson(U.kiteSlotsFile, { slots: (await kiteSlotList()).filter(x => x.id !== "main" && x.id !== slot) });
        return reply(res, 200, { ok: true });
      }
      const slotId = url.searchParams.get("slot") || "main";
      let kc; try { kc = await kiteFor(slotId); } catch (e) { return reply(res, 404, { message: e.message }); }
      const slotLabel = (await kiteSlotList()).find(x => x.id === slotId)?.label;
      if (op === "status" && req.method === "GET") return reply(res, 200, { ...(await kc.status()), readOnlyTools: READ_ONLY_TOOLS, accounts: kiteAccountsSummary(await readHoldStore()) });
      if (op === "tools" && req.method === "GET") { try { return reply(res, 200, { tools: await kc.listTools() }); } catch (e) { return fail(e); } }
      if (op === "login" && req.method === "POST") { try { return reply(res, 200, await kc.login()); } catch (e) { return fail(e); } }
      if (op === "diagnose" && req.method === "GET") return reply(res, 200, await kc.diagnose());
      if (op === "disconnect" && req.method === "POST") { await kc.forget(); return reply(res, 200, { ok: true }); }
      if (op === "holdings" && req.method === "GET") return reply(res, 200, await kiteHoldingsView());
      if (op === "sync" && req.method === "POST") {
        // Reads the profile and holdings of the Zerodha account logged in on this slot and stores them, keyed by Kite user id.
        try {
          const { label } = await readBody(req);
          const out = await syncKiteSlot(kc, slotId, slotLabel, label);
          return reply(res, 200, { ...(await kiteHoldingsView()), mfSynced: out.mf.length, mfError: out.mfError });
        } catch (e) { return fail(e); }
      }
      if (op === "remove-account" && req.method === "POST") {
        const { userId } = await readBody(req); const store = await readJson(U.kiteHoldingsFile, { accounts: {} });
        if (!store.accounts?.[userId]) return reply(res, 404, { message: "Unknown account." });
        delete store.accounts[userId]; if (store.hiddenEq) store.hiddenEq = store.hiddenEq.filter(x => x !== userId); await writeJson(U.kiteHoldingsFile, store);
        return reply(res, 200, await kiteHoldingsView());
      }
      return reply(res, 404, { message: "Unknown Kite operation." });
    }
    if (url.pathname === "/api/freshness" && req.method === "GET") return reply(res, 200, await freshnessView());
    if (url.pathname === "/api/backups" && req.method === "GET") { const name = currentUser().username.replace(/[^\w.-]/g, "_"), status = backupState.last || await readJson(path.join(DATA_DIR, "backup-status.json"), null); return reply(res, 200, { list: await listLocal(backupDir(), name), status: status ? { day: status.day, at: status.at, mine: status.accounts.find(a => a.account === currentUser().username) || null, errors: currentUser().role === "owner" ? status.errors : [], s3: status.s3, dir: currentUser().role === "owner" ? status.dir : null, accounts: currentUser().role === "owner" ? status.accounts.length : null } : null, keepDays: backupConfig().keepDays, s3: !!backupConfig().s3, owner: currentUser().role === "owner" }); }
    if (url.pathname === "/api/backups/run" && req.method === "POST") { if (currentUser().role !== "owner") return reply(res, 403, { message: "Owner only." }); return reply(res, 200, await runBackups()); }
    if (url.pathname === "/api/backups/restore" && req.method === "POST") { const { day } = await readBody(req); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day))) return reply(res, 400, { message: "Pick a backup day." }); const name = currentUser().username.replace(/[^\w.-]/g, "_"); let b; try { b = gunz(await readLocal(backupDir(), day, name)); } catch { return reply(res, 404, { message: "No backup of your account for that day." }); } const names = await restoreBackup(b, { replace: true }); console.log(`[backup] ${currentUser().username} restored the automatic backup of ${day}.`); return reply(res, 200, { ok: true, restored: names.length, day }); }
    if (url.pathname === "/api/backup" && req.method === "GET") {
      const b = await makeBackup(url.searchParams.get("secrets") === "1");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="equity-watchlist-${b.account}-${istDay()}.json"` });
      return res.end(JSON.stringify(b, null, 2));
    }
    if (url.pathname === "/api/restore" && req.method === "POST") {
      try { const b = await readBody(req); const names = await restoreBackup(b.backup, { replace: !!b.replace }); console.log(`[backup] ${currentUser().username} restored ${names.length} file(s).`); return reply(res, 200, { ok: true, restored: names }); }
      catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/accumulate")) {
      const op = url.pathname.slice("/api/accumulate".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) return reply(res, 200, await accumulatePage());
        const b = await readBody(req), st = await readJson(accFile(), { baskets: [] }); st.baskets ||= [];
        if (op === "save") { const prev = b.id ? st.baskets.find(x => x.id === b.id) : null; const nb = sanitizeBasket(b, prev); if (!nb.listId && !nb.symbols.length) throw new Error("Add the stocks (or pick a watchlist)."); if (!prev && st.baskets.length >= 10) throw new Error("At most 10 baskets."); st.baskets = prev ? st.baskets.map(x => (x.id === nb.id ? nb : x)) : [...st.baskets, nb]; }
        else if (op === "delete") st.baskets = st.baskets.filter(x => x.id !== b.id);
        else return reply(res, 404, { message: "Unknown operation." });
        await writeJson(accFile(), st); return reply(res, 200, await accumulatePage());
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname === "/api/returns" && req.method === "GET") return reply(res, 200, await returnsPage(String(url.searchParams.get("account") || "all").slice(0, 40)));
    if (url.pathname === "/api/dividend-income" && req.method === "GET") return reply(res, 200, await dividendIncomePage(String(url.searchParams.get("account") || "all").slice(0, 40)));
    if (url.pathname === "/api/share-goals" && req.method === "POST") {
      const { goals } = await readBody(req); if (!Array.isArray(goals) || goals.length > 30) return reply(res, 400, { message: "goals must be a list (30 max)" });
      const clean = goals.map(g => ({ symbol: String(g.symbol || "").toUpperCase().replace(/[^A-Z0-9.&-]/g, "").slice(0, 20), market: g.market === "US" ? "US" : "IN", target: Math.max(1, Math.round(Number(g.target) || 0)), current: Number.isFinite(Number(g.current)) ? Math.max(0, Number(g.current)) : null, note: String(g.note || "").slice(0, 80) })).filter(g => g.symbol && g.target > 0);
      await writeJson(userFile("share-goals.json"), { goals: clean }); return reply(res, 200, { goals: clean });
    }
    if (url.pathname.startsWith("/api/tax")) {
      const op = url.pathname.slice("/api/tax".length).replace(/^\//, "");
      try {
        const acct = String(url.searchParams.get("account") || "all").slice(0, 40);
        if (req.method === "GET" && !op) return reply(res, 200, await taxPage(acct));
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown tax operation." });
        const b = await readBody(req), st = await readJson(taxFile(), { trades: [], imports: [] });
        if (op === "import") {
          let tables;
          if (b.data) { const buf = Buffer.from(String(b.data), "base64"); if (buf.length > 20e6) throw new Error("File is larger than 20 MB."); tables = readSheetFile(buf, b.filename || ""); }
          else tables = [{ rows: parseDelimited(String(b.text || "")) }];
          const parsed = tables.map(t => parseTradebook(t.rows)).sort((a, z) => z.trades.length - a.trades.length)[0];
          if (!parsed?.trades.length) throw new Error(parsed?.note || "No trades found in that file.");
          const tagAs = b.account && b.account !== "all" ? String(b.account).slice(0, 40) : null; // which account (PAN) these trades belong to
          if (tagAs) for (const x of parsed.trades) x.account = tagAs;
          const before = st.trades.length; st.trades = mergeTrades(st.trades, parsed.trades);
          if (st.trades.length > before) st.imports = [...(st.imports || []), { at: new Date().toISOString(), file: String(b.filename || "pasted").slice(0, 80), rows: parsed.trades.length, added: st.trades.length - before, from: parsed.trades[0].date, to: parsed.trades.at(-1).date }].slice(-30);
          if (st.trades.length > 50000) throw new Error("Too many trades (50,000 max).");
          await writeJson(taxFile(), st);
          return reply(res, 200, { ...(await taxPage(tagAs || "all")), imported: { rows: parsed.trades.length, added: st.trades.length - before, skipped: parsed.skipped } });
        }
        if (op === "clear") { await writeJson(taxFile(), { trades: [], imports: [] }); return reply(res, 200, await taxPage()); }
        // older imports had no account: assign them to one
        if (op === "tag") { const to = String(b.account || "").slice(0, 40); if (!to) throw new Error("Pick the account."); let n = 0; for (const x of st.trades) if (!x.account) { x.account = to; n++; } await writeJson(taxFile(), st); return reply(res, 200, { ...(await taxPage(to)), tagged: n }); }
        return reply(res, 404, { message: "Unknown tax operation." });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/model")) {
      try {
        if (req.method === "GET") return reply(res, 200, await modelView(Object.fromEntries(url.searchParams)));
        if (req.method === "POST") return reply(res, 200, await modelView(await readBody(req)));
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/us")) {
      const op = url.pathname.slice("/api/us".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) {
          const mine = (await readJson(usListFile(), { symbols: [] })).symbols || [];
          const which = url.searchParams.get("list") === "popular" ? "popular" : "mine";
          const held = which === "mine" ? (await usHoldingItems().catch(() => [])).map(i => i.symbol).filter(Boolean) : [];
          const symbols = which === "popular" ? US_POPULAR : [...new Set([...mine, ...held])]; // what you hold is valued too
          queueUs(symbols);
          const out = await usRows(symbols);
          return reply(res, 200, { list: which, mine, ...out, pending: out.rows.filter(r => r.pending).length, queue: usQueue.size, secError: usLastError, model: { discount: 9, terminal: 3 } });
        }
        if (req.method === "GET" && op === "search") { let list; try { list = await loadUsTickers(); } catch (e) { return reply(res, 502, { message: `Could not load the SEC ticker list: ${e.message}` }); } return reply(res, 200, { results: searchTickers(list, url.searchParams.get("q"), 10) }); }
        if (req.method === "GET" && op === "stock") {
          const sym = cleanUsSymbol(url.searchParams.get("symbol")); const cache = await readJson(usCacheFile, {}), c = cache[sym];
          if (!c?.series) { queueUs([sym]); return reply(res, 202, { symbol: sym, pending: true, error: c?.error || null }); }
          const ov = (await readJson(usGrowthFile(), {}))[sym] ?? null, { prices } = await usPrices([sym]), p = prices[sym];
          return reply(res, 200, { symbol: sym, name: c.name, cik: c.cik, fetchedAt: c.fetchedAt, price: p?.price ?? null, priceDate: p?.date || null, priceSource: p?.source || null, high52: p?.high52 ?? null, low52: p?.low52 ?? null, valuation: usValuation(c.series, p?.price ?? null, { growth: ov }), years: c.series.years.slice(-6), inList: ((await readJson(usListFile(), { symbols: [] })).symbols || []).includes(sym) });
        }
        if (req.method === "GET" && op === "holdings") return reply(res, 200, await usHoldings());
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown US operation." });
        const b = await readBody(req);
        if (op.startsWith("holdings/")) { // US stocks you hold through Vested / INDmoney / any US broker
          const st = await readJson(otherFile(), {}); st.us ||= [];
          const label = String(b.account || "").replace(/\s+/g, " ").trim().slice(0, 40) || "Vested";
          let notice = null;
          if (op === "holdings/import") {
            let tables = [];
            if (b.data) { const buf = Buffer.from(String(b.data), "base64"); if (buf.length > 10e6) throw new Error("File is larger than 10 MB."); tables = readSheetFile(buf, b.filename || ""); }
            else if (b.text && /[,\t]/.test(String(b.text).split(/\r?\n/)[0] || "") && /qty|quantity|shares|units/i.test(String(b.text).split(/\r?\n/)[0])) tables = [{ rows: parseDelimited(String(b.text)) }];
            const rows = parseUsHoldings(tables, b.data ? "" : String(b.text || ""));
            if (!rows.length) throw new Error("No holdings found. Expected columns like Symbol, Quantity, Average price (USD), or lines like “AAPL 10 150.25”.");
            const now = new Date().toISOString();
            st.us = [...st.us.filter(u => u.account !== label), ...rows.slice(0, 300).map(r => ({ id: crypto.randomUUID().slice(0, 8), source: "import", account: label, ...r, importedAt: now }))];
            notice = `${label}: ${rows.length} US holding${rows.length === 1 ? "" : "s"} imported${rows.some(r => !r.symbol) ? " (some without a ticker: add it with ✎ to price them)" : ""}.`;
          } else if (op === "holdings/save") {
            const sym = cleanUsTicker(b.symbol), qty = Number(b.qty), avg = b.avgUsd === "" || b.avgUsd == null ? null : Number(b.avgUsd), invInr = b.investedInr === "" || b.investedInr == null ? null : Number(String(b.investedInr).replace(/[,₹\s]/g, ""));
            if (!sym) throw new Error("Enter the US ticker (e.g. AAPL)."); if (!(qty > 0)) throw new Error("Enter the number of shares (fractions are fine).");
            if (avg !== null && !(avg > 0)) throw new Error("Average price must be in dollars, above 0."); if (invInr !== null && !(invInr > 0)) throw new Error("Invested in rupees must be above 0.");
            const prev = b.id ? st.us.find(u => u.id === b.id) : null;
            const bought = b.boughtOn ? String(b.boughtOn).slice(0, 10) : prev?.boughtOn || null; if (bought && !/^\d{4}-\d{2}-\d{2}$/.test(bought)) throw new Error("Buy date: YYYY-MM-DD.");
            const row = { id: prev?.id || crypto.randomUUID().slice(0, 8), source: prev?.source || "manual", account: prev?.account || label, symbol: sym, name: String(b.name || "").trim().slice(0, 80) || prev?.name || sym, qty: Math.round(qty * 1e4) / 1e4, avgUsd: avg, investedUsd: avg ? Math.round(avg * qty * 100) / 100 : null, investedInr: invInr, boughtOn: bought, importedAt: new Date().toISOString() };
            st.us = prev ? st.us.map(u => (u.id === prev.id ? row : u)) : [...st.us, row];
          } else if (op === "holdings/delete") {
            // one holding (id), one imported account (account), one synced account (syncId: hidden, the sync keeps them out), or everything (all)
            const before = st.us.length, hid0 = (st.hiddenUs || []).length;
            if (b.all) { st.us = []; const store = await readJson(U.kiteHoldingsFile, { accounts: {} }); st.hiddenUs = [...new Set([...(st.hiddenUs || []), ...Object.entries(store.accounts || {}).filter(([, a]) => (a.us || []).length).map(([id]) => id)])]; }
            else if (b.syncId) st.hiddenUs = [...new Set([...(st.hiddenUs || []), String(b.syncId).slice(0, 80)])];
            else st.us = b.id ? st.us.filter(u => u.id !== b.id) : b.account ? st.us.filter(u => u.account !== b.account) : st.us;
            if (st.us.length === before && (st.hiddenUs || []).length === hid0) throw new Error("Nothing to remove.");
            notice = b.all ? "All US holdings removed." : b.syncId ? "Removed. Its synced US holdings stay out (Show again brings them back)." : b.account ? `${b.account}: all holdings removed.` : null;
          } else if (op === "holdings/date") { // buy date (and ₹ paid) for any holding, synced ones included: used for XIRR
            const key = String(b.key || "").slice(0, 120), d = b.boughtOn ? String(b.boughtOn).slice(0, 10) : null;
            if (!key) throw new Error("Which holding?"); if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error("Buy date: YYYY-MM-DD.");
            st.usDates = { ...(st.usDates || {}) }; if (d) st.usDates[key] = d; else delete st.usDates[key];
            if (key.startsWith("us:") && b.investedInr !== undefined) { const inr = b.investedInr === "" || b.investedInr == null ? null : Number(String(b.investedInr).replace(/[,₹\s]/g, "")); st.us = st.us.map(u => (`us:${u.id}` === key ? { ...u, investedInr: inr > 0 ? inr : null } : u)); }
          } else if (op === "holdings/unhide") {
            st.hiddenUs = (st.hiddenUs || []).filter(x => x !== b.syncId); notice = "Synced US holdings shown again.";
          } else return reply(res, 404, { message: "Unknown US operation." });
          await writeJson(otherFile(), st);
          return reply(res, 200, { ...(await usHoldings()), notice });
        }
        if (op === "list") {
          const st = await readJson(usListFile(), { symbols: [] }); let syms = st.symbols || [];
          const add = (Array.isArray(b.add) ? b.add : []).map(cleanUsSymbol).filter(Boolean), rem = new Set((Array.isArray(b.remove) ? b.remove : []).map(cleanUsSymbol));
          if (add.length) { const list = await loadUsTickers().catch(() => null); if (list) { const known = new Set(list.map(t => t.symbol)); const bad = add.filter(x => !known.has(x)); if (bad.length) throw new Error(`${bad.join(", ")} is not a US SEC-registered ticker.`); } }
          syms = [...new Set([...syms.filter(x => !rem.has(x)), ...add])].slice(0, 200);
          await writeJson(usListFile(), { symbols: syms }); queueUs(add);
          return reply(res, 200, { mine: syms });
        }
        if (op === "growth") {
          const sym = cleanUsSymbol(b.symbol), st = await readJson(usGrowthFile(), {});
          if (b.growth === null || b.growth === "") delete st[sym]; else { const g = Number(b.growth); if (!Number.isFinite(g) || g < -10 || g > 40) throw new Error("Growth must be between -10% and 40% a year."); st[sym] = g; }
          await writeJson(usGrowthFile(), st); return reply(res, 200, { ok: true });
        }
        if (op === "refresh") { const syms = (Array.isArray(b.symbols) ? b.symbols : []).map(cleanUsSymbol).filter(Boolean).slice(0, 60); queueUs(syms, true); await usPrices(syms, true); return reply(res, 200, { queued: syms.length }); }
        return reply(res, 404, { message: "Unknown US operation." });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/swing")) {
      const op = url.pathname.slice("/api/swing".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) return reply(res, 200, await swingView({ fresh: url.searchParams.get("fresh") === "1" }));
        if (req.method === "GET" && op === "summary") { // for the strip on Home
          const st = await readJson(swingFile(), {}); if (!(st.positions || []).length && !(st.watch || []).length) return reply(res, 200, { has: false });
          const v = await swingView(), t = v.totals;
          return reply(res, 200, { has: true, positions: v.positions.length, watch: v.watch.length, takeProfit: t.takeProfit, deploy: t.deploy, deployNow: t.deployNow, near: [...v.positions, ...v.watch].filter(r => /^near/.test(r.status)).length, pnl: t.pnl, pnlPct: t.pnlPct, cash: t.cash, cashShort: t.cashShort, top: [...v.positions, ...v.watch].filter(r => r.status === "take-profit" || r.status === "deploy").slice(0, 3).map(r => ({ symbol: r.symbol, name: r.name, status: r.status, note: r.note })), marketOpen: v.marketOpen });
        }
        if (req.method === "GET" && op === "export.xlsx") return sendSwingExport(res);
        if (req.method === "POST" && op === "tax") { // sell preview / calculator: { id, qty, price, date } or { buyPrice, boughtOn, qty, price, date }
          const b = await readBody(req), st = await readJson(swingFile(), {}), qty = Number(b.qty), price = Number(b.price);
          if (!(qty > 0 && price > 0)) return reply(res, 400, { message: "Enter quantity and price." });
          const p = b.id ? (st.positions || []).find(x => x.id === b.id) : null;
          if (b.id && !p) return reply(res, 404, { message: "That position no longer exists." });
          const lots = p ? lotsForSale(p, Math.min(qty, p.qty)) : [{ qty, price: Number(b.buyPrice), at: b.boughtOn ? tradeDate(b.boughtOn) : new Date().toISOString() }];
          if (!(lots[0]?.price > 0)) return reply(res, 400, { message: "Enter the buy price." });
          const charges = { ...CHARGE_DEFAULTS, ...(st.settings?.charges || {}) };
          return reply(res, 200, sellTaxEstimate({ lots, sellPrice: price, sellDate: b.date ? tradeDate(b.date) : new Date().toISOString(), exchange: p?.exchange || "NSE", ltExemptLeft: b.ltExemptLeft !== undefined ? Number(b.ltExemptLeft) : ltExemptionLeft(st.closed || [], st.settings?.ltUsedElsewhere || 0), charges }));
        }
        // Hold or sell? scenarios for one position: sell now, hold to the ex-date, book part + stop, wait for long-term rates
        if (req.method === "POST" && op === "decide") {
          try { return reply(res, 200, await decideFor(await readBody(req))); } catch (e) { return reply(res, e.status || 400, { message: e.message }); }
        }
        if (op === "ideas" || op === "ideas/scan") {
          if (op === "ideas/scan" && req.method === "POST") { startSwingScan({ force: true }); }
          return reply(res, 200, await swingIdeas());
        }
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown swing operation." });
        const b = await readBody(req), st = await readJson(swingFile(), {}); st.positions ||= []; st.watch ||= []; st.closed ||= [];
        let notice = null; st.positions = dedupePositions(st.positions).list;
        const find = (list, i) => { const x = st[list].find(y => y.id === i); if (!x) throw new Error("That entry no longer exists."); return x; };
        if (op === "position") {
          const prev = b.id ? find("positions", b.id) : null, p = sanitizePosition(b, prev);
          const held = !prev && st.positions.find(x => x.symbol === p.symbol && (x.exchange || "NSE") === p.exchange);
          if (held) { const m = mergePositions(held, p); st.positions = st.positions.map(x => (x.id === held.id ? m : x)); notice = `${p.name}: added to your existing position. Now ${m.qty} shares at an average of ₹${m.avgPrice.toLocaleString("en-IN")}.`; }
          else { if (!prev && st.positions.length >= 100) throw new Error("At most 100 swing positions."); st.positions = prev ? st.positions.map(x => (x.id === p.id ? p : x)) : [...st.positions, p]; }
        }
        else if (op === "watch") { const prev = b.id ? find("watch", b.id) : null; if (!prev && st.watch.length >= 100) throw new Error("At most 100 swing watchlist entries."); const w = sanitizeWatch(b, prev); st.watch = prev ? st.watch.map(x => (x.id === w.id ? w : x)) : [...st.watch, w]; }
        else if (op === "delete") { st.positions = st.positions.filter(x => x.id !== b.id); st.watch = st.watch.filter(x => x.id !== b.id); }
        else if (op === "buy") { const p = find("positions", b.id), q = Number(b.qty), pr = Number(b.price); if (!(q > 0 && Number.isInteger(q) && pr > 0)) throw new Error("Enter whole shares and a price."); const at = tradeDate(b.date); st.positions = st.positions.map(x => (x.id === p.id ? applyBuy(x, q, pr, at) : x)); moveCash(st, -q * pr, `Bought ${q} ${p.symbol} @ ₹${pr} on ${at.slice(0, 10)}`); }
        else if (op === "sell") {
          const p = find("positions", b.id), q = Number(b.qty), pr = Number(b.price);
          const ev0 = evaluateSwing({ positions: [p], prices: new Map([[p.symbol, { price: pr }]]), settings: st.settings || {} }).positions[0];
          const atTarget = pr > 0 && ev0.hitLevel > 0; // sold at or above T1
          const at = tradeDate(b.date), r = applySell(p, q, pr, at, { atTarget }); r.trade.t1Price = ev0.targets?.[0]?.price ?? null; // journal: what selling before T1 left on the table
          if (b.review) r.trade.review = sanitizeReview(b.review); st.positions = r.position ? st.positions.map(x => (x.id === p.id ? r.position : x)) : st.positions.filter(x => x.id !== p.id); st.closed = [r.trade, ...st.closed].slice(0, 500);
          moveCash(st, q * pr, `Sold ${q} ${p.symbol} @ ₹${pr} on ${at.slice(0, 10)}`);
        }
        else if (op === "review") { // journal: what went right or wrong on a closed trade
          const t = st.closed.find(x => x.id === b.id); if (!t) throw new Error("That closed trade no longer exists.");
          t.review = sanitizeReview(b); if (b.setup !== undefined) t.setup = SETUPS[b.setup] ? b.setup : null;
        }
        else if (op === "reopen" || op === "delete-trade") { // undo an accidental sale, or just drop the record
          const t = st.closed.find(x => x.id === b.id); if (!t) throw new Error("That closed trade no longer exists.");
          if (op === "reopen") { if (!st.positions.some(x => x.symbol === t.symbol) && st.positions.length >= 100) throw new Error("At most 100 swing positions."); st.positions = reopenTrade(st.positions, t); moveCash(st, -t.qty * t.sellPrice, `Undid sale of ${t.qty} ${t.symbol}`); }
          st.closed = st.closed.filter(x => x.id !== t.id);
        }
        else if (op === "tax-paid") { // tax you paid on swing profits (advance tax / self-assessment): reduces "tax due"
          st.taxPaid = [...(st.taxPaid || []), sanitizeTaxPayment(b)].slice(-200);
          notice = `Recorded ₹${Math.round(st.taxPaid.at(-1).amount).toLocaleString("en-IN")} tax paid for ${st.taxPaid.at(-1).fy}.`;
        }
        else if (op === "tax-paid-delete") { const n = (st.taxPaid || []).length; st.taxPaid = (st.taxPaid || []).filter(x => x.id !== b.id); if (st.taxPaid.length === n) throw new Error("That payment no longer exists."); }
        else if (op === "lots") { const p = find("positions", b.id); st.positions = st.positions.map(x => (x.id === p.id ? setLots(x, b.lots) : x)); }
        else if (op === "promote") notice = promoteWatch(st, find("watch", b.id), b); // a swing-watchlist stock was bought: move it to positions
        else if (op === "dip-parse") { // buy-the-dip list typed in one go: preview with the symbols found
          const rows = parseDipText(b.text); if (!rows.length) throw new Error('Nothing found. Write it like "TCS below 2100, INFY below 1000".');
          const found = await resolveDipNames(rows.map(r => r.name));
          return reply(res, 200, { rows: rows.map((r, i) => ({ ...r, ...found[i], typed: r.name })) });
        }
        else if (op === "dip-add") { // add (or update the level of) several dip entries at once
          const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 60), def = parseSwingAmount(b.amount);
          let added = 0, updated = 0;
          for (const r of rows) {
            if (!r || !r.symbol) continue;
            const sym = String(r.symbol).toUpperCase(), lvl = Number(r.buyBelow);
            // same stock at (about) the same level: update it; a different level is a second rung of the ladder
            const ex = st.watch.find(x => x.list === "dip" && x.symbol === sym && Math.abs(x.buyBelow / lvl - 1) < 0.005);
            if (!ex && st.watch.length >= 100) throw new Error("At most 100 swing watchlist entries.");
            const w = sanitizeWatch({ symbol: sym, name: r.name, exchange: r.exchange, list: "dip", buyBelow: r.buyBelow, amount: r.amount ?? def, stopLoss: r.stopLoss ?? null, notes: r.notes }, ex);
            st.watch = ex ? st.watch.map(x => (x.id === w.id ? w : x)) : [...st.watch, w]; ex ? updated++ : added++;
          }
          if (!added && !updated) throw new Error("Pick at least one stock.");
          notice = `Buy-the-dip list: ${added} added${updated ? `, ${updated} updated` : ""}. You get an alert when each reaches its price.`;
        }
        else if (op === "bulk-buy") { // bought several dips together: each becomes a swing position (or adds to one)
          const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60), done = [];
          for (const it of items) {
            const q = Number(it.qty), pr = Number(it.price); if (!(q > 0) || !(pr > 0)) continue;
            if (!Number.isInteger(q)) throw new Error("Whole shares only.");
            const w = find("watch", it.id); promoteWatch(st, w, { qty: q, price: pr, date: b.date, keep: !!b.keep, setup: w.list === "dip" ? "dip" : undefined }); done.push(`${q} ${w.symbol}`);
          }
          if (!done.length) throw new Error("Enter a quantity and price for at least one stock.");
          notice = `Recorded ${done.length} buy${done.length === 1 ? "" : "s"}: ${done.join(", ")}.${b.keep ? " Their dip levels stay on the list." : ""}`;
        }
        else if (op === "settings") {
          const t = parseTargets(b.targets ?? b.targetPct), d = Number(b.dipPct), plan = b.bookPlan === undefined ? st.settings?.bookPlan ?? null : parseBookPlan(b.bookPlan);
          if (!t) throw new Error("Enter at least T1."); if (!(d > 0 && d <= 90)) throw new Error("Dip must be 1–90%.");
          const riskPct = b.riskPct === undefined || b.riskPct === "" ? st.settings?.riskPct ?? 1 : Number(b.riskPct), perTrade = b.perTrade === undefined || b.perTrade === "" ? st.settings?.perTrade ?? 200000 : parseSwingAmount(b.perTrade);
          if (!(riskPct > 0 && riskPct <= 10)) throw new Error("Risk per trade: 0.1–10% of your swing cash."); if (!(perTrade > 0)) throw new Error("Max per trade: enter an amount like 2L.");
          const chg = { ...(st.settings?.charges || {}) };
          for (const [k, lim] of [["dpPerSale", 100], ["txnPctNse", 0.1], ["sttPct", 1], ["cessPct", 10]]) if (b[k] !== undefined && b[k] !== "") { const v = Number(b[k]); if (!(v >= 0 && v <= lim)) throw new Error(`${k}: 0–${lim}`); chg[k] = v; }
          const ltUsed = b.ltUsedElsewhere === undefined || b.ltUsedElsewhere === "" ? st.settings?.ltUsedElsewhere || 0 : parseSwingAmount(b.ltUsedElsewhere);
          const slab = b.slabPct === undefined || b.slabPct === "" ? st.settings?.slabPct ?? 30 : Number(b.slabPct); if (!(slab >= 0 && slab <= 42.74)) throw new Error("Income-tax slab: 0–42.74%.");
          st.settings = { targets: t, dipPct: d, riskPct, perTrade, charges: chg, ltUsedElsewhere: ltUsed || 0, slabPct: slab, ...(plan ? { bookPlan: plan } : {}) };
          if (b.cash !== undefined) { // cash set aside for swing: blank stops tracking it
            const c = String(b.cash).trim() === "" ? null : parseSwingAmount(b.cash);
            if (String(b.cash).trim() !== "" && c === null) throw new Error("Cash: enter an amount like 5L or 250000.");
            if (c === null) st.cash = null;
            else if (c !== st.cash?.balance) { const at = new Date().toISOString(); st.cash = { balance: c, setAt: at, log: [{ at, amount: null, why: "Set by you", balance: c }, ...(st.cash?.log || [])].slice(0, 60) }; }
          }
        }
        else if (op === "parse") { const rows = parseSheet(b.text).slice(0, 100); const found = await resolveNames(rows.map(r => r.name)); return reply(res, 200, { rows: rows.map((r, i) => ({ ...r, ...found[i], sheetName: r.name })) }); }
        else if (op === "import") {
          for (const r of Array.isArray(b.rows) ? b.rows.slice(0, 100) : []) {
            if (r.kind === "position") { const ex = st.positions.find(x => x.symbol === String(r.symbol).toUpperCase()); const p = sanitizePosition({ ...r, addBelow: r.addBelow, addAmount: r.addAmount }, ex); st.positions = ex ? st.positions.map(x => (x.id === p.id ? p : x)) : [...st.positions, p]; }
            else { const ex = st.watch.find(x => x.symbol === String(r.symbol).toUpperCase() && x.list !== "dip"); const w = sanitizeWatch({ ...r, buyBelow: r.addBelow ?? r.buyBelow, amount: r.addAmount ?? r.amount }, ex); st.watch = ex ? st.watch.map(x => (x.id === w.id ? w : x)) : [...st.watch, w]; }
          }
        }
        else if (op === "resolve") return reply(res, 200, { results: await resolveNames([String(b.name || "")]) });
        else return reply(res, 404, { message: "Unknown swing operation." });
        await writeJson(swingFile(), st); notifyUser(currentUser().id, "symbols"); // the page's live stream now follows a new position too
        return reply(res, 200, { ...(await swingView()), ...(notice ? { notice } : {}) });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname === "/api/indices" || url.pathname.startsWith("/api/indices/")) { // Smart indices
      const op = url.pathname.slice("/api/indices".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) return reply(res, 200, await indicesHome());
        if (req.method === "GET" && op === "view") return reply(res, 200, await indexView(String(url.searchParams.get("name") || "NIFTY 50").slice(0, 80), { force: url.searchParams.get("fresh") === "1" }));
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown index operation." });
        const b = await readBody(req);
        if (op === "value") { const v = await indexView(String(b.name || "").slice(0, 80)); if (!v.rows.length) throw new Error("The index list has not loaded yet."); return reply(res, 200, { valueJob: startIndexValuation(v) }); }
        if (op === "add") { // add several index stocks to the watchlist (and a list), then value the new ones in the background
          const syms = (Array.isArray(b.symbols) ? b.symbols : []).map(x => String(x).toUpperCase()).filter(x => /^[A-Z0-9&-]{1,20}$/.test(x)).slice(0, 100);
          if (!syms.length) throw new Error("Pick at least one stock.");
          const names = b.names && typeof b.names === "object" ? b.names : {};
          const stocks = await readWatchlist(), have = new Set(stocks.map(symOf)), fresh = syms.filter(x => !have.has(x));
          let id = Math.max(0, ...stocks.map(s => Number(s.id) || 0));
          const added = fresh.map(sym => ({ id: ++id, company: String(names[sym] || sym).slice(0, 80), ticker: sym, marketSymbol: sym, bucket: "Growth", action: "Watch", note: b.from ? `From ${String(b.from).slice(0, 60)}` : "", exchange: "NSE" }));
          if (added.length) await persistWatchlist([...stocks, ...added], stocks);
          await addToList(b.list || DEFAULT_ID, syms);
          const fund = await readFundamentals(), need = added.filter(st => !fund[st.marketSymbol]);
          if (need.length) (async () => { for (const st of need) { try { const [r] = await runFundamentalsFetch([st], false); if (r?.rateLimited) break; } catch { /* next */ } } })();
          return reply(res, 200, { added: added.length, already: syms.length - added.length, valuing: need.length });
        }
        if (op === "import") { // the constituents CSV from niftyindices.com, when NSE's live data is blocked
          const name = String(b.name || "").slice(0, 80), rows = parseIndexCsv(String(b.csv || "").slice(0, 400000));
          if (!name || !rows.length) throw new Error("Choose the index and its constituents CSV (from niftyindices.com: Company Name, Industry, Symbol, Series, ISIN Code).");
          const filled = await priceIndexRows(rows);
          const st = await idxStore(); st.lists[normIndex(name)] = { name, index: null, rows: filled, source: "Imported file + daily closes", at: Date.now() }; await writeJson(indexCacheFile, st);
          return reply(res, 200, await indexView(name));
        }
        return reply(res, 404, { message: "Unknown index operation." });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname === "/api/favourites" || url.pathname === "/api/favourites/view") { // ❤ favourites
      try {
        if (req.method === "GET" && url.pathname === "/api/favourites") return reply(res, 200, { symbols: (await readJson(favFile(), { symbols: [] })).symbols || [] });
        if (req.method === "GET") return reply(res, 200, await favouritesView());
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown favourites operation." });
        const b = await readBody(req), sym = String(b.symbol || "").trim().toUpperCase();
        if (!/^[A-Z0-9&.-]{1,20}$/.test(sym)) throw new Error("Which stock?");
        const st = await readJson(favFile(), { symbols: [] }); let list = (st.symbols || []).filter(x => x !== sym);
        if (b.on !== false) { if (list.length >= 200) throw new Error("At most 200 favourites."); list = [sym, ...list]; }
        await writeJson(favFile(), { symbols: list });
        return reply(res, 200, { symbols: list });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/ai/")) { // Ask AI
      const op = url.pathname.slice("/api/ai/".length);
      try {
        if (req.method === "GET" && op === "status") return reply(res, 200, await aiStatus());
        if (req.method === "GET" && op === "preview") { const st = await aiSettings(), privacy = AI_PRIVACY[url.searchParams.get("privacy")] ? url.searchParams.get("privacy") : st.privacy, text = buildContext(await aiSnapshot(), { privacy }); return reply(res, 200, { privacy, text, chars: text.length, approxTokens: Math.round(text.length / 3.5) }); }
        if (req.method === "GET" && op === "chats") return reply(res, 200, await readJson(aiChatsFile(), { chats: [] }));
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown AI operation." });
        const b = await readBody(req);
        if (op === "chat") return aiChat(req, res, b);
        if (op === "settings") {
          const cur = await readJson(aiFile(), {}), next = { ...cur };
          if (b.model !== undefined) { const m = String(b.model).trim(); if (!/^claude-[a-z0-9.-]{3,60}$/.test(m)) throw new Error("Pick a Claude model."); next.model = m; }
          if (b.privacy !== undefined) { if (!AI_PRIVACY[b.privacy]) throw new Error("Unknown privacy setting."); next.privacy = b.privacy; }
          if (b.monthlyTokens !== undefined) { const n = Math.round(Number(String(b.monthlyTokens).replace(/[,\s]/g, ""))); if (!(n >= 10000 && n <= 1e9)) throw new Error("Monthly limit: between 10,000 and 1,000,000,000 tokens."); next.monthlyTokens = n; }
          await writeJson(aiFile(), next); return reply(res, 200, await aiStatus());
        }
        if (op === "key") {
          if (b.remove) { await writeJson(aiKeyFile(), {}); return reply(res, 200, await aiStatus()); }
          const key = String(b.key || "").trim(); if (!looksLikeKey(key)) throw new Error("That does not look like an Anthropic API key (it starts with sk-ant-).");
          // check it with the smallest possible request before saving
          const st = await aiSettings();
          const r = await fetch(`${ANTHROPIC_BASE()}/v1/messages`, { method: "POST", signal: AbortSignal.timeout(20000), headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: st.model, max_tokens: 1, messages: [{ role: "user", content: "ping" }] }) }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
          if (!r.ok && r.status !== 429 && r.status !== 529) throw new Error(r.status ? friendlyApiError(r.status, await r.json().catch(() => ({}))) : "Could not reach Anthropic to check the key.");
          await writeJson(aiKeyFile(), sealKey(key, await aiSecret()));
          return reply(res, 200, { ...(await aiStatus()), notice: "Key saved (encrypted on this server)." });
        }
        if (op === "chats/delete") { const c = await readJson(aiChatsFile(), { chats: [] }); c.chats = b.all ? [] : c.chats.filter(x => x.id !== b.id); await writeJson(aiChatsFile(), c); return reply(res, 200, c); }
        return reply(res, 404, { message: "Unknown AI operation." });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname === "/api/mf" || url.pathname.startsWith("/api/mf/")) { // mutual funds outside Zerodha Coin: CAS / CSV import, by hand
      const op = url.pathname.slice("/api/mf".length).replace(/^\//, "");
      try {
        const view = async notice => {
          const all = await syncedMutualFunds(), amfi = amfiMem?.at ? amfiMem : null, dups = (await importedFunds()).filter(f => f.duplicate);
          const priced = all.filter(f => Number.isFinite(f.value)), withCost = priced.filter(f => Number.isFinite(f.invested));
          const sum = (arr, k) => Math.round(arr.reduce((a, f) => a + (f[k] || 0), 0));
          return { funds: all, duplicates: dups.map(f => ({ id: f.id, name: f.name, folio: f.folio })), totals: { value: sum(priced, "value"), invested: sum(withCost, "invested"), pnl: sum(withCost, "value") - sum(withCost, "invested"), count: all.length }, amfiAt: amfi?.at || null, ...(notice ? { notice } : {}) };
        };
        if (req.method === "GET" && !op) return reply(res, 200, await view());
        if (req.method === "GET" && op === "search") return reply(res, 200, { results: searchAmfi(await amfiNav({ wait: true }), url.searchParams.get("q"), 12) });
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown mutual fund operation." });
        const b = await readBody(req), st = await readJson(otherFile(), {}); st.mf ||= [];
        let notice = null; const now = new Date().toISOString();
        if (op === "import") {
          let funds = [], source = "csv", statementTo = null;
          const buf = b.data ? Buffer.from(String(b.data), "base64") : null; if (buf && buf.length > 20e6) throw new Error("File is larger than 20 MB.");
          if (buf && buf.subarray(0, 5).toString("latin1") === "%PDF-") {
            try { const r = parseCas(await pdfLines(buf, String(b.password || "").trim())); funds = r.funds; statementTo = r.statementTo; source = "cas"; }
            catch (e) { if (e.needPassword) return reply(res, 400, { message: e.message, needPassword: true }); throw e; }
            if (!funds.length) throw new Error("No fund balances found in that PDF. Use the CAMS / KFintech Consolidated Account Statement (CAS), detailed or summary.");
          } else {
            const tables = buf ? (readSheetFile(buf, b.filename || "")) : [{ rows: parseDelimited(String(b.text || "")) }];
            const rows = parseMfRows(tables, buf ? "" : String(b.text || "")); if (!rows.length) throw new Error("No funds found. Expected columns like Scheme name (or ISIN), Units, Invested.");
            const amfi = await amfiNav({ wait: true });
            funds = rows.map(r => { const isin = r.isin || searchAmfi(amfi, r.name, 1)[0]?.isin || null; return { isin, name: r.name || amfi[isin]?.[3] || isin, folio: r.folio, units: r.units, cost: r.cost, nav: null, navDate: null, value: null }; });
          }
          const newIds = new Set(), keep = st.mf.filter(f => source === "cas" ? f.source !== "cas" : true); // a new CAS replaces the last one (it is the full picture)
          for (const f of funds) {
            const ex = keep.find(x => x.isin && x.isin === f.isin && (x.folio || "") === (f.folio || "") && x.source !== "manual");
            const row = { id: ex?.id || crypto.randomUUID().slice(0, 8), source, isin: f.isin, name: f.name, amc: f.amc || null, folio: f.folio || null, units: f.units, cost: f.cost ?? null, nav: f.nav ?? null, navDate: f.navDate || null, value: f.value ?? null, registrar: f.registrar || null, importedAt: now, statementTo };
            if (ex) Object.assign(ex, row); else keep.push(row);
            newIds.add(row.id);
          }
          st.mf = keep.slice(0, 300);
          await writeJson(otherFile(), st);
          const v = await view(), dup = v.duplicates.filter(d => newIds.has(d.id)).length;
          notice = `${funds.length} fund${funds.length === 1 ? "" : "s"} imported${source === "cas" ? " from your CAS" : ""}.${dup ? ` ${dup === 1 ? "One is" : `${dup} are`} already in a broker sync (Zerodha / INDmoney), so ${dup === 1 ? "it is" : "they are"} counted once.` : ""}`;
          return reply(res, 200, { ...v, notice });
        }
        if (op === "save") { // add or edit one fund by hand
          const amfi = await amfiNav({ wait: true }), isin = String(b.isin || "").trim().toUpperCase();
          if (!/^INF[0-9A-Z]{9}$/.test(isin)) throw new Error("Pick the fund from the list (so its NAV can be updated every day).");
          const units = Number(String(b.units ?? "").replace(/,/g, "")), cost = b.cost === "" || b.cost == null ? null : Number(String(b.cost).replace(/[,₹\s]/g, ""));
          if (!(units > 0)) throw new Error("Enter the units you hold (from the fund's statement or app)."); if (cost !== null && !(cost > 0)) throw new Error("Invested amount must be above 0.");
          const prev = b.id ? st.mf.find(f => f.id === b.id) : null;
          const row = { id: prev?.id || crypto.randomUUID().slice(0, 8), source: prev?.source || "manual", isin, name: amfi[isin]?.[3] || String(b.name || "").slice(0, 120) || isin, amc: amfi[isin]?.[4] || null, folio: String(b.folio || "").trim().slice(0, 30) || null, units: Math.round(units * 1e4) / 1e4, cost, nav: null, navDate: null, value: null, importedAt: now };
          st.mf = prev ? st.mf.map(f => (f.id === prev.id ? row : f)) : [...st.mf, row];
        } else if (op === "delete") {
          const before = st.mf.length; st.mf = b.id ? st.mf.filter(f => f.id !== b.id) : b.source ? st.mf.filter(f => f.source !== b.source) : st.mf;
          if (st.mf.length === before) throw new Error("Nothing to remove (funds from a broker sync go away when you disconnect it).");
        } else return reply(res, 404, { message: "Unknown mutual fund operation." });
        await writeJson(otherFile(), st);
        return reply(res, 200, await view(notice));
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/networth")) {
      const op = url.pathname.slice("/api/networth".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) return reply(res, 200, await networthView());
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown net worth operation." });
        const b = await readBody(req), st = await readJson(networthFile(), {}); st.items = Array.isArray(st.items) ? st.items : [];
        if (op === "item") {
          const prev = b.id ? st.items.find(i => i.id === b.id) : null;
          if (b.id && !prev) return reply(res, 404, { message: "That entry no longer exists." });
          if (!prev && st.items.length >= 500) throw new Error("At most 500 entries.");
          const item = sanitizeItem(b, prev);
          st.items = prev ? st.items.map(i => (i.id === prev.id ? item : i)) : [...st.items, item];
        } else if (op === "delete") {
          st.items = st.items.filter(i => i.id !== b.id);
        } else if (op === "goal") {
          st.goals = Array.isArray(st.goals) ? st.goals : [];
          const prev = b.id ? st.goals.find(g => g.id === b.id) : null;
          if (!prev && st.goals.length >= 10) throw new Error("At most 10 goals.");
          const g = sanitizeNwGoal(b, prev, istDay());
          st.goals = prev ? st.goals.map(x => (x.id === prev.id ? g : x)) : [...st.goals, g];
        } else if (op === "goal-delete") {
          st.goals = (st.goals || []).filter(g => g.id !== b.id);
        } else if (op === "link") {
          // Link a synced fund to an X-ray portfolio (null = "not linked", so auto-matching stops guessing).
          if (!/^[\w.-]+(:[\w.-]+)?:[A-Z0-9:]+:[\w /-]*$/i.test(String(b.key || "")) || String(b.key).length > 160) throw new Error("Unknown fund.");
          st.links = { ...(st.links || {}), [b.key]: b.fundId ? String(b.fundId).slice(0, 40) : null };
        } else if (op === "sync") {
          // Pull stocks + mutual funds again from every Zerodha account that is logged in.
          const done = [], failed = [];
          for (const sl of await kiteSlotList()) {
            const c = await kiteFor(sl.id); if (!c.config.enabled || !(await c.hasSession())) continue;
            try { const x = await syncKiteSlot(c, sl.id, sl.label); done.push({ account: x.profile.userId, mf: x.mf.length, mfError: x.mfError }); }
            catch (e) { failed.push({ slot: sl.label, error: e.loginRequired ? "Kite login expired: log in again on Connect brokers." : String(e.message).slice(0, 160) }); }
          }
          if (!done.length && !failed.length) return reply(res, 400, { message: "No Zerodha account is logged in. Connect Kite on Connect brokers first." });
          return reply(res, 200, { ...(await networthView()), synced: done, failed });
        } else return reply(res, 404, { message: "Unknown net worth operation." });
        await writeJson(networthFile(), st);
        return reply(res, 200, await networthView());
      } catch (e) { return reply(res, e.loginRequired ? 401 : 400, { message: e.message }); }
    }
    if (url.pathname === "/api/diagnose" && req.method === "GET") {
      // One probe each, ignoring cooldowns, so you can see exactly what Yahoo and NSE answer from THIS machine/network.
      const probe = async (u, h) => { try { const r = await fetch(u, { headers: h, signal: AbortSignal.timeout(12000) }); return { status: r.status, ok: r.ok }; } catch (e) { return { error: e.message }; } };
      const ua = { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36" };
      return reply(res, 200, { googleFinance: await probe("https://www.google.com/finance/quote/TCS:NSE?hl=en", { ...ua, Accept: "text/html" }), kiteMcp: kite.config.enabled ? await probe(kite.config.url, { Accept: "text/event-stream" }) : "disabled (KITE_MCP_ENABLED=0 in .env)", googleCooldownUntil: googleCooldown() || null, yahooChart: await probe("https://query1.finance.yahoo.com/v8/finance/chart/TCS.NS?range=5d&interval=1d", ua), yahooCrumbHost: await probe("https://fc.yahoo.com", ua), nseHome: await probe("https://www.nseindia.com", { ...ua, Accept: "text/html" }), screenerHome: await probe("https://www.screener.in/company/TCS/consolidated/", { ...ua, Accept: "text/html" }), angelOneApi: await probe("https://apiconnect.angelone.in", ua), dhanApi: await probe("https://api.dhan.co/v2/profile", ua), growwApi: await probe("https://api.groww.in/v1/user/detail", ua), yahooCooldownUntil: yahooCooldown() || null, nseCooldownUntil: nseCooldown() || null, hint: "429 = this IP is throttled (wait, or switch network/hotspot/VPN). 403 = blocked as a bot. error = no internet/DNS/proxy." });
    }
    if (url.pathname === "/api/custom-list") {
      // Your own wishlist of up to 10 watchlist stocks (by NSE symbol).
      if (req.method === "GET") return reply(res, 200, { symbols: (await readJson(U.customListFile, { symbols: [] })).symbols || [] });
      if (req.method === "POST") {
        const { symbols } = await readBody(req);
        if (!Array.isArray(symbols)) return reply(res, 400, { message: "symbols must be an array" });
        const known = new Set((await readWatchlist()).map(symOf));
        const clean = [...new Set(symbols.map(x => String(x).trim().toUpperCase()))].filter(x => known.has(x)).slice(0, 10);
        await writeJson(U.customListFile, { symbols: clean });
        return reply(res, 200, { symbols: clean });
      }
    }
    if (url.pathname === "/api/stocks" && req.method === "GET") return reply(res, 200, { stocks: (await syncLivePrices()).stocks });
    if (url.pathname === "/api/history" && req.method === "GET") {
      const history = await readHistory();
      const id = url.searchParams.get("id");
      if (id) return reply(res, 200, { changes: history.changes.filter(c => String(c.id) === id), priceSeries: history.priceSeries[id] || [] });
      return reply(res, 200, history);
    }
    if (url.pathname === "/api/watchlist" && req.method === "POST") { let { stocks } = await readBody(req); if (!Array.isArray(stocks)) return reply(res, 400, { message: "stocks must be an array" }); stocks = keepNewerPrices(stocks, await readWatchlist()); await persistWatchlist(stocks); try { const st = await readLists(); await writeJson(U.listsFile, prune(st, stocks.map(symOf))); } catch {} return reply(res, 200, { ok: true, count: stocks.length }); }
    if (url.pathname === "/api/refresh" && req.method === "POST") { const { stocks } = await readBody(req); const saved = await readWatchlist(); const target = Array.isArray(stocks) && stocks.length ? keepNewerPrices(stocks, saved) : saved; if (!target.length) return reply(res, 400, { message: "Watchlist is empty. Open the app once to publish it." }); const refreshed = await refreshWatchlist(target, true); return reply(res, 200, { ok: true, stocks: refreshed, refreshed: refreshed.filter(s => s.feedStatus === "Price refreshed").length }); }
    if (url.pathname === "/api/valuation" && req.method === "GET") {
      const { fundamentals, rows } = await computeRows();
      // the daily verdict log and alert checks run after the answer is sent, not in the page's way
      const u = currentUser(); setImmediate(() => asUser(u, async () => { await logVerdicts(rows); await runAlerts(rows); }).catch(() => {}));
      return reply(res, 200, { model: MODEL, rows, fundamentalsCount: Object.keys(fundamentals).length });
    }
    if (url.pathname === "/api/fundamentals/refresh-all" && req.method === "POST") {
      if (job.running) return reply(res, 409, { message: "A refresh is already running.", job: { ...job } });
      const { force = false, source = "auto" } = await readBody(req);
      const stocks = (await readWatchlist()).filter(s => symOf(s));
      runJob(stocks, !!force, ["screener", "yahoo", "nse"].includes(source) ? source : "auto").catch(e => { job.running = false; job.note = `Job crashed: ${e.message}`; });
      return reply(res, 200, { started: true, total: stocks.length });
    }
    if (url.pathname === "/api/fundamentals/job" && req.method === "GET") return reply(res, 200, { ...job });
    if (url.pathname === "/api/fundamentals/job/cancel" && req.method === "POST") { job.cancel = true; return reply(res, 200, { ok: true }); }
    if (url.pathname === "/api/fundamentals/fetch" && req.method === "POST") {
      // Body: { ids: number[], force?: boolean }. Free sources only: Yahoo Finance + NSE quote API. Max 10 per call.
      const { ids, force = false, source = "auto" } = await readBody(req);
      const stocks = await readWatchlist();
      const targets = (Array.isArray(ids) && ids.length ? stocks.filter(s => ids.includes(s.id)) : []).slice(0, 10);
      if (!targets.length) return reply(res, 400, { message: "No matching stocks (max 10 per call)." });
      console.log(`[fundamentals] Fetching ${targets.length} stock(s).`);
      const [results] = await Promise.all([runFundamentalsFetch(targets, force, ["screener", "yahoo", "nse"].includes(source) ? source : "auto"),
        // and the live price at the same time, on the Swing page's path, so the valuation uses today's price
        livePrices(targets.filter(t => symOf(t)).map(t => ({ symbol: symOf(t), exchange: t.exchange || "NSE", last: t.price })), 20e3, { budgetMs: 8000 }).catch(() => null)]);
      await syncLivePrices().catch(() => {});
      // Rate-limited: keep the stock and try again by itself in 20 minutes (the timer keeps this user's context).
      const limited = results.filter(r => r.rateLimited || r.retryLater).map(r => targets.find(t => t.company === r.company)).filter(Boolean).map(symOf);
      if (limited.length) setTimeout(() => queueFill(limited).catch(() => {}), 20 * 60e3).unref();
      return reply(res, 200, { results, saved: results.filter(r => r.entry).length, retryInMin: limited.length ? 20 : null });
    }
    if (url.pathname === "/api/valuation/performance" && req.method === "GET") return reply(res, 200, performance(await readJson(U.valuationLogFile, {}), Number(url.searchParams.get("minDays")) || 14));
    if (url.pathname === "/api/compare" && req.method === "GET") { const ref = await readJson(referenceFile, { reference: {} }); return reply(res, 200, { ...compare(await readFundamentals(), ref.reference || {}), referenceAsOf: ref.asOf || null }); }
    if (url.pathname.startsWith("/api/funds")) {
      const op = url.pathname.slice("/api/funds".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) {
          const st = await readJson(U.fundsFile, { funds: [] }); refreshStaleXray(st.funds);
          const held = await syncedMutualFunds().catch(() => []), missing = held.filter(f => !f.fundId);
          return reply(res, 200, { funds: st.funds.map(f => ({ id: f.id, name: f.name, asOf: f.asOf, count: f.holdings.length, updatedAt: f.updatedAt, source: f.source ? { kind: f.source.kind, url: f.source.url, link: f.source.link || null } : null, ageDays: Math.floor((Date.now() - Date.parse(f.updatedAt || 0)) / 864e5) })),
            heldWithout: missing.map(f => ({ name: f.name, isin: f.isin })).slice(0, 40), job: XJ() });
        }
        if (req.method === "GET" && op === "search") return reply(res, 200, { results: searchAmfi(await amfiNav({ wait: true }), url.searchParams.get("q"), 10) });
        if (req.method === "GET" && op === "view") {
          const st = await readJson(U.fundsFile, { funds: [] }), f = st.funds.find(x => x.id === url.searchParams.get("id"));
          if (!f) return reply(res, 404, { message: "Unknown fund." });
          const [{ rows }, view] = await Promise.all([computeRows(), kiteHoldingsView()]);
          const bySym = Object.fromEntries(rows.map(r => [String(r.symbol).toUpperCase(), r])), mine = new Map(view.holdings.map(h => [h.symbol, h.weightPct || 0]));
          const missing = f.holdings.filter(h => !h.symbol).length, fixing = missing > 0 && fixFundSymbols(f.id);
          const holdings = f.holdings.map(h => { const r = h.symbol ? bySym[h.symbol] : null; return { ...h, held: mine.has(h.symbol), pe: r?.pe ?? null, sectorPe: r?.sectorPe ?? r?.sectorPeEst ?? null, sectorPeEst: !r?.sectorPe && !!r?.sectorPeEst, view: r && Number.isFinite(r.ratio) ? r.view : null, verdict: r?.verdict?.label || null, verdictCls: r?.verdict?.cls || null, verdictKey: r?.verdict?.key || null, growth: r?.growthLens ? { verdict: r.growthLens.verdict, key: r.growthLens.key, growth: r.growthLens.growth, implied: r.growthLens.impliedGrowth } : null, roce: r ? (r.profile === "financial" ? r.roe : r.roce) : null, valued: !!(r && Number.isFinite(r.ratio)) }; });
          return reply(res, 200, { fund: { id: f.id, name: f.name, asOf: f.asOf, updatedAt: f.updatedAt }, holdings, summary: fundSummary(f.holdings, bySym, mine), pending: holdings.filter(h => h.symbol && !h.valued).length, missing, matching: !!fixing || fundFixRunning(f.id) });
        }
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown fund operation." });
        const b = await readBody(req);
        if (op === "parse") {
          let tables;
          if (b.data) { const buf = Buffer.from(String(b.data), "base64"); if (buf.length > 15e6) throw new Error("File is larger than 15 MB."); tables = readSheetFile(buf, b.filename || ""); }
          else tables = [{ name: "Pasted table", rows: parseDelimited(b.text || "") }];
          const found = tables.map(t => { const x = extractHoldings(t.rows), info = sheetInfo(t.rows, t.name); return { sheet: t.name, title: info.title, asOf: info.asOf, holdings: x.holdings, note: x.note }; }).filter(t => t.holdings.length >= 3).sort((a, z) => z.holdings.length - a.holdings.length);
          if (!found.length) return reply(res, 400, { message: "No equity holdings table found. Use the AMC's monthly portfolio file (Excel), or copy the holdings table (company name and % of net assets) from Value Research or Moneycontrol and paste it." });
          return reply(res, 200, { tables: found.slice(0, 40) });
        }
        if (op === "auto") { const r = await autoFetchFund({ id: b.id || null, name: String(b.name || "").slice(0, 160), isin: String(b.isin || "").toUpperCase(), link: b.link ? String(b.link).slice(0, 600) : null }); return r.ok ? reply(res, 200, r) : reply(res, 422, { message: `Could not fetch the holdings of ${r.name || "this fund"} automatically.`, tried: r.tried }); }
        if (op === "auto-all") return reply(res, 200, { job: startXrayAll() });
        if (op === "resolve") { const items = (Array.isArray(b.items) ? b.items : []).slice(0, 15).map(i => ({ name: String(i.name || "").slice(0, 120), isin: /^INE[A-Z0-9]{9}$/.test(i.isin || "") ? i.isin : null })); return reply(res, 200, { results: await resolveHoldingSymbols(items, { searchBudget: 6 }) }); }
        if (op === "save") {
          const name = String(b.name || "").trim().slice(0, 80); if (!name) throw new Error("Give the fund a name.");
          const holdings = (Array.isArray(b.holdings) ? b.holdings : []).map(h => ({ name: String(h.name || "").slice(0, 120), isin: /^INE[A-Z0-9]{9}$/.test(h.isin || "") ? h.isin : null, weight: Number(h.weight) || 0, sector: h.sector ? String(h.sector).slice(0, 60) : null, symbol: /^[A-Z0-9&-]{1,20}$/.test(String(h.symbol || "").toUpperCase()) ? String(h.symbol).toUpperCase() : null, exchange: h.exchange === "BSE" ? "BSE" : "NSE" })).filter(h => h.name && h.weight > 0).slice(0, 300);
          if (!holdings.length) throw new Error("No holdings to save.");
          // learn the confirmed mappings, track the stocks, and fetch their fundamentals in the background
          const fund = await saveXrayFund({ id: b.id || null, name, asOf: b.asOf || null, holdings });
          return reply(res, 200, { ok: true, id: fund.id });
        }
        if (op === "delete") { const st = await readJson(U.fundsFile, { funds: [] }); st.funds = st.funds.filter(f => f.id !== b.id); await writeJson(U.fundsFile, st); return reply(res, 200, { ok: true }); }
        return reply(res, 404, { message: "Unknown fund operation." });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/dividend-plan")) {
      const op = url.pathname.slice("/api/dividend-plan".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) return reply(res, 200, await dividendPlanView());
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown planner operation." });
        const b = await readBody(req), cur = sanitizePlan(await readJson(U.divPlanFile, {}));
        const curGoal = (await readJson(U.divPlanFile, {})).goal;
        const save = async next => writeJson(U.divPlanFile, { ...sanitizePlan(next), goal: sanitizeGoal(next.goal ?? curGoal) });
        if (!op) { await save({ settings: b.settings || cur.settings, rows: b.rows || cur.rows, goal: b.goal ?? curGoal }); return reply(res, 200, await dividendPlanView()); }
        if (op === "add") {
          const symbol = String(b.symbol || "").trim().toUpperCase(), exchange = b.exchange === "BSE" ? "BSE" : /^\d{6}$/.test(symbol) ? "BSE" : "NSE";
          if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return reply(res, 400, { message: "Pick a stock from the suggestions, or type an NSE symbol / BSE code." });
          const shares = Number(b.shares) > 0 ? Number(b.shares) : 0;
          const rows = cur.rows.some(r => r.symbol === symbol) ? cur.rows.map(r => (r.symbol === symbol ? { ...r, shares: shares || r.shares } : r)) : [...cur.rows, { symbol, exchange, shares, dpsOverride: null }];
          await save({ settings: cur.settings, rows });
          if (await ensureInPool(symbol, exchange, b.name || null)) queueFill([symbol]).catch(() => {});
          await Promise.race([fetchDividendsFor([symbol]), new Promise(r => setTimeout(r, 15000))]).catch(() => {});
          return reply(res, 200, await dividendPlanView());
        }
        if (op === "import-holdings") {
          const view = await kiteHoldingsView(); if (!view.holdings.length) return reply(res, 400, { message: "No synced holdings yet: connect a broker or import a CSV under My holdings first." });
          const rows = [...cur.rows];
          for (const h of view.holdings) { const i = rows.findIndex(r => r.symbol === h.symbol); if (i >= 0) rows[i] = { ...rows[i], shares: h.qty }; else rows.push({ symbol: h.symbol, exchange: "NSE", shares: h.qty, dpsOverride: null }); }
          await save({ settings: cur.settings, rows });
          for (const h of view.holdings) await ensureInPool(h.symbol, "NSE", h.company || null, "Added from holdings (dividend planner).");
          fetchDividendsFor(view.holdings.map(h => h.symbol)).catch(() => {});
          return reply(res, 200, { ...(await dividendPlanView()), imported: view.holdings.length });
        }
        if (op === "refresh") { fetchDividendsFor(cur.rows.map(r => r.symbol), true).catch(() => {}); return reply(res, 200, { started: true, count: cur.rows.length }); }
        return reply(res, 404, { message: "Unknown planner operation." });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/lists")) {
      const op = url.pathname.slice("/api/lists".length).replace(/^\//, "");
      try {
        let st = await readLists();
        if (req.method === "GET" && !op) { await writeJson(U.listsFile, st); return reply(res, 200, { lists: (await withHoldingsList(st)).lists.map(l => ({ ...l, count: l.symbols.length })) }); }
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown lists operation." });
        const b = await readBody(req); let created = null;
        if (b.id === HOLDINGS_LIST_ID && op !== "create") throw new Error("My holdings follows your broker accounts: it changes when you sync or remove holdings on My holdings.");
        if (op === "create" && /^(my )?holdings$/i.test(String(b.name || "").trim())) throw new Error('"My holdings" is already there: it follows your broker accounts. Pick another name.');
        if (op === "create") { const r = createList(st, { name: b.name, symbols: b.symbols }); st = r.store; created = r.list.id; }
        else if (op === "rename") st = renameList(st, b.id, b.name);
        else if (op === "delete") st = deleteList(st, b.id);
        else if (op === "members") { st = setMembers(st, b.id, { add: b.add, remove: b.remove }); if (Array.isArray(b.add) && b.add.length) setTimeout(() => queueFill(b.add).catch(() => {}), 500); }
        else return reply(res, 404, { message: "Unknown lists operation." });
        await writeJson(U.listsFile, st);
        return reply(res, 200, { lists: (await withHoldingsList(st)).lists.map(l => ({ ...l, count: l.symbols.length })), created });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/notify")) { // Telegram phone alerts (per account)
      const op = url.pathname.slice("/api/notify".length).replace(/^\//, "");
      try {
        const cfg = await readJson(U.notifyFile, {}), t = cfg.telegram || {};
        const pub = c => { const x = c.telegram || {}; return { digest: { morning: !!c.digest?.morning, evening: !!c.digest?.evening }, telegram: { connected: !!(x.token && x.chatId), enabled: !!x.enabled, token: maskToken(x.token), bot: x.bot || null, chat: x.chatLabel || null, scope: x.scope || "all" }, lastSent: c.lastSent || null, lastError: c.lastError || null, lastErrorAt: c.lastErrorAt || null }; };
        if (req.method === "GET" && !op) return reply(res, 200, pub(cfg));
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown notify operation." });
        const b = await readBody(req);
        if (op === "connect") { // token (new or kept) → bot name → chat that last messaged the bot
          const token = String(b.token || "").trim() || t.token; if (!validToken(token)) throw new Error("Paste the bot token from @BotFather (it looks like 123456789:AA…).");
          const bot = await botInfo(token), chat = await findChat(token);
          cfg.telegram = { token, bot: bot.username, chatId: chat.chatId, chatLabel: chat.label, scope: b.scope === "swing" ? "swing" : t.scope || "all", enabled: true };
          await sendTelegram(token, chat.chatId, "✅ <b>Equity Watchlist</b> is connected. Your alerts will arrive here.");
          cfg.lastError = null;
        } else if (op === "settings") { if (!t.token) throw new Error("Connect a bot first."); cfg.telegram = { ...t, enabled: b.enabled !== false, scope: b.scope === "swing" ? "swing" : "all" }; }
        else if (op === "test") { if (!t.token || !t.chatId) throw new Error("Connect a bot first."); await sendTelegram(t.token, t.chatId, "🔔 <b>Test alert</b> from Equity Watchlist. Phone alerts are working."); cfg.lastSent = new Date().toISOString(); cfg.lastError = null; }
        else if (op === "digest") cfg.digest = { morning: !!b.morning, evening: !!b.evening };
        else if (op === "digest-test") { await writeJson(U.notifyFile, cfg, { mode: 0o600 }); const html = await sendDigest(b.kind === "evening" ? "evening" : "morning"); return reply(res, 200, { ...pub(cfg), sent: html }); }
        else if (op === "disconnect") delete cfg.telegram;
        else return reply(res, 404, { message: "Unknown notify operation." });
        await writeJson(U.notifyFile, cfg, { mode: 0o600 });
        return reply(res, 200, pub(cfg));
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname === "/api/digest/preview" && req.method === "GET") { const { html } = await digestData(url.searchParams.get("kind") === "evening" ? "evening" : "morning"); return reply(res, 200, { html }); }
    // Alerts you set yourself
    if (url.pathname.startsWith("/api/rules")) {
      const op = url.pathname.slice("/api/rules".length).replace(/^\//, "");
      try {
        const st = await readJson(rulesFile(), { rules: [] }); st.rules ||= [];
        const out = () => ({ rules: st.rules.map(r => ({ ...r, text: describeRule(r) })), types: Object.fromEntries(Object.entries(RULE_TYPES).map(([k, v]) => [k, { label: v.label, unit: v.unit || null, live: !!v.live, eod: !!v.eod }])) });
        if (req.method === "GET" && !op) return reply(res, 200, out());
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown operation." });
        const b = await readBody(req);
        await withUserLock(async () => {
          const cur = await readJson(rulesFile(), { rules: [] }); st.rules = cur.rules || [];
          if (op === "save") { const prev = b.id ? st.rules.find(r => r.id === b.id) : null; const r = sanitizeRule(b, prev); if (!prev && st.rules.length >= 200) throw new Error("At most 200 alerts."); if (prev && b.active !== false) r.active = true; st.rules = prev ? st.rules.map(x => (x.id === r.id ? r : x)) : [r, ...st.rules]; }
          else if (op === "delete") st.rules = st.rules.filter(r => r.id !== b.id);
          else if (op === "toggle") st.rules = st.rules.map(r => (r.id === b.id ? { ...r, active: !!b.active } : r));
          else throw new Error("Unknown operation.");
          await writeJson(rulesFile(), st);
        });
        await loadRulesIndex().catch(() => {});
        // a new price rule is checked at once against the current price
        if (op === "save") { const r = st.rules[0]; const q = livePriceCache.get(`${r.exchange}:${r.symbol}`); if (q && !b.id) priceBus.emit("quote", `${r.exchange}:${r.symbol}`, { ...q, stale: false }); else if (!q) livePrices([{ symbol: r.symbol, exchange: r.exchange }], 0, { budgetMs: 0 }).catch(() => {}); }
        return reply(res, 200, out());
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname === "/api/alerts" && req.method === "GET") {
      await runAlerts((await computeRows()).rows);
      const store = await readJson(U.alertsFile, { state: {}, events: [] });
      return reply(res, 200, { events: store.events, unread: store.events.filter(e => !e.read).length });
    }
    if (url.pathname === "/api/alerts/read" && req.method === "POST") {
      const { ids, all } = await readBody(req); const store = await readJson(U.alertsFile, { state: {}, events: [] });
      for (const e of store.events) if (all || (Array.isArray(ids) && ids.includes(e.id))) e.read = true;
      await writeJson(U.alertsFile, store);
      return reply(res, 200, { unread: store.events.filter(e => !e.read).length });
    }
    if (url.pathname === "/api/growth-lens" && req.method === "POST") {
      // Save your own growth assumptions for one stock ({ symbol, growth, years, exitPE, required }); send reset: true to go back to the defaults.
      const b = await readBody(req), sym = String(b.symbol || "").toUpperCase();
      if (!/^[A-Z0-9&-]{1,20}$/.test(sym)) return reply(res, 400, { message: "Invalid symbol." });
      const all = await readJson(U.growthOverridesFile, {});
      if (b.reset) delete all[sym];
      else { const o = {}; for (const k of ["growth", "years", "exitPE", "required"]) if (Number.isFinite(Number(b[k])) && b[k] !== null && b[k] !== "") o[k] = Number(b[k]); all[sym] = o; }
      await writeJson(U.growthOverridesFile, all);
      const row = (await computeRows()).rows.find(r => String(r.symbol).toUpperCase() === sym);
      return reply(res, 200, { growthLens: row?.growthLens || null, verdict: row?.verdict || null });
    }
    if (url.pathname === "/api/stock-extras" && req.method === "GET") {
      // Stock card: dividend lens, swing overlay and peer comparison. Screener first (same site as the fundamentals), Yahoo as a
      // fallback; everything is cached so opening a card again costs no requests.
      const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase();
      if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return reply(res, 400, { message: "Invalid symbol." });
      const errors = {}, stock = (await readWatchlist()).find(st => symOf(st) === symbol) || { marketSymbol: symbol, exchange: "NSE" };
      let sx = (await readJson(screenerExtraFile, {}))[symbol] || {};
      const fresh = (part, ms) => sx[part]?.at && Date.now() - sx[part].at < ms;
      const want = [...(fresh("peers", 7 * 864e5) ? [] : ["peers"]), ...(fresh("swing", 6 * 3600e3) ? [] : ["chart"])];
      const etfCard = isEtf(symbol, stock.company) || (await readFundamentals())[symbol]?.profile === "etf"; // no Screener page for ETFs
      if (!etfCard && (want.length || !sx.div)) {
        try {
          const x = await fetchScreenerExtras(stock, { ids: sx.ids || null, want });
          const patch = { ids: x.ids };
          if (x.extra) patch.div = { yield: x.extra.dividendYield, annual: x.extra.divAnnual, at: Date.now() };
          if (x.peersTable) patch.peers = { table: x.peersTable, at: Date.now() };
          if (x.bars) patch.swing = { t: computeTechnicals(x.bars), at: Date.now(), source: "Screener" };
          await saveScreenerExtra(symbol, patch); sx = { ...sx, ...patch };
        } catch (e) { errors.screener = e.message; }
      }
      // Swing fallback: Yahoo daily prices (often rate-limited when the app has been refreshing prices from Yahoo)
      let technicals = sx.swing?.t || null, techSource = sx.swing?.source || null;
      if (!technicals) {
        try { technicals = computeTechnicals(await fetchBars(symbol, { exchange: stock.exchange })); techSource = "Yahoo"; await saveScreenerExtra(symbol, { swing: { t: technicals, at: Date.now(), source: "Yahoo" } }); }
        catch (e) { errors.technicals = `Price history unavailable from Screener${errors.screener ? ` (${errors.screener})` : ""} and Yahoo (${e.rateLimited ? "rate-limited" : e.message}).`; }
      }
      const { rows } = await computeRows(), row = rows.find(r => String(r.symbol).toUpperCase() === symbol);
      let dividend = row?.dividend || (sx.div?.annual?.length ? dividendsFromAnnual(sx.div.annual, { price: row?.price ?? null, profitCagr3: row?.profitCagr3 ?? null, dividendYield: sx.div.yield }) : null);
      if (!dividend && etfCard) errors.dividend = "ETF: most Indian ETFs reinvest dividends inside the fund, so there is no dividend history to show.";
      else if (!dividend) errors.dividend = sx.div ? "Screener shows no dividend history for this company." : `Dividend data unavailable right now${errors.screener ? ` (${errors.screener})` : ""}.`;
      // Mark which Screener peers you track / hold, with the app's verdict
      const bySym = new Map(rows.map(r => [String(r.symbol).toUpperCase(), r]));
      const screenerPeers = sx.peers?.table ? { ...sx.peers.table, at: sx.peers.at, rows: sx.peers.table.rows.map(p => { const r = p.symbol && bySym.get(p.symbol); return { ...p, self: p.symbol === symbol, tracked: !!r, verdict: r?.verdict?.label || null, verdictCls: r?.verdict?.cls || null }; }) } : null;
      return reply(res, 200, { symbol, dividend, technicals: technicals ? { ...technicals, source: techSource } : null, peers: peerCompare(symbol, rows), screenerPeers, errors });
    }
    if (url.pathname === "/api/allocate" && req.method === "POST") {
      const b = await readBody(req);
      try {
        const [{ rows }, view] = await Promise.all([computeRows(), kiteHoldingsView()]);
        const held = Object.fromEntries(view.holdings.map(h => [h.symbol, h.value || 0]));
        const inScope = Array.isArray(b.symbols) ? new Set(b.symbols.map(x => String(x).toUpperCase())) : null;
        const pool = (b.scope === "holdings" ? rows.filter(r => held[String(r.symbol).toUpperCase()] !== undefined) : rows).filter(r => !inScope || inScope.has(String(r.symbol).toUpperCase()));
        const out = allocate({ amount: b.amount, rows: pool, held, maxPerStockPct: Number(b.maxPerStockPct) || 15, maxPerSectorPct: Number(b.maxPerSectorPct) || 30, maxPerStockAmount: Number(b.maxPerStockAmount) > 0 ? Number(b.maxPerStockAmount) : null, tag: ["Value", "Growth", "Dividend"].includes(b.tag) ? b.tag : null, minTicket: 1000 });
        return reply(res, 200, { ...out, portfolioValue: Math.round(view.totals?.value || 0) });
      } catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname === "/api/market/week" && req.method === "GET") return reply(res, 200, await weekView({ period: ["day", "week", "month"].includes(url.searchParams.get("period")) ? url.searchParams.get("period") : "week", universe: ["nifty500", "nifty50", "all", "mine"].includes(url.searchParams.get("universe")) ? url.searchParams.get("universe") : "nifty500" }));
    if (url.pathname === "/api/market" && req.method === "GET") {
      const list = url.searchParams.get("list") || "52high", source = url.searchParams.get("source") === "nse" ? "nse" : "mine";
      if (!MARKET_LISTS[list]) return reply(res, 400, { message: `Unknown list. Use one of: ${Object.keys(MARKET_LISTS).join(", ")}.` });
      if (url.searchParams.get("fresh") === "1") marketCache.delete(`${currentUser().id}:${list}:${source}`);
      const data = await marketList(list, source);
      // Enrich with what the app knows: tracked? held? P/E, sector P/E, valuation verdict.
      const [{ rows }, view] = await Promise.all([computeRows(), kiteHoldingsView()]);
      const bySym = new Map(rows.map(r => [String(r.symbol).toUpperCase(), r])), held = new Map(view.holdings.map(h => [h.symbol, h.qty]));
      return reply(res, 200, { ...data, rows: data.rows.map(x => { const r = bySym.get(x.symbol); return { ...x, name: x.name || r?.company || null, tracked: !!r, held: held.get(x.symbol) ?? null, pe: r?.pe ?? null, sectorPe: r?.sectorPe ?? r?.sectorPeEst ?? null, sectorPeEst: !r?.sectorPe && !!r?.sectorPeEst, view: r && Number.isFinite(r.ratio) ? r.view : null, verdict: r?.verdict?.label || null, verdictCls: r?.verdict?.cls || null }; }) });
    }
    if (url.pathname === "/api/portfolio/focus" && req.method === "GET") {
      const [{ rows }, view] = await Promise.all([computeRows(), kiteHoldingsView()]);
      const bySym = Object.fromEntries(rows.map(r => [String(r.symbol).toUpperCase(), r]));
      const acc = url.searchParams.get("account");
      const hs = view.holdings.map(h => { const a = acc ? h.accounts.find(x => x.userId === acc) : null; if (acc && !a) return null; const price = h.syncPrice ?? h.watchlistPrice; return { symbol: h.symbol, company: h.company, value: a ? (Number.isFinite(price) ? price * a.qty : 0) : h.value, stance: h.stance, thesis: h.thesis }; }).filter(Boolean);
      const tot = hs.reduce((x, h) => x + (h.value || 0), 0); hs.forEach(h => { h.weightPct = tot > 0 ? h.value / tot * 100 : null; });
      return reply(res, 200, rankFocus({ holdings: hs, rowsBySym: bySym, candidates: rows, n: Number(url.searchParams.get("n")) || 30 }));
    }
    if (url.pathname === "/api/portfolio/health" && req.method === "GET") {
      const [{ rows }, view] = await Promise.all([computeRows(), kiteHoldingsView()]);
      const bySym = Object.fromEntries(rows.map(r => [String(r.symbol).toUpperCase(), r]));
      return reply(res, 200, portfolioHealth(view.holdings, bySym));
    }
    if (url.pathname === "/api/search" && req.method === "GET") {
      // Search-as-you-type: tracked stocks (with their numbers) first, then the offline list of listed companies
      // (always works), then Yahoo's online search only when the offline list has little to offer.
      const q = String(url.searchParams.get("q") || "").trim().slice(0, 40);
      if (q.length < 1) return reply(res, 200, { results: [] });
      const [{ rows }, lists, master] = await Promise.all([computeRows(), readLists(), scripMaster()]);
      const local = searchMaster(master.list, q, 10).map(x => ({ symbol: `${x.symbol}.${x.exchange === "BSE" ? "BO" : "NS"}`, longname: x.name, quoteType: "EQUITY" }));
      let online = [], note = null;
      if (q.length >= 3 && local.length < 3) { const r = await yahooSearch(q); online = r.quotes; if (r.error && !local.length) note = `${r.error} Type the exact NSE symbol (e.g. IOC) and press Enter.`; }
      const results = mergeSuggestions(q, rows, [...local, ...online], lists.lists);
      return reply(res, 200, { results, note: results.length ? null : note, source: master.source });
    }
    if (url.pathname === "/api/quote-preview" && req.method === "GET") {
      // Quick price / P/E / sector P/E for a suggestion that is not tracked yet (best effort; nothing is saved).
      const symbol = String(url.searchParams.get("symbol") || "").trim().toUpperCase(), ex = url.searchParams.get("exchange") === "BSE" ? "BSE" : "NSE";
      if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return reply(res, 400, { message: "Invalid symbol." });
      const out = { symbol, exchange: ex };
      try { const qt = await yahooQuote(symbol, ex); Object.assign(out, { price: qt.price, low: qt.low, high: qt.high }); } catch (e) { out.priceError = e.message; }
      if (ex === "NSE" && !nseCooldown()) { try { const n = await fetchNseQuote(symbol); Object.assign(out, { pe: n.pe, sectorPe: n.sectorPe, sector: n.sector, price: out.price ?? n.price }); } catch { /* optional */ } }
      return reply(res, 200, out);
    }
    if ((url.pathname === "/api/holdings/remove" || url.pathname === "/api/holdings/unhide") && req.method === "POST") {
      // Remove one broker account's (or every account's) stock holdings from this app. Imported CSV accounts are deleted;
      // synced ones are hidden (kept out of every screen even after a re-sync) until Show again. Nothing changes at a broker.
      const b = await readBody(req), store = await readJson(U.kiteHoldingsFile, { accounts: {} }); store.accounts ||= {};
      const hid = new Set(store.hiddenEq || []); let notice;
      if (url.pathname.endsWith("/unhide")) {
        const id = String(b.account || "");
        if (b.all) hid.clear(); else if (!hid.delete(id)) return reply(res, 404, { message: "That account is not removed." });
        notice = b.all ? "Removed accounts are shown again." : `${store.accounts[id]?.label || id} is shown again.`;
      } else {
        const ids = b.all ? Object.keys(store.accounts).filter(id => !hid.has(id) && (store.accounts[id].holdings || []).length) : [String(b.account || "")];
        if (!ids.length) return reply(res, 400, { message: "Nothing to remove." });
        let deleted = 0, hidden = 0, n = 0;
        for (const id of ids) {
          const a = store.accounts[id]; if (!a) return reply(res, 404, { message: "Unknown account." });
          if (hid.has(id)) continue;
          n += (a.holdings || []).length;
          if (isImportedAcct(a) && !(a.mf || []).length && !(a.us || []).length) { delete store.accounts[id]; deleted++; } else { hid.add(id); hidden++; }
        }
        notice = `Removed ${n} holding${n === 1 ? "" : "s"}${deleted ? ` · ${deleted} imported account${deleted === 1 ? "" : "s"} deleted` : ""}${hidden ? ` · ${hidden} synced account${hidden === 1 ? "" : "s"} hidden until you press Show again` : ""}.`;
      }
      store.hiddenEq = [...hid].filter(id => store.accounts[id]);
      if (!store.hiddenEq.length) delete store.hiddenEq;
      await writeJson(U.kiteHoldingsFile, store);
      return reply(res, 200, { ...(await kiteHoldingsView()), notice });
    }
    if (url.pathname === "/api/holdings/import" && req.method === "POST") {
      // Brokers with no public holdings API (INDmoney, or any app that exports a statement): paste/upload a CSV with
      // symbol, quantity and average price columns. Stored as one account per label, read-only like the others.
      const { csv, label, broker } = await readBody(req);
      const text = String(csv || "");
      if (text.length < 5 || text.length > 500000) return reply(res, 400, { message: "Paste the CSV text (a header row plus one row per holding)." });
      const rows = parseCsvLoose(text);
      if (rows.length < 2) return reply(res, 400, { message: "The CSV needs a header row and at least one holding." });
      const head = rows[0].map(h => h.toLowerCase().replace(/[^a-z]/g, ""));
      const col = names => head.findIndex(h => names.includes(h));
      const ci = { sym: col(["symbol", "ticker", "scrip", "scripname", "stocksymbol", "tradingsymbol", "instrument"]), qty: col(["qty", "quantity", "shares", "units", "netqty"]), avg: col(["avgprice", "averageprice", "avgcost", "averagecost", "avgbuyprice", "buyprice", "avgcostprice", "costprice"]), last: col(["ltp", "lastprice", "price", "currentprice", "cmp"]) };
      if (ci.sym < 0 || ci.qty < 0) return reply(res, 400, { message: `Could not find the symbol and quantity columns. Found: ${rows[0].join(", ")}. Expected something like: symbol, quantity, average price.` });
      const holdings = [], skipped = [];
      for (const r of rows.slice(1)) {
        const symbol = cleanSymbol(r[ci.sym]);
        if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) { skipped.push(String(r[ci.sym] || "(blank)")); continue; }
        const h = makeHolding({ symbol, qty: String(r[ci.qty]).replace(/,/g, ""), avg: ci.avg >= 0 ? String(r[ci.avg]).replace(/[₹,]/g, "") : null, last: ci.last >= 0 ? String(r[ci.last]).replace(/[₹,]/g, "") : null });
        if (h.qty > 0) holdings.push(h); else skipped.push(symbol);
      }
      if (!holdings.length) return reply(res, 400, { message: `No usable rows. Symbols must be NSE symbols (e.g. TCS, not company names). Skipped: ${skipped.slice(0, 5).join(", ")}` });
      const b = ["indmoney", "other"].includes(broker) ? broker : "indmoney";
      const name = String(label || "").trim().slice(0, 60) || (b === "indmoney" ? "INDmoney - Demat" : "Imported holdings");
      const store = await readJson(U.kiteHoldingsFile, { accounts: {} }); store.accounts ||= {};
      store.accounts[`${b}:${name}`] = { broker: b, via: "csv", clientId: name, label: name, name: null, syncedAt: new Date().toISOString(), priceNote: "Imported from CSV: valued at the latest watchlist price.", holdings };
      await writeJson(U.kiteHoldingsFile, store);
      return reply(res, 200, { ok: true, imported: holdings.length, skipped });
    }
    if (url.pathname === "/api/holdings/add-to-watchlist" && req.method === "POST") {
      // Adds every held stock that is not on the watchlist yet (or just the symbols given), then fetches fundamentals for them in
      // the background job so each gets a valuation. Existing rows are left untouched.
      const { symbols, list: listId } = await readBody(req);
      const view = await kiteHoldingsView();
      const want = new Set((Array.isArray(symbols) && symbols.length ? symbols : view.holdings.map(h => h.symbol)).map(s => String(s).toUpperCase()));
      const list = await readWatchlist(), have = new Set(list.map(symOf));
      let nextId = Math.max(0, ...list.map(s => s.id)) + 1;
      const added = [];
      for (const h of view.holdings) {
        if (!want.has(h.symbol) || have.has(h.symbol)) continue;
        const accounts = [...new Set(h.accounts.map(a => a.label))];
        added.push({ id: nextId++, company: h.company || h.symbol, ticker: h.symbol, marketSymbol: h.symbol, bucket: "Imported", action: "Watch", valuation: "Fair", price: Number.isFinite(h.syncPrice) ? h.syncPrice : null, low: null, high: null, kpi: "", note: "Added from broker holdings.", updated: "Needs refresh", accounts });
      }
      if (added.length) await persistWatchlist([...list, ...added], list);
      await addToList(listId, [...want].filter(x => have.has(x) || added.some(a => a.marketSymbol === x)));
      let started = false;
      if (!job.running) {
        const targets = (await readWatchlist()).filter(s => want.has(symOf(s)));
        if (targets.length) { runJob(targets, false, "auto").catch(e => { job.running = false; job.note = `Job crashed: ${e.message}`; }); started = true; }
      }
      return reply(res, 200, { ok: true, added: added.length, alreadyThere: [...want].filter(s => have.has(s)).length, started, jobRunning: job.running });
    }
    if (url.pathname === "/api/stocks/add" && req.method === "POST") {
      const { company, symbol, accounts, bucket, action, note, list, exchange } = await readBody(req);
      const sym = String(symbol || "").trim().toUpperCase(), name = String(company || "").trim() || sym;
      if (!/^[A-Z0-9&-]{1,20}$/.test(sym)) return reply(res, 400, { message: "Need an NSE symbol or BSE scrip code (letters, digits, & or -), for example INDIGO or 544252." });
      const stocks = await readWatchlist();
      if (stocks.some(s => symOf(s) === sym)) { await addToList(list, [sym]); return reply(res, 409, { message: `${sym} is already tracked; it was added to the selected watchlist.` }); }
      const stock = { id: Math.max(0, ...stocks.map(s => s.id)) + 1, company: name, ticker: sym, marketSymbol: sym, bucket: ["Core", "Growth", "Turnaround", "Speculative", "Imported"].includes(bucket) ? bucket : "Growth", action: ["Watch", "Buy on dips"].includes(action) ? action : "Buy on dips", valuation: "Fair", price: null, low: null, high: null, kpi: "Core business KPIs and operating metrics.", note: String(note || "Added manually.").slice(0, 200), exchange: exchange === "BSE" ? "BSE" : "NSE", updated: "Needs refresh", accounts: Array.isArray(accounts) ? accounts.map(String) : [] };
      await persistWatchlist([...stocks, stock], stocks);
      await addToList(list, [sym]);
      return reply(res, 200, { ok: true, stock });
    }
    if (url.pathname === "/api/stocks/symbol" && req.method === "POST") {
      // Fix a wrong ticker mapping (e.g. Apollo -> APOLLO instead of APOLLOHOSP). Clears price data so the next refresh repopulates it.
      const { id, symbol } = await readBody(req);
      const sym = String(symbol || "").trim().toUpperCase();
      if (!/^[A-Z0-9&-]{1,20}$/.test(sym)) return reply(res, 400, { message: "Invalid NSE symbol." });
      const stocks = await readWatchlist(), prev = stocks.map(s => ({ ...s }));
      const stock = stocks.find(s => s.id === id);
      if (!stock) return reply(res, 404, { message: "Stock not found." });
      if (stocks.some(s => s.id !== id && symOf(s) === sym)) return reply(res, 409, { message: `${sym} is already used by another watchlist row.` });
      Object.assign(stock, { marketSymbol: sym, ticker: sym, price: null, low: null, high: null, updated: "Needs refresh", feedStatus: "Ticker changed - refresh sources" });
      await persistWatchlist(stocks, prev);
      return reply(res, 200, { ok: true, stock });
    }
    if (url.pathname === "/api/plan" && req.method === "GET") {
      const store = await readJson(U.positionsFile, { settings: DEFAULT_SETTINGS, positions: {} });
      const settings = { ...DEFAULT_SETTINGS, ...(store.settings || {}) };
      const { stocks, fundamentals, rows: vrows } = await computeRows();
      const bySym = new Map(stocks.map(s => [symOf(s), s])), vBySym = new Map(vrows.map(r => [r.symbol?.toUpperCase(), r]));
      const rows = Object.entries(store.positions || {}).filter(([sym]) => bySym.has(sym)).map(([sym, pos]) => ({ company: bySym.get(sym).company, id: bySym.get(sym).id, ...positionRow(sym, pos, bySym.get(sym).price, vBySym.get(sym), settings) }));
      const sectorOf = sym => fundamentals[sym]?.sector || null;
      const totalInvested = rows.reduce((a, r) => a + r.invested, 0), totalMax = rows.reduce((a, r) => a + r.maxAmount, 0);
      const stressRows = stress(rows).map(x => ({ ...x, shortfall: Math.max(0, x.cash - settings.cashReserve) }));
      return reply(res, 200, { settings, ladders: LADDERS, rows, exposure: exposure(rows, sectorOf), stress: stressRows, totals: { invested: totalInvested, maxPlanned: totalMax, remaining: Math.max(0, totalMax - totalInvested), due: rows.filter(r => /^(ADD|START)/.test(r.action)).length } });
    }
    if (url.pathname.startsWith("/api/plan/") && req.method === "POST") {
      const body = await readBody(req), op = url.pathname.slice("/api/plan/".length);
      const store = await readJson(U.positionsFile, { settings: DEFAULT_SETTINGS, positions: {} });
      store.settings = { ...DEFAULT_SETTINGS, ...(store.settings || {}) }; store.positions ||= {};
      if (op === "settings") {
        const t = Number(body.trancheSize ?? store.settings.trancheSize), c = Number(body.cashReserve ?? store.settings.cashReserve);
        if (!(t > 0) || !(c >= 0)) return reply(res, 400, { message: "trancheSize must be > 0 and cashReserve >= 0." });
        store.settings = { trancheSize: Math.round(t), cashReserve: Math.round(c) };
      } else {
        const sym = String(body.symbol || "").trim().toUpperCase();
        if (!(await readWatchlist()).some(s => symOf(s) === sym)) return reply(res, 404, { message: `${sym || "(none)"} is not in the watchlist. Add it first.` });
        if (op === "position") {
          if (body.ladder !== undefined && !LADDERS[body.ladder]) return reply(res, 400, { message: `ladder must be one of ${Object.keys(LADDERS).join(", ")}` });
          const cur = store.positions[sym] || { ladder: "standard", buys: [] };
          store.positions[sym] = { ...cur, ladder: body.ladder || cur.ladder };
        } else if (op === "buy") {
          let buy; try { buy = sanitizeBuy(body); } catch (error) { return reply(res, 400, { message: error.message }); }
          const cur = store.positions[sym] || { ladder: "standard", buys: [] };
          store.positions[sym] = { ...cur, buys: [...cur.buys, buy] };
        } else if (op === "undo") { if (store.positions[sym]) store.positions[sym].buys = store.positions[sym].buys.slice(0, -1); }
        else if (op === "remove") delete store.positions[sym];
        else return reply(res, 404, { message: "Unknown plan operation." });
      }
      await writeJson(U.positionsFile, store);
      return reply(res, 200, { ok: true });
    }
    if (url.pathname === "/api/fundamentals" && req.method === "GET") return reply(res, 200, { fields: FIELDS, fundamentals: await readFundamentals() });
    if (url.pathname === "/api/fundamentals" && req.method === "POST") {
      // Accepts { entries: [...] } or { csv: "symbol,price,pe,..." }. Upserts by symbol; fields you omit are kept.
      const body = await readBody(req);
      let entries;
      try { entries = typeof body.csv === "string" ? parseCsv(body.csv) : body.entries; if (!Array.isArray(entries) || !entries.length) throw new Error("Provide entries[] or csv."); entries = entries.map(sanitizeEntry); }
      catch (error) { return reply(res, 400, { message: error.message }); }
      const map = await readFundamentals();
      for (const e of entries) map[e.symbol] = { ...(map[e.symbol] || {}), ...e, asOf: e.asOf || istDay(), source: e.source || map[e.symbol]?.source || "Manual entry" };
      await writeFundamentals(map);
      return reply(res, 200, { ok: true, count: entries.length, total: Object.keys(map).length });
    }
    if (url.pathname === "/api/advise" && req.method === "POST") {
      const { id, lens = "balanced" } = await readBody(req);
      if (!Object.hasOwn(ADVISOR_LENSES, lens)) return reply(res, 400, { message: "lens must be balanced, value, growth, or momentum." });
      const stock = (await readWatchlist()).find(s => s.id === id);
      if (!stock) return reply(res, 404, { message: "Stock not found." });
      try { console.log(`[advisor] ${stock.company}: requesting ${lens} reassessment (${ADVISOR_MODEL})`); const suggestion = await callAdvisor(stock, lens, (await readFundamentals())[(stock.marketSymbol || stock.ticker || "").toUpperCase()]); console.log(`[advisor] ${stock.company}: ${suggestion.style || "no style"} / ${suggestion.valuation} / ${suggestion.longTermStory?.verdict || "no verdict"}`); return reply(res, 200, { id, suggestion }); }
      catch (error) { console.error(`[advisor] ${stock.company}: ${error.message}`); return reply(res, 502, { message: error.message }); }
    }
    if (url.pathname === "/api/advise/bulk" && req.method === "POST") {
      const { ids, lens = "balanced" } = await readBody(req);
      if (!Object.hasOwn(ADVISOR_LENSES, lens)) return reply(res, 400, { message: "lens must be balanced, value, growth, or momentum." });
      const stocks = await readWatchlist();
      const targets = Array.isArray(ids) && ids.length ? stocks.filter(s => ids.includes(s.id)) : [];
      const fundamentalsMap = await readFundamentals();
      if (!targets.length) return reply(res, 400, { message: "No matching stocks." });
      console.log(`[advisor] Bulk ${lens} run starting for ${targets.length} stocks (${ADVISOR_MODEL}).`);
      const results = await mapLimit(targets, 2, async stock => {
        try { return { id: stock.id, company: stock.company, suggestion: await callAdvisor(stock, lens, fundamentalsMap[(stock.marketSymbol || stock.ticker || "").toUpperCase()]) }; }
        catch (error) { console.error(`[advisor] ${stock.company}: ${error.message}`); return { id: stock.id, company: stock.company, error: error.message }; }
      });
      console.log(`[advisor] Bulk run finished: ${results.filter(r => r.suggestion).length}/${targets.length} succeeded.`);
      return reply(res, 200, { results });
    }
    if (url.pathname === "/api/advise/apply" && req.method === "POST") {
      const { updates } = await readBody(req);
      if (!Array.isArray(updates) || !updates.length) return reply(res, 400, { message: "updates must be a non-empty array" });
      const stocks = await readWatchlist();
      const previous = stocks.map(s => ({ ...s }));
      const byId = new Map(stocks.map(s => [s.id, s]));
      const reviewedAt = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      for (const u of updates) {
        const stock = byId.get(u.id);
        if (!stock) continue;
        if (u.action) stock.action = u.action;
        if (u.valuation) stock.valuation = u.valuation;
        if (u.style) stock.style = u.style;
        if (u.longTermStory) stock.longTermStory = { verdict: u.longTermStory.verdict, reasoning: u.longTermStory.reasoning, assessedAt: new Date().toISOString() };
        if (u.keyRisk) stock.keyRisk = u.keyRisk;
        stock.advisorReviewed = reviewedAt;
      }
      await persistWatchlist(stocks, previous);
      console.log(`[advisor] Applied ${updates.length} reviewed suggestion(s) to the watchlist.`);
      return reply(res, 200, { ok: true, count: updates.length, stocks });
    }
    let filePath = url.pathname === "/" ? path.join(root, "public", "index.html") : path.join(root, "public", url.pathname);
    filePath = path.normalize(filePath);
    if (!filePath.startsWith(path.join(root, "public"))) return reply(res, 403, "Forbidden", "text/plain");
    try { return await sendStatic(req, res, filePath, types[path.extname(filePath)] || "application/octet-stream"); } catch (e) { if (e.code === "ENOENT" || e.code === "EISDIR") return reply(res, 404, { message: "Not found" }); throw e; }
  } catch (error) { return reply(res, 500, { message: error.message }); }
}

// ---- Front door: sign-in, accounts, and the per-user context every other route runs in ----
const HOST = process.env.HOST || "127.0.0.1";
const TRUST_PROXY = process.env.TRUST_PROXY === "1"; // set when an AWS load balancer / Caddy / nginx terminates HTTPS in front
const isHttps = req => process.env.COOKIE_SECURE === "1" || (TRUST_PROXY && String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https");
// City / country from the CDN or load balancer in front, when it adds them (CloudFront viewer headers, Cloudflare).
const placeOf = req => {
  if (!TRUST_PROXY) return null;
  const h = req.headers, city = h["cloudfront-viewer-city"] || h["cf-ipcity"] || null, region = h["cloudfront-viewer-country-region-name"] || h["cf-region"] || null, country = h["cloudfront-viewer-country-name"] || h["cloudfront-viewer-country"] || h["cf-ipcountry"] || null;
  const s = [city, region, country].filter(Boolean).map(x => { try { return decodeURIComponent(String(x)); } catch { return String(x); } }).join(", ");
  return s ? s.slice(0, 80) : null;
};
const clientAddr = req => (TRUST_PROXY && String(req.headers["x-forwarded-for"] || "").split(",")[0].trim()) || req.socket.remoteAddress || "?";
// The install manifest, service worker and icons must load without a session (browsers fetch them without cookies).
const PUBLIC_FILES = new Set(["/login", "/login.html", "/login.js", "/favicon.ico", "/manifest.webmanifest", "/sw.js", "/icons/icon.svg", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-512.png", "/icons/apple-touch-icon.png"]);
const OWNER_ONLY = [
  // Shared market data every account reads: only the owner may overwrite it by hand.
  { method: "POST", test: p => p === "/api/fundamentals" },
  // The AI advisor spends the owner's Anthropic key; open it to everyone with ALLOW_MEMBER_ADVISOR=1.
  { method: "POST", test: p => p.startsWith("/api/advise") && process.env.ALLOW_MEMBER_ADVISOR !== "1" }
];
const LEGACY_FILES = ["swing.json", "us-list.json", "us-growth.json", "meta.json", "networth.json", "tradebook.json", "watchlist.json", "history.json", "positions.json", "valuation-log.json", "custom-list.json", "theses.json", "kite-holdings.json", "lists.json", "dividend-plan.json", "growth-overrides.json", "funds.json", "alerts.json", "kite-slots.json", "kite-session.json", "broker-sessions.json", "broker-credentials.json", "broker-mcp.json"];
// Before accounts existed everything sat directly in data/. The owner inherits it; files already in the owner's folder win.
async function migrateLegacyData(owner) {
  const dest = userDir(owner); let moved = [];
  await fs.mkdir(dest, { recursive: true, mode: 0o700 });
  const names = [...LEGACY_FILES, ...(await fs.readdir(DATA_DIR).catch(() => [])).filter(n => /^kite-session-[\w-]+\.json$/.test(n))];
  for (const name of new Set(names)) {
    const from = path.join(DATA_DIR, name), to = path.join(dest, name);
    try { await fs.access(from); } catch { continue; }
    try { await fs.access(to); continue; } catch { /* not there yet: move it */ }
    await fs.rename(from, to); moved.push(name);
  }
  if (moved.length) console.log(`[auth] Moved ${moved.length} existing data file(s) into the owner's private folder.`);
  return moved;
}
function secHeaders(res, secure) {
  res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "same-origin");
  if (secure) res.setHeader("Strict-Transport-Security", "max-age=15552000");
}
const sameSite = req => {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const o = req.headers.origin; if (!o) return true;
  try { const h = new URL(o).host; return h === req.headers.host || o === PUBLIC_URL || h === `localhost:${port}` || h === `127.0.0.1:${port}`; } catch { return false; }
};
async function serveFile(res, name, req) { return sendStatic(req, res, path.join(root, "public", name), types[path.extname(name)]); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://app.local"), p = url.pathname, secure = isHttps(req), meta = { addr: clientAddr(req), ua: req.headers["user-agent"], place: placeOf(req) };
  res.acceptsGzip = /gzip/.test(String(req.headers["accept-encoding"] || ""));
  secHeaders(res, secure);
  if (req.method !== "GET" && req.method !== "HEAD" && !sameSite(req)) return reply(res, 403, { message: "Blocked: requests that change data must come from this app's own page." });
  try {
    const signIn = async ({ user, token }) => { res.setHeader("Set-Cookie", auth.cookie(token, { secure })); return reply(res, 200, { user: publicUser(user) }); };
    const fail = e => reply(res, e.status || 500, { message: e.message });
    // Load-balancer / uptime check: public, reveals nothing.
    if (p === "/healthz") { const db = await pingStorage(); return reply(res, db ? 200 : 503, { ok: db }); }
    if (p === "/api/auth/state" && req.method === "GET") return reply(res, 200, { needsSetup: auth.needsSetup(), user: publicUser(auth.userFor(req.headers.cookie)) });
    if (p === "/api/auth/setup" && req.method === "POST") {
      try { const out = await auth.setup(await readBody(req), meta); await migrateLegacyData(out.user); console.log(`[auth] Owner account "${out.user.username}" created.`); return signIn(out); } catch (e) { return fail(e); }
    }
    if (p === "/api/auth/login" && req.method === "POST") { try { return signIn(await auth.login(await readBody(req), meta)); } catch (e) { return fail(e); } }
    if (p === "/api/auth/logout" && req.method === "POST") { await auth.logout(req.headers.cookie); res.setHeader("Set-Cookie", auth.cookie("", { secure, clear: true })); return reply(res, 200, { ok: true }); }
    const sess = auth.sessionFor(req.headers.cookie, meta), user = sess?.user || null;
    if (PUBLIC_FILES.has(p)) {
      if (p === "/favicon.ico") { res.writeHead(301, { Location: "/icons/icon.svg" }); return res.end(); }
      if (p === "/sw.js") res.setHeader("Service-Worker-Allowed", "/");
      if (user && (p === "/login" || p === "/login.html")) { res.writeHead(302, { Location: "/" }); return res.end(); }
      return serveFile(res, p === "/login" ? "login.html" : p.slice(1), req);
    }
    if (!user) {
      if (p.startsWith("/api/")) return reply(res, 401, { message: "Please sign in.", authRequired: true, signIn: true });
      res.writeHead(302, { Location: "/login", "Cache-Control": "no-store" }); return res.end();
    }
    if (OWNER_ONLY.some(r => r.method === req.method && r.test(p)) && user.role !== "owner") return reply(res, 403, { message: "Only the app owner can do that." });
    if (p === "/api/storage" && req.method === "GET") return user.role === "owner" ? reply(res, 200, storageInfo()) : reply(res, 403, { message: "Owner only." });
    if (p.startsWith("/api/auth/")) {
      try {
        if (p === "/api/auth/activity" && req.method === "GET") return reply(res, 200, auth.activity(user, sess.key));
        if (p === "/api/auth/revoke" && req.method === "POST") { const b = await readBody(req); const n = await auth.revoke(user, sess.key, { id: b.id ? String(b.id).slice(0, 24) : null, others: !!b.others }); return reply(res, 200, { signedOut: n, ...auth.activity(user, sess.key) }); }
        if (p === "/api/auth/me" && req.method === "GET") return reply(res, 200, { user: publicUser(user), seedDefault: user.role === "owner" });
        if (p === "/api/auth/password" && req.method === "POST") {
          const b = await readBody(req); await auth.changePassword(user, { current: b.current, next: b.next });
          return signIn({ user, token: (await auth.login({ username: user.username, password: b.next }, meta)).token });
        }
        if (user.role !== "owner") return reply(res, 403, { message: "Only the app owner can manage accounts." });
        if (p === "/api/auth/users" && req.method === "GET") return reply(res, 200, { users: auth.allUsers() });
        if (p === "/api/auth/users" && req.method === "POST") { const u = await auth.createUser(await readBody(req)); console.log(`[auth] Account "${u.username}" created by ${user.username}.`); return reply(res, 200, { user: publicUser(u), users: auth.allUsers() }); }
        const m = p.match(/^\/api\/auth\/users\/([a-f0-9]{16})\/(reset|disable|enable|remove)$/);
        if (m && req.method === "POST") {
          const [, id, op] = m;
          if (op === "reset") await auth.resetPassword(id, (await readBody(req)).password);
          if (op === "disable" || op === "enable") await auth.setDisabled(id, op === "disable");
          if (op === "remove") {
            const gone = await auth.removeUser(id);
            for (const s of [brokersU, kiteMain, brokerMcpU]) s.drop(id);
            for (const k of [...kiteClients.keys()]) if (k.startsWith(`${id}:`)) kiteClients.delete(k);
            await fs.rm(userDir(gone), { recursive: true, force: true });
            console.log(`[auth] Account "${gone.username}" and its data removed by ${user.username}.`);
          }
          return reply(res, 200, { users: auth.allUsers() });
        }
        return reply(res, 404, { message: "Unknown account operation." });
      } catch (e) { return fail(e); }
    }
    return await asUser(user, () => appHandler(req, res, url), sess.key);
  } catch (error) { if (!res.headersSent) return reply(res, error instanceof SyntaxError ? 400 : 500, { message: error.message }); }
});
server.listen(port, HOST, () => { // warm-up: app files compressed and every tracked price fetched once, so the first visit is instant
  for (const f of ["index.html", "login.html"]) staticAsset(path.join(root, "public", f)).catch(() => {});
  if (!process.env.NODE_TEST_CONTEXT) setTimeout(() => refreshAllPrices().catch(() => {}), 3000).unref();
  console.log(`Equity tracker running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${port}${HOST !== "127.0.0.1" ? ` (listening on ${HOST})` : ""}`); const code = auth.ensureSetupCode(); if (code) console.log(`\n[auth] No owner account yet. Open the app and create it with this one-time setup code:\n\n    ${code}\n\n       (${process.env.SETUP_CODE ? "from SETUP_CODE in the environment" : `also saved in ${path.join(auth.dir, "setup-code.txt")}`}; it stops working once the owner exists)\n`); else { const o = auth.owner(); if (o) migrateLegacyData(o).catch(e => console.error(`[auth] migration: ${e.message}`)); } console.log(`[config] price sources: ${PRICE_SOURCES.join(" → ")}; Kite MCP: ${kiteDefaults.config.enabled ? "ENABLED" : "disabled"}; Angel One / Dhan / Groww: enabled (details on the Integrations tab)${loadedFromEnvFile.length ? `; from .env: ${loadedFromEnvFile.join(", ")}` : ""}`); });
// Docker / systemd stop: finish pending database writes before exiting.
for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, async () => { console.log(`[server] ${sig}: saving and shutting down…`); server.close(); await closeStorage().catch(() => {}); process.exit(0); });
