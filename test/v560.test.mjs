import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeItem, withRecurring } from "../networth.mjs";
import { bucketView, sanitizeBucketPlan } from "../buckets.mjs";

test("EPF with a monthly contribution grows by itself; saving a new value restarts from it", () => {
  const it = sanitizeItem({ category: "epf", name: "EPF", value: "3500000", monthly: "37000", day: "1", rate: "" });
  assert.deepEqual([it.recurring.monthly, it.recurring.day, it.recurring.rate], [37000, 1, null]);
  const base = { ...it, recurring: { ...it.recurring, since: "2026-07-15T06:00:00Z" } };
  const nov = withRecurring(base, new Date("2026-11-07T06:00:00Z")); // contributions on 1 Aug, 1 Sep, 1 Oct, 1 Nov
  assert.equal(nov.auto.months, 4); assert.equal(nov.auto.added, 148000);
  const g = Math.pow(1.0825, 1 / 12) - 1; let b = 3500000; for (let i = 0; i < 4; i++) { if (i) b *= 1 + g; b += 37000; }
  assert.equal(nov.value, Math.round(b)); assert.ok(nov.auto.interest > 0);
  assert.equal(withRecurring(base, new Date("2026-07-20T06:00:00Z")).value, 3500000, "nothing before the first contribution day");
  // editing (the form sends the value shown, i.e. today's) starts again from that balance
  const again = sanitizeItem({ category: "epf", name: "EPF", value: String(nov.value) }, base);
  assert.equal(again.recurring.monthly, 37000); assert.notEqual(again.recurring.since, base.recurring.since);
  const same = sanitizeItem({ category: "epf", name: "EPF renamed", value: "3500000" }, base);
  assert.equal(same.recurring.since, base.recurring.since, "same base value keeps the start");
  assert.equal(sanitizeItem({ category: "epf", name: "EPF", value: "1", monthly: "" }, base).recurring, null, "empty monthly turns it off");
  assert.throws(() => sanitizeItem({ category: "ppf", value: "1", monthly: "100", rate: "50" }), /rate/);
});
test("PPF stops at ₹1.5 L a financial year; bucket lines carry the monthly amount", () => {
  const ppf = { id: "p", kind: "asset", category: "ppf", name: "PPF", value: 2054000, invested: 1800000, recurring: { monthly: 20000, day: 5, rate: 0, since: "2026-03-01T06:00:00Z" } };
  const r = withRecurring(ppf, new Date("2026-12-10T06:00:00Z")); // Mar (FY25-26) + Apr..Dec (FY26-27: 9 × 20k = 1.8 L → capped 1.5 L)
  assert.equal(r.auto.added, 20000 + 150000); assert.equal(r.invested, 1800000 + 170000);
  const v = bucketView([r], sanitizeBucketPlan({}, {}));
  const line = v.buckets.flatMap(b => b.lines).find(l => l.id === "p");
  assert.equal(line.recurring.monthly, 20000);
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: a monthly contribution is added on read, never saved back twice", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-560-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c560", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch { /* file */ } return { status: r.status, json, buf, type: r.headers.get("content-type"), cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c560", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const it = await call("/api/networth/item", { cookie: owner, body: { category: "epf", name: "EPF", value: "1000000", monthly: "37000", day: "1" } });
    assert.equal(it.status, 200, JSON.stringify(it.json));
    const users = await fs.readdir(path.join(dataDir, "users")), f = path.join(dataDir, "users", users[0], "networth.json");
    const st = JSON.parse(await fs.readFile(f, "utf8")); st.items[0].recurring.since = "2026-01-15T06:00:00.000Z"; await fs.writeFile(f, JSON.stringify(st));
    const a = await call("/api/networth", { cookie: owner }), b = await call("/api/networth", { cookie: owner });
    const va = a.json.lines.find(l => l.category === "epf").value, vb = b.json.lines.find(l => l.category === "epf").value;
    assert.ok(va > 1000000 + 37000 * 5, String(va)); assert.equal(va, vb, "the same on every read");
    assert.equal(JSON.parse(await fs.readFile(f, "utf8")).items[0].value, 1000000, "the stored balance stays the one you entered");
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
