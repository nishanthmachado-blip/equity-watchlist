import test from "node:test";
import assert from "node:assert/strict";
import { parseScreener, parseTable, fetchScreener, resetScreener, screenerCooldown, ScreenerBlocked, detectScreenerProfile } from "../screener.mjs";

const years = ["Mar 2019", "Mar 2020", "Mar 2021", "Mar 2022", "Mar 2023", "Mar 2024", "Mar 2025", "TTM"];
const tr = (label, vals, plus = false) => `<tr><td class="text">${label}${plus ? '&nbsp;<span class="blank-span">+</span>' : ""}</td>${vals.map(v => `<td>${v}</td>`).join("")}</tr>`;
const table = (heads, rows) => `<table class="data-table"><thead><tr><th></th>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
const qs = Array.from({ length: 13 }, (_, i) => `Q${i}`);
const html = `<html><body><h1 class="h2 shrink-text">BLS International Services Ltd</h1>
<ul id="top-ratios">
<li class="flex"><span class="name">Market Cap</span><span class="nowrap value">₹ <span class="number">8,900</span> Cr.</span></li>
<li class="flex"><span class="name">Current Price</span><span class="nowrap value">₹ <span class="number">217</span></span></li>
<li class="flex"><span class="name">High / Low</span><span class="nowrap value">₹ <span class="number">400</span> / <span class="number">150</span></span></li>
<li class="flex"><span class="name">Stock P/E</span><span class="nowrap value"><span class="number">12.6</span></span></li>
<li class="flex"><span class="name">Book Value</span><span class="nowrap value">₹ <span class="number">62</span></span></li>
<li class="flex"><span class="name">ROCE</span><span class="nowrap value"><span class="number">29.8</span> %</span></li>
<li class="flex"><span class="name">ROE</span><span class="nowrap value"><span class="number">32.1</span> %</span></li>
</ul>
<section id="peers"><p class="sub"><a href="/market/IN10/" title="Sector">Services</a> <a href="/market/IN10/IN1001/IN100101/" title="Industry">Business Support Services</a></p></section>
<section id="profit-loss">${table(years, [tr("Sales", [100, 120, 150, 200, 300, 400, 600, 700], true), tr("Net Profit", [10, 12, 15, 25, 60, 90, 120, 130], true), tr("Depreciation", [2, 2, 3, 3, 4, 5, 6, 6])])}</section>
<section id="balance-sheet">${table(years.slice(0, 7), [tr("Reserves", [50, 60, 70, 90, 150, 220, 300]), tr("Borrowings", [10, 12, 12, 20, 60, 100, 110], true), tr("Fixed Assets", [20, 22, 25, 30, 40, 55, 80], true), tr("CWIP", [1, 1, 2, 2, 5, 8, 10])])}</section>
<section id="cash-flow">${table(years.slice(0, 7), [tr("Cash from Operating Activity", [8, 9, 12, 20, 55, 80, 100], true)])}</section>
<section id="ratios">${table(years.slice(0, 7), [tr("Debtor Days", [30, 31, 35, 40, 42, 45, 50]), tr("Inventory Days", [0, 0, 0, 0, 0, 0, 0])])}</section>
<section id="shareholding"><div id="quarterly-shp">${table(qs, [tr("Promoters", qs.map((_, i) => `${(75 - i * 0.4).toFixed(2)}%`).reverse(), true), tr("FIIs", qs.map(() => "5%"), true)])}</div></section>
</body></html>`;

test("parseTable reads headers, strips + markers and numbers", () => {
  const t = parseTable(table(["Mar 2024", "Mar 2025"], [tr("Sales", ["1,000", "1,500"], true)]));
  assert.deepEqual(t.headers, ["Mar 2024", "Mar 2025"]); assert.deepEqual(t.rows.Sales, [1000, 1500]);
});

test("parseScreener builds a full entry from a Screener-style page", () => {
  const { entry } = parseScreener(html, { marketSymbol: "BLS" }, "2026-10-04");
  assert.equal(entry.marketCap, 8900); assert.equal(entry.price, 217); assert.equal(entry.pe, 12.6); assert.equal(entry.high52, 400); assert.equal(entry.low52, 150);
  assert.equal(entry.roce, 29.8); assert.equal(entry.roe, 32.1); assert.equal(entry.pb, 3.5);
  assert.equal(entry.salesCagr3, 44.2); // (600/200)^(1/3)-1
  assert.equal(entry.profitCagr3, 68.7); // (120/25)^(1/3)-1
  assert.equal(entry.borrowings, 110); assert.equal(entry.reserves, 300);
  assert.equal(entry.niLatest, 120); assert.equal(entry.niAvg4, 73.8);
  assert.equal(entry.cfoToProfit3, 0.87); // (55+80+100)/(60+90+120)
  assert.equal(entry.fcfNegative, 0);
  assert.equal(entry.debtorDays, 50); assert.equal(entry.promoter, 75); assert.equal(entry.promoterChange3y, 4.8);
  assert.equal(entry.sector, "Services"); assert.equal(entry.industry, "Business Support Services"); assert.equal(entry.profile, "default");
  assert.equal(entry.source, "Screener.in"); assert.equal(entry.asOf, "2026-10-04");
});

test("unrecognised page (login/captcha) fails loudly instead of saving junk", () => {
  assert.throws(() => parseScreener("<html>Please log in</html>", { marketSymbol: "X" }), /layout not recognised/);
  assert.throws(() => parseScreener(html.replace(/<section id="profit-loss">[\s\S]*?<\/section>/, ""), { marketSymbol: "X" }), /missing profit-loss/);
});

test("profile detection for lenders and cyclicals", () => {
  assert.equal(detectScreenerProfile("Financial Services", "Private Sector Bank"), "financial");
  assert.equal(detectScreenerProfile("Metals", "Iron & Steel"), "cyclical");
  assert.equal(detectScreenerProfile("Consumer Durables", "Cables"), "default");
});

test("falls back to standalone page on 404, then 429 starts a cooldown", async () => {
  resetScreener(); const urls = [];
  const f = async u => { urls.push(u); return u.endsWith("consolidated/") ? { ok: false, status: 404, headers: { get: () => null } } : { ok: true, status: 200, text: async () => html }; };
  const r = await fetchScreener({ marketSymbol: "BLS" }, f);
  assert.equal(r.entry.price, 217); assert.equal(urls.length, 2); assert.match(urls[1], /company\/BLS\/$/);
  await assert.rejects(fetchScreener({ marketSymbol: "BLS" }, async () => ({ ok: false, status: 429, headers: { get: () => "120" } })), e => e instanceof ScreenerBlocked && e.rateLimited);
  const mins = (screenerCooldown() - Date.now()) / 60000; assert.ok(mins > 1.9 && mins < 2.1);
  let calls = 0;
  await assert.rejects(fetchScreener({ marketSymbol: "BLS" }, async () => { calls++; return {}; }), ScreenerBlocked);
  assert.equal(calls, 0); resetScreener();
});

test("a blank consolidated page (standalone-only company) falls back to the standalone page", async () => {
  resetScreener(); const urls = [];
  const blank = html.replace(/(<span class="number">)[^<]*(<\/span>)/g, "$1$2");
  const f = async u => { urls.push(u); return { ok: true, status: 200, text: async () => (u.endsWith("consolidated/") ? blank : html) }; };
  const r = await fetchScreener({ marketSymbol: "TIPSMUSIC" }, f);
  assert.equal(r.entry.price, 217); assert.match(urls[0], /consolidated\/$/); assert.match(urls[1], /company\/TIPSMUSIC\/$/);
  resetScreener();
});

test("Screener price: Current Price and 52-week High / Low from the company page", async () => {
  const { fetchScreenerPrice } = await import("../screener.mjs");
  resetScreener();
  const page = `<ul id="top-ratios"><li><span class="name">Current Price</span><span class="number">1,062</span></li><li><span class="name">High / Low</span><span class="number">1,690</span> / <span class="number">985</span></li></ul>`;
  const q = await fetchScreenerPrice({ marketSymbol: "INFY" }, async () => ({ ok: true, status: 200, text: async () => page }));
  assert.deepEqual(q, { price: 1062, high: 1690, low: 985, source: "Screener" });
  await assert.rejects(fetchScreenerPrice({ marketSymbol: "INFY" }, async () => ({ ok: true, status: 200, text: async () => "<html></html>" })), /no current price/);
  resetScreener();
});
