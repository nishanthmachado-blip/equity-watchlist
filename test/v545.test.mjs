import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { moneyMapData, buildMoneyMap, lakhCrore } from "../moneymap.mjs";

// read one file out of a zip (central directory)
function unzipText(buf, name) {
  let e = buf.length - 22; while (e > 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  let p = buf.readUInt32LE(e + 16);
  for (let i = 0; i < buf.readUInt16LE(e + 10); i++) {
    const n = buf.readUInt16LE(p + 28), x = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42), fn = buf.toString("utf8", p + 46, p + 46 + n);
    if (fn === name) { const ln = buf.readUInt16LE(off + 26), lx = buf.readUInt16LE(off + 28), size = buf.readUInt32LE(p + 20), m = buf.readUInt16LE(off + 8), d = buf.subarray(off + 30 + ln + lx, off + 30 + ln + lx + size); return (m === 8 ? zlib.inflateRawSync(d) : d).toString("utf8"); }
    p += 46 + n + x + c;
  }
  return null;
}
const plan = [{ name: "Rent", amount: 47500, type: "needs" }, { name: "Maintainance", amount: 5500, type: "needs" }, { name: "Car Cleaning", amount: 1500, type: "wants" }, { name: "Maid Salary", amount: 25000, type: "needs" }, { name: "Grocery", amount: 15000, type: "needs" }, { name: "Petrol", amount: 2000, type: "needs" },
  { name: "Mom/Dad", amount: 20000, type: "wants" }, { name: "Kids Van", amount: 4000, type: "needs" }, { name: "Credit Card", amount: 8000, type: "unplanned" }, { name: "MF", amount: 10500, type: "invest" }, { name: "PPF", amount: 12500, type: "invest" }, { name: "US Stocks", amount: 20000, type: "invest" }, { name: "Crypto", amount: 2000, type: "invest" }];
const entries = [{ date: "2026-10-02", item: "Grocery", amount: 6810, category: "Groceries", mode: "Pluxee" }, { date: "2026-10-09", item: "Swiggy", amount: 900, category: "Food delivery & eating out", mode: "Credit card" }, { date: "2026-10-15", item: "Netflix", amount: 649, category: "Entertainment", mode: "Credit card" }, { date: "2026-10-15", item: "Bike Service", amount: 3489, category: "Vehicle", mode: "Credit card" }];
const nw = [{ category: "mf", name: "PPFAS", value: 2100000 }, { category: "epf", name: "EPF", value: 4000000 }, { category: "ppf", name: "PPF", value: 1400000 }, { category: "crypto", name: "CoinDCX", value: 30000 }, { kind: "liability", category: "homeloan", name: "Loan", value: 9 }];

test("money map: lakh / crore labels", () => {
  assert.equal(lakhCrore(21752449), "₹2.18 Cr"); assert.equal(lakhCrore(3060000), "₹30.60 L"); assert.equal(lakhCrore(-121727), "-₹1.22 L"); assert.equal(lakhCrore(99999), "");
});
test("money map: budget lines and daily spends land in the template's rows; actual vs budget; portfolio from net worth", () => {
  const d = moneyMapData({ month: "2026-10", label: "October 2026", data: { income: [{ name: "Salary", amount: 198000 }], plan, entries }, nwLines: nw });
  assert.equal(d.B[4], 53000, "rent + maintenance"); assert.equal(d.B[6], 6810, "grocery uses what was spent"); assert.equal(d.B[7], 25000); assert.equal(d.B[8], 1500 + 3489, "car cleaning + bike service, not the credit card bill");
  assert.equal(d.B[12], 4000); assert.equal(d.B[15], 20000); assert.equal(d.B[17], 2000, "petrol: no spends logged, so the budget"); assert.equal(d.B[21], 900); assert.equal(d.B[24], 649); assert.equal(d.B[30], 8000);
  assert.deepEqual([d.E[5], d.E[6], d.E[7], d.E[9]], [10500, 20000, 12500, 2000]);
  assert.deepEqual([d.E[24], d.E[27], d.E[34]], [2100000, 5400000, 30000]);
  assert.ok(d.details.some(x => x[3] === "Credit Card" && /count twice/.test(x[2])));
  const b = moneyMapData({ month: "2026-10", label: "x", data: { plan, entries }, basis: "budget" }); assert.equal(b.B[6], 15000, "budget basis");
  const x = buildMoneyMap(d), sheet = unzipText(x, "xl/worksheets/sheet1.xml"), wb = unzipText(x, "xl/workbook.xml");
  assert.match(wb, /Money Map.*Details.*Spends/); assert.match(wb, /fullCalcOnLoad="1"/);
  assert.match(sheet, /<c r="B4" s="5"><v>53000<\/v><\/c>/); assert.match(sheet, /<c r="E12" s="8"><f>SUM\(E5:E11\)<\/f><v>45000<\/v>/); assert.match(sheet, /<f>\(E12\)-\(B32\)<\/f>/); assert.match(sheet, /TOTAL PORTFOLIO VALUE/);
  assert.match(sheet, /<c r="F27" s="13" t="str"><f>IF\(ABS\(E27\)&gt;=10000000.*<v>₹54.00 L<\/v><\/c>/, "lakh label beside the EPF / PPF balance");
  assert.match(sheet, /<c r="F35" s="13" t="str">.*<v>₹75.30 L<\/v>/); assert.match(sheet, /<c r="E21" s="16">/, "the surplus keeps its sign: (₹…)");
  assert.match(unzipText(x, "xl/worksheets/sheet3.xml"), /Bike Service/);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: Money Map download is per login", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-545-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c545", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); return { status: r.status, buf, type: r.headers.get("content-type"), disp: r.headers.get("content-disposition"), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c545", username: "owner", password: "owner-pass-phrase" } })).cookie;
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    assert.equal((await call("/api/expenses/money-map.xlsx?month=2026-10")).status, 401);
    await call("/api/expenses/plan", { cookie: owner, body: { month: "2026-10", income: [{ name: "Salary", amount: 198000 }], plan: [{ name: "Rent", amount: 47500, type: "needs" }, { name: "MF", amount: 10500, type: "invest" }] } });
    const x = await call("/api/expenses/money-map.xlsx?month=2026-10", { cookie: owner });
    assert.equal(x.status, 200); assert.match(x.type, /spreadsheetml/); assert.match(x.disp, /Money-Map-2026-10\.xlsx/);
    assert.match(unzipText(x.buf, "xl/worksheets/sheet1.xml"), /<c r="B4" s="5"><v>47500<\/v>/);
    const f = await call("/api/expenses/money-map.xlsx?month=2026-10", { cookie: friend });
    assert.doesNotMatch(unzipText(f.buf, "xl/worksheets/sheet1.xml"), /47500/, "the other login gets an empty map");
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
