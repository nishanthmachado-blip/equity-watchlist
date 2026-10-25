import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { simulate, firePlan, sanitizeFirePlan, neededInvest, FIRE_DEFAULTS } from "../fire.mjs";

const base = { age: 38, spend: 100000, invest: 50000, pfMonthly: 10000, stepUp: 0, inflation: 0, swr: 4, safetyMonths: 36, pfCap: 5e6, pfAfterCap: "equity", ret: { safety: 0, pf: 0, other: 0, equity: 0 }, goals: [1e8], horizon: 5, start: { safety: 0, pf: 0, other: 0, equity: 0 } };
test("FIRE: new money fills the 3-year reserve first, then PF up to the cap, the rest goes to equity", () => {
  const s = simulate(base), y1 = s.years[1];
  assert.equal(y1.safety, 600000); // 12 × 50k, all into the reserve (needs 36 L)
  assert.equal(y1.pf, 120000); assert.equal(y1.equity, 0);
  const full = simulate({ ...base, start: { safety: 3600000, pf: 5e6, other: 0, equity: 0 } }).years[1];
  assert.equal(full.safety, 3600000); assert.equal(full.pf, 5e6, "PF stops at the cap"); assert.equal(full.equity, 720000, "SIP and the PF money go to equity");
  const keep = simulate({ ...base, pfAfterCap: "pf", start: { safety: 3600000, pf: 5e6, other: 0, equity: 0 } }).years[1];
  assert.equal(keep.pf, 5e6 + 120000);
  const half = simulate({ ...base, reserveShare: 50 }).years[1];
  assert.equal(half.safety, 300000); assert.equal(half.equity, 300000, "half the SIP keeps going to equity while the reserve fills");
  const extra = simulate({ ...base, start: { safety: 5000000, pf: 0, other: 0, equity: 0 } }).years[0];
  assert.equal(extra.safety, 3600000); assert.equal(extra.equity, 1400000, "cash above the reserve moves to equity");
});
test("FIRE: compounding, milestones and FIRE month", () => {
  const p = { ...base, ret: { safety: 0, pf: 0, other: 0, equity: 12 }, start: { safety: 3600000, pf: 5e6, other: 0, equity: 1e7 }, horizon: 40, invest: 0, pfMonthly: 0 };
  const s = simulate(p);
  assert.ok(Math.abs(s.years[10].equity - 1e7 * Math.pow(1.12, 10)) < 50);
  assert.ok(s.fire.month > 76 && s.fire.month < 86, "₹86 L + ₹1 Cr at 12% reaches 25 × ₹12 L in ~6.7 yrs");
  assert.ok(s.hit[1e8] > 12 * 18 && s.hit[1e8] < 12 * 22);
  const need = neededInvest({ ...p, start: { safety: 0, pf: 0, other: 0, equity: 0 }, safetyMonths: 0 }, 1e7, 120);
  const check = simulate({ ...p, start: { safety: 0, pf: 0, other: 0, equity: 0 }, safetyMonths: 0, invest: need, horizon: 11 });
  assert.ok(check.hit[1e7] <= 120); assert.ok(need > 40000 && need <= 47000, String(need)); // ~₹43k/mo for 10 yrs at 12%
});
test("FIRE plan: tracked numbers fill the gaps; your own numbers win; levers ranked", () => {
  const r = firePlan({ plan: sanitizeFirePlan({ age: "38", spend: "", stepUp: "15", goals: [1e8, 1e9] }), tracked: { spend: 110000, invest: 45000, pfMonthly: 12500, income: 300000, months: 3, wants: [{ key: "Shopping", amount: 12000 }] }, start: { safety: 4e6, pf: 22e5, other: 6e5, equity: 8e6 } });
  assert.equal(r.inputs.spend, 110000); assert.equal(r.inputs.src.spend, "tracked"); assert.equal(r.inputs.stepUp, 15);
  assert.equal(r.savingsRate, 19.2);
  assert.equal(r.fire.number, Math.round(110000 * 12 / 0.035));
  assert.deepEqual(r.goals.map(g => g.label), ["₹10 Cr", "₹100 Cr"]);
  assert.ok(r.goals[0].age > 38 && r.goals[1].age > r.goals[0].age);
  assert.ok(r.levers.length >= 5 && r.levers[0].score >= r.levers[r.levers.length - 1].score);
  assert.ok(r.levers.some(l => /Halve shopping/.test(l.title)));
  assert.ok(r.tips.some(t => /19\.2%/.test(t.text)));
  assert.equal(sanitizeFirePlan({ age: 30, retireAge: 25 }).retireAge, null);
  assert.equal(sanitizeFirePlan({ ret: { equity: "99" } }).ret.equity, undefined);
  assert.equal(FIRE_DEFAULTS.pfCap, 5e6);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: FIRE planner is per login", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-547-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c547", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, json, text, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c547", username: "owner", password: "owner-pass-phrase" } })).cookie;
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    assert.equal((await call("/api/fire")).status, 401);
    await call("/api/expenses/plan", { cookie: owner, body: { month: "2026-10", income: [{ name: "Salary", amount: 300000 }], plan: [{ name: "Rent", amount: 47500, type: "needs" }, { name: "MF", amount: 40000, type: "invest" }, { name: "PPF", amount: 12500, type: "invest" }] } });
    const a = await call("/api/fire", { cookie: owner });
    assert.equal(a.status, 200); assert.equal(a.json.inputs.spend, 47500); assert.equal(a.json.inputs.invest, 40000); assert.equal(a.json.inputs.pfMonthly, 12500);
    const s = await call("/api/fire/save", { cookie: owner, body: { age: 38, ret: { equity: 13 } } });
    assert.equal(s.json.inputs.age, 38); assert.equal(s.json.inputs.ret.equity, 13);
    const r = await call("/api/fire/save", { cookie: owner, body: { reset: true } });
    assert.equal(r.json.inputs.age, 38, "reset keeps your age"); assert.equal(r.json.inputs.ret.equity, 12);
    const f = await call("/api/fire", { cookie: friend });
    assert.equal(f.json.inputs.age, null); assert.equal(f.json.inputs.invest, 0, "the other login sees none of it"); assert.equal(f.json.tracked.months, 0);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
