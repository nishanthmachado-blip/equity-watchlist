import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defaultBucket, sanitizeBucketPlan, bucketView } from "../buckets.mjs";
import { parseLogPaste, parsePlanPaste, monthSummary, yearReport, fyMonths, guessCategory, sanitizeEntry, newMonth, toCsv, toTemplate } from "../expenses.mjs";

test("buckets: lines placed by type and fund category; safety sized in months; moves and goals", () => {
  assert.equal(defaultBucket({ category: "mf", name: "Tata Arbitrage Fund" }), "safety");
  assert.equal(defaultBucket({ category: "mf", name: "X", fundCategory: "Hybrid Scheme - Balanced Advantage" }), "short");
  assert.equal(defaultBucket({ category: "mf", name: "Parag Parikh Flexi Cap Fund" }), "short");
  assert.equal(defaultBucket({ category: "mf", name: "Nippon Small Cap Fund" }), "long");
  assert.equal(defaultBucket({ category: "ppf" }), "short"); assert.equal(defaultBucket({ category: "nps" }), "retirement"); assert.equal(defaultBucket({ category: "epf" }), "retirement");
  assert.equal(defaultBucket({ category: "crypto" }), "long"); assert.equal(defaultBucket({ category: "realestate" }), "none"); assert.equal(defaultBucket({ category: "cash" }), "safety");
  const lines = [{ id: "c", category: "cash", name: "Bank", value: 800000 }, { id: "a", category: "mf", name: "Arbitrage Fund", value: 4200000 }, { id: "p", category: "ppf", name: "PPF", value: 1500000 }, { id: "s", category: "stocks", name: "Zerodha", value: 3000000 }, { id: "n", category: "nps", name: "NPS", value: 700000 }, { id: "h", category: "realestate", name: "Home", value: 9000000 }, { id: "l", kind: "liability", category: "homeloan", name: "Loan", value: 100 }];
  let plan = sanitizeBucketPlan({});
  assert.deepEqual([plan.monthly, plan.minMonths, plan.maxMonths], [100000, 12, 36]); assert.deepEqual(plan.goals.map(g => g.name), ["House", "Kids education"]);
  let v = bucketView(lines, plan), S = v.buckets.find(b => b.id === "safety");
  assert.equal(S.value, 5000000); assert.equal(S.months, 50); assert.equal(S.status, "high"); assert.match(v.actions[0].text, /about ₹14,00,000 could move/);
  assert.equal(v.outside[0].name, "Home"); assert.equal(v.total, 10200000);
  plan = sanitizeBucketPlan({ assign: { a: "short" }, goalOf: { p: "g-house" }, monthly: "1,20,000", targets: { long: 50 } }, plan);
  v = bucketView(lines, plan); S = v.buckets.find(b => b.id === "safety");
  assert.equal(S.status, "low"); assert.equal(S.months, 6.7); assert.equal(v.buckets.find(b => b.id === "short").lines.find(l => l.id === "a").moved, true);
  assert.equal(v.goals.find(g => g.name === "House").value, 1500000);
  assert.ok(v.actions.some(a => a.bucket === "long" && /target/.test(a.text)));
  plan = sanitizeBucketPlan({ assign: { a: "auto" } }, plan); assert.equal(plan.assign.a, undefined);
  assert.equal(sanitizeBucketPlan({ assign: { x: "nonsense" } }).assign.x, undefined);
});

