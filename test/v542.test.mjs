import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseThemePaste, sanitizeThemePlan, themeSignal, themePlanView, diffThemeAlerts } from "../themeplan.mjs";

test("theme paste: spreadsheet columns with blank columns between, 'Theme: a, b' lines, a plain list", () => {
  const tsv = ["\tGrowth\t\tDividents\t\t\tOthers", "", "\tGROWW\t\tHCL Tech\t\t\tKayne", "\tBSE\t\tITC\t\t\tKEI", "\tSky gold\t\tONGC", "\tCDSL"].join("\n");
  const g = parseThemePaste(tsv);
  assert.deepEqual(g.map(x => x.name), ["Growth", "Dividents", "Others"]);
  assert.deepEqual(g[0].items, ["GROWW", "BSE", "Sky gold", "CDSL"]); assert.deepEqual(g[1].items, ["HCL Tech", "ITC", "ONGC"]); assert.deepEqual(g[2].items, ["Kayne", "KEI"]);
  assert.deepEqual(parseThemePaste("Growth: BSE, MCX\nIncome: ITC"), [{ name: "Growth", items: ["BSE", "MCX"] }, { name: "Income", items: ["ITC"] }]);
  assert.deepEqual(parseThemePaste("TCS\nINFY, WIPRO")[0].items, ["TCS", "INFY", "WIPRO"]);
  const p = sanitizeThemePlan({ themes: [{ name: "Dividents", symbols: ["itc", "ITC", "bad sym"] }, { name: "Growth" }] });
  assert.equal(p.themes[0].minYield, 3, "dividend theme gets a minimum yield"); assert.equal(p.themes[0].dipPct, 15); assert.deepEqual(p.themes[0].symbols.map(s => s.symbol), ["ITC"]);
  assert.equal(p.themes[1].dipPct, 25); assert.equal(p.themes[1].minYield, null);
  assert.equal(p.themes[1].targetPct, 50, "a missing target share takes the theme default, not 0"); assert.equal(p.themes[0].bulk, 50000);
});

test("theme signal: buy zone, dip from the 52-week high, dividend yield; rich stocks wait for the zone", () => {
  const g = { dipPct: 25, minYield: null }, d = { dipPct: 15, minYield: 3 };
  assert.equal(themeSignal(g, { price: 95, zoneLow: 90, zoneHigh: 100, status: "In zone", view: "Fair", high: 110 }).signal, "bulk");
  assert.equal(themeSignal(g, { price: 85, zoneLow: 90, zoneHigh: 100, status: "Below zone", view: "Cheap", high: 110 }).signal, "strong");
  assert.equal(themeSignal(g, { price: 74, status: "Above zone", zoneHigh: 60, view: "Fair", high: 100 }).signal, "bulk", "26% off the high");
  const rich = themeSignal(g, { price: 70, status: "Wait (far above)", zoneHigh: 40, view: "Very rich", high: 100 });
  assert.equal(rich.signal, "wait"); assert.match(rich.reasons.join(" "), /valuation still says Very rich/); assert.equal(rich.levels.buyAt, 40, "rich: only the buy zone counts");
  const near = themeSignal(g, { price: 78, status: "Above zone", zoneHigh: 60, view: "Fair", high: 100 });
  assert.equal(near.signal, "near"); assert.equal(near.levels.buyAt, 75); assert.equal(near.levels.toBuyPct, -3.8);
  assert.equal(themeSignal(d, { price: 400, status: "Above zone", zoneHigh: 350, view: "Fair", high: 420, dividend: { yield: 3.4 } }).signal, "bulk", "yield rule");
  assert.equal(themeSignal(g, { price: null }).signal, "no-price");
});

