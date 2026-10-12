import { loadedFromEnvFile } from "./env.mjs"; // must stay first: loads .env before other modules read process.env
import http from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { createAuth, publicUser } from "./auth.mjs";
import { dfs as fs, initStorage, flushStorage, closeStorage, pingStorage, info as storageInfo } from "./storage.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchFundamentalsForStock, yahooCooldown, yahooQuotes } from "./fundamentals-yahoo.mjs";
import { MODEL, computeAll, computeValuation, sanitizeEntry, parseCsv, FIELDS } from "./valuation.mjs";
import { fetchScreener, screenerCooldown, screenerConfig, fetchScreenerExtras, searchScreener } from "./screener.mjs";
import { readXlsx, parseDelimited, extractHoldings, fundSummary } from "./funds.mjs";
import { fetchNseQuote, mergeNse, refreshFromNse, nseCooldown, fetchNseJson } from "./nse.mjs";
import { LADDERS, DEFAULT_SETTINGS, sanitizeBuy, positionRow, stress, exposure } from "./plan.mjs";
import { addSnapshots, performance, compare } from "./tracker.mjs";
import { fetchGoogleQuote, googleCooldown, googleConfig } from "./googlefinance.mjs";
import { kite as kiteDefaults, READ_ONLY_TOOLS, createKiteClient } from "./kite-mcp.mjs";
import { createBrokerClients, BROKER_NAMES, READ_ONLY_ROUTES, cleanSymbol, makeHolding } from "./brokers.mjs";
import { createBrokerMcp, MCP_BROKERS } from "./broker-mcp.mjs";
import { holdingStance } from "./stance.mjs";
import { classify } from "./classify.mjs";
import { growthLens } from "./growthlens.mjs";
import { computeDividends, fetchDividendEvents, dividendsFromAnnual } from "./dividends.mjs";
import { computeTechnicals, fetchBars } from "./technicals.mjs";
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
import { SWING_DEFAULTS, parseTargets, sanitizePosition, sanitizeWatch, applyBuy, applySell, parseSheet, evaluateSwing, diffSwingAlerts } from "./swing.mjs";
import { SEED as SCRIP_SEED, parseKiteInstruments, parseNseEquityList, mergeMaster, searchMaster } from "./scripmaster.mjs";
import { US_POPULAR, cleanUsSymbol, parseSecTickers, searchTickers, seriesFromFacts, usValuation, fetchUsPrices, fetchSecJson, companyFactsUrl, SEC_TICKERS_URL } from "./us.mjs";
import { LISTS as MARKET_LISTS, parseNseList, rankFromQuotes } from "./market.mjs";
import { ensureLists, createList, renameList, deleteList, setMembers, prune, DEFAULT_ID } from "./lists.mjs";
import { METRICS, OPS, PRESETS, sanitizeThesis, evaluateThesis, trackBreaks } from "./thesis.mjs";

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
const PRICE_SOURCES = (process.env.PRICE_SOURCES || "kite,yahoo,google").split(",").map(s => s.trim().toLowerCase()).filter(s => ["kite", "yahoo", "google"].includes(s));
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
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body));
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
async function addToList(id, symbols) { if (id === "__none__") return; const st = await readLists(); await writeJson(U.listsFile, setMembers(st, st.lists.some(l => l.id === id) ? id : DEFAULT_ID, { add: symbols })); }
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
    // Your own stocks (watchlist + holdings): Kite quotes when a Zerodha login is live (works on most connections), else Yahoo,
    // else the saved watchlist prices. 52-week range = saved range widened by today's high / low.
    const [stocks, view] = await Promise.all([readWatchlist(), kiteHoldingsView()]);
    const items = new Map(stocks.filter(st => symOf(st)).map(st => [symOf(st), { symbol: symOf(st), exchange: st.exchange || "NSE", name: st.company, high52: st.high, low52: st.low }]));
    for (const h of view.holdings) if (!items.has(h.symbol)) items.set(h.symbol, { symbol: h.symbol, exchange: "NSE", name: h.company || h.symbol });
    const kc = await anyKiteWithSession(), errs = [];
    if (kc && list !== "volgainers") {
      try {
        const qs = await kc.quotes([...items.values()].filter(i => i.exchange !== "BSE").map(i => i.symbol));
        const merged = [...qs.values()].map(q => { const i = items.get(q.symbol) || {}; return { ...q, name: i.name, high52: Math.max(i.high52 || 0, q.high || 0) || null, low52: i.low52 && q.low ? Math.min(i.low52, q.low) : i.low52 || null }; });
        if (merged.length) { rows = rankFromQuotes(list, merged); used = "kite"; }
      } catch (e) { errs.push(`Kite quotes failed (${String(e.message).slice(0, 100)})`); }
    } else if (!kc) errs.push("Kite is not logged in");
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
async function resolveHoldingSymbols(items) {
  const [map, stocks, fund] = await Promise.all([readJson(nameMapFile, {}), readWatchlist(), readFundamentals()]);
  const byName = new Map();
  for (const st of stocks) if (symOf(st)) byName.set(normName(st.company), { symbol: symOf(st), exchange: st.exchange || "NSE" });
  for (const [sym, f] of Object.entries(fund)) if (f.companyName && !byName.has(normName(f.companyName))) byName.set(normName(f.companyName), { symbol: sym, exchange: "NSE" });
  const out = []; let changed = false;
  for (const it of items) {
    const key = it.isin || normName(it.name), n = normName(it.name);
    if (map[key]) { out.push({ ...map[key], how: "saved" }); continue; }
    let hit = byName.get(n) || [...byName.entries()].find(([k]) => k && n && (k.startsWith(n) || n.startsWith(k)) && Math.min(k.length, n.length) >= 6)?.[1];
    let how = hit ? "watchlist" : null;
    if (!hit) {
      try {
        for (const q of [it.isin, it.name].filter(Boolean)) { const res = await searchScreener(q); if (res.length) { hit = { symbol: res[0].symbol, exchange: res[0].exchange, label: res[0].name }; how = "screener"; break; } await new Promise(r => setTimeout(r, 350)); }
      } catch (e) { out.push({ symbol: null, how: "error", error: e.message }); continue; }
    }
    if (hit) { map[key] = { symbol: hit.symbol, exchange: hit.exchange || "NSE", label: hit.label || null }; changed = true; }
    out.push(hit ? { ...map[key], how } : { symbol: null, how: "none" });
    await new Promise(r => setTimeout(r, 300));
  }
  if (changed) await writeJson(nameMapFile, map);
  return out;
}
const dividendsFile = path.join(DATA_DIR, "dividends-cache.json"), technicalsFile = path.join(DATA_DIR, "technicals-cache.json");
// Every valuation row also carries its dividend lens (from the cached dividend history) and the Value / Growth / Buy verdict.
async function computeRows() {
  const [stocks, fundamentals, divCache, sx, glOv] = await Promise.all([readWatchlist(), readFundamentals(), readJson(dividendsFile, {}), readJson(screenerExtraFile, {}), readJson(U.growthOverridesFile, {})]);
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
    if (fresh.length) console.log(`[alerts] ${fresh.map(e => e.title).join(" | ")}`);
  } finally { alertsBusy.delete(me); }
}
async function logVerdicts(rows) { const log = await readJson(U.valuationLogFile, {}); if (addSnapshots(log, rows, istDay())) await writeJson(U.valuationLogFile, log); }

