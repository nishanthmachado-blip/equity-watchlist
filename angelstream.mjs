// Angel One SmartAPI WebSocket 2.0 ("smart-stream"): prices pushed the moment they change, for up to 1,000 stocks on
// one connection, instead of asking a website every few minutes. Market data only: the feed has no order functions.
// Protocol (as in Angel's own SDK): connect with headers Authorization (JWT), x-api-key, x-client-code, x-feed-token;
// send JSON { action: 1 subscribe / 0 unsubscribe, params: { mode: 1 LTP / 2 Quote, tokenList: [{ exchangeType, tokens }] } };
// send "ping" every 10 s (the server answers "pong"); each tick is one little-endian binary message:
//   0 mode (u8) · 1 exchange type (u8) · 2..26 token (25 bytes, NUL-padded) · 27 sequence (i64) · 35 exchange time ms (i64)
//   · 43 last price in paise (i64) — Quote mode adds · 51 last qty · 59 average price · 67 volume (i64) · 75 / 83 total buy /
//   sell qty (double) · 91 open · 99 high · 107 low · 115 previous close (i64 paise); 123 bytes in all.
export const EXCHANGE_TYPE = { NSE: 1, BSE: 3 };
const EX_NAME = { 1: "NSE", 3: "BSE" };
const MODE_LTP = 1, MODE_QUOTE = 2;
export const MAX_TOKENS = 1000;

const i64 = (b, o) => Number(b.readBigInt64LE(o));
export function parseTick(data) {
  const b = Buffer.isBuffer(data) ? data : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
  if (b.length < 51) return null;
  const mode = b[0], ex = EX_NAME[b[1]] || null, token = b.subarray(2, 27).toString("latin1").replace(/\0+$/, "").trim();
  if (!token || !ex || (mode !== MODE_LTP && mode !== MODE_QUOTE && mode !== 3)) return null;
  const t = { mode, exchange: ex, token, seq: i64(b, 27), at: i64(b, 35), price: i64(b, 43) / 100 };
  if (mode >= MODE_QUOTE && b.length >= 123) Object.assign(t, { volume: i64(b, 67), open: i64(b, 91) / 100, high: i64(b, 99) / 100, low: i64(b, 107) / 100, prevClose: i64(b, 115) / 100 });
  return t.price > 0 ? t : null;
}
// Build a tick (for tests and the fake server): the inverse of parseTick
export function encodeTick({ mode = MODE_QUOTE, exchange = "NSE", token, seq = 1, at = Date.now(), price, volume = 0, open = 0, high = 0, low = 0, prevClose = 0 }) {
  const b = Buffer.alloc(mode >= MODE_QUOTE ? 123 : 51);
  b[0] = mode; b[1] = EXCHANGE_TYPE[exchange]; b.write(String(token), 2, 25, "latin1");
  const w = (o, v) => b.writeBigInt64LE(BigInt(Math.round(v)), o);
  w(27, seq); w(35, at); w(43, price * 100);
  if (mode >= MODE_QUOTE) { w(67, volume); w(91, open * 100); w(99, high * 100); w(107, low * 100); w(115, prevClose * 100); }
  return b;
}
export function subscribeMessage(action, items, mode = MODE_QUOTE) {
  const by = {}; for (const { exchange, token } of items) (by[EXCHANGE_TYPE[exchange]] ||= []).push(String(token));
  return JSON.stringify({ correlationID: "ewatch", action, params: { mode, tokenList: Object.entries(by).map(([e, tokens]) => ({ exchangeType: Number(e), tokens })) } });
}

