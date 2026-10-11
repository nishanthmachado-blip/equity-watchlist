import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { createBrokerClients, totp, base32Decode, cleanSymbol, normalizeAngelHoldings, normalizeDhanHoldings, normalizeGrowwHoldings, applyPrices, READ_ONLY_ROUTES } from "../brokers.mjs";

const tmpDir = async () => fs.mkdtemp(path.join(os.tmpdir(), "brokers-test-"));
const tmp = async () => path.join(await tmpDir(), "sessions.json");
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// A fake fetch that routes by "METHOD host/path" and records every call.
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const u = new URL(url), key = `${opts.method || "GET"} ${u.host}${u.pathname}`;
    calls.push({ key, url: u, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    const h = routes[key]; if (!h) return json(404, { message: `no route ${key}` });
    return h({ url: u, headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
  };
  fn.calls = calls; return fn;
}
const roots = { angel: "https://angel.test", dhan: "https://dhan.test", dhanAuth: "https://dhanauth.test", groww: "https://groww.test" };

test("TOTP matches the RFC 6238 SHA-1 test vectors (6-digit truncation)", () => {
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // base32("12345678901234567890")
  assert.equal(base32Decode(secret).toString(), "12345678901234567890");
  assert.equal(totp(secret, { time: 59_000 }), "287082");
  assert.equal(totp(secret, { time: 1111111109_000 }), "081804");
  assert.equal(totp(secret, { time: 20000000000_000 }), "353130");
  assert.throws(() => totp("not base32!"), /base32/);
});

test("symbol cleaning and holding normalisers", () => {
  assert.equal(cleanSymbol("RELIANCE-EQ"), "RELIANCE");
  assert.equal(cleanSymbol("bajaj-auto"), "BAJAJ-AUTO");
  assert.equal(cleanSymbol("XYZ-BE"), "XYZ");
  const a = normalizeAngelHoldings({ status: true, data: { holdings: [{ tradingsymbol: "TATASTEEL-EQ", exchange: "NSE", isin: "INE081A01020", quantity: 2, realisedquantity: 2, t1quantity: 1, averageprice: 111.87, ltp: 130.15, close: 129.6 }, { tradingsymbol: "GONE-EQ", quantity: 0, realisedquantity: 0, t1quantity: 0 }] } });
  assert.deepEqual(a.map(h => [h.symbol, h.qty, h.avgPrice, h.lastPrice, h.value]), [["TATASTEEL", 3, 111.87, 130.15, 390.45]]);
  assert.equal(a[0].pnl, Math.round((390.45 - 335.61) * 100) / 100);
  assert.deepEqual(normalizeAngelHoldings({ status: true, data: null }), []);
  const d = normalizeDhanHoldings([{ exchange: "ALL", tradingSymbol: "HDFCBANK", securityId: "1333", isin: "INE040A01034", totalQty: 10, dpQty: 8, t1Qty: 2, avgCostPrice: 1500 }]);
  assert.deepEqual([d[0].symbol, d[0].qty, d[0].invested, d[0].lastPrice, d[0].securityId, d[0].exchange], ["HDFCBANK", 10, 15000, null, "1333", "NSE"]);
  const g = normalizeGrowwHoldings({ status: "SUCCESS", payload: { holdings: [{ isin: "INE002A01018", trading_symbol: "RELIANCE", quantity: 4, average_price: 2500 }] } });
  const priced = applyPrices(g, new Map([["RELIANCE", 2600]]));
  assert.deepEqual([priced[0].value, priced[0].pnl], [10400, 400]);
  assert.throws(() => normalizeGrowwHoldings({ status: "SUCCESS" }), /Unrecognised/);
});

test("Angel One: login with PIN + TOTP from .env secret, profile, holdings, expiry", async () => {
  let valid = "jwt-123";
  const f = fakeFetch({
    "POST angel.test/rest/auth/angelbroking/user/v1/loginByPassword": ({ headers, body }) => {
      assert.equal(headers["X-PrivateKey"], "key1"); assert.equal(body.clientcode, "A123"); assert.equal(body.password, "1234");
      assert.equal(body.totp, totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", { time: 59_000 }));
      return json(200, { status: true, message: "SUCCESS", errorcode: "", data: { jwtToken: "jwt-123", refreshToken: "r", feedToken: "f" } });
    },
    "GET angel.test/rest/secure/angelbroking/user/v1/getProfile": ({ headers }) => headers.Authorization === `Bearer ${valid}` ? json(200, { status: true, data: { clientcode: "A123", name: "Test User" } }) : json(200, { status: false, message: "Invalid Token", errorcode: "AG8001", data: "" }),
    "GET angel.test/rest/secure/angelbroking/portfolio/v1/getAllHolding": ({ headers }) => headers.Authorization !== `Bearer ${valid}` ? json(200, { status: false, message: "Invalid Token", errorcode: "AG8001", data: "" }) : json(200, { status: true, data: { holdings: [{ tradingsymbol: "INFY-EQ", exchange: "NSE", quantity: 5, realisedquantity: 5, t1quantity: 0, averageprice: 1400, ltp: 1500, close: 1490 }], totalholding: {} } })
  });
  const c = createBrokerClients({ env: { ANGEL_API_KEY: "key1", ANGEL_CLIENT_CODE: "A123", ANGEL_PIN: "1234", ANGEL_TOTP_SECRET: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }, fetchImpl: f, sessionFile: await tmp(), credentialsFile: path.join(await tmpDir(), "creds.json"), now: () => 59_000, roots });
  let s = await c.angel.status();
  assert.equal(s.connected, false); assert.deepEqual(s.modes.map(m => m.mode), ["auto", "manual"]);
  const r = await c.angel.login({ mode: "auto" });
  assert.equal(r.profile.userId, "A123");
  const { holdings } = await c.angel.holdings();
  assert.deepEqual(holdings.map(h => [h.symbol, h.qty, h.value]), [["INFY", 5, 7500]]);
  valid = "something-else"; // Angel expired the token
  s = await c.angel.status();
  assert.equal(s.connected, false); assert.equal(s.loginRequired, true);
  await assert.rejects(c.angel.holdings(), e => e.loginRequired === true && /AG8001/.test(e.message));
});

test("Angel One: no API key means not set up, and login is refused before any request", async () => {
  const f = fakeFetch({});
  const c = createBrokerClients({ env: {}, fetchImpl: f, sessionFile: await tmp(), credentialsFile: path.join(await tmpDir(), "creds.json"), roots });
  const s = await c.angel.status();
  assert.equal(s.configured, false); assert.match(s.setupHint, /SmartAPI key/);
  await assert.rejects(c.angel.login({ pin: "1", totp: "123456" }), e => e.setup);
  assert.equal(f.calls.length, 0);
});

test("Dhan: pasted token validated, holdings priced via market feed, falls back when LTP fails", async () => {
  let ltpOk = true;
  const f = fakeFetch({
    "GET dhan.test/v2/profile": ({ headers }) => headers["access-token"] === "t".repeat(30) ? json(200, { dhanClientId: "1100", tokenValidity: "09/10/2026 10:00" }) : json(401, { errorType: "Invalid_Authentication", errorCode: "DH-901", errorMessage: "Client ID or user generated access token is invalid or expired." }),
    "GET dhan.test/v2/holdings": () => json(200, [{ exchange: "ALL", tradingSymbol: "TCS", securityId: "11536", isin: "INE467B01029", totalQty: 3, dpQty: 3, t1Qty: 0, avgCostPrice: 3000 }]),
    "POST dhan.test/v2/marketfeed/ltp": ({ headers, body }) => { assert.equal(headers["client-id"], "1100"); assert.deepEqual(body, { NSE_EQ: [11536] }); return ltpOk ? json(200, { data: { NSE_EQ: { 11536: { last_price: 4000 } } }, status: "success" }) : json(400, { errorType: "Data_Error", errorCode: "DH-902", errorMessage: "User has not subscribed to Data APIs" }); }
  });
  const c = createBrokerClients({ env: {}, fetchImpl: f, sessionFile: await tmp(), credentialsFile: path.join(await tmpDir(), "creds.json"), roots });
  await assert.rejects(c.dhan.login({ mode: "token", accessToken: "x".repeat(30) }), e => e.loginRequired);
  await c.dhan.login({ mode: "token", accessToken: "t".repeat(30) });
  assert.equal((await c.dhan.status()).profile.userId, "1100");
  let r = await c.dhan.holdings();
  assert.deepEqual([r.holdings[0].symbol, r.holdings[0].value, r.holdings[0].pnl, r.priceNote], ["TCS", 12000, 3000, null]);
  ltpOk = false;
  r = await c.dhan.holdings();
  assert.equal(r.holdings[0].lastPrice, null); assert.match(r.priceNote, /Data API/);
});

test("Dhan: PIN + TOTP token generation", async () => {
  const f = fakeFetch({
    "POST dhanauth.test/app/generateAccessToken": ({ url }) => { assert.equal(url.searchParams.get("dhanClientId"), "1100"); assert.equal(url.searchParams.get("pin"), "9999"); assert.equal(url.searchParams.get("totp"), "123456"); return json(200, { dhanClientId: "1100", dhanClientName: "Test", accessToken: "gen-token-abcdefghijklmnop", expiryTime: "2026-10-09T10:00:00" }); },
    "GET dhan.test/v2/profile": ({ headers }) => headers["access-token"] === "gen-token-abcdefghijklmnop" ? json(200, { dhanClientId: "1100" }) : json(401, { errorCode: "DH-901", errorMessage: "invalid" })
  });
  const c = createBrokerClients({ env: { DHAN_CLIENT_ID: "1100" }, fetchImpl: f, sessionFile: await tmp(), credentialsFile: path.join(await tmpDir(), "creds.json"), roots });
  assert.deepEqual((await c.dhan.status()).modes.map(m => m.mode), ["token", "totp"]);
  await assert.rejects(c.dhan.login({ mode: "totp", pin: "9999", totp: "12" }), e => e.setup);
  const r = await c.dhan.login({ mode: "totp", pin: "9999", totp: "123456" });
  assert.equal(r.profile.name, "Test");
});

test("Groww: API key + secret approval checksum, holdings + batched LTP", async () => {
  const f = fakeFetch({
    "POST groww.test/v1/token/api/access": ({ headers, body }) => {
      assert.equal(headers.Authorization, "Bearer gkey"); assert.equal(body.key_type, "approval");
      assert.equal(body.checksum, crypto.createHash("sha256").update("gsecret" + body.timestamp).digest("hex"));
      assert.equal(body.timestamp, "1700000000");
      return json(200, { token: "groww-access-token-xyz", expiry: "2026-10-09T00:30:00Z", isActive: true });
    },
    "GET groww.test/v1/user/detail": ({ headers }) => headers.Authorization === "Bearer groww-access-token-xyz" ? json(200, { status: "SUCCESS", payload: { ucc: "924189", vendor_user_id: "v" } }) : json(401, { status: "FAILURE", error: { code: "GA005", message: "not authorised" } }),
    "GET groww.test/v1/holdings/user": () => json(200, { status: "SUCCESS", payload: { holdings: Array.from({ length: 51 }, (_, i) => ({ trading_symbol: i ? `S${i}` : "M&M", quantity: 1, average_price: 100 })) } }),
    "GET groww.test/v1/live-data/ltp": ({ url }) => { const syms = url.searchParams.get("exchange_symbols").split(","); assert.ok(syms.length <= 50); return json(200, { status: "SUCCESS", payload: Object.fromEntries(syms.map(s => [s, 110])) }); }
  });
  const c = createBrokerClients({ env: { GROWW_API_KEY: "gkey", GROWW_API_SECRET: "gsecret" }, fetchImpl: f, sessionFile: await tmp(), credentialsFile: path.join(await tmpDir(), "creds.json"), now: () => 1_700_000_000_000, roots });
  assert.deepEqual((await c.groww.status()).modes.map(m => m.mode), ["token", "approval", "totp"]);
  const r = await c.groww.login({ mode: "approval" });
  assert.equal(r.profile.userId, "924189");
  const { holdings, priceNote } = await c.groww.holdings();
  assert.equal(holdings.length, 51); assert.equal(priceNote, null);
  assert.ok(holdings.every(h => h.lastPrice === 110 && h.pnl === 10));
  assert.equal(f.calls.filter(x => x.key.endsWith("/ltp")).length, 2);
  assert.ok(f.calls.some(x => x.url.search.includes("NSE_M%26M")));
});

test("Groww: token from .env, and an expired token is reported as login required", async () => {
  const f = fakeFetch({ "GET groww.test/v1/user/detail": () => json(401, { status: "FAILURE", error: { code: "GA005", message: "Access token expired" } }) });
  const c = createBrokerClients({ env: { GROWW_ACCESS_TOKEN: "envtoken" }, fetchImpl: f, sessionFile: await tmp(), credentialsFile: path.join(await tmpDir(), "creds.json"), roots });
  const s = await c.groww.status();
  assert.equal(s.tokenFromSettings, true); assert.equal(s.connected, false); assert.equal(s.loginRequired, true);
});

test("sessions persist to disk (mode 600) and disconnect forgets them", async () => {
  const file = await tmp();
  const f = fakeFetch({ "GET groww.test/v1/user/detail": () => json(200, { status: "SUCCESS", payload: { ucc: "1" } }) });
  const c1 = createBrokerClients({ env: {}, fetchImpl: f, sessionFile: file, credentialsFile: path.join(await tmpDir(), "creds.json"), roots });
  await c1.groww.login({ mode: "token", accessToken: "a".repeat(40) });
  assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  const c2 = createBrokerClients({ env: {}, fetchImpl: f, sessionFile: file, credentialsFile: path.join(await tmpDir(), "creds.json"), roots });
  assert.equal((await c2.groww.status()).connected, true);
  await c2.groww.forget();
  assert.equal((await c2.groww.status()).connected, false);
});

test("read-only guard: only login/profile/holdings/LTP routes exist, nothing that trades", () => {
  const all = Object.values(READ_ONLY_ROUTES).flat();
  assert.ok(all.every(r => !/order|gtt|fund|withdraw|transfer|cancel|modify|place|convert|kill/i.test(r)), all.join(", "));
  assert.ok(Object.isFrozen(READ_ONLY_ROUTES) && Object.values(READ_ONLY_ROUTES).every(Object.isFrozen));
});

test("settings typed in the app are saved (mode 600), masked, override .env, and enable automatic login", async () => {
  const credentialsFile = path.join(await tmpDir(), "creds.json");
  let logins = 0, valid = "jwt-1";
  const f = fakeFetch({
    "POST angel.test/rest/auth/angelbroking/user/v1/loginByPassword": ({ headers, body }) => { logins++; assert.equal(headers["X-PrivateKey"], "app-key"); assert.equal(body.clientcode, "B999"); valid = `jwt-${logins}`; return json(200, { status: true, data: { jwtToken: valid } }); },
    "GET angel.test/rest/secure/angelbroking/user/v1/getProfile": ({ headers }) => headers.Authorization === `Bearer ${valid}` ? json(200, { status: true, data: { clientcode: "B999", name: "Vinay" } }) : json(200, { status: false, message: "Token Expired", errorcode: "AG8002" }),
    "GET angel.test/rest/secure/angelbroking/portfolio/v1/getAllHolding": ({ headers }) => headers.Authorization === `Bearer ${valid}` ? json(200, { status: true, data: { holdings: [] } }) : json(200, { status: false, message: "Token Expired", errorcode: "AG8002" })
  });
  let t = 1_000_000;
  const c = createBrokerClients({ env: { ANGEL_API_KEY: "env-key" }, fetchImpl: f, sessionFile: await tmp(), credentialsFile, now: () => t, roots });
  let s = await c.angel.status();
  assert.equal(s.settings.find(x => x.name === "apiKey").source, ".env"); assert.equal(s.autoLogin, false); assert.equal(logins, 0);
  await assert.rejects(c.angel.saveSettings({ values: { totpSecret: "not base32 !" } }), /base32/);
  await c.angel.saveSettings({ values: { apiKey: "app-key", clientCode: "b999", pin: "4321", totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" } });
  assert.equal((await fs.stat(credentialsFile)).mode & 0o777, 0o600);
  s = await c.angel.status(); // auto-login happens here, with no typing
  assert.equal(s.connected, true); assert.equal(s.autoLogin, true); assert.equal(logins, 1);
  const key = s.settings.find(x => x.name === "apiKey");
  assert.deepEqual([key.source, key.preview], ["app", "••••"]);
  assert.ok(!JSON.stringify(s).includes("4321"), "saved PIN is never sent back to the page");
  valid = "expired-by-broker"; t += 10 * 60_000; // next day: Angel expired the session
  const { holdings } = await c.angel.holdings();
  assert.deepEqual(holdings, []); assert.equal(logins, 2, "re-logged in by itself once");
  // A new client (server restart) reads the saved details from disk.
  const c2 = createBrokerClients({ env: {}, fetchImpl: f, sessionFile: await tmp(), credentialsFile, now: () => t, roots });
  assert.equal(c2.angel.settings().find(x => x.name === "clientCode").preview, "B999");
  await c2.angel.saveSettings({ clear: ["pin"] });
  assert.equal(c2.angel.autoMode(), null);
});

test("automatic login does not hammer the broker when the saved details are wrong", async () => {
  let logins = 0;
  const f = fakeFetch({
    "POST groww.test/v1/token/api/access": () => { logins++; return json(400, { status: "FAILURE", error: { code: "GA001", message: "Invalid TOTP" } }); },
    "GET groww.test/v1/user/detail": () => json(401, { status: "FAILURE", error: { code: "GA005", message: "not authorised" } })
  });
  const c = createBrokerClients({ env: { GROWW_API_KEY: "k", GROWW_TOTP_SECRET: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }, fetchImpl: f, sessionFile: await tmp(), credentialsFile: path.join(await tmpDir(), "c.json"), now: () => 5_000_000, roots });
  const s = await c.groww.status();
  assert.equal(s.connected, false); assert.match(s.error, /Automatic login also failed: .*Invalid TOTP/);
  await c.groww.status(); await assert.rejects(c.groww.holdings());
  assert.equal(logins, 1, "one attempt, then a 2-minute pause");
});
