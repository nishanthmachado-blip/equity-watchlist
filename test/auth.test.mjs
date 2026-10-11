import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { createAuth, createLimiter, parseCookies, checkPassword, hashPassword, verifyPassword, deviceOf } from "../auth.mjs";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "ew-auth-"));

test("passwords are salted scrypt hashes and verify only with the right password", async () => {
  const a = await hashPassword("correct horse battery"), b = await hashPassword("correct horse battery");
  assert.notEqual(a.hash, b.hash, "same password, different salt -> different hash");
  assert.equal(await verifyPassword("correct horse battery", a), true);
  assert.equal(await verifyPassword("correct horse batterY", a), false);
  assert.ok(checkPassword("short")); assert.ok(checkPassword("aaaaaaaaaaaa")); assert.equal(checkPassword("a-decent-passphrase"), null);
});

test("cookie parsing and limiter lockout", () => {
  assert.deepEqual(parseCookies("a=1; ew_session=abc%3D; b=2"), { a: "1", ew_session: "abc=", b: "2" });
  let t = 0; const l = createLimiter({ limit: 3, windowMs: 1000, now: () => t });
  for (let i = 0; i < 3; i++) { assert.equal(l.blocked("k"), 0); l.fail("k"); }
  assert.ok(l.blocked("k") > 0); t = 1001; assert.equal(l.blocked("k"), 0);
});

test("setup needs the one-time code, then sessions are tied to one user and stored hashed", async () => {
  const dir = await tmp(), auth = createAuth({ dir, log: () => {} });
  assert.equal(auth.needsSetup(), true);
  const code = auth.ensureSetupCode(); assert.ok(code.length >= 10);
  await assert.rejects(auth.setup({ code: "wrong", username: "owner", password: "a-decent-passphrase" }, { addr: "x" }), /setup code/);
  const { user: owner, token } = await auth.setup({ code, username: "Owner", password: "a-decent-passphrase" }, { addr: "x" });
  assert.equal(owner.role, "owner"); assert.equal(owner.username, "owner"); assert.equal(auth.needsSetup(), false);
  await assert.rejects(fs.access(path.join(dir, "setup-code.txt")), "code file removed after use");
  await assert.rejects(auth.setup({ code, username: "x2", password: "a-decent-passphrase" }, {}), /already has an owner/);
  assert.equal(auth.userFor(`ew_session=${token}`).id, owner.id);
  assert.equal(auth.userFor("ew_session=forged"), null);
  const disk = await fs.readFile(path.join(dir, "sessions.json"), "utf8");
  assert.ok(!disk.includes(token), "raw session token never written to disk");
  assert.ok(!(await fs.readFile(path.join(dir, "users.json"), "utf8")).includes("a-decent-passphrase"));
  // Members: created by the owner, can be disabled (signs them out) and removed.
  const m = await auth.createUser({ username: "friend", password: "another-good-one" });
  const { token: mt } = await auth.login({ username: "FRIEND", password: "another-good-one" }, { addr: "y" });
  assert.equal(auth.userFor(`ew_session=${mt}`).id, m.id);
  await auth.setDisabled(m.id, true); assert.equal(auth.userFor(`ew_session=${mt}`), null);
  await assert.rejects(auth.login({ username: "friend", password: "another-good-one" }, { addr: "y" }), /Wrong/);
  await assert.rejects(auth.setDisabled(owner.id, true), /owner/);
  // Wrong passwords lock the username out.
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login({ username: "owner", password: "nope-nope-nope" }, { addr: "z" + i }), /Wrong/);
  await assert.rejects(auth.login({ username: "owner", password: "a-decent-passphrase" }, { addr: "z9" }), /Too many/);
  // Password change signs out every session.
  const fresh = createAuth({ dir, log: () => {} });
  const { user: o2, token: t2 } = await fresh.login({ username: "owner", password: "a-decent-passphrase" }, { addr: "w" });
  await fresh.changePassword(o2, { current: "a-decent-passphrase", next: "brand-new-passphrase" });
  assert.equal(fresh.userFor(`ew_session=${t2}`), null);
});

