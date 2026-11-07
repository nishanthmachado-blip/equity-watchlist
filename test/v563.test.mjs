import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fifo, parseTradebook, taxView } from "../tax.mjs";
import { pnlView, estimateCharges } from "../pnl.mjs";
import { createBrokerClients, normalizeDhanTrades } from "../brokers.mjs";

const T = (account, date, side, qty, price, key = "INE1", extra = {}) => ({ account, key, symbol: "ABC", isin: key, date, side, qty, price, ...extra });

test("FIFO runs per demat account: a sale in Dhan uses Dhan's shares, not older Zerodha ones", () => {
  const { realised, lots } = fifo([T("kite:Z1", "2024-01-10", "buy", 10, 100), T("dhan:D1", "2025-09-01", "buy", 5, 200), T("dhan:D1", "2025-10-01", "sell", 5, 220)]);
  assert.equal(realised.length, 1);
  assert.deepEqual([realised[0].account, realised[0].buy, realised[0].gain, realised[0].long], ["dhan:D1", 200, 100, false]);
  assert.equal(lots.get("INE1").reduce((a, l) => a + l.qty, 0), 10); // Zerodha's 10 still held
});

test("same-day buy and sell in one account is intraday, the rest of the day's buys become a lot", () => {
  const { realised, lots } = fifo([T("z", "2025-07-01", "buy", 10, 100), T("z", "2025-07-01", "sell", 6, 103), T("z", "2025-08-01", "sell", 4, 110)]);
  assert.deepEqual(realised.map(r => [r.intraday || false, r.qty, Math.round(r.gain)]), [[true, 6, 18], [false, 4, 40]]);
  assert.equal(lots.get("INE1").length, 0);
  const v = taxView({ trades: [T("z", "2025-07-01", "buy", 10, 100), T("z", "2025-07-01", "sell", 6, 103), T("z", "2025-08-01", "sell", 4, 110)], holdings: [], today: "2025-12-01" });
  assert.deepEqual([v.realised.intraday, v.realised.stGain], [18, 40]); // intraday is not short-term capital gain
});

test("tradebook parser reads other brokers' column names and the product column", () => {
  const p = parseTradebook([["Date", "Trading Symbol", "ISIN", "Transaction Type", "Exchange Segment", "Product Type", "Traded Qty", "Traded Price"],
    ["2025-09-02", "TATAMOTORS-EQ", "INE155A01022", "BUY", "NSE_EQ", "INTRADAY", "5", "700.5"], ["2025-09-02", "NIFTY25SEP", "", "SELL", "NSE_FNO", "MARGIN", "75", "10"]]);
  assert.equal(p.trades.length, 1); assert.equal(p.skipped.fno, 1);
  assert.deepEqual([p.trades[0].symbol, p.trades[0].key, p.trades[0].qty, p.trades[0].price, p.trades[0].product], ["TATAMOTORS", "INE155A01022", 5, 700.5, "MIS"]);
});

test("Dhan trade history: equity rows only, charges added up, F&O skipped", () => {
  const t = normalizeDhanTrades([
    { orderId: "1", exchangeTradeId: "a", transactionType: "BUY", exchangeSegment: "NSE_EQ", productType: "CNC", tradingSymbol: null, customSymbol: "HDFCBANK", isin: "INE040A01034", instrument: "EQUITY", tradedQuantity: 2, tradedPrice: 1600, stt: 3.2, stampDuty: 0.5, exchangeTransactionCharges: 0.1, sebiTax: 0, serviceTax: 0.02, brokerageCharges: 0, exchangeTime: "2025-10-03 10:15:00" },
    { orderId: "2", exchangeTradeId: "b", transactionType: "SELL", exchangeSegment: "NSE_FNO", instrument: "DERIVATIVES", tradedQuantity: 75, tradedPrice: 10, exchangeTime: "2025-10-03 11:00:00" }]);
  assert.equal(t.length, 1);
  assert.deepEqual([t[0].side, t[0].date, t[0].key, t[0].symbol, t[0].charges, t[0].src], ["buy", "2025-10-03", "INE040A01034", "HDFCBANK", 3.82, "dhan-api"]);
});

