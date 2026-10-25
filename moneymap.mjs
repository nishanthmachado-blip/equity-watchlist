// "Money Map" Excel download: one month on a single page in the user's own template layout. Expenses are split into
// responsible spending and bonus spending; monthly investments, savings spent on big purchases and the current
// portfolio are on the right. Blue numbers come from the app, orange totals are live Excel formulas. Three sheets:
//   Money Map  the template layout, filled in
//   Details    where every number came from (budget line, daily spends, net worth line), income and savings
//   Spends     the month's daily spends
// Numbers: a budget line counts its daily spends when you logged any for it (actual), otherwise its budgeted amount;
// daily spends not linked to a budget line go to their own row by category. Pure: the server passes the data in.
import { zip } from "./xlsx.mjs";
import { CATEGORIES } from "./expenses.mjs";

const xe = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
const r0 = v => Math.round(v || 0);

// Left side: [row, label, test(plan line name) , categories counted here when not linked to a budget line, item test]
export const SPEND_ROWS = [
  [4, "Rent + Maintenance", /rent|mainten|maintain|society/i],
  [5, "Utilities (Electricity + Wi-Fi)", /electric|internet|wi-?fi|broadband|\bgas\b|water|dth|bescom/i, ["Bills & recharges"], it => !/recharge|mobile/i.test(it)],
  [6, "Groceries", /grocer|milk|vegetable|fruit|provision/i, ["Groceries", "Milk & dairy", "Meat & fish", "Fruits & vegetables"]],
  [7, "Domestic Help", /maid|cook|driver|nanny|domestic|help\b/i],
  [8, "Car Maintenance", /\bcar\b(?! ?loan)|bike|vehicle|scooter|activa|servic/i, ["Vehicle"]],
  [9, "Mobile Recharge", /mobile|recharge|phone bill/i, ["Bills & recharges"], it => /recharge|mobile/i.test(it)],
  [10, "Health Insurance Premium", /health insurance|mediclaim/i, ["Health"]],
  [11, "Life Insurance", /life insurance|term plan|term insurance|\blic\b/i],
  [12, "Child Education", /kid|child|school|tuition|drawing|van\b|education|class/i, ["Kids"]],
  [13, "EMI (Home Loan)", /home loan|housing loan|\bemi\b/i],
  [14, "EMI (Education Loan)", /education loan/i],
  [15, "Elderly Care", /mom|dad|parent|elder|father|mother/i],
  [16, "Money Sent To Family", /family|sent|send|transfer/i, ["Gifts & family"]],
  [17, "Transportation", /petrol|fuel|diesel|cab|uber|ola\b|metro|bus\b|transport|toll|parking/i, ["Fuel"]],
  [21, "Food Delivery", /swiggy|zomato|delivery/i, ["Food delivery & eating out"], it => /swiggy|zomato|delivery|eatsure|dunzo/i.test(it)],
  [22, "Dining Out", /dining|restaurant|eat ?out|hotel/i, ["Food delivery & eating out"], it => !/swiggy|zomato|delivery|eatsure|dunzo/i.test(it)],
  [23, "Entertainment", /movie|entertain|outing|party/i, ["Entertainment", "Drinks & treats"], it => !/netflix|prime|hotstar|spotify|subscription|youtube/i.test(it)],
  [24, "Subscriptions", /netflix|prime|hotstar|spotify|subscription|youtube|ott/i, ["Entertainment"], it => /netflix|prime|hotstar|spotify|subscription|youtube/i.test(it)],
  [25, "Gadgets / Electronics", /gadget|electronic|laptop|phone purchase|headphone/i, ["Shopping"], it => /phone|laptop|gadget|electronic|headphone|earbuds|watch|tv\b|croma/i.test(it)],
  [26, "Grooming", /groom|salon|haircut|parlou?r|spa/i, ["Personal care"]],
  [27, "Clothing / Footwear", /cloth|shoe|footwear|dress|apparel/i, ["Shopping"], it => /cloth|shoe|myntra|ajio|dress|shirt|footwear|apparel/i.test(it)],
  [28, "Gym / Sports / Fitness", /gym|sport|fitness|yoga|swim|cult/i],
  [29, "Travel", /travel|trip|holiday|vacation|flight|train/i, ["Travel"]],
  [30, "Other", /.*/, Object.keys(CATEGORIES)]
];
export const INVEST_ROWS = [
  [5, "SIPs (Mutual Funds)", /\bmf\b|mutual|sip|elss|index fund|flexi|nifty/i],
  [6, "Direct Equities", /stock|equit|share|demat|ind stocks|us stocks|smallcase/i],
  [7, "EPF / PPF / NPS", /ppf|epf|nps|vpf|\bpf\b|provident/i],
  [8, "Fixed / Recurring Deposits", /\bfd\b|\brd\b|deposit/i],
  [9, "Cryptocurrency", /crypto|bitcoin|btc|eth/i],
  [10, "Gold (Digital/Physical)", /gold|sgb|silver/i],
  [11, "Emergency / Opportunity Fund", /emergency|opportunity|liquid|arbitrage|buffer/i]
];
export const PORTFOLIO_ROWS = [
  [24, "Mutual Funds", ["mf"]], [25, "Direct Equities Portfolio", ["stocks"]], [26, "US Equities Portfolio", ["intl"]], [27, "EPF / PPF Balance", ["epf", "ppf"]],
  [28, "Fixed Deposits", ["fd"]], [29, "Real Estate Holdings", ["realestate"]], [30, "Cash Reserves (Cash in Bank)", ["cash"]], [31, "Gold (Digital/Physical)", ["gold"]],
  [32, "Corporate Bond", ["bonds"]], [33, "NPS", ["nps"]], [34, "Loan/Commodities Portfolio", ["crypto", "other", "insurance"]]
];

