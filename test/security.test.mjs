import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createAuth, totpCode, base32Encode } from "../auth.mjs";
import crypto from "node:crypto";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "sec-"));
const code = (secret, t = Date.now()) => totpCode(secret.replace(/\s/g, ""), Math.floor(t / 30000));

test("secrets at rest: broker logins, sessions and tokens are sealed on disk, read back normally, older plain files sealed", async () => {
  const dir = await tmp(), u = path.join(dir, "users", "0123456789abcdef");
  await fs.mkdir(u, { recursive: true });
  await fs.writeFile(path.join(u, "broker-credentials.json"), JSON.stringify({ angel: { pin: "4321", totpSecret: "JBSWY3DPEHPK3PXP" } }));
  await fs.writeFile(path.join(u, "watchlist.json"), "[]");
  const S = await import(`../storage.mjs?sec${Date.now()}`);
  await S.initStorage({ dataDir: dir, logger: () => {} });
  const disk = await fs.readFile(path.join(u, "broker-credentials.json"), "utf8");
  assert.match(disk, /^EWSEC1:/); assert.doesNotMatch(disk, /4321|JBSWY3/);
  assert.deepEqual(JSON.parse(await S.dfs.readFile(path.join(u, "broker-credentials.json"), "utf8")).angel.pin, "4321");
  await S.dfs.writeFile(path.join(u, "broker-sessions.json"), JSON.stringify({ angel: { jwt: "SECRET-JWT" } }));
  assert.doesNotMatch(await fs.readFile(path.join(u, "broker-sessions.json"), "utf8"), /SECRET-JWT/);
  assert.equal(await fs.readFile(path.join(u, "watchlist.json"), "utf8"), "[]", "ordinary data is untouched");
  // a tmp file renamed onto a secret name still lands sealed
  await S.dfs.writeFile(path.join(u, "x.tmp"), JSON.stringify({ token: "T0K3N" })); await S.dfs.rename(path.join(u, "x.tmp"), path.join(u, "notify.json"));
  assert.doesNotMatch(await fs.readFile(path.join(u, "notify.json"), "utf8"), /T0K3N/);
  assert.equal(JSON.parse(await S.dfs.readFile(path.join(u, "notify.json"), "utf8")).token, "T0K3N");
  // the generated key lives in the data store (SECRETS_KEY moves it out): a different key cannot read the files
  const keyDoc = JSON.parse(await fs.readFile(path.join(dir, "secrets-key.json"), "utf8")); assert.ok(keyDoc.key);
  await fs.writeFile(path.join(dir, "secrets-key.json"), JSON.stringify({ key: crypto.randomBytes(32).toString("base64") }));
  const S2 = await import(`../storage.mjs?sec2${Date.now()}`);
  await S2.initStorage({ dataDir: dir, logger: () => {} });
  await assert.rejects(S2.dfs.readFile(path.join(u, "broker-sessions.json"), "utf8"), e => e.code === "ENOENT", "wrong key: reads as 'not saved' (log in again), never garbage");
});

test("secrets: moving from the generated key to SECRETS_KEY re-seals everything and removes the stored key", async () => {
  const dir = await tmp(), u = path.join(dir, "users", "0123456789abcdef"); await fs.mkdir(u, { recursive: true });
  const S = await import(`../storage.mjs?mv1${Date.now()}`); await S.initStorage({ dataDir: dir, logger: () => {} });
  await S.dfs.writeFile(path.join(u, "broker-credentials.json"), JSON.stringify({ angel: { pin: "9999" } }));
  const before = await fs.readFile(path.join(u, "broker-credentials.json"), "utf8");
  process.env.SECRETS_KEY = "now-a-proper-long-secrets-key-for-tests";
  try {
    const logs = [], S2 = await import(`../storage.mjs?mv2${Date.now()}`); await S2.initStorage({ dataDir: dir, logger: m => logs.push(m) });
    const after = await fs.readFile(path.join(u, "broker-credentials.json"), "utf8");
    assert.notEqual(after, before, "re-sealed"); assert.equal(JSON.parse(await S2.dfs.readFile(path.join(u, "broker-credentials.json"), "utf8")).angel.pin, "9999", "still readable: no broker re-login");
    await assert.rejects(fs.access(path.join(dir, "secrets-key.json")), "the old generated key is gone from the data folder");
    assert.ok(logs.some(l => /Re-sealed with SECRETS_KEY/.test(l)));
  } finally { delete process.env.SECRETS_KEY; }
});

