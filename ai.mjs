// Ask AI: Claude (your own Anthropic API key) as a second opinion on buys, swing trades and the portfolio.
// What leaves the server: a compact summary of your positions (symbols, quantities, prices, amounts or only percentages,
// signals, upcoming dividends / results) and the question. Never sent: account names or IDs, broker logins, PAN, email,
// folio numbers, other users' data. Claude can ask for more detail on one stock through tools; those run here, on your
// server, and only their result is sent. Pure helpers; the server does the storage and the calls.
import crypto from "node:crypto";

export const AI_MODELS = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (balanced: recommended)" },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (deepest reasoning, costs more)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fastest, cheapest)" }
];
export const AI_DEFAULTS = { model: AI_MODELS[0].id, privacy: "amounts", monthlyTokens: 2_000_000, maxAnswerTokens: 2500 };
export const PRIVACY = { amounts: "Symbols, quantities, prices and rupee amounts", percent: "Symbols and prices; amounts only as % of the portfolio (no quantities, no rupee values)" };

// ---- the API key at rest: AES-256-GCM with a server secret (AI_KEY_SECRET, or a random one kept in the data folder)
export function sealKey(key, secret) {
  const iv = crypto.randomBytes(12), k = crypto.createHash("sha256").update(String(secret)).digest();
  const c = crypto.createCipheriv("aes-256-gcm", k, iv), data = Buffer.concat([c.update(String(key), "utf8"), c.final()]);
  return { v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), data: data.toString("base64"), hint: `…${String(key).slice(-4)}` };
}
export function openKey(sealed, secret) {
  if (!sealed?.data) return null;
  try {
    const k = crypto.createHash("sha256").update(String(secret)).digest(), d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(sealed.iv, "base64"));
    d.setAuthTag(Buffer.from(sealed.tag, "base64")); return Buffer.concat([d.update(Buffer.from(sealed.data, "base64")), d.final()]).toString("utf8");
  } catch { return null; }
}
export const looksLikeKey = k => /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(String(k || "").trim());

