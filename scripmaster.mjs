// Offline list of listed Indian companies for search-as-you-type, so suggestions work even when Yahoo or Screener are
// rate-limiting. Built from Zerodha's public instrument dump (api.kite.trade/instruments, no login needed) or NSE's
// EQUITY_L.csv, refreshed weekly; a bundled list of ~170 large and mid caps covers the very first run.
export const SEED = [
  ["RELIANCE", "Reliance Industries"], ["TCS", "Tata Consultancy Services"], ["HDFCBANK", "HDFC Bank"], ["ICICIBANK", "ICICI Bank"], ["INFY", "Infosys"], ["BHARTIARTL", "Bharti Airtel"], ["SBIN", "State Bank of India"], ["ITC", "ITC"], ["HINDUNILVR", "Hindustan Unilever"], ["LT", "Larsen & Toubro"],
  ["KOTAKBANK", "Kotak Mahindra Bank"], ["AXISBANK", "Axis Bank"], ["BAJFINANCE", "Bajaj Finance"], ["BAJAJFINSV", "Bajaj Finserv"], ["ASIANPAINT", "Asian Paints"], ["MARUTI", "Maruti Suzuki India"], ["M&M", "Mahindra & Mahindra"], ["TATAMOTORS", "Tata Motors"], ["TATASTEEL", "Tata Steel"], ["SUNPHARMA", "Sun Pharmaceutical Industries"],
  ["TITAN", "Titan Company"], ["ULTRACEMCO", "UltraTech Cement"], ["NESTLEIND", "Nestle India"], ["WIPRO", "Wipro"], ["HCLTECH", "HCL Technologies"], ["TECHM", "Tech Mahindra"], ["POWERGRID", "Power Grid Corporation of India"], ["NTPC", "NTPC"], ["ONGC", "Oil and Natural Gas Corporation"], ["IOC", "Indian Oil Corporation"],
  ["BPCL", "Bharat Petroleum Corporation"], ["HINDPETRO", "Hindustan Petroleum Corporation"], ["GAIL", "GAIL (India)"], ["OIL", "Oil India"], ["COALINDIA", "Coal India"], ["ADANIENT", "Adani Enterprises"], ["ADANIPORTS", "Adani Ports and Special Economic Zone"], ["ADANIGREEN", "Adani Green Energy"], ["ADANIPOWER", "Adani Power"], ["JSWSTEEL", "JSW Steel"],
  ["HINDALCO", "Hindalco Industries"], ["VEDL", "Vedanta"], ["NMDC", "NMDC"], ["SAIL", "Steel Authority of India"], ["GRASIM", "Grasim Industries"], ["SHREECEM", "Shree Cement"], ["AMBUJACEM", "Ambuja Cements"], ["ACC", "ACC"], ["DALBHARAT", "Dalmia Bharat"], ["CIPLA", "Cipla"],
  ["DRREDDY", "Dr. Reddy's Laboratories"], ["DIVISLAB", "Divi's Laboratories"], ["LUPIN", "Lupin"], ["AUROPHARMA", "Aurobindo Pharma"], ["TORNTPHARM", "Torrent Pharmaceuticals"], ["ZYDUSLIFE", "Zydus Lifesciences"], ["APOLLOHOSP", "Apollo Hospitals Enterprise"], ["MAXHEALTH", "Max Healthcare Institute"], ["BRITANNIA", "Britannia Industries"], ["DABUR", "Dabur India"],
  ["MARICO", "Marico"], ["GODREJCP", "Godrej Consumer Products"], ["COLPAL", "Colgate-Palmolive (India)"], ["TATACONSUM", "Tata Consumer Products"], ["VBL", "Varun Beverages"], ["PIDILITIND", "Pidilite Industries"], ["BERGEPAINT", "Berger Paints India"], ["HAVELLS", "Havells India"], ["POLYCAB", "Polycab India"], ["SIEMENS", "Siemens"],
  ["ABB", "ABB India"], ["BEL", "Bharat Electronics"], ["HAL", "Hindustan Aeronautics"], ["BHEL", "Bharat Heavy Electricals"], ["CUMMINSIND", "Cummins India"], ["EICHERMOT", "Eicher Motors"], ["HEROMOTOCO", "Hero MotoCorp"], ["BAJAJ-AUTO", "Bajaj Auto"], ["TVSMOTOR", "TVS Motor Company"], ["ASHOKLEY", "Ashok Leyland"],
  ["BOSCHLTD", "Bosch"], ["MOTHERSON", "Samvardhana Motherson International"], ["BHARATFORG", "Bharat Forge"], ["MRF", "MRF"], ["APOLLOTYRE", "Apollo Tyres"], ["INDUSINDBK", "IndusInd Bank"], ["BANKBARODA", "Bank of Baroda"], ["PNB", "Punjab National Bank"], ["CANBK", "Canara Bank"], ["UNIONBANK", "Union Bank of India"],
  ["IDFCFIRSTB", "IDFC First Bank"], ["FEDERALBNK", "The Federal Bank"], ["AUBANK", "AU Small Finance Bank"], ["BANDHANBNK", "Bandhan Bank"], ["YESBANK", "Yes Bank"], ["SBILIFE", "SBI Life Insurance Company"], ["HDFCLIFE", "HDFC Life Insurance Company"], ["ICICIPRULI", "ICICI Prudential Life Insurance"], ["ICICIGI", "ICICI Lombard General Insurance"], ["LICI", "Life Insurance Corporation of India"],
  ["SBICARD", "SBI Cards and Payment Services"], ["CHOLAFIN", "Cholamandalam Investment and Finance"], ["SHRIRAMFIN", "Shriram Finance"], ["MUTHOOTFIN", "Muthoot Finance"], ["PFC", "Power Finance Corporation"], ["RECLTD", "REC"], ["IRFC", "Indian Railway Finance Corporation"], ["LICHSGFIN", "LIC Housing Finance"], ["HDFCAMC", "HDFC Asset Management Company"], ["BSE", "BSE"],
  ["MCX", "Multi Commodity Exchange of India"], ["CDSL", "Central Depository Services (India)"], ["ANGELONE", "Angel One"], ["NAUKRI", "Info Edge (India)"], ["ETERNAL", "Eternal (Zomato)"], ["NYKAA", "FSN E-Commerce Ventures (Nykaa)"], ["PAYTM", "One 97 Communications (Paytm)"], ["POLICYBZR", "PB Fintech"], ["DMART", "Avenue Supermarts"],
  ["TRENT", "Trent"], ["JUBLFOOD", "Jubilant FoodWorks"], ["INDHOTEL", "The Indian Hotels Company"], ["IRCTC", "Indian Railway Catering and Tourism Corporation"], ["INDIGO", "InterGlobe Aviation"], ["DLF", "DLF"], ["GODREJPROP", "Godrej Properties"], ["OBEROIRLTY", "Oberoi Realty"], ["LODHA", "Macrotech Developers (Lodha)"], ["PRESTIGE", "Prestige Estates Projects"],
  ["TATAPOWER", "Tata Power Company"], ["ADANIENSOL", "Adani Energy Solutions"], ["JSWENERGY", "JSW Energy"], ["NHPC", "NHPC"], ["SJVN", "SJVN"], ["TORNTPOWER", "Torrent Power"], ["PETRONET", "Petronet LNG"], ["IGL", "Indraprastha Gas"], ["MGL", "Mahanagar Gas"], ["GUJGASLTD", "Gujarat Gas"],
  ["CONCOR", "Container Corporation of India"], ["RVNL", "Rail Vikas Nigam"], ["IRCON", "IRCON International"], ["MAZDOCK", "Mazagon Dock Shipbuilders"], ["COCHINSHIP", "Cochin Shipyard"], ["BDL", "Bharat Dynamics"], ["SOLARINDS", "Solar Industries India"], ["PERSISTENT", "Persistent Systems"], ["LTIM", "LTIMindtree"], ["MPHASIS", "Mphasis"],
  ["COFORGE", "Coforge"], ["OFSS", "Oracle Financial Services Software"], ["KPITTECH", "KPIT Technologies"], ["TATAELXSI", "Tata Elxsi"], ["DIXON", "Dixon Technologies (India)"], ["TATACOMM", "Tata Communications"], ["IDEA", "Vodafone Idea"], ["INDUSTOWER", "Indus Towers"], ["UPL", "UPL"], ["PIIND", "PI Industries"],
  ["SRF", "SRF"], ["DEEPAKNTR", "Deepak Nitrite"], ["NAVINFLUOR", "Navin Fluorine International"], ["TATACHEM", "Tata Chemicals"], ["CHAMBLFERT", "Chambal Fertilisers and Chemicals"], ["COROMANDEL", "Coromandel International"], ["ASTRAL", "Astral"], ["SUPREMEIND", "Supreme Industries"], ["KEI", "KEI Industries"], ["VOLTAS", "Voltas"],
  ["BLUESTARCO", "Blue Star"], ["CROMPTON", "Crompton Greaves Consumer Electricals"], ["PAGEIND", "Page Industries"], ["UNITDSPR", "United Spirits"], ["UBL", "United Breweries"], ["RADICO", "Radico Khaitan"], ["ABFRL", "Aditya Birla Fashion and Retail"], ["ICICISEC", "ICICI Securities"], ["NUVAMA", "Nuvama Wealth Management"], ["WAAREEENER", "Waaree Energies"],
  ["NIFTYBEES", "Nippon India ETF Nifty 50 BeES"], ["JUNIORBEES", "Nippon India ETF Nifty Next 50 Junior BeES"], ["BANKBEES", "Nippon India ETF Nifty Bank BeES"], ["GOLDBEES", "Nippon India ETF Gold BeES"], ["SILVERBEES", "Nippon India Silver ETF"],
  ["CARTRADE", "CarTrade Tech"], ["TIPSMUSIC", "Tips Music"], ["KAYNES", "Kaynes Technology India"], ["JIOFIN", "Jio Financial Services"], ["CAMS", "Computer Age Management Services"]
].map(([symbol, name]) => ({ symbol, name, exchange: "NSE" }));

