// Where the app keeps its data.
//
//   file mode (default): JSON files under DATA_DIR, as before.
//   mongo mode (MONGO_URL set): every file under DATA_DIR becomes one MongoDB document instead:
//     { _id: "users/<user id>/watchlist.json", owner: "<user id>" | null, kind: "watchlist", data: {…} | text: "…", updatedAt }
//   so redeploying or replacing the container never loses holdings, watchlists, logins or stock data.
//
// The rest of the app keeps calling readFile / writeFile / rm / readdir: `dfs` and `dfsSync` below behave like
// node:fs for paths inside DATA_DIR (served from an in-memory copy of the collection, written through to MongoDB) and
// pass everything else (the app's own HTML/JS files) to the real file system. One app instance per database: the
// in-memory copy is the source of truth while the app runs.
import realFs from "node:fs/promises";
import realFsSync from "node:fs";
import path from "node:path";

let mode = "file", root = null, coll = null, client = null, log = console.log;
const cache = new Map();          // key -> text
const chains = new Map();         // key -> promise of the last write (writes to one key stay in order)
let lastError = null, writes = 0, failures = 0;
const dirty = new Set();          // keys whose last write failed (database briefly down): retried every 20 s

const enoent = p => Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), { code: "ENOENT", errno: -2, path: p });
const keyOf = p => {
  if (mode !== "mongo" || !root) return null;
  const rel = path.relative(root, path.resolve(String(p)));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
};
const ownerOf = key => (key.match(/^users\/([a-f0-9]{16})\//) || [])[1] || null;
const kindOf = key => path.posix.basename(key).replace(/\.json$/, "");
function docFor(key, text) {
  const base = { _id: key, owner: ownerOf(key), kind: kindOf(key), updatedAt: new Date() };
  if (key.endsWith(".json")) { try { return { ...base, data: JSON.parse(text) }; } catch { /* not JSON: keep as text */ } }
  return { ...base, text };
}
const textOf = d => (typeof d.text === "string" ? d.text : JSON.stringify(d.data ?? null, null, 2));
function enqueue(key, op) {
  const run = async () => {
    try { await op(); writes++; }
    catch (e) { failures++; dirty.add(key); lastError = `${key}: ${e.message}`; log(`[storage] MongoDB write failed for ${key} (will retry): ${e.message}`); throw e; }
  };
  const p = (chains.get(key) || Promise.resolve()).catch(() => {}).then(run);
  chains.set(key, p); p.finally(() => { if (chains.get(key) === p) chains.delete(key); }).catch(() => {});
  return p;
}
async function upsert(key, text) {
  const doc = docFor(key, text);
  try { await coll.replaceOne({ _id: key }, doc, { upsert: true }); }
  catch (e) {
    // Field names MongoDB will not store (e.g. starting with "$"), or a document over 16 MB as an object: keep the text.
    if (!doc.data) throw e;
    const { data, ...rest } = doc; await coll.replaceOne({ _id: key }, { ...rest, text }, { upsert: true });
  }
}
// A failed write does not fail the request: the change stays in memory, /healthz turns 503 and it is saved on retry.
const put = (key, text) => { cache.set(key, String(text)); return enqueue(key, () => upsert(key, String(text))).catch(() => {}); };
const drop = keys => { for (const k of keys) cache.delete(k); return Promise.all(keys.map(k => enqueue(k, () => coll.deleteOne({ _id: k })).catch(() => {}))); };
const childrenOf = prefix => [...cache.keys()].filter(k => k.startsWith(prefix ? `${prefix}/` : ""));

// ---- setup ----
export async function initStorage({ dataDir, mongoUrl = process.env.MONGO_URL, dbName = process.env.MONGO_DB || "equity_watchlist", collection = process.env.MONGO_COLLECTION || "app_data", importFiles = process.env.MONGO_IMPORT_FILES !== "0", logger = console.log, collectionImpl = null } = {}) {
  root = path.resolve(dataDir); log = logger;
  if (!mongoUrl && !collectionImpl) { mode = "file"; return info(); }
  if (collectionImpl) coll = collectionImpl; // tests
  else {
    const { MongoClient } = await import("mongodb");
    client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: Number(process.env.MONGO_TIMEOUT_MS || 15000), appName: "equity-watchlist" });
    let tries = 0;
    for (;;) { // the database container may still be starting
      try { await client.connect(); break; }
      catch (e) { if (++tries >= Number(process.env.MONGO_CONNECT_TRIES || 10)) throw new Error(`Cannot connect to MongoDB (${e.message}). Check MONGO_URL.`); log(`[storage] Waiting for MongoDB (${e.message.slice(0, 80)})…`); await new Promise(r => setTimeout(r, 3000)); }
    }
    coll = client.db(dbName).collection(collection);
    await coll.createIndex({ owner: 1, kind: 1 }).catch(() => {});
  }
  mode = "mongo";
  setInterval(retryDirty, 20000).unref();
  for (const d of await coll.find({}).toArray()) cache.set(d._id, textOf(d));
  log(`[storage] MongoDB: ${cache.size} document(s) loaded from ${collectionImpl ? "test collection" : `${dbName}.${collection}`}.`);
  // First start on an empty database: bring in whatever is in the data folder (an existing install), once.
  if (!cache.size && importFiles) {
    const files = await walk(root).catch(() => []);
    let n = 0;
    for (const f of files) { const key = path.relative(root, f).split(path.sep).join("/"); if (/\.tmp$|(^|\/)\./.test(key) && !/\.before-restore\.json$/.test(key)) continue; try { await put(key, await realFs.readFile(f, "utf8")); n++; } catch (e) { log(`[storage] Skipped ${key}: ${e.message}`); } }
    if (n) log(`[storage] Imported ${n} file(s) from ${root} into MongoDB.`);
  }
  return info();
}
async function walk(dir) { const out = []; for (const e of await realFs.readdir(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...await walk(p)); else if (e.isFile()) out.push(p); } return out; }
async function retryDirty() {
  for (const key of [...dirty]) {
    if (chains.has(key)) continue;
    try { if (cache.has(key)) await upsert(key, cache.get(key)); else await coll.deleteOne({ _id: key }); dirty.delete(key); }
    catch { return; } // still down: try again later
  }
  if (!dirty.size && lastError) { log("[storage] MongoDB is back: all pending changes saved."); lastError = null; }
}
export function info() { return { mode, documents: mode === "mongo" ? cache.size : null, pendingWrites: chains.size, unsaved: dirty.size, writes, failures, lastError }; }
export async function flushStorage() { await Promise.allSettled([...chains.values()]); if (dirty.size && coll) await retryDirty().catch(() => {}); }
export async function closeStorage() { await flushStorage(); await client?.close().catch(() => {}); }
// Health check for /healthz: is the database reachable?
export async function pingStorage() { if (mode !== "mongo" || !client) return true; try { await client.db("admin").command({ ping: 1 }); return true; } catch { return false; } }

