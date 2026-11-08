import test from "node:test";
import assert from "node:assert/strict";
import { muhuratView, sanitizePick, sanitizeYear, cagr, MUHURAT_DATES } from "../muhurat.mjs";

const P = (id, year, symbol, qty, price, date) => ({ id, year, symbol, qty, price, date: date || MUHURAT_DATES[year], note: null });

test("CAGR only after a year; doubling time; known Muhurat dates", () => {
  assert.equal(cagr(100, 200, 5), 14.87); assert.equal(cagr(100, 120, 0.5), null);
  assert.equal(MUHURAT_DATES[2026], "2026-11-08"); assert.equal(MUHURAT_DATES[2024], "2024-11-01");
});

test("year by year: value, gain, CAGR, Nifty from the same day; all years XIRR", () => {
  const picks = [P("a", 2021, "HDFCBANK", 10, 1500), P("b", 2021, "ITC", 100, 225), P("c", 2024, "TCS", 5, 4000), P("d", 2026, "NETWEB", 10, 4000)];
  const prices = { HDFCBANK: 1800, ITC: 450, TCS: 3500, NETWEB: 4100 };
  const v = muhuratView({ picks, price: s => ({ price: prices[s], asOf: "2026-11-08T10:00:00Z" }), niftyNow: 280, niftyOn: d => (d === "2021-11-04" ? 180 : d === "2024-11-01" ? 260 : null), today: "2026-11-08" });
  assert.deepEqual(v.years.map(y => y.year), [2026, 2024, 2021]);
  const y21 = v.years.find(y => y.year === 2021);
  assert.deepEqual([y21.invested, y21.value, y21.gain], [37500, 63000, 25500]);
  assert.equal(y21.cagr, cagr(37500, 63000, (Date.parse("2026-11-08") - Date.parse("2021-11-04")) / (365.25 * 864e5)));
  assert.ok(y21.nifty.cagr > 9 && y21.nifty.cagr < 9.5); assert.equal(y21.nifty.ifInvested, Math.round(37500 * 280 / 180)); assert.ok(y21.vsNifty > 0);
  const y26 = v.years.find(y => y.year === 2026); assert.equal(y26.cagr, null); assert.equal(y26.picks[0].longFrom, "2027-11-09"); assert.equal(y26.nifty.then, null);
  const itc = y21.picks.find(p => p.symbol === "ITC"); assert.ok(itc.cagr > 14 && itc.doubleIn > 4 && itc.doubleIn < 6);
  assert.equal(v.all.invested, 37500 + 20000 + 40000); assert.equal(v.all.value, 63000 + 17500 + 41000); assert.ok(v.all.xirr > 0); assert.equal(v.all.winners, 3);
  assert.equal(v.muhuratToday, true);
});

test("a stock without a price: counted, totals wait for it; your own NIFTYBEES price wins", () => {
  const v = muhuratView({ picks: [P("a", 2023, "NEWCO", 10, 100)], years: { 2023: { niftyThen: 200 } }, price: () => null, niftyNow: 250, niftyOn: () => 210, today: "2026-11-08" });
  assert.equal(v.years[0].value, null); assert.equal(v.years[0].unpriced, 1); assert.equal(v.all.unpriced, 1);
  assert.equal(v.years[0].nifty.then, 200); assert.equal(v.years[0].nifty.thenFrom, "you");
});

test("entries are checked; the year's Muhurat date is the default buy date", () => {
  const p = sanitizePick({ year: 2025, symbol: "nse:infy", qty: "10", price: "1,520.5" }, { today: "2026-11-08" });
  assert.deepEqual([p.symbol, p.qty, p.price, p.date], ["INFY", 10, 1520.5, "2025-10-21"]);
  assert.equal(sanitizePick({ year: 2022, symbol: "ITC", qty: 1, price: 1 }, { today: "2026-11-08", years: { 2022: { date: "2022-10-25" } } }).date, "2022-10-25");
  assert.throws(() => sanitizePick({ year: 2027, symbol: "ITC", qty: 1, price: 1 }, { today: "2026-11-08" }), /year/);
  assert.throws(() => sanitizePick({ year: 2025, symbol: "ITC", qty: 0, price: 1 }, { today: "2026-11-08" }), /quantity/);
  assert.deepEqual(sanitizeYear({ year: 2020, date: "2020-11-14", niftyThen: "125.4", budget: "50,000" }, "2026-11-08"), { year: 2020, date: "2020-11-14", niftyThen: 125.4, budget: 50000 });
});

import { sanitizeWatch, muhuratWatchView } from "../muhurat.mjs";
test("Muhurat watchlist: buy-below, 52-week range, planned amount, valuation from the main watchlist", () => {
  const w1 = sanitizeWatch({ symbol: "titan", target: "3,200", amount: "50000", note: "jewellery leader" }, { today: "2026-11-08", price: 3400 });
  assert.deepEqual([w1.symbol, w1.target, w1.amount, w1.addedPrice, w1.addedOn], ["TITAN", 3200, 50000, 3400, "2026-11-08"]);
  const w2 = sanitizeWatch({ symbol: "ITC" }, { today: "2026-11-08" });
  assert.throws(() => sanitizeWatch({ symbol: "ITC", amount: "-5" }, { today: "2026-11-08" }), /planned amount/);
  const v = muhuratWatchView({ watch: [w1, w2], price: s => ({ price: s === "TITAN" ? 3150 : 410 }), range: s => (s === "TITAN" ? { high52: 3900, low52: 2800 } : null),
    verdict: s => (s === "ITC" ? { status: "Fair", zoneLow: 380, zoneHigh: 420 } : null), nextDate: "2027-10-29", today: "2026-11-08" });
  assert.equal(v.rows[0].symbol, "TITAN"); // at its buy-below price: first
  assert.deepEqual([v.rows[0].atTarget, v.rows[0].toTarget, v.rows[0].offHigh, v.rows[0].qtyAtNow, v.rows[0].sinceAdded], [true, -1.56, 19.23, 15, -7.35]);
  assert.deepEqual([v.rows[1].verdict.inZone, v.rows[1].toTarget], [true, null]);
  assert.deepEqual([v.planned, v.atTarget, v.daysToNext], [50000, 1, 355]);
});
