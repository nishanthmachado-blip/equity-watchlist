import test from "node:test";
import assert from "node:assert/strict";
import { holdingsFromJson, apiCandidates, holdingPaths, periodOf, portfolioLinks, holdingsFromTables } from "../fundsource.mjs";
import { readXlsx } from "../funds.mjs";

test("holdings from any JSON shape: equity only, weights as % or fractions, the date", () => {
  const j = { scheme: "X", portfolio_date: "2026-09-30", data: { holdings: [
    { company_name: "Bajaj Finance Ltd", isin: "INE296A01032", sector: "Finance", percentage: 7.2, asset_type: "Equity" },
    { company_name: "Infosys Ltd", isin: "INE009A01021", percentage: 4.4, asset_type: "Equity" },
    { company_name: "Torrent Power", isin: "INE813H01021", percentage: 5.1, asset_type: "Equity" },
    { company_name: "7.26% GOI 2033", isin: "IN0020220151", percentage: 2, asset_type: "Debt" },
    { company_name: "TREPS", percentage: 3, asset_type: "Cash" }] } };
  const r = holdingsFromJson(j);
  assert.deepEqual(r.holdings.map(h => [h.name, h.weight]), [["Bajaj Finance Ltd", 7.2], ["Torrent Power", 5.1], ["Infosys Ltd", 4.4]]);
  assert.equal(r.asOf, "2026-09-30");
  const f = holdingsFromJson([{ name: "A Ltd", weight: 0.05 }, { name: "B Ltd", weight: 0.04 }, { name: "C Ltd", weight: 0.03 }]);
  assert.deepEqual(f.holdings.map(h => h.weight), [5, 4, 3]);
  assert.equal(holdingsFromJson({ nav: [{ date: "x", nav: 1 }] }), null);
});
test("API endpoints from an OpenAPI description, else the usual shapes", () => {
  const spec = { paths: { "/api/v1/schemes/{isin}/holdings": { get: { parameters: [{ name: "isin", in: "path", required: true }] } }, "/api/v1/portfolio": { get: { parameters: [{ name: "scheme_code", in: "query", required: true }] } }, "/api/v1/nav/{code}": { get: {} } } };
  assert.equal(holdingPaths(spec).length, 2);
  assert.deepEqual(apiCandidates("https://h", { isin: "INF1", code: 123 }, spec), ["https://h/api/v1/schemes/INF1/holdings", "https://h/api/v1/portfolio?scheme_code=123"]);
  assert.ok(apiCandidates("https://h", { isin: "INF1" }, null).includes("https://h/api/v1/schemes/INF1/holdings"));
});
test("fund house page: the newest portfolio file, a workbook's sheet for this fund", () => {
  assert.ok(periodOf("Monthly Portfolio September 2026") > periodOf("portfolio-aug-2026.xlsx"));
  assert.equal(periodOf("ppfas_2026-09.xlsx"), 2026 * 12 + 9);
  const html = `<a href="/files/aug-2026.xlsx">Monthly Portfolio August 2026</a><a href="/files/sep-2026.xlsx">Monthly Portfolio September 2026</a><a href="/about">About us</a><a href="/factsheet.pdf">Factsheet</a>`;
  const l = portfolioLinks(html, "https://amc.example/disclosures", "Flexi Cap");
  assert.equal(l[0].href, "https://amc.example/files/sep-2026.xlsx"); assert.equal(l.length, 2);
  const t = [{ name: "FCF", rows: [["Example Flexi Cap Fund"], ["Portfolio as on 30 Sep 2026"], ["Name of the Instrument", "ISIN", "% to Net Assets"], ["HDFC Bank Ltd", "INE040A01034", "0.08"], ["ITC Ltd", "INE154A01025", "0.05"]] },
    { name: "TSF", rows: [["Example Tax Saver Fund"], ["Name of the Instrument", "ISIN", "% to Net Assets"], ["Maruti Suzuki", "INE585B01010", "0.05"]] }];
  const g = holdingsFromTables(t, "Example Flexi Cap Fund - Direct Growth");
  assert.deepEqual(g.holdings.map(h => [h.name, h.weight]), [["HDFC Bank Ltd", 8], ["ITC Ltd", 5]]); assert.equal(g.asOf, "30 Sep 2026");
  assert.ok(holdingsFromTables(t, "Some Other Fund").ambiguous);
});
test("xlsx reader: relationships with attributes in any order", () => {
  // a tiny workbook written by a tool that puts Target before Id (openpyxl style), built in memory
  const zlib = require_zlib();
  const files = { "xl/workbook.xml": '<workbook><sheets><sheet xmlns:r="x" name="S1" sheetId="1" r:id="rId1"/></sheets></workbook>', "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Type="t" Target="/xl/worksheets/sheet1.xml" Id="rId1"/></Relationships>', "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Name</t></is></c><c r="B1" t="inlineStr"><is><t>Weight %</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>HDFC Bank</t></is></c><c r="B2"><v>8</v></c></row></sheetData></worksheet>' };
  const t = readXlsx(zipStore(files, zlib));
  assert.equal(t[0].name, "S1"); assert.deepEqual(t[0].rows, [["Name", "Weight %"], ["HDFC Bank", "8"]]);
});
import zlibMod from "node:zlib";
function require_zlib() { return zlibMod; }
// minimal "stored" zip writer for the test
function zipStore(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), nm = Buffer.from(name), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(0, 8); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    parts.push(h, nm, data);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0, 10); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
