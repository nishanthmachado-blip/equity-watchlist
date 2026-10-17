import test from "node:test";
import assert from "node:assert/strict";
import { parseBhavcopy, parseIndexCloses, mergeBars, weekdaysBack, eodDay } from "../eod.mjs";
import { parsePurpose, parseNseActions, parseYahooEvents, adjustPosition, adjustWatch, mergeActions } from "../corpactions.mjs";
import { parseNseEvents, eventsFor, swingEventAdvice, parseYahooCalendar } from "../events.mjs";
import { xirr, indexTwin, returnsView, dividendsReceived, forwardDividends, closeOn } from "../returns.mjs";
import { logIdeas, judgeIdea, ideaStats } from "../ideastrack.mjs";
import { sanitizeRule, checkLiveRule, checkEodRule } from "../alertrules.mjs";
import { morningDigest, eveningDigest } from "../digest.mjs";
import { sanitizeBasket, basketView } from "../accumulate.mjs";
import { gz, verifyBackup, signS3 } from "../backup.mjs";
import { journalStats, sanitizeReview, sanitizePosition, applySell } from "../swing.mjs";

const T = d => Math.floor(Date.parse(`${d}T10:00:00Z`) / 1000);

test("bhavcopy and index-close files parse (old and UDiFF layouts)", () => {
  const old = ` SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE, TTL_TRD_QNTY, TURNOVER_LACS, NO_OF_TRADES, DELIV_QTY, DELIV_PER
INFY, EQ, 16-Oct-2026, 1023.10, 1030.00, 1115.00, 1028.00, 1110.00, 1110.40, 1080.2, 9876543, 100, 5, 4000000, 41.2
INFY, N1, 16-Oct-2026, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1
ITBEES, EQ, 16-Oct-2026, 41.00, 41.1, 41.5, 40.9, 41.2, 41.20, 41.2, 120000, 1, 1, 1, 1`;
  const b = parseBhavcopy(old);
  assert.equal(b.day, "2026-10-16"); assert.equal(b.rows.length, 2);
  assert.deepEqual([b.rows[0].symbol, b.rows[0].close, b.rows[0].prev, b.rows[0].high, b.rows[0].volume], ["INFY", 1110.4, 1023.1, 1115, 9876543]);
  const ud = parseBhavcopy("TradDt,BizDt,Sgmt,Src,FinInstrmTp,FinInstrmId,ISIN,TckrSymb,SctySrs,XpryDt,FininstrmActlXpryDt,StrkPric,OptnTp,FinInstrmNm,OpnPric,HghPric,LwPric,ClsPric,LastPric,PrvsClsgPric,UndrlygPric,SttlmPric,OpnIntrst,ChngInOpnIntrst,TtlTradgVol\n2026-10-16,2026-10-16,CM,NSE,STK,1,INE009A01021,INFY,EQ,,,,,INFOSYS,1030,1115,1028,1110.4,1110,1023.1,,,,,9876543");
  assert.equal(ud.rows[0].close, 1110.4); assert.equal(ud.day, "2026-10-16");
  const ix = parseIndexCloses("Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value,Points Change,Change(%),Volume,Turnover (Rs. Cr.),P/E,P/B,Div Yield\nNifty 50,16-10-2026,25000,25200,24950,25100.5,100,0.4,1,1,22.1,3.5,1.3");
  assert.deepEqual([ix.rows[0].name, ix.rows[0].close, ix.rows[0].pe, ix.day], ["Nifty 50", 25100.5, 22.1, "2026-10-16"]);
  assert.throws(() => parseBhavcopy("a,b\n1,2"));
  assert.equal(eodDay("16-10-2026"), "2026-10-16");
  assert.deepEqual(weekdaysBack("2026-10-19", 3), ["2026-10-19", "2026-10-16", "2026-10-15"]); // Monday → skips the weekend
  assert.deepEqual(mergeBars([{ t: 1, c: 1 }, { t: 2, c: 2 }], [{ t: 2, c: 5 }, { t: 3, c: 3 }]).map(b => b.c), [1, 5, 3]);
});

