import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createKiteClient } from "../kite-mcp.mjs";

// Zerodha's hosted MCP server answers an expired session with HTTP 400 "Invalid session ID" (not 404): the client must
// start a new session and retry, and say "log in again" when the new session is not logged in.
function fakeKite({ loggedInAfterReset = true } = {}) {
  let sessions = 0; const valid = new Set(), calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body), sid = opts.headers["Mcp-Session-Id"]; calls.push({ method: body.method, sid });
    const res = (status, obj, headers = {}) => ({ status, ok: status < 300, headers: new Map(Object.entries({ "content-type": "application/json", ...headers })), text: async () => typeof obj === "string" ? obj : JSON.stringify(obj) });
    if (body.method === "initialize") { const id = `s${++sessions}`; valid.add(id); return res(200, { jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26" } }, { "mcp-session-id": id }); }
    if (!body.id) return res(202, "");
    if (!valid.has(sid)) return res(400, "Invalid session ID");
    const text = loggedInAfterReset || sid === "s1" ? JSON.stringify({ "NSE:TCS": { last_price: 3050.5 } }) : "Please log in first: https://kite.zerodha.com/connect/login?api_key=x";
    return res(200, { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } });
  };
  fetchImpl.expire = () => valid.clear();
  return { fetchImpl, calls };
}
test("Kite MCP: 'HTTP 400 Invalid session ID' starts a new session and retries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kms-")), f = fakeKite();
  const kc = createKiteClient({ url: "https://mcp.example/mcp", enabled: true, fetchImpl: f.fetchImpl, sessionFile: path.join(dir, "s.json") });
  assert.equal((await kc.ltp(["TCS"])).get("TCS"), 3050.5);
  f.fetchImpl.expire(); // Zerodha drops the session
  assert.equal((await kc.ltp(["TCS"])).get("TCS"), 3050.5, "recovered on a new session");
  assert.equal(f.calls.filter(c => c.method === "initialize").length, 2);
});
test("Kite MCP: a new session that is not logged in says to log in again", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kms-")), f = fakeKite({ loggedInAfterReset: false });
  const kc = createKiteClient({ url: "https://mcp.example/mcp", enabled: true, fetchImpl: f.fetchImpl, sessionFile: path.join(dir, "s.json") });
  await kc.ltp(["TCS"]); f.fetchImpl.expire();
  await assert.rejects(kc.ltp(["TCS"]), e => e.loginRequired === true);
});
