// The side-menu arrangement a user saved (order inside each group, pinned items, hidden items). Only element ids,
// so nothing personal; still kept per login (menu.json) so each account arranges its own menu.
const ID = /^[A-Za-z][\w-]{1,40}$/;
const ids = (v, max = 80) => [...new Set((Array.isArray(v) ? v : []).filter(x => typeof x === "string" && ID.test(x)))].slice(0, max);
export function sanitizeMenu(b) {
  const order = {};
  for (const [k, v] of Object.entries(b && typeof b.order === "object" && !Array.isArray(b.order) ? b.order : {}).slice(0, 20)) if (ID.test(k) && k !== "pinned") order[k] = ids(v);
  const pinned = ids(b?.pinned, 20);
  for (const k of Object.keys(order)) order[k] = order[k].filter(x => !pinned.includes(x));
  return { order, pinned, hidden: ids(b?.hidden), savedAt: new Date().toISOString() };
}