test("expenses: your sheet's daily list and budget block paste; categories guessed and learned", () => {
  const T = r => r.join("\t");
  const log = [T(["", "", "", "", "Pluxee", "Gpay", "Credit Card", "Sophia"]), T(["02-10-2026", "Milk", "81", "Grocery", "6810"]), T(["", "", "", "", "", "248"]), T(["03-10-2026", "Milk", "27", "Petrol (Activa )", "", "300"]), T(["06-10-2026", "Milk", "81", "Zepto", "", "", "", "392"]), T(["09-10-2026", "Milk", "81", "Swiggy", "371", "", "900"]), T(["15-11-2026", "Chicken", "770"])].join("\n");
  const e = parseLogPaste(log, { month: "2026-10", modes: ["Pluxee", "GPay", "Credit card", "Cash"] });
  assert.deepEqual(e.slice(0, 5).map(x => [x.date, x.item, x.amount, x.mode]), [["2026-10-02", "Milk", 81, null], ["2026-10-02", "Grocery", 6810, "Pluxee"], ["2026-10-02", "Grocery", 248, "GPay"], ["2026-10-03", "Milk", 27, null], ["2026-10-03", "Petrol", 300, "GPay"]]);
  assert.ok(e.some(x => x.item === "Zepto" && x.mode === "Sophia"), "a new payment method from the header");
  assert.ok(e.some(x => x.item === "Swiggy" && x.amount === 900 && x.mode === "Credit card"));
  const p = parsePlanPaste(["Salary in Hand\t198000", "SOFi Contribution\t55000", "Total\t253000", "Rent\t47500\tHDFC\tExpense\tNEEDS\tDONE", "Car Cleaning\t1500\tAXIS\tExpense\tWANTS\tDONE", "Kids Expense\t\tAXIS\tExpense\tNEEDS", "MF\t10500\tAXIS\tInvest\tINVEST\tDONE", "Credit Card\t8000\t\tExpense\t\tDONE", "Total expenses monlty\t180815", "Saved\t72185"].join("\n"));
  assert.deepEqual(p.income.map(i => i.amount), [198000, 55000]);
  assert.deepEqual(p.plan.map(x => [x.name, x.amount ?? null, x.bank, x.type, x.done]), [["Rent", 47500, "HDFC", "needs", true], ["Car Cleaning", 1500, "AXIS", "wants", true], ["Kids Expense", null, "AXIS", "needs", false], ["MF", 10500, "AXIS", "invest", true], ["Credit Card", 8000, null, "unplanned", true]]);
  assert.equal(guessCategory("Big Basket"), "Groceries"); assert.equal(guessCategory("Bike Service"), "Vehicle"); assert.equal(guessCategory("Mobile recharge"), "Bills & recharges"); assert.equal(guessCategory("Chicken"), "Meat & fish");
  assert.equal(guessCategory("Mango Mist", { "mango mist": "Shopping" }), "Shopping");
  assert.throws(() => sanitizeEntry({ date: "2026-11-01", item: "x", amount: 5 }, { month: "2026-10" }), /Pick a date in 2026-10/);
});

