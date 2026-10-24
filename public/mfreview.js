// Fund review: one call per mutual fund you hold (Build / Keep / Hold / Exit or switch / Review) with the reasons,
// overlap between your funds, bulk-buy zones on the NAV, funds that need your review and low-overlap ideas from the
// shared X-ray library. Reads /api/mf/review. Loaded the first time the screen opens. Not advice.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const amt = v => (!fin(v) ? "—" : v >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`);
  const pc = v => (fin(v) ? `${v > 0 ? "+" : ""}${v}%` : "—");
  const cls = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const V = { "Exit / switch": ["🚪", "fr-exit"], Review: ["🔎", "fr-review"], Build: ["📈", "fr-build"], "Hold (don't add)": ["✋", "fr-hold"], Keep: ["✅", "fr-keep"] };
  const TONE = { for: "rv-for", against: "rv-against", warn: "rv-warn", info: "rv-info" };
  let data = null, filt = "all", open = new Set(), timer = null;
  async function load() {
    clearTimeout(timer);
    try { const r = await fetch("/api/mf/review", { credentials: "same-origin" }); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).message || `HTTP ${r.status}`); data = await r.json(); render(); }
    catch (e) { $("#frBody").innerHTML = `<p class="hint">Could not review your funds: ${esc(e.message)}</p>`; }
    if (!$("#frView").hidden && data?.navPending) timer = setTimeout(load, 8000); // NAV histories still downloading
  }
  const ret = (s, b) => !s ? '<span class="hint">—</span>' : s.young ? '<span class="hint">under a year</span>' : ["ret1y", "ret3y", "ret5y"].map((k, i) => fin(s[k]) ? `<div><small>${["1y", "3y", "5y"][i]}</small> <b class="${b && fin(b[k]) ? cls(s[k] - b[k]) : ""}">${s[k]}%</b>${b && fin(b[k]) ? `<small class="hint"> vs ${b[k]}%</small>` : ""}</div>` : "").join("");
  function render() {
    const d = data, c = d.counts;
    if (!d.rows.length) { $("#frSum").innerHTML = ""; $("#frBody").innerHTML = '<p class="nw-empty-row">No mutual funds yet. Sync Zerodha Coin, import a CAS statement or add funds in <button type="button" class="linklike" data-go="mf">Mutual funds</button>.</p>'; $("#frNotes").innerHTML = ""; return; }
    const val = v => amt(d.rows.filter(r => r.verdict === v).reduce((a, r) => a + (r.value || 0), 0));
    $("#frSum").innerHTML = `<div class="fr-tiles">${Object.keys(V).filter(v => c[v]).map(v => `<button type="button" class="fr-tile ${V[v][1]}${filt === v ? " active" : ""}" data-f="${esc(v)}"><span>${V[v][0]} ${esc(v)}</span><strong>${c[v]}</strong><small>${val(v)}</small></button>`).join("")}</div>`;
    const bulk = d.bulkNow.length ? `<section class="report-card fr-card fr-bulk"><h3>💰 In a bulk-buy zone now</h3><ul>${d.bulkNow.map(b => `<li><b>${esc(b.name)}</b> NAV ₹${b.nav} is <b>${b.fromHigh}%</b> under its 52-week high ₹${b.high52}${b.zone === "strong" ? ' <span class="lt-sig lt-strong">🔥 strong</span>' : ""}</li>`).join("")}</ul><p class="hint">For funds the review says to build or keep: a good time for a lump sum on top of your SIP.</p></section>` : "";
    const rev = d.review.length ? `<section class="report-card fr-card"><h3>🔎 Needs your review <span class="hint">${d.review.length}</span></h3><ul>${d.review.map(x => `<li><b>${esc(x.name)}</b>: ${esc(x.why.join(", "))}</li>`).join("")}</ul></section>` : "";
    const ov = d.pairs.filter(p => p.pct >= 30).length ? `<section class="report-card fr-card"><h3>🔁 Overlap between your funds</h3><ul>${d.pairs.filter(p => p.pct >= 30).slice(0, 8).map(p => `<li><b class="${p.pct >= 60 ? "pl-dn" : ""}">${p.pct}%</b> ${esc(p.a)} ↔ ${esc(p.b)}</li>`).join("")}</ul><p class="hint">Share of the money in the same stocks (from the X-ray). 60%+ means the two funds largely do the same job.</p></section>` : "";
    const list = d.rows.filter(r => filt === "all" || r.verdict === filt);
    $("#frBody").innerHTML = `<div class="fr-cards">${bulk}${rev}${ov}</div>
      <div class="toolbar"><button type="button" class="pf-chip${filt === "all" ? " active" : ""}" data-f="all">All ${d.rows.length}</button><span class="hint">Click a fund for every reason</span></div>
      <div class="table-wrap"><table class="fr-table"><thead><tr><th>Fund</th><th>Call</th><th class="num">Value</th><th class="num">P/L</th><th>Returns <small class="hint">vs index</small></th><th class="num">From high</th><th>What to do</th></tr></thead><tbody>${list.map(r => {
        const op = open.has(r.key);
        return `<tr class="fr-row${op ? " open" : ""}" data-k="${esc(r.key)}"><td><div class="company">${esc(r.name)}</div><div class="ticker">${esc([r.category, r.benchLabel ? `vs ${r.benchLabel}` : "", fin(r.share) ? `${r.share}% of your funds` : ""].filter(Boolean).join(" · "))}</div></td>
          <td><span class="rv-verdict ${V[r.verdict][1]}">${V[r.verdict][0]} ${esc(r.verdict)}</span></td><td class="num">${amt(r.value)}</td><td class="num ${cls(r.pnlPct)}">${pc(r.pnlPct)}</td>
          <td class="fr-ret">${ret(r.stats, r.benchStats)}</td><td class="num">${r.stats && fin(r.stats.fromHigh) ? `<b class="${r.stats.fromHigh >= 10 ? "pl-up" : ""}">−${r.stats.fromHigh}%</b>` : "—"}</td>
          <td class="fr-lean">${esc(r.lean || "")}</td></tr>
          <tr class="fr-detail" data-for="${esc(r.key)}"${op ? "" : " hidden"}><td colspan="7"><ul class="rv-reasons">${r.reasons.map(x => `<li class="${TONE[x.tone] || ""}">${esc(x.text)}</li>`).join("")}</ul>${r.fundId ? `<div class="toolbar" style="margin:6px 0 0"><button type="button" class="ghost" data-xray="${esc(r.fundId)}">Open its X-ray</button><button type="button" class="ghost ai-btn" data-ask-ai="Fund review says ${esc(r.verdict)} for my mutual fund ${esc(r.name)}. Do you agree? Consider returns vs its index, overlap with my other funds and what it holds." data-ask-where="Fund review">✨ Ask AI</button></div>` : ""}</td></tr>`;
      }).join("")}</tbody></table></div>
      ${d.ideas.length ? `<section class="report-card fr-card fr-ideas"><h3>💡 Funds to consider <span class="hint">from the shared X-ray library, least like what you hold</span></h3><table class="sw-prev sw-jt"><thead><tr><th>Fund</th><th class="num">Overlap with your funds</th><th class="num">1y</th><th class="num">3y</th></tr></thead><tbody>${d.ideas.map(x => `<tr><td>${esc(x.name)}${x.index ? ' <span class="hint">index</span>' : ""}</td><td class="num">${x.overlapPct}%</td><td class="num">${pc(x.stats?.ret1y)}</td><td class="num">${pc(x.stats?.ret3y)}</td></tr>`).join("")}</tbody></table><p class="hint">Low overlap = it would add stocks you don't already own through your funds. Add more funds to the X-ray (Mutual fund X-ray → Add a fund) to widen this list.</p></section>` : ""}`;
    const notes = [...d.notes];
    if (d.navPending) notes.push(`Fetching NAV history for ${d.navPending} fund${d.navPending === 1 ? "" : "s"} (mfapi.in, public data): returns and buy zones fill in by themselves.`);
    if (d.noCode) notes.push(`${d.noCode} fund${d.noCode === 1 ? " has" : "s have"} no ISIN, so its NAV history can't be looked up.`);
    $("#frNotes").innerHTML = `${notes.map(n => `<p class="hint">${esc(n)}</p>`).join("")}<label class="ui-opt fr-alerts"><input type="checkbox" id="frAlerts"${d.alerts ? " checked" : ""}><span><b>Alert me when a fund I keep or build enters its bulk-buy zone</b><small>NAV 10% under its 52-week high (strong at 20%): bell, phone and the morning brief.</small></span></label>
      <p class="vs-fine">How the call is made: Exit / switch when a fund lags its index over 1 and 3 years by 3%+ a year, or is mostly a copy (60%+ overlap) of a better fund you hold, or is the weaker of two funds in the same category. Hold (don't add) when its stocks are mostly expensive or it overlaps heavily. Build when it beats its index and / or its stocks are in buy zones. Returns are compared with the index's price (dividends not included), so the bar is about 1% a year easier than the official TRI benchmark. Expense ratios and fund-manager changes are not checked. A screen to start your review, not advice.</p>`;
  }
  const init = () => {
    const v = $("#frView"); if (!v) return;
    v.addEventListener("click", async e => {
      const f = e.target.closest("[data-f]"); if (f) { filt = filt === f.dataset.f ? "all" : f.dataset.f; render(); return; }
      const x = e.target.closest("[data-xray]"); if (x && typeof setView === "function") { setView("funds"); window.openFundXray?.(x.dataset.xray); return; }
      const g = e.target.closest("[data-go]"); if (g && typeof setView === "function") { setView(g.dataset.go); return; }
      if (e.target.closest("#frReload")) { load(); return; }
      if (e.target.closest("button, a, input, label")) return;
      const row = e.target.closest("tr.fr-row"); if (row) { const k = row.dataset.k; if (open.has(k)) open.delete(k); else open.add(k); render(); }
    });
    v.addEventListener("change", async e => { if (e.target.id !== "frAlerts") return; try { await fetch("/api/mf/review/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ alerts: e.target.checked }) }); window.toast?.(e.target.checked ? "Fund buy-zone alerts on." : "Fund buy-zone alerts off.", { kind: "ok", ms: 2500 }); } catch { /* offline */ } });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init(); // loaded on demand (app.js LAZY_VIEWS)
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.fundreview = () => load();
})();
