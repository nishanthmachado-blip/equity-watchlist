(async () => {
  const $ = s => document.querySelector(s);
  const post = async (url, body) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
    return j;
  };
  const show = (el, msg) => { el.textContent = msg; el.hidden = !msg; };
  const go = () => { try { localStorage.removeItem("equity-watchlist-cache-owner"); } catch {} location.replace("/"); };
  let state = { needsSetup: false };
  try { state = await (await fetch("/api/auth/state", { credentials: "same-origin" })).json(); } catch {}
  if (state.user) return go();
  const form = state.needsSetup ? $("#setupForm") : $("#loginForm");
  form.hidden = false; form.querySelector("input").focus();
  $("#loginForm").onsubmit = async e => {
    e.preventDefault(); const btn = e.target.querySelector("button"); btn.disabled = true; show($("#loginErr"), "");
    try { await post("/api/auth/login", { username: $("#lu").value, password: $("#lp").value }); go(); }
    catch (err) { show($("#loginErr"), err.message); $("#lp").select(); }
    finally { btn.disabled = false; }
  };
  $("#setupForm").onsubmit = async e => {
    e.preventDefault(); show($("#setupErr"), "");
    if ($("#sp").value !== $("#sp2").value) return show($("#setupErr"), "The two passwords do not match.");
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try { await post("/api/auth/setup", { code: $("#sc").value, name: $("#sn").value, username: $("#su").value, password: $("#sp").value }); go(); }
    catch (err) { show($("#setupErr"), err.message); }
    finally { btn.disabled = false; }
  };
})();
