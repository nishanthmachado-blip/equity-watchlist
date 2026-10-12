// Loads KEY=VALUE lines from ./.env into process.env (without overriding variables already set in the shell), so
// `npm start` picks up settings such as KITE_MCP_ENABLED=1 on any operating system. Import this FIRST in server.mjs:
// ES modules run in import order, and the other modules read process.env while they load.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    // Strip quotes only when the whole value is ONE quoted string; `"C:\\Program Files\\x.exe" "a b"` is a command line.
    if (/^"[^"]*"$/.test(v) || /^'[^']*'$/.test(v)) v = v.slice(1, -1);
    else if (/^["']/.test(v)) { /* quoted parts of a command line: keep as written */ }
    else v = v.replace(/\s+#.*$/, ""); // trailing comment on an unquoted value
    out[m[1]] = v;
  }
  return out;
}
export function loadEnv(file = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env")) {
  let text; try { text = fs.readFileSync(file, "utf8"); } catch { return []; }
  const applied = [];
  for (const [k, v] of Object.entries(parseEnv(text))) if (process.env[k] === undefined && v !== "") { process.env[k] = v; applied.push(k); }
  return applied;
}
export const loadedFromEnvFile = loadEnv();
