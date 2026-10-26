// Monthly expenses in and out of a spreadsheet, in one format both ways.
// Excel: four sheets — Spends, Budget, Income, Settle up. CSV: the same rows in one file, with a "Section" column
// (Spend / Budget / Income / Payment). A plain list of spends (Date, Item, Amount, Paid by, Category, Note: the old
// export, or your own sheet) imports too. Dates: 2026-10-05, 05-10-2026, 05/10/2026 or Excel day numbers.
// Pure: the server reads the file (readSheetFile) and saves the result.
const fin = v => Number.isFinite(v);
const txt = (v, n) => String(v ?? "").replace(/[<>]/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const money = v => { if (v === null || v === undefined || String(v).trim() === "") return null; const x = Number(String(v).replace(/[,₹\s]/g, "")); return fin(x) ? Math.round(x * 100) / 100 : NaN; };
const yes = v => /^(y|yes|true|1|done|✓|x)$/i.test(String(v ?? "").trim());

export const COLS = {
  spends: [["Date", "date"], ["Item", "item"], ["Amount", "amount"], ["Paid by", "mode"], ["Category", "category"], ["Note", "note"], ["Shared with", "person"], ["Who owes", "dir"], ["Their part", "part"]],
  budget: [["Month", "month"], ["Line", "name"], ["Amount", "amount"], ["Bank", "bank"], ["Type", "type"], ["Done", "done"], ["Actually invested", "actual"]],
  income: [["Month", "month"], ["Name", "name"], ["Amount", "amount"]],
  settle: [["Date", "date"], ["Person", "person"], ["Direction", "dir"], ["Amount", "amount"], ["Note", "note"]]
};
const SECTION = { spends: "Spend", budget: "Budget", income: "Income", settle: "Payment" };
const TYPE_OUT = { needs: "Needs", wants: "Wants", invest: "Investment", unplanned: "Unplanned" };
const norm = s => String(s || "").toLowerCase().replace(/\(.*?\)/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

// months: the stored months; keys: which months to export. shareOf(entry) gives the effective share (or null).
export function exportRows(months = {}, keys = [], { shareOf = () => null, investKey = norm } = {}) {
  const out = { spends: [], budget: [], income: [], settle: [] };
  for (const k of [...keys].sort()) {
    const m = months[k]; if (!m) continue;
    for (const e of [...(m.entries || [])].sort((a, b) => a.date.localeCompare(b.date))) {
      const sh = e.share === false ? null : e.share?.person ? e.share : null; // only shares you set (automatic ones follow "Paid by")
      out.spends.push({ date: e.date, item: e.item, amount: e.amount, mode: e.mode || "", category: e.category || "", note: e.note || "", person: sh?.person || (e.share === false ? "none" : ""), dir: sh ? (sh.dir === "owe" ? "I owe" : "Owes me") : "", part: sh && sh.amount !== e.amount ? sh.amount : "" });
    }
    for (const i of m.income || []) out.income.push({ month: k, name: i.name, amount: i.amount });
    for (const p of m.plan || []) { const r = (m.invested || {})[investKey(p.name)]; out.budget.push({ month: k, name: p.name, amount: p.amount ?? "", bank: p.bank || "", type: TYPE_OUT[p.type] || "Needs", done: p.done ? "Yes" : "", actual: p.type === "invest" && fin(r?.actual) ? r.actual : "" }); }
    for (const x of m.settlements || []) out.settle.push({ date: x.date, person: x.person, dir: x.dir === "paid" ? "I paid" : "They paid me", amount: x.amount, note: x.note || "" });
  }
  void shareOf;
  return out;
}
const q = s => { const v = String(s ?? ""); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };
export function toCsvAll(rows) {
  const head = ["Section", "Month", "Date", "Item / line / person", "Amount", "Paid by / bank", "Category / type / direction", "Done", "Note", "Shared with", "Who owes", "Their part", "Actually invested"];
  const lines = [head.join(",")];
  for (const r of rows.income) lines.push(["Income", r.month, "", r.name, r.amount, "", "", "", "", "", "", "", ""].map(q).join(","));
  for (const r of rows.budget) lines.push(["Budget", r.month, "", r.name, r.amount, r.bank, r.type, r.done, "", "", "", "", r.actual].map(q).join(","));
  for (const r of rows.spends) lines.push(["Spend", r.date.slice(0, 7), r.date, r.item, r.amount, r.mode, r.category, "", r.note, r.person, r.dir, r.part, ""].map(q).join(","));
  for (const r of rows.settle) lines.push(["Payment", r.date.slice(0, 7), r.date, r.person, r.amount, "", r.dir, "", r.note, "", "", "", ""].map(q).join(","));
  return lines.join("\n");
}
export function toSheets(rows) {
  const W = { date: 12, item: 32, amount: 12, mode: 16, category: 24, note: 26, person: 14, dir: 12, part: 11, month: 10, name: 30, bank: 10, type: 12, done: 8, actual: 16 };
  const sheet = (name, key) => ({ name, columns: COLS[key].map(([header, k]) => ({ header, key: k, width: W[k] || 14, type: k === "amount" || k === "part" || k === "actual" ? "money" : k === "date" ? "date" : "text" })), rows: rows[key] });
  return [sheet("Spends", "spends"), sheet("Budget", "budget"), sheet("Income", "income"), sheet("Settle up", "settle")];
}

// ---- import ----
export function parseDay(v) {
  const s = String(v ?? "").trim(); if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s) && +s > 30000 && +s < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5).toISOString().slice(0, 10);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{4})$/); if (m) { const mon = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[2].toLowerCase()) + 1; if (mon) return `${m[3]}-${String(mon).padStart(2, "0")}-${m[1].padStart(2, "0")}`; }
  return null;
}
const parseMonth = (v, day) => { const s = String(v ?? "").trim(); const m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, "0")}`; const d = parseDay(s) || (/^[A-Za-z]{3}/.test(s) ? parseDay(`1 ${s}`) : null); return d ? d.slice(0, 7) : day ? day.slice(0, 7) : null; };
// header row → { field: column index } using the names in COLS (and a few common alternatives)
const ALIASES = { date: ["date", "day", "spent on"], item: ["item", "what", "description", "item line person", "particulars"], amount: ["amount", "amt", "rs", "inr", "value"], mode: ["paid by", "mode", "payment", "paid by bank", "method"], category: ["category", "category type direction"],
  note: ["note", "notes", "remarks"], person: ["shared with", "person"], dir: ["who owes", "direction"], part: ["their part", "share"], month: ["month"], name: ["line", "name", "item line person"], bank: ["bank", "paid by bank"], type: ["type", "category type direction"], done: ["done", "status"], actual: ["actually invested", "actual"], section: ["section"] };
function headerMap(row) {
  const cells = row.map(norm), map = {};
  for (const [k, names] of Object.entries(ALIASES)) { const i = cells.findIndex(c => names.includes(c)); if (i >= 0) map[k] = i; }
  return map;
}
const TYPE_IN = v => { const s = String(v || "").toLowerCase(); return /invest/.test(s) ? "invest" : /want/.test(s) ? "wants" : /unplan/.test(s) ? "unplanned" : "needs"; };
const DIR_SHARE = v => (/owes me|they owe|owed/i.test(String(v)) ? "owed" : /i owe|owe/i.test(String(v)) ? "owe" : null);
const DIR_PAY = v => (/they paid|paid me|received/i.test(String(v)) ? "received" : "paid");

// sheets: [{ name, rows }] (readSheetFile). Returns { months: { "2026-10": { spends, budget, income, settle } }, errors, counts, kind }
export function parseImport(sheets = []) {
  const months = {}, errors = [], at = k => (months[k] ||= { spends: [], budget: [], income: [], settle: [] });
  const bad = (where, why) => { if (errors.length < 50) errors.push(`${where}: ${why}`); };
  let kind = null;
  for (const sh of sheets) {
    const rows = sh.rows || []; let hi = rows.findIndex(r => { const h = headerMap(r); return ("amount" in h) && (("date" in h) || ("month" in h) || ("section" in h)); });
    if (hi < 0) continue;
    const h = headerMap(rows[hi]), sname = norm(sh.name), get = (r, k) => (h[k] === undefined ? "" : r[h[k]] ?? "");
    const fixed = "section" in h ? null : /budget/.test(sname) ? "budget" : /income/.test(sname) ? "income" : /settle|payment/.test(sname) ? "settle" : "spends";
    kind ||= "section" in h ? "csv" : sheets.length > 1 ? "excel" : "spends";
    rows.slice(hi + 1).forEach((r, i) => {
      if (!r.some(c => String(c ?? "").trim())) return;
      const line = `${sh.name} row ${hi + i + 2}`, sec = fixed || ({ spend: "spends", budget: "budget", income: "income", payment: "settle" }[norm(get(r, "section"))] || null);
      if (!sec) return bad(line, `unknown section "${get(r, "section")}"`);
      const amount = money(get(r, "amount"));
      if (sec === "spends") {
        const date = parseDay(get(r, "date")), item = txt(get(r, "item"), 80);
        if (!date) return bad(line, "no date"); if (!item) return bad(line, "no item"); if (!(amount > 0)) return bad(line, "no amount");
        const person = txt(get(r, "person"), 30), dir = DIR_SHARE(get(r, "dir")), part = money(get(r, "part"));
        const share = /^none$/i.test(person) ? false : person && dir ? { person, dir, ...(part > 0 ? { amount: part } : {}) } : undefined;
        at(date.slice(0, 7)).spends.push({ date, item, amount, mode: txt(get(r, "mode"), 30) || null, category: txt(get(r, "category"), 40) || null, note: txt(get(r, "note"), 120) || null, ...(share !== undefined ? { share } : {}) });
      } else if (sec === "budget") {
        const month = parseMonth(get(r, "month"), parseDay(get(r, "date"))), name = txt(get(r, "name") || get(r, "item"), 50);
        if (!month) return bad(line, "no month"); if (!name) return bad(line, "no line name"); if (Number.isNaN(amount)) return bad(line, "amount is not a number");
        const actual = money(get(r, "actual"));
        at(month).budget.push({ name, amount: amount ?? null, bank: txt(get(r, "bank") || get(r, "mode"), 20) || null, type: TYPE_IN(get(r, "type") || get(r, "category")), done: yes(get(r, "done")), actual: actual > 0 || actual === 0 ? actual : null });
      } else if (sec === "income") {
        const month = parseMonth(get(r, "month"), parseDay(get(r, "date"))), name = txt(get(r, "name") || get(r, "item"), 50) || "Income";
        if (!month) return bad(line, "no month"); if (!(amount >= 0)) return bad(line, "no amount");
        at(month).income.push({ name, amount });
      } else {
        const date = parseDay(get(r, "date")), person = txt(get(r, "person") || get(r, "item"), 30);
        if (!date) return bad(line, "no date"); if (!person) return bad(line, "no person"); if (!(amount > 0)) return bad(line, "no amount");
        at(date.slice(0, 7)).settle.push({ date, person, amount, dir: DIR_PAY(get(r, "dir") || get(r, "category")), note: txt(get(r, "note"), 120) || null });
      }
    });
  }
  const counts = Object.entries(months).sort().map(([month, x]) => ({ month, spends: x.spends.length, budget: x.budget.length, income: x.income.length, settle: x.settle.length }));
  return { months, errors, counts, kind };
}
// same spend already there? (date, item, amount, paid by)
export const spendKey = e => `${e.date}|${norm(e.item)}|${Math.round(Number(e.amount) * 100)}|${norm(e.mode)}`;
