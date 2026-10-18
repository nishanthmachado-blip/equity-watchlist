// Reader for old Excel 97-2003 workbooks (.xls, "BIFF8" inside an OLE compound file), with no dependencies.
// Fund houses (Helios, many others) still publish monthly portfolios as .xls. Returns the same shape as readXlsx:
// [{ name, rows: [[cell text, ...], ...] }]. Only cell values are read (no formatting, no formulas, no macros).
// Also reads the two things that are often saved with a .xls name: an HTML table and an Excel 2003 XML spreadsheet.

const CFB_MAGIC = "d0cf11e0a1b11ae1";
export const isCfb = buf => buf.length > 512 && buf.subarray(0, 8).toString("hex") === CFB_MAGIC;

// ---- OLE compound file: find a stream by name --------------------------------------------------------------------
function cfbStream(buf, wanted) {
  const secSize = 1 << buf.readUInt16LE(0x1e), miniSize = 1 << buf.readUInt16LE(0x20);
  if (secSize !== 512 && secSize !== 4096) throw new Error("Not a valid Excel file.");
  const cutoff = buf.readUInt32LE(0x38), sector = n => buf.subarray((n + 1) * secSize, (n + 2) * secSize);
  const ENDS = n => n >= 0xfffffffa;
  // DIFAT: 109 entries in the header, then a chain of DIFAT sectors
  const difat = [];
  for (let i = 0; i < 109; i++) { const s = buf.readUInt32LE(0x4c + i * 4); if (!ENDS(s)) difat.push(s); }
  let d = buf.readUInt32LE(0x44), guard = 0;
  while (!ENDS(d) && guard++ < 10000) { const s = sector(d), per = secSize / 4 - 1; for (let i = 0; i < per; i++) { const x = s.readUInt32LE(i * 4); if (!ENDS(x)) difat.push(x); } d = s.readUInt32LE(per * 4); }
  const fat = [];
  for (const s of difat) { const sec = sector(s); for (let i = 0; i < secSize / 4; i++) fat.push(sec.readUInt32LE(i * 4)); }
  const chain = (start, table) => { const out = []; let n = start, g = 0; while (!ENDS(n) && n < table.length && g++ < 1e6) { out.push(n); n = table[n]; } return out; };
  const readChain = start => Buffer.concat(chain(start, fat).map(sector));
  const dir = readChain(buf.readUInt32LE(0x30)), entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const len = dir.readUInt16LE(o + 64), type = dir[o + 66];
    if (!type) continue;
    entries.push({ name: dir.subarray(o, o + Math.max(0, len - 2)).toString("utf16le"), type, start: dir.readUInt32LE(o + 116), size: dir.readUInt32LE(o + 120) });
  }
  const e = entries.find(x => x.type === 2 && wanted.includes(x.name));
  if (!e) return null;
  if (e.size >= cutoff) return readChain(e.start).subarray(0, e.size);
  // small streams live in the mini stream (held by the root entry), indexed by the mini FAT
  const root = entries.find(x => x.type === 5), mini = readChain(root.start), miniFatBuf = readChain(buf.readUInt32LE(0x3c)), miniFat = [];
  for (let i = 0; i + 4 <= miniFatBuf.length; i += 4) miniFat.push(miniFatBuf.readUInt32LE(i));
  return Buffer.concat(chain(e.start, miniFat).map(n => mini.subarray(n * miniSize, (n + 1) * miniSize))).subarray(0, e.size);
}

// ---- BIFF8 records ---------------------------------------------------------------------------------------------------
function rk(x) {
  let v;
  if (x & 2) v = x >> 2; // 30-bit signed integer
  else { const b = Buffer.alloc(8); b.writeUInt32LE((x & 0xfffffffc) >>> 0, 4); v = b.readDoubleLE(0); }
  return x & 1 ? v / 100 : v;
}
const numText = v => (Number.isFinite(v) ? String(Math.round(v * 1e10) / 1e10) : "");

// XLUnicodeString with a 16-bit length (LABEL, STRING records)
function uniStr(b, o, lenBytes = 2) {
  const cch = lenBytes === 2 ? b.readUInt16LE(o) : b[o], flags = b[o + lenBytes], p = o + lenBytes + 1;
  return flags & 1 ? b.subarray(p, p + cch * 2).toString("utf16le") : b.subarray(p, p + cch).toString("latin1");
}

// Shared strings: the SST record plus CONTINUE records. A string's characters may break across records; each new
// record then starts with a fresh flags byte (8-bit or 16-bit characters).
function readSst(data, bounds) {
  const out = []; let pos = 8; const total = data.readUInt32LE(4);
  const nextBound = p => { for (const b of bounds) if (b > p) return b; return data.length; };
  while (out.length < total && pos < data.length) {
    if (bounds.includes(pos) && pos + 3 > data.length) break;
    const cch = data.readUInt16LE(pos), flags = data[pos + 2]; pos += 3;
    let high = flags & 1, runs = 0, ext = 0;
    if (flags & 8) { runs = data.readUInt16LE(pos); pos += 2; }
    if (flags & 4) { ext = data.readUInt32LE(pos); pos += 4; }
    let left = cch, s = "";
    while (left > 0 && pos < data.length) {
      const end = nextBound(pos), fit = Math.min(left, high ? Math.floor((end - pos) / 2) : end - pos);
      s += high ? data.subarray(pos, pos + fit * 2).toString("utf16le") : data.subarray(pos, pos + fit).toString("latin1");
      pos += high ? fit * 2 : fit; left -= fit;
      if (left > 0) { high = data[pos] & 1; pos++; } // continued in the next record
    }
    pos += runs * 4 + ext;
    out.push(s);
  }
  return out;
}

