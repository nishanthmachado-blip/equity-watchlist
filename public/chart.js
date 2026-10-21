// Price chart (TradingView Lightweight Charts, Apache-2.0, loaded on demand) for any stock: candles and volume from your
// Angel One account (1 day … 5 years, intraday down to 5 minutes), falling back to saved NSE closes / Yahoo for daily
// charts. Shows the 20 / 50 / 200-day averages and your own levels: swing average, targets, stop-loss, holding average,
// buy zone and fair value. window.openChart(symbol, { name, exchange }).
(() => {
  const LIB = "vendor/lightweight-charts-4.2.3.js";
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fin = v => Number.isFinite(v);
  const TFS = ["1D", "1W", "1M", "6M", "1Y", "5Y"];
  const MAS = [[20, "#f59e0b"], [50, "#3b82f6"], [200, "#a855f7"]];
  const IST = 19800;
  let opt = { tf: "6M", ma: { 20: true, 50: true, 200: true }, vol: true, lv: true };
  try { const o = JSON.parse(localStorage.getItem("chart-opt") || "{}"); if (TFS.includes(o.tf)) opt.tf = o.tf; if (o.ma) opt.ma = { ...opt.ma, ...o.ma }; if (typeof o.vol === "boolean") opt.vol = o.vol; if (typeof o.lv === "boolean") opt.lv = o.lv; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem("chart-opt", JSON.stringify(opt)); } catch { /* private mode */ } };

  let libP = null;
  const loadLib = () => libP ||= new Promise((ok, no) => {
    if (window.LightweightCharts) return ok(window.LightweightCharts);
    const s = document.createElement("script"); s.src = LIB; s.async = true;
    s.onload = () => (window.LightweightCharts ? ok(window.LightweightCharts) : no(new Error("chart library did not load")));
    s.onerror = () => { libP = null; no(new Error("could not load the chart library")); };
    document.head.append(s);
  });

  let el = null, chart = null, series = {}, cur = null, data = null, timer = null, seq = 0, prevFocus = null;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const dark = () => document.documentElement.dataset.theme === "dark" || (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches);
  const UP = () => (dark() ? "#22c55e" : "#16a34a"), DOWN = () => (dark() ? "#ef4444" : "#dc2626");
  const money = v => (fin(v) ? `₹${v.toLocaleString("en-IN", { maximumFractionDigits: v >= 1000 ? 1 : 2 })}` : "—");
  const vol = v => (!fin(v) ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)} L` : v.toLocaleString("en-IN"));
  const daily = () => ["6M", "1Y", "5Y"].includes(cur?.tf);
  // Lightweight Charts shows times as UTC: daily bars become a calendar day, intraday bars are shifted to IST
  const tOf = t => (daily() ? new Date((t + IST) * 1000).toISOString().slice(0, 10) : t + IST);

  function build() {
    el = document.createElement("div"); el.className = "ch-modal"; el.hidden = true;
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Price chart");
    el.innerHTML = `<div class="ch-scrim" data-ch-close></div><div class="ch-box">
      <div class="ch-head"><div class="ch-title"><strong id="chName"></strong> <span class="ticker" id="chSym"></span><div class="ch-price" id="chPrice"></div></div>
        <button type="button" class="ch-x" data-ch-close aria-label="Close chart">✕</button></div>
      <div class="ch-tools"><div class="ch-tfs" role="group" aria-label="Period">${TFS.map(t => `<button type="button" class="pf-chip" data-tf="${t}">${t}</button>`).join("")}</div>
        <div class="ch-tog">${MAS.map(([n, c]) => `<label title="${n}-day average (daily charts)"><input type="checkbox" data-ma="${n}"><i style="background:${c}"></i>${n} DMA</label>`).join("")}
          <label><input type="checkbox" data-vol> Volume</label><label title="Your swing average, targets, stop-loss, holding average, buy zone and fair value"><input type="checkbox" data-lv> My levels</label></div></div>
      <div class="ch-area"><div class="ch-legend" id="chLegend"></div><div class="ch-canvas" id="chCanvas"></div><div class="ch-msg" id="chMsg" hidden></div></div>
      <div class="ch-foot hint" id="chFoot"></div></div>`;
    document.body.append(el);
    el.addEventListener("click", e => {
      if (e.target.closest("[data-ch-close]")) return close();
      const b = e.target.closest("[data-tf]"); if (b && b.dataset.tf !== cur.tf) { opt.tf = cur.tf = b.dataset.tf; save(); load(); }
    });
    el.addEventListener("change", e => {
      const t = e.target;
      if (t.dataset.ma) opt.ma[t.dataset.ma] = t.checked; else if ("vol" in t.dataset) opt.vol = t.checked; else if ("lv" in t.dataset) opt.lv = t.checked; else return;
      save(); draw();
    });
  }
  const onKey = e => { if (e.key === "Escape" && el && !el.hidden) { e.stopImmediatePropagation(); e.preventDefault(); close(); } };

  function close() {
    if (!el || el.hidden) return;
    clearTimeout(timer); timer = null; seq++;
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
    el.querySelector("#chPrice").innerHTML = ""; el.querySelector("#chLegend").innerHTML = ""; el.querySelector("#chFoot").textContent = "";
    MAS.forEach(([n]) => { el.querySelector(`[data-ma="${n}"]`).checked = !!opt.ma[n]; });
    el.querySelector("[data-vol]").checked = opt.vol; el.querySelector("[data-lv]").checked = opt.lv;
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
    if (my === seq && !daily()) timer = setTimeout(() => { if (!el.hidden) load(); }, 60000); // intraday: refresh each minute while open
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
    series.lines = []; chart.kind = kind;
    chart.subscribeCrosshairMove(p => legend(p?.time !== undefined ? p.time : null));
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
    const colour = { avg: "#0ea5e9", hold: "#64748b", target: up, stop: down, zone: "#f59e0b", fair: "#a855f7" };
    series.lines = opt.lv ? (data.levels || []).map(l => series.c.createPriceLine({ price: l.price, color: colour[l.kind] || "#64748b", lineWidth: 1, lineStyle: l.kind === "zone" || l.kind === "fair" ? 2 : 0, axisLabelVisible: true, title: l.label })) : [];
    if (fit) {
      if (data.viewFrom && bars.length && bars[0].t < data.viewFrom) { const i = bars.findIndex(b => b.t >= data.viewFrom); chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, i), to: bars.length + 3 }); }
      else chart.timeScale().fitContent();
    }
    legend(null); head(); foot();
  }

  function legend(time) {
    const bars = data?.bars || []; if (!bars.length) { el.querySelector("#chLegend").innerHTML = ""; return; }
    let i = time === null ? bars.length - 1 : bars.findIndex(b => tOf(b.t) === time); if (i < 0) i = bars.length - 1;
    const b = bars[i], prev = bars[i - 1]?.c, ch = fin(prev) ? (b.c / prev - 1) * 100 : null;
    const when = daily() ? new Date((b.t + IST) * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : new Date((b.t + IST) * 1000).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    const mas = daily() ? MAS.filter(([n]) => opt.ma[n] && i >= n - 1).map(([n, c]) => { let s = 0; for (let k = i - n + 1; k <= i; k++) s += bars[k].c; return `<span style="color:${c}">${n}: ${money(Math.round(s / n * 100) / 100)}</span>`; }).join(" ") : "";
    el.querySelector("#chLegend").innerHTML = `<span>${esc(when)}</span> <span>O ${money(b.o)}</span> <span>H ${money(b.h)}</span> <span>L ${money(b.l)}</span> <span>C <b>${money(b.c)}</b></span>${fin(ch) ? ` <span class="${ch >= 0 ? "buy" : "avoid"}">${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%</span>` : ""}${b.v ? ` <span>Vol ${vol(b.v)}</span>` : ""}${mas ? `<div>${mas}</div>` : ""}`;
  }

  function head() {
    const bars = data.bars || [], lv = data.live, last = bars.at(-1);
    const price = lv?.price ?? last?.c, prev = lv?.prevClose ?? null;
    let txt = fin(price) ? `<b>${money(price)}</b>` : "";
    if (fin(price) && fin(prev) && prev > 0) { const ch = (price / prev - 1) * 100; txt += ` <span class="${ch >= 0 ? "buy" : "avoid"}">${ch >= 0 ? "+" : ""}${(price - prev).toFixed(2)} (${ch >= 0 ? "+" : ""}${ch.toFixed(2)}%) today</span>`; }
    if (bars.length > 1 && fin(price)) { const first = data.viewFrom ? bars.find(b => b.t >= data.viewFrom) || bars[0] : bars[0], p = (price / first.c - 1) * 100; txt += ` <small class="${p >= 0 ? "buy" : "avoid"}">${p >= 0 ? "+" : ""}${p.toFixed(1)}% over ${cur.tf}</small>`; }
    el.querySelector("#chPrice").innerHTML = txt;
  }

  function foot() {
    const d = data, iv = { FIVE_MINUTE: "5-minute", FIFTEEN_MINUTE: "15-minute", ONE_HOUR: "1-hour", ONE_DAY: "daily" }[d.interval] || "";
    const parts = [];
    if (d.source) parts.push(`${iv} candles from ${d.source}`);
    if (d.notes?.length && d.source !== "Angel One") parts.push(d.notes.join(" · "));
    if (!daily()) parts.push("DMAs show on 6M / 1Y / 5Y");
    if (opt.lv && !(d.levels || []).length) parts.push("no levels of yours for this stock");
    parts.push("Charting by TradingView Lightweight Charts");
    el.querySelector("#chFoot").textContent = parts.join(" · ");
  }

  // "📈" buttons anywhere in the app: <button data-chart="SYMBOL" data-chart-name="…" data-chart-ex="NSE">
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-chart]"); if (!b) return;
    e.preventDefault(); e.stopPropagation();
    window.openChart(b.dataset.chart, { name: b.dataset.chartName || null, exchange: b.dataset.chartEx || "NSE" });
  }, true);
})();
