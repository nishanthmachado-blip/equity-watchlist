// Signed-in account: header button, change password, sign out, and (owner only) add / reset / disable / remove accounts.
// Also sends the page back to the sign-in screen whenever the server says the session has ended.
(() => {
  const esc = s => window.ui.esc(s);
  const nativeFetch = window.fetch.bind(window);
  let bounced = false;
  window.fetch = async (input, init) => {
    const r = await nativeFetch(input, init);
    const u = typeof input === "string" ? input : input?.url || "";
    if (r.status === 401 && !bounced && /^\/api\//.test(u.replace(location.origin, "")) && !u.includes("/api/auth/")) {
      // Broker endpoints also answer 401 for "log in to the broker"; only a missing app session carries signIn:true.
      const j = await r.clone().json().catch(() => ({}));
      if (j.signIn) { bounced = true; location.href = "/login"; }
    }
    return r;
  };
  const CACHE_KEYS = ["equity-tracker-v2", "equity-active-list", "equity-dvtab"];
  const clearLocal = () => { try { CACHE_KEYS.forEach(k => localStorage.removeItem(k)); } catch {} };
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  };
  // Other scripts wait on this before deciding whether to seed the owner's default watchlist.
  window.meReady = api("/api/auth/me").then(me => {
    window.ME = me;
    // A different account signed in on this browser: drop the previous account's cached copies.
    try { const last = localStorage.getItem("equity-last-user"); if (last && last !== me.user.id) clearLocal(); localStorage.setItem("equity-last-user", me.user.id); } catch {}
    return me;
  }).catch(() => ({ user: null, seedDefault: false }));

  const genPassword = () => { const a = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; const v = crypto.getRandomValues(new Uint32Array(14)); return [...v].map(x => a[x % a.length]).join(""); };
  const pwField = (label, name, auto = "new-password") => `<label class="ui-field acct-f"><span>${label}</span><input type="password" class="ui-input" name="${name}" autocomplete="${auto}"></label>`;

  async function signOut() {
    try { await api("/api/auth/logout", {}); } catch {}
    clearLocal(); location.href = "/login";
  }
  async function changePassword() {
    await window.ui.dialog({
      title: "Change password", icon: "🔑", okText: "Change password",
      message: "You stay signed in here; every other device is signed out.",
      bodyHtml: pwField("Current password", "current", "current-password") + pwField("New password (10+ characters)", "next") + pwField("Repeat new password", "next2"),
      collect: async box => {
        const v = n => box.querySelector(`[name=${n}]`).value;
        if (v("next") !== v("next2")) throw new Error("The new passwords do not match.");
        await api("/api/auth/password", { current: v("current"), next: v("next") });
        window.toast?.("Password changed.", "ok"); return true;
      }
    });
  }
  function usersHtml(users, meId) {
    return `<div class="acct-users">${users.map(u => `<div class="acct-user${u.disabled ? " off" : ""}">
      <div><b>${esc(u.name)}</b> <small>@${esc(u.username)}</small> ${u.role === "owner" ? '<span class="acct-tag">owner</span>' : ""}${u.disabled ? '<span class="acct-tag off">disabled</span>' : ""}
      <small class="acct-meta">${u.lastLoginAt ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : "Never signed in"}</small></div>
      ${u.id === meId || u.role === "owner" ? "" : `<div class="acct-acts"><button type="button" class="ghost" data-act="reset" data-id="${u.id}">Reset password</button><button type="button" class="ghost" data-act="${u.disabled ? "enable" : "disable"}" data-id="${u.id}">${u.disabled ? "Enable" : "Disable"}</button><button type="button" class="ghost danger-text" data-act="remove" data-id="${u.id}" data-name="${esc(u.username)}">Remove</button></div>`}
    </div>`).join("")}</div>`;
  }
  async function manageAccounts() {
    let users = (await api("/api/auth/users")).users;
    const me = (await window.meReady).user;
    await window.ui.dialog({
      title: "Accounts", icon: "👥", wide: true, okText: "Done", hideCancel: true,
      message: "Each account has its own watchlists, holdings, alerts and broker logins. Nobody, including you, can see another account's data in the app.",
      bodyHtml: `<div id="acctList"></div>
        <p class="ui-sub">Add an account</p>
        <div class="acct-new"><label class="ui-field"><span>Name</span><input class="ui-input" name="name" autocomplete="off"></label>
        <label class="ui-field"><span>Username</span><input class="ui-input" name="username" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
        <label class="ui-field"><span>Temporary password</span><input class="ui-input" name="password" autocomplete="off" spellcheck="false"></label></div>
        <div class="acct-new-act"><button type="button" class="ghost" data-gen>Generate password</button><button type="button" class="primary" data-add>Add account</button></div>
        <p class="ui-hint">Share the username and password with the person directly; ask them to change it from 👤 → Change password.</p>`,
      collect: () => true,
      onOpen: (box, { setError }) => {
        const list = box.querySelector("#acctList");
        const draw = () => { list.innerHTML = usersHtml(users, me.id); };
        draw();
        box.querySelector("[data-gen]").onclick = () => { box.querySelector("[name=password]").value = genPassword(); };
        box.querySelector("[data-add]").onclick = async () => {
          setError("");
          const v = n => box.querySelector(`[name=${n}]`).value;
          try {
            const out = await api("/api/auth/users", { name: v("name"), username: v("username"), password: v("password") });
            users = out.users; draw(); box.querySelectorAll(".acct-new input").forEach(i => { i.value = ""; });
            window.toast?.(`Account @${out.user.username} created.`, "ok");
          } catch (e) { setError(e.message); }
        };
        list.onclick = async e => {
          const b = e.target.closest("[data-act]"); if (!b) return; setError("");
          const id = b.dataset.id, act = b.dataset.act;
          try {
            if (act === "reset") {
              const pw = genPassword();
              users = (await api(`/api/auth/users/${id}/reset`, { password: pw })).users; draw();
              setError(""); list.insertAdjacentHTML("afterbegin", `<p class="acct-pw">New temporary password: <code>${esc(pw)}</code> — share it with them; their other sessions were signed out.</p>`);
              return;
            }
            if (act === "remove" && !b.dataset.armed) {
              // Two-step confirm inside this dialog (a second dialog would close this one).
              b.dataset.armed = "1"; b.textContent = "Delete their data?"; b.classList.add("armed");
              setError(`Press "Delete their data?" to remove @${b.dataset.name} and permanently delete their watchlists, holdings and broker logins.`);
              setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Remove"; b.classList.remove("armed"); } }, 5000);
              return;
            }
            users = (await api(`/api/auth/users/${id}/${act}`, {})).users; draw();
          } catch (err) { setError(err.message); }
        };
      }
    });
  }
  // ---- Sign-in activity: devices signed in now, recent sign-ins and wrong passwords, sign out others ----
  const when = t => new Date(t).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const rel = t => { const m = (Date.now() - t) / 60e3; return m < 2 ? "active now" : m < 60 ? `${Math.round(m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const where = x => [x.place, x.ip].filter(Boolean).map(esc).join(" · ") || "location unknown";
  const icon = d => /iPhone|Android/.test(d) ? "📱" : /iPad/.test(d) ? "📲" : /Script/.test(d) ? "🤖" : "💻";
  function activityHtml(a) {
    const others = a.sessions.filter(x => !x.current).length;
    return `<p class="ui-sub" style="margin-top:0">Signed in now · ${a.sessions.length} device${a.sessions.length === 1 ? "" : "s"}</p>
      ${others ? `<button type="button" class="ghost act-all" data-revoke-all>⏏ Sign out all other devices (${others})</button>` : ""}
      <div class="act-list">${a.sessions.map(x => `<div class="act-row${x.current ? " current" : ""}"><span class="act-ico">${icon(x.device)}</span>
        <div class="act-main"><b>${esc(x.device)}</b>${x.current ? ' <span class="acct-tag">this device</span>' : ""}<small>${where(x)} · signed in ${when(x.signedInAt)} · ${rel(x.lastSeen)}</small></div>
        ${x.current ? "" : `<button type="button" class="ghost danger-text" data-revoke="${esc(x.id)}">Sign out</button>`}</div>`).join("")}</div>
      <p class="ui-sub">Recent activity</p>
      <div class="act-events">${a.events.length ? a.events.map(e => `<div class="act-ev ${e.kind === "wrong password" ? "bad" : ""}"><span>${e.kind === "wrong password" ? "⚠️" : e.kind.startsWith("signed out") ? "⏏" : e.kind === "password changed" ? "🔑" : "✓"}</span><div><b>${esc(e.kind[0].toUpperCase() + e.kind.slice(1))}</b> · ${esc(e.device)}<small>${when(e.at)} · ${where(e)}</small></div></div>`).join("") : '<p class="ui-hint">No sign-ins recorded yet.</p>'}</div>
      <p class="ui-hint">Don't recognise a device or place? Sign out all other devices, then change your password. Location appears when the app runs behind CloudFront or Cloudflare; otherwise the network address is shown.</p>`;
  }
  async function activity() {
    let a = await api("/api/auth/activity");
    await window.ui.dialog({
      title: "Sign-in activity", icon: "🛡️", okText: "Done", hideCancel: true, wide: true, bodyHtml: `<div id="actBody">${activityHtml(a)}</div>`,
      onOpen: (box, { setError }) => box.querySelector("#actBody").addEventListener("click", async e => {
        const one = e.target.closest("[data-revoke]"), all = e.target.closest("[data-revoke-all]"); if (!one && !all) return;
        setError("");
        try {
          a = await api("/api/auth/revoke", all ? { others: true } : { id: one.dataset.revoke });
          box.querySelector("#actBody").innerHTML = activityHtml(a);
          window.toast?.(`Signed out ${a.signedOut} device${a.signedOut === 1 ? "" : "s"}.`, { kind: "ok", ms: 3500 });
        } catch (err) { setError(err.message); }
      })
    });
  }

  // ---- Backup / restore (one JSON file with everything in this account) ----
  async function backupRestore() {
    await window.ui.dialog({
      title: "Backup & restore", icon: "💾", okText: "Close", hideCancel: true, wide: true,
      message: "A backup is one file with this account's watchlists, holdings, net worth, goals, alerts, plans, fund X-rays and tradebook. Keep it somewhere safe (Google Drive, a USB disk).",
      bodyHtml: `<div class="bk-box"><b>Download a backup</b>
          <label class="ui-opt"><input type="checkbox" name="secrets"><span><b>Include broker logins and saved API keys</b><small>Only if you are moving to a new server. Anyone with the file could use these logins, so store it like a password.</small></span></label>
          <button type="button" class="primary" data-dl>⬇ Download backup</button></div>
        <div class="bk-box"><b>Restore from a backup</b>
          <p class="ui-hint" style="margin:4px 0 10px">Files in the backup replace the same files here. What is here now is saved first, so a restore can be undone by the server admin.</p>
          <label class="ui-opt"><input type="checkbox" name="replace"><span><b>Remove data that is not in the backup</b><small>Off: keeps anything newer that the backup does not have.</small></span></label>
          <input type="file" accept=".json,application/json" name="file" hidden><button type="button" class="ghost" data-pick>⬆ Choose backup file…</button> <span class="ui-hint" data-st></span></div>`,
      onOpen: (box, { setError }) => {
        box.querySelector("[data-dl]").onclick = () => { const a = document.createElement("a"); a.href = `/api/backup?secrets=${box.querySelector("[name=secrets]").checked ? 1 : 0}`; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); window.toast?.("Backup downloaded.", { kind: "ok", ms: 3000 }); };
        const file = box.querySelector("[name=file]"), st = box.querySelector("[data-st]");
        box.querySelector("[data-pick]").onclick = () => file.click();
        file.onchange = async () => {
          const f = file.files[0]; if (!f) return; setError("");
          let backup; try { backup = JSON.parse(await f.text()); } catch { setError("That file is not a backup from this app."); return; }
          if (backup?.kind !== "account-backup") { setError("That file is not a backup from this app."); return; }
          const n = Object.keys(backup.files || {}).length;
          st.innerHTML = `${esc(f.name)}: ${n} files from @${esc(backup.account || "?")}, ${new Date(backup.createdAt).toLocaleString("en-IN")}. <button type="button" class="primary" data-go>Restore now</button>`;
          st.querySelector("[data-go]").onclick = async () => {
            try { const r = await api("/api/restore", { backup, replace: box.querySelector("[name=replace]").checked }); clearLocal(); st.textContent = `Restored ${r.restored.length} files. Reloading…`; setTimeout(() => location.reload(), 900); }
            catch (e) { setError(e.message); }
          };
        };
      }
    });
  }
  // ---- Install as an app (Android / desktop Chrome & Edge prompt; iPhone: Share → Add to Home Screen) ----
  let installEvt = null;
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; });
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  async function install() {
    if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); installEvt = null; if (r?.outcome === "accepted") window.toast?.("Installed. Open it from your home screen or app list.", { kind: "ok" }); return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    await window.ui.alert({ title: "Install the app", icon: "📲", message: ios ? "In Safari, tap the <b>Share</b> button, then <b>Add to Home Screen</b>." : "Use your browser's menu: <b>Install app</b> / <b>Add to Home screen</b> (Chrome, Edge). The app must be opened over https (or on localhost) for this to appear." });
  }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));

  async function openMenu() {
    const me = (await window.meReady).user; if (!me) return signOut();
    const owner = me.role === "owner";
    await window.ui.dialog({
      title: me.name, icon: "👤", okText: "Close", hideCancel: true,
      message: `Signed in as <b>@${esc(me.username)}</b>${owner ? " · owner" : ""}. Your holdings, watchlists and broker logins are visible only to this account.`,
      bodyHtml: `<div class="acct-menu">
        <button type="button" class="ghost" data-a="pw">🔑 Change password</button>
        <button type="button" class="ghost" data-a="activity">🛡️ Sign-in activity</button>
        <button type="button" class="ghost" data-a="backup">💾 Backup &amp; restore</button>
        ${standalone() ? "" : '<button type="button" class="ghost" data-a="install">📲 Install as an app</button>'}
        ${owner ? '<button type="button" class="ghost" data-a="users">👥 Manage accounts</button>' : ""}
        <button type="button" class="ghost" data-a="out">↪ Sign out</button></div>`,
      onOpen: box => box.querySelector(".acct-menu").addEventListener("click", e => {
        const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
        const run = { pw: changePassword, users: manageAccounts, out: signOut, backup: backupRestore, install, activity }[a];
        // Close this menu, then open the next dialog.
        box.closest(".ui-scrim").querySelector('[data-ui="ok"]').click(); setTimeout(run, 180);
      })
    });
  }
  async function mountButton() {
    const me = (await window.meReady).user; if (!me) return;
    const bar = document.querySelector(".header-actions"); if (!bar || document.getElementById("acctBtn")) return;
    const b = document.createElement("button");
    b.id = "acctBtn"; b.type = "button"; b.className = "ghost acct-btn"; b.title = "Your account";
    b.innerHTML = `<span aria-hidden="true">👤</span> <span class="acct-name">${esc(me.name)}</span>`;
    b.onclick = openMenu; bar.prepend(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountButton); else mountButton();
  window.account = { openMenu, signOut, manageAccounts, changePassword, backupRestore, install, activity };
})();
