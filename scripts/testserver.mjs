// A throw-away server for the checks (perf, mobile): its own data folder, a realistic account, outside sites pointed at
// a server that never answers. startTestServer() → { base, cookie, dataDir, userDir, stop() }
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";

const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
export const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });

export async function seed(dataDir, userDir) {
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

export async function startTestServer({ prefix = "ew-check-" } = {}) {
  const sockets = new Set();
  const hang = http.createServer(() => { /* never answer */ }); hang.on("connection", s => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  const hangPort = await freePort(); await new Promise(r => hang.listen(hangPort, "127.0.0.1", r));
  const H = `http://127.0.0.1:${hangPort}`;
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix)), port = await freePort(), base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "perf-setup-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", MARKET_ALWAYS_OPEN: "1", DIGEST: "0",
    NSE_BASE: H, NSE_ARCHIVE_BASE: H, YAHOO_CHART_BASE: H, SCREENER_BASE: H, STOOQ_BASE: H, AMFI_NAV_URL: `${H}/NAVAll.txt`, ANTHROPIC_BASE_URL: H, PRICE_SOURCES: "nse,yahoo", GOOGLE_FINANCE_BASE: H };
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => { log += d; }); child.stderr.on("data", d => { log += d; });
  const stop = async () => { child.kill(); for (const s of sockets) s.destroy(); hang.close(); await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {}); };
  try {
    for (let i = 0; i < 100 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    if (!log.includes("running at")) throw new Error(`server did not start:\n${log}`);
    const post = (p, body, cookie) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const setup = await post("/api/auth/setup", { code: "perf-setup-code", username: "perfuser", name: "Perf", password: "perf-pass-phrase-1" });
    if (setup.status !== 200) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
    const cookie = (setup.headers.get("set-cookie") || "").split(";")[0];
    const me = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).json(), userDir = path.join(dataDir, "users", me.user.id);
    await seed(dataDir, userDir);
    return { base, cookie, dataDir, userDir, stop, log: () => log };
  } catch (e) { await stop(); throw e; }
}