test("sign-in history, device names, and signing out other devices", async () => {
  assert.equal(deviceOf("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"), "Safari on iPhone");
  assert.equal(deviceOf("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36"), "Chrome on Android");
  assert.equal(deviceOf("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0"), "Edge on Windows");
  const dir = await tmp(), auth = createAuth({ dir, setupCode: "code-123456" });
  const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
  const { user, token: t1 } = await auth.setup({ code: "code-123456", username: "owner", password: "a-decent-passphrase" }, { addr: "1.1.1.1", ua: mac, place: "Bengaluru, India" });
  const { token: t2 } = await auth.login({ username: "owner", password: "a-decent-passphrase" }, { addr: "2.2.2.2", ua: "Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile" });
  await assert.rejects(auth.login({ username: "owner", password: "wrong-wrong-wrong" }, { addr: "3.3.3.3", ua: "curl/8.0" }));
  const s1 = auth.sessionFor(`ew_session=${t1}`);
  const a = auth.activity(user, s1.key);
  assert.equal(a.sessions.length, 2); assert.ok(a.sessions[0].current); assert.equal(a.sessions[0].device, "Chrome on Mac"); assert.equal(a.sessions[0].place, "Bengaluru, India");
  assert.deepEqual(a.events.map(e => e.kind), ["wrong password", "signed in", "account created"]);
  assert.equal(a.events[0].device, "Script / tool");
  assert.ok(!JSON.stringify(a).includes(t1) && !JSON.stringify(a).includes(s1.key), "no tokens or session keys exposed");
  // sign out one device by its public id, then everything else
  const other = a.sessions.find(x => !x.current);
  assert.equal(await auth.revoke(user, s1.key, { id: other.id }), 1);
  assert.equal(auth.userFor(`ew_session=${t2}`), null); assert.equal(auth.userFor(`ew_session=${t1}`).id, user.id);
  const { token: t3 } = await auth.login({ username: "owner", password: "a-decent-passphrase" }, { addr: "4.4.4.4", ua: mac });
  assert.equal(await auth.revoke(user, s1.key, { others: true }), 1);
  assert.equal(auth.userFor(`ew_session=${t3}`), null); assert.ok(auth.userFor(`ew_session=${t1}`), "the current device stays signed in");
});