test("corporate-action text: dividends (several), bonus, split", () => {
  assert.deepEqual(parsePurpose("Interim Dividend - Rs 23 Per Share").map(x => [x.kind, x.amount]), [["dividend", 23]]);
  assert.equal(parsePurpose("Final Dividend - Rs 20 Per Share And Special Dividend - Rs 8 Per Share")[0].amount, 28);
  assert.equal(parsePurpose("Dividend - 250%", 2)[0].amount, 5);
  assert.equal(parsePurpose("Dividend - Re 0.50 Per Share")[0].amount, 0.5);
  const bonus = parsePurpose("Bonus 1:1")[0]; assert.deepEqual([bonus.kind, bonus.factor], ["bonus", 2]);
  assert.equal(parsePurpose("Bonus 1:2")[0].factor, 1.5);
  const split = parsePurpose("Face Value Split (Sub-Division) - From Rs 10/- Per Share To Rs 2/- Per Share").find(x => x.kind === "split"); assert.equal(split.factor, 5);
  const rows = parseNseActions([{ symbol: "INFY", subject: "Interim Dividend - Rs 23 Per Share", exDate: "27-Oct-2026", recDate: "27-Oct-2026", faceVal: "5" }, { symbol: "XYZ", subject: "Bonus 1:1", exDate: "-" }]);
  assert.equal(rows.length, 1); assert.deepEqual([rows[0].exDate, rows[0].amount], ["2026-10-27", 23]);
  const y = parseYahooEvents("ABC", { splits: { a: { date: T("2026-06-01"), numerator: 2, denominator: 1, splitRatio: "2:1" } }, dividends: { b: { date: T("2026-05-01"), amount: 3 } } });
  assert.deepEqual(y.map(x => x.kind).sort(), ["dividend", "split"]);
  assert.equal(mergeActions([{ ...y.find(x => x.kind === "split"), source: "Yahoo" }], [{ symbol: "ABC", kind: "bonus", exDate: "2026-06-01", factor: 2, source: "NSE" }]).length, 1);
});

test("a 1:1 bonus doubles the shares and halves the average, once, only for shares bought before the ex-date", () => {
  const p = { id: "p1", symbol: "ABC", qty: 100, avgPrice: 200, stopLoss: 180, addBelow: 190, lots: [{ qty: 60, price: 210, at: "2026-05-01T04:00:00Z" }, { qty: 40, price: 185, at: "2026-07-01T04:00:00Z" }] };
  const acts = [{ symbol: "ABC", kind: "bonus", label: "Bonus 1:1", factor: 2, exDate: "2026-06-15" }];
  const r = adjustPosition(p, acts, "2026-10-01");
  assert.equal(r.applied.length, 1);
  assert.deepEqual(r.position.lots.map(l => [l.qty, l.price]), [[120, 105], [40, 185]]);
  assert.equal(r.position.qty, 160); assert.equal(r.position.stopLoss, 90); assert.equal(r.position.addBelow, 95);
  assert.equal(adjustPosition(r.position, acts, "2026-10-01").applied.length, 0, "applied once");
  assert.equal(adjustPosition(p, acts, "2026-06-14").applied.length, 0, "not before the ex-date");
  const w = adjustWatch({ symbol: "ABC", buyBelow: 190, stopLoss: 170, idea: { t1: 240 }, addedAt: "2026-01-01" }, acts, "2026-10-01").watch;
  assert.deepEqual([w.buyBelow, w.stopLoss, w.idea.t1], [95, 85, 120]);
});

test("swing decision: INFY at a target with a dividend 5 days away says wait for it; results soon say protect the gain", () => {
  const today = "2026-10-22";
  const evs = eventsFor("INFY", { today, actions: [{ symbol: "INFY", kind: "dividend", label: "Interim dividend", amount: 23, exDate: "2026-10-27", source: "NSE" }], events: [] });
  const row = { symbol: "INFY", status: "take-profit", pnlPct: 12.9, qty: 300, price: 1161 };
  const a = swingEventAdvice(row, evs);
  assert.match(a.headline, /Wait for the dividend: sell on or after 27 Oct/);
  assert.equal(a.tone, "good");
  assert.match(a.items[0].text, /₹6,900 on your 300 shares/);
  assert.match(a.items[0].text, /hold the shares at the end of 26 Oct/); // the weekday before the ex-date (27 Oct 2026 is a Tuesday)
  assert.match(a.items[0].text, /taxed at your income-tax slab/);
  // at the stop-loss: don't hold for a dividend
  assert.match(swingEventAdvice({ ...row, status: "stop-hit", pnlPct: -8 }, evs).headline, /at the stop/);
  // results in 2 days while in profit
  const r = swingEventAdvice(row, eventsFor("INFY", { today, events: parseNseEvents([{ symbol: "INFY", purpose: "Financial Results", bm_desc: "To consider results", date: "24-Oct-2026" }]), actions: [] }));
  assert.match(r.headline, /Results in 2 days: protect the gain/); assert.equal(r.tone, "warn");
  // Yahoo calendar fallback
  const yc = parseYahooCalendar("INFY", { quoteSummary: { result: [{ calendarEvents: { earnings: { earningsDate: [{ raw: T("2026-10-24") }] }, exDividendDate: { raw: T("2026-10-27") } } }] } });
  assert.deepEqual(yc.map(e => e.kind), ["results", "exdiv"]);
  assert.equal(swingEventAdvice(row, []), null);
});