function* records(wb, from = 0) {
  let o = from;
  while (o + 4 <= wb.length) {
    const type = wb.readUInt16LE(o), len = wb.readUInt16LE(o + 2);
    yield { type, data: wb.subarray(o + 4, o + 4 + len), at: o };
    o += 4 + len;
  }
}

export function readXls(buf) {
  if (!isCfb(buf)) return readXlsText(buf);
  const wb = cfbStream(buf, ["Workbook", "Book"]);
  if (!wb) throw new Error("This .xls file has no workbook inside.");
  if (wb.readUInt16LE(0) !== 0x0809) throw new Error("Not a valid Excel workbook.");
  const ver = wb.readUInt16LE(4 + 0);
  if (ver !== 0x0600) throw new Error("This is an Excel 95 or older file: open it in Excel and save it as .xlsx, then upload.");
  // workbook globals: sheet list and shared strings
  const sheets = []; let sst = [];
  for (const r of records(wb)) {
    if (r.type === 0x002f) throw new Error("This Excel file is password-protected: open it, save it without a password, then upload.");
    if (r.type === 0x0085) { const pos = r.data.readUInt32LE(0), kind = r.data[5]; if (kind === 0) sheets.push({ pos, name: uniStr(r.data, 6, 1) }); }
    else if (r.type === 0x00fc) {
      const parts = [r.data], bounds = []; let len = r.data.length;
      for (const c of records(wb, r.at + 4 + r.data.length)) { if (c.type !== 0x003c) break; bounds.push(len); parts.push(c.data); len += c.data.length; }
      sst = readSst(Buffer.concat(parts), bounds);
    } else if (r.type === 0x000a) break;
  }
  return sheets.map(sh => {
    const grid = []; let pendingFormula = null;
    const put = (row, col, v) => { (grid[row] ||= [])[col] = v; };
    for (const r of records(wb, sh.pos)) {
      const d = r.data;
      if (r.type === 0x000a) break; // EOF of this sheet
      switch (r.type) {
        case 0x00fd: put(d.readUInt16LE(0), d.readUInt16LE(2), sst[d.readUInt32LE(6)] ?? ""); break; // LABELSST
        case 0x0203: put(d.readUInt16LE(0), d.readUInt16LE(2), numText(d.readDoubleLE(6))); break; // NUMBER
        case 0x027e: put(d.readUInt16LE(0), d.readUInt16LE(2), numText(rk(d.readUInt32LE(6)))); break; // RK
        case 0x00bd: { // MULRK
          const row = d.readUInt16LE(0), first = d.readUInt16LE(2), n = (d.length - 6) / 6;
          for (let i = 0; i < n; i++) put(row, first + i, numText(rk(d.readUInt32LE(4 + i * 6 + 2))));
          break;
        }
        case 0x0204: put(d.readUInt16LE(0), d.readUInt16LE(2), uniStr(d, 6)); break; // LABEL
        case 0x0006: { // FORMULA: use the cached result
          const row = d.readUInt16LE(0), col = d.readUInt16LE(2);
          if (d.readUInt16LE(12) === 0xffff) { const k = d[6]; if (k === 0) pendingFormula = { row, col }; else if (k === 1) put(row, col, d[8] ? "TRUE" : "FALSE"); }
          else put(row, col, numText(d.readDoubleLE(6)));
          break;
        }
        case 0x0207: if (pendingFormula) { put(pendingFormula.row, pendingFormula.col, uniStr(d, 0)); pendingFormula = null; } break; // STRING
        case 0x0205: if (d[7] === 0) put(d.readUInt16LE(0), d.readUInt16LE(2), d[6] ? "TRUE" : "FALSE"); break; // BOOLERR
      }
    }
    const rows = Array.from(grid, row => Array.from(row || [], x => String(x ?? "").replace(/\s+/g, " ").trim()));
    return { name: sh.name, rows };
  });
}

// ---- ".xls" files that are really HTML or Excel 2003 XML -------------------------------------------------------------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = s => String(s).replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, "").replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m)).replace(/\s+/g, " ").trim();
export function readXlsText(buf) {
  const text = buf.toString("utf8").replace(/^﻿/, "");
  if (/<Workbook[^>]*urn:schemas-microsoft-com:office:spreadsheet/i.test(text)) {
    return [...text.matchAll(/<(?:ss:)?Worksheet\b[^>]*?(?:ss:)?Name="([^"]*)"[^>]*>([\s\S]*?)<\/(?:ss:)?Worksheet>/gi)].map(([, name, body]) => ({
      name: decode(name),
      rows: [...body.matchAll(/<(?:ss:)?Row\b[^>]*>([\s\S]*?)<\/(?:ss:)?Row>/gi)].map(([, row]) => {
        const out = [];
        for (const [, attrs, inner] of row.matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/gi)) {
          const idx = /(?:ss:)?Index="(\d+)"/i.exec(attrs)?.[1]; if (idx) while (out.length < Number(idx) - 1) out.push("");
          out.push(decode(/<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/i.exec(inner || "")?.[1] || ""));
        }
        return out;
      })
    }));
  }
  if (/<table/i.test(text)) {
    return [...text.matchAll(/<table\b[\s\S]*?<\/table>/gi)].map(([t], i) => ({
      name: `Table ${i + 1}`,
      rows: [...t.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(([, tr]) => {
        const out = [];
        for (const [, attrs, inner] of tr.matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)(?=<t[dh]\b|<\/tr>|$)/gi)) { out.push(decode(inner.replace(/<\/t[dh]>[\s\S]*$/i, ""))); const span = Number(/colspan="?(\d+)/i.exec(attrs)?.[1] || 1); for (let k = 1; k < span && k < 50; k++) out.push(""); }
        return out;
      })
    }));
  }
  return null;
}