// month: { income, plan, entries }; budgets: category → budget line name (user's settings); nwLines: net worth asset lines
export function moneyMapData({ month, label, data = {}, budgets = {}, nwLines = [], basis = "actual", bigSpends = [] } = {}) {
  const plan = data.plan || [], entries = data.entries || [], details = [];
  const B = Object.fromEntries(SPEND_ROWS.map(r => [r[0], 0])), E = Object.fromEntries([...INVEST_ROWS.map(r => [r[0], 0]), [15, 0], [16, 0], [17, 0], [18, 0], ...PORTFOLIO_ROWS.map(r => [r[0], 0])]);
  const budgetOf = c => (budgets[c] ?? CATEGORIES[c]?.budget ?? "") || "";
  const linked = new Set(); // categories counted inside a budget line
  // budget lines
  for (const p of plan) {
    if (p.type === "invest") {
      const row = INVEST_ROWS.find(r => r[2].test(p.name)) || INVEST_ROWS[1];
      if (p.amount > 0) { E[row[0]] += p.amount; details.push(["Investment", row[1], "Budget line", p.name, p.amount]); }
      continue;
    }
    const cats = Object.keys(CATEGORIES).filter(c => budgetOf(c).toLowerCase() === p.name.toLowerCase());
    cats.forEach(c => linked.add(c));
    const spent = entries.filter(e => cats.includes(e.category)).reduce((a, e) => a + e.amount, 0);
    const useActual = basis === "actual" && cats.length && entries.some(e => cats.includes(e.category));
    const amount = useActual ? spent : p.amount || 0; if (!(amount > 0)) continue;
    const row = (/credit card/i.test(p.name) ? null : SPEND_ROWS.find(r => r[0] !== 30 && r[2].test(p.name))) || SPEND_ROWS.find(r => r[0] === 30);
    B[row[0]] += amount; details.push(["Spending", row[1], useActual ? `Budget line, actual from daily spends (budget ₹${r0(p.amount).toLocaleString("en-IN")})` : /credit card/i.test(p.name) ? "Budget line (a card bill: if its spends are also in Daily spends they count twice; edit this cell)" : "Budget line", p.name, amount]);
  }
  // daily spends not linked to a budget line
  for (const e of entries) {
    if (linked.has(e.category)) continue;
    const row = SPEND_ROWS.find(r => r[0] !== 30 && r[3]?.includes(e.category) && (!r[4] || r[4](e.item))) || SPEND_ROWS.find(r => r[0] === 30);
    B[row[0]] += e.amount; details.push(["Spending", row[1], `Daily spend (${e.date})`, `${e.item} · ${e.category}`, e.amount]);
  }
  // big purchases paid from savings (optional, from the caller)
  const bigRow = { car: 15, vehicle: 15, house: 16, home: 16, property: 16, "real estate": 16, marriage: 17, wedding: 17 };
  for (const s of bigSpends) { const k = Object.keys(bigRow).find(x => new RegExp(x, "i").test(s.name)); const row = bigRow[k] || 18; E[row] += s.amount; details.push(["Savings spent", ["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "Car", "Real Estate Purchase", "Spends on Marriage", "Other Big Purchase"][row], "Big purchase", s.name, s.amount]); }
  // current portfolio from net worth
  for (const l of nwLines) {
    if (l.kind === "liability" || !(l.value > 0)) continue;
    const row = PORTFOLIO_ROWS.find(r => r[2].includes(l.category)); if (!row) continue;
    E[row[0]] += l.value; details.push(["Portfolio", row[1], "Net worth", l.name, l.value]);
  }
  for (const k of Object.keys(B)) B[k] = r0(B[k]); for (const k of Object.keys(E)) E[k] = r0(E[k]);
  const income = (data.income || []).reduce((a, x) => a + (x.amount || 0), 0);
  const spendTotal = Object.values(B).reduce((a, v) => a + v, 0), investTotal = INVEST_ROWS.reduce((a, r) => a + E[r[0]], 0);
  return { month, label, basis, B, E, details, income: r0(income), spendTotal, investTotal, left: r0(income - spendTotal - investTotal), entries: [...entries].sort((a, b) => a.date.localeCompare(b.date)), incomeLines: data.income || [] };
}

// ---- the workbook ----
// cell styles (same look as the template): 1 title, 2 section header, 3 section header (second cell), 4 label,
// 5 blue number (input), 7 total label (orange), 8 total number (orange), 9 note, 10 black number, 11 bold label, 12 date
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="3"><numFmt numFmtId="164" formatCode="[&gt;=10000000]&quot;₹&quot;##\\,##\\,##\\,##0;[&gt;=100000]&quot;₹&quot;##\\,##\\,##0;&quot;₹&quot;#,##0"/><numFmt numFmtId="165" formatCode="&quot;₹&quot;#,##0;&quot;(₹&quot;#,##0&quot;)&quot;;&quot;-&quot;"/><numFmt numFmtId="166" formatCode="[&gt;=100000]&quot;₹&quot;##\\,##\\,##0;[&gt;0]&quot;₹&quot;#,##0;&quot;-&quot;"/></numFmts>
<fonts count="9"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="20"/><color rgb="FF1A1A1A"/><name val="Arial"/></font><font><b/><sz val="12"/><color rgb="FF1A1A1A"/><name val="Arial"/></font><font><sz val="11"/><name val="Arial"/></font><font><sz val="11"/><color rgb="FF1A1A1A"/><name val="Arial"/></font><font><sz val="11"/><color rgb="FF0000FF"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><i/><sz val="10"/><color rgb="FF808080"/><name val="Arial"/></font><font><b/><sz val="11"/><color rgb="FF1A1A1A"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFBD9C6"/><bgColor rgb="FFFBD9C6"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4703A"/><bgColor rgb="FFF4703A"/></patternFill></fill></fills>
<borders count="4"><border/><border><left style="thin"><color rgb="FFD9D9D9"/></left><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom></border><border><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom></border><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="166" fontId="5" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="166" fontId="5" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="6" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="166" fontId="6" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="164" fontId="4" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="0" fontId="8" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="4" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1"/><xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="5" fillId="0" borderId="3" xfId="0" applyFont="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="164" fontId="6" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/><xf numFmtId="165" fontId="6" fillId="3" borderId="3" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
const str = (ref, s, st) => `<c r="${ref}" s="${st}" t="inlineStr"><is><t xml:space="preserve">${xe(s)}</t></is></c>`;
const num = (ref, v, st = 5) => `<c r="${ref}" s="${st}"><v>${Number(v) || 0}</v></c>`;
const fml = (ref, f, v, st = 8) => `<c r="${ref}" s="${st}"><f>${f}</f><v>${v}</v></c>`;
const blank = (ref, st) => `<c r="${ref}" s="${st}"/>`;
// "₹30.60 L" / "₹2.18 Cr" beside an amount (a formula, so it follows when you change the number); blank under a lakh
export const lakhCrore = v => { const a = Math.abs(v || 0), sg = v < 0 ? "-" : ""; return a >= 1e7 ? `${sg}₹${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${sg}₹${(a / 1e5).toFixed(2)} L` : ""; };
const lcFormula = ref => `IF(ABS(${ref})&gt;=10000000,IF(${ref}&lt;0,"-","")&amp;"₹"&amp;TEXT(ABS(${ref})/10000000,"0.00")&amp;" Cr",IF(ABS(${ref})&gt;=100000,IF(${ref}&lt;0,"-","")&amp;"₹"&amp;TEXT(ABS(${ref})/100000,"0.00")&amp;" L",""))`;
// add a lakh / crore label in the next column for every amount cell in these columns
function withLabels(rows, cols) {
  return rows.map(([r, cells, ht]) => {
    const extra = [];
    for (const c of cells) { const m = c.match(/^<c r="([A-Z]+)(\d+)" s="(\d+)">(?:<f>[^<]*<\/f>)?<v>(-?[\d.]+)<\/v>/); if (!m || !cols[m[1]]) continue; extra.push(`<c r="${cols[m[1]]}${m[2]}" s="13" t="str"><f>${lcFormula(m[1] + m[2])}</f><v>${xe(lakhCrore(Number(m[4])))}</v></c>`); }
    const all = [...cells, ...extra], key = c => { const col = c.match(/r="([A-Z]+)/)[1]; return col.length * 100 + col.charCodeAt(0); };
    return [r, all.sort((a, b) => key(a) - key(b)), ht];
  });
}
const sheetXml = ({ cols, rows, merges = [], freeze = null }) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0">${freeze ? `<pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/>` : ""}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15.75"/><cols>${cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rows.map(([r, cells, ht]) => `<row r="${r}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cells.join("")}</row>`).join("")}</sheetData>${merges.length ? `<mergeCells count="${merges.length}">${merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}<pageMargins left="0.75" right="0.75" top="1" bottom="1" header="0" footer="0"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/></worksheet>`;

export function buildMoneyMap(d) {
  const { B, E } = d, sum = (o, a, b) => { let t = 0; for (let i = a; i <= b; i++) t += o[i] || 0; return t; };
  const b18 = sum(B, 4, 17), b31 = sum(B, 21, 30), e12 = sum(E, 5, 11), e19 = sum(E, 15, 18), e35 = sum(E, 24, 34);
  const R = new Map(); const put = (r, ...cells) => { R.set(r, [...(R.get(r) || []), ...cells]); };
  put(1, str("A1", "EXPENSES", 1), str("D1", "INVESTMENT", 1));
  put(2, str("A2", `${d.label} · ${d.basis === "actual" ? "actual spends where logged, else budget" : "budgeted amounts"} · from Equity Watchlist`, 9));
  put(3, str("A3", "Responsible Spending", 2), blank("B3", 3));
  put(4, str("D4", "Monthly Investment Allocation", 2), blank("E4", 3));
  for (const [r, label] of SPEND_ROWS) if (r <= 17) put(r, str(`A${r}`, label, 4), num(`B${r}`, B[r]));
  for (const [r, label] of INVEST_ROWS) put(r, str(`D${r}`, label, 4), num(`E${r}`, E[r]));
  put(12, str("D12", "TOTAL MONTHLY INVESTMENT", 7), fml("E12", "SUM(E5:E11)", e12));
  put(14, str("D14", "Saving Spent", 2), blank("E14", 3));
  [[15, "Car"], [16, "Real Estate Purchase"], [17, "Spends on Marriage"], [18, "Other Big Purchase"]].forEach(([r, l]) => put(r, str(`D${r}`, l, 4), num(`E${r}`, E[r])));
  put(18, str("A18", "TOTAL RESPONSIBLE SPENDING", 7), fml("B18", "SUM(B4:B17)", b18));
  put(19, str("D19", "TOTAL SAVINGS SPENT", 7), fml("E19", "SUM(E15:E18)", e19));
  put(20, str("A20", "Bonus Spending", 2), blank("B20", 3), str("D20", "TOTAL MONTHLY SAVINGS", 7), fml("E20", "E12-E19", e12 - e19, 16));
  put(21, str("D21", "NET SURPLUS / (DEFICIT)", 7), fml("E21", "(E12)-(B32)", e12 - (b18 + b31), 16));
  for (const [r, label] of SPEND_ROWS) if (r >= 21) put(r, str(`A${r}`, label, 4), num(`B${r}`, B[r]));
  put(23, str("D23", "Current Portfolio Value", 2), blank("E23", 3));
  for (const [r, label] of PORTFOLIO_ROWS) put(r, str(`D${r}`, label, 4), num(`E${r}`, E[r], 14)); // crore-aware format
  put(31, str("A31", "TOTAL BONUS SPENDING", 7), fml("B31", "SUM(B21:B30)", b31));
  put(32, str("A32", "TOTAL MONTHLY SPENDING", 7), fml("B32", "B18+B31", b18 + b31));
  put(35, str("D35", "TOTAL PORTFOLIO VALUE", 7), fml("E35", "SUM(E24:E34)", e35, 15));
  put(37, str("A37", `Income this month: ₹${d.income.toLocaleString("en-IN")} · spending ₹${(b18 + b31).toLocaleString("en-IN")} · investing ₹${e12.toLocaleString("en-IN")} · left over ₹${(d.income - b18 - b31 - e12).toLocaleString("en-IN")}`, 9));
  put(38, str("A38", "Blue numbers come from the app (Monthly expenses and Net worth): change any of them here and the orange TOTAL rows and NET SURPLUS/(DEFICIT) recalculate. The Details sheet shows where each number came from.", 9));
  const order = c => c.match(/^[A-Z]+/)[0].charCodeAt(0);
  const rows = [...R].sort((a, b) => a[0] - b[0]).map(([r, cells]) => [r, cells.sort((x, y) => order(x.match(/r="([A-Z]+)/)[1]) - order(y.match(/r="([A-Z]+)/)[1])), r === 1 ? 27.75 : r === 38 ? 42 : null]);
  const map = sheetXml({ cols: [34, 16, 11, 34, 16, 11], rows: withLabels(rows, { B: "C", E: "F" }), merges: ["A1:B1", "D1:E1", "A2:E2", "A3:B3", "D4:E4", "D14:E14", "A20:B20", "D23:E23", "A37:E37", "A38:E38"], freeze: 2 });
  // Details
  const dr = [[1, [str("A1", `Where the numbers came from: ${d.label}`, 1)], 27.75], [3, [str("A3", "Income", 11), num("B3", d.income, 10)]]];
  let r = 4; for (const i of d.incomeLines) dr.push([r++, [str(`A${r - 1}`, `  ${i.name}`, 12), num(`B${r - 1}`, i.amount, 10)]]);
  r++; dr.push([r, [str(`A${r}`, "Section", 2), str(`B${r}`, "Money Map row", 2), str(`C${r}`, "From", 2), str(`D${r}`, "What", 2), str(`E${r}`, "Amount", 2)]]); r++;
  for (const [sec, row, from, what, amt] of d.details) { dr.push([r, [str(`A${r}`, sec, 12), str(`B${r}`, row, 12), str(`C${r}`, from, 12), str(`D${r}`, what, 12), num(`E${r}`, amt, 10)]]); r++; }
  const details = sheetXml({ cols: [22, 30, 62, 44, 16, 11], rows: withLabels(dr, { B: "C", E: "F" }), freeze: null });
  // Spends
  const sr = [[1, [str("A1", "Date", 2), str("B1", "Item", 2), str("C1", "Category", 2), str("D1", "Paid by", 2), str("E1", "Amount", 2), str("F1", "Note", 2)]]];
  d.entries.forEach((e, i) => sr.push([i + 2, [str(`A${i + 2}`, e.date, 12), str(`B${i + 2}`, e.item, 12), str(`C${i + 2}`, e.category, 12), str(`D${i + 2}`, e.mode || "", 12), num(`E${i + 2}`, e.amount, 10), str(`F${i + 2}`, e.note || "", 12)]]));
  if (d.entries.length) { const n = d.entries.length + 2; sr.push([n, [str(`A${n}`, "TOTAL", 7), blank(`B${n}`, 7), blank(`C${n}`, 7), blank(`D${n}`, 7), `<c r="E${n}" s="8"><f>SUM(E2:E${n - 1})</f><v>${d.entries.reduce((a, e) => a + e.amount, 0)}</v></c>`, blank(`F${n}`, 7)]]); }
  const spends = sheetXml({ cols: [12, 30, 26, 16, 14, 30], rows: sr, freeze: 1 });
  const sheets = [["Money Map", map], ["Details", details], ["Spends", spends]];
  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${xe(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/styles.xml", data: STYLES },
    ...sheets.map(([, x], i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x }))
  ]);
}
