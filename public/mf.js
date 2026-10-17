// Mutual funds screen: every fund in one table (Zerodha Coin / INDmoney sync, CAS statement import, added by hand),
// valued at the daily AMFI NAV, with invested, current value and P/L.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s), fin = Number.isFinite;
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || `HTTP ${r.status}`), { needPassword: j.needPassword }); return j;
  };
  const inr = v => !fin(v) ? "—" : Math.abs(v) >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : Math.abs(v) >= 1e5 ? `₹${(v / 1e5).toFixed(2)} L` : `₹${Math.round(v).toLocaleString("en-IN")}`;
  const full = v => fin(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—";
  const sg = v => !fin(v) ? "—" : `${v >= 0 ? "+" : "−"}${full(Math.abs(v))}`;
  const pl = v => (v > 0 ? "pl-up" : v < 0 ? "pl-dn" : "");
  const fileB64 = f => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => bad(new Error("Could not read the file.")); r.readAsDataURL(f); });
  const day = d => d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "";
  let mf = null;

  function render() {
    const v = mf; if (!v) return;
    const t = v.totals;
    $("#mfCards").innerHTML = v.funds.length ? `<div><span>Funds</span><strong>${t.count}</strong><small>${[...new Set(v.funds.map(f => f.accountLabel))].join(" · ")}</small></div><div><span>Invested</span><strong>${inr(t.invested)}</strong><small>funds with a cost</small></div><div><span>Current value</span><strong>${inr(t.value)}</strong><small>${v.amfiAt ? `AMFI NAV, checked ${new Date(v.amfiAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : "statement / sync NAV"}</small></div><div><span>P/L</span><strong class="${pl(t.pnl)}">${sg(t.pnl)}</strong><small>${t.invested ? `${(t.pnl / t.invested * 100).toFixed(1)}% on cost` : ""}</small></div>` : "";
    $("#mfDup").innerHTML = v.duplicates?.length ? `<p class="hint">${v.duplicates.length} imported fund${v.duplicates.length === 1 ? " is" : "s are"} also in a broker sync and counted once: ${v.duplicates.slice(0, 5).map(d => esc(d.name)).join(", ")}${v.duplicates.length > 5 ? "…" : ""}.</p>` : "";
    $("#mfRows").innerHTML = v.funds.length ? v.funds.map(f => {
      const pnlPct = fin(f.pnl) && f.invested ? (f.pnl / f.invested * 100).toFixed(1) : null, own = f.account === "import";
      return `<tr data-id="${esc(own ? f.id : "")}"><td><div class="company">${esc(f.name)}</div><div class="ticker">${esc(f.isin || "")}${f.folio ? ` · folio ${esc(f.folio)}` : ""}${/elss|tax saver/i.test(f.name) ? " · ELSS: 3-year lock-in per SIP" : ""}</div></td>
        <td class="num">${fin(f.units) ? f.units.toLocaleString("en-IN", { maximumFractionDigits: 3 }) : "—"}</td><td class="num">${fin(f.avgNav) ? f.avgNav.toFixed(2) : "—"}</td>
        <td class="num">${fin(f.nav) ? Number(f.nav).toFixed(2) : "—"}${f.navDate ? `<div class="ticker">${day(f.navDate)}${f.navSource === "AMFI" ? " · AMFI" : ""}</div>` : ""}</td>
        <td class="num">${full(f.invested)}</td><td class="num"><b>${full(f.value)}</b></td>
        <td class="num ${pl(f.pnl)}"><b>${sg(f.pnl)}</b>${pnlPct !== null ? `<div class="ticker">${pnlPct > 0 ? "+" : ""}${pnlPct}%</div>` : ""}</td>
        <td>${esc(f.accountLabel)}<div class="ticker">${f.source === "sync" ? "synced" : f.importedAt ? `updated ${day(f.importedAt)}` : ""}</div></td>
        <td class="sw-acts">${own ? `<button type="button" class="ghost" data-act="edit" title="Edit units / invested">✎</button><button type="button" class="ghost danger-text" data-act="del" title="Remove">✕</button>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="9" class="nw-empty-row">No funds yet. Import your CAS statement (covers every fund house), connect Zerodha / INDmoney, or add a fund by hand.</td></tr>`;
    $("#mfHow").open = !v.funds.length;
  }
  async function load() { try { $("#mfStatus").textContent = ""; mf = await api("/api/mf"); render(); } catch (e) { $("#mfStatus").textContent = e.message; } }

  async function importDialog() {
    let file = null;
    const out = await window.ui.dialog({
      title: "Import mutual funds", icon: "🧺", okText: "Import", wide: true,
      message: "Your CAMS / KFintech CAS (PDF) brings every fund at once, with units and cost. A CSV / Excel with Scheme name (or ISIN), Units and Invested works too. A new CAS replaces the previous one.",
      bodyHtml: `<div class="nw-form"><label class="ui-field"><span>CAS PDF, CSV or Excel</span><input class="ui-input" type="file" name="file" accept=".pdf,.csv,.xlsx,.txt"></label>
        <label class="ui-field" data-pw><span>PDF password (your PAN in capitals, or the one you set)</span><input class="ui-input" type="password" name="pw" autocomplete="off" autocapitalize="characters"></label></div>
        <p class="ui-hint">The password is used once to open the file and is not saved.</p>`,
      onOpen: box => { box.querySelector("[name=file]").onchange = e => { file = e.target.files[0] || null; box.querySelector("[data-pw]").hidden = !!file && !/\.pdf$/i.test(file.name); }; },
      collect: async box => {
        if (!file) throw new Error("Choose the CAS PDF (or a CSV).");
        try { return await api("/api/mf/import", { data: await fileB64(file), filename: file.name, password: box.querySelector("[name=pw]").value }); }
        catch (e) { if (e.needPassword) box.querySelector("[name=pw]").focus(); throw e; }
      }
    });
    if (out) { mf = out; render(); if (out.notice) window.toast?.(out.notice, { kind: "ok", ms: 7000 }); }
  }
  async function editDialog(f = null) {
    let pick = f ? { isin: f.isin, name: f.name } : null, results = [], timer = null;
    const out = await window.ui.dialog({
      title: f ? `Edit ${f.name}` : "Add a mutual fund", icon: "🧺", okText: "Save", wide: true,
      bodyHtml: `<div class="nw-form"><label class="ui-field" style="grid-column:1/-1"><span>Fund (type the name: e.g. axis elss direct growth)</span><input class="ui-input" name="q" value="${esc(f?.name || "")}" ${f ? "readonly" : "autofocus"} autocomplete="off"><div class="mf-drop" data-drop></div></label>
        <label class="ui-field"><span>Units you hold</span><input class="ui-input" name="units" inputmode="decimal" value="${esc(f?.units ?? "")}"></label>
        <label class="ui-field"><span>Amount invested (₹)</span><input class="ui-input" name="cost" inputmode="decimal" value="${esc(f?.invested ?? "")}" placeholder="optional"></label>
        <label class="ui-field"><span>Folio (optional)</span><input class="ui-input" name="folio" value="${esc(f?.folio || "")}"></label></div><p class="ui-hint" data-picked>${f ? `${esc(f.isin)}` : ""}</p>`,
      onOpen: box => {
        if (f) return;
        const q = box.querySelector("[name=q]"), drop = box.querySelector("[data-drop]");
        const draw = () => { drop.innerHTML = results.map((r, i) => `<button type="button" class="mf-opt" data-i="${i}">${esc(r.name)}<small>NAV ₹${r.nav} · ${esc(r.date || "")}</small></button>`).join(""); };
        q.addEventListener("input", () => { pick = null; box.querySelector("[data-picked]").textContent = ""; clearTimeout(timer); timer = setTimeout(async () => { if (q.value.trim().length < 3) { results = []; draw(); return; } try { results = (await api(`/api/mf/search?q=${encodeURIComponent(q.value.trim())}`)).results; } catch { results = []; } draw(); }, 250); });
        drop.addEventListener("click", e => { const b = e.target.closest("[data-i]"); if (!b) return; pick = results[Number(b.dataset.i)]; q.value = pick.name; results = []; draw(); box.querySelector("[data-picked]").textContent = `${pick.isin} · NAV ₹${pick.nav} on ${pick.date}`; box.querySelector("[name=units]").focus(); });
      },
      collect: box => {
        if (!pick) throw new Error("Pick the fund from the list.");
        const v = n => box.querySelector(`[name=${n}]`).value.trim();
        return api("/api/mf/save", { id: f?.id, isin: pick.isin, name: pick.name, units: v("units"), cost: v("cost"), folio: v("folio") });
      }
    });
    if (out) { mf = out; render(); }
  }
  window.featureOpen = window.featureOpen || {};
  window.featureOpen.mf = () => load();
  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#mfView")) return;
    $("#mfImport").onclick = () => importDialog();
    $("#mfAdd").onclick = () => editDialog();
    $("#mfRows").addEventListener("click", async e => {
      const b = e.target.closest("[data-act]"), tr = e.target.closest("tr[data-id]"); if (!b || !tr || !tr.dataset.id) return;
      const f = mf.funds.find(x => x.account === "import" && x.id === tr.dataset.id); if (!f) return;
      if (b.dataset.act === "edit") editDialog(f);
      else if (await window.ui.confirm({ title: `Remove ${f.name}?`, message: "Only removes it from this app.", okText: "Remove", danger: true })) { try { mf = await api("/api/mf/delete", { id: f.id }); render(); } catch (err) { window.toast?.(err.message, { kind: "error" }); } }
    });
  });
})();