// ---- what is sent: a compact, redacted snapshot
const R = v => (Number.isFinite(v) ? Math.round(v) : null), r1 = v => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null), r2 = v => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const L = v => (Number.isFinite(v) ? (Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)}Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)}L` : `₹${Math.round(v).toLocaleString("en-IN")}`) : "?");
const clean = (s, n = 140) => String(s ?? "").replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN]").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\s+/g, " ").trim().slice(0, n);

// data: { today, holdings: [...], swing: { positions, watch, totals, closedStats }, networth, us, mf, events }
export function buildContext(data, { privacy = "amounts" } = {}) {
  const pctMode = privacy === "percent", out = [];
  const total = (data.networth?.assets || 0) || (data.holdings || []).reduce((a, h) => a + (h.value || 0), 0) || 1;
  const money = v => (pctMode ? (Number.isFinite(v) ? `${r1(v / total * 100)}% of portfolio` : "?") : L(v));
  const qty = q => (pctMode ? "" : ` qty ${q}`);
  out.push(`Today: ${data.today} (India, IST). Prices in ₹ unless marked $. ${pctMode ? "Amounts are shown only as % of the total portfolio (privacy mode)." : ""}`);
  if (data.networth) {
    const n = data.networth;
    out.push(`\n## Net worth mix\n${pctMode ? "" : `Total assets ${L(n.assets)}, liabilities ${L(n.liabilities)}. `}${(n.mix || []).map(m => `${m.label} ${r1(m.pct)}%`).join(", ")}`);
  }
  if (data.favourites?.length) out.push(`\nMy favourite stocks (ones I keep an eye on): ${data.favourites.slice(0, 60).join(", ")}`);
  const H = data.holdings || [];
  if (H.length) {
    out.push(`\n## Long-term holdings (${H.length})\nsymbol | ${pctMode ? "" : "qty | avg | "}price | ${pctMode ? "weight" : "invested | value"} | P/L% | valuation view | fair value (base) | buy zone | P/E vs sector | stance`);
    for (const h of H.slice(0, 80)) out.push(`${h.symbol} | ${pctMode ? "" : `${h.qty} | ${r2(h.avgPrice)} | `}${r2(h.price)} | ${pctMode ? `${r1(h.value / total * 100)}%` : `${L(h.invested)} | ${L(h.value)}`} | ${r1(h.pnlPct)}% | ${h.view || "?"} | ${h.fair ?? "?"} | ${h.zone || "?"} | ${h.pe ?? "?"} vs ${h.sectorPe ?? "?"} | ${clean(h.stance) || "-"}`);
    if (H.length > 80) out.push(`(${H.length - 80} smaller holdings left out)`);
  }
  const S = data.swing;
  if (S) {
    if (S.positions?.length) {
      out.push(`\n## Swing positions (${S.positions.length})${pctMode ? "" : ` · swing cash ${L(S.totals?.cash)}`}\nsymbol | ${pctMode ? "" : "qty | "}avg | LTP | P/L% | ${pctMode ? "" : "P/L ₹ | net if sold now | "}targets (price, hit?) | stop | signal | trend | held since | events / decision`);
      for (const p of S.positions) out.push(`${p.symbol} | ${pctMode ? "" : `${p.qty} | `}${r2(p.avgPrice)} | ${r2(p.price)} | ${r1(p.pnlPct)}% | ${pctMode ? "" : `${L(p.pnl)} | ${p.ifSold ? L(p.ifSold.net) : "?"} | `}${(p.targets || []).map(t => `T${t.n} ${t.price}${t.hit ? "✓" : ""}`).join(" ")} | ${p.stopLoss ?? "-"} | ${p.status}${p.note ? ` (${clean(p.note)})` : ""} | ${p.health?.state || "?"}${p.health?.trail ? ` trail ${r2(p.health.trail)}` : ""} | ${p.openedAt ? String(p.openedAt).slice(0, 10) : "?"} | ${p.events?.items?.length ? p.events.items.map(e => clean(e.text, 260)).join("; ") : "-"}`);
    }
    const dips = (S.watch || []).filter(w => w.list === "dip"), wl = (S.watch || []).filter(w => w.list !== "dip");
    if (dips.length) {
      out.push(`\n## Buy-the-dip list (my levels)\nsymbol | LTP | buy below | distance | amount planned | upcoming`);
      for (const w of dips) out.push(`${w.symbol} | ${r2(w.price)} | ${w.buyBelow} | ${w.distance ?? "?"}% ${w.status === "deploy" ? "(REACHED)" : ""} | ${pctMode ? "-" : L(w.amount)} | ${(w.upcoming || []).map(e => `${e.label} ${e.date}`).join("; ") || "-"}`);
    }
    if (wl.length) {
      out.push(`\n## Swing watchlist\nsymbol | LTP | buy below | distance | signal | idea`);
      for (const w of wl.slice(0, 40)) out.push(`${w.symbol} | ${r2(w.price)} | ${w.buyBelow ?? "-"} | ${w.distance ?? "?"}% | ${w.status} | ${w.idea ? clean(w.idea.label) : "-"}`);
    }
    if (S.score) out.push(`\nSwing record: ${S.score.trades ?? "?"} closed trades, win rate ${S.score.winRate ?? "?"}%${pctMode ? "" : `, booked ${L(S.realised)}`}${S.mistakes ? `; frequent mistakes: ${S.mistakes}` : ""}.`);
  }
  if (data.us?.rows?.length) {
    out.push(`\n## US holdings ($1 = ₹${data.us.fx ?? "?"})\nsymbol | ${pctMode ? "" : "qty | avg $ | "}price $ | P/L% | ${pctMode ? "weight" : "value ₹"}`);
    for (const u of data.us.rows) out.push(`${u.symbol || clean(u.name)} | ${pctMode ? "" : `${u.qty} | ${u.avgUsd ?? "?"} | `}${u.price ?? "?"} | ${u.pnlPct ?? "?"}% | ${pctMode ? `${r1(u.valueInr / total * 100)}%` : L(u.valueInr)}`);
  }
  if (data.mf?.length) {
    out.push(`\n## Mutual funds\nfund | ${pctMode ? "weight" : "invested | value"} | P/L%`);
    for (const f of data.mf.slice(0, 30)) out.push(`${clean(f.name)} | ${pctMode ? `${r1(f.value / total * 100)}%` : `${L(f.invested)} | ${L(f.value)}`} | ${f.invested ? r1((f.value / f.invested - 1) * 100) : "?"}%`);
  }
  if (data.events?.length) {
    out.push(`\n## Upcoming events for stocks I hold or watch (next 30 days)`);
    for (const e of data.events.slice(0, 30)) out.push(`${e.date} ${e.symbol}: ${clean(e.label)}${e.amount ? ` ₹${e.amount}/share` : ""}`);
  }
  return out.join("\n");
}

export const SYSTEM = `You are the investing co-pilot inside a personal Indian equity research app. The user is a long-term investor and swing trader in Indian stocks (NSE), with some US stocks and mutual funds. You see a snapshot of their portfolio below, computed by the app from live prices; you can call tools for detail on any stock.

How to answer:
- Lead with the decision in one line (e.g. "Lean: book 2/3 of INFY now, trail the rest at ₹1,120"), then the reasons with the actual numbers from the data, then the risks and what would change your mind.
- Use only the numbers given or returned by tools. Never invent prices, dates, results or news; if something is missing, say so or call a tool. You do not have news or the internet.
- Think like a disciplined trader: position size, risk per trade, stop-loss, targets, trend, upcoming results / ex-dividend dates (price drops by the dividend on the ex-date; dividends are taxed at the slab rate), short-term (20%) vs long-term (12.5% above ₹1.25 lakh) capital gains, STT and charges.
- For buy-the-dip and valuation questions, compare price with fair value, buy zone, P/E vs sector, and say whether the level is a value buy or just a falling knife.
- Be concise: short paragraphs or bullets, tables when comparing several stocks. Indian number format (₹1.2 L, ₹3.4 Cr).
- This is decision support for the user's own judgement, not a guarantee. Say clearly when the data is thin or the call is close. Do not repeat a disclaimer in every answer; one short line at the end is enough when you recommend a trade.`;

