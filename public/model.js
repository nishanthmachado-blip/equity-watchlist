// Model portfolio tab: risk profile + style + goal → asset mix and a weighted stock basket.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  let state = { profile: "balanced", style: "blend" }, last = null, opts = null;
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  };
  const inr = v => Number.isFinite(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—";
  const short = v => !Number.isFinite(v) ? "—" : v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${(v / 1e5).toFixed(1)} L` : inr(v);
  const STYLE_ICO = { dividend: "💰", growth: "🚀", value: "🏷️", blend: "⚖️" }, PROF_ICO = { conservative: "🛡️", balanced: "⚖️", aggressive: "🔥" };
  const COLORS = { equity: "var(--nw-equity)", debt: "var(--nw-debt)", gold: "var(--nw-gold)" };
  const INSTR = { equity: "The stock basket below (and/or a Nifty 50 index fund)", debt: "EPF/PPF you already have, FDs, short-duration or corporate-bond debt funds", gold: "Gold ETF / gold fund (SGB if available)" };

  function drawForm() {
    $("#mdProfile").innerHTML = Object.entries(opts.profiles).map(([k, p]) => `<button type="button" role="radio" aria-checked="${state.profile === k}" class="${state.profile === k ? "active" : ""}" data-profile="${k}">${PROF_ICO[k]} ${esc(p.label)}<small>${p.mix.equity}/${p.mix.debt}/${p.mix.gold} equity/debt/gold</small></button>`).join("");
    $("#mdStyle").innerHTML = Object.entries(opts.styles).map(([k, s]) => `<button type="button" role="radio" aria-checked="${state.style === k}" class="${state.style === k ? "active" : ""}" data-style="${k}" title="${esc(s.blurb)}">${STYLE_ICO[k]} ${esc(s.label)}<small>${esc(s.blurb)}</small></button>`).join("");
    const sel = $("#mdGoal"), cur = sel.value;
    sel.innerHTML = `<option value="">No specific goal</option>${opts.goals.map(g => `<option value="${esc(g.id)}">${esc(g.name)} · ${short(g.target)} in ${g.years} yrs</option>`).join("")}`;
    if (cur && opts.goals.some(g => g.id === cur)) sel.value = cur;
    $("#mdYearsWrap").hidden = !!sel.value;
  }
  function bar(mix) { return `<div class="nw-bar">${["equity", "debt", "gold"].map(k => `<i style="width:${mix[k]}%;background:${COLORS[k]}" title="${k} ${mix[k]}%"></i>`).join("")}</div>`; }
  function render() {
    const m = last; $("#mdOut").hidden = false;
    $("#mdMix").innerHTML = `
      <div class="md-mixrow"><span>Target · ${esc(m.profileLabel)}${m.years ? ` · ${m.years} yrs` : ""}</span>${bar(m.mix)}</div>
      ${m.current ? `<div class="md-mixrow"><span>You today (from Net worth, ${short(m.current.total)})</span>${bar(m.current)}</div>` : ""}
      <table class="md-mixtable"><tbody>${["equity", "debt", "gold"].map(k => `<tr><td><i style="background:${COLORS[k]}"></i>${k[0].toUpperCase() + k.slice(1)}</td><td class="num"><b>${m.mix[k]}%</b>${m.current ? ` <small class="${Math.abs(m.current[k] - m.mix[k]) >= 10 ? "avoid" : "hint"}">now ${m.current[k]}%</small>` : ""}</td><td class="num">${m.split ? short(m.split[k]) : ""}</td><td class="hint">${INSTR[k]}</td></tr>`).join("")}</tbody></table>
      ${m.mix.notes.map(n => `<p class="tx-warn">⏳ ${esc(n)}</p>`).join("")}
      ${m.current && Math.abs(m.current.equity - m.mix.equity) >= 10 ? `<p class="hint">Your equity share is ${m.current.equity > m.mix.equity ? "above" : "below"} the target by ${Math.abs(m.current.equity - m.mix.equity)} points. Rebalance mainly through new money rather than selling (selling can trigger tax).</p>` : ""}
      <p class="hint">Rough long-run expectation for this mix: ~${opts.profiles[m.profile].expected}% a year before tax, with bigger swings the more equity it holds.</p>`;
    const s = m.stats;
    $("#mdStats").innerHTML = `<div><span>Stocks</span><strong>${s.count}</strong></div><div><span>Avg quality</span><strong>${s.avgQuality ?? "—"}<small>/100</small></strong></div><div><span>Basket P/E</span><strong>${s.pe ?? "—"}</strong></div>
      <div><span>Dividend yield</span><strong>${s.yield !== null ? `${s.yield}%` : "—"}</strong></div><div><span>3-yr growth (wtd)</span><strong>${s.growth !== null ? `${s.growth}%` : "—"}</strong></div><div><span>In buy zone now</span><strong>${s.inZone}</strong></div>`;
    $("#mdSecs").innerHTML = `<p class="md-sub">Sectors</p><div class="md-chips">${m.sectors.map(x => `<span>${esc(x.sector)} <b>${x.weight}%</b></span>`).join("")}</div><p class="md-sub">Size</p><div class="md-chips">${m.capMix.map(x => `<span>${esc(x.cap)} cap <b>${x.weight}%</b></span>`).join("")}</div>`;
    $("#mdWarn").innerHTML = (m.dividendPending ? `<p class="tx-warn">⏳ Dividend history is missing for ${m.dividendPending} valued stock${m.dividendPending === 1 ? "" : "s"}; fetching it now (about a second each). The basket refreshes on its own.</p>` : "") + m.warnings.map(w => `<p class="tx-warn">⚠ ${esc(w)}</p>`).join("");
    clearTimeout(window.__mdDiv); if (m.dividendPending && m.style === "dividend" && !$("#modelView").hidden && (render.tries = (render.tries || 0) + 1) <= 6) window.__mdDiv = setTimeout(build, 25000); else if (!m.dividendPending) render.tries = 0;
    $("#mdBasketNote").textContent = `${m.styleLabel} · ${m.screened.passed} of ${m.screened.candidates} valued stocks passed the filters${s.alreadyHeld ? ` · ${s.alreadyHeld} you already own` : ""}`;
    $("#mdRows").innerHTML = m.rows.length ? m.rows.map((r, i) => `<tr data-sym="${esc(r.symbol)}">
      <td class="num">${i + 1}</td><td><div class="company">${esc(r.company || r.symbol)}${r.held ? ' <span class="acct-tag">held</span>' : ""}</div><div class="ticker">${esc(r.symbol)} · ${esc(r.sector)}${r.cap ? ` · ${esc(r.cap)} cap` : ""} · ₹${r.price}</div></td>
      <td class="num"><b>${r.weight}%</b></td><td class="num">${r.amount ? inr(r.amount) : "—"}</td><td class="num">${r.shares ?? "—"}</td>
      <td><span class="chip ${esc(r.verdictCls || "v-none")}">${esc(r.verdict || "—")}</span></td>
      <td><span class="md-how ${r.how === "Buy now" ? "now" : r.how.startsWith("Buy in") ? "parts" : "wait"}">${esc(r.how)}</span>${r.zoneLow ? `<div class="ticker">zone ₹${r.zoneLow}–₹${r.zoneHigh}</div>` : ""}</td>
      <td class="md-why">${esc(r.why.join(" · "))}${r.flags.length ? `<div class="avoid">${esc(r.flags.join(" · "))}</div>` : ""}</td></tr>`).join("")
      : `<tr><td colspan="8" class="nw-empty-row">No stock passed the filters for this profile. Value more stocks first, or try Balanced / Aggressive.</td></tr>`;
    $("#mdRules").textContent = `Rules for ${m.profileLabel}: quality ≥ ${m.rules.minQuality}/100, borrowings ≤ ${m.rules.maxLeverage}× reserves, small caps ${m.rules.smallCaps}, at most ${m.rules.maxWeight}% in one stock and ${m.rules.sectorCap}% in one sector. Weights follow each stock's ${m.styleLabel.toLowerCase()} score. "Buy now" = price in the model's buy zone; otherwise buy in parts or on dips. Excluded: ${Object.entries(m.screened.excluded).filter(([, v]) => v).map(([k, v]) => `${v} on ${k}`).join(", ") || "none"}.`;
  }
  async function build() {
    const b = $("#mdBuild"), st = $("#mdStatus"); b.disabled = true; b.classList.add("is-loading"); st.textContent = "";
    try {
      last = await api("/api/model", { profile: state.profile, style: state.style, amount: $("#mdAmount").value, n: $("#mdN").value, goalId: $("#mdGoal").value || null, years: $("#mdYears").value });
      opts = last; render();
      try { localStorage.setItem("equity-model", JSON.stringify({ ...state, amount: $("#mdAmount").value, n: $("#mdN").value, goal: $("#mdGoal").value, years: $("#mdYears").value })); } catch {}
    } catch (e) { st.textContent = e.message; } finally { b.disabled = false; b.classList.remove("is-loading"); }
  }
  window.openModel = async () => {
    try {
      if (!opts) {
        try { const s = JSON.parse(localStorage.getItem("equity-model") || "null"); if (s) { state.profile = s.profile || state.profile; state.style = s.style || state.style; $("#mdAmount").value = s.amount || ""; $("#mdN").value = s.n || ""; $("#mdYears").value = s.years || ""; state.goal = s.goal; } } catch {}
        opts = await api(`/api/model?profile=${state.profile}&style=${state.style}`);
      }
      drawForm(); if (state.goal) { $("#mdGoal").value = state.goal; $("#mdYearsWrap").hidden = !!$("#mdGoal").value; state.goal = null; }
      if (!last) build();
    } catch (e) { $("#mdStatus").textContent = e.message; }
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#modelView")) return;
    $("#viewModel").onclick = () => setView("model");
    $("#mdProfile").addEventListener("click", e => { const b = e.target.closest("[data-profile]"); if (!b) return; state.profile = b.dataset.profile; drawForm(); build(); });
    $("#mdStyle").addEventListener("click", e => { const b = e.target.closest("[data-style]"); if (!b) return; state.style = b.dataset.style; drawForm(); build(); });
    $("#mdGoal").onchange = () => { $("#mdYearsWrap").hidden = !!$("#mdGoal").value; build(); };
    $("#mdBuild").onclick = build;
    for (const id of ["#mdAmount", "#mdYears"]) $(id).addEventListener("keydown", e => { if (e.key === "Enter") build(); });
    $("#mdN").onchange = build;
    $("#mdRows").addEventListener("click", e => { const tr = e.target.closest("tr[data-sym]"); if (tr) window.openStockSheet?.(tr.dataset.sym, { back: "Back to Model portfolio" }); });
    $("#mdSaveList").onclick = async () => {
      if (!last?.rows.length) return;
      const name = await window.ui.prompt({ title: "Save the basket as a watchlist", label: "Watchlist name", value: `Model · ${last.profileLabel} ${last.styleLabel}`.slice(0, 40), okText: "Save", icon: "⭐" });
      if (!name) return;
      try { await api("/api/lists/create", { name, symbols: last.rows.map(r => r.symbol) }); window.toast?.(`✓ Saved "${esc(name)}" with ${last.rows.length} stocks. Pick it from the Watchlist menu.`, { kind: "ok" }); window.loadLists?.(); }
      catch (e) { window.toast?.(esc(e.message), { kind: "warn" }); }
    };
    $("#mdCsv").onclick = () => {
      if (!last?.rows.length) return;
      const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
      const lines = [["Symbol", "Company", "Sector", "Cap", "Weight %", "Amount (₹)", "Approx shares", "Price", "Verdict", "How to buy", "Why"].map(q).join(","), ...last.rows.map(r => [r.symbol, r.company, r.sector, r.cap, r.weight, r.amount, r.shares, r.price, r.verdict, r.how, r.why.join("; ")].map(q).join(","))];
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); a.download = `model-portfolio-${last.profile}-${last.style}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
  });
})();