// ---- End to end: two accounts on a real server never see each other's data ----
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
test("server: sign-in required, per-account data isolation, owner-only admin", async () => {
  const dataDir = await tmp(), port = await freePort(), base = `http://127.0.0.1:${port}`;
  // A pre-accounts install: data sitting directly in data/ must end up with the owner only.
  await fs.writeFile(path.join(dataDir, "watchlist.json"), JSON.stringify([{ id: "x1", company: "Owner Secret Ltd", ticker: "OWNSEC", marketSymbol: "OWNSEC" }]));
  await fs.writeFile(path.join(dataDir, "kite-holdings.json"), JSON.stringify({ accounts: { AB1234: { broker: "zerodha", label: "Owner Kite", holdings: [{ symbol: "OWNSEC", quantity: 500, averagePrice: 100 }] } } }));
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", SETUP_CODE: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body, origin } = {}) => {
    const r = await fetch(base + p, { method: body ? "POST" : "GET", redirect: "manual", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}), ...(origin ? { Origin: origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, cookie: (r.headers.get("set-cookie") || "").split(";")[0], location: r.headers.get("location"), headers: r.headers };
  };
  try {
    for (let i = 0; i < 60 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    assert.ok(log.includes("running at"), log);
    const code = log.match(/setup code:\s+(\S+)/)?.[1]; assert.ok(code, "setup code printed");
    // Locked before sign-in: pages redirect, APIs answer 401, nothing leaks.
    assert.equal((await call("/")).status, 302);
    assert.equal((await call("/")).location, "/login");
    for (const p of ["/api/stocks", "/api/holdings", "/api/brokers/status", "/api/lists", "/app.js"]) { const r = await call(p); assert.ok([401, 302].includes(r.status), `${p} -> ${r.status}`); assert.ok(!r.text.includes("OWNSEC")); }
    assert.equal((await call("/login")).status, 200);
    assert.equal((await call("/api/auth/state")).json.needsSetup, true);
    // Owner setup moves the old data into the owner's folder.
    const bad = await call("/api/auth/setup", { body: { code: "nope", username: "nishanth", password: "owner-pass-phrase" } }); assert.equal(bad.status, 403);
    const setup = await call("/api/auth/setup", { body: { code, username: "nishanth", name: "Nishanth", password: "owner-pass-phrase" } });
    assert.equal(setup.status, 200, setup.text); const owner = setup.cookie; assert.match(owner, /^ew_session=/);
    assert.match((await fetch(base + "/api/auth/logout", { method: "POST", headers: { Cookie: "x=1" } })).headers.get("set-cookie") || "", /HttpOnly; SameSite=Lax/);
    await assert.rejects(fs.access(path.join(dataDir, "watchlist.json")), "legacy file moved");
    assert.ok((await call("/api/stocks", { cookie: owner })).text.includes("OWNSEC"));
    assert.ok((await call("/api/holdings", { cookie: owner })).text.includes("OWNSEC"));
    assert.equal((await call("/api/auth/me", { cookie: owner })).json.seedDefault, true);
    // Owner creates a member; members cannot manage accounts or overwrite shared data.
    const mk = await call("/api/auth/users", { cookie: owner, body: { username: "friend", name: "Friend", password: "friend-pass-phrase" } }); assert.equal(mk.status, 200, mk.text);
    const login = await call("/api/auth/login", { body: { username: "friend", password: "friend-pass-phrase" } }); assert.equal(login.status, 200);
    const friend = login.cookie;
    const me = (await call("/api/auth/me", { cookie: friend })).json; assert.equal(me.user.role, "member"); assert.equal(me.seedDefault, false);
    for (const p of ["/api/stocks", "/api/holdings", "/api/lists", "/api/valuation", "/api/brokers/status", "/api/alerts", "/api/portfolio/focus", "/api/networth"]) {
      const r = await call(p, { cookie: friend }); assert.ok(!r.text.includes("OWNSEC"), `${p} leaked the owner's data: ${r.text.slice(0, 200)}`);
    }
    assert.equal((await call("/api/auth/users", { cookie: friend })).status, 403);
    assert.equal((await call("/api/auth/users", { cookie: friend, body: { username: "evil", password: "evil-pass-phrase" } })).status, 403);
    assert.equal((await call("/api/fundamentals", { cookie: friend, body: { entries: [{ symbol: "TCS", pe: 1 }] } })).status, 403);
    // The friend's own watchlist stays theirs.
    const put = await call("/api/watchlist", { cookie: friend, body: { stocks: [{ id: "f1", company: "Friend Pick Ltd", ticker: "FRIENDPK", marketSymbol: "FRIENDPK" }] } });
    assert.ok(put.status < 300, put.text);
    assert.ok((await call("/api/stocks", { cookie: friend })).text.includes("FRIENDPK"));
    assert.ok(!(await call("/api/stocks", { cookie: owner })).text.includes("FRIENDPK"));
    // Cross-site writes are refused even with a valid cookie.
    assert.equal((await call("/api/watchlist", { cookie: friend, origin: "https://evil.example", body: { stocks: [] } })).status, 403);
    // Install files are public; app data is not.
    for (const p of ["/manifest.webmanifest", "/sw.js", "/icons/icon-192.png"]) assert.equal((await call(p)).status, 200, p);
    assert.equal((await call("/api/freshness")).status, 401);
    assert.equal((await call("/api/freshness", { cookie: friend })).status, 200);
    // Backup holds only the caller's files; restore refuses foreign file names.
    const bk = (await call("/api/backup", { cookie: friend })).json;
    assert.equal(bk.kind, "account-backup"); assert.ok(bk.files["watchlist.json"]); assert.ok(!JSON.stringify(bk).includes("OWNSEC"));
    assert.equal((await call("/api/restore", { cookie: friend, body: { backup: { ...bk, files: { "../../auth/users.json": [] } } } })).status, 400);
    bk.files["watchlist.json"] = [{ id: "f2", company: "Restored Ltd", ticker: "RESTORED", marketSymbol: "RESTORED" }];
    assert.equal((await call("/api/restore", { cookie: friend, body: { backup: bk } })).status, 200);
    assert.ok((await call("/api/stocks", { cookie: friend })).text.includes("RESTORED"));
    assert.ok(!(await call("/api/stocks", { cookie: owner })).text.includes("RESTORED"));
    // Activity is per account and never lists another account's sessions; a member cannot revoke the owner's sessions.
    const fa = (await call("/api/auth/activity", { cookie: friend })).json;
    assert.ok(fa.sessions.length >= 1 && fa.sessions.every(x => x.device)); assert.ok(fa.events.every(e => !("uid" in e)));
    const oa = (await call("/api/auth/activity", { cookie: owner })).json, ownerSid = oa.sessions[0].id;
    await call("/api/auth/revoke", { cookie: friend, body: { id: ownerSid } });
    assert.equal((await call("/api/stocks", { cookie: owner })).status, 200, "owner still signed in");
    // Model portfolio and US tab answer per account (no network needed for an empty US list).
    const mp = await call("/api/model", { cookie: friend, body: { profile: "aggressive", style: "growth", amount: 500000, years: 2 } });
    assert.equal(mp.status, 200, mp.text); assert.equal(mp.json.mix.equity, 60); assert.ok(!mp.text.includes("OWNSEC"));
    const us = await call("/api/us", { cookie: friend }); assert.equal(us.status, 200); assert.deepEqual(us.json.rows, []);
    // Removing the account deletes its folder and signs it out.
    const users = (await call("/api/auth/users", { cookie: owner })).json.users, fid = users.find(u => u.username === "friend").id;
    assert.equal((await call(`/api/auth/users/${fid}/remove`, { cookie: owner, body: {} })).status, 200);
    await assert.rejects(fs.access(path.join(dataDir, "users", fid)));
    assert.equal((await call("/api/stocks", { cookie: friend })).status, 401);
    // Logout ends the session.
    await call("/api/auth/logout", { cookie: owner, body: {} });
    assert.equal((await call("/api/stocks", { cookie: owner })).status, 401);
  } finally { child.kill(); await fs.rm(dataDir, { recursive: true, force: true }); }
});
