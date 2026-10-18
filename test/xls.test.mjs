import test from "node:test";
import assert from "node:assert/strict";
import { readXls, readXlsText } from "../xls.mjs";
import { readSheetFile, sheetInfo, extractHoldings } from "../funds.mjs";

// Builds a minimal Excel 97-2003 (.xls) file: an OLE compound file holding a BIFF8 "Workbook" stream, with shared
// strings split across a CONTINUE record, NUMBER / RK / MULRK / LABEL cells and a formula with a cached string.
function rec(type, data) { const h = Buffer.alloc(4); h.writeUInt16LE(type, 0); h.writeUInt16LE(data.length, 2); return Buffer.concat([h, data]); }
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }, u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const f64 = n => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; };
const cell = (r, c) => Buffer.concat([u16(r), u16(c), u16(0)]);
const rkInt = n => ((n << 2) | 2) >>> 0, rkCent = n => ((n << 2) | 3) >>> 0; // integer, integer / 100
function buildXls() {
  const bof = t => rec(0x0809, Buffer.concat([u16(0x0600), u16(t), Buffer.alloc(12)]));
  const strs = ["Name of the Instrument", "ISIN", "% to AUM", "HDFC Bank Ltd.", "INE040A01034", "ICICI Bank Ltd.", "INE090A01021", "Infosys Ltd.", "INE009A01021", "SCHEME NAME :", "Helios Flexi Cap Fund (An open-ended scheme)", "PORTFOLIO STATEMENT AS ON :"];
  const sstBody = Buffer.concat(strs.map(s => Buffer.concat([u16(s.length), Buffer.from([0]), Buffer.from(s, "latin1")])));
  const head = Buffer.concat([u32(strs.length), u32(strs.length)]), cut = 30; // break inside "Name of the Instrument"'s neighbour
  const sst1 = Buffer.concat([head, sstBody.subarray(0, cut)]), sst2 = Buffer.concat([Buffer.from([0]), sstBody.subarray(cut)]);
  const sheetRecs = (pos0) => Buffer.concat([
    bof(0x10),
    rec(0x00fd, Buffer.concat([cell(0, 2), u32(9)])), rec(0x00fd, Buffer.concat([cell(0, 3), u32(10)])),
    rec(0x00fd, Buffer.concat([cell(1, 2), u32(11)])), rec(0x0203, Buffer.concat([cell(1, 3), f64(46295)])),
    rec(0x00fd, Buffer.concat([cell(3, 2), u32(0)])), rec(0x00fd, Buffer.concat([cell(3, 3), u32(1)])), rec(0x00fd, Buffer.concat([cell(3, 4), u32(2)])),
    rec(0x00fd, Buffer.concat([cell(4, 2), u32(3)])), rec(0x00fd, Buffer.concat([cell(4, 3), u32(4)])), rec(0x0203, Buffer.concat([cell(4, 4), f64(4.31)])),
    rec(0x00fd, Buffer.concat([cell(5, 2), u32(5)])), rec(0x00fd, Buffer.concat([cell(5, 3), u32(6)])), rec(0x027e, Buffer.concat([cell(5, 4), u32(rkCent(412)), ])),
    rec(0x0204, Buffer.concat([cell(6, 2), u16(12), Buffer.from([0]), Buffer.from("Infosys Ltd.", "latin1")])), rec(0x00fd, Buffer.concat([cell(6, 3), u32(8)])),
    rec(0x0006, Buffer.concat([cell(6, 4), Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0xff]), Buffer.alloc(6)])), rec(0x0207, Buffer.concat([u16(4), Buffer.from([0]), Buffer.from("3.05", "latin1")])),
    rec(0x00bd, Buffer.concat([u16(7), u16(5), u16(0), u32(rkInt(7)), u16(0), u32(rkInt(-3)), u16(6)])),
    rec(0x000a, Buffer.alloc(0))]);
  const name = "HFCF", bsData = pos => Buffer.concat([u32(pos), Buffer.from([0, 0]), Buffer.from([name.length, 0]), Buffer.from(name, "latin1")]);
  const globalsNoPos = Buffer.concat([bof(5), rec(0x0085, bsData(0)), rec(0x00fc, sst1), rec(0x003c, sst2), rec(0x000a, Buffer.alloc(0))]);
  const pos = globalsNoPos.length;
  const wb = Buffer.concat([bof(5), rec(0x0085, bsData(pos)), rec(0x00fc, sst1), rec(0x003c, sst2), rec(0x000a, Buffer.alloc(0)), sheetRecs(pos)]);
  // compound file: header, FAT sector, directory sector, workbook sectors (>= 4096 bytes so it is a normal stream)
  const SS = 512, padded = Buffer.concat([wb, Buffer.alloc(Math.max(4096, Math.ceil(wb.length / SS) * SS) - wb.length)]), n = padded.length / SS;
  const hdr = Buffer.alloc(SS, 0); Buffer.from("d0cf11e0a1b11ae1", "hex").copy(hdr, 0);
  hdr.writeUInt16LE(0x3e, 0x18); hdr.writeUInt16LE(3, 0x1a); hdr.writeUInt16LE(0xfffe, 0x1c); hdr.writeUInt16LE(9, 0x1e); hdr.writeUInt16LE(6, 0x20);
  hdr.writeUInt32LE(1, 0x2c); hdr.writeUInt32LE(1, 0x30); hdr.writeUInt32LE(4096, 0x38); hdr.writeUInt32LE(0xfffffffe, 0x3c); hdr.writeUInt32LE(0xfffffffe, 0x44);
  for (let i = 0; i < 109; i++) hdr.writeUInt32LE(0xffffffff, 0x4c + i * 4); hdr.writeUInt32LE(0, 0x4c);
  const fat = Buffer.alloc(SS, 0xff); fat.writeUInt32LE(0xfffffffd, 0); fat.writeUInt32LE(0xfffffffe, 4);
  for (let i = 0; i < n; i++) fat.writeUInt32LE(i === n - 1 ? 0xfffffffe : 3 + i, (2 + i) * 4);
  const dir = Buffer.alloc(SS, 0), ent = (o, nm, type, start, size) => { Buffer.from(nm + "\0", "utf16le").copy(dir, o); dir.writeUInt16LE((nm.length + 1) * 2, o + 64); dir[o + 66] = type; dir.writeUInt32LE(start, o + 116); dir.writeUInt32LE(size, o + 120); };
  ent(0, "Root Entry", 5, 0xfffffffe, 0); ent(128, "Workbook", 2, 2, padded.length); // padded past 4096 bytes: a normal (not mini) stream
  return Buffer.concat([hdr, fat, dir, padded]);
}

