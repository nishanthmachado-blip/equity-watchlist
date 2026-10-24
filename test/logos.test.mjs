import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { logoQuery, parseLogoResult, domainOf, commonsPng, imageKind, imageSize, initials } from "../logos.mjs";
import { parseWebsite } from "../screener.mjs";

// a real 2×2 PNG
function png(W = 2) {
  const crc = b => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: W }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(W * 3, 200)])));
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
test("logos: query, result matching (ISIN wins), safe image types, initials", () => {
  const items = [{ symbol: "TCS", isin: "INE467B01029" }, { symbol: "HEROMOTOCO", isin: null }];
  const q = logoQuery(items); assert.match(q, /"INE467B01029"/); assert.match(q, /"HEROMOTOCO"/); assert.match(q, /wd:Q668/);
  const m = parseLogoResult({ results: { bindings: [
    { c: { value: "http://www.wikidata.org/entity/Q1" }, ticker: { value: "TCS" }, web: { value: "https://wrong.example" } },
    { c: { value: "http://www.wikidata.org/entity/Q2" }, isin: { value: "INE467B01029" }, web: { value: "https://www.tcs.com/" }, logo: { value: "http://commons.wikimedia.org/wiki/Special:FilePath/TCS%20logo.svg" } },
    { c: { value: "http://www.wikidata.org/entity/Q3" }, ticker: { value: "HEROMOTOCO" }, web: { value: "https://www.heromotocorp.com" } }] } }, items);
  assert.equal(m.get("TCS").web, "https://www.tcs.com/"); assert.equal(m.get("TCS").qid, "Q2");
  assert.equal(domainOf(m.get("HEROMOTOCO").web), "heromotocorp.com");
  assert.equal(commonsPng(m.get("TCS").logo), "https://commons.wikimedia.org/wiki/Special:FilePath/TCS%20logo.svg?width=96");
  assert.equal(imageKind(png()), "image/png"); assert.deepEqual(imageSize(png()), { w: 2, h: 2 });
  assert.equal(imageKind(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null, "never SVG / HTML");
  assert.equal(parseWebsite('<div class="company-links show-from-tablet-above"><a href="https://www.bseindia.com/x">BSE</a><a href="https://www.lemontreehotels.com" target="_blank"><span>lemontreehotels.com</span></a></div>'), "https://www.lemontreehotels.com");
  assert.equal(parseWebsite("<div>no links</div>"), null);
  assert.deepEqual([initials("Hero MotoCorp Ltd"), initials("TCS"), initials("Mahindra & Mahindra Ltd"), initials("Bajaj Finance Limited")], ["HM", "TC", "M&", "BF"]);
});

const freePort = () => new Promise(r => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => r(p)); }); });
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
test("server: looks logos up in the background, serves them from the app with safe headers", async () => {
  const seen = [];
  const fake = http.createServer(async (req, res) => {
    let body = ""; for await (const ch of req) body += ch; seen.push(`${req.method} ${req.url}`);
    if (req.url.startsWith("/sparql")) { const q = new URLSearchParams(body).get("query"); res.writeHead(200, { "Content-Type": "application/sparql-results+json" }); return res.end(JSON.stringify({ results: { bindings: q.includes('"INFY"') ? [{ c: { value: "x/Q9" }, ticker: { value: "INFY" }, web: { value: "https://www.infosys.com" } }, { c: { value: "x/Q8" }, ticker: { value: "EVIL" }, web: { value: "https://evil.example" } }] : [] } })); }
    if (req.url.startsWith("/s2/favicons")) { if (req.url.includes("infosys.com")) { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(png(64)); } res.writeHead(200, { "Content-Type": "image/svg+xml" }); return res.end("<svg/>"); }
    res.writeHead(404); res.end();
  });
  const fport = await freePort(); await new Promise(r => fake.listen(fport, "127.0.0.1", r));
  const F = `http://127.0.0.1:${fport}`, dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ew-logo-")), port = await freePort();
  const child = spawn(process.execPath, ["server.mjs"], { cwd: root, env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, SETUP_CODE: "l-code", AUTO_FUNDAMENTALS: "0", KITE_MCP_ENABLED: "0", EOD: "0", BACKUP: "0", ANGEL_STREAM: "0",
    PRICE_SOURCES: "nse,yahoo", NSE_BASE: "http://127.0.0.1:9", NSE_ARCHIVE_BASE: "http://127.0.0.1:9", YAHOO_CHART_BASE: "http://127.0.0.1:9", SCREENER_BASE: "http://127.0.0.1:9", LOGO_SPARQL_URL: `${F}/sparql`, LOGO_FAVICON_BASE: F }, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; child.stdout.on("data", d => log += d); child.stderr.on("data", d => log += d);
  const call = async (p, { cookie, body } = {}) => { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method: body ? "POST" : "GET", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); const buf = Buffer.from(await r.arrayBuffer()); let json = null; try { json = JSON.parse(buf.toString()); } catch {} return { status: r.status, json, buf, headers: r.headers, cookie: (r.headers.get("set-cookie") || "").split(";")[0] }; };
  try {
    for (let i = 0; i < 80 && !log.includes("running at"); i++) await new Promise(r => setTimeout(r, 100));
    const owner = (await call("/api/auth/setup", { body: { code: "l-code", username: "owner", password: "owner-pass-phrase" } })).cookie;
    const t0 = Date.now(), a = await call("/api/logos", { cookie: owner, body: { symbols: ["INFY", "NOPE", "../x"] } });
    assert.ok(Date.now() - t0 < 1500, "answers at once"); assert.deepEqual(a.json.pending.sort(), ["INFY", "NOPE"]);
    let b; for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 150)); b = await call("/api/logos", { cookie: owner, body: { symbols: ["INFY", "NOPE"] } }); if (b.json.have.INFY && !b.json.pending.length) break; }
    assert.ok(b.json.have.INFY, log.slice(-500)); assert.deepEqual(b.json.pending, [], "NOPE has no logo: not asked again");
    const img = await call("/api/logo/INFY", { cookie: owner });
    assert.equal(img.status, 200); assert.equal(img.headers.get("content-type"), "image/png"); assert.equal(img.headers.get("x-content-type-options"), "nosniff");
    assert.equal(img.buf.subarray(0, 4).toString("hex"), "89504e47");
    assert.equal((await call("/api/logo/NOPE", { cookie: owner })).status, 404);
    const st = await call("/api/logos/status", { cookie: owner }); assert.deepEqual([st.json.found, st.json.none], [1, 1]);
    assert.equal((await call("/api/logo/INFY")).status, 401, "needs a login");
    assert.ok(!seen.some(x => x.includes("evil")), "only asked about the right company");
    // you give a website for a company with no logo
    const site = await call("/api/logos/site", { cookie: owner, body: { symbol: "NOPE", website: "www.infosys.com/about" } });
    assert.equal(site.status, 200, site.buf.toString()); assert.equal((await call("/api/logo/NOPE", { cookie: owner })).status, 200);
    assert.equal((await call("/api/logos/site", { cookie: owner, body: { symbol: "NOPE", website: "not a site" } })).status, 400);
  } finally { child.kill("SIGTERM"); await new Promise(r => child.once("exit", r)); fake.close(); }
});
