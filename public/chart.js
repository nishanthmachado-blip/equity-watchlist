// Price chart (TradingView Lightweight Charts, Apache-2.0, loaded on demand) for any stock: candles and volume from your
// Angel One account (1 day … 5 years, intraday down to 5 minutes), falling back to saved NSE closes / Yahoo for daily
// charts. Shows the 20 / 50 / 200-day averages, your own levels (swing average, targets, stop-loss, holding average,
// buy zone, fair value, price alerts), marks results, dividends, order wins and your buys / sells on the candles,
// and lets you click a price to set an alert or stop-loss or draw a line (saved per stock). With Angel One's live
// feed the last candle moves as prices change. window.openChart(symbol, { name, exchange }).
(() => {
  const LIB = "vendor/lightweight-charts-4.2.3.js";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fin = v => Number.isFinite(v);
  const TFS = ["1D", "1W", "1M", "6M", "1Y", "5Y"];
  const MAS = [[20, "#f59e0b"], [50, "#3b82f6"], [200, "#a855f7"]];
  const IST = 19800;
  const STEP = { FIVE_MINUTE: 300, FIFTEEN_MINUTE: 900, ONE_HOUR: 3600 };
  let opt = { tf: "6M", ma: { 20: true, 50: true, 200: true }, vol: true, lv: true, ev: true };
  try { const o = JSON.parse(localStorage.getItem("chart-opt") || "{}"); if (TFS.includes(o.tf)) opt.tf = o.tf; if (o.ma) opt.ma = { ...opt.ma, ...o.ma }; for (const k of ["vol", "lv", "ev"]) if (typeof o[k] === "boolean") opt[k] = o[k]; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem("chart-opt", JSON.stringify(opt)); } catch { /* private mode */ } };

  let libP = null;
  const loadLib = () => libP ||= new Promise((ok, no) => {
    if (window.LightweightCharts) return ok(window.LightweightCharts);
    const s = document.createElement("script"); s.src = LIB; s.async = true;
    s.onload = () => (window.LightweightCharts ? ok(window.LightweightCharts) : no(new Error("chart library did not load")));
    s.onerror = () => { libP = null; no(new Error("could not load the chart library")); };
    document.head.append(s);
  });

  let el = null, chart = null, series = {}, cur = null, data = null, timer = null, seq = 0, prevFocus = null, evAt = new Map(), trendStart = null;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const dark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const UP = () => (dark() ? "#22c55e" : "#16a34a"), DOWN = () => (dark() ? "#ef4444" : "#dc2626");
  const money = v => (fin(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 1 : 2 })}` : "—");
  const vol = v => (!fin(v) ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v.toLocaleString("en-IN"));
  const daily = () => ["6M", "1Y", "5Y"].includes(cur?.tf);
  const istDay = t => new Date((t + IST) * 1000).toISOString().slice(0, 10);
  const dayLabel = d => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  // Lightweight Charts shows times as UTC: daily bars become a calendar day, intraday bars are shifted to IST
  const tOf = t => (daily() ? istDay(t) : t + IST);
  const round2 = p => Math.round(p * 100) / 100;
  const nicePrice = p => (p >= 1000 ? Math.round(p * 10) / 10 : p >= 100 ? Math.round(p * 20) / 20 : round2(p));

  async function api(path, body) {
    const r = await fetch(path, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  }
  const toast = (m, kind = "ok") => (window.toast ? window.toast(esc(m), { kind, ms: 4500 }) : null);

  function build() {
    el = document.createElement("div"); el.className = "ch-modal"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Price chart");
    el.innerHTML = `<div class="ch-scrim" data-ch-close></div><div class="ch-box">
      <div class="ch-head"><div class="ch-title"><strong id="chName"></strong> <span class="ticker" id="chSym"></span> <span class="ch-live" id="chLive" hidden title="Prices from your Angel One live feed">● Live</span><div class="ch-price" id="chPrice"></div></div>
        <button type="button" class="ch-x" data-ch-close aria-label="Close chart">✕</button></div>
      <div class="ch-tools"><div class="ch-tfs" role="group" aria-label="Period">${TFS.map(t => `<button type="button" class="pf-chip" data-tf="${t}">${t}</button>`).join("")}</div>
        <div class="ch-tog">${MAS.map(([n, c]) => `<label title="${n}-day average (daily charts)"><input type="checkbox" data-ma="${n}"><i style="background:${c}"></i>${n} DMA</label>`).join("")}
          <label><input type="checkbox" data-vol> Volume</label><label title="Your swing average, targets, stop-loss, holding average, buy zone, fair value and price alerts"><input type="checkbox" data-lv> My levels</label>
          <label title="Results, dividends, bonuses / splits, order wins and your buys and sells"><input type="checkbox" data-ev> Events</label>
          <button type="button" class="ch-linesbtn" data-lines aria-expanded="false">✏️ My lines <span id="chLineCount"></span></button></div></div>
      <div class="ch-upcoming" id="chUpcoming" hidden></div>
      <div class="ch-area"><div class="ch-legend" id="chLegend"></div><div class="ch-canvas" id="chCanvas"></div><div class="ch-msg" id="chMsg" hidden></div>
        <div class="ch-menu" id="chMenu" hidden role="menu"></div><div class="ch-panel" id="chPanel" hidden></div><div class="ch-hint" id="chHint" hidden></div></div>
      <div class="ch-foot hint" id="chFoot"></div></div>`;
    document.body.append(el);
    el.addEventListener("click", e => {
      if (e.target.closest("[data-ch-close]")) return close();
      const b = e.target.closest("[data-tf]"); if (b && b.dataset.tf !== cur.tf) { opt.tf = cur.tf = b.dataset.tf; save(); hideMenu(); cancelTrend(); load(); return; }
      if (e.target.closest("[data-lines]")) { togglePanel(); return; }
      const act = e.target.closest("[data-act]"); if (act) { e.preventDefault(); menuAction(act.dataset.act, Number(act.dataset.price)); return; }
      const del = e.target.closest("[data-del-line]"); if (del) { removeLine(del.dataset.delLine); return; }
      const delA = e.target.closest("[data-del-alert]"); if (delA) { removeAlert(delA.dataset.delAlert); return; }
      if (e.target.closest("[data-clear-lines]")) { clearLines(); return; }
      if (e.target.closest("[data-cancel-trend]")) { cancelTrend(); return; }
      if (!e.target.closest("#chMenu") && !e.target.closest("#chCanvas")) hideMenu();
    });
    el.addEventListener("change", e => {
      const t = e.target;
      if (t.dataset.ma) opt.ma[t.dataset.ma] = t.checked; else if ("vol" in t.dataset) opt.vol = t.checked; else if ("lv" in t.dataset) opt.lv = t.checked; else if ("ev" in t.dataset) opt.ev = t.checked; else return;
      save(); draw();
    });
  }
  const onKey = e => {
    if (e.key !== "Escape" || !el || el.hidden) return;
    e.stopImmediatePropagation(); e.preventDefault();
    if (!el.querySelector("#chMenu").hidden) hideMenu(); else if (trendStart) cancelTrend(); else if (!el.querySelector("#chPanel").hidden) togglePanel(false); else close();
  };

  function close() {
    if (!el || el.hidden) return;
    clearTimeout(timer); timer = null; seq++; hideMenu(); cancelTrend(); togglePanel(false);
    el.hidden = true; document.body.classList.remove("ch-open");
    window.removeEventListener("keydown", onKey, true);
    chart?.remove(); chart = null; series = {};
    prevFocus?.focus?.({ preventScroll: true });
  }

  window.openChart = (symbol, { name = null, exchange = "NSE" } = {}) => {
    if (!symbol) return;
    if (!el) build();
    prevFocus = document.activeElement;
    cur = { symbol: String(symbol).toUpperCase(), name: name || String(symbol).toUpperCase(), exchange: exchange === "BSE" ? "BSE" : "NSE", tf: opt.tf };
    el.querySelector("#chName").textContent = cur.name;
    el.querySelector("#chSym").textContent = cur.name === cur.symbol ? cur.exchange : `${cur.symbol} · ${cur.exchange}`;
    for (const id of ["#chPrice", "#chLegend", "#chUpcoming", "#chLineCount"]) el.querySelector(id).innerHTML = "";
    el.querySelector("#chFoot").textContent = ""; el.querySelector("#chUpcoming").hidden = true; el.querySelector("#chLive").hidden = true;
    MAS.forEach(([n]) => { el.querySelector(`[data-ma="${n}"]`).checked = !!opt.ma[n]; });
    el.querySelector("[data-vol]").checked = opt.vol; el.querySelector("[data-lv]").checked = opt.lv; el.querySelector("[data-ev]").checked = opt.ev;
    el.hidden = false; document.body.classList.add("ch-open");
    window.addEventListener("keydown", onKey, true); // window capture runs before the stock sheet's own Escape handler
    requestAnimationFrame(() => el.querySelector(".ch-x").focus({ preventScroll: true }));
    load();
  };
  window.closeChart = close;

  function msg(text) { const m = el.querySelector("#chMsg"); m.hidden = !text; m.innerHTML = text || ""; }

  async function load() {
    const my = ++seq; clearTimeout(timer);
    el.querySelectorAll("[data-tf]").forEach(b => b.classList.toggle("active", b.dataset.tf === cur.tf));
    if (!data || data.symbol !== cur.symbol || data.tf !== cur.tf) msg("Loading chart…");
    try {
      const [L, r] = await Promise.all([loadLib(), fetch(`/api/chart?symbol=${encodeURIComponent(cur.symbol)}&exchange=${cur.exchange}&tf=${cur.tf}`, { credentials: "same-origin" })]);
      const d = await r.json().catch(() => ({}));
      if (my !== seq) return;
      if (!r.ok) throw new Error(d.message || `HTTP ${r.status}`);
      const kind = daily() ? "day" : "time";
      if (chart && chart.kind !== kind) { chart.remove(); chart = null; series = {}; } // day ↔ intraday time axis
      const again = !!chart && data && data.symbol === d.symbol && data.tf === d.tf; // a refresh keeps your zoom
      data = d; makeChart(L, kind); draw(!again);
      msg(d.bars.length ? "" : `No price history to show.${d.notes?.length ? `<small>${d.notes.map(esc).join("<br>")}</small>` : ""}`);
    } catch (e) { if (my === seq) msg(`Could not load the chart: ${esc(e.message)}`); }
    if (my === seq && !daily()) timer = setTimeout(() => { if (!el.hidden) load(); }, 60000); // intraday: reload each minute while open
  }

  function makeChart(L, kind) {
    if (chart) return;
    const box = el.querySelector("#chCanvas"), ink = css("--ink") || "#1f2937", line = css("--line") || "#e5e7eb", bg = css("--card-bg") || "#fff";
    chart = L.createChart(box, {
      autoSize: true,
      layout: { background: { type: "solid", color: bg }, textColor: ink, fontFamily: getComputedStyle(document.body).fontFamily },
      grid: { vertLines: { color: line }, horzLines: { color: line } },
      rightPriceScale: { borderColor: line }, timeScale: { borderColor: line, rightOffset: 4, timeVisible: kind === "time", secondsVisible: false },
      crosshair: { mode: L.CrosshairMode.Normal },
      localization: { priceFormatter: p => p.toLocaleString("en-IN", { maximumFractionDigits: 2 }) }
    });
    const up = UP(), down = DOWN();
    series.c = chart.addCandlestickSeries({ upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineVisible: true });
    series.v = chart.addHistogramSeries({ priceFormat: { type: "volume" }, priceScaleId: "vol", lastValueVisible: false, priceLineVisible: false });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    series.c.priceScale().applyOptions({ scaleMargins: { top: 0.06, bottom: 0.22 } });
    series.ma = Object.fromEntries(MAS.map(([n, c]) => [n, chart.addLineSeries({ color: c, lineWidth: 1.5, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false })]));
    series.lines = []; series.mine = []; series.trends = []; chart.kind = kind; chart.L = L;
    let inMove = false; // drawing the trend-line preview moves the crosshair again: don't recurse
    chart.subscribeCrosshairMove(p => { if (inMove) return; inMove = true; try { legend(p?.time !== undefined ? p.time : null); if (trendStart && p?.point) trendPreview(p); } finally { inMove = false; } });
    chart.subscribeClick(onChartClick);
  }

  const fade = c => (/^#[0-9a-f]{6}$/i.test(c) ? `${c}66` : c.startsWith("rgb(") ? c.replace("rgb(", "rgba(").replace(")", ",0.4)") : c);
  const sma = (bars, n) => { const out = []; let s = 0; bars.forEach((b, i) => { s += b.c; if (i >= n) s -= bars[i - n].c; if (i >= n - 1) out.push({ time: tOf(b.t), value: Math.round(s / n * 100) / 100 }); }); return out; };

  function draw(fit = false) {
    if (!chart || !data) return;
    const seen = new Map(); for (const b of data.bars || []) if ([b.o, b.h, b.l, b.c].every(fin)) seen.set(String(tOf(b.t)), b); // one bar per chart time
    const bars = data.bars = [...seen.values()].sort((a, b) => a.t - b.t), up = UP(), down = DOWN();
    series.c.setData(bars.map(b => ({ time: tOf(b.t), open: b.o, high: b.h, low: b.l, close: b.c })));
    const hasVol = opt.vol && bars.some(b => b.v > 0);
    series.v.setData(hasVol ? bars.map(b => ({ time: tOf(b.t), value: b.v || 0, color: fade(b.c >= b.o ? up : down) })) : []);
    for (const [n] of MAS) series.ma[n].setData(daily() && opt.ma[n] ? sma(bars, n) : []);
    for (const l of series.lines) series.c.removePriceLine(l);
    const colour = { avg: "#0ea5e9", hold: "#64748b", target: up, stop: down, zone: "#f59e0b", fair: "#a855f7", alert: "#e11d48" };
    series.lines = opt.lv ? (data.levels || []).map(l => series.c.createPriceLine({ price: l.price, color: colour[l.kind] || "#64748b", lineWidth: 1, lineStyle: l.kind === "zone" || l.kind === "fair" ? 2 : l.kind === "alert" ? 1 : 0, axisLabelVisible: true, title: l.label })) : [];
    drawMine(); marks();
    if (fit) {
      if (data.viewFrom && bars.length && bars[0].t < data.viewFrom) { const i = bars.findIndex(b => b.t >= data.viewFrom); chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, i), to: bars.length + 3 }); }
      else chart.timeScale().fitContent();
    }
    legend(null); head(); foot(); panel();
  }

  // ---- Events on the candles ----------------------------------------------------------------------------------------
  // Each event sits on the bar of its day (or, for your trades on intraday charts, the bar of that minute)
  function barFor(e, bars) {
    if (!bars.length) return null;
    if (!daily() && e.at) { const t = Date.parse(e.at) / 1000; if (!(t >= bars[0].t)) return null; let k = bars.length - 1; while (k > 0 && bars[k].t > t) k--; return bars[k].t > t + 86400 ? null : bars[k]; }
    const k = bars.findIndex(b => istDay(b.t) >= e.date); if (k < 0) return null;
    if (!daily() && istDay(bars[k].t) !== e.date) return null; // intraday: only on the day itself
    return bars[k];
  }
  const MARK = {
    buy: (up) => ({ position: "belowBar", shape: "arrowUp", color: up, text: "B" }),
    sell: (up, down) => ({ position: "aboveBar", shape: "arrowDown", color: down, text: "S" }),
    results: () => ({ position: "aboveBar", shape: "circle", color: "#2563eb", text: "R" }),
    dividend: () => ({ position: "belowBar", shape: "circle", color: "#a855f7", text: "D" }),
    order: () => ({ position: "aboveBar", shape: "square", color: "#f59e0b", text: "O" }),
    bonus: () => ({ position: "belowBar", shape: "square", color: "#0ea5e9", text: "Bonus" }),
    split: () => ({ position: "belowBar", shape: "square", color: "#0ea5e9", text: "Split" })
  };
  function marks() {
    const bars = data.bars || [], up = UP(), down = DOWN(), list = []; evAt = new Map();
    const evs = (data.events || []).filter(e => !e.upcoming);
    if (opt.ev) for (const e of evs) {
      const b = barFor(e, bars); if (!b || !MARK[e.kind]) continue;
      const time = tOf(b.t); list.push({ time, sortT: b.t, ...MARK[e.kind](up, down) });
      (evAt.get(String(time)) || evAt.set(String(time), []).get(String(time))).push(e);
    }
    list.sort((a, b) => a.sortT - b.sortT);
    series.c.setMarkers(list.map(({ sortT, ...m }) => m)); // eslint-disable-line no-unused-vars
    const up2 = (data.events || []).filter(e => e.upcoming && (e.kind === "results" || e.kind === "dividend" || e.kind === "bonus" || e.kind === "split")).slice(0, 4), box = el.querySelector("#chUpcoming");
    box.hidden = !opt.ev || !up2.length;
    box.innerHTML = up2.length ? `<b>Coming up:</b> ${up2.map(e => `<span class="ch-up ch-k-${e.kind}">${esc(e.label)} · ${esc(dayLabel(e.date))}</span>`).join("")}` : "";
  }

  function legend(time) {
    const bars = data?.bars || []; if (!bars.length) { el.querySelector("#chLegend").innerHTML = ""; return; }
    let i = time === null ? bars.length - 1 : bars.findIndex(b => tOf(b.t) === time); if (i < 0) i = bars.length - 1;
    const b = bars[i], prev = bars[i - 1]?.c, ch = fin(prev) ? (b.c / prev - 1) * 100 : null;
    const when = daily() ? dayLabel(istDay(b.t)) : new Date((b.t + IST) * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    const mas = daily() ? MAS.filter(([n]) => opt.ma[n] && i >= n - 1).map(([n, c]) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += bars[k].c; return `<span style="color:${c}">${n}: ${money(Math.round(s / n * 100) / 100)}</span>`; }).join(" ") : "";
    const evs = evAt.get(String(tOf(b.t))) || [];
    el.querySelector("#chLegend").innerHTML = `<span>${esc(when)}</span> <span>O ${money(b.o)}</span> <span>H ${money(b.h)}</span> <span>L ${money(b.l)}</span> <span>C <b>${money(b.c)}</b></span>${fin(ch) ? ` <span class="${ch >= 0 ? "buy" : "avoid"}">${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</span>` : ""}${b.v ? ` <span>Vol ${vol(b.v)}</span>` : ""}${mas ? `<div>${mas}</div>` : ""}${evs.length ? `<div class="ch-evs">${evs.map(e => `<div class="ch-k-${e.kind}">${esc(e.label)}${e.kind !== "buy" && e.kind !== "sell" && e.date !== istDay(b.t) ? ` (${esc(dayLabel(e.date))})` : ""}${e.detail ? `<small>${esc(e.detail)}</small>` : ""}</div>`).join("")}</div>` : ""}`;
  }

  function livePrice() { const lq = window.liveQuotes?.[cur.symbol]; return lq?.price > 0 && data?.live?.asOf && lq.asOf && lq.asOf < data.live.asOf ? data.live : lq?.price > 0 ? lq : data?.live; }
  function head() {
    const bars = data.bars || [], lv = livePrice(), last = bars.at(-1);
    const price = lv?.price ?? last?.c, prev = lv?.prevClose ?? null;
    let txt = fin(price) ? `<b>${money(price)}</b>` : "";
    if (fin(price) && fin(prev) && prev > 0) { const ch = (price / prev - 1) * 100; txt += ` <span class="${ch >= 0 ? "buy" : "avoid"}">${ch >= 0 ? "+" : ""}${(price - prev).toFixed(2)} (${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%) today</span>`; }
    if (bars.length > 1 && fin(price)) { const first = data.viewFrom ? bars.find(b => b.t >= data.viewFrom) || bars[0] : bars[0], p = (price / first.c - 1) * 100; txt += ` <small class="${p >= 0 ? "buy" : "avoid"}">${p >= 0 ? "+" : ""}${p.toFixed(1)}% over ${cur.tf}</small>`; }
    el.querySelector("#chPrice").innerHTML = txt;
    el.querySelector("#chLive").hidden = !(lv?.stream || (data.streaming && lv?.source === "Angel One"));
  }

  function foot() {
    const d = data, iv = { FIVE_MINUTE: "5-minute", FIFTEEN_MINUTE: "15-minute", ONE_HOUR: "1-hour", ONE_DAY: "daily" }[d.interval] || "";
    const parts = [];
    if (d.source) parts.push(`${iv} candles from ${d.source}`);
    if (d.notes?.length && d.source !== "Angel One") parts.push(d.notes.join(" · "));
    if (!daily()) parts.push("DMAs show on 6M / 1Y / 5Y");
    if (opt.ev) parts.push("B / S your buys and sells · R results · D dividend · O order win");
    parts.push("Click the chart to set an alert, a stop-loss or draw a line");
    parts.push("Charting by TradingView Lightweight Charts");
    el.querySelector("#chFoot").textContent = parts.join(" · ");
  }

  // ---- Click a price: alert / stop-loss / your own line ----------------------------------------------------------------
  function pointOf(p) {
    if (!p?.point || !data?.bars?.length) return null;
    const raw = series.c.coordinateToPrice(p.point.y); if (!(raw > 0)) return null;
    const bars = data.bars, k = Math.max(0, Math.min(bars.length - 1, Math.round(p.logical ?? bars.length - 1)));
    return { price: nicePrice(raw), t: bars[k].t, x: p.point.x, y: p.point.y };
  }
  function onChartClick(p) {
    const pt = pointOf(p); if (!pt) { hideMenu(); return; }
    if (trendStart) { finishTrend(pt); return; }
    showMenu(pt);
  }
  function showMenu(pt) {
    const m = el.querySelector("#chMenu"), now = livePrice()?.price ?? data.bars.at(-1)?.c, pos = data.position;
    const above = fin(now) ? pt.price > now : true;
    const items = [
      [`alert-${above ? "above" : "below"}`, `🔔 Alert me when it goes ${above ? "above" : "below"} ${money(pt.price)}`],
      ...(pos && (!fin(now) || pt.price < now) ? [["stop", `🛑 ${pos.stopLoss ? `Move stop-loss ${money(pos.stopLoss)} →` : "Set stop-loss at"} ${money(pt.price)}`]] : []),
      ["line", `➖ Draw a line at ${money(pt.price)}`],
      ["trend", "📐 Start a trend line here"]
    ];
    m.innerHTML = `<div class="ch-menu-h">${money(pt.price)}${fin(now) ? ` <small>${pt.price >= now ? "+" : ""}${((pt.price / now - 1) * 100).toFixed(1)}% from now</small>` : ""}</div>${items.map(([a, t]) => `<button type="button" role="menuitem" data-act="${a}" data-price="${pt.price}">${esc(t)}</button>`).join("")}`;
    m.hidden = false; m.dataset.t = pt.t;
    const area = el.querySelector(".ch-area").getBoundingClientRect(), w = m.offsetWidth, h = m.offsetHeight;
    m.style.left = `${Math.max(6, Math.min(area.width - w - 6, pt.x + 10))}px`; m.style.top = `${Math.max(6, Math.min(area.height - h - 6, pt.y + 10))}px`;
    m.querySelector("button")?.focus({ preventScroll: true });
  }
  function hideMenu() { const m = el?.querySelector("#chMenu"); if (m) m.hidden = true; }
  async function menuAction(act, price) {
    const t = Number(el.querySelector("#chMenu").dataset.t); hideMenu();
    try {
      if (act.startsWith("alert-")) {
        const type = act.slice(6);
        if ((data.levels || []).some(l => l.kind === "alert" && l.type === type && Math.abs(l.price - price) / price < 0.002)) { toast(`You already have an alert ${type} ${money(price)}.`); return; }
        await api("/api/rules/save", { symbol: cur.symbol, exchange: cur.exchange, name: cur.name, type, value: price });
        toast(`Alert set: ${cur.name} ${type} ${money(price)}. It shows under 🔔 Alerts and on this chart.`); await reload();
      } else if (act === "stop") {
        const r = await api("/api/swing/stop", { id: data.position.id, stopLoss: price }); toast(r.notice || `Stop-loss set at ${money(price)}.`); await reload();
      } else if (act === "line") {
        const r = await api("/api/chart/lines", { symbol: cur.symbol, op: "add", line: { kind: "h", price } }); data.lines = r.lines; drawMine(); panel();
      } else if (act === "trend") startTrend({ price, t });
    } catch (e) { toast(e.message, "bad"); }
  }
  const reload = () => load();

  // ---- Your lines -----------------------------------------------------------------------------------------------------
  const projectAt = (l, t) => l.p1 + (l.p2 - l.p1) * (t - l.t1) / (l.t2 - l.t1);
  function drawMine() {
    if (!chart) return;
    for (const l of series.mine) series.c.removePriceLine(l); series.mine = [];
    for (const s of series.trends) chart.removeSeries(s); series.trends = [];
    const bars = data.bars || [], lines = data.lines || [];
    for (const l of lines.filter(x => x.kind === "h")) series.mine.push(series.c.createPriceLine({ price: l.price, color: l.color || "#2563eb", lineWidth: 2, lineStyle: 0, axisLabelVisible: true, title: l.note || "My line" }));
    if (bars.length > 1) for (const l of lines.filter(x => x.kind === "trend")) {
      if (l.t2 < bars[0].t || l.t1 > bars.at(-1).t + 86400) continue; // drawn on another period's range
      const pts = [l.t1, l.t2].map(t => bars.reduce((best, b) => (Math.abs(b.t - t) < Math.abs(best.t - t) ? b : best), bars[0]).t);
      if (pts[0] === pts[1]) continue;
      const data2 = [{ time: tOf(pts[0]), value: round2(projectAt(l, pts[0])) }, { time: tOf(pts[1]), value: round2(projectAt(l, pts[1])) }];
      const lastT = bars.at(-1).t; if (pts[1] < lastT) data2.push({ time: tOf(lastT), value: round2(projectAt(l, lastT)) }); // carried on to today
      const s = chart.addLineSeries({ color: l.color || "#2563eb", lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
      s.setData(data2); series.trends.push(s);
    }
    el.querySelector("#chLineCount").textContent = lines.length ? `(${lines.length})` : "";
  }
  function startTrend(pt) {
    trendStart = pt; const h = el.querySelector("#chHint");
    h.innerHTML = `Trend line from ${money(pt.price)}: now click the second point. <button type="button" class="linklike" data-cancel-trend>Cancel</button>`; h.hidden = false;
  }
  function trendPreview(p) {
    const pt = pointOf(p); if (!pt || !trendStart || pt.t === trendStart.t) return;
    if (!series.preview) series.preview = chart.addLineSeries({ color: "#94a3b8", lineWidth: 1, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    const a = trendStart.t < pt.t ? trendStart : pt, b = trendStart.t < pt.t ? pt : trendStart;
    series.preview.setData([{ time: tOf(a.t), value: a.price }, { time: tOf(b.t), value: b.price }]);
  }
  function cancelTrend() { trendStart = null; const h = el?.querySelector("#chHint"); if (h) h.hidden = true; if (series.preview && chart) { chart.removeSeries(series.preview); } series.preview = null; }
  async function finishTrend(pt) {
    const a = trendStart; cancelTrend();
    if (pt.t === a.t) { toast("Pick a second point on another candle.", "bad"); return; }
    try { const r = await api("/api/chart/lines", { symbol: cur.symbol, op: "add", line: { kind: "trend", t1: a.t, p1: a.price, t2: pt.t, p2: pt.price } }); data.lines = r.lines; drawMine(); panel(); }
    catch (e) { toast(e.message, "bad"); }
  }
  async function removeLine(id) {
    try { const r = await api("/api/chart/lines", { symbol: cur.symbol, op: "delete", id }); data.lines = r.lines; drawMine(); panel(); } catch (e) { toast(e.message, "bad"); }
  }
  async function clearLines() {
    if (window.ui?.confirm && !(await window.ui.confirm(`Delete all your lines on ${cur.name}?`))) return;
    try { const r = await api("/api/chart/lines", { symbol: cur.symbol, op: "clear" }); data.lines = r.lines; drawMine(); panel(); } catch (e) { toast(e.message, "bad"); }
  }
  async function removeAlert(id) {
    try { await api("/api/rules/delete", { id }); toast("Alert deleted."); await reload(); } catch (e) { toast(e.message, "bad"); }
  }
  function togglePanel(force) {
    const p = el.querySelector("#chPanel"), show = force ?? p.hidden; p.hidden = !show;
    el.querySelector("[data-lines]").setAttribute("aria-expanded", String(show)); if (show) panel();
  }
  function panel() {
    const p = el.querySelector("#chPanel"); if (!p || p.hidden || !data) return;
    const lines = data.lines || [], alerts = (data.levels || []).filter(l => l.kind === "alert");
    const when = t => (daily() ? dayLabel(istDay(t)) : new Date((t + IST) * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" }));
    p.innerHTML = `<div class="ch-panel-h"><b>My lines on ${esc(cur.name)}</b><button type="button" class="ch-x" data-lines aria-label="Close">✕</button></div>
      ${lines.length ? `<ul>${lines.map(l => `<li><i style="background:${esc(l.color || "#2563eb")}"></i>${l.kind === "h" ? `Line at ${money(l.price)}` : `Trend ${money(l.p1)} (${esc(when(l.t1))}) → ${money(l.p2)} (${esc(when(l.t2))})`}<button type="button" class="ch-del" data-del-line="${esc(l.id)}" aria-label="Delete line">✕</button></li>`).join("")}</ul><button type="button" class="linklike" data-clear-lines>Delete all lines</button>` : `<p class="hint">No lines yet. Click the chart and pick “Draw a line” or “Start a trend line”.</p>`}
      ${alerts.length ? `<b class="ch-panel-sub">Price alerts</b><ul>${alerts.map(a => `<li><i style="background:#e11d48"></i>${esc(a.label)}<button type="button" class="ch-del" data-del-alert="${esc(a.id)}" aria-label="Delete alert">✕</button></li>`).join("")}</ul>` : ""}`;
  }

  // ---- Live feed: the last candle follows the price -------------------------------------------------------------------
  let lastLiveDraw = 0;
  window.addEventListener("prices:quotes", e => {
    if (!el || el.hidden || !chart || !data?.bars?.length || !cur) return;
    const q = e.detail?.[cur.symbol]; if (!(q?.price > 0)) return;
    data.live = { ...(data.live || {}), ...q };
    if (Date.now() - lastLiveDraw < 900) return; lastLiveDraw = Date.now();
    const bars = data.bars, last = bars.at(-1), at = q.asOf ? Date.parse(q.asOf) / 1000 : Date.now() / 1000;
    if (!(at > last.t - 60)) { head(); return; } // an older price than the chart already has
    let bar;
    if (daily()) {
      if (istDay(at) === istDay(last.t)) bar = last;
      else if (istDay(at) > istDay(last.t)) { const o = q.dayOpen > 0 ? q.dayOpen : q.price; bar = { t: at, o, h: Math.max(o, q.price), l: Math.min(o, q.price), c: q.price, v: null }; bars.push(bar); }
      else { head(); return; }
      if (q.dayHigh > 0) bar.h = Math.max(bar.h, q.dayHigh); if (q.dayLow > 0) bar.l = Math.min(bar.l, q.dayLow); if (q.volume > 0) bar.v = q.volume;
    } else {
      const step = STEP[data.interval] || 300, open = Date.parse(`${istDay(at)}T09:15:00+05:30`) / 1000, start = open + Math.floor((at - open) / step) * step;
      if (at < open || start < last.t) { head(); return; }
      if (start === last.t) bar = last; else { bar = { t: start, o: last.c, h: Math.max(last.c, q.price), l: Math.min(last.c, q.price), c: q.price, v: null }; bars.push(bar); }
    }
    bar.c = q.price; bar.h = Math.max(bar.h, q.price); bar.l = Math.min(bar.l, q.price);
    try {
      series.c.update({ time: tOf(bar.t), open: bar.o, high: bar.h, low: bar.l, close: bar.c });
      if (opt.vol && bar.v > 0 && daily()) series.v.update({ time: tOf(bar.t), value: bar.v, color: fade(bar.c >= bar.o ? UP() : DOWN()) });
    } catch { /* out-of-order update: the next reload redraws */ }
    head(); legend(null);
  });

  // "📈" buttons anywhere in the app: <button data-chart="SYMBOL" data-chart-name="…" data-chart-ex="NSE">
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-chart]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    window.openChart(b.dataset.chart, { name: b.dataset.chartName || null, exchange: b.dataset.chartEx || "NSE" });
  }, true);
})();