// One managed connection.
//   auth({ fresh }) → { url, headers }  (fresh: log in again first)
//   onTicks([tick]) once per flushMs with the newest tick of each stock that changed
export function createAngelStream({ auth, onTicks, log = () => {}, WebSocketImpl = globalThis.WebSocket, flushMs = 1000, pingMs = 10000, staleMs = 30000, retryMs = 5000, maxRetryMs = 5 * 60e3 } = {}) {
  let ws = null, want = new Map(), subscribed = new Set(), pending = new Map(), timers = [], retry = retryMs, stopped = true, failsInRow = 0, lastMsgAt = 0, reconnectTimer = null;
  const st = { state: "off", since: null, tokens: 0, ticks: 0, lastTickAt: null, error: null, reconnects: 0, connectedAt: null };
  const set = (state, error = null) => { if (st.state !== state) st.since = new Date().toISOString(); st.state = state; if (error !== undefined) st.error = error; };
  const key = x => `${x.exchange}|${x.token}`;
  const clearTimers = () => { for (const t of timers) clearInterval(t); timers = []; };
  function send(msg) { try { if (ws?.readyState === 1) ws.send(msg); } catch (e) { log(`send failed: ${e.message}`); } }
  function sync() {
    if (ws?.readyState !== 1) return;
    const add = [...want.values()].filter(x => !subscribed.has(key(x))), drop = [...subscribed].filter(k => !want.has(k)).map(k => { const [exchange, token] = k.split("|"); return { exchange, token }; });
    for (let i = 0; i < drop.length; i += 200) send(subscribeMessage(0, drop.slice(i, i + 200)));
    for (let i = 0; i < add.length; i += 200) send(subscribeMessage(1, add.slice(i, i + 200)));
    for (const x of drop) subscribed.delete(key(x)); for (const x of add) subscribed.add(key(x));
    st.tokens = subscribed.size;
  }
  function flush() { if (!pending.size) return; const list = [...pending.values()]; pending = new Map(); try { onTicks(list); } catch (e) { log(`tick handler: ${e.message}`); } }
  function schedule() {
    if (stopped || reconnectTimer) return;
    const wait = retry; retry = Math.min(maxRetryMs, retry * 2); st.reconnects++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect().catch(() => {}); }, wait); reconnectTimer.unref?.();
  }
  function drop(why) {
    clearTimers(); flush();
    const old = ws; ws = null; subscribed = new Set(); st.tokens = 0;
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch { /* already closed */ } }
    if (!stopped) { set("reconnecting", why); schedule(); }
  }
  async function connect() {
    if (stopped || ws) return;
    if (!want.size) { set("idle", null); return; }
    set("connecting");
    let a;
    try { a = await auth({ fresh: failsInRow >= 2 }); }
    catch (e) { failsInRow++; set("reconnecting", `login: ${String(e.message).slice(0, 160)}`); log(`login for the live feed failed: ${e.message}`); schedule(); return; }
    if (stopped) return;
    let opened = false;
    const sock = new WebSocketImpl(a.url, { headers: a.headers }); ws = sock; sock.binaryType = "arraybuffer";
    sock.onopen = () => {
      if (ws !== sock) return;
      opened = true; failsInRow = 0; retry = retryMs; lastMsgAt = Date.now(); st.connectedAt = new Date().toISOString(); set("live", null); log(`connected; following ${want.size} stocks`);
      sync();
      timers.push(setInterval(() => send("ping"), pingMs), setInterval(flush, flushMs), setInterval(() => { if (Date.now() - lastMsgAt > staleMs) { log("no data for a while: reconnecting"); drop("no data from Angel One for 30 s"); } }, Math.min(5000, staleMs / 2)));
      for (const t of timers) t.unref?.();
    };
    sock.onmessage = ev => {
      if (ws !== sock) return;
      lastMsgAt = Date.now();
      if (typeof ev.data === "string") { if (ev.data !== "pong") { let j = null; try { j = JSON.parse(ev.data); } catch { /* text */ } if (j?.errorCode || j?.errorMessage) { st.error = `${j.errorCode || ""} ${j.errorMessage || ""}`.trim(); log(`Angel One says: ${st.error}`); } } return; }
      const t = parseTick(ev.data); if (!t) return;
      st.ticks++; st.lastTickAt = new Date().toISOString(); pending.set(key(t), t);
    };
    sock.onerror = ev => { if (ws === sock && !opened) failsInRow++; if (ws === sock) log(`connection error${ev?.message ? `: ${ev.message}` : ""}`); };
    sock.onclose = ev => { if (ws === sock) drop(opened ? `connection closed (${ev?.code || "?"})` : "could not connect (Angel One refused the login or is unreachable)"); };
  }
  return {
    // [{ exchange, token }]; at most MAX_TOKENS are followed (the first ones win)
    setTokens(items) {
      const next = new Map(); for (const x of items) { if (next.size >= MAX_TOKENS) break; if (EXCHANGE_TYPE[x.exchange] && x.token) next.set(key(x), { exchange: x.exchange, token: String(x.token) }); }
      want = next; if (ws) sync(); else if (!stopped && !reconnectTimer) connect().catch(() => {});
      if (!want.size && ws) { log("nothing to follow: closing"); const keep = stopped; stopped = true; drop(null); stopped = keep; set("idle", null); }
    },
    start() { if (!stopped) return; stopped = false; retry = retryMs; connect().catch(() => {}); },
    stop() { stopped = true; clearTimeout(reconnectTimer); reconnectTimer = null; drop(null); set("off", null); },
    status: () => ({ ...st, following: want.size }),
    running: () => !stopped
  };
}