const splitCsv = line => { const out = []; let cur = "", q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
// Zerodha instruments CSV: instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange
export function parseKiteInstruments(csv) {
  const lines = String(csv || "").split(/\r?\n/), head = splitCsv(lines.shift() || "").map(h => h.toLowerCase()), ix = k => head.indexOf(k), out = [];
  if (ix("tradingsymbol") < 0) return out;
  for (const l of lines) {
    if (!l) continue; const c = splitCsv(l);
    if (c[ix("instrument_type")] !== "EQ" || !/^(NSE|BSE)$/.test(c[ix("segment")] || "")) continue;
    const symbol = String(c[ix("tradingsymbol")] || "").toUpperCase(), name = c[ix("name")] || "";
    if (!/^[A-Z0-9&-]{1,20}$/.test(symbol) || !name || /-(SG|GS|GB|N\d|TB)$/.test(symbol)) continue; // skip G-secs, SGBs, T-bills
    const token = Number(c[ix("instrument_token")]);
    out.push({ symbol, name: titleCase(name), exchange: c[ix("segment")], ...(token > 0 ? { token } : {}) }); // token: for Kite price history
  }
  return out;
}
// NSE EQUITY_L.csv: SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,PAID UP VALUE,MARKET LOT,ISIN NUMBER,FACE VALUE
export function parseNseEquityList(csv) {
  const lines = String(csv || "").split(/\r?\n/), head = splitCsv(lines.shift() || "").map(h => h.toUpperCase()), out = [];
  const iS = head.indexOf("SYMBOL"), iN = head.indexOf("NAME OF COMPANY"), iI = head.findIndex(h => h.startsWith("ISIN"));
  if (iS < 0 || iN < 0) return out;
  for (const l of lines) { if (!l) continue; const c = splitCsv(l); const symbol = String(c[iS] || "").toUpperCase(); if (/^[A-Z0-9&-]{1,20}$/.test(symbol) && c[iN]) out.push({ symbol, name: c[iN].replace(/\s+/g, " "), exchange: "NSE", isin: c[iI] || null }); }
  return out;
}
const titleCase = s => (/[a-z]/.test(s) ? s : s.toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase()).replace(/\b(Ltd|Limited)\b/g, "Ltd"));

