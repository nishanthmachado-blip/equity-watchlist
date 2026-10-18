import test from "node:test";
import assert from "node:assert/strict";
import { parseDipText, sanitizeWatch, evaluateSwing, diffSwingAlerts, DIP_ALIASES } from "../swing.mjs";
import { parseUsHoldings, usHoldingsView, parseAmfiNav, searchAmfi, parseCas, parseMfRows, valueFund, isoDay } from "../holdings-extra.mjs";

test("dip list: one line of levels with short names and optional amounts", () => {
  const r = parseDipText("TCS below 2100, infy below 1000, hcl below 1200, VBL below 400 hdfc below 680 etc");
  assert.deepEqual(r.map(x => [x.name, x.buyBelow]), [["TCS", 2100], ["infy", 1000], ["hcl", 1200], ["VBL", 400], ["hdfc", 680]]);
  const r2 = parseDipText("Bajaj Finance under ₹6,500 for 2L\nHDFC Bank 680\nM&M < 2.9k 1.5L\nsay TCS @ 2100 and INFY: 1000");
  assert.deepEqual(r2.map(x => [x.name, x.buyBelow, x.amount]), [["Bajaj Finance", 6500, 200000], ["HDFC Bank", 680, null], ["M&M", 2900, 150000], ["TCS", 2100, null], ["INFY", 1000, null]]);
  assert.equal(DIP_ALIASES.HDFC, "HDFCBANK"); assert.equal(DIP_ALIASES.HCL, "HCLTECH");
});

test("dip list: entries need a level, reach 'deploy' at or below it and alert as a dip", () => {
  assert.throws(() => sanitizeWatch({ symbol: "TCS", list: "dip" }), /price to buy below/);
  const w = sanitizeWatch({ symbol: "HCLTECH", name: "HCL Technologies", list: "dip", buyBelow: "1200", amount: "1L" });
  assert.equal(w.list, "dip");
  assert.equal(sanitizeWatch({ notes: "x", symbol: "HCLTECH", buyBelow: "1150" }, w).list, "dip"); // editing keeps it on the dip list
  const v = evaluateSwing({ watch: [w], prices: new Map([["HCLTECH", { price: 1190 }]]) });
  assert.equal(v.watch[0].status, "deploy");
  const { fresh } = diffSwingAlerts({}, v, { now: Date.parse("2026-10-17T05:00:00Z") });
  assert.match(fresh[0].title, /dipped to ₹1190: at your buy-the-dip level ₹1200/);
});

test("US holdings: Vested-style CSV columns and pasted lines", () => {
  const rows = parseUsHoldings([{ rows: [["Holdings as of 15 Oct"], ["Symbol", "Name", "Quantity", "Average Price ($)", "Current Value ($)"], ["AAPL", "Apple Inc", "10", "150.25", "2305"], ["MSFT", "Microsoft", "3.5", "$300.00", "1435"], ["Total", "", "", "", "3740"]] }]);
  assert.deepEqual(rows.map(r => [r.symbol, r.qty, r.avgUsd, r.investedUsd]), [["AAPL", 10, 150.25, 1502.5], ["MSFT", 3.5, 300, 1050]]);
  const byCost = parseUsHoldings([{ rows: [["Ticker", "Shares", "Total Cost"], ["BRK.B", "2", "800"]] }]);
  assert.deepEqual([byCost[0].symbol, byCost[0].avgUsd], ["BRK-B", 400]);
  const txt = parseUsHoldings([], "AAPL 10 150.25\nVOO, 2, 400\nnvda 1.5 @ 95.4");
  assert.deepEqual(txt.map(r => [r.symbol, r.qty, r.avgUsd]), [["AAPL", 10, 150.25], ["VOO", 2, 400], ["NVDA", 1.5, 95.4]]);
});

