import test from "node:test";
import assert from "node:assert/strict";
import { parseTaxReport, detectTaxReport, reportTotals, dedupeReports, panKey, dayOf } from "../taxreport.mjs";
import { pnlView, taxAll } from "../pnl.mjs";

// Small copies of the two layouts (as readSheetFile returns them: string cells, Zerodha's leading empty column)
const Z = [
  { name: "Tradewise Exits from 2026-04-01", rows: [
    ["", "Client ID", "AB1234"], ["", "Client Name", "TEST PERSON"], ["", "PAN", "ABCDE1234F"], [], ["", "Tradewise Exits from 2026-04-01 to 2026-11-07"], [],
    ["", "Equity - Intraday"], [], ["", "Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Period of Holding", "Fair Market Value", "Taxable Profit", "Turnover", "Brokerage", "Exchange Transaction Charges", "IPFT", "SEBI Charges", "CGST", "SGST", "IGST", "Stamp Duty", "STT"],
    ["", "INFY", "INE009A01021", "2026-07-16", "2026-07-16", "10", "15000", "15100", "100", "0", "0", "100", "100", "3", "1", "0", "0", "0", "0", "1", "0.5", "4"],
    ["", "Equity - Short Term"], [], ["", "Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Period of Holding", "Fair Market Value", "Taxable Profit", "Turnover", "Brokerage", "Exchange Transaction Charges", "IPFT", "SEBI Charges", "CGST", "SGST", "IGST", "Stamp Duty", "STT"],
    ["", "TCS", "INE467B01029", "2025-07-02", "2026-04-07", "4", "13922", "10159.4", "-3762.6", "279", "0", "-3762.6", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
    ["", "HDFCBANK", "INE040A01034", "2026-01-02", "2026-09-07", "100", "150000", "180000", "30000", "248", "0", "30000", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"],
    ["", "Equity - Long Term"], [], ["", "Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Period of Holding", "Fair Market Value", "Taxable Profit"],
    ["", "ITC", "INE154A01025", "2017-05-01", "2026-06-01", "100", "28000", "45000", "17000", "3318", "26000", "19000"],
    ["", "Debt Etf"], [], ["", "Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Period of Holding", "Fair Market Value", "Taxable Profit"],
    ["", "LIQUIDCASE", "INF0R8F01034", "2026-06-01", "2026-07-07", "435", "49737.9", "49968.45", "230.55", "36", "0", "230.55"],
    ["", "Mutual Funds"], [], ["", "Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit", "Period of Holding", "Fair Market Value", "Taxable Profit", "Turnover"],
    ["", "NAVI NIFTY 50 INDEX FUND - DIRECT PLAN", "INF959L01FP2", "2023-06-27", "2026-04-15", "82.448", "999.95", "1309.86", "309.91", "1023", "0", "309.91", "0"],
    ["", "F&O"], [], ["", "Symbol", "ISIN", "Entry Date", "Exit Date", "Quantity", "Buy Value", "Sell Value", "Profit"], ["", "NIFTY26NOVFUT", "", "2026-11-01", "2026-11-02", "75", "1", "2", "75"]] },
  { name: "Dividends & Interest", rows: [["", "Client ID", "AB1234"], ["", "PAN", "ABCDE1234F"], ["", "Total Dividend Amount", "5259"], ["", "Total Interest Amount", "63.14"]] },
  { name: "F&O", rows: [["", "Options Realized Profit", "1200.0000"], ["", "Futures Realized Profit", "-200.0000"]] }];
const I = [
  { name: "LTCG", rows: [["Client Name:", "TEST PERSON"], ["Client PAN:", "ABCDE1234F"], ["Tax Year:", "2026-27"], ["Asset Class", "Account Coverage Scope"], ["Mutual Funds", "All Brokers", "03/11/2026"], ["Indian Stocks", "INDmoney Only"],
    ["LTCG - Equity"], ["Indian Stocks"], ["Name of Stock", "ISIN", "Redemption date", "Purchase date", "Holding Period", "Units sold", "Per unit", "", "Total", "", "Fair Market Value (as on January 31, 2018)", "Cost of Acquisition *", "Gross Gains/Losses", "Expense", "Disallowed Losses (u/s 94(8))", "Taxable Gains/Losses"],
    ["", "", "", "", "", "", "Redemption Value", "Purchase Value", "Redemption Value", "Purchase Value"], ["Losses"],
    ["TATA CONSULTANCY SERVICES LTD", "INE467B01029", "2026-07-20", "2025-07-15", "> 12 Months", "1", "2264", "3234.8", "2264", "3234.8", "0", "3234.8", "-970.8", "5.95", "0", "-976.75"],
    ["Total", "", "", "", "", "", "", "", "2264", "3234.8", "", "3234.8", "-970.8", "5.95", "0", "-976.75"],
    ["Equity Mutual Funds"], ["Name of Mutual Fund", "ISIN", "Folio No.", "Redemption date", "Purchase date", "Holding Period", "Units sold", "Per unit", "", "Total", "", "Fair Market Value (as on January 31, 2018)", "Cost of Acquisition *", "Taxable Gains/Losses"],
    ["NAVI NIFTY 50 INDEX FUND DIRECT GROWTH", "INF959L01FP2", "9104257501", "2026-04-15", "2023-06-27", "> 12 Months", "82.448", "15.887", "12.128", "1309.86", "999.95", "0", "999.95", "309.91"],
    ["LTCG - Non - Equity"], ["US Stocks"], ["Name of Stock", "Sell date", "Purchase date", "Qty sold", "Per unit (in US$)", "", "Total (in US$)", "", "Expense (in US$)", "", "Exchange Rate", "", "Total (in INR)", "", "Expense (in INR)", "", "Taxable Gains/Losses", "Broker name"],
    ["UIPATH, INC.", "2026-08-03", "2022-09-14", "1", "13.1", "14.32", "13.11", "14.33", "0.04", "0", "95", "79.1", "1245.55", "1133.5", "3.8", "0", "108.25", "Alpaca"],
    ["Notes:"], ["1. LTCG on Indian listed equity…"]] },
  { name: "STCG", rows: [["", "Client PAN:", "ABCDE1234F"], ["", "Tax Year:", "2026-27"], ["", "STCG - Equity"], ["", "Indian Stocks"],
    ["", "Name of Stock", "ISIN", "Redemption date", "Purchase date", "Holding Period", "Units sold", "Per unit", "", "Total", "", "Gross Gains/Losses", "Expense", "Disallowed Losses (u/s 94(8))", "Taxable Gains/Losses"],
    ["", "TATA CONSULTANCY SERVICES LTD", "INE467B01029", "2026-07-20", "2025-09-29", "<= 12 Months", "11", "2264", "2917.2", "24904", "32089.2", "-7185.2", "31.19", "0", "-7216.39"]] },
  { name: "Dividend", rows: [["Particulars", "Amount (₹)"], ["Indian Stocks", "1386"], ["Total", "3129.3", ""]] },
  { name: "Intraday", rows: [["Taxable Gains/Losses (a - b)", "0"]] }];

test("Zerodha tax P&L: sections become tax buckets; grandfathered taxable profit used; F&O kept as income; PAN only as a key", () => {
  assert.equal(detectTaxReport(Z), "zerodha");
  const r = parseTaxReport(Z);
  assert.deepEqual([r.broker, r.clientId, r.holderName, r.fy, r.from, r.to], ["Zerodha", "AB1234", "Test", "FY 2026-27", "2026-04-01", "2026-11-07"]);
  assert.equal(r.panKey, panKey("abcde1234f")); assert.ok(!JSON.stringify(r).includes("ABCDE1234F") && !JSON.stringify(r).includes("TEST PERSON"));
  const t = reportTotals(r);
  assert.deepEqual([t.intraday, t.eqSt, t.eqLt, t.neSt, t.sales], [100, 26237.4, 19000 + 309.91, 230.55, 6]);
  assert.equal(r.rows.find(x => x.symbol === "INFY").charges, 9.5);
  assert.deepEqual(r.other, { dividends: 5259, interest: 63.14, fno: 1000 });
  assert.equal(r.skipped.fno, 1);
});

test("INDmoney tax report: equity, funds and US stocks; MF coverage is all brokers; folio numbers dropped", () => {
  assert.equal(detectTaxReport(I), "indmoney");
  const r = parseTaxReport(I);
  assert.deepEqual([r.broker, r.fy, r.coverage.mf], ["INDmoney", "FY 2026-27", "all"]);
  const t = reportTotals(r);
  assert.deepEqual([t.eqLt, t.eqSt, t.neLt], [-666.84, -7216.39, 108.25]);
  const us = r.rows.find(x => x.kind === "us"); assert.deepEqual([us.sellValue, us.buyValue, us.charges], [1245.55, 1133.5, 3.8]);
  assert.ok(!JSON.stringify(r).includes("9104257501"));
  assert.equal(r.other.dividends, 3129.3);
});

test("a fund sold in both reports counts once (INDmoney covers every broker)", () => {
  const z = parseTaxReport(Z), i = parseTaxReport(I), d = dedupeReports([z, i]);
  assert.equal(d.dropped, 1);
  assert.ok(!d.keep[0].some(x => x.kind === "mf") && d.keep[1].some(x => x.kind === "mf"));
});

test("set-off: short-term loss eats short-term gains (slab first) then long-term; long-term loss only long-term", () => {
  let x = taxAll({ eqSt: -10000, neSt: 4000, eqLt: 200000 }, 0.3);
  assert.deepEqual(x.after, { eqSt: 0, neSt: 0, eqLt: 194000, neLt: 0 }); assert.equal(x.capitalGainsTax, Math.round((194000 - 125000) * 0.125));
  x = taxAll({ eqSt: 50000, eqLt: -30000, neLt: 10000 }, 0.3);
  assert.deepEqual(x.after, { eqSt: 50000, neSt: 0, eqLt: -20000, neLt: 0 }); assert.equal(x.carryForward, 20000); assert.equal(x.capitalGainsTax, 10000);
  x = taxAll({ intraday: 1000, fno: -5000, dividends: 2000 }, 0.2);
  assert.deepEqual([x.slabIncome, x.slabTax, x.fnoLoss], [3000, 600, 5000]);
});

test("combined view: report replaces computed sales up to its last day; later trades still count", () => {
  const rep = { ...parseTaxReport(Z), id: "r1", account: "AB1234" };
  const trades = [{ account: "AB1234", key: "INE467B01029", symbol: "TCS", isin: "INE467B01029", date: "2026-05-01", side: "buy", qty: 10, price: 3000 },
    { account: "AB1234", key: "INE467B01029", symbol: "TCS", isin: "INE467B01029", date: "2026-06-01", side: "sell", qty: 5, price: 3100 }, // inside the report period: ignored
    { account: "AB1234", key: "INE467B01029", symbol: "TCS", isin: "INE467B01029", date: "2026-11-09", side: "sell", qty: 5, price: 3200 }]; // after: counted
  const v = pnlView({ trades, accounts: [{ id: "AB1234", label: "Zerodha", broker: "Zerodha" }], reports: [rep], today: "2026-11-10" });
  const row = v.rows[0];
  assert.equal(row.report.broker, "Zerodha");
  assert.equal(row.netSt, Math.round(26237.4 + 1000));
  assert.equal(row.neSt, 231);
  assert.equal(v.holders[0].other.fno, 1000);
  assert.equal(v.trades.filter(t => t.src === "trades").length, 1);
  assert.equal(dayOf("16/07/2026"), "2026-07-16"); assert.equal(dayOf("46219"), "2026-07-16");
});