test("theme plan view: amounts by signal, capped by the theme's room; alerts once, again when it turns strong", () => {
  const plan = sanitizeThemePlan({ corpus: 1000000, themes: [{ id: "g", name: "Growth", targetPct: 50, bulk: 100000, symbols: ["AAA", "BBB", "CCC"] }, { id: "d", name: "Dividends", targetPct: 50, bulk: 50000, symbols: ["DDD"] }] });
  const rows = new Map([["AAA", { company: "Aaa", price: 85, zoneLow: 90, zoneHigh: 100, status: "Below zone", view: "Cheap", high: 120 }], ["BBB", { company: "Bbb", price: 95, zoneLow: 90, zoneHigh: 100, status: "In zone", view: "Fair", high: 100 }],
    ["CCC", { company: "Ccc", price: 200, zoneHigh: 120, status: "Above zone", view: "Fair", high: 210 }], ["DDD", { company: "Ddd", price: 50, zoneHigh: 40, status: "Above zone", view: "Fair", high: 52 }]]);
  const held = new Map([["BBB", { qty: 3000, value: 285000, invested: 250000 }], ["ZZZ", { qty: 1, value: 10000 }]]);
  const v = themePlanView(plan, { rows, held });
  const G = v.themes[0], by = Object.fromEntries(G.rows.map(r => [r.symbol, r]));
  assert.equal(G.value, 285000); assert.equal(G.targetValue, 500000); assert.equal(G.room, 215000);
  assert.equal(by.AAA.amount, 150000, "strong: 1.5× bulk"); assert.equal(by.BBB.amount, 65000, "rest of the room"); assert.equal(by.CCC.amount, 0);
  assert.equal(G.rows[0].symbol, "AAA", "strongest first"); assert.equal(v.bulkNow.length, 2); assert.equal(v.outsidePlan, 10000);
  const a = diffThemeAlerts({}, v, { now: Date.parse("2026-10-26T04:00:00Z") });
  assert.equal(a.fresh.length, 2); assert.match(a.fresh[0].title, /strong bulk-buy chance/);
  assert.equal(diffThemeAlerts(a.next, v, { now: Date.parse("2026-10-26T06:00:00Z") }).fresh.length, 0, "no repeat");
  rows.set("BBB", { ...rows.get("BBB"), status: "Below zone", price: 88 });
  const b = diffThemeAlerts(a.next, themePlanView(plan, { rows, held }), { now: Date.parse("2026-10-26T07:00:00Z") });
  assert.equal(b.fresh.length, 1); assert.equal(b.fresh[0].symbol, "BBB", "upgrade to strong alerts again");
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
async function start(dataDir, extra = {}) {
  const port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c542", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", ANGEL_SCRIP_URL: "http://127.0.0.1:9/scrip",
    PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", SCREENER_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", ...extra }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* text */ } return { status: r.status, json, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
  return { call, log: () => log, stop: async () => { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); } };
}
const HS = [{ name: "TCS", symbol: "TCS", weight: 6, exchange: "NSE" }, { name: "Infosys", symbol: "INFY", weight: 5, exchange: "NSE" }, { name: "HDFC Bank", symbol: "HDFCBANK", weight: 4, exchange: "NSE" }];

