// Performance check: every page's API must answer fast even when the outside sites (NSE, Yahoo, Screener, AMFI, Stooq,
// Anthropic) hang. Starts the server on a throw-away data folder with a realistic account (108-stock watchlist, 40 holdings,
// swing positions, a dip list, US holdings, mutual funds), points every outside site at a server that never answers, then
// times each page's API cold (first call) and warm (median / 95th percentile of the next calls), the static files, and the
// live-price stream. Fails when a budget is broken or a number got much worse than the saved baseline.
//   npm run perf                  check (exit 1 on a problem)
//   npm run perf -- --update      also save these numbers as the new baseline (scripts/perf-baseline.json)
//   npm run perf -- --runs 15     more warm calls per endpoint
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RUNS = Number(arg("--runs", 8)), UPDATE = args.includes("--update"), baselineFile = path.join(root, "scripts", "perf-baseline.json");

// Budgets in ms. warm = 95th percentile of repeat calls; cold = the first call after start (caches empty).
const DEFAULT = { warm: 300, cold: 3000 };
const PAGES = [
  ["Value a stock (watchlist)", "/api/stocks"], ["Valuation table", "/api/valuation"], ["My holdings", "/api/holdings"],
  ["Swing trading", "/api/swing"], ["Swing summary (Home)", "/api/swing/summary"], ["Net worth", "/api/networth", { warm: 400 }],
  ["Mutual funds", "/api/mf"], ["US holdings", "/api/us/holdings"], ["US stocks list", "/api/us?list=mine"],
  ["Results & dividends", "/api/events/upcoming"], ["Returns vs index", "/api/returns", { warm: 500, cold: 4000 }], ["Alerts", "/api/alerts"],
  ["Watchlists", "/api/lists"], ["Price status", "/api/prices/status"], ["Tax view", "/api/tax"], ["Dividend income", "/api/dividend-income"],
  ["Accumulate", "/api/accumulate"], ["My price alerts", "/api/rules"], ["Model portfolio", "/api/model"], ["Focus list", "/api/portfolio/focus"],
  ["Ask AI status", "/api/ai/status"], ["Ask AI: what gets sent", "/api/ai/preview", { warm: 600 }], ["Smart indices", "/api/indices"], ["Market pulse (this week)", "/api/market/week"], ["Mutual fund X-ray", "/api/funds"], ["Favourites", "/api/favourites/view"], ["Smart index: Nifty500 Quality 50", "/api/indices/view?name=NIFTY500%20QUALITY%2050", { cold: 5000 }]
];
const STATIC = [["/", 120], ["/app.js", 120], ["/styles.css", 120]];
const STATIC_GZ_BUDGET_KB = 900; // all scripts + styles, compressed

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const pct = (arr, p) => { const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.ceil(p / 100 * a.length) - 1)]; };

