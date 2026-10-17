// Phones and the installed app: labels every table cell with its column name (so tables can show as cards on phones),
// marks columns hidden on phones (th.m-hide) and empty "—" cells, and offers "Install app" (Android / desktop Chrome
// install prompt; on iPhone the Share → Add to Home Screen steps).
(() => {
  const STANDALONE = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  if (STANDALONE) document.documentElement.classList.add("standalone");
  document.addEventListener("DOMContentLoaded", () => { if (STANDALONE) document.body.classList.add("standalone"); });

  function labelTable(t) {
    const ths = t.tHead ? [...t.tHead.rows[0]?.cells || []] : []; if (!ths.length) return;
    const heads = []; for (const th of ths) { const n = th.colSpan || 1; const text = (th.dataset.mlabel ?? th.textContent).replace(/\s+/g, " ").trim(); for (let i = 0; i < n; i++) heads.push({ text, hide: th.classList.contains("m-hide") }); }
    for (const body of t.tBodies) for (const tr of body.rows) {
      let c = 0;
      for (const td of tr.cells) {
        const h = heads[c];
        if (h && !(td.colSpan > 1)) { if (td.dataset.label !== h.text) td.dataset.label = h.text; if (td.classList.contains("m-hide") !== h.hide) td.classList.toggle("m-hide", h.hide); }
        const txt = td.textContent.trim(), empty = (txt === "—" || txt === "-" || txt === "") && !td.querySelector("input,button,select,img,svg,i,canvas");
        if (td.classList.contains("m-empty") !== empty) td.classList.toggle("m-empty", empty);
        c += td.colSpan || 1;
      }
    }
  }
  let queued = false;
  const run = () => { queued = false; document.querySelectorAll("main table").forEach(labelTable); };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  document.addEventListener("DOMContentLoaded", () => {
    const main = document.querySelector("main") || document.body;
    new MutationObserver(ms => { if (ms.some(m => m.type === "childList")) queue(); }).observe(main, { childList: true, subtree: true });
    queue();
  });
  window.mobileRelabel = queue;

  // ---- Install app ----
  let deferred = null;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const showBtn = on => { const b = document.getElementById("installBtn"); if (b) b.hidden = !on || STANDALONE; };
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e; showBtn(true); });
  addEventListener("appinstalled", () => { deferred = null; showBtn(false); window.toast?.("Installed. Open Equity Watchlist from your home screen.", { kind: "ok" }); });
  document.addEventListener("DOMContentLoaded", () => {
    const b = document.getElementById("installBtn"); if (!b) return;
    if (ios && !STANDALONE) showBtn(true);
    b.onclick = async () => {
      window.closeMenu?.();
      if (deferred) { deferred.prompt(); const r = await deferred.userChoice.catch(() => null); if (r?.outcome === "accepted") showBtn(false); deferred = null; return; }
      const secure = location.protocol === "https:" || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
      window.ui?.dialog({ title: "Install as an app", icon: "📲", okText: "Got it", collect: () => true,
        bodyHtml: `${secure ? "" : '<p class="ui-err">Your server is on plain http: phones only install apps from an https address. Put the app behind https (see DEPLOYMENT.md: Caddy or a load balancer with a certificate) and open it from there.</p>'}
          ${ios ? `<ol class="install-steps"><li>Open this page in <b>Safari</b>.</li><li>Tap <b>Share</b> <span aria-hidden="true">⬆︎</span> at the bottom of the screen.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol><p class="ui-hint">It opens full-screen like an app, stays signed in, and the bottom tabs work as navigation.</p>`
            : `<ol class="install-steps"><li>Open the browser menu (<b>⋮</b> in Chrome or Edge).</li><li>Choose <b>Install app</b> or <b>Add to Home screen</b>.</li></ol><p class="ui-hint">If you don't see it, use Chrome or Edge and open the app from its https address.</p>`}` });
    };
  });
})();