test("XIRR and the index twin", () => {
  // ₹100 in, ₹110 out a year later = 10%
  assert.ok(Math.abs(xirr([{ date: "2025-01-01", amount: -100 }, { date: "2026-01-01", amount: 110 }]) - 0.1) < 1e-4);
  assert.equal(xirr([{ date: "2025-01-01", amount: -100 }]), null);
  const bars = [{ t: T("2025-01-01"), c: 100 }, { t: T("2025-07-01"), c: 105 }, { t: T("2026-01-01"), c: 120 }];
  assert.equal(closeOn(bars, "2025-08-15"), 105);
  const twin = indexTwin([{ date: "2025-01-01", amount: -1000 }], bars, "2026-01-01");
  assert.equal(twin.value, 1200); assert.equal(twin.xirr, 20);
  const v = returnsView({ trades: [{ symbol: "AAA", date: "2025-01-01", side: "buy", qty: 10, price: 100 }], holdings: [{ symbol: "AAA", qty: 10, price: 130 }], dividends: [{ symbol: "AAA", exDate: "2025-06-01", amount: 2 }], benchmarks: { NIFTY50: bars }, today: "2026-01-01" });
  assert.equal(v.rows[0].dividends, 20); assert.equal(v.rows[0].gain, 320); assert.ok(v.rows[0].xirr > 30 && v.rows[0].xirr < 34);
  assert.equal(v.total.bench.NIFTY50.xirr !== null, true);
  assert.equal(indexTwin([{ date: "2020-01-01", amount: -10 }], bars, "2026-01-01").tooShort, true);
});

test("dividends received use shares held the day before the ex-date; forward calendar repeats last year", () => {
  const trades = [{ symbol: "AAA", date: "2026-01-10", side: "buy", qty: 10, price: 100 }, { symbol: "AAA", date: "2026-05-10", side: "buy", qty: 10, price: 100 }];
  const divs = [{ symbol: "AAA", exDate: "2026-03-01", amount: 5 }, { symbol: "AAA", exDate: "2026-08-01", amount: 6 }, { symbol: "BBB", exDate: "2026-07-01", amount: 2 }];
  const r = dividendsReceived({ trades, holdings: [{ symbol: "BBB", qty: 50 }], dividends: divs, from: "2026-01-01", to: "2026-10-01" });
  assert.deepEqual(r.map(x => [x.symbol, x.qty, x.income, x.approx]), [["AAA", 20, 120, false], ["BBB", 50, 100, true], ["AAA", 10, 50, false]]);
  const f = forwardDividends({ holdings: [{ symbol: "AAA", qty: 20, price: 200 }], dividends: [...divs, { symbol: "AAA", exDate: "2026-11-05", amount: 7 }], today: "2026-10-17" });
  assert.equal(f.total, 20 * (5 + 6 + 7)); // Mar and Aug repeat from the last 12 months, Nov is announced
  assert.ok(f.months.some(m => m.month === "2026-11" && m.sure > 0));
});

