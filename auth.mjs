// Accounts and sessions. Every page and API call needs a signed-in user; each user's data lives in its own folder
// (data/users/<id>/), so holdings, watchlists and broker logins are never visible to anyone else.
//
// - No public sign-up. The first account (the owner) is created with a one-time setup code printed in the server log
//   and saved to data/auth/setup-code.txt. After that, only the owner can add accounts (Settings → Accounts).
// - Passwords: scrypt with a per-user random salt. Sessions: 256-bit random token in an HttpOnly, SameSite=Lax cookie;
//   only a SHA-256 of the token is stored on disk, so a copy of the data folder cannot be used to sign in.
// - Repeated wrong passwords lock that username (and the caller's address) out for 15 minutes.
import crypto from "node:crypto";
import { dfs as fs } from "./storage.mjs";
import { dfsSync as fsSync } from "./storage.mjs";
import path from "node:path";

export const COOKIE = "ew_session";
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 30);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 }, (e, k) => e ? no(e) : ok(k)));
export async function hashPassword(pw) { const salt = crypto.randomBytes(16); return { salt: salt.toString("base64"), hash: (await scrypt(pw, salt)).toString("base64") }; }
export async function verifyPassword(pw, rec) {
  if (!rec?.salt || !rec?.hash) return false;
  const want = Buffer.from(rec.hash, "base64"), got = await scrypt(String(pw), Buffer.from(rec.salt, "base64"));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
export function checkPassword(pw) {
  pw = String(pw || "");
  if (pw.length < 10) return "Use at least 10 characters.";
  if (pw.length > 200) return "That password is too long.";
  if (/^(.)\1+$/.test(pw) || /^(password|1234567890|qwertyuiop)/i.test(pw)) return "That password is too easy to guess.";
  return null;
}
const sha = s => crypto.createHash("sha256").update(s).digest("hex");
export function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) { const i = part.indexOf("="); if (i > 0) { const k = part.slice(0, i).trim(); if (!(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim()); } }
  return out;
}
// "Chrome on Android", "Safari on iPhone"… from a User-Agent string (good enough to recognise your own devices).
export function deviceOf(ua = "") {
  ua = String(ua);
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "Mac" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : null;
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\/|Opera/.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Firefox\//.test(ua) ? "Firefox" : /CriOS|Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /curl|wget|python|node|okhttp|Go-http/i.test(ua) ? "Script / tool" : null;
  return br && os ? `${br} on ${os}` : br || os || "Unknown device";
}
export const publicUser = u => u && { id: u.id, username: u.username, name: u.name || u.username, role: u.role, createdAt: u.createdAt, disabled: !!u.disabled, lastLoginAt: u.lastLoginAt || null };

// Sliding-window limiter: `limit` failures per `windowMs` per key, then locked until the window passes.
export function createLimiter({ limit = 5, windowMs = 15 * 60e3, now = () => Date.now() } = {}) {
  const hits = new Map();
  const live = key => (hits.get(key) || []).filter(t => now() - t < windowMs);
  return {
    blocked(key) { const h = live(key); hits.set(key, h); return h.length >= limit ? Math.ceil((h[0] + windowMs - now()) / 1000) : 0; },
    fail(key) { const h = live(key); h.push(now()); hits.set(key, h); },
    clear(key) { hits.delete(key); }
  };
}

