import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";

// An in-memory stand-in for a MongoDB collection (only the calls storage.mjs makes). With TEST_MONGO_URL set, the
// server test below also runs against a real MongoDB-compatible server.
function fakeCollection() {
  const docs = new Map();
  return { docs,
    async createIndex() {}, find() { return { toArray: async () => [...docs.values()].map(d => structuredClone(d)) }; },
    down: false,
    async replaceOne(q, d) { if (this.down) throw new Error("connection refused"); if (JSON.stringify(d).includes('"a.b"')) throw Object.assign(new Error("invalid key"), { code: 2 }); docs.set(q._id, structuredClone(d)); },
    async deleteOne(q) { docs.delete(q._id); } };
}

test("storage: data-folder files become MongoDB documents (owner, kind, data); other paths stay on disk", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "st-")), coll = fakeCollection();
  await fs.mkdir(path.join(dir, "users", "0123456789abcdef"), { recursive: true });
  await fs.writeFile(path.join(dir, "users", "0123456789abcdef", "watchlist.json"), JSON.stringify([{ id: 1, ticker: "IOC" }]));
  await fs.writeFile(path.join(dir, "fundamentals-cache.json"), JSON.stringify({ fundamentals: { IOC: { pe: 7 } } }));
  const S = await import(`../storage.mjs?${Date.now()}`);
  const info = await S.initStorage({ dataDir: dir, collectionImpl: coll, logger: () => {} });
  assert.equal(info.mode, "mongo"); assert.equal(info.documents, 2, "existing files imported on first start");
  const w = coll.docs.get("users/0123456789abcdef/watchlist.json");
  assert.equal(w.owner, "0123456789abcdef"); assert.equal(w.kind, "watchlist"); assert.deepEqual(w.data, [{ id: 1, ticker: "IOC" }]);
  const { dfs, dfsSync, flushStorage } = S;
  await dfs.writeFile(path.join(dir, "users", "0123456789abcdef", "lists.json"), JSON.stringify({ lists: [] }));
  assert.deepEqual(JSON.parse(await dfs.readFile(path.join(dir, "users", "0123456789abcdef", "lists.json"), "utf8")), { lists: [] });
  assert.deepEqual(await dfs.readdir(path.join(dir, "users", "0123456789abcdef")), ["lists.json", "watchlist.json"]);
  await assert.rejects(dfs.readFile(path.join(dir, "nope.json"), "utf8"), e => e.code === "ENOENT");
  // keys MongoDB-compatible servers may reject are stored as text instead
  await dfs.writeFile(path.join(dir, "name-map.json"), JSON.stringify({ "a.b": 1 }));
  await flushStorage(); assert.equal(coll.docs.get("name-map.json").text, '{"a.b":1}');
  // write-then-rename (as the login store does), sync reads, recursive delete of a user's folder
  await dfs.writeFile(path.join(dir, "auth", "users.json.1.tmp"), "[1]"); await dfs.rename(path.join(dir, "auth", "users.json.1.tmp"), path.join(dir, "auth", "users.json"));
  assert.equal(dfsSync.readFileSync(path.join(dir, "auth", "users.json"), "utf8"), "[1]");
  await flushStorage(); assert.ok(!coll.docs.has("auth/users.json.1.tmp"));
  await dfs.rm(path.join(dir, "users", "0123456789abcdef"), { recursive: true, force: true });
  await flushStorage(); assert.ok(![...coll.docs.keys()].some(k => k.startsWith("users/")));
  // database briefly down: the change is kept and saved once it is back
  coll.down = true;
  await dfs.writeFile(path.join(dir, "users", "0123456789abcdef", "alerts.json"), "{}");
  assert.equal(S.info().unsaved, 1); assert.equal(await dfs.readFile(path.join(dir, "users", "0123456789abcdef", "alerts.json"), "utf8"), "{}");
  coll.down = false; await flushStorage();
  assert.equal(S.info().unsaved, 0); assert.ok(coll.docs.has("users/0123456789abcdef/alerts.json"));
  // the app's own files are still read from disk
  assert.ok((await dfs.readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8")).includes("<html"));
});

// ---- Whole server against MongoDB: restarting with an empty data folder keeps logins, watchlists and holdings ----
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
test("server on MongoDB: data survives a redeploy (new container, empty disk); accounts stay private", { skip: !process.env.TEST_MONGO_URL && "set TEST_MONGO_URL to run against a MongoDB server" }, async () => {
  const db = `ew_test_${Date.now()}`;
  const boot = async () => {
    const port = await freePort(), dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-mongo-"));
    const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, MONGO_URL: process.env.TEST_MONGO_URL, MONGO_DB: db, SETUP_CODE: "mongo-test-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0" }, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
    for (let i = 0; i < 100 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(log.includes("running at"), log);
    const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} return { status: r.status, json: j, text: t, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
    return { child, call, log: () => log, dataDir };
  };
  let a = await boot();
  try {
    const setup = await a.call("/api/auth/setup", { body: { code: "mongo-test-code", username: "owner", password: "owner-pass-phrase" } }); assert.equal(setup.status, 200, setup.text);
    let owner = setup.cookie;
    assert.equal((await a.call("/api/storage", { cookie: owner })).json.mode, "mongo");
    await a.call("/api/watchlist", { cookie: owner, body: { stocks: [{ id: "o1", company: "Indian Oil", ticker: "IOC", marketSymbol: "IOC" }] } });
    await a.call("/api/holdings/import", { cookie: owner, body: { label: "Mine", csv: "Symbol,Quantity,Average Price\nIOC,100,120\n" } });
    await a.call("/api/auth/users", { cookie: owner, body: { username: "friend", password: "friend-pass-phrase" } });
    await a.call("/api/networth/item", { cookie: owner, body: { category: "ppf", name: "SBI PPF", value: 500000 } });
  } finally { a.child.kill("SIGTERM"); await new Promise(r => a.child.once("exit", r)); }
  // "Redeploy": a brand-new server with an empty data folder, same database.
  a = await boot();
  try {
    assert.equal((await fs.readdir(a.dataDir)).length, 0);
    assert.equal((await a.call("/api/auth/state")).json.needsSetup, false, "owner account still exists");
    const login = await a.call("/api/auth/login", { body: { username: "owner", password: "owner-pass-phrase" } }); assert.equal(login.status, 200);
    const owner = login.cookie;
    assert.ok((await a.call("/api/stocks", { cookie: owner })).text.includes("IOC"), "watchlist kept");
    assert.ok((await a.call("/api/holdings", { cookie: owner })).text.includes("IOC"), "holdings kept");
    assert.ok((await a.call("/api/networth", { cookie: owner })).text.includes("SBI PPF"), "net worth kept");
    const fr = await a.call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } }); assert.equal(fr.status, 200);
    for (const [p, secret] of [["/api/stocks", "IOC"], ["/api/holdings", "IOC"], ["/api/networth", "SBI PPF"]]) assert.ok(!(await a.call(p, { cookie: fr.cookie })).text.includes(secret), `${p} leaked the owner's data`);
  } finally {
    a.child.kill("SIGTERM"); await new Promise(r => a.child.once("exit", r));
    const { MongoClient } = await import("mongodb"); const c = new MongoClient(process.env.TEST_MONGO_URL); await c.connect(); await c.db(db).dropDatabase().catch(() => {}); await c.close();
  }
});