test("scanner track record: T1 before stop, stop first, expiry", () => {
  let { log } = logIdeas({}, [{ symbol: "AAA", setup: "breakout", entry: 100, stop: 95, t1: 110, score: 70 }, { symbol: "BBB", setup: "pullback", entry: 50, stop: 47, t1: 55, score: 60 }], "2026-09-01");
  ({ log } = logIdeas(log, [{ symbol: "AAA", setup: "breakout", entry: 101, stop: 95, t1: 110, score: 70 }], "2026-09-02"));
  assert.equal(Object.keys(log).length, 2, "same idea next day is not logged twice");
  const up = Array.from({ length: 5 }, (_, i) => ({ t: T(`2026-09-0${i + 2}`), c: 104 + i * 2, h: 105 + i * 2, l: 103 })), down = [{ t: T("2026-09-02"), c: 46, h: 51, l: 46 }];
  const a = judgeIdea(log["AAA:breakout:2026-09-01"], up), b = judgeIdea(log["BBB:pullback:2026-09-01"], down);
  assert.equal(a.outcome, "t1"); assert.equal(a.ret, 10); assert.equal(b.outcome, "stop"); assert.equal(b.ret, -6);
  const flat = Array.from({ length: 25 }, (_, i) => ({ t: T("2026-09-01") + (i + 1) * 86400, c: 101, h: 102, l: 99 }));
  assert.equal(judgeIdea(log["AAA:breakout:2026-09-01"], flat).outcome, "expired");
  log["AAA:breakout:2026-09-01"] = { ...log["AAA:breakout:2026-09-01"], ...a }; log["BBB:pullback:2026-09-01"] = { ...log["BBB:pullback:2026-09-01"], ...b };
  const s = ideaStats(log); assert.equal(s.all.hitRate, 50); assert.equal(s.all.avgReturn, 2);
});

test("price alerts: levels, daily move, 52-week high, golden cross; once vs daily", () => {
  const r = sanitizeRule({ symbol: "infy", type: "above", value: "1,150" });
  assert.deepEqual([r.symbol, r.value, r.repeat, r.active], ["INFY", 1150, "once", true]);
  assert.throws(() => sanitizeRule({ symbol: "INFY", type: "above" }));
  assert.equal(checkLiveRule(r, { price: 1149 }, "2026-10-17"), null);
  const hit = checkLiveRule(r, { price: 1151 }, "2026-10-17"); assert.match(hit.event.title, /price rises to or above ₹1,150/); assert.equal(hit.rule.active, false);
  const mv = sanitizeRule({ symbol: "INFY", type: "move", value: 4, repeat: "daily" });
  const m = checkLiveRule(mv, { price: 1110, prevClose: 1023 }, "2026-10-17"); assert.ok(m && m.rule.active);
  assert.equal(checkLiveRule(m.rule, { price: 1110, prevClose: 1023 }, "2026-10-17"), null, "once a day");
  assert.ok(checkLiveRule(sanitizeRule({ symbol: "X", type: "high52" }), { price: 120, high: 118 }, "d"));
  // golden cross on the close: falling for 200 days then a strong rise
  const c = [...Array.from({ length: 220 }, (_, i) => 200 - i * 0.3), ...Array.from({ length: 60 }, (_, i) => 134 + i * 3)];
  const bars = c.map((v, i) => ({ t: i * 86400, c: v, h: v, l: v, v: 1000 }));
  const g = sanitizeRule({ symbol: "X", type: "golden" }); let fired = null;
  for (let n = 230; n <= bars.length && !fired; n++) fired = checkEodRule(g, bars.slice(0, n), `d${n}`);
  assert.ok(fired, "golden cross detected"); assert.match(fired.event.detail, /crossed above the 200-DMA/);
  const vol = checkEodRule(sanitizeRule({ symbol: "X", type: "volume", value: 3 }), [...bars.slice(0, 40), { t: 1e9, c: 100, h: 100, l: 100, v: 5000 }], "d"); assert.ok(vol);
});

test("digests read like short phone messages", () => {
  const swing = { totals: { pnl: 39657, deployNow: 758000, cashShort: 458000, pat: { net: 30682 } }, positions: [{ symbol: "INFY", status: "take-profit", sellNow: 99, qty: 300, price: 1161, prevClose: 1150, dayPct: 0.96, events: { headline: "Wait for the dividend: sell on or after 27 Oct", tone: "good" } }, { symbol: "M&M", status: "near-stop", qty: 64, price: 2900, prevClose: 2950, dayPct: -1.7 }], watch: [{ symbol: "PB", status: "deploy" }] };
  const m = morningDigest({ day: "2026-10-22", swing, events: [{ symbol: "INFY", kind: "dividend", label: "Interim dividend", amount: 23, days: 5, date: "2026-10-27", income: 6900 }], rules: 2 });
  assert.match(m, /Book profit: INFY \(sell 99\)/); assert.match(m, /M&amp;M/); assert.match(m, /Wait for the dividend/); assert.match(m, /₹6,900 for you/); assert.match(m, /2 price alerts armed/);
  const e = eveningDigest({ day: "2026-10-22", swing, holdings: { value: 500000, dayChange: -2500, dayPct: -0.5, movers: [{ symbol: "TCS", dayPct: -2 }] }, booked: [{ symbol: "HERO", pnl: 7630 }], ideas: [{ symbol: "ABC", label: "Breakout", entry: 100, stop: 95, t1: 110, score: 72 }] });
  assert.match(e, /today \+₹100/); assert.match(e, /Booked today/); assert.match(e, /Top swing ideas/);
});

