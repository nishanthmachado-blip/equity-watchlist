// Ask AI: a chat panel on every screen. Claude (your own Anthropic key) or another provider you pick (Gemini / Groq /
// OpenRouter free tiers, OpenAI, Ollama on your computer; keys kept encrypted on your server) answers with your
// holdings, swing positions, dip list and upcoming events in view, and can look up one stock's valuation, technicals or
// hold-or-sell scenarios through the app. window.askAI(question, focus) opens it from anywhere.
(() => {
  const $ = s => document.querySelector(s), esc = s => window.ui.esc(s);
  const api = async (url, body) => {
    const r = await fetch(url, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`); return j;
  };
  let status = null, chatId = null, busy = false, ctl = null, panel = null, messages = [];

  // small, safe markdown: escape first, then headings, bold, code, lists, tables, paragraphs
  function md(src) {
    const inline = t => esc(t).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    const lines = String(src || "").replace(/\r/g, "").split("\n"), out = []; let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] || "")) {
        const row = x => x.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
        const head = row(l); i += 2; const body = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
        out.push(`<div class="ai-tw"><table><thead><tr>${head.map(h => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
        continue;
      }
      const h = l.match(/^(#{1,4})\s+(.*)$/); if (h) { out.push(`<h${Math.min(6, h[1].length + 3)}>${inline(h[2])}</h${Math.min(6, h[1].length + 3)}>`); i++; continue; }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        const ordered = /^\s*\d+[.)]/.test(l), items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        out.push(`<${ordered ? "ol" : "ul"}>${items.map(x => `<li>${inline(x)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`); continue;
      }
      if (/^\s*(---|\*\*\*)\s*$/.test(l)) { out.push("<hr>"); i++; continue; }
      if (!l.trim()) { i++; continue; }
      const para = []; while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*([-*•]|\d+[.)])\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
      if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`); else i++;
    }
    return out.join("");
  }

  function ensurePanel() {
    if (panel) return panel;
    const fab = document.createElement("button"); fab.type = "button"; fab.className = "ai-fab"; fab.id = "aiFab"; fab.title = "Ask AI about your portfolio"; fab.innerHTML = "<span>✨</span><b>Ask AI</b>";
    fab.onclick = () => open(); document.body.appendChild(fab);
    panel = document.createElement("aside"); panel.className = "ai-panel"; panel.hidden = true; panel.setAttribute("aria-label", "Ask AI");
    panel.innerHTML = `<div class="ai-head"><div><b>✨ Ask AI</b><small data-model></small></div><div class="ai-head-acts"><button type="button" class="ghost" data-new title="New conversation">＋</button><button type="button" class="ghost" data-chats title="Past conversations">🗂</button><button type="button" class="ghost" data-settings title="Settings: key, model, privacy">⚙</button><button type="button" class="ghost" data-close title="Close">✕</button></div></div>
      <div class="ai-body" data-body></div>
      <div class="ai-foot"><div class="ai-quick" data-quick></div><form data-form><textarea data-q rows="2" placeholder="Ask about a buy, a swing trade, your dip list or your portfolio…" maxlength="4000"></textarea><button type="submit" class="primary" data-send>Send</button></form><div class="ai-fine" data-fine></div></div>`;
    document.body.appendChild(panel);
    panel.querySelector("[data-close]").onclick = () => { panel.hidden = true; document.body.classList.remove("ai-open"); };
    panel.querySelector("[data-new]").onclick = () => { if (busy) return; chatId = null; messages = []; renderChat(); };
    panel.querySelector("[data-settings]").onclick = () => renderSettings();
    panel.querySelector("[data-chats]").onclick = () => renderChats();
    panel.querySelector("[data-form]").onsubmit = e => { e.preventDefault(); const q = panel.querySelector("[data-q]"); if (q.value.trim()) { ask(q.value.trim()); q.value = ""; } };
    panel.querySelector("[data-q]").addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); panel.querySelector("[data-form]").requestSubmit(); } });
    panel.querySelector("[data-quick]").addEventListener("click", e => { const b = e.target.closest("[data-p]"); if (b) ask(b.dataset.p); });
    panel.querySelector("[data-body]").addEventListener("click", async e => {
      const c = e.target.closest("[data-open-chat]"); if (c) { const all = (await api("/api/ai/chats")).chats, ch = all.find(x => x.id === c.dataset.openChat); if (ch) { chatId = ch.id; messages = ch.messages.map(m => ({ role: m.role, text: m.text, meta: m.tools?.length ? `looked at: ${m.tools.join(", ")}` : "" })); renderChat(); } return; }
      const d = e.target.closest("[data-del-chat]"); if (d) { await api("/api/ai/chats/delete", { id: d.dataset.delChat }); if (chatId === d.dataset.delChat) { chatId = null; messages = []; } renderChats(); return; }
      if (e.target.closest("[data-go-settings]")) renderSettings();
    });
    return panel;
  }
  const quick = () => {
    const sw = window.__swingData, out = [["📊 Review my swing trades", "Go through my swing positions one by one: for each, book profit, hold, add or cut? Use targets, stops, trend and upcoming results / dividends. Finish with the 2–3 actions that matter most this week."],
      ["📉 Which dips to buy?", "Look at my buy-the-dip list and swing watchlist. Which of these are worth buying now or at my level (value buy) and which look like falling knives? Rank them and say how much of my planned amount to put in each."],
      ["🔎 Best swing setup this week", "From today's swing ideas and my watchlists, pick the best 3 swing trades for the next 2–4 weeks with entry, stop, target and position size for my swing cash. Avoid stocks with results inside the holding period unless that is the play."],
      ["🧭 Portfolio check-up", "Review my long-term holdings and overall mix: concentration, overvalued holdings to trim, undervalued ones to add, sector overlap with my mutual funds, and anything that needs attention. Keep it to the top 5 points."],
      ["💰 Where to put ₹1 L?", "I have ₹1,00,000 to invest now. Given what I hold and current valuations, where should it go (stocks, ETF or fund) and why? Give a concrete split."]];
    const div = (sw?.positions || []).find(p => (p.events?.items || []).some(e => /dividend/i.test(e.text || "") && !/went ex-dividend/i.test(e.text || "")) && p.pnl > 0);
    if (div) out.splice(1, 0, [`⚖ ${div.symbol}: book or wait for dividend?`, `Should I book my ${div.symbol} swing profit now or hold until the dividend? Use the hold-or-sell numbers and the risk of the market falling.`]);
    return out;
  };
  function renderQuick() { panel.querySelector("[data-quick]").innerHTML = messages.length ? "" : quick().map(([l, p]) => `<button type="button" class="pf-chip" data-p="${esc(p)}">${esc(l)}</button>`).join(""); }
  function renderFine() {
    const s = status; if (!s) return;
    panel.querySelector("[data-model]").textContent = s.configured ? ` ${(s.models.find(m => m.id === s.model)?.label || s.model).split(" (")[0]}` : "";
    panel.querySelector("[data-fine]").innerHTML = s.configured ? `Sends a summary of your portfolio (${s.privacy === "percent" ? "amounts as % only" : "with amounts"}, no account names, IDs or PAN) to Anthropic with each question · <a href="#" data-preview>see exactly what</a> · ${(s.usage.input + s.usage.output).toLocaleString("en-IN")} of ${s.monthlyTokens.toLocaleString("en-IN")} tokens used this month` : "";
    const pv = panel.querySelector("[data-preview]"); if (pv) pv.onclick = e => { e.preventDefault(); preview(); };
  }
  function renderChat() {
    const body = panel.querySelector("[data-body]");
    if (!status?.configured) return renderSettings();
    body.innerHTML = messages.length ? messages.map(m => `<div class="ai-msg ${m.role}">${m.role === "user" ? `<p>${esc(m.text)}</p>` : md(m.text) || '<p class="hint">…</p>'}${m.meta ? `<div class="ai-meta">${esc(m.meta)}</div>` : ""}</div>`).join("") + (busy ? `<div class="ai-status" data-status>…</div>` : "")
      : `<div class="ai-empty"><h3>Your co-pilot for buys and swing trades</h3><p>The AI sees your holdings, swing positions, dip list, US stocks, funds and upcoming results / dividends, and can look up any stock's valuation and chart in this app. Ask anything, or start with one of these:</p></div>`;
    renderQuick(); renderFine(); body.scrollTop = body.scrollHeight;
  }
  function renderSettings(pick = null) {
    const s = status, body = panel.querySelector("[data-body]"), provs = s?.providers || [{ id: "anthropic", label: "Claude (Anthropic)" }];
    const pid = pick || s?.provider || "anthropic", p = provs.find(x => x.id === pid) || provs[0], isCur = pid === (s?.provider || "anthropic"), anth = pid === "anthropic";
    panel.querySelector("[data-quick]").innerHTML = "";
    const models = isCur ? s?.models || [] : [];
    body.innerHTML = `<div class="ai-settings">
      <h3>${s?.configured ? "Settings" : "Connect an AI"}</h3>
      <label class="ui-field"><span>AI provider</span><select class="ui-input" data-prov>${provs.map(x => `<option value="${esc(x.id)}"${x.id === pid ? " selected" : ""}>${esc(x.label)}${x.ready && x.id !== s?.provider ? " ✓" : ""}${x.id === s?.provider ? " (in use)" : ""}</option>`).join("")}</select></label>
      <p class="hint">${p.free ? "🆓 " : ""}Get a key: <b>${esc(p.where || "")}</b>. ${esc(p.privacy || "")}</p>
      ${p.baseEditable ? `<label class="ui-field"><span>Server address</span><input class="ui-input" data-base value="${esc(p.base || "")}" placeholder="http://127.0.0.1:11434/v1"></label>` : ""}
      ${p.keyless ? "" : `<label class="ui-field"><span>${esc(p.label.split(" (")[0])} API key ${p.savedHint ? `(saved: ${esc(p.savedHint)})` : ""}</span><input class="ui-input" type="password" data-key placeholder="${esc(p.keyHint || "")}" autocomplete="off"></label>`}
      <div class="toolbar"><button type="button" class="primary" data-save-key>${anth ? (p.savedHint ? "Replace key" : "Save key") : isCur && s?.configured ? (p.keyless ? "Refresh models" : "Save / refresh") : "Connect and use this"}</button>${p.savedHint ? '<button type="button" class="ghost danger-text" data-remove-key>Remove key</button>' : ""}${anth && !isCur && p.hasKey ? '<button type="button" class="ghost" data-use>Use Claude</button>' : ""}<span class="hint" data-st></span></div>
      ${isCur ? `<label class="ui-field"><span>Model</span><select class="ui-input" data-model-sel>${models.map(m => `<option value="${esc(m.id)}"${m.id === s.model ? " selected" : ""}>${esc(m.label)}</option>`).join("")}${s && s.model && !models.some(m => m.id === s.model) ? `<option value="${esc(s.model)}" selected>${esc(s.model)}</option>` : ""}</select></label>
      <label class="ui-field"><span>What the AI sees</span><select class="ui-input" data-privacy>${Object.entries(s?.privacyOptions || {}).map(([k, v]) => `<option value="${k}"${k === s.privacy ? " selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
      <label class="ui-field"><span>Monthly limit (tokens; a question is usually 5,000–20,000)</span><input class="ui-input" data-limit inputmode="numeric" value="${s?.monthlyTokens ?? ""}"></label>
      <div class="toolbar"><button type="button" class="ghost" data-save-set>Save settings</button><button type="button" class="ghost" data-pv>👁 See what gets sent</button>${s?.configured ? '<button type="button" class="ghost" data-back>← Back to chat</button>' : ""}</div>` : ""}
      <p class="hint"><b>Privacy:</b> each question sends a summary of your portfolio from this server straight to the AI provider you picked (never through the browser): stock symbols, prices and ${s?.privacy === "percent" ? "only percentages" : "quantities and amounts"}; never account names, client IDs, broker logins, PAN, email or folio numbers, and nothing about other users of this app. When the AI asks about one stock, the lookup runs here and only its result is sent. Keys are stored encrypted on your server and left out of backups.</p>
      <p class="hint">ChatGPT itself can't be plugged in: its app has no free API. OpenAI's API (the same models) is paid. For free answers use Gemini's or Groq's free tier, a free OpenRouter model, or Ollama on your own computer (fully private). Answers are a second opinion built on the app's numbers, not financial advice.</p></div>`;
    const st = body.querySelector("[data-st]");
    body.querySelector("[data-prov]").onchange = e => renderSettings(e.target.value);
    body.querySelector("[data-save-key]").onclick = async () => {
      const key = body.querySelector("[data-key]")?.value || "";
      st.textContent = `Checking with ${p.label.split(" (")[0]}…`;
      try {
        if (anth) { if (key || !p.hasKey) status = await api("/api/ai/key", { key }); status = await api("/api/ai/provider", { provider: "anthropic" }); }
        else { const out = await api("/api/ai/provider", { provider: pid, key, ...(p.baseEditable ? { base: body.querySelector("[data-base]").value } : {}) }); status = out; if (out.notice) window.toast?.(out.notice, { kind: "ok", ms: 4000 }); }
        st.textContent = "✓ Connected"; renderFine(); setTimeout(() => renderSettings(), 500);
      } catch (e) { st.textContent = e.message; }
    };
    const use = body.querySelector("[data-use]"); if (use) use.onclick = async () => { status = await api("/api/ai/provider", { provider: "anthropic" }); renderFine(); renderSettings(); };
    const rm = body.querySelector("[data-remove-key]"); if (rm) rm.onclick = async () => { if (!await window.ui.confirm({ title: "Remove this API key?", message: "Ask AI stops working with this provider until you add a key again.", okText: "Remove", danger: true })) return; status = anth ? await api("/api/ai/key", { remove: true }) : await api("/api/ai/provider-key-remove", { provider: pid }); renderSettings(pid); };
    const ss = body.querySelector("[data-save-set]"); if (ss) ss.onclick = async () => { try { status = await api("/api/ai/settings", { model: body.querySelector("[data-model-sel]").value, privacy: body.querySelector("[data-privacy]").value, monthlyTokens: body.querySelector("[data-limit]").value }); window.toast?.("AI settings saved.", { kind: "ok" }); renderFine(); } catch (e) { window.toast?.(e.message, { kind: "error" }); } };
    const pv = body.querySelector("[data-pv]"); if (pv) pv.onclick = () => preview(body.querySelector("[data-privacy]").value);
    const back = body.querySelector("[data-back]"); if (back) back.onclick = () => renderChat();
  }
  async function renderChats() {
    const body = panel.querySelector("[data-body]"); panel.querySelector("[data-quick]").innerHTML = "";
    const { chats } = await api("/api/ai/chats");
    body.innerHTML = `<div class="ai-settings"><h3>Past conversations</h3>${chats.length ? `<ul class="ai-chats">${chats.map(c => `<li><button type="button" class="linklike" data-open-chat="${esc(c.id)}">${esc(c.title)}</button><small>${new Date(c.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · ${Math.ceil(c.messages.length / 2)} question${c.messages.length > 2 ? "s" : ""}</small><button type="button" class="ghost danger-text" data-del-chat="${esc(c.id)}" title="Delete">✕</button></li>`).join("")}</ul>` : '<p class="hint">None yet.</p>'}<p class="hint">Stored only in your account on this server (the last 30).</p><button type="button" class="ghost" data-back2>← Back</button></div>`;
    body.querySelector("[data-back2]").onclick = () => renderChat();
  }
  async function preview(privacy) {
    const p = await api(`/api/ai/preview${privacy ? `?privacy=${privacy}` : ""}`);
    window.ui.dialog({ title: "What the AI sees with each question", icon: "👁", okText: "Close", wide: true, message: `About ${p.approxTokens.toLocaleString("en-IN")} tokens. Plus your question and, if Claude asks, the app's data for one stock at a time.`, bodyHtml: `<pre class="ai-preview">${esc(p.text)}</pre>`, collect: () => true });
  }
  async function open(question, focus) {
    ensurePanel(); panel.hidden = false; document.body.classList.add("ai-open");
    try { status = await api("/api/ai/status"); } catch (e) { panel.querySelector("[data-body]").innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
    if (!status.configured) { renderSettings(); return; }
    if (question && !busy) { chatId = null; messages = []; } // a question from a button starts a fresh conversation
    renderChat();
    if (question) ask(question, focus); else panel.querySelector("[data-q]").focus();
  }
  async function ask(q, focus = null) {
    if (busy) return; if (!status?.configured) { renderSettings(); return; }
    busy = true; messages.push({ role: "user", text: q }); const a = { role: "assistant", text: "", meta: "" }; messages.push(a); renderChat();
    const setStatus = t => { const el = panel.querySelector("[data-status]"); if (el) el.textContent = t; };
    const body = panel.querySelector("[data-body]"), send = panel.querySelector("[data-send]"); send.disabled = true;
    ctl = new AbortController(); const tools = [];
    let last = 0; const paint = (force) => { if (!force && Date.now() - last < 60) return; last = Date.now(); const el = body.querySelectorAll(".ai-msg.assistant"); const node = el[el.length - 1]; if (node) node.innerHTML = md(a.text) || '<p class="hint">…</p>'; body.scrollTop = body.scrollHeight; };
    try {
      const r = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: q, chatId, focus }), signal: ctl.signal });
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`);
      const rd = r.body.getReader(), dec = new TextDecoder(); let buf = "";
      for (;;) {
        const { value, done } = await rd.read(); if (done) break;
        buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const blk = buf.slice(0, i); buf = buf.slice(i + 2);
          const ev = (blk.match(/^event: (.*)$/m) || [])[1], data = JSON.parse((blk.match(/^data: (.*)$/m) || [])[1] || "{}");
          if (ev === "chat") chatId = data.id;
          else if (ev === "status") setStatus(data.text);
          else if (ev === "tool") { tools.push(data.symbol || data.name.replace(/_/g, " ")); setStatus(data.name === "stock_detail" ? `Looking at ${data.symbol}…` : data.name === "hold_or_sell" ? `Working out hold vs sell for ${data.symbol}…` : "Checking today's swing setups…"); }
          else if (ev === "delta") { a.text += data.text; paint(); }
          else if (ev === "error") throw new Error(data.message);
          else if (ev === "done") a.meta = `${tools.length ? `looked at: ${[...new Set(tools)].join(", ")} · ` : ""}${(data.usage.input + data.usage.cacheRead + data.usage.output).toLocaleString("en-IN")} tokens`;
        }
      }
    } catch (e) { if (e.name !== "AbortError") { a.text += `${a.text ? "\n\n" : ""}⚠ ${e.message}`; if (/key/i.test(e.message)) a.meta = "Ask AI → ⚙ Settings"; } }
    busy = false; send.disabled = false; paint(true); renderChat();
    try { status = await api("/api/ai/status"); renderFine(); } catch { /* ignore */ }
  }
  window.askAI = (q, focus) => open(q, focus);
  document.addEventListener("DOMContentLoaded", () => {
    if (!document.querySelector("main, #homeView")) return;
    ensurePanel();
    document.addEventListener("click", e => { const b = e.target.closest("[data-ask-ai]"); if (b) { e.preventDefault(); open(b.dataset.askAi, b.dataset.askSym ? { symbol: b.dataset.askSym, where: b.dataset.askWhere || "" } : null); } });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && panel && !panel.hidden && !document.querySelector(".ui-scrim")) { panel.hidden = true; document.body.classList.remove("ai-open"); } });
  });
})();