test(".xls (Excel 97-2003): sheets, shared strings across CONTINUE, numbers, RK, MULRK, labels and formula strings", () => {
  const t = readXls(buildXls());
  assert.equal(t.length, 1); assert.equal(t[0].name, "HFCF");
  const r = t[0].rows;
  assert.deepEqual(r[3].slice(2), ["Name of the Instrument", "ISIN", "% to AUM"]);
  assert.deepEqual(r[4].slice(2), ["HDFC Bank Ltd.", "INE040A01034", "4.31"]);
  assert.deepEqual(r[5].slice(2), ["ICICI Bank Ltd.", "INE090A01021", "4.12"]);
  assert.deepEqual(r[6].slice(2), ["Infosys Ltd.", "INE009A01021", "3.05"]);
  assert.deepEqual(r[7].slice(5), ["7", "-3"]);
  const h = extractHoldings(r).holdings;
  assert.deepEqual(h.map(x => [x.name, x.weight]), [["HDFC Bank Ltd.", 4.31], ["ICICI Bank Ltd.", 4.12], ["Infosys Ltd.", 3.05]]);
  assert.deepEqual(sheetInfo(r), { title: "Helios Flexi Cap Fund (An open-ended scheme)", asOf: "30 Sep 2026" });
  assert.equal(readSheetFile(buildXls(), "x.xls")[0].name, "HFCF");
});

test(".xls saved as HTML or Excel 2003 XML; title and date from text", () => {
  const html = Buffer.from("<html><table><tr><th>Name of the Instrument</th><th>% to NAV</th></tr><tr><td>TCS &amp; Co</td><td>5.1</td></tr></table></html>");
  assert.deepEqual(readSheetFile(html, "p.xls")[0].rows, [["Name of the Instrument", "% to NAV"], ["TCS & Co", "5.1"]]);
  const xml = Buffer.from('<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Small Cap"><Table><Row><Cell><Data ss:Type="String">A</Data></Cell><Cell ss:Index="3"><Data ss:Type="Number">2</Data></Cell></Row></Table></Worksheet></Workbook>');
  assert.deepEqual(readXlsText(xml), [{ name: "Small Cap", rows: [["A", "", "2"]] }]);
  assert.deepEqual(sheetInfo([["IDF271", "Portfolio Statement as on September 30,2026"], ["", "Bandhan Small Cap Fund"]]), { title: "Bandhan Small Cap Fund", asOf: "September 30,2026" });
});