test("expenses: standard monthly budget: every new month starts from it, nothing done; unplanned lines stay unplanned", () => {
  const p = parsePlanPaste("Salary in Hand  198000\nRent  47500  HDFC  Expense  NEEDS  DONE\nAdditional  AXIS  Expense  WANTS\nCredit Card  8000  Expense  DONE\nMF  10500  AXIS  Invest  INVEST  DONE");
  assert.deepEqual(p.plan.map(x => x.type), ["needs", "unplanned", "unplanned", "invest"]);
  const t = toTemplate({ income: p.income, plan: p.plan.map(x => ({ ...x, id: "x1" })) });
  assert.equal(t.plan[0].done, undefined, "the template keeps no ticks");
  const prev = { income: [{ name: "Old", amount: 1 }], plan: [{ name: "Old line", amount: 5, type: "needs", done: true }], entries: [{}] };
  const n = newMonth(prev, t); assert.deepEqual(n.plan.map(x => x.name), ["Rent", "Additional", "Credit Card", "MF"]); assert.ok(n.plan.every(x => !x.done)); assert.equal(n.income[0].amount, 198000); assert.equal(n.entries.length, 0);
  assert.deepEqual(newMonth(prev, null).plan.map(x => x.name), ["Old line"], "no template: the previous month");
});
test("expenses: month summary (budget vs spent, saved) and the April–March year report", () => {
  const m = { income: [{ name: "Salary", amount: 198000 }, { name: "SOFi", amount: 55000 }], plan: [{ name: "Rent", amount: 47500, type: "needs", done: true }, { name: "Grocery", amount: 15000, type: "needs" }, { name: "Milk", amount: 2000, type: "needs" }, { name: "Car Cleaning", amount: 1500, type: "wants" }, { name: "MF", amount: 10500, type: "invest", done: true }],
    entries: [{ date: "2026-10-02", item: "Grocery", amount: 6810, mode: "Pluxee", category: "Groceries" }, { date: "2026-10-03", item: "Chicken", amount: 910, mode: "GPay", category: "Meat & fish" }, { date: "2026-10-02", item: "Milk", amount: 2100, mode: "Cash", category: "Milk & dairy" }, { date: "2026-10-09", item: "Swiggy", amount: 371, mode: "Pluxee", category: "Food delivery & eating out" }] };
  const s = monthSummary(m);
  assert.equal(s.income, 253000); assert.equal(s.plannedTotal, 76500); assert.equal(s.saved, 176500); assert.equal(s.spent, 10191);
  assert.deepEqual(s.vsBudget.map(v => [v.name, v.spent, v.left]), [["Grocery", 7720, 7280], ["Milk", 2100, -100]]);
  assert.equal(s.byMode[0].key, "Pluxee"); assert.equal(s.pending.length, 3); assert.equal(s.wantsPct, 3.6);
  assert.deepEqual(fyMonths("2027-02").slice(0, 2), ["2026-04", "2026-05"]); assert.equal(fyMonths("2026-10").at(-1), "2027-03");
  const n = newMonth(m); assert.equal(n.entries.length, 0); assert.equal(n.plan.length, 5); assert.ok(n.plan.every(x => !x.done));
  const y = yearReport({ "2026-10": m, "2026-11": { ...m, entries: m.entries.slice(0, 1) }, "2026-03": m }, "2026-10");
  assert.equal(y.fy, "FY 2026-27"); assert.equal(y.totals.months, 2, "March 2026 is last financial year"); assert.equal(y.categories[0].key, "Groceries"); assert.equal(y.categories[0].perMonth[6], 6810); assert.equal(y.categories[0].amount, 13620);
  assert.match(toCsv({ "2026-10": m }), /2026-10-02,"Grocery",6810,"Pluxee","Groceries"/);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: expenses and buckets are private to each login", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-544-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c544", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* text */ } return { status: r.status, json, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c544", username: "owner", password: "owner-pass-phrase" } })).cookie;
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    assert.equal((await call("/api/expenses?month=2026-10")).status, 401);
    let v = await call("/api/expenses?month=2026-10", { cookie: owner }); assert.equal(v.json.exists, false);
    v = await call("/api/expenses/paste", { cookie: owner, body: { month: "2026-10", plan: "Salary in Hand\t198000\nRent\t47500\tHDFC\tExpense\tNEEDS\tDONE\nGrocery\t15000\tAXIS\tExpense\tNEEDS", log: "\t\tPluxee\tGpay\n02-10-2026\tGrocery\t6810\n03-10-2026\tPetrol\t\t300" } });
    assert.equal(v.status, 200, v.text); assert.match(v.json.notice, /2 budget lines, 1 income lines, 2 spends/); assert.equal(v.json.summary.spent, 7110);
    assert.equal(v.json.data.entries.find(e => e.item === "Petrol").mode, "GPay");
    v = await call("/api/expenses/entry", { cookie: owner, body: { month: "2026-10", date: "2026-10-05", item: "Mango Mist", amount: "6,867", mode: "Credit card", category: "Shopping" } });
    assert.equal(v.json.data.entries.find(e => e.item === "Mango Mist").category, "Shopping");
    v = await call("/api/expenses/entry", { cookie: owner, body: { month: "2026-10", date: "2026-10-20", item: "mango mist", amount: 100, mode: "GPay" } });
    assert.equal(v.json.data.entries.filter(e => /mango mist/i.test(e.item)).every(e => e.category === "Shopping"), true, "learned from the correction");
    assert.equal((await call("/api/expenses/entry", { cookie: owner, body: { month: "2026-10", date: "2026-11-01", item: "x", amount: 1 } })).status, 400);
    v = await call("/api/expenses/start", { cookie: owner, body: { month: "2026-11" } }); assert.equal(v.json.data.plan.length, 2, "November starts from October's budget"); assert.equal(v.json.data.entries.length, 0);
    v = await call("/api/expenses/plan", { cookie: owner, body: { month: "2026-11", standard: true, income: [{ name: "Salary", amount: 198000 }], plan: [{ name: "Rent", amount: 47500, type: "needs", done: true }, { name: "Maid Salary", amount: 25000, type: "needs" }, { name: "MF", amount: 10500, type: "invest" }] } });
    assert.match(v.json.notice, /standard monthly budget/); assert.equal(v.json.template.lines, 3);
    v = await call("/api/expenses/start", { cookie: owner, body: { month: "2027-01" } }); assert.deepEqual(v.json.data.plan.map(p => [p.name, p.done]), [["Rent", false], ["Maid Salary", false], ["MF", false]], "a new month starts from the standard budget");
    assert.equal((await call("/api/expenses?month=2027-01", { cookie: friend })).json.template, null, "the standard budget is per login");
    const yr = await call("/api/expenses/year?month=2026-10", { cookie: owner }); assert.equal(yr.json.totals.months, 3); assert.equal(yr.json.fy, "FY 2026-27");
    const csv = await call("/api/expenses/export.csv", { cookie: owner }); assert.match(csv.text, /Mango Mist/);
    // the other login sees nothing of it
    assert.equal((await call("/api/expenses?month=2026-10", { cookie: friend })).json.exists, false);
    assert.equal((await call("/api/expenses/year?month=2026-10", { cookie: friend })).json.totals.months, 0);
    assert.doesNotMatch((await call("/api/expenses/export.csv", { cookie: friend })).text, /Mango/);
    // buckets
    const b = await call("/api/buckets/save", { cookie: owner, body: { monthly: 100000, maxMonths: 36, goals: [{ name: "House" }, { name: "Kids education", target: 2500000, year: 2035 }] } });
    assert.equal(b.status, 200, b.text); assert.equal(b.json.goalsList.length, 2); assert.equal(b.json.plan.maxMonths, 36);
    assert.equal((await call("/api/buckets", { cookie: friend })).json.goalsList.find(g => g.target === 2500000), undefined, "goals are per login");
    assert.equal((await call("/api/buckets", { cookie: owner })).json.spend.months, 3, "safety sizing sees your tracked spending");
    // not sent to Ask AI
    const pv = await call("/api/ai/preview", { cookie: owner }); assert.doesNotMatch(pv.text, /Mango Mist|Grocery 6810/);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