// Fetch fundamentals for the given stocks and cache them. Sources (source = auto | screener | yahoo | nse):
// auto tries Screener.in, then Yahoo, then NSE; a cached entry is kept and only its market fields refreshed if every
// full source fails and NSE answers. Each source has its own cooldown after a 403/429 and is skipped while it is cooling.
async function runFundamentalsFetch(targets, force = false, source = process.env.FUNDAMENTALS_SOURCE || "auto") {
  const map = await readFundamentals();
  const fresh = e => e?.asOf && Date.now() - new Date(e.asOf).getTime() < 7 * 864e5;
  const order = source === "auto" ? ["screener", "yahoo", "nse"] : [source];
  const results = await mapLimit(targets, 1, async stock => {
    const symbol = symOf(stock);
    if (!force && fresh(map[symbol])) return { id: stock.id, company: stock.company, symbol, skipped: "Fetched within the last 7 days" };
    let entry = null, warnings = [], completeness = null, how = null, rateLimited = false, usedNetwork = false;
    const errors = [];
    let nse = null;
    for (const src of order) {
      if (entry) break;
      if (src === "nse" && stock.exchange === "BSE") { errors.push("NSE: not listed there (BSE stock)"); continue; }
      try {
        if (src === "screener") {
          if (screenerCooldown()) { errors.push("Screener cooling down"); continue; }
          usedNetwork = true; const r = await fetchScreener(stock); entry = r.entry; warnings = [...warnings, ...r.warnings]; how = "Screener"; completeness = "Screener";
          if (r.extra) saveScreenerExtra(symbol, { ids: { companyId: r.extra.companyId, warehouseId: r.extra.warehouseId }, div: { yield: r.extra.dividendYield, annual: r.extra.divAnnual, at: Date.now() }, ...(r.peersTable ? { peers: { table: r.peersTable, at: Date.now() } } : {}) }).catch(() => {});
        } else if (src === "yahoo") {
          if (yahooCooldown() > Date.now()) { errors.push("Yahoo cooling down"); continue; }
          usedNetwork = true; const r = await fetchFundamentalsForStock(stock); entry = r.entry; warnings = [...warnings, ...r.warnings]; completeness = r.completeness; how = "Yahoo";
        } else {
          usedNetwork = true; nse = await fetchNseQuote(symbol);
          const cached = map[symbol];
          if (cached && nse) { entry = refreshFromNse(cached, nse); how = "NSE refresh of cached statements"; completeness = "Cached + NSE"; }
          else if (nse) { entry = mergeNse(null, nse, stock); how = "NSE only (low confidence)"; completeness = "NSE-only"; }
        }
      } catch (error) { errors.push(`${src}: ${error.message}`); if (error.rateLimited) rateLimited = true; }
    }
    // Light NSE supplement for sector P/E when a full source succeeded and NSE is not cooling down.
    if (entry && stock.exchange !== "BSE" && how !== "NSE only (low confidence)" && !how.startsWith("NSE") && order.includes("nse") && !nseCooldown()) {
      try { nse = await fetchNseQuote(symbol); entry = mergeNse(entry, nse, stock); how += "+NSE"; } catch { /* optional */ }
    }
    if (usedNetwork) await new Promise(r => setTimeout(r, how?.startsWith("Screener") || order[0] === "screener" ? screenerConfig.spacingMs : 1200));
    if (!entry) { console.error(`[fundamentals] ${stock.company}: ${errors.join(" | ") || "no data"}`); return { id: stock.id, company: stock.company, symbol, error: errors.join("; ") || "No data from any source", rateLimited }; }
    if (errors.length) warnings = [...warnings, `Fallback used (${errors.join("; ")})`];
    return { id: stock.id, company: stock.company, symbol, entry: sanitizeEntry(entry), warnings, completeness, sources: how, rateLimited: false };
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
function kiteAccountsSummary(store) { return Object.entries(store.accounts || {}).map(([userId, a]) => ({ userId, broker: brokerOf(a), brokerName: BROKER_LABELS[brokerOf(a)] || brokerOf(a), clientId: a.clientId || userId, label: a.label, syncedAt: a.syncedAt, count: a.holdings?.length || 0, priceNote: a.priceNote || null, via: a.via || (brokerOf(a) === "zerodha" ? "mcp" : "api") })); }
// Combines every synced broker account into one row per symbol, and attaches what the rest of the app knows about it:
// valuation, thesis status, watchlist rating and a rule-based stance (accumulate / hold / ...).
async function kiteHoldingsView() {
  const [store, { stocks, fundamentals, rows: vrows }] = await Promise.all([readJson(U.kiteHoldingsFile, { accounts: {} }), computeRows()]);
  const accounts = Object.entries(store.accounts || {});
  const thesisBySym = accounts.length ? new Map((await thesisView()).rows.map(r => [r.symbol, r])) : new Map();
  const bySym = new Map(stocks.map(s => [symOf(s), s])), vBySym = new Map(vrows.map(r => [String(r.symbol || "").toUpperCase(), r]));
  const merged = new Map();
  // Dhan and Groww may return holdings without a price (no data plan). Value those at a live price another broker returned
  // for the same symbol, else at the watchlist price, and say so.
  const livePrice = new Map();
  for (const [, acct] of accounts) for (const h of acct.holdings || []) if (Number.isFinite(h.lastPrice) && !livePrice.has(h.symbol)) livePrice.set(h.symbol, h.lastPrice);
  for (const [userId, acct] of accounts) for (const h0 of acct.holdings || []) {
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
  const brokersHeld = [...new Set(accounts.map(([, a]) => brokerOf(a)))].map(b => BROKER_LABELS[b] || b);
  return { accounts: kiteAccountsSummary(store), brokers: brokersHeld, holdings, totals: { invested: sum("invested"), value: sum("value"), pnl: sum("pnl"), count: holdings.length, notInWatchlist: holdings.filter(h => !h.inWatchlist).length, watchlistNotHeld: stocks.filter(s => symOf(s) && !merged.has(symOf(s))).length, stance: { accumulate: count("Accumulate"), hold: count("Hold"), dontAdd: count("Hold (don't add)"), review: count("Review"), trim: count("Trim"), noView: count("No view") } } };
}
// Re-checks every thesis against the latest numbers. First-break dates and status flips are stored, and a flip is
// written to the change history (field "thesis") so it appears in Reports -> Change history.
async function thesisView() {
  const [store, { stocks, fundamentals, rows }, kiteStore] = await Promise.all([readJson(U.thesesFile, {}), computeRows(), readJson(U.kiteHoldingsFile, { accounts: {} })]);
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
const BACKUP_SECRET_FILES = /^(kite-session(-[\w-]+)?|broker-sessions|broker-credentials|broker-mcp)\.json$/;
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
  const store = await readJson(U.kiteHoldingsFile, { accounts: {} });
  for (const [id, a] of Object.entries(store.accounts || {})) {
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
    const meta = await readJson(userFile("meta.json"), {}), last = meta.lastPriceRefresh || null;
    if (weekdaysSince(last) >= 2) warnings.push({ id: "prices", level: "warn", text: `Watchlist prices were last refreshed ${last ? ageText(last) : "a while ago"}. Verdicts and buy zones use those prices.`, action: { label: "Refresh prices", refresh: true } });
    const map = await readFundamentals(), stale = stocks.filter(st => { const f = map[symOf(st)]; return f?.asOf && Date.now() - new Date(f.asOf).getTime() > 30 * 864e5; }).length;
    if (stale >= 5) warnings.push({ id: "fund", level: "info", text: `${stale} stocks have fundamentals older than 30 days.`, action: { label: "Valuation table", view: "valuation" } });
  }
  return { warnings, checkedAt: new Date().toISOString() };
}

// ---- Tax view: Zerodha Console tradebook → FIFO lots → long / short term, harvesting ideas ----
const taxFile = () => userFile("tradebook.json");
async function taxHoldings() {
  const [view, store] = await Promise.all([kiteHoldingsView(), readJson(U.kiteHoldingsFile, { accounts: {} })]);
  const isinOf = new Map(); for (const a of Object.values(store.accounts || {})) for (const h of a.holdings || []) if (h.isin) isinOf.set(h.symbol, h.isin);
  const out = view.holdings.map(h => ({ key: h.symbol, symbol: h.symbol, isin: isinOf.get(h.symbol) || null, name: h.company || h.symbol, qty: h.qty, price: h.qty ? h.value / h.qty : null, avgPrice: h.avgPrice, kind: "stock" }));
  const mf = new Map();
  for (const a of Object.values(store.accounts || {})) for (const f of a.mf || []) { const m = mf.get(f.isin) || { key: f.isin, symbol: null, isin: f.isin, name: f.name, qty: 0, cost: 0, price: f.nav, kind: "mf" }; m.qty += f.units; m.cost += (f.avgNav || 0) * f.units; mf.set(f.isin, m); }
  for (const m of mf.values()) out.push({ ...m, avgPrice: m.qty ? m.cost / m.qty : null });
  return out;
}
async function taxPage() { const st = await readJson(taxFile(), { trades: [], imports: [] }); return { ...taxView({ trades: st.trades, holdings: await taxHoldings(), today: istDay() }), imports: st.imports || [] }; }

// ---- Listed-company list for search (shared, refreshed weekly) ----
const scripFile = path.join(DATA_DIR, "scrip-master.json");
let scripMem = null, scripLoading = null;
async function scripMaster() {
  if (scripMem && Date.now() - scripMem.fetchedAt < 7 * 864e5) return scripMem;
  const saved = await readJson(scripFile, null);
  if (saved?.list?.length > 500) { scripMem = saved; if (Date.now() - saved.fetchedAt > 7 * 864e5) refreshScripMaster(); return saved; }
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
async function livePrices(items, maxAgeMs = 45e3) {
  const out = new Map(), need = [];
  for (const it of items) { const c = livePriceCache.get(`${it.exchange || "NSE"}:${it.symbol}`); if (c && Date.now() - c.at < maxAgeMs) out.set(it.symbol, c); else need.push(it); }
  if (need.length) {
    const kc = await anyKiteWithSession().catch(() => null);
    if (kc) for (const ex of ["NSE", "BSE"]) {
      const syms = need.filter(i => (i.exchange || "NSE") === ex).map(i => i.symbol); if (!syms.length) continue;
      try { for (const [k, q] of await kc.quotes(syms, ex)) { const v = { price: q.price, prevClose: q.close ?? null, source: "Kite", at: Date.now() }; out.set(k, v); livePriceCache.set(`${ex}:${k}`, v); } } catch { /* fall through */ }
    }
    const rest = need.filter(i => !out.has(i.symbol));
    if (rest.length) { try { for (const [k, q] of await yahooQuotes(rest.map(i => ({ symbol: i.symbol, exchange: i.exchange || "NSE" })))) if (q.price > 0) { const prev = Number.isFinite(q.pChange) ? q.price / (1 + q.pChange / 100) : null; const v = { price: q.price, prevClose: prev, source: "Yahoo", at: Date.now() }; out.set(k, v); livePriceCache.set(`${rest.find(i => i.symbol === k)?.exchange || "NSE"}:${k}`, v); } } catch { /* fall through */ } }
    const still = need.filter(i => !out.has(i.symbol));
    if (still.length) { // last resort: the saved watchlist / holdings price (marked as such)
      const [stocks, view] = await Promise.all([readWatchlist(), kiteHoldingsView().catch(() => ({ holdings: [] }))]);
      for (const i of still) { const st = stocks.find(x => symOf(x) === i.symbol), h = view.holdings.find(x => x.symbol === i.symbol); const p = h?.syncPrice ?? st?.price; if (p > 0) out.set(i.symbol, { price: p, prevClose: null, source: h?.syncPrice ? "last broker sync" : "saved price", at: Date.now() }); }
    }
  }
  return out;
}
async function swingView({ alerts = true } = {}) {
  const st = await readJson(swingFile(), {}), positions = st.positions || [], watch = st.watch || [];
  const prices = await livePrices([...positions, ...watch]);
  const view = evaluateSwing({ positions, watch, prices, settings: st.settings || {} });
  if (alerts && (positions.length || watch.length)) {
    const store = await readJson(U.alertsFile, { state: {}, events: [] });
    const { next, fresh } = diffSwingAlerts(st.alertState || {}, view, { events: store.events });
    if (fresh.length) { await writeJson(U.alertsFile, { ...store, events: mergeEvents(store.events, fresh) }); console.log(`[swing] ${fresh.map(e => e.title).join(" | ")}`); }
    if (JSON.stringify(next) !== JSON.stringify(st.alertState || {})) await writeJson(swingFile(), { ...st, alertState: next });
  }
  const closed = (st.closed || []).slice(0, 100);
  return { ...view, closed, realised: { count: closed.length, pnl: Math.round(closed.reduce((a, t) => a + t.pnl, 0)) }, marketOpen: marketIsOpen(), checkedAt: new Date().toISOString() };
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
async function usRows(symbols) {
  const [cache, ov] = await Promise.all([readJson(usCacheFile, {}), readJson(usGrowthFile(), {})]);
  const { prices, errors } = await usPrices(symbols);
  const rows = symbols.map(sym => {
    const c = cache[sym], p = prices[sym];
    if (!c?.series) return { symbol: sym, name: c?.name || null, price: p?.price ?? null, pending: !c || (!c.series && !c.error) || usQueue.has(sym), error: c?.error || null };
    const v = usValuation(c.series, p?.price ?? null, { growth: ov[sym] ?? null });
    return { symbol: sym, name: c.name, price: p?.price ?? null, priceDate: p?.date || null, priceSource: p?.source || null, high52: p?.high52 ?? null, low52: p?.low52 ?? null, fetchedAt: c.fetchedAt, error: v.error || null, ...v, why: undefined, years: undefined };
  });
  return { rows, priceErrors: errors };
}

// ---- Net worth: synced stocks + Kite mutual funds + everything entered by hand ----
const networthFile = () => userFile("networth.json");
async function syncedMutualFunds() {
  const store = await readJson(U.kiteHoldingsFile, { accounts: {} }), links = (await readJson(networthFile(), {})).links || {};
  const xr = (await readJson(U.fundsFile, { funds: [] })).funds;
  const out = [];
  for (const [userId, acct] of Object.entries(store.accounts || {})) for (const f of acct.mf || []) {
    const key = `${userId}:${f.isin}:${f.folio || ""}`, link = Object.hasOwn(links, key) ? links[key] : undefined;
    const auto = link === undefined ? matchFund(f.name, xr) : null;
    const fundId = link === undefined ? auto?.id || null : link && xr.some(x => x.id === link) ? link : null;
    out.push({ ...f, key, account: userId, accountLabel: acct.label || userId, syncedAt: acct.mfSyncedAt || acct.syncedAt, fundId, autoLinked: !!auto && link === undefined, xrayName: xr.find(x => x.id === fundId)?.name || null });
  }
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
  const accts = Object.entries((await readJson(U.kiteHoldingsFile, { accounts: {} })).accounts || {});
  const intl = accts.flatMap(([id, a]) => (a.us || []).map((u, i) => ({ key: `${id}:${u.symbol || i}`, name: `${u.name}${u.symbol ? ` (${u.symbol})` : ""} · ${a.label || id}`, value: u.value, invested: u.invested, syncedAt: a.syncedAt })));
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
  const mfAccounts = Object.entries((await readJson(U.kiteHoldingsFile, { accounts: {} })).accounts || {}).filter(([, a]) => (a.broker || "zerodha") === "zerodha" || Array.isArray(a.mf)).map(([id, a]) => ({ userId: id, label: a.label, mfSyncedAt: a.mfSyncedAt || null, mfError: a.mfError || null, mfCount: (a.mf || []).length }));
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
async function persistWatchlist(nextStocks, previousStocks) {
  const previous = previousStocks || await readWatchlist();
  await recordChanges(previous, nextStocks);
  await writeWatchlist(nextStocks);
}

async function yahooQuote(marketSymbol, exchange = "NSE") {
  const symbol = encodeURIComponent(`${marketSymbol}.${exchange === "BSE" ? "BO" : "NS"}`);
  const response = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1y&interval=1d`, { headers: { "User-Agent": "EquityWatchlist/0.1 research@localhost" } });
  if (!response.ok) throw new Error(`price feed HTTP ${response.status}`);
  const json = await response.json();
  const closes = json?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Number.isFinite) || [];
  if (!closes.length) throw new Error("no price observations returned");
  return { price: Number(closes.at(-1).toFixed(2)), low: Number(Math.min(...closes).toFixed(2)), high: Number(Math.max(...closes).toFixed(2)), source: "Yahoo Finance market feed" };
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
  const sym = String(stock.marketSymbol).toUpperCase(), errors = [];
  let quote = null;
  for (const src of PRICE_SOURCES) {
    try {
      if (src === "kite") { const p = kitePrices.get(sym); if (!p) continue; quote = { price: Number(p.toFixed(2)), source: "Kite MCP (Zerodha LTP)" }; }
      else if (src === "yahoo") quote = await yahooQuote(stock.marketSymbol, stock.exchange);
      else { quote = await fetchGoogleQuote(sym, { exchange: googleExchange(stock) }); plausible(stock, quote); }
    } catch (e) { quote = null; errors.push(`${src}: ${e.message}`); }
    if (quote) break;
  }
  if (!quote) throw new Error(errors.join(" | ") || "no price source available (check PRICE_SOURCES)");
  // Kite's LTP has no 52-week range. Borrow it from Yahoo/Google when the stored range is missing or older than a day.
  if (!(quote.low > 0 && quote.high > 0)) {
    const stale = !(stock.low > 0 && stock.high > 0) || Date.now() - new Date(stock.rangeUpdated || 0).getTime() > RANGE_MAX_AGE_MS;
    if (stale) for (const src of PRICE_SOURCES.filter(s => s !== "kite")) {
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
    const values = { ...stock, price: quote.price, low, high, ...(hasRange ? { rangeUpdated: new Date().toISOString() } : {}), updated: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), priceSource: quote.source, feedStatus: "Price refreshed" };
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
async function refreshWatchlist(stocks, withNews = true) { console.log(`[refresh] Starting ${stocks.length}-stock refresh${withNews ? " with news" : ""} (sources: ${PRICE_SOURCES.join(" → ")}).`); const kitePrices = await fetchKitePrices(stocks); const refreshed = await mapLimit(stocks, 3, stock => refreshOne(stock, withNews, kitePrices)); await persistWatchlist(refreshed, stocks); if (refreshed.some(s => s.feedStatus === "Price refreshed")) { lastPriceRefreshAt = new Date().toISOString(); await writeJson(userFile("meta.json"), { ...(await readJson(userFile("meta.json"), {})), lastPriceRefresh: lastPriceRefreshAt }); } console.log(`[refresh] Finished: ${refreshed.filter(s => s.feedStatus === "Price refreshed").length}/${stocks.length} prices refreshed.`); return refreshed; }
function marketIsOpen() { const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts().filter(p => p.type !== "literal").map(p => [p.type, p.value])); const minutes = Number(parts.hour) * 60 + Number(parts.minute); return !["Sat", "Sun"].includes(parts.weekday) && minutes >= 555 && minutes <= 930; }
// Swing alerts: every 5 minutes during market hours, per account (positions hitting the profit target or add levels).
setInterval(() => { if (marketIsOpen()) forEachUser(async () => { const st = await readJson(swingFile(), {}); if ((st.positions || []).length || (st.watch || []).length) await swingView(); }); }, 5 * 60 * 1000).unref();
// Background work runs once per account, each inside that account's own context (its files, its Kite login).
async function forEachUser(fn) { for (const u of auth.listUsers()) { try { await asUser(u, fn); } catch (e) { console.error(`[background] ${u.username}: ${e.message}`); } } }
setInterval(() => { if (marketIsOpen()) forEachUser(async () => { const stocks = await readWatchlist(); if (stocks.length) { await refreshWatchlist(stocks, false); await runAlerts((await computeRows()).rows); } }); }, 15 * 60 * 1000).unref();

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
    if (url.pathname === "/api/health") return reply(res, 200, { ok: true, lastPriceRefreshAt, marketOpen: marketIsOpen(), provider: `${PRICE_SOURCES.join(" → ")} price feeds + Google News RSS`, priceSources: PRICE_SOURCES, kiteEnabled: kite.config.enabled, scheduledRefresh: "Every 15 minutes during NSE cash-market hours", yahooCooldownUntil: yahooCooldown() || null, googleCooldownUntil: googleCooldown() || null });
    if (url.pathname === "/api/price-compare" && req.method === "GET") {
      // Side-by-side quote from every configured source for one symbol: the quickest way to see which feeds work from your network.
      const symbol = (url.searchParams.get("symbol") || "").trim().toUpperCase();
      if (!/^[A-Z0-9&-]{1,20}$/.test(symbol)) return reply(res, 400, { message: "Pass ?symbol=NSE_SYMBOL, for example ?symbol=RELIANCE." });
      const attempt = async fn => { try { return await fn(); } catch (e) { return { error: e.message }; } };
      const ex = url.searchParams.get("exchange") === "BSE" ? "BSE" : "NSE";
      const out = { symbol, yahoo: await attempt(() => yahooQuote(symbol, ex)), google: await attempt(() => fetchGoogleQuote(symbol, { exchange: ex === "BSE" ? "BOM" : googleConfig.exchange })) };
      out.kite = !kite.config.enabled ? { error: "disabled (KITE_MCP_ENABLED=0 in .env)" } : await attempt(async () => { const p = (await kite.ltp([symbol])).get(symbol); if (!p) throw new Error("no LTP returned"); return { price: p, source: "Kite MCP (Zerodha LTP)" }; });
      const prices = ["yahoo", "google", "kite"].map(k => out[k].price).filter(Number.isFinite);
      out.maxSpreadPct = prices.length > 1 ? Number(((Math.max(...prices) / Math.min(...prices) - 1) * 100).toFixed(2)) : null;
      return reply(res, 200, out);
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
        return reply(res, 200, { brokers: list, readOnlyRoutes: READ_ONLY_ROUTES, accounts: kiteAccountsSummary(await readJson(U.kiteHoldingsFile, { accounts: {} })) });
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
      if (op === "status" && req.method === "GET") return reply(res, 200, { ...(await kc.status()), readOnlyTools: READ_ONLY_TOOLS, accounts: kiteAccountsSummary(await readJson(U.kiteHoldingsFile, { accounts: {} })) });
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
        delete store.accounts[userId]; await writeJson(U.kiteHoldingsFile, store);
        return reply(res, 200, await kiteHoldingsView());
      }
      return reply(res, 404, { message: "Unknown Kite operation." });
    }
    if (url.pathname === "/api/freshness" && req.method === "GET") return reply(res, 200, await freshnessView());
    if (url.pathname === "/api/backup" && req.method === "GET") {
      const b = await makeBackup(url.searchParams.get("secrets") === "1");
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="equity-watchlist-${b.account}-${istDay()}.json"` });
      return res.end(JSON.stringify(b, null, 2));
    }
    if (url.pathname === "/api/restore" && req.method === "POST") {
      try { const b = await readBody(req); const names = await restoreBackup(b.backup, { replace: !!b.replace }); console.log(`[backup] ${currentUser().username} restored ${names.length} file(s).`); return reply(res, 200, { ok: true, restored: names }); }
      catch (e) { return reply(res, 400, { message: e.message }); }
    }
    if (url.pathname.startsWith("/api/tax")) {
      const op = url.pathname.slice("/api/tax".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) return reply(res, 200, await taxPage());
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown tax operation." });
        const b = await readBody(req), st = await readJson(taxFile(), { trades: [], imports: [] });
        if (op === "import") {
          let tables;
          if (b.data) { const buf = Buffer.from(String(b.data), "base64"); if (buf.length > 20e6) throw new Error("File is larger than 20 MB."); tables = buf.readUInt32LE(0) === 0x04034b50 ? readXlsx(buf) : [{ rows: parseDelimited(buf.toString("utf8")) }]; }
          else tables = [{ rows: parseDelimited(String(b.text || "")) }];
          const parsed = tables.map(t => parseTradebook(t.rows)).sort((a, z) => z.trades.length - a.trades.length)[0];
          if (!parsed?.trades.length) throw new Error(parsed?.note || "No trades found in that file.");
          const before = st.trades.length; st.trades = mergeTrades(st.trades, parsed.trades);
          if (st.trades.length > before) st.imports = [...(st.imports || []), { at: new Date().toISOString(), file: String(b.filename || "pasted").slice(0, 80), rows: parsed.trades.length, added: st.trades.length - before, from: parsed.trades[0].date, to: parsed.trades.at(-1).date }].slice(-30);
          if (st.trades.length > 50000) throw new Error("Too many trades (50,000 max).");
          await writeJson(taxFile(), st);
          return reply(res, 200, { ...(await taxPage()), imported: { rows: parsed.trades.length, added: st.trades.length - before, skipped: parsed.skipped } });
        }
        if (op === "clear") { await writeJson(taxFile(), { trades: [], imports: [] }); return reply(res, 200, await taxPage()); }
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
          const symbols = which === "popular" ? US_POPULAR : mine;
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
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown US operation." });
        const b = await readBody(req);
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
        if (req.method === "GET" && !op) return reply(res, 200, await swingView());
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown swing operation." });
        const b = await readBody(req), st = await readJson(swingFile(), {}); st.positions ||= []; st.watch ||= []; st.closed ||= [];
        const find = (list, i) => { const x = st[list].find(y => y.id === i); if (!x) throw new Error("That entry no longer exists."); return x; };
        if (op === "position") { const prev = b.id ? find("positions", b.id) : null; if (!prev && st.positions.length >= 100) throw new Error("At most 100 swing positions."); const p = sanitizePosition(b, prev); st.positions = prev ? st.positions.map(x => (x.id === p.id ? p : x)) : [...st.positions, p]; }
        else if (op === "watch") { const prev = b.id ? find("watch", b.id) : null; if (!prev && st.watch.length >= 100) throw new Error("At most 100 swing watchlist entries."); const w = sanitizeWatch(b, prev); st.watch = prev ? st.watch.map(x => (x.id === w.id ? w : x)) : [...st.watch, w]; }
        else if (op === "delete") { st.positions = st.positions.filter(x => x.id !== b.id); st.watch = st.watch.filter(x => x.id !== b.id); }
        else if (op === "buy") { const p = find("positions", b.id), q = Number(b.qty), pr = Number(b.price); if (!(q > 0 && Number.isInteger(q) && pr > 0)) throw new Error("Enter whole shares and a price."); st.positions = st.positions.map(x => (x.id === p.id ? applyBuy(x, q, pr) : x)); }
        else if (op === "sell") { const p = find("positions", b.id), r = applySell(p, Number(b.qty), Number(b.price)); st.positions = r.position ? st.positions.map(x => (x.id === p.id ? r.position : x)) : st.positions.filter(x => x.id !== p.id); st.closed = [r.trade, ...st.closed].slice(0, 500); }
        else if (op === "promote") { // a swing-watchlist stock was bought: move it to positions
          const w = find("watch", b.id), p = sanitizePosition({ symbol: w.symbol, exchange: w.exchange, name: w.name, qty: b.qty, avgPrice: b.price, limit: b.limit ?? w.amount, notes: w.notes }); st.watch = st.watch.filter(x => x.id !== w.id); st.positions.push(p);
        }
        else if (op === "settings") { const t = parseTargets(b.targets ?? b.targetPct), d = Number(b.dipPct); if (!t) throw new Error("Enter at least T1."); if (!(d > 0 && d <= 90)) throw new Error("Dip must be 1–90%."); st.settings = { targets: t, dipPct: d }; }
        else if (op === "parse") { const rows = parseSheet(b.text).slice(0, 100); const found = await resolveNames(rows.map(r => r.name)); return reply(res, 200, { rows: rows.map((r, i) => ({ ...r, ...found[i], sheetName: r.name })) }); }
        else if (op === "import") {
          for (const r of Array.isArray(b.rows) ? b.rows.slice(0, 100) : []) {
            if (r.kind === "position") { const ex = st.positions.find(x => x.symbol === String(r.symbol).toUpperCase()); const p = sanitizePosition({ ...r, addBelow: r.addBelow, addAmount: r.addAmount }, ex); st.positions = ex ? st.positions.map(x => (x.id === p.id ? p : x)) : [...st.positions, p]; }
            else { const ex = st.watch.find(x => x.symbol === String(r.symbol).toUpperCase()); const w = sanitizeWatch({ ...r, buyBelow: r.addBelow ?? r.buyBelow, amount: r.addAmount ?? r.amount }, ex); st.watch = ex ? st.watch.map(x => (x.id === w.id ? w : x)) : [...st.watch, w]; }
          }
        }
        else if (op === "resolve") return reply(res, 200, { results: await resolveNames([String(b.name || "")]) });
        else return reply(res, 404, { message: "Unknown swing operation." });
        await writeJson(swingFile(), st);
        return reply(res, 200, await swingView());
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
    if (url.pathname === "/api/stocks" && req.method === "GET") return reply(res, 200, { stocks: await readWatchlist() });
    if (url.pathname === "/api/history" && req.method === "GET") {
      const history = await readHistory();
      const id = url.searchParams.get("id");
      if (id) return reply(res, 200, { changes: history.changes.filter(c => String(c.id) === id), priceSeries: history.priceSeries[id] || [] });
      return reply(res, 200, history);
    }
    if (url.pathname === "/api/watchlist" && req.method === "POST") { const { stocks } = await readBody(req); if (!Array.isArray(stocks)) return reply(res, 400, { message: "stocks must be an array" }); await persistWatchlist(stocks); try { const st = await readLists(); await writeJson(U.listsFile, prune(st, stocks.map(symOf))); } catch {} return reply(res, 200, { ok: true, count: stocks.length }); }
    if (url.pathname === "/api/refresh" && req.method === "POST") { const { stocks } = await readBody(req); const target = Array.isArray(stocks) && stocks.length ? stocks : await readWatchlist(); if (!target.length) return reply(res, 400, { message: "Watchlist is empty. Open the app once to publish it." }); const refreshed = await refreshWatchlist(target, true); return reply(res, 200, { ok: true, stocks: refreshed, refreshed: refreshed.filter(s => s.feedStatus === "Price refreshed").length }); }
    if (url.pathname === "/api/valuation" && req.method === "GET") {
      const { fundamentals, rows } = await computeRows();
      await logVerdicts(rows); await runAlerts(rows);
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
      const results = await runFundamentalsFetch(targets, force, ["screener", "yahoo", "nse"].includes(source) ? source : "auto");
      // Rate-limited: keep the stock and try again by itself in 20 minutes (the timer keeps this user's context).
      const limited = results.filter(r => r.rateLimited).map(r => targets.find(t => t.company === r.company)).filter(Boolean).map(symOf);
      if (limited.length) setTimeout(() => queueFill(limited).catch(() => {}), 20 * 60e3).unref();
      return reply(res, 200, { results, saved: results.filter(r => r.entry).length, retryInMin: limited.length ? 20 : null });
    }
    if (url.pathname === "/api/valuation/performance" && req.method === "GET") return reply(res, 200, performance(await readJson(U.valuationLogFile, {}), Number(url.searchParams.get("minDays")) || 14));
    if (url.pathname === "/api/compare" && req.method === "GET") { const ref = await readJson(referenceFile, { reference: {} }); return reply(res, 200, { ...compare(await readFundamentals(), ref.reference || {}), referenceAsOf: ref.asOf || null }); }
    if (url.pathname.startsWith("/api/funds")) {
      const op = url.pathname.slice("/api/funds".length).replace(/^\//, "");
      try {
        if (req.method === "GET" && !op) { const st = await readJson(U.fundsFile, { funds: [] }); return reply(res, 200, { funds: st.funds.map(f => ({ id: f.id, name: f.name, asOf: f.asOf, count: f.holdings.length, updatedAt: f.updatedAt })) }); }
        if (req.method === "GET" && op === "view") {
          const st = await readJson(U.fundsFile, { funds: [] }), f = st.funds.find(x => x.id === url.searchParams.get("id"));
          if (!f) return reply(res, 404, { message: "Unknown fund." });
          const [{ rows }, view] = await Promise.all([computeRows(), kiteHoldingsView()]);
          const bySym = Object.fromEntries(rows.map(r => [String(r.symbol).toUpperCase(), r])), mine = new Map(view.holdings.map(h => [h.symbol, h.weightPct || 0]));
          const holdings = f.holdings.map(h => { const r = h.symbol ? bySym[h.symbol] : null; return { ...h, held: mine.has(h.symbol), pe: r?.pe ?? null, sectorPe: r?.sectorPe ?? r?.sectorPeEst ?? null, sectorPeEst: !r?.sectorPe && !!r?.sectorPeEst, view: r && Number.isFinite(r.ratio) ? r.view : null, verdict: r?.verdict?.label || null, verdictCls: r?.verdict?.cls || null, verdictKey: r?.verdict?.key || null, growth: r?.growthLens ? { verdict: r.growthLens.verdict, key: r.growthLens.key, growth: r.growthLens.growth, implied: r.growthLens.impliedGrowth } : null, roce: r ? (r.profile === "financial" ? r.roe : r.roce) : null, valued: !!(r && Number.isFinite(r.ratio)) }; });
          return reply(res, 200, { fund: { id: f.id, name: f.name, asOf: f.asOf, updatedAt: f.updatedAt }, holdings, summary: fundSummary(f.holdings, bySym, mine), pending: holdings.filter(h => h.symbol && !h.valued).length });
        }
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown fund operation." });
        const b = await readBody(req);
        if (op === "parse") {
          let tables;
          if (b.data) { const buf = Buffer.from(String(b.data), "base64"); if (buf.length > 15e6) throw new Error("File is larger than 15 MB."); tables = /\.xlsx$/i.test(b.filename || "") || buf.readUInt32LE(0) === 0x04034b50 ? readXlsx(buf) : [{ name: b.filename || "file", rows: parseDelimited(buf.toString("utf8")) }]; }
          else tables = [{ name: "Pasted table", rows: parseDelimited(b.text || "") }];
          const found = tables.map(t => { const x = extractHoldings(t.rows); const title = t.rows.slice(0, 6).flat().find(c => c && /fund|scheme/i.test(c)) || t.name; return { sheet: t.name, title: String(title).slice(0, 120), holdings: x.holdings, note: x.note }; }).filter(t => t.holdings.length >= 3).sort((a, z) => z.holdings.length - a.holdings.length);
          if (!found.length) return reply(res, 400, { message: "No equity holdings table found. Use the AMC's monthly portfolio file (Excel), or copy the holdings table (company name and % of net assets) from Value Research or Moneycontrol and paste it." });
          return reply(res, 200, { tables: found.slice(0, 40) });
        }
        if (op === "resolve") { const items = (Array.isArray(b.items) ? b.items : []).slice(0, 15).map(i => ({ name: String(i.name || "").slice(0, 120), isin: /^INE[A-Z0-9]{9}$/.test(i.isin || "") ? i.isin : null })); return reply(res, 200, { results: await resolveHoldingSymbols(items) }); }
        if (op === "save") {
          const name = String(b.name || "").trim().slice(0, 80); if (!name) throw new Error("Give the fund a name.");
          const holdings = (Array.isArray(b.holdings) ? b.holdings : []).map(h => ({ name: String(h.name || "").slice(0, 120), isin: /^INE[A-Z0-9]{9}$/.test(h.isin || "") ? h.isin : null, weight: Number(h.weight) || 0, sector: h.sector ? String(h.sector).slice(0, 60) : null, symbol: /^[A-Z0-9&-]{1,20}$/.test(String(h.symbol || "").toUpperCase()) ? String(h.symbol).toUpperCase() : null, exchange: h.exchange === "BSE" ? "BSE" : "NSE" })).filter(h => h.name && h.weight > 0).slice(0, 300);
          if (!holdings.length) throw new Error("No holdings to save.");
          const st = await readJson(U.fundsFile, { funds: [] }); const id = b.id && st.funds.some(f => f.id === b.id) ? b.id : `f${Date.now().toString(36)}`;
          const fund = { id, name, asOf: String(b.asOf || "").slice(0, 30) || null, updatedAt: new Date().toISOString(), holdings };
          st.funds = [...st.funds.filter(f => f.id !== id), fund]; await writeJson(U.fundsFile, st);
          // learn the confirmed mappings, track the stocks, and fetch their fundamentals in the background
          const map = await readJson(nameMapFile, {}); for (const h of holdings) if (h.symbol) map[h.isin || normName(h.name)] = { symbol: h.symbol, exchange: h.exchange, label: null }; await writeJson(nameMapFile, map);
          for (const h of holdings) if (h.symbol) await ensureInPool(h.symbol, h.exchange, h.name, `Added from fund X-ray (${name}).`);
          queueFill(holdings.filter(h => h.symbol).map(h => h.symbol), 150).catch(() => {});
          return reply(res, 200, { ok: true, id });
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
        if (req.method === "GET" && !op) { await writeJson(U.listsFile, st); return reply(res, 200, { lists: st.lists.map(l => ({ ...l, count: l.symbols.length })) }); }
        if (req.method !== "POST") return reply(res, 404, { message: "Unknown lists operation." });
        const b = await readBody(req); let created = null;
        if (op === "create") { const r = createList(st, { name: b.name, symbols: b.symbols }); st = r.store; created = r.list.id; }
        else if (op === "rename") st = renameList(st, b.id, b.name);
        else if (op === "delete") st = deleteList(st, b.id);
        else if (op === "members") { st = setMembers(st, b.id, { add: b.add, remove: b.remove }); if (Array.isArray(b.add) && b.add.length) setTimeout(() => queueFill(b.add).catch(() => {}), 500); }
        else return reply(res, 404, { message: "Unknown lists operation." });
        await writeJson(U.listsFile, st);
        return reply(res, 200, { lists: st.lists.map(l => ({ ...l, count: l.symbols.length })), created });
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
      if (want.length || !sx.div) {
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
      if (!dividend) errors.dividend = sx.div ? "Screener shows no dividend history for this company." : `Dividend data unavailable right now${errors.screener ? ` (${errors.screener})` : ""}.`;
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
    try { return reply(res, 200, await fs.readFile(filePath), types[path.extname(filePath)] || "application/octet-stream"); } catch (e) { if (e.code === "ENOENT") return reply(res, 404, { message: "Not found" }); throw e; }
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
async function serveFile(res, name) { return reply(res, 200, await fs.readFile(path.join(root, "public", name)), types[path.extname(name)]); }
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://app.local"), p = url.pathname, secure = isHttps(req), meta = { addr: clientAddr(req), ua: req.headers["user-agent"], place: placeOf(req) };
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
      return serveFile(res, p === "/login" ? "login.html" : p.slice(1));
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
server.listen(port, HOST, () => { console.log(`Equity tracker running at http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${port}${HOST !== "127.0.0.1" ? ` (listening on ${HOST})` : ""}`); const code = auth.ensureSetupCode(); if (code) console.log(`\n[auth] No owner account yet. Open the app and create it with this one-time setup code:\n\n    ${code}\n\n       (${process.env.SETUP_CODE ? "from SETUP_CODE in the environment" : `also saved in ${path.join(auth.dir, "setup-code.txt")}`}; it stops working once the owner exists)\n`); else { const o = auth.owner(); if (o) migrateLegacyData(o).catch(e => console.error(`[auth] migration: ${e.message}`)); } console.log(`[config] price sources: ${PRICE_SOURCES.join(" → ")}; Kite MCP: ${kiteDefaults.config.enabled ? "ENABLED" : "disabled"}; Angel One / Dhan / Groww: enabled (details on the Integrations tab)${loadedFromEnvFile.length ? `; from .env: ${loadedFromEnvFile.join(", ")}` : ""}`); });
// Docker / systemd stop: finish pending database writes before exiting.
for (const sig of ["SIGTERM", "SIGINT"]) process.once(sig, async () => { console.log(`[server] ${sig}: saving and shutting down…`); server.close(); await closeStorage().catch(() => {}); process.exit(0); });