async function seed(dataDir, userDir) {
  await fs.mkdir(userDir, { recursive: true });
  const watch = JSON.parse(await fs.readFile(path.join(root, "test", "fixtures", "perf-watchlist.json"), "utf8"));
  await fs.writeFile(path.join(userDir, "watchlist.json"), JSON.stringify(watch));
  await fs.copyFile(path.join(root, "test", "fixtures", "perf-fundamentals.json"), path.join(dataDir, "fundamentals-cache.json"));
  const syms = watch.map(s => s.marketSymbol || s.ticker).filter(Boolean);
  const holdings = syms.slice(0, 40).map((s, i) => ({ symbol: s, qty: 10 + i, avgPrice: 100 + i * 7, lastPrice: 110 + i * 7, exchange: "NSE" }));
  const mf = [1, 2, 3].map(i => ({ isin: `INF000P0${String(i).padStart(4, "0")}`, name: `Perf Fund ${i} Direct Growth`, units: 1000 * i, avgNav: 50, nav: 60, navDate: "2026-10-01", invested: 50000 * i, value: 60000 * i }));
  await fs.writeFile(path.join(userDir, "kite-holdings.json"), JSON.stringify({ accounts: { PF1234: { broker: "zerodha", label: "Perf main", syncedAt: new Date().toISOString(), mfSyncedAt: new Date().toISOString(), holdings, mf } } }));
  const at = new Date(Date.now() - 40 * 864e5).toISOString();
  const positions = syms.slice(40, 55).map((s, i) => ({ id: `p${i}`, symbol: s, exchange: "NSE", name: s, qty: 20 + i, avgPrice: 200 + i * 10, limit: 300000, lots: [{ qty: 20 + i, price: 200 + i * 10, at }], openedAt: at }));
  const watchItems = syms.slice(55, 75).map((s, i) => ({ id: `w${i}`, symbol: s, exchange: "NSE", name: s, list: i < 10 ? "dip" : null, buyBelow: 150 + i, amount: 100000, addedAt: at }));
  await fs.writeFile(path.join(userDir, "swing.json"), JSON.stringify({ positions, watch: watchItems, closed: [], settings: {}, cash: { balance: 500000, log: [] } }));
  await fs.writeFile(path.join(userDir, "other-holdings.json"), JSON.stringify({
    us: ["AAPL", "MSFT", "NVDA", "VOO", "GOOGL"].map((s, i) => ({ id: `u${i}`, source: "import", account: "Vested", symbol: s, name: s, qty: 5 + i, avgUsd: 100 + i * 20, investedUsd: (5 + i) * (100 + i * 20), importedAt: at })),
    mf: [{ id: "m1", source: "cas", isin: "INF846K01EW2", name: "Axis ELSS Tax Saver Fund - Direct Growth", folio: "1", units: 1234.5, cost: 100000, nav: 98, navDate: "2026-10-01", value: 120981, importedAt: at }]
  }));
}

