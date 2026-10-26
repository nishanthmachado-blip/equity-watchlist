import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { exportRows, toCsvAll, toSheets, parseImport, parseDay } from "../expensesio.mjs";
import { buildXlsx } from "../xlsx.mjs";
import { readSheetFile } from "../funds.mjs";

const months = { "2026-10": { income: [{ id: "xa1", name: "Salary in Hand", amount: 198000 }], plan: [{ id: "xb1", name: "Rent", amount: 47500, bank: "HDFC", type: "needs", done: true }, { id: "xb2", name: "Parag Parikh Flexi Cap", amount: 33000, bank: null, type: "invest", done: true }],
  invested: { "parag parikh flexi cap": { done: true, actual: 25000 } },
  entries: [{ id: "xc1", date: "2026-10-02", item: "Grocery, Dmart", amount: 6810, mode: "Pluxee", category: "Groceries", note: "monthly \"big\" shop" }, { id: "xc2", date: "2026-10-12", item: "Her phone bill", amount: 999, mode: "GPay", category: "Bills & recharges", note: null, share: { person: "Sophia", dir: "owed", amount: 999 } }],
  settlements: [{ id: "xd1", date: "2026-10-20", person: "Sophia", amount: 2000, dir: "paid", note: "UPI" }] } };
const check = p => {
  const m = p.months["2026-10"]; assert.ok(m, JSON.stringify(p.errors));
  assert.equal(m.spends.length, 2); assert.equal(m.spends[0].item, "Grocery, Dmart"); assert.equal(m.spends[0].note, 'monthly "big" shop'); assert.equal(m.spends[0].category, "Groceries");
  assert.deepEqual(m.spends[1].share, { person: "Sophia", dir: "owed" });
  assert.deepEqual(m.budget.map(b => [b.name, b.amount, b.type, b.done, b.actual]), [["Rent", 47500, "needs", true, null], ["Parag Parikh Flexi Cap", 33000, "invest", true, 25000]]);
  assert.deepEqual(m.income, [{ name: "Salary in Hand", amount: 198000 }]);
  assert.deepEqual(m.settle.map(x => [x.person, x.amount, x.dir]), [["Sophia", 2000, "paid"]]);
  assert.equal(p.errors.length, 0, p.errors.join("; "));
};
test("export → CSV → import gives the same month back", () => {
  const csv = toCsvAll(exportRows(months, ["2026-10"]));
  assert.match(csv.split("\n")[0], /^Section,Month,Date/);
  const p = parseImport(readSheetFile(Buffer.from(csv), "x.csv")); check(p); assert.equal(p.kind, "csv");
});
test("export → Excel → import gives the same month back", () => {
  const p = parseImport(readSheetFile(buildXlsx(toSheets(exportRows(months, ["2026-10"]))), "x.xlsx")); check(p); assert.equal(p.kind, "excel");
});
test("a plain list of spends, with Indian dates, Excel day numbers and bad rows", () => {
  const p = parseImport([{ name: "Sheet1", rows: [["Date", "Item", "Amount", "Mode"], ["05-10-2026", "Milk", "81", "GPay"], ["46301", "Petrol", "500", ""], ["", "No date", "10", ""], ["06/10/2026", "Free", "", ""]] }]);
  assert.deepEqual(p.months["2026-10"].spends.map(s => [s.date, s.item, s.amount, s.mode]), [["2026-10-05", "Milk", 81, "GPay"], ["2026-10-06", "Petrol", 500, null]]);
  assert.equal(p.errors.length, 2); assert.equal(p.kind, "spends");
  assert.equal(parseDay("5 Oct 2026"), "2026-10-05"); assert.equal(parseDay("2026-1-7"), "2026-01-07"); assert.equal(parseDay("hello"), null);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: import adds without duplicates, replace swaps the month, dry run saves nothing, per login", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-557-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c557", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* file */ } return { status: r.status, json, buf, type: r.headers.get("content-type"), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c557", username: "owner", password: "owner-pass-phrase" } })).cookie;
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    const csv = "Date,Item,Amount,Paid by,Category\n02-10-2026,Grocery,6810,Pluxee,\n03-10-2026,Petrol,300,GPay,\n";
    const data = Buffer.from(csv).toString("base64");
    const dry = await call("/api/expenses/import", { cookie: owner, body: { month: "2026-10", data, name: "s.csv", dryRun: true } });
    assert.equal(dry.status, 200, JSON.stringify(dry.json)); assert.equal(dry.json.importPreview.total.added, 2); assert.equal(dry.json.data, null, "dry run saves nothing");
    let r = await call("/api/expenses/import", { cookie: owner, body: { month: "2026-10", data, name: "s.csv" } });
    assert.equal(r.json.data.entries.length, 2); assert.match(r.json.notice, /2 spends/);
    r = await call("/api/expenses/import", { cookie: owner, body: { month: "2026-10", data, name: "s.csv" } });
    assert.equal(r.json.data.entries.length, 2, "same rows again are skipped"); assert.match(r.json.notice, /2 already there/);
    const x = await call("/api/expenses/export.xlsx?scope=month&month=2026-10", { cookie: owner });
    assert.match(x.type, /spreadsheetml/);
    const p = parseImport(readSheetFile(x.buf, "e.xlsx")); assert.equal(p.months["2026-10"].spends.length, 2);
    const one = Buffer.from("Date,Item,Amount\n10-10-2026,Milk,81\n").toString("base64");
    r = await call("/api/expenses/import", { cookie: owner, body: { month: "2026-10", data: one, name: "m.csv", mode: "replace" } });
    assert.deepEqual(r.json.data.entries.map(e => e.item), ["Milk"]);
    const c = await call("/api/expenses/export.csv?scope=all", { cookie: owner }); assert.match(c.buf.toString(), /Spend,2026-10,2026-10-10,Milk,81/);
    const f = await call("/api/expenses?month=2026-10", { cookie: friend }); assert.equal(f.json.data, null, "the other login sees nothing");
    assert.equal((await call("/api/expenses/import", { cookie: owner, body: { month: "2026-10", data: Buffer.from("hello").toString("base64"), name: "x.csv" } })).status, 400);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