test("US holdings: values in $ and ₹, rupee cost given or at today's rate, synced value as fallback", () => {
  const v = usHoldingsView([
    { key: "a", symbol: "AAPL", qty: 10, avgUsd: 150, investedUsd: 1500 },
    { key: "b", symbol: "NVDA", qty: 5, investedInr: 70000, valueInr: 75000 },
    { key: "c", symbol: "XYZ", qty: 1, valueInr: 5000, investedInr: 4000 }
  ], { AAPL: { price: 200, prevClose: 190 }, NVDA: { price: 180 } }, 88);
  const a = v.rows.find(r => r.symbol === "AAPL"), n = v.rows.find(r => r.symbol === "NVDA"), x = v.rows.find(r => r.symbol === "XYZ");
  assert.deepEqual([a.valueUsd, a.valueInr, a.investedInr, a.pnlUsd, a.pnlInr, a.investedInrAtToday, a.dayPct], [2000, 176000, 132000, 500, 44000, true, 5.26]);
  assert.deepEqual([n.valueInr, n.pnlInr, n.investedInrAtToday], [79200, 9200, false]);
  assert.deepEqual([x.valueInr, x.stale, x.price], [5000, true, null]);
  assert.equal(v.totals.valueInr, 176000 + 79200 + 5000);
  assert.deepEqual(v.totals.unpriced, ["XYZ"]);
});

const NAV = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - ELSS)

Axis Mutual Fund

