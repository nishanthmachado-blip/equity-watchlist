import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Removing Indian broker holdings: imported CSV accounts are deleted, synced ones hidden (also from Net worth) until
// Show again, funds / US stocks of a hidden account stay, and one login cannot remove another's.
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
test("holdings: remove a broker account / all, show again", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-rm-")), port = await freePort(), base = `http://127.0.0.1:${port}`;
  await fs.writeFile(path.join(dataDir, "kite-holdings.json"), JSON.stringify({ accounts: { AB1234: { broker: "zerodha", label: "Kite main", syncedAt: new Date().toISOString(), holdings: [{ symbol: "TCS", qty: 10, avgPrice: 3000, lastPrice: 3500 }, { symbol: "INFY", qty: 5, avgPrice: 1400, lastPrice: 1500 }], mf: [{ tradingsymbol: "INF846K01EW2", fund: "Axis ELSS", quantity: 10, average_price: 50, last_price: 60 }] } } }));
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", SETUP_CODE: "rm-test-code", EOD: "0", BACKUP: "0", PRICE_SOURCES: "none", NSE_BASE: "http://127.0.0.1:9", YAHOO_CHART_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/x" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => {
    const r = await fetch(base + p, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
  };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(log.includes("running at"), log);
    const owner = (await call("/api/auth/setup", { body: { code: "rm-test-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    assert.equal((await call("/api/holdings/import", { cookie: owner, body: { label: "INDmoney", csv: "symbol,quantity,average price\nITC,100,400\n" } })).status, 200);
    let h = (await call("/api/holdings", { cookie: owner })).json;
    assert.deepEqual(h.accounts.map(a => [a.userId, a.imported, a.count]), [["AB1234", false, 2], ["indmoney:INDmoney", true, 1]]);
    assert.equal(h.accounts[0].invested, 37000);
    // another login cannot touch the owner's accounts
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    assert.equal((await call("/api/holdings/remove", { cookie: friend, body: { account: "AB1234" } })).status, 404);
    // "My holdings" list: every held stock, read-only
    let L = (await call("/api/lists", { cookie: owner })).json.lists.find(l => l.id === "holdings");
    assert.deepEqual([L.name, L.auto, L.symbols], ["My holdings", "holdings", ["INFY", "ITC", "TCS"]]);
    assert.equal((await call("/api/lists/members", { cookie: owner, body: { id: "holdings", add: ["SBIN"] } })).status, 400);
    assert.equal((await call("/api/lists/create", { cookie: owner, body: { name: "Holdings" } })).status, 400);
    assert.ok(!(await call("/api/lists", { cookie: friend })).json.lists.some(l => l.id === "holdings"), "another login has no holdings list");
    // synced account: hidden, funds stay
    let r = await call("/api/holdings/remove", { cookie: owner, body: { account: "AB1234" } });
    assert.equal(r.status, 200, r.text); assert.match(r.json.notice, /Removed 2 holdings · 1 synced account hidden/);
    assert.deepEqual(r.json.holdings.map(x => x.symbol), ["ITC"]);
    assert.deepEqual(r.json.hiddenAccounts.map(a => [a.userId, a.count]), [["AB1234", 2]]);
    assert.ok(!(await call("/api/networth", { cookie: owner })).text.includes('"TCS"'), "net worth leaves the hidden stocks out");
    L = (await call("/api/lists", { cookie: owner })).json.lists.find(l => l.id === "holdings");
    assert.deepEqual(L.symbols, ["ITC"], "a removed account leaves the holdings list too");
    // show again
    r = await call("/api/holdings/unhide", { cookie: owner, body: { account: "AB1234" } });
    assert.deepEqual(r.json.holdings.map(x => x.symbol).sort(), ["INFY", "ITC", "TCS"]); assert.equal(r.json.hiddenAccounts.length, 0);
    // imported account: deleted
    r = await call("/api/holdings/remove", { cookie: owner, body: { account: "indmoney:INDmoney" } });
    assert.match(r.json.notice, /1 imported account deleted/); assert.deepEqual(r.json.accounts.map(a => a.userId), ["AB1234"]);
    // remove all, then nothing left to remove
    r = await call("/api/holdings/remove", { cookie: owner, body: { all: true } });
    assert.equal(r.json.holdings.length, 0); assert.equal(r.json.accounts.length, 0);
    assert.equal((await call("/api/holdings/remove", { cookie: owner, body: { all: true } })).status, 400);
    const users = await fs.readdir(path.join(dataDir, "users")), stores = [];
    for (const u of users) { try { stores.push(JSON.parse(await fs.readFile(path.join(dataDir, "users", u, "kite-holdings.json"), "utf8"))); } catch {} }
    assert.equal(stores.length, 1, "only the owner has holdings");
    assert.equal(stores[0].accounts.AB1234.mf.length, 1, "the account's funds are kept");
    assert.deepEqual(stores[0].hiddenEq, ["AB1234"]);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); }
});