test("Dhan trades: read through the allow-listed GET /v2/trades, page by page", async () => {
  const seen = [];
  const f = async (url, opts = {}) => {
    const u = new URL(url); seen.push(`${opts.method} ${u.pathname}`);
    const res = b => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/v2/profile") return res({ dhanClientId: "1100" });
    const page = Number(u.pathname.split("/").pop());
    const row = i => ({ orderId: `o${page}-${i}`, exchangeTradeId: `${page}-${i}`, transactionType: "BUY", exchangeSegment: "NSE_EQ", instrument: "EQUITY", customSymbol: "TCS", isin: "INE467B01029", tradedQuantity: 1, tradedPrice: 3000, exchangeTime: "2025-05-02 10:00:00" });
    return res(page === 0 ? Array.from({ length: 20 }, (_, i) => row(i)) : page === 1 ? [row(0)] : []);
  };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "v563-"));
  const c = createBrokerClients({ env: {}, fetchImpl: f, sessionFile: path.join(dir, "s.json"), credentialsFile: path.join(dir, "c.json"), roots: { dhan: "https://dhan.test" } });
  await c.dhan.login({ mode: "token", accessToken: "t".repeat(30) });
  const got = await c.dhan.trades("2025-04-01", "2025-06-29");
  assert.equal(got.length, 21);
  assert.deepEqual(seen.filter(s => s.includes("trades")), ["GET /v2/trades/2025-04-01/2025-06-29/0", "GET /v2/trades/2025-04-01/2025-06-29/1"]);
});

test("combined P&L: accounts of one holder share the exemption; another holder gets their own", () => {
  const trades = [
    T("kite:Z1", "2023-05-01", "buy", 100, 1000), T("kite:Z1", "2025-06-01", "sell", 100, 2000), // +1,00,000 LTCG
    T("dhan:D1", "2023-05-01", "buy", 100, 1000, "INE2"), T("dhan:D1", "2025-07-01", "sell", 100, 1800, "INE2"), // +80,000 LTCG
    T("dhan:D1", "2025-08-01", "buy", 10, 500, "INE3"), T("dhan:D1", "2025-09-01", "sell", 10, 400, "INE3", { charges: 12 }), // −1,000 STCG
    T("kite:WIFE", "2023-05-01", "buy", 10, 1000, "INE4"), T("kite:WIFE", "2025-06-01", "sell", 10, 2000, "INE4") // +10,000 LTCG
  ];
  const accounts = [{ id: "kite:Z1", label: "Zerodha main", broker: "Zerodha" }, { id: "dhan:D1", label: "Dhan", broker: "Dhan" }, { id: "kite:WIFE", label: "Zerodha (wife)", broker: "Zerodha" }, { id: "angel:A1", label: "Angel", broker: "Angel One" }];
  const v = pnlView({ trades, accounts, holders: { "kite:WIFE": "Wife" }, unrealised: { "angel:A1": 500 }, today: "2025-11-07" });
  assert.equal(v.fy.label, "FY 2025-26");
  assert.equal(v.total.gross, 100000 + 80000 - 1000 + 10000);
  const me = v.holders.find(h => h.name === "Me"), wife = v.holders.find(h => h.name === "Wife");
  assert.deepEqual([me.netLt, me.netSt, me.tax.netSt, me.tax.netLt, me.tax.exemptUsed], [180000, -1000, 0, 179000, 125000]); // the STCG loss offsets LTCG
  assert.equal(me.tax.tax, Math.round((179000 - 125000) * 0.125));
  assert.deepEqual([wife.netLt, wife.tax.tax], [10000, 0]);
  assert.ok(v.warnings.some(w => w.id === "angel:A1" && /nothing on file yet/.test(w.text)));
  const dhanRow = v.rows.find(r => r.id === "dhan:D1");
  assert.ok(dhanRow.charges > 12 && dhanRow.chargesEst > 0); // the sell came with charges, its buy didn't
  assert.equal(v.trades.length, 4);
  assert.ok(estimateCharges({ qty: 100, buy: 1000, sell: 2000 }) > 300);
});