// Merge lists: NSE wins over BSE for the same company name; seed fills gaps.
export function mergeMaster(...lists) {
  const bySym = new Map(), nseNames = new Set();
  const key = n => String(n).toLowerCase().replace(/\b(ltd|limited|the|india|co)\b|[^a-z0-9]/g, "");
  for (const l of lists) for (const x of l || []) if (x.exchange === "NSE" && !bySym.has(`NSE:${x.symbol}`)) { bySym.set(`NSE:${x.symbol}`, x); nseNames.add(key(x.name)); }
  for (const l of lists) for (const x of l || []) if (x.exchange === "BSE" && !nseNames.has(key(x.name)) && !bySym.has(`BSE:${x.symbol}`)) bySym.set(`BSE:${x.symbol}`, x);
  return [...bySym.values()];
}

const words = s => String(s || "").toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
export function searchMaster(master, q, limit = 8) {
  q = String(q || "").trim(); if (!q) return [];
  const ql = q.toLowerCase(), qu = q.toUpperCase(), qc = qu.replace(/[^A-Z0-9&]/g, ""), qw = words(q), out = [];
  for (const x of master) {
    const name = x.name.toLowerCase(); let s = 0;
    if (x.symbol === qu || (qc.length >= 3 && x.symbol === qc)) s = 100; else if (x.symbol.startsWith(qu) || (qc.length >= 4 && x.symbol.startsWith(qc))) s = 85 - x.symbol.length / 10;
    else if (name.startsWith(ql)) s = 75; else if (qw.length && qw.every(w => words(x.name).some(n => n.startsWith(w)))) s = 65; else if (name.includes(ql)) s = 50;
    if (s) out.push([s + (x.exchange === "NSE" ? 1 : 0), x]);
  }
  return out.sort((a, b) => b[0] - a[0] || a[1].name.length - b[1].name.length).slice(0, limit).map(v => v[1]);
}