export const TOOLS = [
  { name: "stock_detail", description: "Valuation, fundamentals, technicals (trend, RSI, moving averages, 52-week range) and upcoming results / dividends for one NSE stock, from the app's data. Use before giving a buy/sell view on a stock not fully covered in the snapshot.", input_schema: { type: "object", properties: { symbol: { type: "string", description: "NSE symbol, e.g. INFY" } }, required: ["symbol"] } },
  { name: "hold_or_sell", description: "For one of the user's swing positions: the app's sell-now / hold-to-dividend / book-part-and-trail scenarios with net amounts after tax and charges, the stock's volatility and a rule-based lean.", input_schema: { type: "object", properties: { symbol: { type: "string" } }, required: ["symbol"] } },
  { name: "index_stocks", description: "The stocks inside an NSE index (e.g. 'NIFTY 50', 'NIFTY500 QUALITY 50', 'NIFTY200 MOMENTUM 30', 'NIFTY MIDCAP 150') with price, 1-month and 1-year return, distance from the 52-week high, index weight, this app's valuation where known, a 0-100 smart score and tags (undervalued, momentum, pullback, near-low), and whether the user holds or watches each.", input_schema: { type: "object", properties: { index: { type: "string" }, filter: { type: "string", enum: ["all", "top", "undervalued", "momentum", "pullback", "not-watching"] } }, required: ["index"] } },
  { name: "swing_ideas", description: "Today's swing setups from the app's scanner (pullbacks, breakouts, oversold bounces, value turns) with entry, stop and targets, and the scanner's past hit rate.", input_schema: { type: "object", properties: { setup: { type: "string", enum: ["any", "pullback", "breakout", "bounce", "value"] } } } }
];

// Server-sent events from the Anthropic Messages API → events { type, ... }
export function sseParser(onEvent) {
  let buf = "";
  return chunk => {
    buf += chunk; let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = block.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      try { onEvent(JSON.parse(data)); } catch { /* ignore a broken line */ }
    }
  };
}
// Collect one streamed message: text deltas go to onText; returns { content, stop_reason, usage }
export function messageCollector(onText) {
  const blocks = [], usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }; let stop = null, error = null;
  const on = ev => {
    if (ev.type === "message_start") { const u = ev.message?.usage || {}; usage.input += u.input_tokens || 0; usage.cacheRead += u.cache_read_input_tokens || 0; usage.cacheWrite += u.cache_creation_input_tokens || 0; usage.output += u.output_tokens || 0; }
    else if (ev.type === "content_block_start") blocks[ev.index] = { ...ev.content_block, _json: "" };
    else if (ev.type === "content_block_delta") {
      const b = blocks[ev.index]; if (!b) return;
      if (ev.delta.type === "text_delta") { b.text = (b.text || "") + ev.delta.text; onText?.(ev.delta.text); }
      else if (ev.delta.type === "input_json_delta") b._json += ev.delta.partial_json || "";
    } else if (ev.type === "content_block_stop") { const b = blocks[ev.index]; if (b?.type === "tool_use") { try { b.input = b._json ? JSON.parse(b._json) : (b.input || {}); } catch { b.input = {}; } } }
    else if (ev.type === "message_delta") { stop = ev.delta?.stop_reason || stop; usage.output = Math.max(usage.output, ev.usage?.output_tokens || 0); }
    else if (ev.type === "error") error = ev.error?.message || "error";
  };
  const result = () => ({ content: blocks.filter(Boolean).map(({ _json, ...b }) => (b.type === "text" ? { type: "text", text: b.text || "" } : b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: b.input || {} } : b)), stop_reason: stop, usage, error });
  return { on, result };
}
export const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
export function friendlyApiError(status, body) {
  const msg = body?.error?.message || "";
  if (status === 401) return "Anthropic rejected the API key (401). Check it in Ask AI → Settings.";
  if (status === 403) return `Anthropic refused the request (403)${msg ? `: ${msg}` : ""}.`;
  if (status === 404) return `Model not found (404)${msg ? `: ${msg}` : ""}. Pick another model in Ask AI → Settings.`;
  if (status === 429) return "Rate limited or out of credits at Anthropic (429). Try again in a minute, or check your plan and billing.";
  if (status === 529 || status === 503) return "Anthropic is overloaded right now. Try again shortly.";
  return `Anthropic error ${status}${msg ? `: ${msg}` : ""}`;
}
