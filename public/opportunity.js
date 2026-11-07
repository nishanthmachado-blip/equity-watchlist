// Opportunity fund screen: how far Nifty is below its high, the buying steps (how much at −10 / −15 / −20 %), what to
// invest now and where, and a log of what you put in. Reads /api/opportunity. Loaded on demand (app.js LAZY_VIEWS).
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const fin = v => Number.isFinite(v);
  const inr = v => (fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—");
  const amt = v => (!fin(v) ? "—" : v >= 1e7 ? `₹${+(v / 1e7).toFixed(2)} Cr` : v >= 1e5 ? `₹${+(v / 1e5).toFixed(2)} L` : inr(v));
  const day = d => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");
  const parseAmt = t => { const m = String(t ?? "").replace(/[,₹\s]/g, "").toLowerCase().match(/^(\d+(?:\.\d+)?)(cr|crore|l|lakh|lac|k)?$/); if (!m) return t === "" ? "" : NaN; const x = Number(m[1]), u = m[2] || ""; return Math.round(x * (u.startsWith("c") ? 1e7 : u.startsWith("l") ? 1e5 : u === "k" ? 1e3 : 1)); };
  let d = null;
  const api = async (path, body) => { const r = await fetch(path, body === undefined ? { credentials: "same-origin" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j; };
  async function load() { try { d = await api("/api/opportunity"); render(); } catch (e) { $("#opBody").innerHTML = `<p class="hint">Could not load: ${esc(e.message)}</p>`; } }
  async function post(op, body) { try { d = await api(`/api/opportunity/${op}`, body); render(); if (d.notice) window.toast?.(esc(d.notice), { kind: "ok", ms: 2500 }); return true; } catch (e) { window.toast?.(esc(e.message), { kind: "bad" }); return false; } }
  function render() {
    const N = d.nifty, P = d.plan, maxOff = Math.max(25, ...d.tiers.map(t => t.off + 5));
    const gauge = N ? `<div class="op-gauge"><div class="op-track">${d.tiers.map(t => `<i class="op-mark${t.reached ? " hit" : ""}" style="left:${t.off / maxOff * 100}%"><b>−${t.off}%</b></i>`).join("")}<span class="op-now" style="left:${Math.min(100, N.off / maxOff * 100)}%"><em>now −${N.off}%</em></span></div></div>` : "";
    const head = `<section class="report-card op-head"><div class="op-big"><span>Nifty below its 1-year high</span><strong class="${N && N.off >= (d.tiers[0]?.off || 10) ? "pl-dn" : ""}">${N ? `${N.off}%` : "—"}</strong><small>${N ? `NIFTYBEES ${inr(N.price)}${N.live ? " (live)" : " (last close)"} · high ${inr(N.high)}` : "Needs the daily swing scan"}</small></div>
      <div class="op-big"><span>Opportunity fund</span><strong>${amt(d.pot)}</strong><small>${d.pot !== null ? `${amt(d.deployed)} invested this cycle · ${amt(d.left)} left` : "not set yet"}</small></div>
      <div class="op-big ${d.due > 0 ? "due" : ""}"><span>Invest now</span><strong>${d.due > 0 ? amt(d.due) : "Nothing"}</strong><small>${d.due > 0 ? "a step has been reached" : d.next ? `next step at −${d.next.off}% (${d.next.away} pts away)` : "all steps reached"}</small></div>${gauge}</section>`;
    const tips = d.tips.map(t => `<p class="bk-act ${t.tone}">${t.tone === "warn" ? "⚠️" : t.tone === "ok" ? "✅" : "💡"} ${esc(t.text)}</p>`).join("");
    const steps = `<section class="report-card"><h3>🪜 Buying steps <span class="hint">counted from ${d.cycleStart ? day(d.cycleStart) : "today"}; they reset when Nifty is back within 3% of its high</span></h3>
      <div class="table-wrap"><table class="op-table"><thead><tr><th>Step</th><th class="num">Nifty fall</th><th class="num">NIFTYBEES at</th><th class="num">Share</th><th class="num">Amount</th><th>Status</th></tr></thead><tbody>
      ${d.tiers.map((t, i) => `<tr class="${t.reached ? "op-hit" : ""}"><td><b>${i + 1}</b></td><td class="num">−${t.off}%</td><td class="num">${t.level ? inr(t.level) : "—"}</td><td class="num">${t.share}%</td><td class="num"><b>${amt(t.amount)}</b></td><td>${t.reached ? `✅ reached${t.firedOn ? ` ${day(t.firedOn)}` : ""}` : `${t.away} pts away`}</td></tr>`).join("")}</tbody></table></div></section>`;
    const deploy = d.deploy.length ? `<section class="report-card op-deploy"><h3>💸 Put ${amt(d.due)} to work <span class="hint">${P.core}% core fund, the rest across the best long-term buys from What to do now</span></h3>
      <ul class="op-list">${d.deploy.map((x, i) => `<li><div><b>${esc(x.where)}</b>${x.symbol ? ` <a href="#" data-sym="${esc(x.symbol)}" class="hint">${esc(x.symbol)}</a>` : ""}<div class="hint">${esc(x.why || "")}${fin(x.price) ? ` · now ${inr(x.price)}${fin(x.zoneHigh) ? `, buy zone up to ${inr(x.zoneHigh)}` : ""}` : ""}</div></div><strong>${amt(x.amount)}</strong><button type="button" class="ghost" data-dep="${i}">✓ Invested</button></li>`).join("")}</ul></section>` : "";
    const log = `<section class="report-card"><div class="nw-head"><h3>🧾 What you put in</h3><button type="button" class="ghost" data-op="add">+ Record</button></div>${d.deployments.length ? `<div class="table-wrap"><table class="op-table"><thead><tr><th>Date</th><th>Into</th><th class="num">Amount</th><th>Note</th><th></th></tr></thead><tbody>${d.deployments.map(x => `<tr${d.cycleStart && x.date < d.cycleStart ? ' class="op-old"' : ""}><td>${esc(day(x.date))}</td><td>${esc(x.where)}</td><td class="num">${inr(x.amount)}</td><td class="hint">${esc(x.note || "")}</td><td><button type="button" class="ghost" data-deldep="${esc(x.id)}" aria-label="Remove">✕</button></td></tr>`).join("")}</tbody></table></div>` : '<p class="hint">Nothing yet. When a step is reached, tick ✓ Invested on each line above (or record it here).</p>'}</section>`;
    const settings = `<details class="report-card op-set"${d.pot === null ? " open" : ""}><summary><b>⚙ Fund settings</b> <span class="hint">${amt(d.pot)} · steps ${P.tiers.map(t => `−${t.off}% (${t.share}%)`).join(", ")} · ${P.core}% to ${esc(P.coreName)} · alerts ${P.alerts ? "on" : "off"}</span></summary>
      <div class="op-form"><label class="ui-field"><span>Kept for market falls (₹)</span><input class="ui-input" name="pot" inputmode="decimal" value="${d.pot ?? ""}" placeholder="e.g. 10L"></label>
        <label class="ui-field"><span>Steps: fall % = share % (one per line)</span><textarea class="ui-input" name="tiers" rows="3">${P.tiers.map(t => `${t.off} = ${t.share}`).join("\n")}</textarea></label>
        <label class="ui-field"><span>Share to the core fund (%)</span><input class="ui-input" name="core" inputmode="numeric" value="${P.core}"></label>
        <label class="ui-field"><span>Core fund</span><input class="ui-input" name="coreName" value="${esc(P.coreName)}"></label>
        <label class="ui-field"><span>Stocks to split the rest across</span><input class="ui-input" name="picks" inputmode="numeric" value="${P.picks}"></label>
        <label class="ui-opt"><input type="checkbox" name="alerts"${P.alerts ? " checked" : ""}><span><b>Alert me</b><small>A notification (and Telegram, if set up) when a step is reached</small></span></label></div>
      <div class="op-btns"><button type="button" class="primary" data-op="save">Save</button><button type="button" class="ghost" data-op="cycle">Start a new cycle</button></div></details>`;
    const note = `<p class="vs-fine">Why it works: falls of 10–20% come around most years, and money put in near them has usually done far better than money put in at highs. A plan written down before the fall is what lets you buy when the news feels worst. Keep the fund in an arbitrage or liquid fund, refill it from swing profits or part of your monthly surplus, and keep your SIPs going either way. Rule-based, not advice.</p>`;
    $("#opBody").innerHTML = head + tips + deploy + steps + settings + log + note;
  }
  async function record(pref = {}) {
    const out = await window.ui.dialog({ title: "Record an investment", icon: "🧾", okText: "Save",
      bodyHtml: `<div class="nw-form"><label class="ui-field"><span>Into</span><input class="ui-input" name="where" value="${esc(pref.where || "")}"></label><label class="ui-field"><span>Amount (₹)</span><input class="ui-input" name="amount" inputmode="decimal" value="${pref.amount || ""}"></label><label class="ui-field"><span>Date</span><input class="ui-input" type="date" name="date" value="${d.today}" max="${d.today}"></label><label class="ui-field"><span>Note</span><input class="ui-input" name="note"></label></div>`,
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; const a = parseAmt(v("amount")); if (!(a > 0)) throw new Error("Enter the amount."); return { where: v("where"), amount: a, date: v("date"), note: v("note") }; } });
    if (out) post("deploy", out);
  }
  const init = () => {
    const v = $("#opView"); if (!v) return;
    v.addEventListener("click", async e => {
      if (e.target.closest("#opReload")) return load();
      const s = e.target.closest("[data-sym]"); if (s) { e.preventDefault(); window.openStockSheet?.(s.dataset.sym, { back: "Opportunity fund" }); return; }
      const dep = e.target.closest("[data-dep]"); if (dep) { const x = d.deploy[+dep.dataset.dep]; return record({ where: x.where, amount: x.amount }); }
      const del = e.target.closest("[data-deldep]"); if (del) return post("deploy-delete", { id: del.dataset.deldep });
      const op = e.target.closest("[data-op]")?.dataset.op;
      if (op === "add") return record();
      if (op === "cycle") { if (await window.ui.confirm({ title: "Start a new cycle?", message: "Steps and amounts count again from today. Use this after the market has recovered, or after you refilled the fund.", okText: "Start" })) post("new-cycle", {}); return; }
      if (op === "save") {
        const f = $("#opBody .op-set"), val = n => f.querySelector(`[name=${n}]`);
        const pot = parseAmt(val("pot").value.trim()); if (Number.isNaN(pot)) { window.toast?.("Enter an amount like 10L or 1000000.", { kind: "bad" }); return; }
        const tiers = val("tiers").value.split(/\n+/).map(l => l.match(/(\d+(?:\.\d+)?)\s*%?\s*[=:,]\s*(\d+(?:\.\d+)?)/)).filter(Boolean).map(m => ({ off: +m[1], share: +m[2] }));
        post("save", { plan: { pot, tiers, core: val("core").value, coreName: val("coreName").value, picks: val("picks").value, alerts: val("alerts").checked } });
      }
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.opportunity = () => load();
})();
