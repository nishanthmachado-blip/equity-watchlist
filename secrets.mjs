// Encryption at rest for the files that hold secrets: broker API keys, PINs, TOTP secrets and session tokens, the
// Kite / broker MCP logins, the Telegram bot token, your Anthropic key and your sign-in authenticator secret.
// The storage layer (storage.mjs) seals these files when it writes them and opens them when it reads them, so the
// rest of the app is unchanged. On disk / in MongoDB they look like "EWSEC1:<base64>" (AES-256-GCM, random IV).
//
// The key: SECRETS_KEY (a long random string in the environment / .env, kept OUTSIDE the data folder and the
// database: the strong setup), else SECRETS_KEY_FILE (a file path), else a random key the app creates once and keeps
// in the data store as secrets-key.json (works out of the box, but anyone with a full copy of the data then has the
// key too: the startup log says so). Files written before encryption are read as they are and sealed on the next save.
import crypto from "node:crypto";
import realFs from "node:fs";
import path from "node:path";

export const SECRET_FILE_RE = /^(kite-session(-[\w-]+)?|broker-sessions|broker-credentials|broker-mcp|notify|ai-key|login-2fa)\.json$/;
export const isSecretPath = p => SECRET_FILE_RE.test(path.basename(String(p)));
const PREFIX = "EWSEC1:";
let key = null, source = "none"; const warned = new Set();

const derive = material => crypto.createHash("sha256").update(`equity-watchlist secrets v1|${material}`).digest();
// readStored / writeStored: how to keep the fallback key (the storage layer passes its own raw readers)
export function initSecrets({ env = process.env, readStored, writeStored } = {}) {
  // a key generated earlier (before SECRETS_KEY was set) still opens older files, which get re-sealed with the new key
  oldKey = null; try { const k = JSON.parse(readStored?.() || "null")?.key; if (k) oldKey = derive(k); } catch { oldKey = null; }
  if (env.SECRETS_KEY && String(env.SECRETS_KEY).length >= 16) { key = derive(env.SECRETS_KEY); source = "SECRETS_KEY"; return status(); }
  if (env.SECRETS_KEY) console.warn("[secrets] SECRETS_KEY is shorter than 16 characters: ignored (use a long random string).");
  if (env.SECRETS_KEY_FILE) {
    try { const k = realFs.readFileSync(env.SECRETS_KEY_FILE, "utf8").trim(); if (k.length >= 16) { key = derive(k); source = "SECRETS_KEY_FILE"; return status(); } }
    catch (e) { console.warn(`[secrets] SECRETS_KEY_FILE ${env.SECRETS_KEY_FILE}: ${e.message}`); }
  }
  // fallback: a random key kept in the data store, created the first time a secret is saved
  key = null; source = "generated"; lazy = { readStored, writeStored };
  let k = null; try { k = JSON.parse(readStored?.() || "null")?.key || null; } catch { k = null; }
  if (k) key = derive(k);
  oldKey = null; // the stored key is the current key here
  return status();
}
let oldKey = null;
export const hasOldKey = () => !!oldKey;
let lazy = null;
function ensureKey() {
  if (key || !lazy) return key;
  const k = crypto.randomBytes(32).toString("base64");
  try { lazy.writeStored?.(JSON.stringify({ key: k, note: "Encrypts the app's stored secrets. Set SECRETS_KEY in the environment instead for stronger protection; keep this file out of shared copies." })); } catch (e) { console.warn(`[secrets] could not save the generated key: ${e.message}`); }
  return (key = derive(k));
}
export const status = () => ({ encrypted: !!(key || lazy), source, strong: source === "SECRETS_KEY" || source === "SECRETS_KEY_FILE" });

export function sealText(text) {
  if (!ensureKey()) return String(text);
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([c.update(Buffer.from(String(text), "utf8")), c.final()]);
  return PREFIX + Buffer.concat([iv, c.getAuthTag(), body]).toString("base64");
}
export const isSealed = t => typeof t === "string" && t.startsWith(PREFIX);
// Sealed text → plain text; plain (older) text is returned as it is. A wrong key throws (code ESECRET).
export function openText(text, where = "") {
  if (!isSealed(text)) return text;
  if (!key && !oldKey) throw Object.assign(new Error("Encrypted data but no key"), { code: "ESECRET" });
  const b = Buffer.from(text.slice(PREFIX.length), "base64");
  for (const k of [key, oldKey]) {
    if (!k) continue;
    try { const d = crypto.createDecipheriv("aes-256-gcm", k, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8"); }
    catch { /* try the next key */ }
  }
  {
    if (!warned.has(where)) { warned.add(where); console.error(`[secrets] cannot decrypt ${where || "a secret file"}: the key changed (SECRETS_KEY?). Treating it as empty: log in to that broker again.`); }
    throw Object.assign(new Error("Cannot decrypt (wrong key)"), { code: "ESECRET" });
  }
}

// Sealed with the earlier generated key (not the current one): re-seal it
export function sealedWithOldKey(text) {
  if (!isSealed(text) || !oldKey || !key) return false;
  const b = Buffer.from(text.slice(PREFIX.length), "base64");
  try { const d = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); d.update(b.subarray(28)); d.final(); return false; } catch { return true; }
}