async function main() {
  // Outside sites that accept the connection and never answer: the worst case for a page that waits on them.
  const sockets = new Set();
  const hang = http.createServer(() => { /* never answer */ }); hang.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  const hangPort = await freePort(); await new Promise(r => hang.listen(hangPort, "127.0.0.1", r));
  const H = `http://127.0.0.1:${hangPort}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-perf-")), port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "perf-setup-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", MARKET_ALWAYS_OPEN: "1", DIGEST: "0",
    NSE_BASE: H, NSE_ARCHIVE_BASE: H, YAHOO_CHART_BASE: H, SCREENER_BASE: H, STOOQ_BASE: H, AMFI_NAV_URL: `${H}/NAVAll.txt`, ANTHROPIC_BASE_URL: H, PRICE_SOURCES: "nse,yahoo", GOOGLE_FINANCE_BASE: H };
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  const problems = [], results = { endpoints: {}, static: {}, stream: null };
  try {
    for (let i = 0; i < 100 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    if (!log.includes("running at")) throw new Error(`server did not start:\n${log}`);
    const call = async (p, { cookie, body, enc } = {}) => {
      const t = performance.now();
      const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(enc ? { "Accept-Encoding": enc } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
      const buf = Buffer.from(await r.arrayBuffer());
      return { ms: performance.now() - t, status: r.status, buf, headers: r.headers, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
    };
    const setup = await call("/api/auth/setup", { body: { code: "perf-setup-code", username: "perfuser", name: "Perf", password: "perf-pass-phrase-1" } });
    if (setup.status !== 200) throw new Error(`setup failed: ${setup.status} ${setup.buf}`);
    const cookie = setup.cookie, me = JSON.parse((await call("/api/auth/me", { cookie })).buf);
    await seed(dataDir, path.join(dataDir, "users", me.user.id));

    for (const [label, url, budget = {}] of PAGES) {
      const b = { ...DEFAULT, ...budget };
      const cold = await call(url, { cookie });
      if (cold.status >= 500 || cold.status === 404) problems.push(`${label} (${url}): HTTP ${cold.status}`);
      const warm = []; for (let i = 0; i < RUNS; i++) warm.push((await call(url, { cookie })).ms);
      const r = { cold: Math.round(cold.ms), p50: Math.round(pct(warm, 50)), p95: Math.round(pct(warm, 95)), kb: Math.round(cold.buf.length / 1024), status: cold.status, budget: b };
      results.endpoints[url] = r;
      if (r.cold > b.cold) problems.push(`${label} (${url}): first call ${r.cold} ms > ${b.cold} ms`);
      if (r.p95 > b.warm) problems.push(`${label} (${url}): repeat calls p95 ${r.p95} ms > ${b.warm} ms`);
    }
    let gz = 0;
    const html = (await call("/", { cookie })).buf.toString("utf8");
    const assets = [...html.matchAll(/(?:src|href)="([a-z0-9_-]+\.(?:js|css))(?:\?[^"]*)?"/gi)].map(m => `/${m[1]}`);
    for (const a of [...new Set(assets)]) { const r = await call(a, { cookie, enc: "br, gzip" }); gz += r.buf.length; }
    for (const [url, budget] of STATIC) {
      const t = []; for (let i = 0; i < RUNS; i++) t.push((await call(url, { cookie, enc: "br, gzip" })).ms);
      results.static[url] = { p95: Math.round(pct(t, 95)), budget };
      if (pct(t, 95) > budget) problems.push(`static ${url}: p95 ${Math.round(pct(t, 95))} ms > ${budget} ms`);
    }
    results.static.totalCompressedKb = Math.round(gz / 1024);
    if (gz / 1024 > STATIC_GZ_BUDGET_KB) problems.push(`scripts + styles: ${Math.round(gz / 1024)} KB compressed > ${STATIC_GZ_BUDGET_KB} KB`);
    // live stream: the first event must arrive at once
    { const t = performance.now(); const ac = new AbortController(); const r = await fetch(`${base}/api/events`, { headers: { Cookie: cookie }, signal: ac.signal }); const rd = r.body.getReader(); await Promise.race([rd.read(), new Promise(ok => setTimeout(ok, 3000))]); results.stream = Math.round(performance.now() - t); ac.abort(); if (results.stream > 1000) problems.push(`live stream: first event after ${results.stream} ms > 1000 ms`); }
    // regressions against the saved baseline
    let base0 = null; try { base0 = JSON.parse(await fs.readFile(baselineFile, "utf8")); } catch { /* first run */ }
    if (base0) for (const [url, r] of Object.entries(results.endpoints)) {
      const o = base0.endpoints?.[url]; if (!o) continue;
      if (r.p95 > o.p95 * 1.5 + 40) problems.push(`${url}: repeat p95 ${r.p95} ms vs ${o.p95} ms in the baseline (slower)`);
      if (r.cold > o.cold * 1.5 + 300) problems.push(`${url}: first call ${r.cold} ms vs ${o.cold} ms in the baseline (slower)`);
    }
    // report
    const rows = Object.entries(results.endpoints).map(([url, r]) => { const o = base0?.endpoints?.[url]; return `${url.padEnd(26)} ${String(r.cold).padStart(6)} ${String(r.p50).padStart(5)} ${String(r.p95).padStart(5)} ${String(r.kb).padStart(6)}  ${o ? `${o.cold}/${o.p95}` : "—"}`; });
    console.log(`\nAPI (ms, outside sites hanging)   cold   p50   p95     KB  baseline cold/p95\n${rows.join("\n")}`);
    console.log(`\nstatic p95: ${Object.entries(results.static).filter(([k]) => k.startsWith("/")).map(([k, v]) => `${k} ${v.p95} ms`).join(", ")} · scripts + styles ${results.static.totalCompressedKb} KB compressed · live stream first event ${results.stream} ms`);
    if (UPDATE) { await fs.writeFile(baselineFile, JSON.stringify({ at: new Date().toISOString(), node: process.version, ...results }, null, 2)); console.log(`baseline saved: ${path.relative(root, baselineFile)}`); }
  } finally {
    child.kill(); for (const s of sockets) s.destroy(); hang.close();
    await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
  }
  if (problems.length) { console.log(`\nperf: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n - ${problems.join("\n - ")}`); process.exit(1); }
  console.log("\nperf: all within budget");
}
main().catch(e => { console.error(e); process.exit(1); });
