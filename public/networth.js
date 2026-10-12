// Net worth tab: synced stocks + Zerodha (Coin) mutual funds + hand-entered EPF / PPF / NPS / gold / property / loans,
// with a daily trend and a look-through of what you really own in each stock (directly and through your funds).
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  let nw = null, filter = "all";
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw Object.assign(new Error(j.message || `HTTP ${r.status}`), { status: r.status }); return j;
  };
  const full = v => Number.isFinite(v) ? `₹${Math.round(v).toLocaleString("en-IN")}` : "—";
  // Indian short form: ₹8.4 L, ₹1.27 Cr
  const short = v => {
    if (!Number.isFinite(v)) return "—";
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e9 ? 0 : 2)} Cr`;
    if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(1)} L`;
    return `${s}₹${Math.round(a).toLocaleString("en-IN")}`;
  };
  const signed = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${short(Math.abs(v)).replace(/^−/, "")}`;
  const ago = iso => { if (!iso) return ""; const d = (Date.now() - new Date(iso).getTime()) / 864e5; return d < 1 ? "today" : d < 2 ? "yesterday" : `${Math.floor(d)} days ago`; };
  const CLASS_COLORS = { equity: "var(--nw-equity)", debt: "var(--nw-debt)", retire: "var(--nw-retire)", gold: "var(--nw-gold)", realestate: "var(--nw-re)", cash: "var(--nw-cash)", alt: "var(--nw-alt)" };
  const catOf = id => [...(nw?.assetCategories || []), ...(nw?.liabilityCategories || [])].find(c => c.id === id) || { label: id, icon: "•" };

  function spark(history) {
    const pts = history.filter(h => Number.isFinite(h.net));
    if (pts.length < 2) return `<div class="nw-spark-empty">Your trend appears here as the days go by: a snapshot is saved each day you open this page.</div>`;
    const W = 320, H = 90, min = Math.min(...pts.map(p => p.net)), max = Math.max(...pts.map(p => p.net)), span = max - min || 1;
    const xy = pts.map((p, i) => [i / (pts.length - 1) * W, H - 8 - (p.net - min) / span * (H - 16)]);
    const d = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
    const up = pts.at(-1).net >= pts[0].net;
    return `<svg class="nw-spark ${up ? "up" : "down"}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Net worth trend from ${pts[0].day} to ${pts.at(-1).day}">
      <path d="${d}L${W},${H}L0,${H}Z" class="area"/><path d="${d}" class="line"/><circle cx="${xy.at(-1)[0]}" cy="${xy.at(-1)[1]}" r="3.5" class="dot"/></svg>
      <div class="nw-spark-axis"><span>${pts[0].day}</span><span>${pts.at(-1).day}</span></div>`;
  }
  const chip = (c, label) => c ? `<span class="nw-chg ${c.abs >= 0 ? "up" : "down"}" title="Since ${c.from}">${signed(c.abs)}${c.pct !== null ? ` (${c.pct > 0 ? "+" : ""}${c.pct}%)` : ""} <small>${label}</small></span>` : "";

  function render() {
    const v = nw; if (!v) return;
    const t = v.totals;
    $("#nwHero").innerHTML = `<div class="nw-hero-main">
        <span class="nw-eyebrow">Net worth</span>
        <strong class="nw-big" title="${full(t.net)}">${short(t.net)}</strong>
        <div class="nw-chgs">${chip(v.change.d30, "30 days")}${chip(v.change.d365, "1 year")}${!v.change.d30 && !v.change.d365 ? `<span class="nw-chg muted">Tracking from ${v.history[0]?.day || v.today}</span>` : ""}</div>
        <div class="nw-hero-stats">
          <div><span>Assets</span><b>${short(t.assets)}</b></div>
          <div><span>Liabilities</span><b>${short(t.liabilities)}</b></div>
          ${t.invested ? `<div><span>Gain on invested</span><b class="${t.gainOnInvested >= 0 ? "buy" : "avoid"}">${signed(t.gainOnInvested)}</b></div>` : ""}
          ${t.debtToAssets !== null && t.liabilities > 0 ? `<div><span>Debt / assets</span><b>${t.debtToAssets}%</b></div>` : ""}
        </div></div>
      <div class="nw-hero-trend">${spark(v.history)}</div>`;
    // asset-class mix
    $("#nwMix").innerHTML = v.classes.length ? `<div class="nw-bar">${v.classes.map(c => `<i style="width:${c.pct}%;background:${CLASS_COLORS[c.id]}" title="${esc(c.label)} ${c.pct}%"></i>`).join("")}</div>
      <div class="nw-legend">${v.classes.map(c => `<span><i style="background:${CLASS_COLORS[c.id]}"></i>${esc(c.label)} <b>${c.pct}%</b> <small>${short(c.value)}</small></span>`).join("")}</div>` : "";
    // category cards: every asset type shows, so it is obvious where NPS, PPF or gold go
    const cards = v.categories.filter(c => c.kind === "asset" || c.count);
    $("#nwCats").innerHTML = cards.map(c => {
      const empty = !c.count;
      return `<button type="button" class="nw-cat${empty ? " empty" : ""}${filter === c.id ? " active" : ""}" data-cat="${c.id}" data-kind="${c.kind}" title="${esc(c.hint || c.label)}">
        <span class="nw-cat-ico" aria-hidden="true">${c.icon}</span><span class="nw-cat-lbl">${esc(c.label)}</span>
        ${empty ? `<span class="nw-cat-add">${c.auto ? "Sync from brokers" : "+ Add"}</span>` : `<strong>${c.kind === "liability" ? "−" : ""}${short(c.value)}</strong><small>${c.kind === "asset" ? `${c.pct}% · ` : ""}${c.count} ${c.count === 1 ? "entry" : "entries"}${Number.isFinite(c.gain) && c.kind === "asset" ? ` · <span class="${c.gain >= 0 ? "buy" : "avoid"}">${signed(c.gain)}</span>` : ""}</small>`}
      </button>`;
    }).join("");
    // entries
    const lines = v.lines.filter(l => filter === "all" || l.category === filter);
    $("#nwFilterNote").innerHTML = filter === "all" ? `${v.lines.length} entries` : `${esc(catOf(filter).label)} · ${lines.length} ${lines.length === 1 ? "entry" : "entries"} · <button type="button" class="linklike" data-clear>show all</button>`;
    $("#nwRows").innerHTML = lines.length ? lines.map(l => {
      const c = catOf(l.category), gain = Number.isFinite(l.invested) && l.invested > 0 ? l.value - l.invested : null;
      return `<tr class="${l.kind}" data-id="${esc(l.id)}">
        <td><div class="company">${esc(l.name)}</div><div class="ticker">${c.icon} ${esc(c.label)}${l.owner ? ` · ${esc(l.owner)}` : ""}${l.note ? ` · ${esc(l.note)}` : ""}</div></td>
        <td class="num">${l.kind === "liability" ? "−" : ""}${full(l.value)}</td>
        <td class="num">${Number.isFinite(l.invested) ? full(l.invested) : "—"}</td>
        <td class="num ${gain === null ? "" : gain >= 0 ? "buy" : "avoid"}">${gain === null ? "—" : `${signed(gain)} <small>${Math.round(gain / l.invested * 1000) / 10}%</small>`}</td>
        <td>${l.source === "synced" ? `<span class="nw-src">⟳ synced ${ago(l.syncedAt)}</span>` : `<span class="nw-src manual">✎ ${ago(l.updatedAt)}</span>`}</td>
        <td class="nw-acts">${l.source === "manual" ? `<button type="button" class="ghost" data-edit="${esc(l.id)}">Edit</button><button type="button" class="ghost danger-text" data-del="${esc(l.id)}">Delete</button>` : ""}</td></tr>`;
    }).join("") : `<tr><td colspan="6" class="nw-empty-row">${filter === "all" ? "Nothing here yet. Sync your Zerodha holdings, then add EPF, PPF, NPS, gold, property or loans with the buttons above." : `No ${esc(catOf(filter).label)} yet. <button type="button" class="linklike" data-addcat="${filter}">Add one</button>`}</td></tr>`;
    renderGoals(); renderFunds(); renderLook();
  }

  function renderFunds() {
    const v = nw, opts = sel => `<option value="">Not linked</option>${v.xrayFunds.map(f => `<option value="${esc(f.id)}"${f.id === sel ? " selected" : ""}>${esc(f.name)} (${f.count} stocks)</option>`).join("")}`;
    const manual = v.lines.filter(l => l.source === "manual" && l.category === "mf");
    const acc = v.mfAccounts.map(a => `<li>${esc(a.label)}: ${a.mfError ? `<span class="avoid">mutual funds not read (${esc(a.mfError)})</span>` : a.mfSyncedAt ? `${a.mfCount} fund${a.mfCount === 1 ? "" : "s"}, synced ${ago(a.mfSyncedAt)}` : "mutual funds not synced yet: press Sync from Zerodha"}</li>`).join("");
    const oth = nw.otherAssets || [];
    const othHtml = oth.length ? `<p class="hint">INDmoney also reports ${oth.slice(0, 6).map(o => `${esc(o.name)} ${short(o.value)}`).join(", ")}${oth.length > 6 ? "…" : ""}. These are not added automatically (to avoid counting them twice); add the ones you have not entered with <b>+ Add asset</b>.</p>` : "";
    $("#nwFundAccts").innerHTML = othHtml + (acc ? `<ul class="nw-acc">${acc}</ul>` : `<p class="hint">No Zerodha account synced yet. Log in on <button type="button" class="linklike" data-go="integrations">Connect brokers</button>, then press <b>Sync from Zerodha</b>.</p>`);
    $("#nwFundRows").innerHTML = v.mf.length || manual.length ? [...v.mf.map(f => `<tr>
        <td><div class="company">${esc(f.name)}</div><div class="ticker">${esc(f.isin)} · ${esc(f.accountLabel)}${f.folio ? ` · folio ${esc(f.folio)}` : ""}</div></td>
        <td class="num">${f.units ?? "—"}</td><td class="num">${f.avgNav ?? "—"}</td><td class="num">${f.nav ?? "—"}${f.navDate ? `<div class="ticker">${esc(String(f.navDate).slice(0, 10))}</div>` : ""}</td>
        <td class="num">${full(f.value)}</td><td class="num ${f.pnl >= 0 ? "buy" : "avoid"}">${Number.isFinite(f.pnl) ? `${signed(f.pnl)}${f.invested ? ` <small>${Math.round(f.pnl / f.invested * 1000) / 10}%</small>` : ""}` : "—"}</td>
        <td><select class="nw-link" data-key="${esc(f.key)}" aria-label="X-ray portfolio for ${esc(f.name)}">${opts(f.fundId)}</select>${f.autoLinked ? `<div class="ticker">matched by name</div>` : ""}</td></tr>`),
      ...manual.map(m => `<tr><td><div class="company">${esc(m.name)}</div><div class="ticker">entered by hand${m.owner ? ` · ${esc(m.owner)}` : ""}</div></td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">${full(m.value)}</td><td class="num">${Number.isFinite(m.invested) ? signed(m.value - m.invested) : "—"}</td>
        <td><select class="nw-link" data-manual="${esc(m.id)}" aria-label="X-ray portfolio for ${esc(m.name)}">${opts(m.fundId)}</select></td></tr>`)].join("")
      : `<tr><td colspan="7" class="nw-empty-row">No mutual funds yet. Funds bought through Zerodha Coin arrive with <b>Sync from Zerodha</b>; add funds held elsewhere (Groww, Kuvera, direct with the AMC) with <button type="button" class="linklike" data-addcat="mf">+ Add mutual fund</button>.</td></tr>`;
  }

  function renderLook() {
    const L = nw.lookThrough, t = L.totals;
    const linked = L.perFund.filter(f => f.linked), unlinked = L.perFund.filter(f => !f.linked);
    $("#nwLookSum").innerHTML = `<div><span>Held directly</span><b>${short(t.direct)}</b></div><div><span>Through linked funds</span><b>${short(t.viaFunds)}</b></div><div><span>Stocks you own both ways</span><b>${t.doubledUp}</b></div><div><span>${L.rows.length > 10 ? "Top 10 stocks" : `All ${L.rows.length} stocks counted`}</span><b>${L.rows.length > 10 ? `${L.top10Pct}% <small>of counted equity</small>` : `${short(t.direct + t.viaFunds)}`}</b></div>`;
    $("#nwLookNote").innerHTML = unlinked.length ? `${unlinked.length} fund${unlinked.length === 1 ? "" : "s"} worth ${short(t.uncoveredFunds)} ${unlinked.length === 1 ? "is" : "are"} not linked to an X-ray portfolio, so ${unlinked.length === 1 ? "its" : "their"} stocks are not counted: ${unlinked.slice(0, 4).map(f => esc(f.name)).join(", ")}${unlinked.length > 4 ? "…" : ""}. Load the fund's monthly portfolio in <button type="button" class="linklike" data-go="funds">Mutual fund X-ray</button>, then pick it in the table above.` : linked.length ? "Every fund is linked to its X-ray portfolio." : "";
    $("#nwOverlap").innerHTML = linked.length ? linked.map(f => `<span class="nw-ov" title="${esc(f.xrayName)}">${esc(f.name.replace(/\s*-?\s*(direct|regular)\b.*$/i, ""))}: <b>${f.overlapPct}%</b> in stocks you also hold</span>`).join("") : "";
    $("#nwLookRows").innerHTML = L.rows.length ? L.rows.slice(0, 40).map((r, i) => `<tr${r.symbol ? ` data-sym="${esc(r.symbol)}"` : ""}>
      <td class="num">${i + 1}</td><td><div class="company">${esc(r.name || r.symbol)}</div><div class="ticker">${esc(r.symbol || "no NSE symbol")}${r.both ? ' · <span class="nw-both">direct + funds</span>' : ""}</div></td>
      <td class="num">${r.direct ? full(r.direct) : "—"}</td><td class="num">${r.viaFunds ? full(r.viaFunds) : "—"}</td><td class="num"><b>${full(r.total)}</b></td>
      <td><div class="fd-w"><span><i style="width:${Math.min(100, r.pct * 4)}%"></i></span>${r.pct}%</div></td>
      <td class="ticker">${r.sources.slice(0, 3).map(s => `${esc(s.fund.replace(/\s*-?\s*(direct|regular)\b.*$/i, ""))} ${short(s.value)}`).join(" · ")}${r.sources.length > 3 ? ` +${r.sources.length - 3}` : ""}</td></tr>`).join("")
      : `<tr><td colspan="7" class="nw-empty-row">Sync your holdings and link at least one fund to see your combined exposure.</td></tr>`;
  }

  async function load() {
    $("#nwStatus").textContent = "";
    try { nw = await api("/api/networth"); render(); }
    catch (e) { $("#nwHero").innerHTML = `<p class="hint">Could not load net worth: ${esc(e.message)}</p>`; }
  }
  window.openNetworth = load;

  async function editItem(item = null, presetCat = null) {
    const cats = nw.assetCategories.filter(c => !c.auto), liabs = nw.liabilityCategories;
    const cur = item?.category || presetCat || "epf";
    const isLiab = id => liabs.some(c => c.id === id);
    const fundOpts = sel => `<option value="">Not linked</option>${nw.xrayFunds.map(f => `<option value="${esc(f.id)}"${f.id === sel ? " selected" : ""}>${esc(f.name)}</option>`).join("")}`;
    const saved = await window.ui.dialog({
      title: item ? `Edit ${item.name}` : isLiab(cur) ? "Add a liability" : "Add an asset", icon: isLiab(cur) ? "📄" : "➕", okText: item ? "Save" : "Add", wide: true,
      bodyHtml: `<div class="nw-form">
        <label class="ui-field"><span>Type</span><select class="ui-input" name="category">
          <optgroup label="Assets">${cats.map(c => `<option value="${c.id}"${c.id === cur ? " selected" : ""}>${c.icon} ${esc(c.label)}</option>`).join("")}</optgroup>
          <optgroup label="Liabilities">${liabs.map(c => `<option value="${c.id}"${c.id === cur ? " selected" : ""}>${c.icon} ${esc(c.label)}</option>`).join("")}</optgroup></select></label>
        <label class="ui-field"><span>Name</span><input class="ui-input" name="name" placeholder="e.g. EPF (employer), SBI PPF, Flat in Whitefield" value="${esc(item?.name || "")}"></label>
        <label class="ui-field"><span data-vlabel>Current value (₹)</span><input class="ui-input" name="value" inputmode="decimal" placeholder="e.g. 850000" value="${item?.value ?? ""}" autofocus></label>
        <label class="ui-field" data-asset-only><span>Amount invested (₹, optional)</span><input class="ui-input" name="invested" inputmode="decimal" placeholder="what you put in, for gain %" value="${item?.invested ?? ""}"></label>
        <label class="ui-field"><span>Owner (optional)</span><input class="ui-input" name="owner" placeholder="e.g. Self, Spouse, Joint" value="${esc(item?.owner || "")}"></label>
        <label class="ui-field"><span>Note (optional)</span><input class="ui-input" name="note" placeholder="e.g. UAN 1234…, matures 2031" value="${esc(item?.note || "")}"></label>
        <label class="ui-field" data-mf-only><span>X-ray portfolio (for the look-through)</span><select class="ui-input" name="fundId">${fundOpts(item?.fundId)}</select></label>
      </div><p class="ui-hint" data-hint></p>`,
      onOpen: box => {
        const sel = box.querySelector("[name=category]");
        const sync = () => {
          const id = sel.value, liab = isLiab(id), c = catOf(id);
          box.querySelector("[data-asset-only]").hidden = liab; box.querySelector("[data-mf-only]").hidden = id !== "mf";
          box.querySelector("[data-vlabel]").textContent = liab ? "Outstanding amount (₹)" : "Current value (₹)";
          box.querySelector("[data-hint]").textContent = c.hint || (id === "epf" ? "Use the balance on the EPFO passbook (employee + employer share)." : id === "nps" ? "Use the current value from your NPS statement (CRA app)." : id === "ppf" ? "Use the balance in your PPF passbook / net banking." : liab ? "Enter what you still owe today." : "");
        };
        sel.onchange = sync; sync();
      },
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        const out = await api("/api/networth/item", { id: item?.id, category: v("category"), name: v("name"), value: v("value"), invested: isLiab(v("category")) ? null : v("invested"), owner: v("owner"), note: v("note"), fundId: v("category") === "mf" ? v("fundId") : null });
        return out;
      }
    });
    if (saved) { nw = saved; render(); window.toast?.(item ? "Saved." : "Added to your net worth.", { kind: "ok", ms: 3000 }); }
  }

  const STATE = { "on-track": ["On track", "good"], stretch: ["Stretch", "warn"], behind: ["Behind", "bad"], "out-of-reach": ["Needs a rethink", "bad"] };
  function renderGoals() {
    const G = nw.goals || [];
    $("#nwGoals").innerHTML = (nw.staleManual ? `<p class="tx-warn">✎ ${nw.staleManual} hand-entered value${nw.staleManual === 1 ? " has" : "s have"} not been updated for 3+ months. Refresh EPF, PPF, NPS and property values for accurate goals.</p>` : "") + (G.length ? `<div class="nw-goals">${G.map(g => {
      const [label, tone] = STATE[g.state] || ["", ""];
      const by = new Date(`${g.by}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" });
      return `<div class="nw-goal ${tone}">
        <div class="nw-goal-top"><div><b>${esc(g.name)}</b><small>${short(g.target)} by ${by} · ${g.basis === "investable" ? "investable assets" : "net worth"} · ${Math.floor(g.months / 12)} y ${g.months % 12} m left</small></div><span class="nw-goal-state">${label}</span></div>
        <div class="nw-goal-bar"><i style="width:${g.progressPct}%"></i></div>
        <div class="nw-goal-meta"><span>${short(g.now)} today · <b>${g.progressPct}%</b></span><span>Projected ${short(g.projected)}</span></div>
        <div class="nw-goal-nums">
          <div><span>Growth needed</span><b>${g.requiredReturn === null ? "over 100%/yr" : `${g.requiredReturn}%/yr`}</b></div>
          <div><span>You assume</span><b>${g.expectedReturn}%/yr</b></div>
          <div><span>Actual so far</span><b>${g.actualGrowth === null ? "—" : `${g.actualGrowth}%/yr`}</b></div>
          <div><span>Investing</span><b>${short(g.monthly)}/mo</b></div>
        </div>
        <p class="nw-goal-tip">${g.state === "on-track" ? `At ${g.expectedReturn}% a year you would reach about ${short(g.projected)}, ahead of the target.` : g.extraMonthly ? `Add about <b>${short(g.extraMonthly)}/month</b> more (at ${g.expectedReturn}% a year), or move the date out, to close the ${short(g.gap)} gap.` : ""}${g.actualGrowth === null && g.basis === "net" ? " Actual growth shows after two months of daily snapshots." : ""}</p>
        <div class="nw-goal-acts"><button type="button" class="ghost" data-goal-edit="${esc(g.id)}">Edit</button><button type="button" class="ghost danger-text" data-goal-del="${esc(g.id)}">Delete</button></div>
      </div>`; }).join("")}</div>` : `<p class="hint">Set a target like <b>₹5 Cr by 2035</b>: the app works out the yearly growth you need, compares it with what you assume and what you are actually getting, and how much more to invest each month if you are behind.</p>`);
  }
  async function editGoal(g = null) {
    const y = new Date().getFullYear();
    const out = await window.ui.dialog({
      title: g ? `Edit ${g.name}` : "Add a goal", icon: "🎯", okText: g ? "Save" : "Add goal", wide: true,
      bodyHtml: `<div class="nw-form">
        <label class="ui-field"><span>Goal name</span><input class="ui-input" name="name" placeholder="e.g. Financial freedom, Retirement" value="${esc(g?.name || "")}" autofocus></label>
        <label class="ui-field"><span>Target amount (₹)</span><input class="ui-input" name="target" inputmode="decimal" placeholder="e.g. 50000000 for ₹5 Cr" value="${g?.target ?? ""}"></label>
        <label class="ui-field"><span>Reach it by</span><input class="ui-input" type="month" name="by" min="${y}-01" value="${g?.by || `${y + 10}-03`}"></label>
        <label class="ui-field"><span>You will add each month (₹)</span><input class="ui-input" name="monthly" inputmode="decimal" placeholder="SIPs + other savings" value="${g?.monthly ?? ""}"></label>
        <label class="ui-field"><span>Expected return (% a year)</span><input class="ui-input" name="expectedReturn" inputmode="decimal" value="${g?.expectedReturn ?? 11}"></label>
        <label class="ui-field"><span>Measure against</span><select class="ui-input" name="basis"><option value="net"${g?.basis !== "investable" ? " selected" : ""}>Net worth (everything minus loans)</option><option value="investable"${g?.basis === "investable" ? " selected" : ""}>Investable assets (excludes property & other)</option></select></label>
      </div><p class="ui-hint" data-prev></p>`,
      onOpen: box => {
        const prev = box.querySelector("[data-prev]"), v = n => Number(String(box.querySelector(`[name=${n}]`).value).replace(/[,₹\s]/g, ""));
        const upd = () => { const t = v("target"); prev.textContent = t > 0 ? `Target ${short(t)}` : ""; };
        box.querySelector("[name=target]").oninput = upd; upd();
      },
      collect: box => { const v = n => box.querySelector(`[name=${n}]`).value; return api("/api/networth/goal", { id: g?.id, name: v("name"), target: v("target"), by: v("by"), monthly: v("monthly"), expectedReturn: v("expectedReturn"), basis: v("basis") }); }
    });
    if (out) { nw = out; render(); }
  }
  async function sync() {
    const b = $("#nwSync"); b.disabled = true; b.classList.add("is-loading"); $("#nwStatus").textContent = "Reading stocks and mutual funds from Zerodha…";
    try {
      const x = await api("/api/networth/sync", {}); nw = x; render();
      const mf = x.synced.reduce((a, s) => a + s.mf, 0), err = x.synced.find(s => s.mfError);
      $("#nwStatus").textContent = `${x.synced.length} Zerodha account${x.synced.length === 1 ? "" : "s"} synced · ${mf} mutual fund${mf === 1 ? "" : "s"}${err ? ` · mutual funds failed: ${err.mfError}` : ""}${x.failed.length ? ` · ${x.failed.map(f => `${f.slot}: ${f.error}`).join("; ")}` : ""}`;
      window.toast?.(`✓ Synced from Zerodha: ${mf} mutual fund${mf === 1 ? "" : "s"}.`, { kind: "ok" });
    } catch (e) {
      $("#nwStatus").textContent = e.message;
      if (/No Zerodha account/.test(e.message)) window.toast?.(e.message, { kind: "warn", action: { label: "Connect brokers", fn: () => setView("integrations") } });
    } finally { b.disabled = false; b.classList.remove("is-loading"); }
  }

  document.addEventListener("DOMContentLoaded", () => {
    if (!$("#nwView")) return;
    $("#viewNetworth").onclick = () => setView("networth");
    $("#nwAddAsset").onclick = () => editItem(null, filter !== "all" && !["stocks"].includes(filter) && !nw.liabilityCategories.some(c => c.id === filter) ? filter : "epf");
    $("#nwAddLiab").onclick = () => editItem(null, nw.liabilityCategories.some(c => c.id === filter) ? filter : "homeloan");
    $("#nwSync").onclick = sync;
    $("#nwAddGoal").onclick = () => editGoal();
    $("#nwGoals").addEventListener("click", async e => {
      const ed = e.target.closest("[data-goal-edit]"); if (ed) { editGoal(nw.goals.find(g => g.id === ed.dataset.goalEdit)); return; }
      const del = e.target.closest("[data-goal-del]"); if (!del) return;
      const g = nw.goals.find(x => x.id === del.dataset.goalDel);
      if (await window.ui.confirm({ title: `Delete the goal "${g.name}"?`, okText: "Delete", danger: true })) { nw = await api("/api/networth/goal-delete", { id: g.id }); render(); }
    });
    $("#nwCats").addEventListener("click", e => {
      const b = e.target.closest("[data-cat]"); if (!b) return;
      const c = nw.categories.find(x => x.id === b.dataset.cat);
      if (!c.count) { if (c.auto) setView("integrations"); else editItem(null, c.id); return; }
      filter = filter === c.id ? "all" : c.id; render();
    });
    document.querySelector("#nwView").addEventListener("click", async e => {
      const t = e.target;
      if (t.closest("[data-clear]")) { filter = "all"; render(); return; }
      const go = t.closest("[data-go]"); if (go) { setView(go.dataset.go); return; }
      const add = t.closest("[data-addcat]"); if (add) { editItem(null, add.dataset.addcat); return; }
      const ed = t.closest("[data-edit]"); if (ed) { editItem(nw.lines.find(l => l.id === ed.dataset.edit)); return; }
      const del = t.closest("[data-del]");
      if (del) {
        const it = nw.lines.find(l => l.id === del.dataset.del);
        if (await window.ui.confirm({ title: `Delete ${it.name}?`, message: "It is removed from your net worth. Past daily totals stay as they were.", okText: "Delete", danger: true })) { nw = await api("/api/networth/delete", { id: it.id }); render(); }
        return;
      }
      const tr = t.closest("#nwLookRows tr[data-sym]"); if (tr) window.openStockSheet?.(tr.dataset.sym, { back: "Back to Net worth" });
    });
    $("#nwFundRows").addEventListener("change", async e => {
      const s = e.target.closest("select.nw-link"); if (!s) return; s.disabled = true;
      try {
        if (s.dataset.key) nw = await api("/api/networth/link", { key: s.dataset.key, fundId: s.value || null });
        else { const it = nw.lines.find(l => l.id === s.dataset.manual); nw = await api("/api/networth/item", { ...it, fundId: s.value || null }); }
        render(); window.toast?.(s.value ? "Linked: its stocks now count in your look-through." : "Unlinked.", { kind: "ok", ms: 3000 });
      } catch (err) { window.toast?.(err.message, { kind: "warn" }); s.disabled = false; }
    });
  });
})();
