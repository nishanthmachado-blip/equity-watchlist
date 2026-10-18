import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Fund X-ray symbols come from NSE's ISIN list and exact company names even when Screener refuses every search, and a
// fund saved earlier with unmatched holdings is fixed in the background when it is opened.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const EQ = ["SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING, PAID UP VALUE, MARKET LOT, ISIN NUMBER, FACE VALUE",
  "CANBK,Canara Bank,EQ,23-DEC-2002,10,1,INE476A01022,2", "SBIN,State Bank of India,EQ,01-MAR-1995,1,1,INE062A01020,1", "TITAN,Titan Company Limited,EQ,01-JUN-1996,1,1,INE280A01028,1",
  ...Array.from({ length: 600 }, (_, i) => `FILL${i},Filler Company ${i} Limited,EQ,01-JAN-2000,1,1,INEZ${String(i).padStart(3, "0")}01015,1`)].join("\n");
test("x-ray: holdings match by ISIN / name without Screener; saved funds are fixed when opened", async () => {
  let screenerHits = 0;
  const fake = http.createServer((req, res) => {
    if (req.url.startsWith("/content/equities/EQUITY_L.csv")) { res.writeHead(200, { "Content-Type": "text/csv" }); return res.end(EQ); }
    if (req.url.includes("/api/company/search")) screenerHits++;
    res.writeHead(429); res.end("slow down");
  });
  const fport = await freePort(); await new Promise(r => fake.listen(fport, "127.0.0.1", r));
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-xm-")), port = await freePort(), base = `http://127.0.0.1:${port}`, F = `http://127.0.0.1:${fport}`;
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", SETUP_CODE: "xm-code", EOD: "0", BACKUP: "0", PRICE_SOURCES: "none",
    NSE_BASE: F, NSE_ARCHIVE_BASE: F, SCREENER_BASE: F, YAHOO_CHART_BASE: F, AMFI_NAV_URL: `${F}/nav`, NIFTYINDICES_BASE: F, MFDATA_BASE: F }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { status: r.status, json, text, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "xm-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    // upload preview: matched by ISIN and by exact name, with no Screener search needed
    const r = await call("/api/funds/resolve", { cookie: owner, body: { items: [{ name: "Canara Bank", isin: "INE476A01022" }, { name: "Titan Company Limited", isin: null }, { name: "Unknown Private Ltd", isin: null }] } });
    assert.deepEqual(r.json.results.map(x => [x.symbol, x.how]), [["CANBK", "isin"], ["TITAN", "list"], [null, "later"]]);
    // a fund saved earlier without symbols is matched in the background when opened
    const saved = await call("/api/funds/save", { cookie: owner, body: { name: "Bandhan Small Cap", holdings: [{ name: "State Bank of India", isin: "INE062A01020", weight: 2 }, { name: "Canara Bank", isin: "INE476A01022", weight: 1 }, { name: "Mystery Ltd", weight: 0.5 }] } });
    assert.equal(saved.status, 200, saved.text);
    let v = (await call(`/api/funds/view?id=${saved.json.id}`, { cookie: owner })).json;
    assert.equal(v.missing, 3); assert.equal(v.matching, true, "matching starts in the background");
    for (let i = 0; i < 40 && v.holdings.some(h => h.name === "State Bank of India" && !h.symbol); i++) { await new Promise(r => setTimeout(r, 150)); v = (await call(`/api/funds/view?id=${saved.json.id}`, { cookie: owner })).json; }
    assert.deepEqual(v.holdings.map(h => [h.name, h.symbol]), [["State Bank of India", "SBIN"], ["Canara Bank", "CANBK"], ["Mystery Ltd", null]]);
    assert.ok(screenerHits <= 20, `Screener searches are capped (${screenerHits})`);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); fake.close(); }
});
