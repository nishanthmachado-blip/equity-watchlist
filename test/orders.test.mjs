import test from "node:test";
import assert from "node:assert/strict";
import { orderValueCr, orderBookCr, parseOrderAnnouncements, mergeOrders, rankOrderWinners, annDay } from "../orders.mjs";
import { snapshot, detectSetups, rankIdeas } from "../swingideas.mjs";

test("order value from announcement text: crore, lakh, plain rupees, US$ / euro million", () => {
  assert.equal(orderValueCr("received an order worth Rs. 1,250.50 Crore from NHAI"), 1250.5);
  assert.equal(orderValueCr("orders aggregating to ₹ 523 Cr (excluding GST)"), 523);
  assert.equal(orderValueCr("LoA of INR 84.5 crores"), 84.5);
  assert.equal(orderValueCr("work order of Rs 450 lakh"), 4.5);
  assert.equal(orderValueCr("contract valued at Rs. 12,34,56,789/-"), 12.3);
  assert.equal(orderValueCr("an export order of USD 25 million", 88), 220);
  assert.equal(orderValueCr("EUR 10 million order", 88), 95);
  assert.equal(orderValueCr("bagged multiple orders of 2,100 crore"), 2100);
  assert.equal(orderValueCr("received an order from Indian Railways"), null);
  assert.equal(orderBookCr("With this, the order book stands at ₹ 45,200 crore."), 45200);
  assert.deepEqual([annDay("21-Oct-2026 10:15:02"), annDay("2026-10-20 18:01:00")], ["2026-10-21", "2026-10-20"]);
});

const ANN = [
  { symbol: "BEL", sm_name: "Bharat Electronics Limited", desc: "Bagging/Receiving of orders/contracts", attchmntText: "BEL has secured orders worth Rs. 1,640 crore. With these, the order book stands at Rs. 75,000 crore.", an_dt: "20-Oct-2026 18:01:00", seq_id: "1", smIndustry: "Aerospace & Defense" },
  { symbol: "KPIL", sm_name: "Kalpataru Projects", desc: "Bagging/Receiving of orders/contracts", attchmntText: "KPIL has received new orders of ₹ 2,200 Cr in T&D", an_dt: "10-Sep-2026 09:00:00", seq_id: "2" },
  { symbol: "KPIL", sm_name: "Kalpataru Projects", desc: "Award of Order / Receipt of Order", attchmntText: "LoA worth INR 800 crore", an_dt: "01-Oct-2026 09:00:00", seq_id: "3" },
  { symbol: "XYZ", sm_name: "XYZ Ltd", desc: "Updates", attchmntText: "Order of the Hon'ble NCLT dated 10 Oct 2026 approving the scheme", an_dt: "15-Oct-2026 09:00:00", seq_id: "4" },
  { symbol: "TAX", sm_name: "Tax Co", desc: "Updates", attchmntText: "Received an assessment order from the Income Tax department of Rs 50 crore", an_dt: "15-Oct-2026 09:00:00", seq_id: "5" },
  { symbol: "RVNL", sm_name: "Rail Vikas Nigam", desc: "Bagging/Receiving of orders/contracts", attchmntText: "RVNL emerged as the lowest bidder; Letter of Award received", an_dt: "18-Oct-2026 11:00:00", seq_id: "6" },
  { symbol: "OLD", sm_name: "Old Co", desc: "Bagging/Receiving of orders/contracts", attchmntText: "order of Rs 10 crore", an_dt: "01-Jan-2026 11:00:00", seq_id: "7" }
];
test("order announcements: orders kept, court / tax orders dropped; order book separated from the order value", () => {
  const o = parseOrderAnnouncements(ANN);
  assert.deepEqual(o.map(x => x.symbol), ["BEL", "KPIL", "KPIL", "RVNL", "OLD"]);
  const bel = o[0]; assert.deepEqual([bel.valueCr, bel.bookCr, bel.day, bel.industry], [1640, 75000, "2026-10-20", "Aerospace & Defense"]);
  assert.equal(o.find(x => x.symbol === "RVNL").valueCr, null);
  assert.equal(mergeOrders(o, o, "2026-06-01").length, 4, "deduplicated by id, older than the cut-off dropped");
});
test("order winners ranked by size vs sales, frequency and quality", () => {
  const facts = new Map([["BEL", { sales: 25000, salesGrowth: 15, roce: 38, verdict: "expensive" }], ["KPIL", { sales: 20000, salesGrowth: 12, roce: 16, verdict: "buy", inZone: true }]]);
  const r = rankOrderWinners(parseOrderAnnouncements(ANN), { today: "2026-10-21", days: 90, facts });
  assert.deepEqual(r.map(c => c.symbol), ["KPIL", "BEL", "RVNL"]);
  const k = r[0]; assert.deepEqual([k.wins, k.totalCr, k.ofSales, k.biggestCr], [2, 3000, 15, 2200]);
  assert.equal(r[1].bookYears, 3, "order book ≈ 3× yearly sales");
  assert.equal(rankOrderWinners(parseOrderAnnouncements(ANN), { today: "2026-10-21", days: 30 }).find(c => c.symbol === "KPIL").wins, 1);
});

// a year of rising prices that ends at a new 52-week high on volume
function bars({ end = 1.0, vol = 2 } = {}) {
  const out = []; for (let i = 0; i < 260; i++) { const c = 100 + i * 0.25 + Math.sin(i / 4) * 6 + Math.sin(i / 1.7) * 2.5; out.push({ c, h: c * 1.01, l: c * 0.99, v: 100000 }); }
  const prevHigh = Math.max(...out.slice(0, -1).map(b => b.h)); out[259] = { c: prevHigh * end, h: prevHigh * end * 1.005, l: prevHigh * 0.98, v: 100000 * vol };
  return out;
}
test("52-week high breakout above a rising 200-DMA, with volume; not when volume is missing or price is stretched", () => {
  const s = snapshot(bars({ end: 1.015 }));
  assert.ok(s.high52Prev > 0 && s.sma200 > s.sma200Ago);
  const hit = detectSetups(s).find(x => x.setup === "high52");
  assert.ok(hit, JSON.stringify(s)); assert.ok(hit.stop < hit.entry && hit.t1 > hit.entry && hit.rr >= 1.5);
  assert.match(hit.why[0], /New 52-week high/); assert.match(hit.why[1], /above a rising 200-day average/);
  assert.ok(!detectSetups(snapshot(bars({ end: 1.015, vol: 0.8 }))).some(x => x.setup === "high52"), "needs volume");
  assert.ok(!detectSetups(snapshot(bars({ end: 0.95 }))).some(x => x.setup === "high52"), "5% below the high is not a breakout");
  const ideas = rankIdeas([{ symbol: "AAA", name: "AAA", snap: s }]);
  assert.ok(ideas[0].setup === "high52" || ideas[0].alts?.some(a => a.setup === "high52"), "kept as the idea or one of its other setups");
});
