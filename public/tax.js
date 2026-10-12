// Tax view: long- vs short-term gains on what you hold (from your Zerodha Console tradebook, FIFO), this year's realised
// gains, and three ideas: use the ₹1.25 lakh long-term exemption, wait a few days for long-term rates, book losses.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  let tx = null, open = new Set();
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  };
  const inr = v => Number.isFinite(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—";
  const sgn = v => !Number.isFinite(v) || v === 0 ? (v === 0 ? "₹0" : "—") : `${v > 0 ? "+" : "−"}₹${Math.abs(Math.round(v)).toLocaleString("en-IN")}`;
  const cls = v => v > 0 ? "buy" : v < 0 ? "avoid" : "";
  const d = s => s ? new Date(`${s}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "unknown date";

  function render() {
    const t = tx, R = t.realised, U = t.unrealised, rules = t.rules;
    const has = t.tradeCount > 0;
    $("#txEmpty").hidden = has; $("#txBody").hidden = !has;
    $("#txImports").innerHTML = t.imports.length ? `<ul class="nw-acc">${t.imports.slice(-6).reverse().map(i => `<li>${esc(i.file)}: ${i.rows} trades (${esc(i.from)} → ${esc(i.to)}), ${i.added} new · ${new Date(i.at).toLocaleDateString("en-IN")}</li>`).join("")}</ul><p class="hint">${t.tradeCount} trades on file. Importing the same file again is safe: duplicates are ignored.</p>` : "";
    if (!has) return;
    $("#txCards").innerHTML = `
      <div><span>${esc(t.fy.label)} realised · short term</span><strong class="${cls(R.netSt)}">${sgn(R.netSt)}</strong><small>gains ${inr(R.stGain)} · losses ${inr(R.stLoss)}</small></div>
      <div><span>${esc(t.fy.label)} realised · long term</span><strong class="${cls(R.netLt)}">${sgn(R.netLt)}</strong><small>gains ${inr(R.ltGain)} · losses ${inr(R.ltLoss)}</small></div>
      <div><span>₹1.25 L exemption left this year</span><strong>${inr(R.exemptLeft)}</strong><small>${inr(R.exemptUsed)} used</small></div>
      <div><span>Estimated tax so far (${esc(t.fy.label)})</span><strong>${inr(R.tax)}</strong><small>before surcharge & cess</small></div>
      <div><span>Unrealised · long term</span><strong class="${cls(U.lt)}">${sgn(U.lt)}</strong><small>taxed ${rules.ltRate * 100}% above the exemption if sold</small></div>
      <div><span>Unrealised · short term</span><strong class="${cls(U.st)}">${sgn(U.st)}</strong><small>taxed ${rules.stRate * 100}% if sold now</small></div>`;
    const I = t.ideas;
    $("#txIdeaHarvest").innerHTML = I.harvestGains.length ? `<p>Sell and buy back these long-term lots to book <b>${inr(I.harvestGainsTotal)}</b> of gains tax-free this year. That lifts your purchase price, so about <b>${inr(I.taxSavedLater)}</b> less tax when you sell for real later.</p>
      <ul class="tx-list">${I.harvestGains.map(h => `<li><b>${esc(h.symbol || h.name)}</b> · ${h.kind === "mf" ? `${h.qty} units` : `${h.qty} shares`} (bought ${d(h.boughtOn)}) <span class="buy">+${inr(h.gain)}</span></li>`).join("")}</ul><p class="hint">Sell, then buy back on the next trading day: a same-day sell and buy of the same stock can be netted off as intraday. Charges (STT, stamp duty, DP fee) apply on both legs, and the price can move overnight. Mutual funds: redeem, then reinvest once the money arrives (exit loads may apply).</p>`
      : R.exemptLeft <= 0 ? `<p class="hint">The ₹1.25 lakh exemption for ${esc(t.fy.label)} is already used.</p>` : `<p class="hint">No long-term gains to harvest right now.</p>`;
    $("#txIdeaWait").innerHTML = I.waitToSell.length ? `<ul class="tx-list">${I.waitToSell.slice(0, 10).map(w => `<li><b>${esc(w.symbol || w.name)}</b>: whole position long term on <b>${d(w.date)}</b> (${w.days} day${w.days === 1 ? "" : "s"}) · gain ${inr(w.gain)} · selling after that saves about <span class="buy">${inr(w.taxSaved)}</span></li>`).join("")}</ul>` : `<p class="hint">No profitable lot turns long term in the next 60 days.</p>`;
    $("#txIdeaLoss").innerHTML = I.harvestLosses.length ? `<p>Your oldest shares in these are at a loss (sales always use the oldest shares first). Booking them offsets gains this year (short-term losses offset any gain; long-term losses only long-term gains). Unused losses carry forward 8 years if you file your return on time.</p><ul class="tx-list">${I.harvestLosses.slice(0, 10).map(l => `<li><b>${esc(l.symbol || l.name)}</b> · ${l.qty} (bought ${d(l.boughtOn)}, ${l.long ? "long" : "short"} term) <span class="avoid">−${inr(l.loss)}</span></li>`).join("")}</ul>` : `<p class="hint">No lots are at a loss.</p>`;
    $("#txRows").innerHTML = t.rows.map(r => {
      const next = r.lots.filter(l => l.becomesLong).sort((a, b) => a.becomesLong.localeCompare(b.becomesLong))[0];
      const isOpen = open.has(r.key);
      return `<tr data-key="${esc(r.key)}" class="${isOpen ? "open" : ""}"><td><div class="company">${esc(r.name || r.symbol)}</div><div class="ticker">${esc(r.symbol || r.isin || "")}${r.kind === "mf" ? " · mutual fund" : ""} · ${r.lots.length} lot${r.lots.length === 1 ? "" : "s"}${r.mismatch ? ` · <span class="nw-both" title="${esc(r.mismatch)}">⚠ ${esc(r.mismatch)}</span>` : ""}</div></td>
        <td class="num">${r.kind === "mf" ? r.qty.toFixed(3) : r.qty}</td><td class="num">${inr(r.value)}</td>
        <td class="num ${cls(r.ltGain)}">${r.ltGain ? sgn(r.ltGain) : "—"}</td><td class="num ${cls(r.stGain)}">${r.stGain ? sgn(r.stGain) : "—"}</td><td class="num">${r.unknownGain ? sgn(r.unknownGain) : "—"}</td>
        <td>${next ? `${d(next.becomesLong)} <small class="hint">(${next.daysToLong} d)</small>` : r.lots.every(l => l.long) ? "<span class='buy'>all long term</span>" : "—"}</td></tr>
        ${isOpen ? `<tr class="tx-lots"><td colspan="7"><table><thead><tr><th>Bought</th><th class="num">Qty</th><th class="num">Buy price</th><th class="num">Gain now</th><th>Status</th></tr></thead><tbody>${r.lots.map(l => `<tr><td>${d(l.date)}</td><td class="num">${l.qty}</td><td class="num">${l.price === null ? "—" : `₹${l.price}`}</td><td class="num ${cls(l.gain)}">${sgn(l.gain)}</td><td>${l.unknown ? "no tradebook record: date unknown" : l.long ? "long term" : `short term → long term on ${d(l.becomesLong)}`}</td></tr>`).join("")}</tbody></table></td></tr>` : ""}`;
    }).join("") || `<tr><td colspan="7" class="nw-empty-row">Sync your holdings to see gains per stock.</td></tr>`;
    $("#txWarn").innerHTML = [U.mismatches ? `${U.mismatches} holding${U.mismatches === 1 ? "" : "s"} don't match the tradebook (bonus, split, transfer-in, another broker, or an earlier year not imported). Their unmatched shares are shown as "date unknown".` : "", R.unmatchedSells ? `${R.unmatchedSells} sell${R.unmatchedSells === 1 ? "" : "s"} this year had no matching buy: import older tradebook years for accurate figures.` : ""].filter(Boolean).map(x => `<p class="tx-warn">⚠ ${x}</p>`).join("");
  }
  async function load() { try { tx = await api("/api/tax"); render(); } catch (e) { $("#txStatus").textContent = e.message; } }
  window.openTax = load;
  async function importFile(f) {
    if (!f) return; if (f.size > 20e6) { $("#txStatus").textContent = "File is larger than 20 MB."; return; }
    const st = $("#txStatus"); st.textContent = `Reading ${f.name}…`;
    const data = await new Promise((ok, no) => { const rd = new FileReader(); rd.onload = () => ok(String(rd.result).split(",")[1]); rd.onerror = no; rd.readAsDataURL(f); });
    try { tx = await api("/api/tax/import", { filename: f.name, data }); render(); st.textContent = `${f.name}: ${tx.imported.rows} trades read, ${tx.imported.added} new${tx.imported.skipped?.fno ? `, ${tx.imported.skipped.fno} F&O rows skipped` : ""}.`; window.toast?.(`✓ Tradebook imported: ${tx.imported.added} new trades.`, { kind: "ok" }); }
    catch (e) { st.textContent = e.message; }
  }
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#taxView")) return;
    $("#viewTax").onclick = () => setView("tax");
    for (const id of ["#txPick", "#txPick2"]) $(id).onclick = () => $("#txFile").click();
    $("#txFile").onchange = e => { importFile(e.target.files[0]); e.target.value = ""; };
    const drop = $("#taxView");
    drop.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) { e.preventDefault(); drop.classList.add("tx-drag"); } });
    drop.addEventListener("dragleave", () => drop.classList.remove("tx-drag"));
    drop.addEventListener("drop", e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove("tx-drag"); importFile(e.dataTransfer.files[0]); });
    $("#txClear").onclick = async () => { if (await window.ui.confirm({ title: "Clear the imported tradebook?", message: "Your holdings are not touched. Import the files again to bring the lots back.", okText: "Clear", danger: true })) { tx = await api("/api/tax/clear", {}); render(); } };
    $("#txRows").addEventListener("click", e => { const tr = e.target.closest("tr[data-key]"); if (!tr) return; const k = tr.dataset.key; open.has(k) ? open.delete(k) : open.add(k); render(); });
  });
})();
