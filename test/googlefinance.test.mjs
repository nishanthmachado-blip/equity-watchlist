import test from "node:test";
import assert from "node:assert/strict";
import { parseGoogleQuote, fetchGoogleQuote, googleCooldown, resetGoogle, GoogleBlocked } from "../googlefinance.mjs";

// Synthetic page that mimics the markup this parser targets (not a captured Google page): verify against the real
// site with GET /api/price-compare?symbol=RELIANCE on your own network.
const page = (o = {}) => `<html><body>${"x".repeat(200)}
<div class="zzDege" data-source="NSE" data-last-price="${o.price ?? "2849.7"}" data-currency-code="${o.cur ?? "INR"}" data-last-normal-market-timestamp="1759900000"><div class="YMlKec fxKbKc">₹2,849.70</div></div>
<div class="mfs7Fc">Previous close</div><div class="P6K39c">₹2,830.10</div>
<div class="mfs7Fc">Year range</div><div class="P6K39c">₹2,001.00 - ₹3,802.40</div></body></html>`;

test("parses price, 52-week range, previous close and timestamp", () => {
  const q = parseGoogleQuote(page());
  assert.equal(q.price, 2849.7); assert.equal(q.low, 2001); assert.equal(q.high, 3802.4); assert.equal(q.prevClose, 2830.1); assert.equal(q.currency, "INR");
  assert.equal(q.asOf, new Date(1759900000 * 1000).toISOString());
});
test("falls back to the big price element when the data attribute is missing", () => {
  const html = page().replace(/data-last-price="[^"]*"/, "");
  assert.equal(parseGoogleQuote(html).price, 2849.7);
});
test("unrecognised layout, consent page, empty page and non-INR quotes are errors, never wrong numbers", () => {
  assert.throws(() => parseGoogleQuote("<html>" + "y".repeat(500) + "</html>"), /layout not recognised/);
  assert.throws(() => parseGoogleQuote("<html>" + "y".repeat(300) + "Before you continue to Google</html>"), /consent/);
  assert.throws(() => parseGoogleQuote(""), /empty page/);
  assert.throws(() => parseGoogleQuote(page({ cur: "USD" })), /not INR/);
});
test("a missing or inverted year range yields null low/high rather than garbage", () => {
  const noRange = page().replace(/Year range[\s\S]*?<\/div><\/body>/, "</body>");
  const q = parseGoogleQuote(noRange); assert.equal(q.price, 2849.7); assert.equal(q.low, null); assert.equal(q.high, null);
  const bad = parseGoogleQuote(page().replace("₹2,001.00 - ₹3,802.40", "₹5,000.00 - ₹3,000.00")); assert.equal(bad.low, null);
});
test("fetch builds the right URL, validates symbols, and cools down after a 429", async () => {
  resetGoogle(); const seen = [];
  const ok = async url => { seen.push(url); return new Response(page(), { status: 200 }); };
  const q = await fetchGoogleQuote("m&m", { fetchImpl: ok });
  assert.equal(seen[0], "https://www.google.com/finance/quote/M%26M%3ANSE?hl=en"); assert.equal(q.symbol, "M&M"); assert.equal(q.source, "Google Finance");
  await assert.rejects(() => fetchGoogleQuote("bad symbol!", { fetchImpl: ok }), /invalid symbol/);
  await assert.rejects(() => fetchGoogleQuote("TCS", { fetchImpl: async () => new Response("", { status: 429 }) }), GoogleBlocked);
  assert.ok(googleCooldown());
  await assert.rejects(() => fetchGoogleQuote("TCS", { fetchImpl: ok }), /cooling down/);
  assert.equal(seen.length, 1, "no request is made while cooling down");
  resetGoogle();
  await assert.rejects(() => fetchGoogleQuote("TCS", { fetchImpl: async () => new Response("", { status: 404 }) }), /not found/);
});