export function createAuth({ dir, now = () => Date.now(), log = console.log, setupCode = process.env.SETUP_CODE } = {}) {
  const usersFile = path.join(dir, "users.json"), sessionsFile = path.join(dir, "sessions.json"), codeFile = path.join(dir, "setup-code.txt"), eventsFile = path.join(dir, "events.json");
  let users = null, sessions = null, events = null, writing = Promise.resolve(), lastTouchSave = 0;
  const read = (f, d) => { try { return JSON.parse(fsSync.readFileSync(f, "utf8")); } catch { return d; } };
  const load = () => { if (!users) users = read(usersFile, []); if (!sessions) sessions = read(sessionsFile, {}); if (!events) events = read(eventsFile, {}); };
  const persist = () => {
    const snap = [JSON.stringify(users, null, 2), JSON.stringify(sessions, null, 2), JSON.stringify(events || {})];
    writing = writing.then(async () => {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      for (const [f, body] of [[usersFile, snap[0]], [sessionsFile, snap[1]], [eventsFile, snap[2]]]) { const tmp = `${f}.${process.pid}.tmp`; await fs.writeFile(tmp, body, { mode: 0o600 }); await fs.rename(tmp, f); }
    });
    return writing;
  };
  const byUser = createLimiter({ now }), byAddr = createLimiter({ limit: 20, now });

  function needsSetup() { load(); return !users.some(u => u.role === "owner"); }
  // The one-time code that lets whoever can read the server log (or the data folder) create the owner account.
  function ensureSetupCode() {
    if (!needsSetup()) { fsSync.rmSync(codeFile, { force: true }); return null; }
    let code = setupCode || (() => { try { return fsSync.readFileSync(codeFile, "utf8").trim(); } catch { return ""; } })();
    if (!code) { code = crypto.randomBytes(9).toString("base64url"); fsSync.mkdirSync(dir, { recursive: true, mode: 0o700 }); fsSync.writeFileSync(codeFile, code, { mode: 0o600 }); }
    return code;
  }
  function codeMatches(given) {
    const want = setupCode || (() => { try { return fsSync.readFileSync(codeFile, "utf8").trim(); } catch { return ""; } })();
    if (!want) return false;
    const a = Buffer.from(sha(String(given || "").trim())), b = Buffer.from(sha(want));
    return crypto.timingSafeEqual(a, b);
  }
  async function newUser({ username, password, name, role }) {
    load();
    username = String(username || "").trim().toLowerCase();
    if (!USERNAME_RE.test(username)) throw Object.assign(new Error("Username: 3–32 characters, letters, numbers, dot, dash or underscore."), { status: 400 });
    if (users.some(u => u.username === username)) throw Object.assign(new Error("That username is taken."), { status: 409 });
    const weak = checkPassword(password); if (weak) throw Object.assign(new Error(weak), { status: 400 });
    const u = { id: crypto.randomBytes(8).toString("hex"), username, name: String(name || "").trim().slice(0, 60) || username, role, createdAt: new Date(now()).toISOString(), ...(await hashPassword(password)) };
    users.push(u); await persist(); return u;
  }
  // Sign-in history per user: successes and failed passwords, newest first, last 60 kept.
  function logEvent(uid, kind, meta = {}) {
    load(); const list = events[uid] || [];
    list.unshift({ at: now(), kind, ip: meta.addr || null, device: deviceOf(meta.ua), place: meta.place || null });
    events[uid] = list.slice(0, 60);
  }
  async function startSession(u, meta = {}) {
    const token = crypto.randomBytes(32).toString("base64url");
    sessions[sha(token)] = { uid: u.id, pid: crypto.randomBytes(6).toString("hex"), createdAt: now(), lastSeen: now(), expiresAt: now() + SESSION_DAYS * 864e5, ua: String(meta.ua || "").slice(0, 200), ip: meta.addr || null, place: meta.place || null, how: meta.how || "password" };
    logEvent(u.id, meta.how === "setup" ? "account created" : meta.how === "password-change" ? "password changed" : "signed in", meta);
    u.lastLoginAt = new Date(now()).toISOString();
    for (const [k, s] of Object.entries(sessions)) if (s.expiresAt < now()) delete sessions[k];
    await persist(); return token;
  }
  return {
    dir, SESSION_DAYS, needsSetup, ensureSetupCode,
    listUsers() { load(); return users.filter(u => !u.disabled); },
    allUsers() { load(); return users.map(publicUser); },
    owner() { load(); return users.find(u => u.role === "owner") || null; },
    async setup({ code, username, password, name }, meta) {
      if (!needsSetup()) throw Object.assign(new Error("This app already has an owner. Sign in instead."), { status: 409 });
      const wait = byAddr.blocked(`setup:${meta?.addr}`); if (wait) throw Object.assign(new Error(`Too many attempts. Try again in ${Math.ceil(wait / 60)} min.`), { status: 429 });
      if (!codeMatches(code)) { byAddr.fail(`setup:${meta?.addr}`); throw Object.assign(new Error("That setup code is not right. It is printed in the server log and saved in data/auth/setup-code.txt."), { status: 403 }); }
      const u = await newUser({ username, password, name, role: "owner" });
      fsSync.rmSync(codeFile, { force: true });
      return { user: u, token: await startSession(u, { ...meta, how: "setup" }) };
    },
    async login({ username, password }, meta = {}) {
      load();
      const name = String(username || "").trim().toLowerCase(), uKey = `u:${name}`, aKey = `a:${meta.addr}`;
      const wait = Math.max(byUser.blocked(uKey), byAddr.blocked(aKey));
      if (wait) throw Object.assign(new Error(`Too many wrong attempts. Try again in ${Math.ceil(wait / 60)} min.`), { status: 429 });
      const u = users.find(x => x.username === name && !x.disabled);
      // Always run scrypt so a missing username takes as long as a wrong password.
      const ok = await verifyPassword(password, u || { salt: "AAAAAAAAAAAAAAAAAAAAAA==", hash: "A".repeat(88) });
      if (!u || !ok) { byUser.fail(uKey); byAddr.fail(aKey); if (u) { logEvent(u.id, "wrong password", meta); await persist(); } throw Object.assign(new Error("Wrong username or password."), { status: 401 }); }
      byUser.clear(uKey);
      return { user: u, token: await startSession(u, meta) };
    },
    // Returns the signed-in user for a cookie header, or null. Refreshes nothing on disk (cheap on every request).
    // The session behind a cookie, with its owner; also records "last active" (saved at most every 5 minutes).
    sessionFor(cookieHeader, meta = {}) {
      load();
      const token = parseCookies(cookieHeader)[COOKIE]; if (!token || token.length > 100) return null;
      const key = sha(token), s = sessions[key]; if (!s || s.expiresAt < now()) return null;
      const u = users.find(x => x.id === s.uid); if (!u || u.disabled) return null;
      if (now() - (s.lastSeen || 0) > 60e3) { s.lastSeen = now(); if (meta.addr) s.lastIp = meta.addr; if (now() - lastTouchSave > 5 * 60e3) { lastTouchSave = now(); persist(); } }
      return { user: u, key, session: s };
    },
    activity(u, currentKey) {
      load();
      const list = Object.entries(sessions).filter(([, s]) => s.uid === u.id && s.expiresAt >= now())
        .map(([k, s]) => ({ id: s.pid || k.slice(0, 12), current: k === currentKey, device: deviceOf(s.ua), ip: s.lastIp || s.ip, place: s.place, signedInAt: s.createdAt, lastSeen: s.lastSeen || s.createdAt, expiresAt: s.expiresAt }))
        .sort((a, b) => (b.current - a.current) || b.lastSeen - a.lastSeen);
      return { sessions: list, events: (events[u.id] || []).slice(0, 30) };
    },
    // Sign out one other device (by its public id) or every device except this one.
    async revoke(u, currentKey, { id = null, others = false } = {}) {
      load(); let n = 0;
      for (const [k, s] of Object.entries(sessions)) {
        if (s.uid !== u.id || k === currentKey) continue;
        if (others || (s.pid || k.slice(0, 12)) === id) { delete sessions[k]; n++; }
      }
      if (n) { logEvent(u.id, others ? `signed out ${n} other device${n === 1 ? "" : "s"}` : "signed out a device", {}); await persist(); }
      return n;
    },
    userFor(cookieHeader) {
      load();
      const token = parseCookies(cookieHeader)[COOKIE]; if (!token || token.length > 100) return null;
      const s = sessions[sha(token)]; if (!s || s.expiresAt < now()) return null;
      const u = users.find(x => x.id === s.uid); return u && !u.disabled ? u : null;
    },
    async logout(cookieHeader) { load(); const t = parseCookies(cookieHeader)[COOKIE]; if (t && sessions[sha(t)]) { delete sessions[sha(t)]; await persist(); } },
    async createUser(input) { return newUser({ ...input, role: "member" }); },
    async changePassword(u, { current, next }) {
      if (!(await verifyPassword(current, u))) throw Object.assign(new Error("Current password is not right."), { status: 403 });
      const weak = checkPassword(next); if (weak) throw Object.assign(new Error(weak), { status: 400 });
      Object.assign(u, await hashPassword(next));
      for (const [k, s] of Object.entries(sessions)) if (s.uid === u.id) delete sessions[k]; // sign out everywhere
      await persist();
    },
    async resetPassword(id, next) {
      load(); const u = users.find(x => x.id === id); if (!u) throw Object.assign(new Error("No such user."), { status: 404 });
      const weak = checkPassword(next); if (weak) throw Object.assign(new Error(weak), { status: 400 });
      Object.assign(u, await hashPassword(next));
      for (const [k, s] of Object.entries(sessions)) if (s.uid === u.id) delete sessions[k];
      await persist();
    },
    async setDisabled(id, disabled) {
      load(); const u = users.find(x => x.id === id); if (!u) throw Object.assign(new Error("No such user."), { status: 404 });
      if (u.role === "owner") throw Object.assign(new Error("The owner account cannot be disabled."), { status: 400 });
      u.disabled = !!disabled; if (disabled) for (const [k, s] of Object.entries(sessions)) if (s.uid === id) delete sessions[k];
      await persist();
    },
    async removeUser(id) {
      load(); const u = users.find(x => x.id === id); if (!u) throw Object.assign(new Error("No such user."), { status: 404 });
      if (u.role === "owner") throw Object.assign(new Error("The owner account cannot be removed."), { status: 400 });
      users = users.filter(x => x.id !== id); for (const [k, s] of Object.entries(sessions)) if (s.uid === id) delete sessions[k];
      await persist(); return u;
    },
    cookie(token, { secure, clear = false } = {}) {
      return `${COOKIE}=${clear ? "" : token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${clear ? 0 : SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`;
    }
  };
}