test("server: the mutual fund X-ray library is shared by every account; everything else stays per account", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-542-"));
  let s = await start(dataDir);
  try {
    const owner = (await s.call("/api/auth/setup", { body: { code: "c542", username: "owner", password: "owner-pass-phrase" } })).cookie;
    assert.equal((await s.call("/api/auth/users", { cookie: owner, body: { username: "friend", name: "Friend", password: "friend-pass-phrase" } })).status, 200);
    const friend = (await s.call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    const fid = (await s.call("/api/funds/save", { cookie: owner, body: { name: "Alpha Flexi Cap", holdings: HS } })).json.id;
    const seen = (await s.call("/api/funds", { cookie: friend })).json;
    assert.equal(seen.shared, true); assert.deepEqual(seen.funds.map(f => [f.id, f.mine, f.canDelete]), [[fid, false, false]]);
    assert.ok(!JSON.stringify(seen).includes("addedBy"), "who added it is not sent");
    assert.equal((await s.call(`/api/funds/view?id=${fid}`, { cookie: friend })).status, 200, "the friend can open it");
    const again = await s.call("/api/funds/save", { cookie: friend, body: { name: "Alpha Flexi Cap", holdings: HS } });
    assert.equal(again.json.id, fid, "the same fund is not stored twice");
    const del = await s.call("/api/funds/delete", { cookie: friend, body: { id: fid } }); assert.equal(del.status, 400); assert.match(del.json.message, /shared with every account/);
    // the friend's own data stays private: a theme plan saved by the friend is not the owner's
    await s.call("/api/themes/save", { cookie: friend, body: { themes: [{ name: "Growth", symbols: ["BSE"] }] } });
    assert.equal((await s.call("/api/themes", { cookie: owner })).json.themes.length, 0);
    assert.equal((await s.call("/api/themes", { cookie: friend })).json.themes.length, 1);
    const users = (await s.call("/api/auth/users", { cookie: owner })).json.users, friendId = users.find(u => u.username === "friend").id;
    await s.stop();
    // an account's own X-ray from before (or from an old backup) moves into the shared library; links follow the new id
    const udir = path.join(dataDir, "users", friendId);
    await fs.writeFile(path.join(udir, "funds.json"), JSON.stringify({ funds: [{ id: "fold1", name: "Alpha Flexi Cap", asOf: "Aug 2026", updatedAt: "2026-09-01T00:00:00Z", holdings: HS }, { id: "fold2", name: "Beta Small Cap", asOf: "Sep 2026", updatedAt: "2026-10-01T00:00:00Z", holdings: HS.slice(0, 2) }] }));
    await fs.writeFile(path.join(udir, "networth.json"), JSON.stringify({ items: [{ id: "m1", category: "mf", name: "Alpha", value: 1000, fundId: "fold1", updatedAt: "2026-10-01T00:00:00Z" }], links: { "u:kite:ABC:Alpha Flexi Cap": "fold1", "u:kite:XYZ:Beta": "fold2" } }));
    s = await start(dataDir, { XRAY_MIGRATE_IN_TESTS: "1" });
    for (let i = 0; i < 40; i++) { try { await fs.access(path.join(udir, "funds.json")); await new Promise(r => setTimeout(r, 100)); } catch { break; } }
    await assert.rejects(fs.access(path.join(udir, "funds.json")), "the per-account file is gone");
    const o2 = (await s.call("/api/auth/login", { body: { username: "owner", password: "owner-pass-phrase" } })).cookie;
    const lib = (await s.call("/api/funds", { cookie: o2 })).json.funds;
    assert.deepEqual(lib.map(f => f.name).sort(), ["Alpha Flexi Cap", "Beta Small Cap"]);
    const nw = JSON.parse(await fs.readFile(path.join(udir, "networth.json"), "utf8"));
    assert.equal(nw.links["u:kite:ABC:Alpha Flexi Cap"], fid, "pointed at the shared copy"); assert.equal(nw.items[0].fundId, fid); assert.equal(nw.links["u:kite:XYZ:Beta"], "fold2");
    assert.equal((await s.call("/api/funds/delete", { cookie: o2, body: { id: "fold2" } })).status, 200, "the owner can delete any");
  } finally { await s.stop().catch(() => {}); await fs.rm(dataDir, { recursive: true, force: true }); }
});

test("server: paste a theme list, short names become NSE symbols, the plan is saved per account", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-542b-")), s = await start(dataDir);
  try {
    const owner = (await s.call("/api/auth/setup", { body: { code: "c542", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const p = await s.call("/api/themes/paste", { cookie: owner, body: { text: "Growth\tDividents\tOthers\nSky gold\tHCL Tech\tKayne\nhindustan copper\tMaruthi\tAther Energy" } });
    assert.equal(p.status, 200, p.text);
    assert.deepEqual(p.json.themes.map(t => t.items.map(i => i.symbol)), [["SKYGOLD", "HINDCOPPER"], ["HCLTECH", "MARUTI"], ["KAYNES", "ATHERENERG"]]);
    assert.equal(p.json.themes[1].minYield, 3);
    const saved = await s.call("/api/themes/save", { cookie: owner, body: { corpus: "10,00,000", themes: p.json.themes.map(t => ({ name: t.name, symbols: t.items.map(i => ({ symbol: i.symbol, name: i.name })) })) } });
    assert.equal(saved.status, 200, saved.text); assert.equal(saved.json.corpus, 1000000); assert.equal(saved.json.themes.length, 3); assert.equal(saved.json.counts.stocks, 6);
    assert.ok(["no-price", "wait"].includes(saved.json.themes[0].rows[0].signal));
    assert.equal((await s.call("/api/themes/paste", { cookie: owner, body: { text: "  " } })).status, 400);
  } finally { await s.stop(); await fs.rm(dataDir, { recursive: true, force: true }); }
});
