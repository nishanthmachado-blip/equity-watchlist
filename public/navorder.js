// Arrange the side menu: drag items to reorder them (also between groups), ⭐ to pin an item to a "Pinned" group at
// the top, 👁 to hide an item you don't use, ▲▼ on touch screens, Reset to go back to the default. Saved for your
// login on the server (/api/ui/menu), so every device shows the same menu; also kept in this browser so the menu is
// arranged before the server answers.
(() => {
  const FIXED = new Set(["viewGrowth", "installBtn", "refresh"]); // never moved
  const LS = "equity-menu-order";
  let nav, sections = [], defaults = {}, saved = { order: {}, pinned: [], hidden: [] }, editing = false, wasPinned = false, dragId = null;
  const items = () => [...nav.querySelectorAll("button.viewTab[id]")].filter(b => !FIXED.has(b.id));
  const byId = id => document.getElementById(id);
  const slug = s => String(s || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "group";
  function scan() { // the default groups, in page order: header element + where its items go
    let cur = null;
    for (const el of [...nav.children]) {
      if (el.matches("p.side-label")) { cur = { id: slug(el.textContent), head: el, box: nav, label: el.textContent.trim() }; sections.push(cur); el.dataset.sec = cur.id; }
      else if (el.matches("details.side-group")) { cur = { id: el.id || slug(el.textContent), head: el.querySelector("summary"), box: el, details: el, label: el.querySelector("summary").textContent.trim() }; sections.push(cur); el.querySelector("summary").dataset.sec = cur.id; for (const b of el.querySelectorAll("button.viewTab[id]")) if (!FIXED.has(b.id)) (defaults[cur.id] ||= []).push(b.id); }
      else if (el.matches("button.viewTab[id]") && cur && !FIXED.has(el.id)) (defaults[cur.id] ||= []).push(el.id);
    }
    const pin = document.createElement("p"); pin.className = "side-label nv-pinned-head"; pin.dataset.sec = "pinned"; pin.innerHTML = '<span class="lbl">⭐ Pinned</span>'; pin.hidden = true;
    nav.prepend(pin); sections.unshift({ id: "pinned", head: pin, box: nav, label: "Pinned" });
  }
  function clean(s) {
    const ok = id => typeof id === "string" && /^[A-Za-z][\w-]{1,40}$/.test(id) && byId(id) && !FIXED.has(id);
    const order = {}; for (const [k, v] of Object.entries(s?.order || {})) if (k !== "pinned" && sections.some(x => x.id === k) && Array.isArray(v)) order[k] = [...new Set(v.filter(ok))];
    return { order, pinned: [...new Set((s?.pinned || []).filter(ok))], hidden: [...new Set((s?.hidden || []).filter(ok))] };
  }
  function apply() {
    const pinned = new Set(saved.pinned), placed = new Set(saved.pinned);
    for (const sec of sections) {
      let ids = sec.id === "pinned" ? saved.pinned : [...(saved.order[sec.id] || []).filter(id => !pinned.has(id))];
      if (sec.id !== "pinned") { for (const id of ids) placed.add(id); }
      sec.ids = ids;
    }
    // items not placed anywhere (new in this version, or never arranged) stay in their default group, at the end
    for (const sec of sections) if (sec.id !== "pinned") for (const id of defaults[sec.id] || []) if (!placed.has(id)) { sec.ids.push(id); placed.add(id); }
    for (const sec of sections) {
      let anchor = sec.head; // insert right after the header, in order
      for (const id of sec.ids) { const b = byId(id); if (!b) continue; anchor.after(b); anchor = b; }
      if (sec.id === "pinned") sec.head.hidden = !sec.ids.length && !editing;
    }
    const hide = new Set(saved.hidden);
    for (const b of items()) { b.classList.toggle("nv-hidden", hide.has(b.id)); b.classList.toggle("nv-pinned", pinned.has(b.id)); }
  }
  // current arrangement read back from the page (after a drop or a move)
  function readBack() {
    const order = {}, pinned = []; let sec = null;
    const walk = el => { for (const c of [...el.children]) { if (c.dataset?.sec) sec = c.dataset.sec; else if (c.matches?.("summary") && c.dataset.sec) sec = c.dataset.sec; if (c.matches?.("details.side-group")) { walk(c); continue; } if (c.matches?.("button.viewTab[id]") && !FIXED.has(c.id) && sec) (sec === "pinned" ? pinned : (order[sec] ||= [])).push(c.id); } };
    walk(nav);
    saved = { order, pinned, hidden: saved.hidden.filter(id => byId(id)) };
  }
  const local = { get: () => { try { return JSON.parse(localStorage.getItem(LS) || "null"); } catch { return null; } }, set: v => { try { localStorage.setItem(LS, JSON.stringify(v)); } catch { /* private mode */ } } };
  async function persist() {
    local.set(saved);
    try { await fetch("/api/ui/menu", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(saved) }); } catch { /* offline: kept in this browser */ }
  }
  // ---- arrange mode ----
  function decorate(on) {
    for (const b of items()) {
      b.querySelector(".nv-acts")?.remove(); b.draggable = on;
      if (on) b.insertAdjacentHTML("beforeend", `<span class="nv-acts" aria-hidden="false"><i data-nv="up" title="Move up" role="button">▲</i><i data-nv="down" title="Move down" role="button">▼</i><i data-nv="pin" title="${b.classList.contains("nv-pinned") ? "Unpin" : "Pin to the top"}" role="button">${b.classList.contains("nv-pinned") ? "★" : "☆"}</i><i data-nv="hide" title="${b.classList.contains("nv-hidden") ? "Show in the menu" : "Hide from the menu"}" role="button">${b.classList.contains("nv-hidden") ? "🙈" : "👁"}</i></span>`);
    }
  }
  function setEditing(on) {
    editing = on; document.body.classList.toggle("menu-editing", on);
    const bar = document.getElementById("nvBar");
    if (on) {
      wasPinned = document.body.classList.contains("menu-pinned"); window.setMenuPinned?.(true);
      sections.forEach(s => { if (s.details) { s.wasOpen = s.details.open; s.details.open = true; } });
      nav.insertAdjacentHTML("beforebegin", `<div id="nvBar" class="nv-bar"><b>Arrange the menu</b><span>Drag items (or ▲▼), ☆ pins to the top, 👁 hides.</span><button type="button" class="ghost" data-nv-reset>Reset</button><button type="button" class="primary" data-nv-done>Done</button></div>`);
    } else {
      bar?.remove(); window.setMenuPinned?.(wasPinned);
      sections.forEach(s => { if (s.details && s.wasOpen !== undefined) s.details.open = s.wasOpen; });
    }
    apply(); decorate(on);
  }
  // ▲▼: move one place inside its group, or to the end / start of the next group at the edge
  function lists() { readBack(); return sections.map(x => (x.id === "pinned" ? saved.pinned : (saved.order[x.id] ||= []))); }
  function move(id, dir) {
    const L = lists(), i = L.findIndex(l => l.includes(id)); if (i < 0) return;
    const l = L[i], j = l.indexOf(id), k = j + dir;
    if (k >= 0 && k < l.length) [l[j], l[k]] = [l[k], l[j]];
    else if (L[i + dir]) { l.splice(j, 1); if (dir < 0) L[i + dir].push(id); else L[i + dir].unshift(id); }
    apply(); decorate(true);
  }
  function togglePin(id, was) { // was = pinned before this click
    for (const l of lists()) { const j = l.indexOf(id); if (j >= 0) l.splice(j, 1); }
    if (!was) saved.pinned.push(id);
    else { const home = sections.find(x => (defaults[x.id] || []).includes(id)) || sections[1]; (saved.order[home.id] ||= []).push(id); }
  }
  function init() {
    nav = document.querySelector("#sideMenu .side-nav"); if (!nav) return;
    scan();
    const head = document.querySelector("#sideMenu .side-head"), pinBtn = document.getElementById("menuPin");
    if (head && !document.getElementById("menuArrange")) (pinBtn || head.lastElementChild).insertAdjacentHTML("beforebegin", '<button id="menuArrange" type="button" class="ghost menu-arrange" title="Arrange the menu: reorder, pin, hide">✎</button>');
    saved = clean(local.get() || {}); apply();
    fetch("/api/ui/menu", { credentials: "same-origin" }).then(r => (r.ok ? r.json() : null)).then(s => { if (s && !editing) { saved = clean(s); local.set(saved); apply(); } }).catch(() => {});
    document.getElementById("menuArrange")?.addEventListener("click", e => { e.stopPropagation(); setEditing(!editing); if (!editing) persist(); });
    // while arranging, a click on an item does not open its page
    document.getElementById("sideMenu").addEventListener("click", e => {
      if (!editing) return;
      if (e.target.closest("[data-nv-done]")) { setEditing(false); persist(); window.toast?.("Menu saved.", { kind: "ok", ms: 2000 }); return; }
      if (e.target.closest("[data-nv-reset]")) { saved = { order: {}, pinned: [], hidden: [] }; apply(); decorate(true); persist(); window.toast?.("Menu back to the default order.", { ms: 2000 }); return; }
      const act = e.target.closest("[data-nv]"), b = e.target.closest("button.viewTab[id]");
      if (b && nav.contains(b)) { e.preventDefault(); e.stopPropagation(); }
      if (!act || !b) return;
      const k = act.dataset.nv;
      if (k === "up" || k === "down") return move(b.id, k === "up" ? -1 : 1);
      if (k === "pin") togglePin(b.id, b.classList.contains("nv-pinned"));
      if (k === "hide") { saved.hidden = saved.hidden.includes(b.id) ? saved.hidden.filter(x => x !== b.id) : [...saved.hidden, b.id]; }
      apply(); decorate(true);
    }, true);
    nav.addEventListener("dragstart", e => { if (!editing) return; const b = e.target.closest?.("button.viewTab[id]"); if (!b || FIXED.has(b.id)) return; dragId = b.id; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", b.id); } catch { /* old browsers */ } requestAnimationFrame(() => b.classList.add("nv-dragging")); });
    nav.addEventListener("dragover", e => {
      if (!editing || !dragId) return; const t = e.target.closest?.("button.viewTab[id], [data-sec], summary[data-sec]"); if (!t || FIXED.has(t.id)) return;
      e.preventDefault(); nav.querySelectorAll(".nv-drop-before,.nv-drop-after").forEach(x => x.classList.remove("nv-drop-before", "nv-drop-after"));
      if (t.id === dragId) return; const r = t.getBoundingClientRect(); t.classList.add(t.dataset.sec || e.clientY > r.top + r.height / 2 ? "nv-drop-after" : "nv-drop-before");
    });
    nav.addEventListener("drop", e => {
      if (!editing || !dragId) return; e.preventDefault();
      const t = nav.querySelector(".nv-drop-before, .nv-drop-after"), b = byId(dragId); dragId = null;
      if (t && b) { if (t.classList.contains("nv-drop-before")) t.before(b); else t.after(b); }
      nav.querySelectorAll(".nv-dragging,.nv-drop-before,.nv-drop-after").forEach(x => x.classList.remove("nv-dragging", "nv-drop-before", "nv-drop-after"));
      readBack(); apply(); decorate(true);
    });
    nav.addEventListener("dragend", () => { dragId = null; nav.querySelectorAll(".nv-dragging,.nv-drop-before,.nv-drop-after").forEach(x => x.classList.remove("nv-dragging", "nv-drop-before", "nv-drop-after")); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