// ---- fs-like API ----
export const dfs = {
  async readFile(p, enc) { const k = keyOf(p); if (!k) return realFs.readFile(p, enc); if (!cache.has(k)) throw enoent(p); const t = cache.get(k); return enc ? t : Buffer.from(t); },
  async writeFile(p, data, opts) { const k = keyOf(p); if (!k) return realFs.writeFile(p, data, opts); await put(k, Buffer.isBuffer(data) ? data.toString("utf8") : data); },
  async mkdir(p, opts) { if (!keyOf(p) && !(mode === "mongo" && path.resolve(p) === root)) return realFs.mkdir(p, opts); },
  async chmod(p, m) { if (!keyOf(p)) return realFs.chmod(p, m); },
  async access(p, m) { const k = keyOf(p); if (!k) return realFs.access(p, m); if (!cache.has(k) && !childrenOf(k).length) throw enoent(p); },
  async rm(p, opts = {}) {
    const k = keyOf(p);
    if (!k) { if (mode === "mongo" && path.resolve(p) === root) return; return realFs.rm(p, opts); }
    const keys = [...(cache.has(k) ? [k] : []), ...(opts.recursive ? childrenOf(k) : [])];
    if (!keys.length && !opts.force) throw enoent(p);
    await drop(keys);
  },
  async readdir(p, opts) {
    const k = keyOf(p), atRoot = mode === "mongo" && path.resolve(p) === root;
    if (!k && !atRoot) return realFs.readdir(p, opts);
    const names = new Set(childrenOf(atRoot ? "" : k).map(x => x.slice(atRoot ? 0 : k.length + 1).split("/")[0]));
    if (!names.size && !atRoot) throw enoent(p);
    return [...names].sort();
  },
  async rename(a, b) {
    const ka = keyOf(a), kb = keyOf(b);
    if (!ka && !kb) return realFs.rename(a, b);
    if (!ka || !kb) throw new Error("Cannot move data between the database and the file system.");
    if (cache.has(ka)) { const t = cache.get(ka); await Promise.all([put(kb, t), drop([ka])]); return; }
    const kids = childrenOf(ka); if (!kids.length) throw enoent(a);
    await Promise.all(kids.map(x => put(kb + x.slice(ka.length), cache.get(x)))); await drop(kids);
  }
};
export const dfsSync = {
  readFileSync(p, enc) { const k = keyOf(p); if (!k) return realFsSync.readFileSync(p, enc); if (!cache.has(k)) throw enoent(p); const t = cache.get(k); return enc ? t : Buffer.from(t); },
  writeFileSync(p, data, opts) { const k = keyOf(p); if (!k) return realFsSync.writeFileSync(p, data, opts); put(k, String(data)).catch(() => {}); },
  mkdirSync(p, opts) { if (!keyOf(p) && !(mode === "mongo" && path.resolve(p) === root)) return realFsSync.mkdirSync(p, opts); },
  rmSync(p, opts = {}) { const k = keyOf(p); if (!k) { if (mode === "mongo" && path.resolve(p) === root) return; return realFsSync.rmSync(p, opts); } const keys = [...(cache.has(k) ? [k] : []), ...(opts.recursive ? childrenOf(k) : [])]; if (!keys.length && !opts.force) throw enoent(p); drop(keys).catch(() => {}); },
  existsSync(p) { const k = keyOf(p); return k ? cache.has(k) || childrenOf(k).length > 0 : realFsSync.existsSync(p); }
};
