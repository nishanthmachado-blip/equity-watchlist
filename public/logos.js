// Company logos beside every stock row (the same rows that get a ♡), and on the Value a stock card. Images come from
// this app (/api/logo/SYM, a shared server-side cache), never from an outside site. Until a logo is found (or when a
// company has none) the row shows its initials in a coloured badge. 🎨 menu → Layout → Logos: Logos / Initials / Off.
(() => {
  const esc = s => (window.ui?.esc ? window.ui.esc(s) : String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])));
  const ID_TABLES = "#valRows, #pkRows, #pkMineRows, #gpRows, #planRows, #rows, #wlRows";
  const known = new Map(); // SYM -> version string | null (none) | undefined (not asked)
  const asked = new Map(); // SYM -> times asked while pending
  let queued = false, askTimer = null, retryTimer = null;
  const want = new Set();
  const symOfRow = el => {
    if (el.dataset.sym) return String(el.dataset.sym).toUpperCase();
    if (el.dataset.id && el.closest(ID_TABLES)) { try { const st = typeof stocks !== "undefined" ? stocks.find(x => String(x.id) === el.dataset.id) : null; return st ? String(st.marketSymbol || st.ticker || "").toUpperCase() : null; } catch { return null; } }
    return null;
  };
  const initials = (name, sym) => {
    const w = String(name || sym).replace(/\b(ltd|limited|the|india|industries|corporation|company|co)\b\.?/gi, " ").replace(/[^A-Za-z0-9& ]/g, " ").trim().split(/\s+/).filter(Boolean);
    return (w.length >= 2 ? w[0][0] + w[1][0] : String(w[0] || sym || "?").slice(0, 2)).toUpperCase();
  };
  const hue = s => { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const nameOf = host => [...host.childNodes].filter(n => n.nodeType === 3 || (n.nodeType === 1 && !n.matches(".fav-btn,.co-logo,.ch-mini,.chip,small,button"))).map(n => n.textContent).join(" ").trim();
  function badge(sym, name) {
    const v = known.get(sym);
    return `<span class="co-logo" data-logo="${esc(sym)}" style="--h:${hue(sym)}" aria-hidden="true"${v ? "" : ' title="No logo yet: click to add the company website"'}><b>${esc(initials(name, sym))}</b>${v ? `<img src="/api/logo/${encodeURIComponent(sym)}?v=${esc(v)}" alt="" loading="lazy" decoding="async">` : ""}</span>`;
  }
  function decorate() {
    queued = false;
    const rows = document.querySelectorAll(`main tr[data-sym], main .wk-row[data-sym], main .sw-idea[data-sym], main .fav-card-item[data-sym], ${ID_TABLES.split(",").map(s => `main ${s.trim()} > tr[data-id]`).join(", ")}`);
    for (const el of rows) {
      const sym = symOfRow(el); if (!sym || !/^[A-Z0-9&-]{1,20}$/.test(sym)) continue;
      const name = el.querySelector(".company"); if (!name) continue;
      const box = name.parentElement; // the cell / card part holding the name and ticker lines: the badge floats left of both
      const cur = box.querySelector(":scope > .co-logo");
      if (cur && cur.dataset.logo === sym && (!!cur.querySelector("img") === !!known.get(sym))) continue;
      const html = badge(sym, nameOf(name));
      if (cur) cur.outerHTML = html; else { box.insertAdjacentHTML("afterbegin", html); box.classList.add("co-has-logo"); }
      if (!known.has(sym)) want.add(sym);
    }
    const card = document.querySelector("#vsResult .vs-card[data-symbol]"), h2 = card?.querySelector("h2");
    if (h2) { const sym = card.dataset.symbol.toUpperCase(), cur = h2.querySelector(":scope > .co-logo"); if (!cur || cur.dataset.logo !== sym || (!!cur.querySelector("img") !== !!known.get(sym))) { const html = badge(sym, h2.textContent.replace(/\(.*$/, "")); if (cur) cur.outerHTML = html; else { const heart = h2.querySelector(":scope > .fav-btn"); if (heart) heart.insertAdjacentHTML("afterend", html); else h2.insertAdjacentHTML("afterbegin", html); } } if (!known.has(sym)) want.add(sym); }
    if (want.size && !askTimer) askTimer = setTimeout(ask, 300);
  }
  async function ask() {
    askTimer = null; const list = [...want].slice(0, 400); want.clear(); if (!list.length || document.documentElement.dataset.logos === "off") return;
    try {
      const r = await fetch("/api/logos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbols: list }) }); if (!r.ok) return;
      const j = await r.json(), pend = new Set(j.pending || []);
      for (const s of list) {
        if (j.have?.[s]) known.set(s, j.have[s]);
        else if (pend.has(s) && (asked.get(s) || 0) < 4) { asked.set(s, (asked.get(s) || 0) + 1); } // looked up in the background: ask again soon
        else known.set(s, null);
      }
      const again = list.filter(s => !known.has(s));
      if (again.length) { clearTimeout(retryTimer); retryTimer = setTimeout(() => { for (const s of again) want.add(s); ask(); }, 12000); }
      queue();
    } catch { /* offline: initials stay */ }
  }
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(decorate); } };
  // Click a badge that shows initials: tell the app the company's website and its icon becomes the logo
  document.addEventListener("click", async e => {
    const b = e.target.closest(".co-logo"); if (!b || b.querySelector("img") || document.documentElement.dataset.logos === "off") return;
    e.preventDefault(); e.stopPropagation();
    const sym = b.dataset.logo, site = await window.ui?.prompt?.({ title: `Logo for ${sym}`, icon: "🖼️", message: "No logo was found for this company. Type its website and the app uses the site's icon.", label: "Company website", placeholder: "e.g. lemontreehotels.com", okText: "Get logo" });
    if (!site) return;
    try {
      const r = await fetch("/api/logos/site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ symbol: sym, website: site }) }), j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
      known.set(sym, j.version); document.querySelectorAll(`.co-logo[data-logo="${CSS.escape(sym)}"]`).forEach(x => x.remove()); queue();
      window.toast?.(`Logo added for ${esc(sym)}.`, { kind: "ok", ms: 3000 });
    } catch (err) { window.toast?.(esc(err.message), { kind: "bad" }); }
  }, true);
  // a logo that fails to load leaves the initials
  document.addEventListener("error", e => { const t = e.target; if (t?.tagName === "IMG" && t.parentElement?.classList.contains("co-logo")) { known.set(t.parentElement.dataset.logo, null); t.remove(); } }, true);
  document.addEventListener("DOMContentLoaded", () => {
    new MutationObserver(ms => { if (ms.some(m => m.type === "childList" && [...m.addedNodes].some(n => n.nodeType === 1 && !n.matches?.(".co-logo,.co-logo *")))) queue(); }).observe(document.querySelector("main") || document.body, { childList: true, subtree: true });
    queue();
  });
})();
