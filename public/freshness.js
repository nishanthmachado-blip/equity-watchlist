// Banner across the top when something is out of date: a broker login has expired, holdings have not been synced for
// a couple of trading days, prices are old. Each warning has a one-click fix and can be dismissed for this session.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  const KEY = "equity-fresh-dismissed";
  const dismissed = () => { try { return new Set(JSON.parse(sessionStorage.getItem(KEY) || "[]")); } catch { return new Set(); } };
  const dismiss = id => { const s = dismissed(); s.add(id); try { sessionStorage.setItem(KEY, JSON.stringify([...s])); } catch {} };
  let last = [];
  function render() {
    const bar = $("#freshBar"); if (!bar) return;
    const gone = dismissed(), list = last.filter(w => !gone.has(w.id));
    bar.hidden = !list.length;
    const ico = { bad: "⛔", warn: "⚠️", info: "ℹ️" };
    bar.innerHTML = list.map(w => `<div class="fresh-item ${w.level}" data-id="${esc(w.id)}"><span class="fresh-ico" aria-hidden="true">${ico[w.level] || "⚠️"}</span><span class="fresh-text">${esc(w.text)}</span>
      ${w.action ? `<button type="button" class="ghost" data-act="${esc(w.id)}">${esc(w.action.label)}</button>` : ""}<button type="button" class="fresh-x" data-x="${esc(w.id)}" aria-label="Dismiss">&times;</button></div>`).join("");
  }
  async function check() {
    try { const r = await fetch("/api/freshness"); if (!r.ok) return; last = (await r.json()).warnings || []; render(); } catch { /* offline: say nothing */ }
  }
  window.checkFreshness = check;
  document.addEventListener("DOMContentLoaded", () => {
    const bar = $("#freshBar"); if (!bar) return;
    bar.addEventListener("click", e => {
      const x = e.target.closest("[data-x]"); if (x) { dismiss(x.dataset.x); render(); return; }
      const a = e.target.closest("[data-act]"); if (!a) return;
      const w = last.find(v => v.id === a.dataset.act); if (!w) return;
      if (w.action.refresh) { $("#refresh")?.click(); dismiss(w.id); render(); setTimeout(check, 60e3); }
      else if (w.action.view) setView(w.action.view);
      else if (w.action.account) window.account?.[w.action.account]?.();
    });
    (window.meReady || Promise.resolve()).then(() => setTimeout(check, 1200));
    const sv = window.setView; let t = null; window.setView = (...args) => { const out = sv(...args); clearTimeout(t); t = setTimeout(check, 800); return out; };
    setInterval(check, 10 * 60e3);
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
  });
})();
