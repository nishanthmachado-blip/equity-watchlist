// A fake local (stdio) broker MCP server, shaped like community Angel One servers: reads the account details from
// environment variables, needs its own `login` tool first, and also offers a trading tool the app must never call.
import readline from "node:readline";
process.stdout.write("fake angel mcp starting (banner line that is not JSON)\n");
let loggedIn = false; const calls = [];
const send = m => process.stdout.write(JSON.stringify(m) + "\n");
const text = (id, t, isError = false) => send({ jsonrpc: "2.0", id, result: { isError, content: [{ type: "text", text: typeof t === "string" ? t : JSON.stringify(t) }] } });
readline.createInterface({ input: process.stdin }).on("line", line => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") return send({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-angel" } } });
  if (msg.method === "notifications/initialized") return;
  if (msg.method === "tools/list") return send({ jsonrpc: "2.0", id: msg.id, result: { tools: ["login", "get_profile", "get_all_holdings", "place_order", "gtt_create_rule", "get_ltp"].map(name => ({ name, description: name })) } });
  if (msg.method !== "tools/call") return send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "no" } });
  const { name } = msg.params; calls.push(name);
  if (name === "place_order" || name === "gtt_create_rule") process.exit(42); // the test fails loudly if this is ever reached
  if (name === "login") { if (!process.env.ANGELONE_TOTP_SECRET || process.env.ANGELONE_API_KEY !== "akey") return text(msg.id, "missing credentials", true); loggedIn = true; return text(msg.id, "Logged in."); }
  if (!loggedIn) return text(msg.id, "Not logged in. Please login first.", true);
  if (name === "get_profile") return text(msg.id, { status: true, data: { clientcode: process.env.ANGELONE_CLIENT_CODE, name: "Stdio User" } });
  if (name === "get_all_holdings") return text(msg.id, { status: true, data: { holdings: [{ tradingsymbol: "ITC-EQ", exchange: "NSE", quantity: 20, realisedquantity: 20, t1quantity: 0, averageprice: 400, ltp: 450, close: 445 }] } });
  return text(msg.id, "{}");
});
