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
      <div><b>${esc(u.name)}</b> <small>@${esc(u.username)}</small> ${u.role === "owner" ? '<span class="acct-tag">owner</span>' : ""}${u.disabled ? '<span class="acct-tag off">disabled</span>' : ""}${u.twoStep ? '<span class="acct-tag">🔐 2-step</span>' : ""}
      <small class="acct-meta">${u.lastLoginAt ? `Last sign-in ${new Date(u.lastLoginAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : "Never signed in"}</small></div>
      ${u.id === meId || u.role === "owner" ? "" : `<div class="acct-acts"><button type="button" class="ghost" data-act="reset" data-id="${u.id}">Reset password</button><button type="button" class="ghost" data-act="${u.disabled ? "enable" : "disable"}" data-id="${u.id}">${u.disabled ? "Enable" : "Disable"}</button>${u.twoStep ? `<button type="button" class="ghost" data-act="reset-2fa" data-id="${u.id}" title="For someone who lost their phone and recovery codes">Reset 2-step</button>` : ""}<button type="button" class="ghost danger-text" data-act="remove" data-id="${u.id}" data-name="${esc(u.username)}">Remove</button></div>`}
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
            if (act === "reset-2fa") { users = (await api(`/api/auth/users/${id}/reset-2fa`, {})).users; draw(); setError(""); list.insertAdjacentHTML("afterbegin", '<p class="acct-pw">Two-step sign-in is off for them now: ask them to turn it on again from 👤 → Two-step sign-in. It shows in their sign-in history.</p>'); return; }
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
          <input type="file" accept=".json,application/json" name="file" hidden><button type="button" class="ghost" data-pick>⬆ Choose backup file…</button> <span class="ui-hint" data-st></span></div>
        <div class="bk-box" data-auto><b>Automatic daily backups</b><p class="ui-hint">Loading…</p></div>`,
      onOpen: (box, { setError }) => {
        box.querySelector("[data-dl]").onclick = () => { const a = document.createElement("a"); a.href = `/api/backup?secrets=${box.querySelector("[name=secrets]").checked ? 1 : 0}`; a.download = ""; document.body.appendChild(a); a.click(); a.remove(); window.toast?.("Backup downloaded.", { kind: "ok", ms: 3000 }); };
        // automatic backups: list, restore one, (owner) run now
        const autoBox = box.querySelector("[data-auto]");
        const paintAuto = async () => {
          let x; try { x = await api("/api/backups"); } catch (e) { autoBox.innerHTML = `<b>Automatic daily backups</b><p class="ui-hint">${esc(e.message)}</p>`; return; }
          const s = x.status, mine = s?.mine;
          autoBox.innerHTML = `<b>Automatic daily backups</b><p class="ui-hint" style="margin:4px 0 8px">Every night at about 2:30 am the server saves a copy of every account (broker logins left out), keeps ${x.keepDays} days${x.s3 ? " and copies them to S3" : ""}, and checks each file opens.${s ? ` Last run ${new Date(s.at).toLocaleString("en-IN")}: ${mine ? `${mine.files} files${mine.checked ? ", checked ✓" : ""}${mine.s3 ? ", copied to S3 ✓" : mine.s3Error ? `, S3 failed: ${esc(mine.s3Error)}` : ""}` : "your account was not included"}.` : " No automatic backup has run yet."}${x.owner && s?.errors?.length ? ` <span class="avoid">Problems: ${esc(s.errors.join("; "))}</span>` : ""}</p>
            ${x.list.length ? `<div class="bk-list">${x.list.slice(0, 10).map(b => `<span>${esc(b.day)} <small>${Math.round(b.bytes / 1024)} KB</small> <button type="button" class="linklike" data-restore-day="${esc(b.day)}">Restore</button></span>`).join("")}</div>` : ""}
            ${x.owner ? `<button type="button" class="ghost" data-run-backup>Back up every account now</button>${s?.dir ? ` <span class="ui-hint">Folder: ${esc(s.dir)}</span>` : ""}` : ""}`;
          autoBox.querySelector("[data-run-backup]")?.addEventListener("click", async e => { e.target.disabled = true; e.target.textContent = "Backing up…"; try { await api("/api/backups/run", {}); } catch (err) { setError(err.message); } paintAuto(); });
          autoBox.querySelectorAll("[data-restore-day]").forEach(b => { b.onclick = async () => { if (!(await window.ui.confirm({ title: `Restore the backup of ${b.dataset.restoreDay}?`, message: "Your account goes back to that day. What is here now is saved first, so this can be undone by the server admin.", okText: "Restore", danger: true }))) return; try { const r = await api("/api/backups/restore", { day: b.dataset.restoreDay }); clearLocal(); window.toast?.(`Restored ${r.restored} files from ${r.day}. Reloading…`, { kind: "ok" }); setTimeout(() => location.reload(), 900); } catch (err) { setError(err.message); } }; });
        };
        paintAuto();
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

  // ---- Security check: what protects this account and this server, and what to fix ----
  async function securityCheck() {
    let x; try { x = await api("/api/auth/security"); } catch (e) { return window.toast?.(esc(e.message), { kind: "bad" }); }
    const row = (ok, title, text) => `<div class="sec-row ${ok ? "ok" : "warn"}"><span>${ok ? "✅" : "⚠️"}</span><div><b>${title}</b><small>${text}</small></div></div>`;
    await window.ui.dialog({
      title: "Security check", icon: "🔒", okText: "Close", hideCancel: true, wide: true,
      bodyHtml: `<div class="sec-list">
        ${row(x.https, "HTTPS", x.https ? "This connection is encrypted and the sign-in cookie is sent over HTTPS only." : "This page was opened over plain HTTP. Fine on this computer; on a network or the internet, put the app behind HTTPS (see DEPLOYMENT.md).")}
        ${row(x.twoStep.on, "Two-step sign-in", x.twoStep.on ? `On. ${x.twoStep.recoveryLeft} recovery codes left.` : "Off. Turn it on (👤 → Two-step sign-in) so a stolen password alone can't open your account.")}
        ${row(x.secrets.encrypted, "Broker logins and keys encrypted at rest", x.secrets.encrypted ? "API keys, PINs, TOTP secrets, session tokens and bot tokens are stored encrypted (AES-256-GCM)." : "Not encrypted.")}
        ${x.owner ? row(x.secrets.strong, "Encryption key kept apart from the data", x.secrets.strong ? `The key comes from ${esc(x.secrets.source)}, outside the data folder / database, so a stolen database copy cannot be decrypted.` : "The key is generated and kept with the data, so a full copy of the data folder / database could be decrypted. Set SECRETS_KEY (a long random string) in .env or the server environment and restart: everything is re-sealed with it automatically (no need to log in to brokers again) and the stored key is removed.") : ""}
        ${row(true, "Brokers are read-only", "Every broker request is checked against a list of read-only endpoints; anything about orders is refused.")}
        ${row(true, "Your data is private to your login", "Holdings, watchlists, trades, funds and broker logins are kept per account; nobody else can read them.")}</div>`
    });
  }
  // ---- Two-step sign-in: a 6-digit code from an authenticator app after the password ----
  let qrLib = null;
  const loadQr = () => qrLib ||= new Promise((ok, no) => { if (window.qrcode) return ok(window.qrcode); const sc = document.createElement("script"); sc.src = "vendor/qrcode-generator-1.4.4.js"; sc.onload = () => ok(window.qrcode); sc.onerror = () => { qrLib = null; no(new Error("could not load")); }; document.head.append(sc); });
  const codeField = (label = "6-digit code from the app") => `<label class="ui-field acct-f"><span>${label}</span><input class="ui-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="11" spellcheck="false"></label>`;
  async function twoStep() {
    let st; try { st = await api("/api/auth/2fa"); } catch (e) { return window.toast?.(esc(e.message), { kind: "bad" }); }
    if (st.on) {
      return window.ui.dialog({
        title: "Two-step sign-in is on", icon: "🔐", okText: "Turn it off", danger: true, cancelText: "Keep it on",
        message: `Since ${new Date(st.since).toLocaleDateString("en-IN", { dateStyle: "medium" })}. Signing in asks for your password and then the 6-digit code from your authenticator app. ${st.recoveryLeft} of 8 recovery codes left.`,
        bodyHtml: `<p class="ui-hint">To turn it off, confirm with your password and a current code (or a recovery code).</p>${pwField("Password", "password", "current-password")}${codeField("Code from the app, or a recovery code")}`,
        collect: async box => { const v = n => box.querySelector(`[name=${n}]`).value; await api("/api/auth/2fa/disable", { password: v("password"), code: v("code") }); window.toast?.("Two-step sign-in turned off.", { kind: "ok" }); if (window.ME?.user) window.ME.user.twoStep = false; return true; }
      });
    }
    let setup; try { setup = await api("/api/auth/2fa/setup", {}); } catch (e) { return window.toast?.(esc(e.message), { kind: "bad" }); }
    let qrImg = "";
    try { const q = (await loadQr())(0, "M"); q.addData(setup.uri); q.make(); qrImg = q.createDataURL(5, 8); } catch { /* show the key only */ }
    const done = await window.ui.dialog({
      title: "Turn on two-step sign-in", icon: "🔐", okText: "Turn on", wide: true,
      message: "After your password, the app will ask for a 6-digit code from an authenticator app on your phone (Google Authenticator, Microsoft Authenticator, Authy, 1Password…). Someone who learns your password still can't get in.",
      bodyHtml: `<div class="mfa-setup">${qrImg ? `<img class="mfa-qr" src="${qrImg}" alt="QR code to scan with your authenticator app" width="200" height="200">` : ""}
        <div><p class="ui-hint"><b>1.</b> In the app, add an account and scan this code${qrImg ? "" : " (or type the key)"}.<br>Can't scan? Enter this key (time-based):</p><code class="mfa-key">${esc(setup.secret)}</code>
        <p class="ui-hint"><b>2.</b> Type the 6-digit code the app shows:</p>${codeField()}</div></div>`,
      collect: async box => { const r = await api("/api/auth/2fa/enable", { code: box.querySelector("[name=code]").value }); return r; }
    });
    if (!done?.recoveryCodes) return;
    if (window.ME?.user) window.ME.user.twoStep = true;
    const text = `Equity Watchlist recovery codes for @${window.ME?.user?.username || ""}\nEach works once, instead of a code from the app.\n\n${done.recoveryCodes.join("\n")}\n`;
    await window.ui.dialog({
      title: "Save your recovery codes", icon: "🧾", okText: "I've saved them", hideCancel: true,
      message: "If you lose your phone, each of these codes lets you sign in once. Keep them somewhere safe (a password manager, or printed). They are shown only now.",
      bodyHtml: `<pre class="mfa-codes">${done.recoveryCodes.map(esc).join("\n")}</pre><div class="mfa-acts"><button type="button" class="ghost" data-copy>Copy</button><button type="button" class="ghost" data-dl>Download .txt</button></div>`,
      onOpen: box => {
        box.querySelector("[data-copy]").onclick = async e => { try { await navigator.clipboard.writeText(text); e.target.textContent = "Copied"; } catch { e.target.textContent = "Select and copy the codes"; } };
        box.querySelector("[data-dl]").onclick = () => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = "equity-watchlist-recovery-codes.txt"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
      }
    });
    window.toast?.("Two-step sign-in is on.", { kind: "ok" });
  }
  async function openMenu() {
    const me = (await window.meReady).user; if (!me) return signOut();
    const owner = me.role === "owner";
    await window.ui.dialog({
      title: me.name, icon: "👤", okText: "Close", hideCancel: true,
      message: `Signed in as <b>@${esc(me.username)}</b>${owner ? " · owner" : ""}. Your holdings, watchlists and broker logins are visible only to this account.`,
      bodyHtml: `<div class="acct-menu">
        <button type="button" class="ghost" data-a="pw">🔑 Change password</button>
        <button type="button" class="ghost" data-a="mfa">🔐 Two-step sign-in${me.twoStep ? " · on" : ""}</button>
        <button type="button" class="ghost" data-a="activity">🛡️ Sign-in activity</button>
        <button type="button" class="ghost" data-a="check">🔒 Security check</button>
        <button type="button" class="ghost" data-a="backup">💾 Backup &amp; restore</button>
        ${standalone() ? "" : '<button type="button" class="ghost" data-a="install">📲 Install as an app</button>'}
        ${owner ? '<button type="button" class="ghost" data-a="users">👥 Manage accounts</button>' : ""}
        <button type="button" class="ghost" data-a="out">↪ Sign out</button></div>`,
      onOpen: box => box.querySelector(".acct-menu").addEventListener("click", e => {
        const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
        const run = { pw: changePassword, users: manageAccounts, out: signOut, backup: backupRestore, install, activity, mfa: twoStep, check: securityCheck }[a];
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