120503;INF846K01EW2;-;Axis ELSS Tax Saver Fund - Direct Plan - Growth Option;101.2345;16-Oct-2026
120504;INF846K01EX0;INF846K01EY8;Axis ELSS Tax Saver Fund - Regular Plan - IDCW;30.1000;16-Oct-2026
120505;INF846K01DP8;-;Axis Midcap Fund - Direct Plan - Growth;124.5000;16-Oct-2026
120506;INF846K01ZZ1;-;Axis Closed Fund;N.A.;16-Oct-2026`;

test("AMFI NAV file: by ISIN (both ISINs of a scheme), search prefers direct growth", () => {
  const m = parseAmfiNav(NAV);
  assert.deepEqual(m.INF846K01EW2.slice(0, 3), [101.2345, "2026-10-16", 120503]);
  assert.equal(m.INF846K01EY8[0], 30.1); assert.equal(m.INF846K01ZZ1, undefined);
  assert.equal(m.INF846K01EW2[4], "Axis Mutual Fund");
  const s = searchAmfi(m, "axis elss");
  assert.equal(s[0].isin, "INF846K01EW2"); assert.equal(s.length, 2);
  assert.equal(searchAmfi(m, "INF846K01DP8")[0].name, "Axis Midcap Fund - Direct Plan - Growth");
  assert.equal(isoDay("16-Oct-2026"), "2026-10-16");
});

test("CAS: detailed statement lines → one entry per scheme and folio, zero balances dropped", () => {
  const lines = ["Consolidated Account Statement", "01-Apr-2020 To 15-Oct-2026", "Axis Mutual Fund",
    "Folio No: 91012345678 / 0   PAN: ABCDE1234F   KYC: OK PAN: OK",
    "128TSGP-Axis ELSS Tax Saver Fund - Direct Growth - ISIN: INF846K01EW2(Advisor: DIRECT) Registrar : KFINTECH",
    "Opening Unit Balance: 0.000", "10-Jan-2023   Purchase - Systematic   5,000.00   71.234   70.19   71.234",
    "Closing Unit Balance: 1,234.567   NAV on 14-Oct-2026: INR 98.4512   Total Cost Value: 1,00,000.00   Market Value on 14-Oct-2026: INR 1,21,543.23",
    "Quant Mutual Fund", "Folio No: 3456789 / 12   PAN: ABCDE1234F",
    "Quant Small Cap Fund - Direct Plan Growth - ISIN: INF966L01689(Advisor: INA000000000) Registrar : CAMS",
    "Closing Unit Balance: 402.118   NAV on 14-Oct-2026: INR 265.4400 Total Cost Value: 80,000.00   Market Value on 14-Oct-2026: INR 1,06,738.20",
    "Folio No: 3456789 / 12", "Quant Liquid Fund - Growth - ISIN: INF966L01ZZ9 Registrar : CAMS",
    "Closing Unit Balance: 0.000   NAV on 14-Oct-2026: INR 40.0000   Total Cost Value: 0.00   Market Value on 14-Oct-2026: INR 0.00"];
  const r = parseCas(lines);
  assert.equal(r.statementTo, "2026-10-15");
  assert.equal(r.funds.length, 2);
  assert.deepEqual(r.funds.map(f => [f.isin, f.name, f.folio, f.units, f.nav, f.navDate, f.cost, f.value, f.amc, f.registrar]), [
    ["INF846K01EW2", "Axis ELSS Tax Saver Fund - Direct Growth", "91012345678/0", 1234.567, 98.4512, "2026-10-14", 100000, 121543.23, "Axis Mutual Fund", "KFINTECH"],
    ["INF966L01689", "Quant Small Cap Fund - Direct Plan Growth", "3456789/12", 402.118, 265.44, "2026-10-14", 80000, 106738.2, "Quant Mutual Fund", "CAMS"]]);
});

test("CAS: summary rows with numbers on the scheme line; a cut-off value is recomputed", () => {
  const r = parseCas(["Folio No: 5550001", "Axis Midcap Fund - Direct Growth - ISIN: INF846K01DP8   75,000.00   812.300   14-Oct-2026   120.1100   97,565.35   KFINTECH"]);
  assert.deepEqual([r.funds[0].units, r.funds[0].nav, r.funds[0].value, r.funds[0].cost, r.funds[0].navDate], [812.3, 120.11, 97565.35, 75000, "2026-10-14"]);
  const cut = parseCas(["Folio No: 1", "X Fund - ISIN: INF846K01DP8", "Closing Unit Balance: 100.000   NAV on 14-Oct-2026: INR 50.0000   Market Value on 14-Oct-2026: INR 5,0"]);
  assert.equal(cut.funds[0].value, 5000);
});

test("MF rows from a CSV / paste, and valuing at the newer AMFI NAV", () => {
  const rows = parseMfRows([{ rows: [["Scheme Name", "Folio No", "Units", "Invested Amount"], ["Axis Midcap Direct Growth", "123", "50.5", "5,000"]] }]);
  assert.deepEqual(rows, [{ name: "Axis Midcap Direct Growth", isin: null, units: 50.5, cost: 5000, folio: "123" }]);
  assert.deepEqual(parseMfRows([], "INF846K01DP8\t10\t1100").map(r => [r.isin, r.units, r.cost]), [["INF846K01DP8", 10, 1100]]);
  const amfi = parseAmfiNav(NAV);
  const v = valueFund({ isin: "INF846K01DP8", units: 10, nav: 120, navDate: "2026-10-14", value: 1200 }, amfi);
  assert.deepEqual([v.nav, v.value, v.navSource, v.navDate], [124.5, 1245, "AMFI", "2026-10-16"]);
  const old = valueFund({ isin: "INF846K01DP8", units: 10, nav: 130, navDate: "2026-10-20", value: 1300 }, amfi); // the statement is newer
  assert.deepEqual([old.value, old.navSource], [1300, "statement"]);
});

test("US holdings: buy dates from a statement column, any common format", async () => {
  const { anyDay, parseUsHoldings } = await import("../holdings-extra.mjs");
  assert.deepEqual(["2024-03-15", "15/03/2024", "15-Mar-2024", "Mar 15, 2024", ""].map(anyDay), ["2024-03-15", "2024-03-15", "2024-03-15", "2024-03-15", null]);
  const r = parseUsHoldings([{ rows: [["Symbol", "Quantity", "Average Price", "Purchase Date"], ["AAPL", "10", "150", "01/06/2023"]] }]);
  assert.equal(r[0].boughtOn, "2023-06-01");
});
