import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sanitizeMenu } from "../menuprefs.mjs";

test("menu arrangement: only element ids are kept; a pinned item leaves its group", () => {
  const m = sanitizeMenu({ order: { main: ["viewLists", "viewHome", "viewHome", "<script>", 5], "bad key!": ["viewTax"], pinned: ["x"] }, pinned: ["viewHome", "viewExpenses"], hidden: ["viewUs", "../etc"], extra: "dropped" });
  assert.deepEqual(m.order, { main: ["viewLists"] });
  assert.deepEqual(m.pinned, ["viewHome", "viewExpenses"]);
  assert.deepEqual(m.hidden, ["viewUs"]);
  assert.equal(m.extra, undefined);
  assert.deepEqual(sanitizeMenu(null).order, {});
  assert.equal(sanitizeMenu({ pinned: Array.from({ length: 50 }, (_, i) => `view${i}`) }).pinned.length, 20);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: the menu arrangement is saved per login", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-546-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c546", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_PRICES: "0", PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", YAHOO_BASE: "http://127.0.0.1:9", MFAPI_BASE: "http://127.0.0.1:9", AMFI_NAV_URL: "http://127.0.0.1:9/nav" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } return { status: r.status, json, text, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "c546", username: "owner", password: "owner-pass-phrase" } })).cookie;
    await call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    const friend = (await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } })).cookie;
    assert.equal((await call("/api/ui/menu")).status, 401);
    const s = await call("/api/ui/menu", { cookie: owner, body: { pinned: ["viewExpenses"], order: { main: ["viewMarket", "viewHome"] }, hidden: ["viewUs"] } });
    assert.equal(s.status, 200);
    const back = await call("/api/ui/menu", { cookie: owner });
    assert.deepEqual(back.json.pinned, ["viewExpenses"]); assert.deepEqual(back.json.order.main, ["viewMarket", "viewHome"]); assert.deepEqual(back.json.hidden, ["viewUs"]);
    const other = await call("/api/ui/menu", { cookie: friend });
    assert.deepEqual(other.json, { order: {}, pinned: [], hidden: [] }, "the other login keeps the default menu");
    const page = await call("/", { cookie: owner });
    assert.match(page.text, /<script src="navorder\.js(\?v=[\w-]+)?"><\/script>/);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); await fs.rm(dataDir, { recursive: true, force: true }); }
});