test("accumulation basket: progress, add level, this month's buys", () => {
  const b = sanitizeBasket({ name: "Small caps", symbols: "AAA, BBB ccc", initial: "20000", target: "1,00,000", dips: "10 20 30 40", monthly: 50000 });
  assert.deepEqual(b.symbols, ["AAA", "BBB", "CCC"]); assert.equal(b.target, 100000);
  const held = new Map([["AAA", { qty: 200, avgPrice: 100 }], ["BBB", { qty: 400, avgPrice: 100 }]]); // AAA ₹20k (no adds yet), BBB ₹40k (one add done)
  const quotes = new Map([["AAA", { price: 88 }], ["BBB", { price: 95 }], ["CCC", { price: 50, inZone: true }]]);
  const v = basketView(b, held, quotes);
  const r = Object.fromEntries(v.rows.map(x => [x.symbol, x]));
  assert.equal(r.AAA.state, "add"); assert.equal(r.AAA.nextLevel, 90); assert.equal(r.AAA.progress, 20);
  assert.equal(r.BBB.addsDone, 1); assert.equal(r.BBB.nextLevel, 80); assert.equal(r.BBB.state, "wait");
  assert.equal(r.CCC.state, "start");
  assert.deepEqual(v.plan.buys.map(x => x.symbol), ["AAA", "CCC"]); assert.equal(v.plan.buys[0].amount, Math.floor(20000 / 88) * 88);
});

test("backups verify after writing; S3 requests are signed", () => {
  const b = { app: "equity-watchlist", kind: "account-backup", account: "n", createdAt: "x", files: { "a.json": {}, "b.json": [1] } };
  assert.equal(verifyBackup(gz(b), 2).files, 2);
  assert.throws(() => verifyBackup(gz(b), 3));
  const s = signS3({ method: "PUT", host: "bk.s3.ap-south-1.amazonaws.com", key: "ew/2026-10-17/n.json.gz", region: "ap-south-1", body: Buffer.from("x"), creds: { id: "AKIDEXAMPLE", secret: "s" }, now: new Date("2026-10-17T00:00:00Z") });
  assert.match(s.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261017\/ap-south-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
  assert.equal(s.url, "https://bk.s3.ap-south-1.amazonaws.com/ew/2026-10-17/n.json.gz");
});

test("journal: setup kept on the position and the trade; stats by setup and by mistake", () => {
  const p = sanitizePosition({ symbol: "ABC", qty: 10, avgPrice: 100, setup: "breakout", reason: "55-day high on volume" });
  assert.deepEqual([p.setup, p.reason], ["breakout", "55-day high on volume"]);
  assert.equal(sanitizePosition({ symbol: "ABC", qty: 10, avgPrice: 100, setup: "nonsense" }).setup, null);
  const { trade } = applySell(p, 10, 106, "2026-10-01T04:00:00Z"); assert.equal(trade.setup, "breakout");
  assert.deepEqual(sanitizeReview({ mistakes: ["sold-early", "bogus"], note: "x" }).mistakes, ["sold-early"]);
  const j = journalStats([{ ...trade, pnl: 60, pnlPct: 6, atTarget: false, t1Price: 110 }, { setup: "pullback", pnl: -40, pnlPct: -4, qty: 5, review: { mistakes: ["no-stop"] } }]);
  assert.deepEqual(j.bySetup.map(s => [s.key, s.pnl]), [["breakout", 60], ["pullback", -40]]);
  assert.equal(j.byMistake[0].key, "no-stop"); assert.equal(j.earlyExits.missedToT1, 40);
});
