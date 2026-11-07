import test from "node:test";
import assert from "node:assert/strict";
import { parseAbout, parseShareholding, institutionView, fundHolders, parseAnnouncements, parseNewsRss, pressure } from "../companyinfo.mjs";

const html = `<div class="company-profile"><div class="flex"><div class="title">About</div><div class="sub show-more-box about" style="flex-basis:100px"><p>Netweb Technologies India Ltd designs and makes high-end computing systems: supercomputers, AI servers and private cloud.[1]</p></div></div>
<div class="commentary always-show-more-box"><p><strong>Key Points</strong></p><p><strong>Products:</strong><br>Tyrone servers and HPC clusters</p><p>Order book of ₹4,000 Cr</p></div></div>
<section id="shareholding"><div id="quarterly-shp"><table class="data-table"><thead><tr><th class="text"></th><th>Sep 2025</th><th>Dec 2025</th><th>Mar 2026</th><th>Jun 2026</th><th>Sep 2026</th></tr></thead><tbody>
<tr><td class="text"><button>Promoters&nbsp;<span>+</span></button></td><td>71.11%</td><td>71.03%</td><td>71.00%</td><td>71.00%</td><td>70.98%</td></tr>
<tr><td class="text"><button>FIIs&nbsp;<span>+</span></button></td><td>4.20%</td><td>5.10%</td><td>5.60%</td><td>6.40%</td><td>5.10%</td></tr>
<tr><td class="text"><button>DIIs&nbsp;<span>+</span></button></td><td>9.00%</td><td>9.40%</td><td>10.10%</td><td>10.60%</td><td>10.90%</td></tr>
<tr><td class="text"><button>Public&nbsp;<span>+</span></button></td><td>15.69%</td><td>14.47%</td><td>13.30%</td><td>12.00%</td><td>13.02%</td></tr>
<tr><td class="text">No. of Shareholders</td><td>1,20,000</td><td>1,30,000</td><td>1,40,000</td><td>1,50,000</td><td>1,80,000</td></tr></tbody></table></div></section>`;
test("Screener About, key points and shareholding", () => {
  const a = parseAbout(html);
  assert.match(a.about, /^Netweb Technologies India Ltd designs/); assert.ok(!/\[1\]/.test(a.about));
  assert.deepEqual(a.keyPoints, ["Products:", "Tyrone servers and HPC clusters", "Order book of ₹4,000 Cr"]);
  const s = parseShareholding(html);
  assert.deepEqual(s.quarters, ["Sep 2025", "Dec 2025", "Mar 2026", "Jun 2026", "Sep 2026"]);
  assert.deepEqual(s.fiis, [4.2, 5.1, 5.6, 6.4, 5.1]); assert.equal(s.shareholders.at(-1), 180000);
  const v = institutionView(s);
  assert.equal(v.fii.qoq, -1.3); assert.equal(v.fii.trend, "selling"); assert.equal(v.fii.yoy, 0.9);
  assert.equal(v.dii.qoq, 0.3); assert.equal(v.dii.trend, "buying");
  assert.equal(v.verdict.tone, "warn"); assert.match(v.lines[0], /FIIs cut their stake by 1.3 pts/);
  assert.ok(v.lines.some(l => /Shareholders up 50%/.test(l)));
  assert.equal(parseShareholding("<html></html>"), null);
});
test("funds holding it, NSE filings, Google News", () => {
  const funds = [{ name: "Motilal Oswal Midcap Fund", holdings: [{ name: "Netweb Technologies India Ltd.", weight: 2.5 }, { name: "X", weight: 97.5 }] }, { name: "Other Fund", holdings: [{ name: "TCS", weight: 100 }] }];
  assert.deepEqual(fundHolders(funds, { symbol: "NETWEB", name: "Netweb Technologies India Limited" }).map(f => [f.fund, f.weight]), [["Motilal Oswal Midcap Fund", 2.5]]);
  const ann = parseAnnouncements([{ desc: "Bagging/Receiving of orders/contracts", attchmntText: "Netweb has received an order worth Rs 450 crore", an_dt: "29-Oct-2026 18:20:11", attchmntFile: "https://nsearchives.nseindia.com/x.pdf" }, { desc: "Trading Window-XBRL", an_dt: "01-Oct-2026 10:00:00" }, { desc: "Outcome of Board Meeting", an_dt: "15-Oct-2026 10:00:00" }]);
  assert.equal(ann.length, 2); assert.equal(ann[0].date, "2026-10-29"); assert.equal(ann[0].order, true); assert.equal(ann[1].order, false);
  const rss = `<rss><channel><item><title>Netweb shares fall 5% after results - Moneycontrol</title><link>https://news.google.com/a</link><pubDate>Thu, 05 Nov 2026 10:00:00 GMT</pubDate><source url="x">Moneycontrol</source></item><item><title>Older</title><link>https://b</link><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
  const n = parseNewsRss(rss);
  assert.deepEqual(n.map(x => [x.title, x.source]), [["Netweb shares fall 5% after results", "Moneycontrol"], ["Older", null]]);
});
test("selling pressure from candles and the institutions' move", () => {
  const bars = []; let p = 3000;
  for (let i = 0; i < 260; i++) { p = i < 200 ? p * 1.004 : p * (i % 3 ? 0.985 : 1.004); const up = i >= 200 && i % 3 === 0; bars.push({ t: i, o: p, h: p, l: p, c: p, v: i >= 235 ? (up ? 80 : 300) : 100 }); }
  const r = pressure(bars, { inst: { fii: { qoq: -1.3 }, dii: { qoq: 0.3 } } });
  assert.equal(r.tone, "warn"); assert.match(r.label, /selling pressure/);
  assert.ok(r.signs.some(s => /200-day/.test(s))); assert.ok(r.signs.some(s => /heavy-volume down days/.test(s))); assert.ok(r.signs.some(s => /FIIs cut/.test(s)));
  assert.equal(pressure(bars.slice(0, 10)), null);
});