test("secrets at rest in MongoDB: the database holds only ciphertext", async () => {
  const docs = new Map(), coll = { docs, async createIndex() {}, find() { return { toArray: async () => [...docs.values()].map(d => structuredClone(d)) }; }, async replaceOne(q, d) { docs.set(q._id, structuredClone(d)); }, async deleteOne(q) { docs.delete(q._id); } };
  const dir = await tmp(), S = await import(`../storage.mjs?secm${Date.now()}`);
  await S.initStorage({ dataDir: dir, collectionImpl: coll, logger: () => {}, importFiles: false });
  const f = path.join(dir, "users", "0123456789abcdef", "broker-credentials.json");
  await S.dfs.writeFile(f, JSON.stringify({ dhan: { accessToken: "DHAN-TOKEN-XYZ" } }));
  await new Promise(r => setTimeout(r, 50));
  const d = docs.get("users/0123456789abcdef/broker-credentials.json");
  assert.ok(d.text?.startsWith("EWSEC1:")); assert.ok(!JSON.stringify(d).includes("DHAN-TOKEN-XYZ"));
  assert.equal(JSON.parse(await S.dfs.readFile(f, "utf8")).dhan.accessToken, "DHAN-TOKEN-XYZ");
});

test("two-step sign-in: setup, enable with a code, sign-in needs the code, no reuse, recovery codes once, turn off", async () => {
  let clock = Date.parse("2026-10-24T08:00:10Z");
  const auth = createAuth({ dir: await tmp(), log: () => {}, setupCode: "s-code", now: () => clock });
  const { user } = await auth.setup({ code: "s-code", username: "owner", password: "owner-pass-phrase" }, {});
  const s = await auth.mfaSetup(user); assert.match(s.uri, /^otpauth:\/\/totp\/Equity%20Watchlist%3Aowner\?secret=[A-Z2-7]{32}&issuer=Equity%20Watchlist/);
  await assert.rejects(auth.mfaEnable(user, "000000"), /doesn't match/);
  const { recoveryCodes } = await auth.mfaEnable(user, code(s.secret, clock)); assert.equal(recoveryCodes.length, 8);
  await assert.rejects(auth.login({ username: "owner", password: "owner-pass-phrase" }, {}), e => e.needCode && e.status === 401);
  await assert.rejects(auth.login({ username: "owner", password: "owner-pass-phrase", code: code(s.secret, clock) }, {}), e => e.needCode, "the code used to enable cannot be reused");
  clock += 30000;
  assert.ok((await auth.login({ username: "owner", password: "owner-pass-phrase", code: code(s.secret, clock) }, {})).token);
  await assert.rejects(auth.login({ username: "owner", password: "wrong-pass-phrase", code: code(s.secret, clock + 30000) }, {}), /Wrong username or password/);
  clock += 60000;
  assert.ok((await auth.login({ username: "owner", password: "owner-pass-phrase", code: recoveryCodes[0] }, {})).token);
  await assert.rejects(auth.login({ username: "owner", password: "owner-pass-phrase", code: recoveryCodes[0] }, {}), e => e.needCode, "a recovery code works once");
  assert.equal(auth.mfaStatus(user).recoveryLeft, 7);
  await assert.rejects(auth.mfaDisable(user, { password: "owner-pass-phrase", code: "111111" }), /Code is not right/);
  await auth.mfaDisable(user, { password: "owner-pass-phrase", code: recoveryCodes[1] });
  assert.ok((await auth.login({ username: "owner", password: "owner-pass-phrase" }, {})).token, "off again: password only");
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: content security policy on every page (inline head script allowed by hash only), 2-step API", async () => {
  const dataDir = await tmp(), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "c-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_STREAM: "0", LOGOS: "0",
    PRICE_SOURCES: "nse", NSE_BASE: "http://127.0.0.1:9", SECRETS_KEY: "a-long-test-secrets-key-0123456789" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch {} return { status: r.status, json, text: t, headers: r.headers, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    assert.match(log, /encrypted at rest \(key: SECRETS_KEY\)/);
    const owner = (await call("/api/auth/setup", { body: { code: "c-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const page = await call("/", { cookie: owner }), csp = page.headers.get("content-security-policy");
    assert.match(csp, /script-src 'self' 'sha256-[A-Za-z0-9+/=]+'/); assert.match(csp, /frame-ancestors 'none'/); assert.match(csp, /object-src 'none'/); assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/);
    const inline = [...page.text.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${crypto.createHash("sha256").update(m[1]).digest("base64")}'`);
    for (const h of inline) assert.ok(csp.includes(h), "every inline script is allowed by its hash");
    assert.doesNotMatch(page.text, /\son(click|load|error)=/, "no inline event handlers in the page");
    assert.match((await call("/login")).headers.get("content-security-policy"), /default-src 'self'/);
    const st = await call("/api/auth/security", { cookie: owner }); assert.deepEqual([st.json.secrets.source, st.json.secrets.strong, st.json.twoStep.on], ["SECRETS_KEY", true, false]);
    const setup = await call("/api/auth/2fa/setup", { cookie: owner, body: {} }); assert.ok(setup.json.secret);
    const en = await call("/api/auth/2fa/enable", { cookie: owner, body: { code: code(setup.json.secret) } }); assert.equal(en.status, 200, en.text); assert.equal(en.json.recoveryCodes.length, 8);
    const users = JSON.parse(await fs.readFile(path.join(dataDir, "auth", "users.json"), "utf8"));
    assert.ok(!JSON.stringify(users).includes(setup.json.secret.replace(/\s/g, "")), "the authenticator secret is encrypted in users.json");
    const l1 = await call("/api/auth/login", { body: { username: "owner", password: "owner-pass-phrase" } }); assert.deepEqual([l1.status, l1.json.needCode], [401, true]); assert.equal(l1.cookie, "", "no session without the code");
    const l2 = await call("/api/auth/login", { body: { username: "owner", password: "owner-pass-phrase", code: en.json.recoveryCodes[0] } }); assert.equal(l2.status, 200); assert.ok(l2.cookie);
    const pw = await call("/api/auth/password", { cookie: l2.cookie, body: { current: "owner-pass-phrase", next: "owner-new-pass-phrase" } }); assert.equal(pw.status, 200, "changing the password works with two-step on");
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); }
});

test("recovery script: lists accounts, resets a password (and two-step with --reset-2fa) from the server", async () => {
  const dir = await tmp(), auth = createAuth({ dir: path.join(dir, "auth"), log: () => {}, setupCode: "x" });
  const { user } = await auth.setup({ code: "x", username: "owner", password: "owner-pass-phrase" }, {});
  const s = await auth.mfaSetup(user); await auth.mfaEnable(user, code(s.secret));
  const run = (...a) => new Promise(r => { const c = spawn(process.execPath, ["scripts/reset-password.mjs", ...a], { cwd: root, env: { ...process.env, DATA_DIR: dir, MONGO_URL: "" } }); let o = ""; c.stdout.on("data", d => o += d); c.stderr.on("data", d => o += d); c.on("exit", code => r({ code, o })); });
  const list = await run(); assert.equal(list.code, 0); assert.match(list.o, /@owner {2}\(owner\) {2}\[two-step on\]/);
  const r = await run("OWNER", "--reset-2fa"); assert.equal(r.code, 0, r.o);
  const pw = r.o.match(/New temporary password for @owner: (\S+)/)[1];
  const fresh = createAuth({ dir: path.join(dir, "auth"), log: () => {} });
  assert.ok((await fresh.login({ username: "owner", password: pw }, {})).token, "temporary password works, no code needed");
  assert.equal((await run("nobody")).code, 1);
});
