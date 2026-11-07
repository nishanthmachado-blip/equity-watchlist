// Company info on the stock card: what the company does, order wins and filings, latest news, whether FIIs / DIIs are
// buying, which mutual funds hold it, and signs of selling or buying pressure. Loaded the first time a stock card
// opens; reads /api/stock/info (public data, cached on the server).
(() => {
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const day = d => (d ? new Date(d.length <= 10 ? `${d}T00:00:00Z` : d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : "");
  const ago = d => { if (!d) return ""; const h = (Date.now() - new Date(d).getTime()) / 36e5; return h < 1 ? "just now" : h < 24 ? `${Math.round(h)} h ago` : h < 24 * 30 ? `${Math.round(h / 24)} d ago` : day(d); };
  const chg = v => (fin(v) ? `<span class="${v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "hint"}">${v > 0 ? "▲ +" : v < 0 ? "▼ " : ""}${v}</span>` : '<span class="hint">—</span>');
  const safeUrl = u => (/^https?:\/\//.test(u || "") ? esc(u) : null);
  let seq = 0;
  async function load(symbol, name, again = 0) {
    const box = document.getElementById("vsInfo"); if (!box) return;
    const my = ++seq; if (!again) box.innerHTML = '<p class="hint">Loading company details, news and who is buying…</p>';
    try {
      const r = await fetch(`/api/stock/info?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(name || "")}`, { credentials: "same-origin" }), d = await r.json();
      if (my !== seq || !document.getElementById("vsInfo")) return;
      if (!r.ok) throw new Error(d.message || `HTTP ${r.status}`);
      render(box, d);
      if (d.pending?.length && again < 3) setTimeout(() => { if (my === seq) load(symbol, name, again + 1); }, 4000);
    } catch (e) { if (my === seq) box.innerHTML = `<p class="hint">Company details unavailable: ${esc(e.message)}</p>`; }
  }
  function render(box, d) {
    const I = d.institutions, P = d.pressure, waiting = p => d.pending?.includes(p) ? '<p class="hint">Fetching…</p>' : "";
    const about = d.about || d.keyPoints.length ? `<p>${esc(d.about || "")}</p>${d.keyPoints.length ? `<details class="si-more"><summary>Key points</summary><ul>${d.keyPoints.map(k => `<li>${esc(k)}</li>`).join("")}</ul></details>` : ""}`
      : d.errors?.screener ? `<p class="hint">Not available right now (${esc(d.errors.screener)}).</p>` : waiting("screener") || '<p class="hint">No description found.</p>';
    const orders = d.orders.length ? `<ul class="si-list">${d.orders.map(o => `<li><b>${esc(day(o.day))}</b>${fin(o.valueCr) ? ` <span class="chip v-under">₹${o.valueCr.toLocaleString("en-IN")} Cr</span>` : ""} ${esc(o.text.slice(0, 220))}${o.text.length > 220 ? "…" : ""}${safeUrl(o.file) ? ` <a href="${safeUrl(o.file)}" target="_blank" rel="noopener">filing</a>` : ""}</li>`).join("")}</ul>` : "";
    const filings = d.filings.length ? `<ul class="si-list">${d.filings.map(f => `<li${f.order ? ' class="si-order"' : ""}><b>${esc(day(f.date))}</b> ${f.order ? "📦 " : ""}${esc(f.subject)}${f.text ? `<div class="hint">${esc(f.text)}</div>` : ""}${safeUrl(f.url) ? ` <a href="${safeUrl(f.url)}" target="_blank" rel="noopener">PDF</a>` : ""}</li>`).join("")}</ul>` : d.errors?.ann ? `<p class="hint">NSE filings not available right now (${esc(d.errors.ann)}).</p>` : waiting("ann") || '<p class="hint">No filings in the last year.</p>';
    const news = d.news.length ? `<ul class="si-list">${d.news.map(n => `<li>${safeUrl(n.url) ? `<a href="${safeUrl(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a>` : esc(n.title)} <span class="hint">${esc(n.source || "")}${n.date ? ` · ${esc(ago(n.date))}` : ""}</span></li>`).join("")}</ul>` : d.errors?.news ? `<p class="hint">News not available right now (${esc(d.errors.news)}).</p>` : waiting("news") || '<p class="hint">No recent news found.</p>';
    const S = d.shareholding, rowsOf = [["promoters", "Promoters"], ["fiis", "FIIs"], ["diis", "DIIs"], ["government", "Government"], ["public", "Public"]].filter(([k]) => S?.[k]?.some(fin));
    const qs = S ? S.quarters.slice(-6) : [];
    const shpTable = S ? `<div class="table-wrap"><table class="si-shp"><thead><tr><th>Holder</th>${qs.map(q => `<th class="num">${esc(q)}</th>`).join("")}<th class="num">Last quarter</th><th class="num">1 year</th></tr></thead><tbody>${rowsOf.map(([k, l]) => { const a = S[k].slice(-6), all = S[k], q = all.length >= 2 && fin(all.at(-1)) && fin(all.at(-2)) ? Math.round((all.at(-1) - all.at(-2)) * 100) / 100 : null, y = all.length >= 5 && fin(all.at(-1)) && fin(all.at(-5)) ? Math.round((all.at(-1) - all.at(-5)) * 100) / 100 : null; return `<tr><td><b>${l}</b></td>${a.map(v => `<td class="num">${fin(v) ? `${v}%` : "—"}</td>`).join("")}<td class="num">${chg(q)}</td><td class="num">${chg(y)}</td></tr>`; }).join("")}</tbody></table></div>` : d.errors?.screener ? "" : waiting("screener");
    const funds = d.funds.length ? `<p class="si-sub">Mutual funds holding it <span class="hint">from the ${d.fundLibrary} fund portfolio${d.fundLibrary === 1 ? "" : "s"} in your Fund X-ray library</span></p><ul class="si-funds">${d.funds.map(f => `<li><span>${esc(f.fund)}</span><b>${f.weight}%</b>${f.asOf ? `<small>${esc(f.asOf)}</small>` : ""}</li>`).join("")}</ul>` : `<p class="hint">${d.fundLibrary ? `None of the ${d.fundLibrary} fund portfolios in your Fund X-ray library hold it.` : "Add fund portfolios in Mutual funds → X-ray to see which funds hold it."} The shareholding table shows the totals for all mutual funds and insurers (DIIs) and foreign investors (FIIs).</p>`;
    const inst = `${I?.verdict ? `<p class="bk-act ${I.verdict.tone}">${I.verdict.tone === "warn" ? "⚠️" : I.verdict.tone === "ok" ? "✅" : "💡"} ${esc(I.verdict.text)} <span class="hint">(${esc(I.quarter || "")})</span></p>` : ""}${(I?.lines || []).map(l => `<p class="si-line">${esc(l)}</p>`).join("")}${shpTable}${funds}`;
    const press = P ? `<p class="bk-act ${P.tone}"><b>${esc(P.label)}</b></p><div class="si-press">${P.signs.length ? `<div><h5>Selling signs</h5><ul>${P.signs.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}${P.plus.length ? `<div><h5>Buying signs</h5><ul>${P.plus.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}</div><p class="vs-fine">From daily prices and volumes: moving averages, heavy-volume up / down days in the last 5 weeks, 3-month strength against Nifty, and the institutions' last quarterly change. Exchanges don't publish who is selling day to day; quarterly shareholding and bulk deals are the official record.</p>` : '<p class="hint">Needs at least 30 days of saved prices (they build up from the daily close).</p>';
    box.innerHTML = `<section class="si-sec"><h3>🏢 What ${esc(d.name)} does${d.sector ? ` <span class="hint">${esc(d.sector)}</span>` : ""}</h3>${about}</section>
      <section class="si-sec"><h3>📦 Orders and filings</h3>${orders ? `<p class="si-sub">Order wins (last year)</p>${orders}` : ""}<p class="si-sub">Recent NSE filings</p>${filings}</section>
      <section class="si-sec"><h3>📰 Latest news</h3>${news}</section>
      <section class="si-sec"><h3>🏦 Are FIIs and DIIs buying?</h3>${inst}</section>
      <section class="si-sec"><h3>⚖️ Buying or selling pressure</h3>${press}</section>
      <p class="vs-fine">Sources: Screener (about, shareholding${d.sources.screener ? `, ${ago(new Date(d.sources.screener).toISOString())}` : ""}), NSE announcements, Google News, your Fund X-ray library. Public data, shared by all logins.</p>`;
  }
  window.loadStockInfo = load;
})();
