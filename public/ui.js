// In-app dialogs that replace the browser's prompt() / confirm() / alert() (which cannot be styled and look out of place).
// window.ui.prompt / confirm / alert / dialog all return Promises. Themed through the same CSS variables as the rest of the app,
// keyboard friendly (Enter = OK, Esc = Cancel, focus stays inside the dialog), and screen-reader labelled.
(() => {
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let open = null;

  function dialog({ title, message = "", icon = "", bodyHtml = "", okText = "OK", cancelText = "Cancel", danger = false, hideCancel = false, onOpen = null, collect = null, wide = false } = {}) {
    if (open) open.close(null);
    return new Promise(resolve => {
      const prevFocus = document.activeElement;
      const scrim = document.createElement("div");
      scrim.className = "ui-scrim";
      const id = `ui-t-${Date.now()}`;
      scrim.innerHTML = `<div class="ui-dlg${wide ? " wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="${id}">
        ${icon ? `<div class="ui-ico" aria-hidden="true">${icon}</div>` : ""}
        <h2 id="${id}">${esc(title)}</h2>${message ? `<p class="ui-msg">${message}</p>` : ""}
        <div class="ui-body">${bodyHtml}</div><p class="ui-err" role="alert" hidden></p>
        <div class="ui-actions">${hideCancel ? "" : `<button type="button" class="ghost" data-ui="cancel">${esc(cancelText)}</button>`}<button type="button" class="primary${danger ? " danger" : ""}" data-ui="ok">${esc(okText)}</button></div></div>`;
      document.body.appendChild(scrim);
      document.body.classList.add("modal-open");
      const box = scrim.querySelector(".ui-dlg"), err = scrim.querySelector(".ui-err");
      const close = value => {
        if (!scrim.isConnected) return;
        scrim.classList.add("out"); setTimeout(() => scrim.remove(), 160);
        if (!document.querySelector(".modal:not([hidden])")) document.body.classList.remove("modal-open");
        open = null; document.removeEventListener("keydown", onKey, true); prevFocus?.focus?.(); resolve(value);
      };
      const submit = async () => {
        try { const v = collect ? await collect(box) : true; close(v); }
        catch (e) { err.textContent = e.message; err.hidden = false; box.classList.remove("shake"); void box.offsetWidth; box.classList.add("shake"); }
      };
      const focusables = () => [...box.querySelectorAll("button,input,select,textarea,[tabindex]:not([tabindex='-1'])")].filter(x => !x.disabled && x.offsetParent !== null);
      const onKey = e => {
        if (e.key === "Escape") { e.preventDefault(); close(null); }
        else if (e.key === "Enter" && e.target.matches("input:not([type=checkbox]):not([type=radio])")) { e.preventDefault(); submit(); }
        else if (e.key === "Tab") { const f = focusables(); if (!f.length) return; const i = f.indexOf(document.activeElement); if (e.shiftKey && i <= 0) { e.preventDefault(); f.at(-1).focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); } }
      };
      document.addEventListener("keydown", onKey, true);
      scrim.addEventListener("mousedown", e => { if (e.target === scrim) close(null); });
      scrim.querySelector('[data-ui="ok"]').onclick = submit;
      scrim.querySelector('[data-ui="cancel"]')?.addEventListener("click", () => close(null));
      open = { close };
      onOpen?.(box, { setError: m => { err.textContent = m || ""; err.hidden = !m; } });
      requestAnimationFrame(() => (box.querySelector("[autofocus]") || box.querySelector("input,select,textarea") || box.querySelector('[data-ui="ok"]')).focus());
    });
  }

  const prompt = ({ title, message = "", label = "", placeholder = "", value = "", chips = [], hint = "", okText = "Save", icon = "✏️", required = true, validate = null } = {}) => dialog({
    title, message, icon, okText,
    bodyHtml: `<label class="ui-field">${label ? `<span>${esc(label)}</span>` : ""}<input type="text" class="ui-input" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" autofocus></label>
      ${chips.length ? `<div class="ui-chips" aria-label="Suggestions">${chips.map(c => `<button type="button" class="ui-chip" data-chip="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}${hint ? `<p class="ui-hint">${hint}</p>` : ""}`,
    onOpen: box => box.querySelectorAll("[data-chip]").forEach(b => { b.onclick = () => { const i = box.querySelector(".ui-input"); i.value = b.dataset.chip; i.focus(); }; }),
    collect: box => { const v = box.querySelector(".ui-input").value.trim(); if (required && !v) throw new Error("Please type something first."); const bad = validate?.(v); if (bad) throw new Error(bad); return v; }
  });
  const confirm = ({ title, message = "", okText = "Confirm", cancelText = "Cancel", danger = false, icon = danger ? "🗑️" : "❓" } = {}) => dialog({ title, message, okText, cancelText, danger, icon }).then(v => v === true);
  const alert = ({ title, message = "", okText = "Got it", icon = "ℹ️" } = {}) => dialog({ title, message, okText, icon, hideCancel: true }).then(() => undefined);

  window.ui = { dialog, prompt, confirm, alert, esc };
})();
