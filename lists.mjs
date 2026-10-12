// Named watchlists. The tracked-stock pool (data/watchlist.json) holds every stock and its valuation; a list is just a named
// set of symbols the person wants to focus on. The default list starts as everything already tracked and cannot be deleted.
export const MAX_LISTS = 30, DEFAULT_ID = "default", DEFAULT_NAME = "My watchlist";
const SYM = /^[A-Z0-9&-]{1,20}$/;
const cleanSyms = a => [...new Set((Array.isArray(a) ? a : []).map(x => String(x).trim().toUpperCase()).filter(x => SYM.test(x)))];
const cleanName = n => String(n ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

// Returns a usable store; seeds the default list with the pool the first time.
export function ensureLists(store, poolSymbols) {
  const lists = Array.isArray(store?.lists) ? store.lists.filter(l => l && l.id) : [];
  if (!lists.some(l => l.id === DEFAULT_ID)) lists.unshift({ id: DEFAULT_ID, name: DEFAULT_NAME, default: true, symbols: cleanSyms(poolSymbols) });
  return { lists: lists.map(l => ({ id: l.id, name: l.name || "Watchlist", default: l.id === DEFAULT_ID, symbols: cleanSyms(l.symbols) })) };
}
export function createList(store, { name, symbols = [] }) {
  const n = cleanName(name);
  if (!n) throw new Error("Give the watchlist a name.");
  if (store.lists.length >= MAX_LISTS) throw new Error(`At most ${MAX_LISTS} watchlists.`);
  if (store.lists.some(l => l.name.toLowerCase() === n.toLowerCase())) throw new Error(`You already have a watchlist called "${n}".`);
  let id = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "list";
  while (store.lists.some(l => l.id === id)) id += Math.floor(Math.random() * 10);
  const list = { id, name: n, default: false, symbols: cleanSyms(symbols) };
  return { store: { lists: [...store.lists, list] }, list };
}
export function renameList(store, id, name) {
  const n = cleanName(name); if (!n) throw new Error("Give the watchlist a name.");
  if (!store.lists.some(l => l.id === id)) throw new Error("Unknown watchlist.");
  if (store.lists.some(l => l.id !== id && l.name.toLowerCase() === n.toLowerCase())) throw new Error(`You already have a watchlist called "${n}".`);
  return { lists: store.lists.map(l => (l.id === id ? { ...l, name: n } : l)) };
}
export function deleteList(store, id) {
  if (id === DEFAULT_ID) throw new Error("The default watchlist cannot be deleted.");
  if (!store.lists.some(l => l.id === id)) throw new Error("Unknown watchlist.");
  return { lists: store.lists.filter(l => l.id !== id) };
}
export function setMembers(store, id, { add = [], remove = [] }) {
  if (!store.lists.some(l => l.id === id)) throw new Error("Unknown watchlist.");
  const rm = new Set(cleanSyms(remove));
  return { lists: store.lists.map(l => (l.id === id ? { ...l, symbols: [...new Set([...l.symbols, ...cleanSyms(add)])].filter(s => !rm.has(s)) } : l)) };
}
// Drop symbols that are no longer tracked anywhere.
export function prune(store, poolSymbols) {
  const pool = new Set(poolSymbols.map(s => String(s).toUpperCase()));
  return { lists: store.lists.map(l => ({ ...l, symbols: l.symbols.filter(s => pool.has(s)) })) };
}
