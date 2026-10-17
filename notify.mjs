// Phone alerts through a Telegram bot (free, works with the app closed). Each user brings their own bot:
// create it with @BotFather, paste its token, send the bot any message, and the app finds the chat id itself.
const API = () => (process.env.TELEGRAM_API || "https://api.telegram.org").replace(/\/+$/, "");
const TOKEN_RE = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/;

export const validToken = t => TOKEN_RE.test(String(t || "").trim());
export const maskToken = t => (t ? `${String(t).split(":")[0]}:••••${String(t).slice(-4)}` : null);
const he = s => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

async function call(token, method, body, fetchImpl = fetch) {
  if (!validToken(token)) throw new Error("That does not look like a bot token (it looks like 123456789:AA…).");
  const r = await fetchImpl(`${API()}/bot${token.trim()}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}), signal: AbortSignal.timeout(10000) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error(j.description ? `Telegram: ${j.description}` : `Telegram answered HTTP ${r.status}.`);
  return j.result;
}

// Bot name, to show "connected to @MyAlertsBot".
export async function botInfo(token, fetchImpl) { const me = await call(token, "getMe", {}, fetchImpl); return { username: me.username, name: me.first_name }; }

// The chat that most recently messaged the bot (the user just sent it "hi").
export async function findChat(token, fetchImpl) {
  const ups = await call(token, "getUpdates", { limit: 50, timeout: 0 }, fetchImpl);
  const msgs = (ups || []).map(u => u.message || u.edited_message || u.channel_post || u.my_chat_member).filter(m => m?.chat);
  const m = msgs[msgs.length - 1];
  if (!m) throw new Error("No message found. Open your bot in Telegram, press Start (or send it “hi”), then try again.");
  const c = m.chat;
  return { chatId: String(c.id), label: c.title || [c.first_name, c.last_name].filter(Boolean).join(" ") || c.username || String(c.id) };
}

export function formatAlert(e, appUrl) {
  const icon = e.type === "swing-profit" ? "" : e.type === "swing-deploy" ? "" : e.type === "buy-zone" ? "🟢 " : e.type === "rule" ? "🔔 " : String(e.type).includes("event") ? "📅 " : "🔔 ";
  return `${icon}<b>${he(e.title)}</b>${e.detail ? `\n${he(e.detail)}` : ""}${appUrl ? `\n<a href="${he(appUrl)}${String(e.type || "").startsWith("swing") ? "/#swing" : "/#alerts"}">Open Equity Watchlist</a>` : ""}`;
}
export async function sendTelegram(token, chatId, html, fetchImpl) {
  return call(token, "sendMessage", { chat_id: chatId, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true }, fetchImpl);
}

// cfg: { telegram: { token, chatId, scope: "all"|"swing", enabled } }. Sends up to 5 alerts one by one, then a summary line.
export function wants(cfg, e) { const t = cfg?.telegram; if (!t?.enabled || !t.token || !t.chatId) return false; return t.scope === "swing" ? String(e.type || "").startsWith("swing") || e.type === "rule" : true; } // your own price alerts always go
export async function pushAlerts(cfg, events, { appUrl = process.env.APP_URL || process.env.PUBLIC_URL || "", fetchImpl } = {}) {
  const list = events.filter(e => wants(cfg, e)); if (!list.length) return 0;
  const t = cfg.telegram;
  for (const e of list.slice(0, 5)) await sendTelegram(t.token, t.chatId, formatAlert(e, appUrl), fetchImpl);
  if (list.length > 5) await sendTelegram(t.token, t.chatId, `…and ${list.length - 5} more alert(s) in the app.`, fetchImpl);
  return list.length;
}
