import test from "node:test";
import assert from "node:assert/strict";
import { parseTaxReport, detectTaxReport, reportTotals } from "../taxreport.mjs";
import { pnlView } from "../pnl.mjs";

// Dhan → Reports → Realised P&L (.xls), as readSheetFile returns it
const D = [{ name: "Realised P&L Report", rows: [
  ["", "", "Realised Profit and Loss Report", "", "", "", "", "", "", "", "", "", "Name", "TEST PERSON"], ["", "", "", "", "", "", "", "", "", "", "", "", "UCC", "ABCD12345E", "", "9999999999"], ["", "", "", "", "", "", "", "", "", "", "", "", "Email ID", "a@b.c"],
  ["Segment", "", "", "", "Buy Value", "Sell Value", "Gross P&L", "Brokerage", "Exch. Charges", "SEBI Fees", "GST", "STT", "Stamp Duty", "Other Charges", "Total Charges", "Net P&L"],
  ["Equity", "", "", "", "300000", "330000", "30000", "0", "50", "1", "9", "600", "40", "0", "700", "29300"], ["Futures and Options", "", "", "", "0", "0", "0"],
  ["Equity Segment"], ["Sr.", "Security Name", "", "", "ISIN", "Qty.", "Avg. Buy Price", "Buy Value", "Avg. Sell Price", "Sell Value", "Realised P&L", "Realised P&L%"],
  ["1", "Infosys", "", "", "INE009A01021", "100", "1000", "100000", "1100", "110000", "10000", "10"],
  ["2", "Varun Beverages", "", "", "INE200M01039", "400", "500", "200000", "550", "220000", "20000", "10"],
  ["F&O Segment"], ["Sr.", "Security Name", "", "", "ISIN", "Qty."], ["", "", "", "Generated on 07-11-2026"]] }];

test("Dhan realised P&L: per-stock lines, charges shared by turnover, no personal details kept", () => {
  assert.equal(detectTaxReport(D), "dhan");
  const r = parseTaxReport(D);
  assert.deepEqual([r.broker, r.fy, r.to, r.rows.length], ["Dhan", "FY 2026-27", "2026-11-07", 2]);
  assert.equal(reportTotals(r).eqSt, 30000);
  assert.equal(Math.round(r.rows[0].charges + r.rows[1].charges), 700);
  assert.ok(!/TEST PERSON|ABCD12345E|9999999999|a@b\.c/.test(JSON.stringify(r)));
});

test("Dhan report terms: from your Dhan trades when on file, from what you marked, else short term", () => {
  const rep = { ...parseTaxReport(D), id: "d1", account: "dhan:1100" };
  // INFY: trades show 60 bought over a year ago and 40 recently → 60% long term
  const T = (date, side, qty, price) => ({ account: "dhan:1100", key: "INE009A01021", symbol: "INFY", isin: "INE009A01021", date, side, qty, price });
  const trades = [T("2025-01-10", "buy", 60, 900), T("2026-05-01", "buy", 40, 1050), T("2026-09-01", "sell", 100, 1100)];
  let v = pnlView({ trades, accounts: [{ id: "dhan:1100", label: "Dhan", broker: "Dhan" }], reports: [rep], today: "2026-11-07" });
  const row = v.rows.find(r => r.id === "dhan:1100");
  assert.equal(row.netLt, 6000); assert.equal(row.netSt, 4000 + 20000);
  assert.ok(v.notes.some(n => /1 stock .*counted as short term/.test(n)));
  assert.equal(v.trades.filter(t => t.termFrom === "trades").length, 2);
  v = pnlView({ trades: [], accounts: [], reports: [{ ...rep, longIsins: ["INE200M01039"] }], today: "2026-11-07" });
  assert.equal(v.rows[0].netLt, 20000); assert.equal(v.months.length, 0); // period totals don't go into a month
});

// Dhan → Reports → P&L Report (.xls): date range, buy / sell / open quantities, open positions at the closing rate
const P = [{ name: "P&L Report", rows: [
  ["", "", "Profit and Loss Report", "", "", "", "", "", "", "", "", "", "", "", "Name", "TEST PERSON"], ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "UCC", "ABCD12345E"],
  ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "Profit and Loss Report from 01/04/2026 to 07/11/2026"],
  ["Segment", "", "", "", "Buy Value", "Sell Value", "Gross P&L", "Brokerage", "Exch. Charges", "SEBI Fees", "GST", "STT", "Stamp Duty", "Other Charges", "Total Charges", "Net P&L"],
  ["Equity", "", "", "", "700000", "343734.3", "35030.3", "0", "10", "1", "2", "500", "87", "0", "600", "34430.3"],
  ["Equity Segment"], ["Sr.", "Security Name", "", "", "ISIN", "Buy Qty.", "Avg. Buy Price", "Buy Value", "Sell Qty.", "Avg. Sell Price", "Sell Value", "Realised P&L", "Realised P&L %", "Open Qty.", "Open Avg. Price", "Closing Rate", "Unrealised P&L", "Unrealised P&L %"],
  ["1", "Infosys", "", "", "INE009A01021", "300", "1029.01", "308704", "300", "1145.78", "343734.3", "35030.3", "11.35", "0", "0", "0", "0", "0"],
  ["2", "Netweb Technologies", "", "", "INE0NT901020", "113", "4079.7", "461006.6", "0", "0", "0", "0", "0", "113", "4079.7044", "4023.5", "-6351.1", "-1.38"],
  ["3", "Nippon Silver ETF (SILVERBEES)", "", "", "INF204KC1402", "519", "195.64", "101536.27", "0", "0", "0", "0", "0", "519", "195.6383", "177.87", "-9221.74", "-9.08"]] }];

test("Dhan P&L report: its date range, realised per stock, open positions with unrealised from the file", () => {
  assert.equal(detectTaxReport(P), "dhan");
  const r = parseTaxReport(P);
  assert.deepEqual([r.from, r.to, r.fy, r.rows.length, r.open.length, r.datesKnown], ["2026-04-01", "2026-11-07", "FY 2026-27", 1, 2, true]);
  assert.deepEqual([r.rows[0].buyValue, r.rows[0].gain, r.rows[0].charges], [308704, 35030.3, 600]); // cost of what was sold
  assert.equal(r.open[1].kind, "etf"); assert.equal(Math.round(r.open.reduce((a, o) => a + o.unrealised, 0)), -15573);
  assert.ok(!/TEST PERSON|ABCD12345E/.test(JSON.stringify(r)));
  const v = pnlView({ trades: [], accounts: [{ id: "dhan:1", label: "Dhan", broker: "Dhan" }], unrealised: { "dhan:1": 61707 }, reports: [{ ...r, id: "p1", account: "dhan:1" }], today: "2026-11-07" });
  assert.equal(v.rows[0].unrealised, -15573); assert.equal(v.rows[0].unrealisedFrom.broker, "Dhan"); // the file's figure, not the synced holdings
});
