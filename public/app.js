const seed = [
 ["M&M","M&M","Core","Buy gradually","Fair to slightly rich",null,null,null,"SUV, tractor and finance KPIs","Autos and farm demand; watch margins and credit cycle."],
 ["Polycab India","POLYCAB","Core","Buy gradually","Fair to rich",null,null,null,"Distribution, cable volumes and EBITDA per tonne","Cables/wires market-share opportunity."],
 ["PB Fintech","POLICYBZR","Core","Buy gradually","Fair to rich",null,null,null,"Insurance premiums, renewal rate and contribution margin","Insurance/credit distribution runway; CAC and regulation matter."],
 ["Varun Beverages","VBL","Core","Buy gradually","Fair after correction",421.8,381,555.6,"PepsiCo volume, international mix and margins","Consumer franchise; seasonal/weather risk."],
 ["HDFC AMC","HDFCAMC","Core","Buy gradually","Fair to rich",2425,null,null,"AUM flows, equity mix and market share","Financialisation; market sensitivity."],
 ["CRISIL","CRISIL","Core","Buy gradually","Fair to rich",4561,null,null,"Ratings, research and index-data revenue","Asset-light ratings/data moat."],
 ["Uno Minda","UNOMINDA","Core","Buy on dips","Rich",null,null,null,"Programme wins and content per vehicle","Electronics, safety and EV content."],
 ["KEI Industries","KEI","Core","Buy on dips","Fair to rich",null,null,null,"Distribution and B2B mix","Cables cycle and distribution expansion."],
 ["Motherson","MOTHERSON","Core","Buy gradually","Fair",null,null,null,"Aerospace order book and auto margins","Global diversification; acquisition integration risk."],
 ["APL Apollo Tubes","APLAPOLLO","Core","Buy gradually","Fair",null,null,null,"Volume, mix and EBITDA per tonne","Branded structural steel tubes."],
 ["CarTrade Tech","CARTRADE","Core","Buy gradually","Fair",null,null,null,"Dealer subscriptions, leads and cash generation","Asset-light auto marketplace."],
 ["Poonawalla Fincorp","POONAWALLA","Core","Buy gradually","Fair",232.35,null,null,"AUM, GNPA/NNPA, credit cost and ROA","Retail-lending growth; asset quality risk."],
 ["Kaynes Technology","KAYNES","Growth","Buy on correction","Rich",3515,null,null,"Order book ~₹7,401cr in Q1 FY26; OSAT visibility","EMS/OSAT growth; working capital and capex risk."],
 ["BSE","BSE","Growth","Buy on correction","Rich",null,null,null,"Derivatives market share and transaction volumes","Financialisation leader; volume-cycle sensitivity."],
 ["GE Vernova T&D India","GVT&D","Growth","Buy on correction","Rich",null,null,null,"Order backlog; grid project conversion","Transmission capex; high expectations embedded."],
 ["Syrma SGS Technology","SYRMA","Growth","Small accumulation","Fair to rich",null,null,null,"Order book cited ~₹6,600cr; customer diversification","EMS growth; execution-sensitive."],
 ["Eternal","ETERNAL","Growth","Buy on correction","Rich",null,null,null,"Food-delivery GOV, Blinkit margin and cash burn","Quick-commerce upside; competition risk."],
 ["Sona BLW Precision Forgings","SONACOMS","Growth","Buy on dips","Rich",null,null,null,"Programme wins and EV content","EV driveline opportunity; premium valuation."],
 ["Sudeep Pharma","SUDEEPPHRM","Growth","Small buy only","Rich",null,null,null,"Q1 FY27: ₹158cr revenue, ₹40.6cr PAT","High-margin ingredients; short listed history."],
 ["Shilpa Medicare","SHILPAMED","Growth","Small buy only","Rich",1021.1,null,null,"Product launches, filings and capacity ramp","Earnings turnaround; regulatory/capex risk."],
 ["CDSL","CDSL","Growth","Wait for correction","Rich",1360,null,null,"Demat additions, transaction income and issuer services","Depository moat; valuation risk."],
 ["MCX","MCX","Growth","Wait for correction","Rich",null,null,null,"Commodity volumes, options activity and costs","Exchange moat; volume/regulatory risk."],
 ["Dixon Technologies","DIXON","Growth","Wait for correction","Rich",null,null,null,"Customer programmes and PLI capacity","EMS leader; premium valuation."],
 ["Ather Energy","ATHERENERG","Growth","Wait for correction","Rich",null,null,null,"Deliveries, share, gross margin and EBITDA","EV brand; competition and profitability risk."],
 ["Groww","GROWW","Growth","Wait for correction","Rich",null,null,null,"23.2m transacting users; ₹3.76tn customer assets","Platform scale; derivatives/regulation sensitivity."],
 ["Pine Labs","PINELABS","Growth","Wait for correction","Rich",null,null,null,"Merchant GMV, margin and adjusted EBITDA","Payments platform; profitability proof needed."],
 ["Shadowfax","SHADOWFAX","Growth","Wait for correction","Rich / unproven",null,null,null,"Q1 FY27: ₹1,358cr revenue, 24.7cr orders","Fast logistics growth; thin-margin competition."],
 ["Swiggy","SWIGGY","Growth","Avoid","Rich / loss-making",null,null,null,"Food delivery contribution, Instamart and cash burn","Growth but less-proven profitability."],
 ["Netweb Technologies","NETWEB","Growth","Wait for correction","Very rich",null,null,null,"Order inflow and systems pipeline","AI/HPC opportunity; valuation/customer risk."],
 ["HBL Engineering","HBLENGINE","Growth","Buy on dips","Fair to rich",null,null,null,"Order book ₹3,641cr as at 13 Aug 2026","Railway electronics/defence; conversion timing."],
 ["Sterlite Technologies","STLTECH","Turnaround","Small turnaround position","Fair to rich",null,null,null,"Q1 FY27 order book ₹18,618cr; record quarter","Data-centre mix shift; needs more proof."],
 ["HFCL","HFCL","Turnaround","Small turnaround position","Fair to rich",null,null,null,"Order intake and fibre/defence execution","Telecom/fibre/defence opportunity; margin risk."],
 ["Avalon Technologies","AVALON","Turnaround","Small turnaround position","Fair to rich",null,null,null,"Order book and customer concentration","EMS opportunity; lower conviction."],
 ["RR Kabel","RRKABEL","Turnaround","Buy on dips","Fair to rich",null,null,null,"Distribution and B2B project mix","Cables demand; competitive market."],
 ["Azad Engineering","AZAD","Speculative","Buy on correction","Rich",2784.7,1358.7,2986.4,"Aerospace/energy programme wins","Aerospace potential; high valuation and delivery risk."],
 ["Acutaas Chemicals","ACUTAAS","Speculative","Buy on correction","Rich",3451.4,1290,3740,"Pharma intermediates, battery and semiconductor chemicals","Speciality chemicals optionality; premium valuation."],
 ["Yatharth Hospital","YATHARTH","Speculative","Buy on dips","Fair to rich",null,null,null,"Occupancy, ARPOB and new-bed ramp","Hospital expansion; utilisation risk."],
 ["Tips Music","TIPSMUSIC","Speculative","Buy gradually","Fair to rich",null,null,null,"Catalogue monetisation and digital royalties","IP economics; lumpy release cycle."],
 ["Sky Gold","SKYGOLD","Speculative","Avoid","Rich / working-capital heavy",null,null,null,"Operating cash flow and receivable/inventory days","Jewellery growth; thin margins/cash conversion risk."],
 ["Senores Pharma","SENORES","Speculative","Avoid","Hard to assess",null,null,null,"Quarterly results and disclosure history","Wait for a longer listed record."],
 ["MTAR Technologies","MTARTECH","Speculative","Avoid","Uncertain",null,null,null,"Order conversion and profitability","Execution consistency is the gating factor."],
 ["MosChip Technologies","MOSCHIP","Speculative","Avoid","Very rich / speculative",null,null,null,"Design wins, services revenue and profitability","Theme needs earnings proof."],
 ["Hindustan Copper","HINDCOPPER","Speculative","Avoid","Commodity-priced",497.65,null,null,"Copper prices, production and policy","Commodity cycle, not core compounding."],
];
const portfolios={
 "Zerodha - Nishanth":["Tata Capital","MCX","BSE","NSE","CDSL","CAMS","HDFC AMC","Chola Finance","Shriram Finance","Nuvama","VBL","M&M","TVS Motor","Laurus Lab","Divis Lab","Avalon","Syrma","Dixon","Moschip","Kaynes","KEI","Polycab","RR Kabel","Sansera Engg","Coforge","Persistent System","Kalyan Jeweller","Waree Energies","Yatharth Hospital","Tips Music","Motherson","Sona BLW","LalPath Labs","Can Fin Homes","Homefirst Finance","CRISIL","Uno Minda","Hindustan Copper"],
 "Zerodha - Sophia":["ICICI Bank","Airtel","Hero Motocorp","Titan","HAL","Max Healthcare","Bajaj Finance","HUL","INFY","TCS","HDFC Bank","Coal India","Gulf Oil Lubricant","IGL","REC","HCL Tech","Asian Paints","ITC","ONFC","PowerGrid","Reliance","SBIN","Pidilite","Bajaj Auto","COLPAL","Maruthi","Hindalco"],
 "INDmoney - Demat":["Groww","Pine Labs","Ather Energy","PB Fintech","Swiggy","Eternal","APL Apollo","Shadowfax","PhysicsWallah","Meesho"],
 "Angel One - Demat":["Sky Gold","Shilpa Medicare","Sudeep Pharma","PC Jeweller","BLS International","Jio Finance","Aeroflex","HFCL","E2E","Natco Pharma","Vintage Coffee","BlackBuck","RP Tech","PNGJL","Senco","Delhivery","Apollo"]
};
const normalise=s=>s.toLowerCase().replace(/[^a-z0-9]/g,"").replace("engg","engineering").replace("aplappollo","aplapollo").replace("atherengergy","atherenergy");
const aliases={"vbl":"varunbeverages","mm":"mm","syrma":"syrmasgstechnology","moschip":"moschiptechnologies","kaynes":"kaynes technology","rrkabel":"rr kabel","sanseraengg":"sansera engineering","lauruslab":"laurus labs","divislab":"divis lab","hcltech":"hcl tech","colpal":"colpal","maruthi":"maruthi","onfc":"gnfc","gnfc":"gnfc","powergrid":"powergrid","sbin":"sbin","ig l":"igl","aplapollo":"aplapollo","atherenergy":"atherenergy","sonablw":"sonablwprecisionforgings"};
const marketSymbols={tatacapital:"TATACAP",cams:"CAMS",cholafinance:"CHOLAFIN",shriramfinance:"SHRIRAMFIN",nuvama:"NUVAMA",tvsmotor:"TVSMOTOR",lauruslab:"LAURUSLABS",divislab:"DIVISLAB",coforge:"COFORGE",persistentsystem:"PERSISTENT",kalyanjeweller:"KALYANKJIL",wareeenergies:"WAAREEENER",lalpathlabs:"LALPATHLAB",canfinhomes:"CANFINHOME",homefirstfinance:"HOMEFIRST",icicibank:"ICICIBANK",airtel:"BHARTIARTL",heromotocorp:"HEROMOTOCO",titan:"TITAN",hal:"HAL",maxhealthcare:"MAXHEALTH",bajajfinance:"BAJFINANCE",hul:"HINDUNILVR",infy:"INFY",tcs:"TCS",hdfcbank:"HDFCBANK",coalindia:"COALINDIA",gulfoillubricant:"GULFOILLUB",igl:"IGL",rec:"RECLTD",hcltech:"HCLTECH",asianpaints:"ASIANPAINT",itc:"ITC",powergrid:"POWERGRID",reliance:"RELIANCE",sbin:"SBIN",pidilite:"PIDILITIND",bajajauto:"BAJAJ-AUTO",colpal:"COLPAL",hindalco:"HINDALCO",meesho:"MEESHO",pcjeweller:"PCJEWELLER",blsinternational:"BLS",jiofinance:"JIOFIN",aeroflex:"AEROFLEX",e2e:"E2E",natcopharma:"NATCOPHARM",senco:"SENCO",delhivery:"DELHIVERY",sanseraengg:"SANSERA",sansera:"SANSERA",sonablw:"SONACOMS",maruthi:"MARUTI",maruti:"MARUTI",onfc:"GNFC",gnfc:"GNFC",ongc:"ONGC",physicswallah:"PWL",vintagecoffee:"VINCOFE",vintage:"VINCOFE",blackbuck:"BLACKBUCK",rptech:"RPTECH",pngjl:"PNGJL",apollo:"APOLLO"};
const key="equity-tracker-v2";

// Builds the default watchlist (curated research + auto-imported holdings) from
// scratch, with no side effects on shared state. Used only as a fallback when the
// server has no published watchlist yet, or is unreachable and there's no local cache.
function buildDefaultStocks(){
  const list=seed.map((r,i)=>({id:i+1,company:r[0],ticker:r[1],marketSymbol:r[1],bucket:r[2],action:r[3],valuation:r[4],price:r[5],low:r[6],high:r[7],kpi:r[8],note:r[9],updated:r[5]?"18 Sep 2026":"Needs refresh",accounts:[]}));
  for(const [account,names] of Object.entries(portfolios)){
    for(const original of names){
      const n=normalise(original);
      let stock=list.find(s=>normalise(s.company)===n||normalise(s.ticker)===n||normalise(s.company)===normalise(aliases[n]||""));
      if(!stock){
        const sym=marketSymbols[n]||null;
        stock={id:list.length+1,company:original,ticker:sym||original,marketSymbol:sym,bucket:"Growth",action:"Buy on dips",valuation:"Fair",price:null,low:null,high:null,kpi:"Core business KPIs and operating metrics.",note:"Auto-imported holding from "+account+".",updated:"Needs refresh",accounts:[]};
        list.push(stock);
      }
      stock.accounts??=[];
      if(!stock.accounts.includes(account))stock.accounts.push(account);
    }
  }
  for(const stock of list){
    const n=normalise(stock.company);
    stock.marketSymbol=marketSymbols[n]||stock.marketSymbol||(stock.ticker!=="Confirm ticker"?stock.ticker:null);
    if(stock.ticker==="Confirm ticker"&&stock.marketSymbol)stock.ticker=stock.marketSymbol;
    if(stock.action==="Research needed"||stock.action==="Watch"){stock.action="Buy on dips";stock.valuation="Fair";}
  }
  return list;
}

let stocks=[];
let history={changes:[],priceSeries:{}};
let selected=null;
let currentCategory="Core";
let currentPage=1;
const pageSize=10;
const downturnFocusRanks=new Map(["CRISIL","VBL","POLYCAB","M&M","HDFCAMC","MOTHERSON","KEI","APLAPOLLO","CARTRADE","POONAWALLA"].map((ticker,index)=>[ticker,index+1]));
const top10Ranks={
  Downturn:downturnFocusRanks,
  ValueQuality:new Map(["CRISIL","HDFCBANK","ICICIBANK","HDFCAMC","POWERGRID","M&M","VBL","POLYCAB","MOTHERSON","TCS"].map((ticker,index)=>[ticker,index+1])),
  Momentum:new Map(["BSE","MCX","COFORGE","PERSISTENT","KAYNES","POLYCAB","HAL","DIXON","M&M","VBL"].map((ticker,index)=>[ticker,index+1])),
  GrowthTop10:new Map(["POLICYBZR","KAYNES","BSE","GVT&D","SYRMA","ETERNAL","ATHERENERG","CDSL","MCX","DIXON"].map((ticker,index)=>[ticker,index+1])),
  NewAge:new Map(["POLICYBZR","ETERNAL","GROWW","SWIGGY","ATHERENERG","PINELABS","SHADOWFAX","MEESHO","NETWEB","KAYNES"].map((ticker,index)=>[ticker,index+1]))
};
// Best 30 for a 10+ year accumulation (shortlist chosen 4 Oct 2026 from this watchlist: durable business, returns, runway; excludes loss-making, theme-driven and governance-flag names). Not a recommendation.
const best30=[["HDFCBANK","Core"],["ICICIBANK","Core"],["BAJFINANCE","Core"],["CHOLAFIN","Core"],["HDFCAMC","Core"],["CRISIL","Core"],["TITAN","Core"],["PIDILITIND","Core"],["VBL","Core"],["M&M","Core"],["BHARTIARTL","Core"],["TCS","Core"],["POLYCAB","Quality growth"],["KEI","Quality growth"],["HAL","Quality growth"],["DIXON","Quality growth"],["APLAPOLLO","Quality growth"],["UNOMINDA","Quality growth"],["TVSMOTOR","Quality growth"],["PERSISTENT","Quality growth"],["COFORGE","Quality growth"],["DIVISLAB","Quality growth"],["MAXHEALTH","Quality growth"],["POLICYBZR","Quality growth"],["BLS","Small-cap"],["NATCOPHARM","Small-cap"],["GRAVITA","Small-cap"],["ANANDRATHI","Small-cap"],["SHAILY","Small-cap"],["SAFARI","Small-cap"]];
top10Ranks.Top30=new Map(best30.map(([t],i)=>[t,i+1]));
const best30Tier=new Map(best30);
const categoryNotes={
  Top30:"Best 30 for a 10+ year accumulation: 12 core compounders, 12 quality-growth names, 6 small-cap compounders (ranked within that order, not by expected return). Buy in tranches, check the Valuation tab first, and skip any marked Rich or Very rich until they correct. Not financial advice; no return is guaranteed.",
  Downturn:"Curated downturn watchlist from this portfolio; not a promise of downside protection. Check current fundamentals, valuation and price data before acting.",
  ValueQuality:"Curated value/quality candidates, not a live valuation screen. Verify audited cash flows, balance sheets and current valuation before investing.",
  Momentum:"Curated momentum candidates, not a live technical ranking. Confirm current relative strength, volume and trend on the chart before acting.",
  GrowthTop10:"Curated growth candidates from this watchlist. Growth rates, execution, dilution and valuation still need current verification.",
  NewAge:"New-age, higher-risk research candidates. These are not predicted multibaggers; verify profitability, cash burn, dilution and valuation.",
  Core:"Core watchlist research candidates. Verify current results, valuation and risk before acting.",
  Satellite:"Satellite watchlist research candidates; position sizing and company-specific risk matter.",
  Avoid:"Avoid-rated names from the current research snapshot; revisit when evidence changes.",
  All:"Curated top-10 tabs are research watchlists, not live factor scores or investment recommendations."
};

const $=s=>document.querySelector(s); const money=v=>Number.isFinite(v)?`₹${v.toLocaleString("en-IN",{maximumFractionDigits:2})}`:"—";
const multiplier=s=>s.action.includes("gradually")?[.91,.95,.82,.86]:s.action.includes("dips")?[.86,.91,.77,.82]:s.action.includes("correction")?[.82,.88,.70,.77]:s.action.includes("Small")?[.80,.87,.68,.75]:[.75,.83,.62,.70];
const zone=(s,deep=false)=>{if(!Number.isFinite(s.price))return"Add close";const m=multiplier(s);return `${money(s.price*(deep?m[2]:m[0]))}–${money(s.price*(deep?m[3]:m[1]))}`};
function save(){localStorage.setItem(key,JSON.stringify(stocks))}
function publishWatchlist(){return fetch("/api/watchlist",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stocks})}).catch(()=>{})}
function actionTone(action){return action.includes("Avoid")?"avoid":(action.includes("Buy")||action.includes("accumulation"))?"buy":"wait"}
function actionClass(s){return actionTone(s.action)}

const isAvoid=s=>s.action==="Avoid";
const isCore=s=>!isAvoid(s)&&(s.bucket==="Core"||s.style==="Core");
const isSatellite=s=>!isAvoid(s)&&!isCore(s);
const downturnRank=s=>downturnFocusRanks.get(s.marketSymbol)||downturnFocusRanks.get(s.ticker)||null;
const categoryRank=(s,cat)=>{const ranks=top10Ranks[cat];const symbol=s.marketSymbol||s.ticker;return ranks?.get(symbol)||ranks?.get(symbol?.toUpperCase())||null};
function matchesCategory(s,cat){
  if(cat==="Core")return isCore(s);
  if(top10Ranks[cat])return categoryRank(s,cat)!==null;
  if(cat==="Satellite")return isSatellite(s);
  if(cat==="Avoid")return isAvoid(s);
  return true;
}

// --- Loading: server is the source of truth. We only fall back to a local cache or
// the built-in defaults when the server is unreachable, and we only *republish* over
// the server when it's confirmed empty (first run). Previously this app republished
// on every page load regardless of server state, which meant opening the app in a
// fresh browser/device could silently overwrite the server's live watchlist.json
// with stale local defaults. That's fixed below.
let stocksReq=null;// callers at the same moment share one request
async function loadStocks(){if(stocksReq)return stocksReq;stocksReq=loadStocksOnce().finally(()=>{stocksReq=null});return stocksReq}
async function loadStocksOnce(){
  let serverStocks=null;
  try{const r=await fetch("/api/stocks");if(r.ok){const x=await r.json();serverStocks=Array.isArray(x.stocks)?x.stocks:[]}}catch{}
  if(serverStocks&&serverStocks.length){stocks=serverStocks;save();return}
  // Only the owner's account starts from the built-in curated list; every other account starts empty and builds its own.
  const me=await (window.meReady||Promise.resolve({seedDefault:false}));
  if(serverStocks&&serverStocks.length===0){if(me.seedDefault){stocks=buildDefaultStocks();save();await publishWatchlist()}else{stocks=[];save()}return}
  stocks=JSON.parse(localStorage.getItem(key)||"null")||(me.seedDefault?buildDefaultStocks():[]);
}
async function loadHistory(){try{const r=await fetch("/api/history");if(r.ok)history=await r.json()}catch{}}

function renderPagination(totalCount,totalPages){
  const el=$("#pagination");
  if(!el)return;
  if(!totalCount){
    el.innerHTML=`<div class="pagination-info">No matching stocks</div><div class="pagination-controls"></div>`;
    return;
  }
  const start=(currentPage-1)*pageSize+1;
  const end=Math.min(currentPage*pageSize,totalCount);
  let btns=`<button class="page-btn nav-btn" ${currentPage===1?"disabled":""} data-page="${currentPage-1}">‹ Prev</button>`;
  for(let p=1;p<=totalPages;p++){
    if(totalPages<=7||p===1||p===totalPages||(p>=currentPage-1&&p<=currentPage+1)){
      btns+=`<button class="page-btn ${p===currentPage?"active":""}" data-page="${p}">${p}</button>`;
    }else if(p===currentPage-2||p===currentPage+2){
      btns+=`<span class="page-ellipsis">…</span>`;
    }
  }
  btns+=`<button class="page-btn nav-btn" ${currentPage===totalPages?"disabled":""} data-page="${currentPage+1}">Next ›</button>`;
  el.innerHTML=`<div class="pagination-info">Showing ${start}–${end} of ${totalCount} stocks</div><div class="pagination-controls">${btns}</div>`;
  el.querySelectorAll("button[data-page]").forEach(b=>b.onclick=()=>{currentPage=Number(b.dataset.page);render();});
}

// P/E column on the watchlist: from the valuation engine (re-scaled to the latest price), with fair multiple and view colour.

// ---- visual helpers: chips, valuation gauge, 52-week bar ----
const viewCls=v=>v==="Undervalued"?"v-under":v==="Fair"?"v-fair":v==="Fair to rich"?"v-rich1":(v==="Rich"||v==="Very rich")?"v-rich":"v-none";
const viewChip=(v,extra="")=>`<span class="chip ${viewCls(v)}">${esc(v||"—")}</span>${extra}`;
const statusChip=st=>st?`<span class="chip ${st==="In zone"||st==="Below zone"?"s-in":st==="Above zone"?"s-above":st==="Wait (far above)"?"s-far":"v-none"}">${esc(st)}</span>`:"—";
const gaugeHtml=ratio=>Number.isFinite(ratio)?`<div class="gauge" role="img" aria-label="Price is ${ratio} times fair multiple"><i style="left:${Math.max(2,Math.min(98,ratio/2.5*100))}%"></i></div><div class="gauge-num">${ratio}× fair</div>`:"—";
const rangeBar=(low,high,price)=>Number.isFinite(low)&&Number.isFinite(high)&&high>low&&Number.isFinite(price)?`<div class="rbar" role="img" aria-label="Price sits at ${Math.round((price-low)/(high-low)*100)}% of its 52-week range"><i style="left:${Math.max(0,Math.min(100,(price-low)/(high-low)*100))}%"></i></div><div class="rbar-txt">${money(low)} – ${money(high)}</div>`:`<span class="range">${money(low)} – ${money(high)}</span>`;
const capTag=c=>c?`<span class="account-tag cap" style="margin-left:6px;font-size:11px" title="Approximate SEBI/AMFI market-cap class">${c==="Large"?"Largecap":c==="Mid"?"Midcap":"Smallcap"}</span>`:"";
const capOf=sym=>peBySymbol.get(String(sym||"").toUpperCase())?.cap||null;
let peBySymbol=new Map();
async function loadPe(){try{const r=await fetch("/api/valuation");if(!r.ok)return;const v=await r.json();peBySymbol=new Map((v.rows||[]).map(x=>[String(x.symbol).toUpperCase(),x]))}catch{}}
function peCell(s){const v=peBySymbol.get(String(s.marketSymbol||s.ticker||"").toUpperCase());if(!v||!Number.isFinite(v.pe))return `<span class="hint" title="No P/E yet: fetch fundamentals in the Valuation tab">—</span>`;const tone=/Under|Fair$/.test(v.view||"")?"buy":/Very rich|Rich/.test(v.view||"")?"avoid":"wait";return `<strong>${v.pe}</strong>${v.fairMultiple&&v.basis==="P/E"?` <small>(fair ${v.fairMultiple})</small>`:""}<div style="margin-top:4px">${viewChip(v.view)}</div>`}
function render_(){
 const search=$("#search").value.toLowerCase(), account=$("#account").value, bucket=$("#bucket").value, action=$("#action").value;

 if($("#countCore"))$("#countCore").textContent=stocks.filter(isCore).length;
 if($("#countDownturn"))$("#countDownturn").textContent=stocks.filter(s=>downturnRank(s)!==null).length;
 for(const [category,id] of [["Top30","countTop30"],["ValueQuality","countValueQuality"],["Momentum","countMomentum"],["GrowthTop10","countGrowthTop10"],["NewAge","countNewAge"]])if($("#"+id))$("#"+id).textContent=stocks.filter(s=>categoryRank(s,category)!==null).length;
 if($("#countSatellite"))$("#countSatellite").textContent=stocks.filter(isSatellite).length;
 if($("#countAvoid"))$("#countAvoid").textContent=stocks.filter(isAvoid).length;
 if($("#countAll"))$("#countAll").textContent=stocks.length;

 document.querySelectorAll(".category-tabs .viewTab").forEach(b=>b.classList.toggle("active",b.dataset.tab===currentCategory));

 const list=stocks.filter(s=>matchesCategory(s,currentCategory)&&(!search||`${s.company} ${s.ticker}`.toLowerCase().includes(search))&&(account==="All"||s.accounts?.includes(account))&&(bucket==="All"||s.bucket===bucket)&&(action==="All"||s.action===action));
 if(top10Ranks[currentCategory])list.sort((a,b)=>categoryRank(a,currentCategory)-categoryRank(b,currentCategory));
 if($("#focusNote"))$("#focusNote").textContent=categoryNotes[currentCategory]||categoryNotes.All;
 if(currentCategory==="Top30"){const missing=[...best30Tier.keys()].filter(sym=>!stocks.some(s=>(s.marketSymbol||s.ticker)===sym));if(missing.length)$("#focusNote").textContent+=` Not in your watchlist yet: ${missing.join(", ")} (add under Plan → Manage stocks).`}
 const totalPages=Math.ceil(list.length/pageSize)||1;
 if(currentPage>totalPages)currentPage=totalPages;
 if(currentPage<1)currentPage=1;

 const pageItems=list.slice((currentPage-1)*pageSize,currentPage*pageSize);

 $("#rows").innerHTML=pageItems.length?pageItems.map(s=>{const rank=categoryRank(s,currentCategory);return `<tr data-id="${s.id}" class="${selected?.id===s.id?"selected":""} ${downturnRank(s)?"downturn-focus":""} ${rank?`category-focus ${currentCategory.toLowerCase()}`:""}"><td><div class="company">${s.company}${capTag(capOf(s.marketSymbol||s.ticker))}</div><div class="ticker">${s.ticker}${rank?` <span class="rank-tag">#${rank} ${currentCategory==="Top30"?(best30Tier.get(s.marketSymbol||s.ticker)||"")+" tier":"rank"}</span>`:downturnRank(s)?` <span class="downturn-tag">#${downturnRank(s)} focus</span>`:""}</div></td><td><div class="accounts">${(s.accounts||[]).map(a=>`<span class="account-tag">${a.replace(" - Demat","").replace("Zerodha - ","")}</span>`).join("")}</div></td><td><span class="badge ${s.bucket.toLowerCase()}">${s.bucket}</span></td><td>${styleBadgeHtml(s.style)}</td><td class="${actionClass(s)}">${s.action}</td><td>${s.valuation}</td><td>${money(s.price)}</td><td>${peCell(s)}</td><td>${rangeBar(s.low,s.high,s.price)}</td><td class="range">${zone(s)}</td><td class="range">${zone(s,true)}</td><td class="kpi">${s.kpi}</td><td>${s.updated}</td></tr>`}).join("")
   :`<tr><td colspan="13" style="text-align:center;padding:24px;color:var(--muted)">No stocks match the selected tab and filters.</td></tr>`;

 $("#stockCount").textContent=stocks.length;$("#buyCount").textContent=stocks.filter(s=>s.action.includes("Buy")||s.action.includes("accumulation")).length;$("#zoneCount").textContent=stocks.filter(s=>Number.isFinite(s.price)).length;$("#refreshCount").textContent=stocks.filter(s=>s.updated==="Needs refresh").length;
 document.querySelectorAll("#rows tr[data-id]").forEach(r=>r.onclick=()=>{select(Number(r.dataset.id));openStockModal()});
 renderPagination(list.length,totalPages);
 renderDashboard();
 if(selected)renderMarketResearchLinks(selected);
 if(selected&&!$("#stockModal").hidden)renderModalValuation();
}

// --- Style tags and long-term-story verdicts (set by the advisor, reviewed by you).
function styleBadgeHtml(style){ return style ? `<span class="style-badge ${style.toLowerCase()}">${style}</span>` : `<span class="style-badge none">—</span>`; }
function verdictHtml(story){
  if(!story||!story.verdict) return `<span class="verdict none">—</span>`;
  const cls=story.verdict==="Intact"?"intact":story.verdict==="Weakening"?"weakening":story.verdict==="Broken"?"broken":"early";
  const title=(story.reasoning||"").replace(/"/g,"&quot;");
  return `<span class="verdict ${cls}" title="${title}">${story.verdict}</span>`;
}

// --- Sparkline: a tiny inline SVG trend line from a stock's daily price snapshots.
function sparklineSvg(points){
  if(!points||points.length<2)return"";
  const w=220,h=40,pad=4;
  const prices=points.map(p=>p.price);
  const min=Math.min(...prices),max=Math.max(...prices),span=(max-min)||1;
  const step=(w-2*pad)/(points.length-1);
  const path=points.map((p,i)=>`${pad+i*step},${h-pad-((p.price-min)/span)*(h-2*pad)}`).join(" ");
  const trend=points.at(-1).price>=points[0].price?"up":"down";
  return `<svg class="sparkline ${trend}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${path}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
}
function renderDetailHistory(){
  if(!selected)return;
  const changes=(history.changes||[]).filter(c=>c.id===selected.id).slice(-5).reverse();
  const series=(history.priceSeries||{})[selected.id]||[];
  const rows=changes.length?changes.map(c=>`<li>${new Date(c.at).toLocaleDateString("en-IN")} — ${c.field}: ${c.from??"—"} → ${c.to??"—"}</li>`).join(""):"<li>No tracked research changes yet.</li>";
  $("#detailHistory").innerHTML=`<h4>Recent changes</h4><ul>${rows}</ul>${series.length>1?`<div>Price trend (${series.length}d)</div>${sparklineSvg(series)}`:""}`;
}
// "Price refreshed (NSE, 13 Oct, 3:30 pm)" or "Refresh failed: … · price shown is from 13 Oct, 11:02 am (Yahoo Finance)"
function priceStatus(s){const t=s.priceAt?new Date(s.priceAt).toLocaleString("en-IN",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}):s.updated||"";const src=s.priceSource?String(s.priceSource).replace(/ \(.*\)$/,""):"";if(!s.feedStatus)return "Initial research";if(s.feedStatus==="Price refreshed")return `Price refreshed${src||t?` (${[src,t].filter(Boolean).join(", ")})`:""}`;return `${s.feedStatus}${t?` · price shown is from ${t}${src?` (${src})`:""}`:""}`}
function select(id){selected=stocks.find(s=>s.id===id);$("#detailTitle").textContent=`${selected.company} (${selected.ticker})`;$("#detailMeta").textContent=`${selected.bucket} • ${selected.action} • ${selected.valuation}${selected.style?` • Style: ${selected.style}`:""}${selected.longTermStory?.verdict?` • Long-term: ${selected.longTermStory.verdict}`:""} • ${priceStatus(selected)}`;$("#detailNote").textContent=`${selected.note}${selected.latestNews?` Latest news: ${selected.latestNews}`:""}`;$("#editBucket").value=selected.bucket||"Core";$("#editAction").value=selected.action||"Watch";$("#editValuation").value=selected.valuation||"";$("#price").value=selected.price??"";$("#low").value=selected.low??"";$("#high").value=selected.high??"";$("#kpi").value=selected.kpi;$("#note").value=selected.note;$("#advisorResult").innerHTML="";renderDetailHistory();render()}

function renderMarketResearchLinks(stock){
  let links=$("#marketLinks");
  if(!links){
    links=document.createElement("nav");
    links.id="marketLinks";
    links.className="market-links";
    links.setAttribute("aria-label","External market research");
    links.innerHTML='<a id="nseLink" target="_blank" rel="noopener noreferrer">NSE quote <span aria-hidden="true">↗</span></a><a id="screenerLink" target="_blank" rel="noopener noreferrer">Screener fundamentals <span aria-hidden="true">↗</span></a><a id="tradingViewLink" target="_blank" rel="noopener noreferrer">TradingView full chart <span aria-hidden="true">↗</span></a><a id="yahooLink" target="_blank" rel="noopener noreferrer">Yahoo Finance <span aria-hidden="true">↗</span></a><a id="newsLink" target="_blank" rel="noopener noreferrer">News <span aria-hidden="true">↗</span></a>';
    $("#modalLinksSlot").appendChild(links);
  }
  const symbol=String(stock.marketSymbol||stock.ticker||"").trim().toUpperCase();
  const validSymbol=/^[A-Z0-9&-]+$/.test(symbol)&&symbol!=="CONFIRM TICKER";
  links.hidden=!validSymbol;
  if(!validSymbol)return;
  $("#nseLink").href=`https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(symbol)}`;
  $("#screenerLink").href=`https://www.screener.in/company/${encodeURIComponent(symbol)}/`;
  const chartUrl=new URL("https://www.tradingview.com/chart/");
  chartUrl.searchParams.set("symbol",`NSE:${symbol}`);
  $("#tradingViewLink").href=chartUrl.href;
  $("#yahooLink").href=`https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}.NS`;
  $("#newsLink").href=`https://www.google.com/search?tbm=nws&q=${encodeURIComponent(`${stock.company} ${symbol} NSE`)}`;
}

// --- Stock popup: Overview (links, thesis, editor) and Valuation tabs.
function setModalTab(tab){
  $("#modalOverview").hidden=tab!=="overview";
  $("#modalValuation").hidden=tab!=="valuation";
  $("#mTabOverview").classList.toggle("active",tab==="overview");
  $("#mTabValuation").classList.toggle("active",tab==="valuation");
  if(tab==="valuation")renderModalValuation();
}
function openStockModal(){$("#stockModal").hidden=false;document.body.classList.add("modal-open");setModalTab("overview")}
function closeStockModal(){$("#stockModal").hidden=true;document.body.classList.remove("modal-open")}
$("#modalClose").onclick=closeStockModal;
$("#stockModal").onclick=e=>{if(e.target.id==="stockModal")closeStockModal()};
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#stockModal").hidden)closeStockModal()});
$("#mTabOverview").onclick=()=>setModalTab("overview");
$("#mTabValuation").onclick=()=>setModalTab("valuation");
for(const id of ["#valRows","#pkRows","#pkMineRows","#gpRows","#planRows"])$(id).addEventListener("click",e=>{
  if(e.target.closest("button,a,input,select,textarea"))return;
  const tr=e.target.closest("tr[data-id],tr[data-sym]");
  if(!tr)return;
  const s=tr.dataset.sym?stocks.find(x=>symOfStock(x)===tr.dataset.sym.toUpperCase()):stocks.find(x=>x.id===Number(tr.dataset.id));
  if(!s)return;
  select(s.id);openStockModal();
});
function renderModalValuation(){
  const box=$("#modalValuation");
  if(!selected||box.hidden)return;
  const r=peBySymbol.get(String(selected.marketSymbol||selected.ticker||"").toUpperCase());
  const refresh=`<div class="val-actions"><button type="button" id="mValRefresh" class="ghost">Fetch / refresh fundamentals</button><span id="mValStatus" class="hint"></span></div>`;
  const bind=()=>{const b=$("#mValRefresh");if(b)b.onclick=()=>fetchFundamentals([selected.id],true,{status:$("#mValStatus"),btn:b})};
  if(!r||r.view==="No fundamentals"){box.innerHTML=`<div><h3>Valuation</h3><p>No fundamentals fetched for this stock yet.</p>${refresh}</div>`;bind();return}
  const row=(k,v)=>`<div class="row"><span>${k}</span><strong>${v}</strong></div>`;
  const pct=v=>Number.isFinite(v)?`${fmt(v)}%`:"—";
  const fv=r.fairValue?`${money(r.fairValue.bear)} · ${money(r.fairValue.base)} · ${money(r.fairValue.bull)}`:"—";
  const upside=Number.isFinite(r.upsideToBase)?` <span class="${r.upsideToBase>=0?"buy":"avoid"}">(${r.upsideToBase>=0?"+":""}${Math.round(r.upsideToBase*100)}% to base)</span>`:"";
  const cash=Number.isFinite(r.cfoToProfit3)?`${fmt(r.cfoToProfit3,2)}× profit`:"—";
  box.innerHTML=`<div><h3>Verdict</h3><div class="row"><span>View</span>${viewChip(r.view,r.confidence==="low"?" <small>(low confidence)</small>":"")}</div>${gaugeHtml(r.ratio)}${row("Status vs buy zone",statusChip(r.status))}${row("Price",money(r.price))}<div class="row"><span>52W range</span><span>${rangeBar(r.low,r.high,r.price)}</span></div>${row("Fair value (bear · base · bull)",fv+upside)}${row("Buy zone",r.zoneLow?`${money(r.zoneLow)} – ${money(r.zoneHigh)}${r.floored?" ⚑":""}`:"—")}${row("Gap to zone",Number.isFinite(r.gapToZone)?`${r.gapToZone>0?"+":""}${Math.round(r.gapToZone*100)}%`:"—")}<h3>Why</h3><ul>${(r.reasons||[]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul>${r.flags?`<p><em>${esc(r.flags)}</em></p>`:""}</div><div><h3>Fundamentals</h3>${row("Sector / profile",`${esc(r.sector||"—")} / ${esc(r.profile||"default")}`)}${row("Market cap",r.marketCap?`₹${Math.round(r.marketCap).toLocaleString("en-IN")} Cr ${capTag(r.cap)}`:"—")}${row("P/E",fmt(r.pe))}${row(`Fair ${esc(r.basis||"multiple")}`,fmt(r.fairMultiple))}${row("Sector P/E",sectorPeText(r))}${row("P/B",fmt(r.pb,2))}${row("ROCE",pct(r.roce))}${row("ROE",pct(r.roe))}${row("3-yr sales CAGR",pct(r.salesCagr3))}${row("3-yr profit CAGR",pct(r.profitCagr3))}${row("Borrowings / reserves",`${fmt(r.borrowings,0)} / ${fmt(r.reserves,0)} Cr`)}${row("3-yr cash conversion",cash)}${row("Free cash flow",r.fcfNegative===1?'<span class="avoid">Negative</span>':r.fcfNegative===0?"Positive":"—")}${row("Debtor / inventory days",`${fmt(r.debtorDays,0)} / ${fmt(r.inventoryDays,0)}`)}${row("Promoter holding",pct(r.promoter))}${row("Promoter change (3y)",Number.isFinite(r.promoterChange3y)?`${r.promoterChange3y>0?"+":""}${fmt(r.promoterChange3y)} pts`:"—")}${row("Source / data age",`${esc(r.source||"—")} · ${r.ageDays===null||r.ageDays===undefined?"—":r.ageDays+"d"}${r.stale?" ⚠ stale":""}`)}${refresh}</div>`;
  if(r.etf){const cols=box.children;if(cols[1])cols[1].innerHTML=`<h3>ETF numbers</h3>${etfRowsHtml(r,row)}${refresh}`}
  bind();
}
// ETF key numbers (shared by the stock sheet and the Home result card)
function etfRowsHtml(r,row){const e=r.etf||{},sg=v=>Number.isFinite(v)?`${v>0?"+":""}${fmt(v)}%`:"—";return `${row("Type",esc(e.typeLabel||"ETF"))}${row("vs 200-day average",Number.isFinite(e.devNow)?`${sg(e.devNow)} <small class="hint">(usual ${sg(e.devLow)} to ${sg(e.devHigh)}, median ${sg(e.devMedian)})</small>`:"—")}${row("Where today ranks in its history",Number.isFinite(e.pctile)?`${Math.round(e.pctile)}th percentile <small class="hint">(0 = cheapest)</small>`:"—")}${row("200-day / 50-day average",`${money(e.dma200)} / ${money(e.dma50)}`)}${row("From 52-week high",sg(e.fromHigh))}${row("Returns a year (1 · 3 · 5 yr)",`${sg(e.cagr1)} · ${sg(e.cagr3)} · ${sg(e.cagr5)}`)}${e.indexName?row(`${esc(e.indexName)} P/E · P/B · yield`,Number.isFinite(e.indexPe)?`${fmt(e.indexPe)} · ${fmt(e.indexPb,2)} · ${Number.isFinite(e.indexDy)?fmt(e.indexDy,2)+"%":"—"} <small class="hint">NSE</small>`:'<span class="hint">NSE did not answer</span>'):""}${row("Price vs iNAV",Number.isFinite(e.premium)?`${sg(e.premium)} <small class="hint">iNAV ${money(e.inav)}</small>`:"—")}${row("History used",Number.isFinite(e.histYears)?`${fmt(e.histYears)} years`:"—")}${row("Source / data age",`${esc(r.source||"—")} · ${r.ageDays===null||r.ageDays===undefined?"—":r.ageDays+"d"}`)}`}
// --- Financial advisor: single-stock (detail panel) flow. Suggestion is shown for
// review; nothing is written to the watchlist until "Apply" is clicked.
const advisorLensKey="equity-advisor-lens";
const advisorLensOptions=new Set(["balanced","value","growth","momentum"]);
let currentAdvisorLens=localStorage.getItem(advisorLensKey)||"balanced";
if(!advisorLensOptions.has(currentAdvisorLens))currentAdvisorLens="balanced";
function setAdvisorLens(lens){
  currentAdvisorLens=advisorLensOptions.has(lens)?lens:"balanced";
  localStorage.setItem(advisorLensKey,currentAdvisorLens);
  document.querySelectorAll("#singleAdvisorLens,#advisorLens").forEach(select=>select.value=currentAdvisorLens);
}
setAdvisorLens(currentAdvisorLens);
document.querySelectorAll("#singleAdvisorLens,#advisorLens").forEach(select=>select.onchange=()=>{
  setAdvisorLens(select.value);
  if(typeof advisorResults!=="undefined"){advisorResults.clear();renderAdvisorList();if($("#advisorProgress"))$("#advisorProgress").textContent=""}
});
function advisorSuggestionHtml(s){
  return `<div class="advisor-suggestion"><div class="row"><span>Research lens</span><strong>${s.researchLens||"Balanced"}</strong></div><div class="row"><span>Action</span><strong class="${s.action?actionTone(s.action):""}">${s.action||"—"}</strong></div><div class="row"><span>Valuation</span><strong>${s.valuation||"—"}</strong></div><div class="row"><span>Style</span>${styleBadgeHtml(s.style)}</div><div class="row"><span>Long-term story</span>${verdictHtml(s.longTermStory)}</div><div class="row"><span>Confidence</span><span>${s.confidence||"—"}</span></div><p>${s.longTermStory?.reasoning||""}</p>${s.keyRisk?`<p><strong>Key risk:</strong> ${s.keyRisk}</p>`:""}${s.caveat?`<p class="caveat">${s.caveat}</p>`:""}<div class="actions"><button id="acceptAdvisor" class="primary" type="button">Apply</button><button id="discardAdvisor" type="button" class="ghost">Discard</button></div></div>`;
}
async function applyAdvisorSuggestions(updates){
  const r=await fetch("/api/advise/apply",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({updates})});
  const x=await r.json();
  if(r.ok&&x.stocks){stocks=x.stocks;save()}
  return x;
}
$("#askAdvisor").onclick=async()=>{
  if(!selected)return;
  const btn=$("#askAdvisor"),box=$("#advisorResult");
  const lens=currentAdvisorLens;
  btn.disabled=true;btn.textContent="Asking…";box.innerHTML="";
  try{
    const r=await fetch("/api/advise",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:selected.id,lens})});
    const x=await r.json();
    if(!r.ok)throw new Error(x.message);
    x.suggestion.researchLens=lens;
    box.innerHTML=advisorSuggestionHtml(x.suggestion);
    $("#acceptAdvisor").onclick=async()=>{const id=selected.id;await applyAdvisorSuggestions([{id,...x.suggestion}]);await loadHistory();select(id)};
    $("#discardAdvisor").onclick=()=>{box.innerHTML=""};
  }catch(error){ box.innerHTML=`<div class="advisor-error">${error.message}</div>`; }
  finally{ btn.disabled=false;btn.textContent="Ask the advisor"; }
};
$("#search").oninput=()=>{currentPage=1;render();};
$("#account").onchange=()=>{currentPage=1;render();};
$("#bucket").onchange=()=>{currentPage=1;render();};
$("#action").onchange=()=>{currentPage=1;render();};
document.querySelectorAll(".category-tabs .viewTab").forEach(btn=>{
  btn.onclick=()=>{
    currentCategory=btn.dataset.tab;
    currentPage=1;
    render();
  };
});
$("#editor").onsubmit=async e=>{e.preventDefault();if(!selected)return;selected.bucket=$("#editBucket").value;selected.action=$("#editAction").value;selected.valuation=$("#editValuation").value;{const np=Number($("#price").value)||null;if(np!==selected.price){selected.priceAt=new Date().toISOString();selected.priceSource="Entered by you";selected.feedStatus="Price refreshed"}selected.price=np};selected.low=Number($("#low").value)||null;selected.high=Number($("#high").value)||null;selected.kpi=$("#kpi").value;selected.note=$("#note").value;selected.updated=new Date().toLocaleString("en-IN");selected.feedStatus="Local research update";save();await publishWatchlist();await loadHistory();select(selected.id)};
$("#export").onclick=()=>{const cols=["Company","Ticker","Held in","Bucket","Action","Valuation","Latest Close","52W Low","52W High","Zone 1 Low","Zone 1 High","Deep Zone Low","Deep Zone High","Order book or KPI","Research note","Last updated"];const csv=[cols,...stocks.map(s=>{const m=multiplier(s),p=s.price;return[s.company,s.ticker,(s.accounts||[]).join("; "),s.bucket,s.action,s.valuation,p??"",s.low??"",s.high??"",p?p*m[0]:"",p?p*m[1]:"",p?p*m[2]:"",p?p*m[3]:"",s.kpi,s.note,s.updated]})].map(r=>r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="equity-watchlist.csv";a.click();URL.revokeObjectURL(a.href)};
$("#refresh").onclick=async()=>{const b=$("#refresh");console.group("Equity watchlist refresh");console.info(`Started ${new Date().toLocaleString("en-IN")}. Refreshing ${stocks.length} stocks.`);b.textContent="Refreshing prices and news…";b.disabled=true;try{const r=await fetch("/api/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({stocks})});const x=await r.json();if(!r.ok)throw new Error(x.message);stocks=x.stocks;save();await publishWatchlist();await loadHistory();if(selected)selected=stocks.find(s=>s.id===selected.id);await loadPe();render();if($("#reportsView")&&!$("#reportsView").hidden){renderPrint();renderHistoryPanel()}console.info(`Finished. ${x.refreshed} prices refreshed.`);console.table(stocks.map(s=>({Company:s.company,Ticker:s.marketSymbol||"Confirm",Price:s.price,"52W Low":s.low,"52W High":s.high,Status:s.feedStatus,News:s.latestNews||"No headline"})));{const by={},failed=stocks.filter(s=>String(s.feedStatus||"").startsWith("Refresh failed"));for(const s of stocks)if(s.feedStatus==="Price refreshed"&&s.priceAt&&Date.now()-Date.parse(s.priceAt)<10*60e3)by[s.priceSource]=(by[s.priceSource]||0)+1;window.toast?.(`✓ ${x.refreshed} of ${stocks.length} prices refreshed${Object.keys(by).length?` (${Object.entries(by).map(([k,n])=>`${k} ${n}`).join(", ")})`:""}.${failed.length?` ${failed.length} failed, e.g. ${ui.esc(failed[0].marketSymbol||failed[0].ticker)}: ${ui.esc(String(failed[0].feedStatus).replace("Refresh failed: ","").slice(0,140))}. Integrations → Price sources shows why.`:""}`,{kind:failed.length&&!x.refreshed?"bad":"ok",ms:failed.length?12000:5000})}}catch(error){console.error("Refresh failed",error);window.toast?.(`Refresh failed: ${ui.esc(error.message)}`,{kind:"bad"})}finally{b.textContent="Refresh sources";b.disabled=false;console.groupEnd()}};

// ============================================================================
// Reports: Dashboard, Printable report, Change history
// ============================================================================
function valuationGroup(v){
  if(!v)return"Pending";
  const s=v.toLowerCase();
  if(s.includes("pending"))return"Pending";
  if(s.includes("very rich"))return"Very rich";
  if(s.includes("rich"))return"Rich";
  if(s.includes("fair"))return"Fair";
  return"Other / uncertain";
}
function countBy(list,fn){const m=new Map();for(const item of list){const k=fn(item);m.set(k,(m.get(k)||0)+1)}return[...m.entries()].sort((a,b)=>b[1]-a[1])}
function barsHtml(entries,total,toneFn){return entries.map(([label,count])=>{const pct=total?Math.round(count/total*100):0;const tone=toneFn?toneFn(label):"";return `<div class="bar-row"><span>${label}</span><span class="bar-track"><span class="bar-fill ${tone}" style="width:${pct}%"></span></span><span>${count}</span></div>`}).join("")}
function needsAttention(){return stocks.filter(s=>!Number.isFinite(s.price)||s.feedStatus==="Ticker confirmation needed"||(s.feedStatus&&s.feedStatus.startsWith("Refresh failed")))}
function lastChangeMap(){const m=new Map();for(const c of history.changes||[]){const cur=m.get(c.id);if(!cur||c.at>cur)m.set(c.id,c.at)}return m}

function renderDashboard_(){
  if(!$("#dashCards"))return;
  const total=stocks.length;
  const researched=stocks.filter(s=>s.valuation!=="Initial coverage pending").length;
  const buy=stocks.filter(s=>actionTone(s.action)==="buy").length;
  const avoid=stocks.filter(s=>actionTone(s.action)==="avoid").length;
  const attention=needsAttention();

  $("#dashCards").innerHTML=`<div><span>Tracked stocks</span><strong>${total}</strong></div><div><span>Researched</span><strong>${researched} <small>(${total?Math.round(researched/total*100):0}%)</small></strong></div><div><span>Buy-rated</span><strong>${buy}</strong></div><div><span>Avoid-rated</span><strong>${avoid}</strong></div><div><span>Needs live refresh</span><strong>${attention.length}</strong></div>`;

  $("#chartBucket").innerHTML=barsHtml(countBy(stocks,s=>s.bucket),total);
  $("#chartAction").innerHTML=barsHtml(countBy(stocks,s=>s.action),total,l=>actionTone(l));
  $("#chartValuation").innerHTML=barsHtml(countBy(stocks,s=>valuationGroup(s.valuation)),total);

  $("#attentionList").innerHTML=attention.length?attention.slice(0,12).map(s=>`<li><div class="fcompany">${s.company}</div><div class="fnote">${s.feedStatus||"No price yet — needs refresh"}</div></li>`).join(""):"<li>All prices current.</li>";

  const lastChanged=lastChangeMap();
  const reviewed=stocks.filter(s=>lastChanged.has(s.id)).sort((a,b)=>lastChanged.get(a.id).localeCompare(lastChanged.get(b.id))).slice(0,8);
  const untracked=stocks.length-lastChanged.size;
  $("#staleList").innerHTML=reviewed.length
    ?reviewed.map(s=>`<li><div class="fcompany">${s.company}</div><div class="fnote">Last research edit ${new Date(lastChanged.get(s.id)).toLocaleDateString("en-IN")}</div></li>`).join("")+(untracked?`<li class="fnote">${untracked} more have no tracked edits yet — this fills in as you update research.</li>`:"")
    :"<li>No research edits tracked yet — updating an action, valuation, bucket, KPI or note will start filling this in.</li>";
}

function populatePrintStockSelect_(){
  const sel=$("#printStock");
  if(!sel)return;
  sel.innerHTML=stocks.slice().sort((a,b)=>a.company.localeCompare(b.company)).map(s=>`<option value="${s.id}">${s.company}</option>`).join("");
}
function renderPrint_(){
  if(!$("#printArea"))return;
  const mode=$("#printMode").value;
  $("#printStock").style.display=mode==="single"?"":"none";
  const now=new Date().toLocaleString("en-IN",{timeZone:"Asia/Kolkata"});
  if(mode==="full"){
    const order=["Buy gradually","Buy on dips","Buy on correction","Small accumulation","Small buy only","Small turnaround position","Wait for correction","Watch","Avoid"];
    const byAction=new Map();
    for(const s of stocks){const arr=byAction.get(s.action)||[];arr.push(s);byAction.set(s.action,arr)}
    const orderedActions=[...order.filter(a=>byAction.has(a)),...[...byAction.keys()].filter(a=>!order.includes(a))];
    const sections=orderedActions.map(action=>{
      const rows=byAction.get(action).sort((a,b)=>a.company.localeCompare(b.company)).map(s=>`<tr><td>${s.company} (${s.ticker})</td><td>${s.bucket}</td><td>${s.valuation}</td><td>${money(s.price)}</td><td>${money(s.low)}–${money(s.high)}</td><td>${s.kpi}</td><td>${s.note}</td></tr>`).join("");
      return `<div class="psection"><h3>${action} (${byAction.get(action).length})</h3><table><thead><tr><th>Company</th><th>Bucket</th><th>Valuation</th><th>Price</th><th>52W range</th><th>KPI</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }).join("");
    const researched=stocks.filter(s=>s.valuation!=="Initial coverage pending").length;
    $("#printArea").innerHTML=`<h2>Long-term equity watchlist — full report</h2><p class="pmeta">Generated ${now} IST • ${stocks.length} stocks tracked • ${researched} researched • ${stocks.filter(s=>actionTone(s.action)==="buy").length} buy-rated • ${stocks.filter(s=>actionTone(s.action)==="avoid").length} avoid-rated</p>${sections}<p class="pmeta">Research snapshot only. Verify exchange filings, results and live prices before investing.</p>`;
  }else{
    const id=Number($("#printStock").value);
    const s=stocks.find(x=>x.id===id);
    if(!s){$("#printArea").innerHTML="<p>Select a stock.</p>";return}
    const changes=(history.changes||[]).filter(c=>c.id===s.id).slice().reverse();
    const changeRows=changes.length?changes.map(c=>`<tr><td>${new Date(c.at).toLocaleDateString("en-IN")}</td><td>${c.field}</td><td>${c.from??"—"}</td><td>${c.to??"—"}</td></tr>`).join(""):`<tr><td colspan="4">No tracked changes yet.</td></tr>`;
    $("#printArea").innerHTML=`<h2>${s.company} (${s.ticker})</h2><p class="pmeta">Generated ${now} IST • ${s.bucket} • ${s.action} • ${s.valuation}</p><table><tr><th>Latest close</th><td>${money(s.price)}</td><th>52W range</th><td>${money(s.low)}–${money(s.high)}</td></tr><tr><th>Zone 1</th><td>${zone(s)}</td><th>Deep zone</th><td>${zone(s,true)}</td></tr><tr><th>Order book / KPI</th><td colspan="3">${s.kpi}</td></tr><tr><th>Research note</th><td colspan="3">${s.note}</td></tr><tr><th>Latest news</th><td colspan="3">${s.latestNews||"—"}</td></tr><tr><th>Last updated</th><td colspan="3">${s.updated}</td></tr></table><div class="psection"><h3>Change history</h3><table><thead><tr><th>Date</th><th>Field</th><th>From</th><th>To</th></tr></thead><tbody>${changeRows}</tbody></table></div>`;
  }
}

function renderHistoryPanel(){
  if(!$("#historyRows"))return;
  const q=($("#historySearch").value||"").toLowerCase();
  const all=history.changes||[];
  const filtered=all.filter(c=>!q||`${c.company} ${c.field}`.toLowerCase().includes(q));
  const rows=filtered.slice().reverse().slice(0,300);
  $("#historyRows").innerHTML=rows.length?rows.map(c=>`<tr><td>${new Date(c.at).toLocaleString("en-IN")}</td><td>${c.company}</td><td>${c.field}</td><td>${c.from??"—"}</td><td>${c.to??"—"}</td></tr>`).join(""):`<tr><td colspan="5">No research changes recorded yet — edits to action, valuation, bucket, KPI or notes will show up here.</td></tr>`;
  $("#historyCount").textContent=filtered.length?`Showing ${rows.length} of ${filtered.length} matching changes.`:"";
}

// --- Financial advisor: bulk (Reports tab) flow. Runs your own Claude API key once
// per selected stock, shows every suggestion for review, and only writes the ones
// you tick and apply. advisorResults is scratch state for this tab, not persisted.
let advisorResults=new Map();
function currentAdvisorTargets(){ return $("#advisorScope").value==="all"?stocks.slice():stocks.filter(s=>s.action==="Watch"); }
function renderAdvisorList_(){
  if(!$("#advisorRows"))return;
  $("#advisorRows").innerHTML=currentAdvisorTargets().map(s=>{
    const res=advisorResults.get(s.id);
    if(res?.suggestion){const sug=res.suggestion;return `<tr data-id="${s.id}"><td><input type="checkbox" class="advisorPick" data-id="${s.id}" checked></td><td>${s.company}</td><td><span class="${actionClass(s)}">${s.action}</span></td><td><strong class="${sug.action?actionTone(sug.action):""}">${sug.action||"—"}</strong></td><td>${s.valuation}</td><td>${sug.valuation||"—"}</td><td>${styleBadgeHtml(sug.style)}</td><td>${verdictHtml(sug.longTermStory)}</td><td>${sug.confidence||"—"}</td></tr>`;}
    if(res?.error)return `<tr data-id="${s.id}"><td><input type="checkbox" disabled></td><td>${s.company}</td><td><span class="${actionClass(s)}">${s.action}</span></td><td>—</td><td>${s.valuation}</td><td colspan="4" class="advisor-error">${res.error}</td></tr>`;
    return `<tr data-id="${s.id}"><td><input type="checkbox" disabled></td><td>${s.company}</td><td><span class="${actionClass(s)}">${s.action}</span></td><td>—</td><td>${s.valuation}</td><td colspan="4" class="advisor-status">Not run yet</td></tr>`;
  }).join("");
}
$("#advisorScope").onchange=()=>{advisorResults.clear();renderAdvisorList();$("#advisorProgress").textContent=""};
$("#advisorSelectAll").onchange=e=>{document.querySelectorAll(".advisorPick").forEach(cb=>cb.checked=e.target.checked)};
$("#advisorRunBtn").onclick=async()=>{
  const targets=currentAdvisorTargets();
  if(!targets.length){ui.alert({title:"Nothing to run",message:"No stocks in this scope."});return}
  const lens=currentAdvisorLens;
  const btn=$("#advisorRunBtn");btn.disabled=true;
  document.querySelectorAll("#singleAdvisorLens,#advisorLens").forEach(select=>select.disabled=true);
  advisorResults.clear();renderAdvisorList();
  const chunkSize=6;let done=0;
  $("#advisorProgress").textContent=`Running 0/${targets.length}…`;
  for(let i=0;i<targets.length;i+=chunkSize){
    const chunk=targets.slice(i,i+chunkSize);
    try{
      const r=await fetch("/api/advise/bulk",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:chunk.map(s=>s.id),lens})});
      const x=await r.json();
      for(const item of (x.results||[])){if(item.suggestion)item.suggestion.researchLens=lens;advisorResults.set(item.id,item)}
    }catch(error){ for(const s of chunk)advisorResults.set(s.id,{error:error.message}); }
    done+=chunk.length;
    $("#advisorProgress").textContent=`Running ${Math.min(done,targets.length)}/${targets.length}…`;
    renderAdvisorList();
  }
  $("#advisorProgress").textContent=`Done: ${[...advisorResults.values()].filter(r=>r.suggestion).length}/${targets.length} succeeded.`;
  btn.disabled=false;
  document.querySelectorAll("#singleAdvisorLens,#advisorLens").forEach(select=>select.disabled=false);
};
$("#advisorApplyBtn").onclick=async()=>{
  const checked=[...document.querySelectorAll(".advisorPick:checked")].map(cb=>Number(cb.dataset.id));
  if(!checked.length){ui.alert({title:"Nothing selected",message:"Tick at least one suggestion to apply."});return}
  const updates=checked.map(id=>{const res=advisorResults.get(id);return res?.suggestion?{id,...res.suggestion}:null}).filter(Boolean);
  $("#advisorApplyStatus").textContent="Applying…";
  const x=await applyAdvisorSuggestions(updates);
  await loadHistory();
  render();
  advisorResults.clear();
  renderAdvisorList();
  $("#advisorApplyStatus").textContent=x.ok?`Applied ${x.count} suggestion(s).`:`Failed: ${x.message||"unknown error"}`;
};

function setReportSub(tab){
  $("#dashboardPanel").hidden=tab!=="dashboard";
  $("#printPanel").hidden=tab!=="print";
  $("#historyPanel").hidden=tab!=="history";
  $("#advisorPanel").hidden=tab!=="advisor";
  $("#subDashboard").classList.toggle("active",tab==="dashboard");
  $("#subPrint").classList.toggle("active",tab==="print");
  $("#subHistory").classList.toggle("active",tab==="history");
  $("#subAdvisor").classList.toggle("active",tab==="advisor");
  if(tab==="dashboard")renderDashboard();
  if(tab==="print"){populatePrintStockSelect();renderPrint()}
  if(tab==="history")renderHistoryPanel();
  if(tab==="advisor")renderAdvisorList();
}
function setView(view){
  const v=["watchlist","reports","valuation","plan","picks","growth","integrations","thesis","portfolio","alerts","invest","dividends","focus","market","funds","networth","tax","model","us","lists","swing","returns","events","accumulate"].includes(view)?view:"home";
  // screens added in v5 (features.js): one section each, marked data-feature-view
  document.querySelectorAll("[data-feature-view]").forEach(sec=>{sec.hidden=sec.dataset.featureView!==v});
  document.querySelectorAll("[data-goto]").forEach(b=>b.classList.toggle("active",b.dataset.goto===v));
  if(window.featureOpen?.[v])window.featureOpen[v]();
  $("#homeView").hidden=v!=="home";
  $("#portfolioView").hidden=v!=="portfolio";
  $("#alertsView").hidden=v!=="alerts";
  $("#divView").hidden=v!=="dividends";
  $("#focusView").hidden=v!=="focus";
  $("#marketView").hidden=v!=="market";
  $("#fundView").hidden=v!=="funds";
  $("#nwView").hidden=v!=="networth";
  $("#taxView").hidden=v!=="tax";
  $("#modelView").hidden=v!=="model";
  $("#swingView").hidden=v!=="swing";
  $("#viewSwing").classList.toggle("active",v==="swing");
  if(v==="swing")window.openSwing?.();
  $("#listsView").hidden=v!=="lists";
  $("#viewLists").classList.toggle("active",v==="lists");
  if(v==="lists")window.openLists?.();
  // The watchlist picker only matters on screens that follow the selected watchlist.
  $("#listBar").hidden=!["home","valuation","picks","growth","watchlist","plan","reports","thesis"].includes(v);
  $("#usView").hidden=v!=="us";
  $("#viewModel").classList.toggle("active",v==="model");
  $("#viewUs").classList.toggle("active",v==="us");
  if(v==="model")window.openModel?.();
  if(v==="us")window.openUs?.();
  $("#viewTax").classList.toggle("active",v==="tax");
  if(v==="tax")window.openTax?.();
  try{window.history.replaceState(null,"",v==="home"?location.pathname:`#${v}`)}catch{}
  $("#viewNetworth").classList.toggle("active",v==="networth");
  if(v==="networth")window.openNetworth?.();
  $("#viewFunds").classList.toggle("active",v==="funds");
  if(v==="funds")window.openFunds?.();
  $("#viewMarket").classList.toggle("active",v==="market");
  if(v==="market")window.openMarket?.();
  $("#viewFocus").classList.toggle("active",v==="focus");
  if(v==="focus")window.openFocus?.();
  $("#viewDividends").classList.toggle("active",v==="dividends");
  document.querySelectorAll(".screen-nav .viewTab").forEach(b=>b.classList.toggle("active",b.dataset.screen===v));
  $("#viewPicks").classList.toggle("active",v==="picks"||v==="growth");
  if(["watchlist","plan","thesis","reports"].includes(v)&&$("#sideResearch"))$("#sideResearch").open=true;
  if(v==="dividends")window.openDividends?.();
  $("#investView").hidden=v!=="invest";
  $("#viewAlerts").classList.toggle("active",v==="alerts");
  $("#viewInvest").classList.toggle("active",v==="invest");
  if(v==="alerts")window.openAlerts?.();
  if(v==="invest")window.openInvest?.();
  $("#viewHome").classList.toggle("active",v==="home");
  $("#viewPortfolio").classList.toggle("active",v==="portfolio");
  $("#backHome").hidden=v==="home";
  window.closeMenu?.();
  if(v==="home")window.openHome?.();
  if(v==="portfolio")window.openPortfolio?.();
  $("#watchlistView").hidden=v!=="watchlist";
  $("#reportsView").hidden=v!=="reports";
  $("#valuationView").hidden=v!=="valuation";
  $("#planView").hidden=v!=="plan";
  $("#picksView").hidden=v!=="picks";
  $("#growthView").hidden=v!=="growth";
  $("#integrationsView").hidden=v!=="integrations";
  $("#thesisView").hidden=v!=="thesis";
  $("#viewThesis").classList.toggle("active",v==="thesis");
  $("#viewIntegrations").classList.toggle("active",v==="integrations");
  $("#viewGrowth").classList.toggle("active",v==="growth");
  $("#viewWatchlist").classList.toggle("active",v==="watchlist");
  $("#viewValuation").classList.toggle("active",v==="valuation");
  $("#viewPlan").classList.toggle("active",v==="plan");
  $("#viewReports").classList.toggle("active",v==="reports");
  if(v==="reports")setReportSub("dashboard");
  if(v==="valuation")loadValuation().then(renderValuation);
  if(v==="plan")loadPlan();
  if(v==="picks")openPicks();
  if(v==="growth")loadValuation().then(renderGrowth);
  if(v==="integrations")window.loadIntegrations?.();
  if(v==="thesis")window.loadThesis?.();
}
$("#viewGrowth").onclick=()=>setView("growth");
$("#viewIntegrations").onclick=()=>setView("integrations");
$("#viewThesis").onclick=()=>setView("thesis");
$("#viewPlan").onclick=()=>setView("plan");
$("#viewPicks").onclick=()=>setView("picks");
$("#viewValuation").onclick=()=>setView("valuation");
$("#viewWatchlist").onclick=()=>setView("watchlist");
$("#viewHome").onclick=()=>setView("home");
$("#viewPortfolio").onclick=()=>setView("portfolio");
$("#viewReports").onclick=()=>setView("reports");
$("#subDashboard").onclick=()=>setReportSub("dashboard");
$("#subPrint").onclick=()=>setReportSub("print");
$("#subHistory").onclick=()=>setReportSub("history");
$("#subAdvisor").onclick=()=>setReportSub("advisor");
$("#printMode").onchange=renderPrint;
$("#printStock").onchange=renderPrint;
$("#printBtn").onclick=()=>window.print();
$("#historySearch").oninput=renderHistoryPanel;

// ============================================================================
// Valuation view: rule-based verdict + buy zone per stock (computed server-side
// in valuation.mjs from data/fundamentals.json and the live price in the watchlist).
// ============================================================================
let valuation={rows:[],model:null,fundamentalsCount:0};
const esc=t=>String(t??"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const fmt=(v,d=1)=>Number.isFinite(v)?v.toLocaleString("en-IN",{maximumFractionDigits:d}):"—";
let valuationReq=null;// callers at the same moment share one request
async function loadValuation(){if(valuationReq)return valuationReq;valuationReq=(async()=>{try{const r=await fetch("/api/valuation");if(r.ok)valuation=await r.json()}catch{}})().finally(()=>{valuationReq=null});return valuationReq}
function statusTone(st){return st==="In zone"||st==="Below zone"?"buy":st==="Above zone"?"wait":st==="Wait (far above)"?"avoid":""}
function viewTone(v){return v==="Undervalued"?"buy":v==="Fair"?"buy":v==="Fair to rich"?"wait":(v==="Rich"||v==="Very rich")?"avoid":""}
function renderValuation_(){
  if(!$("#valRows"))return;
  const q=($("#valSearch").value||"").toLowerCase(),f=$("#valFilter").value;
  const all=valuation.rows||[];
  const only30=$("#valBest30").checked;
  const rows=all.filter(r=>(!q||`${r.company} ${r.symbol}`.toLowerCase().includes(q))&&(f==="All"||r.status===f)&&(!only30||best30Tier.has(r.symbol))&&($("#valCap").value==="All"||r.cap===$("#valCap").value));
  const count=st=>all.filter(r=>r.status===st).length;
  $("#valCards").innerHTML=`<div><span>With fundamentals</span><strong>${valuation.fundamentalsCount?all.filter(r=>r.view!=="No fundamentals").length:0} <small>of ${all.length}</small></strong></div><div><span>In / below buy zone</span><strong>${count("In zone")+count("Below zone")}</strong></div><div><span>Above zone</span><strong>${count("Above zone")}</strong></div><div><span>Wait (far above)</span><strong>${count("Wait (far above)")}</strong></div>`;
  const order={"In zone":0,"Below zone":1,"Above zone":2,"Wait (far above)":3};
  rows.sort((a,b)=>(order[a.status]??9)-(order[b.status]??9)||(a.gapToZone??9)-(b.gapToZone??9));
  const fv=r=>r.fairValue?`${money(r.fairValue.bear)} · <strong>${money(r.fairValue.base)}</strong> · ${money(r.fairValue.bull)}${Number.isFinite(r.upsideToBase)?` <span class="${r.upsideToBase>=0?"buy":"avoid"}">(${r.upsideToBase>=0?"+":""}${Math.round(r.upsideToBase*100)}%)</span>`:""}`:"—";
  $("#valRows").innerHTML=rows.length?rows.map(r=>`<tr data-id="${r.id}"${r.stale?' style="opacity:.6"':""}><td><div class="company">${esc(r.company)}${capTag(r.cap)}</div><div class="ticker">${esc(r.symbol)}${r.marketCap?` · ₹${Math.round(r.marketCap).toLocaleString("en-IN")} Cr`:""}${r.profile&&r.profile!=="default"?` · ${esc(r.profile)}`:""}${r.sector?` · ${esc(r.sector)}`:""}</div></td><td>${money(r.price)}</td><td>${rangeBar(r.low,r.high,r.price)}</td><td>${fmt(r.pe)}</td><td>${r.fairMultiple?`${fmt(r.fairMultiple)} <small>${esc(r.basis)}</small>`:"—"}</td><td>${sectorPeText(r)}</td><td>${fmt(r.pb)}</td><td>${fmt(r.roce)}</td><td>${fmt(r.roe)}</td><td>${fmt(r.promoter)}</td><td>${viewChip(r.view,r.confidence==="low"?" <small title=\"NSE-only data: peer-relative check\">(low conf.)</small>":"")}${gaugeHtml(r.ratio)}</td><td class="range">${fv(r)}</td><td class="range">${r.zoneLow?`${money(r.zoneLow)} – ${money(r.zoneHigh)}${r.floored?" ⚑":""}`:"—"}</td><td>${Number.isFinite(r.gapToZone)?(r.gapToZone>0?"+":"")+Math.round(r.gapToZone*100)+"%":"—"}</td><td>${statusChip(r.status)}</td><td class="kpi">${esc((r.reasons||[]).join(" "))}${r.flags?` <em>${esc(r.flags)}</em>`:""}</td><td>${r.ageDays===null||r.ageDays===undefined?"—":r.ageDays+"d"}${r.stale?" ⚠":""}</td><td><button type="button" class="ghost valRefresh" data-id="${r.id}" title="Re-fetch this stock (Screener, Yahoo, NSE per the Source setting)">↻</button></td></tr>`).join(""):`<tr><td colspan="18" style="text-align:center;padding:24px;color:var(--muted)">No stocks match.</td></tr>`;
  document.querySelectorAll(".valRefresh").forEach(b=>b.onclick=()=>fetchFundamentals([Number(b.dataset.id)],true));
  const m=valuation.model;
  $("#valModel").textContent=m?`Rules (default profile): fair P/E = ${m.basePE} + growth (60% lower / 40% higher of 3-yr sales and profit CAGR, clamped ${m.growthFloor}–${m.growthCap}%) + ROCE adjustment (${m.roceSlope} per point above ${m.roceAnchor}%), clamped ${m.fairPEMin}–${m.fairPEMax}; blended ${m.sectorBlend*100}% with the NSE sector P/E when available; cut for borrowings > reserves (×${m.leveragePenalty}), promoters selling >5 pts (×${m.promoterSellPenalty}), weak cash conversion (<${m.cashConversionMin}× profit, ×${m.cashConversionPenalty}), negative free cash flow (×${m.negativeFcfPenalty}) and heavy working capital (debtors >${m.debtorDaysMax}d or inventory >${m.inventoryDaysMax}d of sales, ×${m.workingCapitalPenalty}). Lender profile: P/B vs (ROE − ${m.financial.growth}) ÷ (${m.financial.costOfEquity} − ${m.financial.growth}). Cyclical profile: P/E normalised on 4-yr average profit. View = multiple ÷ fair multiple (<${m.bands[0][0]} undervalued, <${m.bands[1][0]} fair, <${m.bands[2][0]} fair to rich, <${m.bands[3][0]} rich, else very rich). Fair value bear/base/bull = ${m.scenarios.bear}× / ${m.scenarios.base}× / ${m.scenarios.bull}× the fair multiple. Buy zone top = fair multiple × ${m.marginOfSafety}; bottom = ${m.zoneDepth} of that; cheap stocks get ${m.undervaluedZone[0]}–${m.undervaluedZone[1]}× today's price. ⚑ = value below the 52-week low, zone floored. ⚠ / faded = fundamentals older than ${m.staleDays} days.`:"";
}

async function fetchFundamentals(ids,force,ui={}){
  const status=ui.status||$("#valFetchStatus"),btn=ui.btn||$("#valFetchBtn"),sourceEl=ui.source||document.getElementById("valSource");
  if(!ids.length){status.textContent="Nothing to fetch.";return}
  
  btn.disabled=true;let done=0,saved=0;const problems=[],nseUsed=[];
  try{
    for(let i=0;i<ids.length;i+=3){
      const chunk=ids.slice(i,i+3);
      status.textContent=`Fetching ${done+1}–${done+chunk.length} of ${ids.length}…`;
      const r=await fetch("/api/fundamentals/fetch",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({ids:chunk,force,source:sourceEl?.value||"auto"})});
      const x=await r.json();if(!r.ok)throw new Error(x.message);
      saved+=x.saved;for(const it of x.results){if(it.error)problems.push(`${it.company}: ${it.error}`);else if(it.sources&&/^NSE/.test(it.sources))nseUsed.push(it.company)}
      done+=chunk.length;await loadValuation();renderValuation();loadPe().then(render);
      if(x.results.some(it=>it.error&&it.rateLimited)){break}
    }
    status.textContent=`Saved ${saved}/${ids.length}.${nseUsed.length?` ${nseUsed.length} via NSE (price, P/E, sector P/E only; Yahoo statements kept where cached).`:""}${problems.length?" Check: "+problems.slice(0,4).join(" | "):""}`;
  }catch(error){status.textContent=`Failed: ${error.message}`}
  finally{btn.disabled=false}
}
$("#valFetchBtn").onclick=()=>{
  const q=($("#valSearch").value||"").toLowerCase(),f=$("#valFilter").value,limit=Math.max(1,Math.min(200,Number($("#valLimit").value)||10));
  const stale=a=>!a||Date.now()-new Date(a).getTime()>7*864e5;
  const ids=(valuation.rows||[]).filter(r=>(!q||`${r.company} ${r.symbol}`.toLowerCase().includes(q))&&(f==="All"||r.status===f)&&(!$("#valBest30").checked||best30Tier.has(r.symbol))&&(r.view==="No fundamentals"||stale(r.asOf))).slice(0,limit).map(r=>r.id);
  fetchFundamentals(ids,false);
};
$("#valSearch").oninput=renderValuation;
$("#valBest30").onchange=renderValuation;
$("#valCap").onchange=renderValuation;
$("#valFilter").onchange=renderValuation;
$("#valImportToggle").onclick=()=>{$("#valImport").hidden=!$("#valImport").hidden};
$("#valTemplate").onclick=()=>{const head="symbol,price,pe,pb,roce,roe,promoter,promoterChange3y,salesCagr3,profitCagr3,borrowings,reserves,asOf,source,flags";const ex="BLS,217,12.6,3.6,29.8,32.1,70.4,0,26,49,431,2422,2026-10-01,Screener.in,Example row - replace";const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([head+"\n"+ex+"\n"],{type:"text/csv"}));a.download="fundamentals-template.csv";a.click();URL.revokeObjectURL(a.href)};
$("#valImportBtn").onclick=async()=>{
  const csv=$("#valCsv").value.trim();if(!csv){$("#valImportStatus").textContent="Paste CSV first.";return}
  $("#valImportStatus").textContent="Importing…";
  try{const r=await fetch("/api/fundamentals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({csv})});const x=await r.json();if(!r.ok)throw new Error(x.message);
    $("#valImportStatus").textContent=`Imported ${x.count} row(s); ${x.total} stocks have fundamentals.`;$("#valCsv").value="";await loadValuation();renderValuation()}
  catch(error){$("#valImportStatus").textContent=`Failed: ${error.message}`}
};

// ---- Data checks: Yahoo vs Screener reference, and forward tracker ----
$("#cmpLoad").onclick=async()=>{
  const out=$("#cmpOut");out.textContent="Loading…";
  try{const r=await fetch("/api/compare");const x=await r.json();if(!r.ok)throw new Error(x.message);
    $("#cmpNote").textContent=x.note;
    out.innerHTML=x.rows.length?`<p class="hint">${x.flaggedStocks} of ${x.rows.length} stocks have at least one large difference.</p><table style="min-width:0"><thead><tr><th>Stock</th><th>Large differences (Yahoo − Screener)</th></tr></thead><tbody>${x.rows.map(r=>`<tr><td>${esc(r.symbol)}</td><td>${r.flagged?r.fields.filter(f=>f.flag).map(f=>`${esc(f.field)}: ${f.reference} → ${f.yahoo} (${f.diff>0?"+":""}${f.diff}${f.unit})`).join("; "):"within tolerance"}</td></tr>`).join("")}</tbody></table>`:"<p class='hint'>No overlap yet: fetch fundamentals for the reference stocks first (they are the 20 names from the small-cap list).</p>";
  }catch(error){out.textContent=`Failed: ${error.message}`}
};
$("#perfLoad").onclick=async()=>{
  const out=$("#perfOut");out.textContent="Loading…";
  try{const r=await fetch("/api/valuation/performance");const x=await r.json();if(!r.ok)throw new Error(x.message);
    $("#perfNote").textContent=x.note;
    const tbl=(title,rows)=>rows.length?`<h4>${title}</h4><table style="min-width:0"><thead><tr><th>Group</th><th>Stocks</th><th>Avg return</th><th>Median</th><th>Hit rate</th><th>Median days</th></tr></thead><tbody>${rows.map(e=>`<tr><td>${esc(e.key)}</td><td>${e.count}</td><td>${e.avgReturnPct}%</td><td>${e.medianReturnPct}%</td><td>${e.hitRatePct}%</td><td>${e.medianDays}</td></tr>`).join("")}</tbody></table>`:"";
    out.innerHTML=tbl("By valuation view at first log",x.byView)+tbl("By status at first log",x.byStatus)||"";
  }catch(error){out.textContent=`Failed: ${error.message}`}
};

// ============================================================================
// Plan view: ladder positions, triggers, exposure, stress
// ============================================================================
let plan=null;
const inr=v=>Number.isFinite(v)?"₹"+Math.round(v).toLocaleString("en-IN"):"—";
function fillStockSelects(){
  const opts=stocks.slice().sort((a,b)=>a.company.localeCompare(b.company)).map(s=>`<option value="${esc(s.marketSymbol||s.ticker)}">${esc(s.company)} (${esc(s.marketSymbol||s.ticker)})</option>`).join("");
  for(const id of ["#planStock","#fixStock"]){const el=$(id),cur=el.value;el.innerHTML=opts;if(cur)el.value=cur}
}
async function planPost(op,body){const r=await fetch("/api/plan/"+op,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const x=await r.json();if(!r.ok)throw new Error(x.message);return x}
async function loadPlan(){
  fillStockSelects();
  if(!$("#buyDate").value)$("#buyDate").value=new Date().toISOString().slice(0,10);
  try{const r=await fetch("/api/plan");if(r.ok)plan=await r.json()}catch{}
  renderPlan();
}
function renderPlan(){
  if(!plan)return;
  const t=plan.totals;
  $("#planCards").innerHTML=`<div><span>Invested</span><strong>${inr(t.invested)}</strong></div><div><span>Planned maximum</span><strong>${inr(t.maxPlanned)}</strong></div><div><span>Still to deploy</span><strong>${inr(t.remaining)}</strong></div><div><span>Actions due</span><strong>${t.due}</strong></div>`;
  if(document.activeElement!==$("#planTranche"))$("#planTranche").value=plan.settings.trancheSize;
  if(document.activeElement!==$("#planReserve"))$("#planReserve").value=plan.settings.cashReserve;
  const tone=a=>/^(ADD|START)/.test(a)?"buy":/HOLD/.test(a)?"avoid":/complete|No ladder/.test(a)?"":"wait";
  $("#planRows").innerHTML=plan.rows.length?plan.rows.map(r=>`<tr data-sym="${esc(r.symbol)}"><td><div class="company">${esc(r.company)}</div><div class="ticker">${esc(r.symbol)}</div></td><td>${esc(r.ladder)}</td><td>${money(r.price)}</td><td>${inr(r.invested)} <small>of ${inr(r.maxAmount)}</small></td><td>${money(r.avgPrice)}</td><td class="${r.pnlPct>=0?"buy":"avoid"}">${r.pnlPct===null?"—":(r.pnlPct>=0?"+":"")+r.pnlPct+"%"}</td><td>${r.next?`${money(r.next.trigger)} <small>(-${Math.round(r.next.dip*100)}%)</small>`:"—"}</td><td class="${r.gate.ok===true?"buy":r.gate.ok===false?"avoid":"wait"}">${esc(r.gate.label)}</td><td class="${tone(r.action)}">${esc(r.action)}</td><td class="kpi">${esc(r.detail)}</td><td><button type="button" class="ghost planUndo" data-sym="${esc(r.symbol)}" title="Remove the last recorded buy">↶</button> <button type="button" class="ghost planRemove" data-sym="${esc(r.symbol)}" title="Remove from plan">✕</button></td></tr>`).join(""):`<tr><td colspan="11" style="text-align:center;padding:24px;color:var(--muted)">No positions yet. Pick a stock above, set a ladder, and record your first buy.</td></tr>`;
  document.querySelectorAll(".planUndo").forEach(b=>b.onclick=async()=>{await planPost("undo",{symbol:b.dataset.sym});loadPlan()});
  document.querySelectorAll(".planRemove").forEach(b=>b.onclick=async()=>{if(await ui.confirm({title:`Remove ${b.dataset.sym} from the plan?`,message:"Its recorded buys are deleted too.",okText:"Remove",danger:true})){await planPost("remove",{symbol:b.dataset.sym});loadPlan()}});
  $("#planExposure").innerHTML=plan.exposure.length?`<table style="min-width:0"><thead><tr><th>Sector</th><th>Stocks</th><th>Invested</th><th>Planned max</th><th>% of plan</th></tr></thead><tbody>${plan.exposure.map(e=>`<tr><td>${esc(e.sector)}${e.concentrated?" ⚑":""}</td><td>${e.stocks}</td><td>${inr(e.invested)}</td><td>${inr(e.maxPlanned)}</td><td>${e.shareOfPlanned}%</td></tr>`).join("")}</tbody></table>`:"<p class='hint'>Add positions to see exposure. Sector comes from fetched fundamentals.</p>";
  $("#planStress").innerHTML=`<table style="min-width:0"><thead><tr><th>All stocks fall</th><th>Tranches triggered</th><th>Cash needed</th><th>vs reserve ${inr(plan.settings.cashReserve)}</th></tr></thead><tbody>${plan.stress.map(x=>`<tr><td>−${x.drop}%</td><td>${x.tranches}</td><td>${inr(x.cash)}</td><td class="${x.shortfall?"avoid":"buy"}">${x.shortfall?"short by "+inr(x.shortfall):"covered"}</td></tr>`).join("")}</tbody></table>`;
}
$("#planSettingsBtn").onclick=async()=>{try{await planPost("settings",{trancheSize:$("#planTranche").value,cashReserve:$("#planReserve").value});$("#planSettingsStatus").textContent="Saved.";loadPlan()}catch(e){$("#planSettingsStatus").textContent=e.message}};
$("#planLadderBtn").onclick=async()=>{try{await planPost("position",{symbol:$("#planStock").value,ladder:$("#planLadder").value});$("#planStatus").textContent="Ladder set.";loadPlan()}catch(e){$("#planStatus").textContent=e.message}};
$("#planBuyBtn").onclick=async()=>{try{await planPost("buy",{symbol:$("#planStock").value,price:$("#buyPrice").value,amount:$("#buyAmount").value,date:$("#buyDate").value});$("#planStatus").textContent="Buy recorded.";$("#buyPrice").value="";$("#buyAmount").value="";loadPlan()}catch(e){$("#planStatus").textContent=e.message}};
$("#addStockBtn").onclick=async()=>{
  try{const r=await fetch("/api/stocks/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company:$("#addCompany").value,symbol:$("#addSymbol").value})});const x=await r.json();if(!r.ok)throw new Error(x.message);
    await loadStocks();$("#manageStatus").textContent=`Added ${x.stock.company}. Click Refresh sources for its price, then fetch fundamentals.`;$("#addCompany").value="";$("#addSymbol").value="";fillStockSelects();render()}
  catch(e){$("#manageStatus").textContent=e.message}
};
$("#fixSymbolBtn").onclick=async()=>{
  const sym=$("#fixStock").value,st=stocks.find(s=>(s.marketSymbol||s.ticker)===sym);if(!st)return;
  try{const r=await fetch("/api/stocks/symbol",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:st.id,symbol:$("#fixSymbol").value})});const x=await r.json();if(!r.ok)throw new Error(x.message);
    await loadStocks();$("#manageStatus").textContent=`${st.company} is now ${x.stock.marketSymbol}. Click Refresh sources, then fetch its fundamentals.`;$("#fixSymbol").value="";fillStockSelects();render()}
  catch(e){$("#manageStatus").textContent=e.message}
};

// Themes: pick from the header. "indigo" (light) is the default; dark themes also set data-theme="dark".
const THEMES=[
  {id:"indigo",name:"Indigo ledger (default)",dark:false,sw:["#1f2460","#f3f4f9","#f2a33a"]},
  {id:"indigo-night",name:"Indigo night",dark:true,sw:["#0f1230","#141f33","#3a43b8"]},
  {id:"midnight",name:"Midnight amber",dark:true,skin:true,sw:["#0b0f16","#121826","#f2b53c"]},
  {id:"ivory",name:"Ivory & espresso",dark:false,skin:true,sw:["#3a2b1d","#f6f1e7","#c9772f"]},
  {id:"forest",name:"Forest",dark:false,skin:true,sw:["#173d2e","#f1f5f1","#d9a441"]},
  {id:"slate",name:"Slate (high contrast)",dark:true,skin:true,sw:["#0e1116","#161b22","#58a6ff"]},
  {id:"terminal",group:"redesign",name:"Terminal",desc:"Trading-terminal look: black, monospace, dense square tables",dark:true,skin:true,sw:["#000","#ffb000","#39ff7a"]},
  {id:"glass",group:"redesign",name:"Glass",desc:"Aurora background, frosted translucent cards, floating menu",dark:true,skin:true,sw:["#5b3df5","#00b4d8","#ff4fa3"]},
  {id:"editorial",group:"redesign",name:"Editorial",desc:"Financial-newspaper style: salmon paper, serif headlines, rules",dark:false,skin:true,sw:["#fff1e5","#1a1817","#990f3d"]},
  {id:"vibe",group:"redesign",name:"Vibe",desc:"Gen-Z neo-brutal: chunky outlines, hard shadows, lime + violet",dark:false,skin:true,sw:["#7c5cff","#f5f3ff","#c6f432"]},
  {id:"vibe-night",group:"redesign",name:"Vibe night",desc:"The Vibe redesign on a dark canvas",dark:true,skin:true,sw:["#0d0b14","#9f86ff","#c6f432"]}
];
function currentThemeId(){let id=null,chosen=null;try{id=localStorage.getItem("equity-skin");chosen=localStorage.getItem("equity-skin-chosen")}catch{}if(chosen&&THEMES.some(t=>t.id===id))return id;return "indigo"}
function applyTheme(id){
  const t=THEMES.find(x=>x.id===id)||THEMES[0],root=document.documentElement;
  if(t.dark)root.setAttribute("data-theme","dark");else root.removeAttribute("data-theme");
  if(t.skin)root.setAttribute("data-skin",t.id);else root.removeAttribute("data-skin");
  try{localStorage.setItem("equity-skin",t.id)}catch{}
  const btn=$("#themeToggle");if(btn)btn.innerHTML=`🎨 <span class="theme-name">${t.name.replace(" (default)","")}</span>`;
  document.querySelectorAll(".theme-menu [data-theme-id]").forEach(b=>b.setAttribute("aria-checked",String(b.dataset.themeId===t.id)));
}
function initTheme(){
  const btn=$("#themeToggle");if(!btn)return;
  const wrap=document.createElement("span");wrap.className="theme-wrap";btn.parentNode.insertBefore(wrap,btn);wrap.appendChild(btn);
  const menu=document.createElement("div");menu.className="theme-menu";menu.setAttribute("role","menu");menu.hidden=true;
  const item=t=>`<button type="button" role="menuitemradio" data-theme-id="${t.id}" aria-checked="false"><span class="swatch">${t.sw.map(c=>`<i style="background:${c}"></i>`).join("")}</span><span class="tm-txt"><b>${t.name}</b>${t.desc?`<small>${t.desc}</small>`:""}</span></button>`;
  menu.innerHTML=`<p class="tm-h">Colour themes</p>${THEMES.filter(t=>!t.group).map(item).join("")}<p class="tm-h">Full redesigns <small>new layout, type and shapes</small></p>${THEMES.filter(t=>t.group==="redesign").map(item).join("")}`;
  wrap.appendChild(menu);btn.setAttribute("aria-haspopup","menu");btn.setAttribute("aria-expanded","false");btn.title="Choose a theme";
  const close=()=>{menu.hidden=true;btn.setAttribute("aria-expanded","false")};
  btn.onclick=e=>{e.stopPropagation();menu.hidden=!menu.hidden;btn.setAttribute("aria-expanded",String(!menu.hidden));if(!menu.hidden)menu.querySelector('[aria-checked="true"]')?.focus()};
  menu.onclick=e=>{const b=e.target.closest("[data-theme-id]");if(b){try{localStorage.setItem("equity-skin-chosen","1")}catch{}applyTheme(b.dataset.themeId);close();btn.focus()}};
  document.addEventListener("click",e=>{if(!wrap.contains(e.target))close()});
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!menu.hidden){close();btn.focus()}});
  applyTheme(currentThemeId());
}
function setTheme(theme){applyTheme(theme==="dark"?"indigo-night":"indigo")}

// Header status: a plain line (not a button) saying the local server is running and when prices last updated.
function paintStatus(){fetch("/api/health").then(r=>r.json()).then(h=>{const el=$("#provider");const t=h.lastPriceRefreshAt?new Date(h.lastPriceRefreshAt).toLocaleTimeString("en-IN",{hour:"numeric",minute:"2-digit"}):null;el.className="status-line ok";el.innerHTML=`<i aria-hidden="true"></i>${t?`Prices updated ${t}`:"Server running"}`;el.title=`The local server is running. Prices refresh every 15 minutes while the NSE market is open${h.marketOpen?" (open now)":" (closed now)"}; use More → Refresh prices & news to refresh now.`}).catch(()=>{const el=$("#provider");el.className="status-line bad";el.innerHTML='<i aria-hidden="true"></i>Server not running';el.title="Start the app with npm start"})}
paintStatus();setInterval(paintStatus,60000);

(async function init(){
  initTheme();
  await loadStocks();
  await loadHistory();
  await loadPe();
  populatePrintStockSelect();
  render();
})();


// ---- Value picks: undervalued / fair screen + custom 10-stock wishlist ----
let customList=[];
const rowSym=r=>String(r.symbol||"").toUpperCase();
const symOfStock=s=>String(s.marketSymbol||s.ticker||"").toUpperCase();
async function openPicks(){
  await loadValuation();
  try{const r=await fetch("/api/custom-list");if(r.ok)customList=(await r.json()).symbols||[]}catch{}
  renderPicks();
}
function picksRow(r){
  const up=Number.isFinite(r.upsideToBase)?` <span class="${r.upsideToBase>=0?"buy":"avoid"}">(${r.upsideToBase>=0?"+":""}${Math.round(r.upsideToBase*100)}%)</span>`:"";
  return `<tr data-id="${r.id}"${r.stale?' style="opacity:.6"':""}><td><div class="company">${esc(r.company)}${capTag(r.cap)}</div><div class="ticker">${esc(r.symbol)}${r.marketCap?` · ₹${Math.round(r.marketCap).toLocaleString("en-IN")} Cr`:""}${r.sector?` · ${esc(r.sector)}`:""}</div></td><td>${money(r.price)}</td><td>${fmt(r.pe)}</td><td>${r.fairMultiple?`${fmt(r.fairMultiple)} <small>${esc(r.basis||"")}</small>`:"—"}</td><td>${gaugeHtml(r.ratio)}</td><td>${viewChip(r.view,r.confidence==="low"?" <small>(low conf.)</small>":"")}</td><td>${r.fairValue?money(r.fairValue.base)+up:"—"}</td><td class="range">${r.zoneLow?`${money(r.zoneLow)} – ${money(r.zoneHigh)}${r.floored?" ⚑":""}`:"—"}</td><td>${statusChip(r.status)}</td><td>${fmt(r.roce)}</td><td>${fmt(r.promoter)}</td><td class="kpi">${esc((r.reasons||[]).join(" "))}${r.flags?` <em>${esc(r.flags)}</em>`:""}</td><td>${r.ageDays===null||r.ageDays===undefined?"—":r.ageDays+"d"}${r.stale?" ⚠":""}</td></tr>`;
}
function renderPicks_(){
  if(!$("#picksView")||$("#picksView").hidden)return;
  const rows=valuation.rows||[];
  // Value screen
  const q=($("#pkSearch").value||"").toLowerCase(),views=$("#pkRich").checked?["Undervalued","Fair","Fair to rich"]:["Undervalued","Fair"];
  const picks=rows.filter(r=>views.includes(r.view)&&(!q||`${r.company} ${r.symbol}`.toLowerCase().includes(q))&&(!$("#pkZoneOnly").checked||["In zone","Below zone"].includes(r.status))&&(!$("#pkHigh").checked||r.confidence!=="low")&&($("#pkCap").value==="All"||r.cap===$("#pkCap").value)).sort((x,y)=>(x.ratio??9)-(y.ratio??9));
  const withData=rows.filter(r=>r.view&&r.view!=="No fundamentals").length;
  $("#pkCount").textContent=`${picks.length} match · ${withData} of ${rows.length} stocks have fundamentals`;
  $("#pkRows").innerHTML=picks.length?picks.map(picksRow).join(""):`<tr><td colspan="13" style="text-align:center;padding:24px;color:var(--muted)">${withData?"No stock matches these filters right now.":"No fundamentals yet. Open the Valuation tab and Fetch data first (5 stocks at a time)."}</td></tr>`;
  // Custom list
  const bySym=new Map(rows.map(r=>[rowSym(r),r]));
  const chosen=customList.map(sym=>bySym.get(sym)||{symbol:sym,company:sym,view:"No fundamentals",status:"Fetch needed",reasons:[]});
  $("#pkMineCount").textContent=`${customList.length}/10 selected`;
  $("#pkSlots").innerHTML=customList.length?customList.map(sym=>{const r=bySym.get(sym);return `<span draggable="true" class="account-tag pkChip" data-sym="${esc(sym)}" style="padding:6px 10px;font-size:13px;cursor:grab">${esc(r?.company||sym)} <button type="button" class="ghost pkRemove" data-sym="${esc(sym)}" style="padding:0 6px" title="Remove">✕</button></span>`}).join(""):`<span class="hint">Drop stocks here</span>`;
  $("#pkMineRows").innerHTML=chosen.length?chosen.map(picksRow).join(""):`<tr><td colspan="13" style="text-align:center;padding:24px;color:var(--muted)">Your list is empty.</td></tr>`;
  const ps=($("#pkPoolSearch").value||"").toLowerCase();
  $("#pkPool").innerHTML=stocks.filter(s=>!customList.includes(symOfStock(s))&&(!ps||`${s.company} ${s.ticker}`.toLowerCase().includes(ps))).sort((x,y)=>x.company.localeCompare(y.company)).map(s=>{const r=bySym.get(symOfStock(s));return `<div draggable="true" class="pkItem" data-sym="${esc(symOfStock(s))}" style="display:flex;justify-content:space-between;gap:8px;padding:6px 8px;border-bottom:1px solid var(--line,#dde3ee);cursor:grab"><span>${esc(s.company)} <small class="ticker">${esc(symOfStock(s))}</small></span><span><small class="${viewTone(r?.view)}">${esc(r?.view&&r.view!=="No fundamentals"?r.view:"")}</small> <button type="button" class="ghost pkAdd" data-sym="${esc(symOfStock(s))}" title="Add">+</button></span></div>`}).join("");
  document.querySelectorAll(".pkAdd").forEach(b=>b.onclick=e=>{e.stopPropagation();addCustom(b.dataset.sym)});
  document.querySelectorAll(".pkRemove").forEach(b=>b.onclick=()=>removeCustom(b.dataset.sym));
  document.querySelectorAll(".pkItem,.pkChip").forEach(el=>el.ondragstart=e=>{e.dataTransfer.setData("text/plain",el.dataset.sym);e.dataTransfer.setData("source",el.classList.contains("pkChip")?"chip":"pool")});
}
async function saveCustom(){try{const r=await fetch("/api/custom-list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({symbols:customList})});const x=await r.json();if(!r.ok)throw new Error(x.message);customList=x.symbols}catch(e){$("#pkFetchStatus").textContent=`Could not save list: ${e.message}`}renderPicks()}
function addCustom(sym){sym=String(sym||"").toUpperCase();if(!sym||customList.includes(sym))return;if(customList.length>=10){$("#pkFetchStatus").textContent="Your list is full (10). Remove one first.";return}customList.push(sym);$("#pkFetchStatus").textContent="";saveCustom()}
function removeCustom(sym){customList=customList.filter(x=>x!==sym);saveCustom()}
(function wirePicks(){
  const slots=$("#pkSlots"),pool=$("#pkPool");
  slots.ondragover=e=>{e.preventDefault();slots.style.background="rgba(80,140,255,.08)"};
  slots.ondragleave=()=>{slots.style.background=""};
  slots.ondrop=e=>{e.preventDefault();slots.style.background="";addCustom(e.dataTransfer.getData("text/plain"))};
  pool.ondragover=e=>e.preventDefault();
  pool.ondrop=e=>{e.preventDefault();if(e.dataTransfer.getData("source")==="chip")removeCustom(e.dataTransfer.getData("text/plain"))};
  for(const id of ["#pkSearch","#pkPoolSearch"])$(id).oninput=renderPicks;
  for(const id of ["#pkZoneOnly","#pkRich","#pkHigh","#pkCap"])$(id).onchange=renderPicks;
  $("#pkTabValue").onclick=()=>{$("#pkValue").hidden=false;$("#pkMine").hidden=true;$("#pkTabValue").classList.add("active");$("#pkTabMine").classList.remove("active")};
  $("#pkTabMine").onclick=()=>{$("#pkValue").hidden=true;$("#pkMine").hidden=false;$("#pkTabMine").classList.add("active");$("#pkTabValue").classList.remove("active")};
  $("#pkClear").onclick=()=>{customList=[];saveCustom()};
  $("#pkFetch").onclick=async()=>{
    const ids=customList.map(sym=>stocks.find(s=>symOfStock(s)===sym)?.id).filter(v=>v!==undefined);
    if(!ids.length){$("#pkFetchStatus").textContent="Add stocks first.";return}
    await fetchFundamentals(ids,true,{status:$("#pkFetchStatus"),btn:$("#pkFetch"),source:$("#pkSource")});
    await loadValuation();renderPicks();loadPe().then(render);
  };
})();


// ---- Growth picks: durable compounders screened from the same fundamentals ----
const clamp01=x=>Math.max(0,Math.min(1,x));
function growthScore(r){
  const fin=r.profile==="financial";
  const sales=r.salesCagr3,profit=r.profitCagr3,quality=fin?r.roe:r.roce;
  if(!Number.isFinite(r.ratio)||!Number.isFinite(profit)||!Number.isFinite(quality)||(!fin&&!Number.isFinite(sales)))return null;
  const g=fin?profit:Math.min(sales,profit);
  const levered=!fin&&Number.isFinite(r.borrowings)&&Number.isFinite(r.reserves)&&r.reserves>0&&r.borrowings>r.reserves;
  const cfo=r.cfoToProfit3,sold=Number.isFinite(r.promoterChange3y)&&r.promoterChange3y<-5;
  const cashFail=!fin&&(r.fcfNegative===1||(Number.isFinite(cfo)&&cfo<0.6)); // lenders: negative operating cash flow is normal
  if((!fin&&sales<12)||profit<15||quality<(fin?13:15)||levered||cashFail||sold)return null;
  const growthPts=15+clamp01((g-12)/18)*20;
  const qualityPts=10+clamp01((quality-15)/15)*15;
  const cashPts=(fin||!Number.isFinite(r.borrowings)?4:8)+(!Number.isFinite(cfo)?3:cfo>=0.8?6:3)+(r.fcfNegative===0?6:3);
  const promPts=!Number.isFinite(r.promoter)?4:r.promoter>=50?10:r.promoter>=35?7:4;
  const valPts=r.ratio<0.9?10:r.ratio<1.1?8:r.ratio<1.3?5:r.ratio<1.6?2:0;
  const notes=[];
  if(g>=20)notes.push(`Strong growth (${fmt(g,0)}%+ on both sales and profit)`);
  if(quality>=22)notes.push(`High ${fin?"ROE":"ROCE"} ${fmt(quality,0)}%`);
  if(cfo>=0.8)notes.push("Profits convert to cash");
  if(!fin&&Number.isFinite(r.borrowings)&&Number.isFinite(r.reserves)&&r.borrowings<r.reserves*0.3)notes.push("Low debt");
  if(r.promoter>=50)notes.push("High promoter holding");
  if(r.ratio>=1.3)notes.push(`Priced at ${r.ratio}× fair multiple: wait for a better entry`);
  if(!Number.isFinite(cfo))notes.push("Cash conversion unknown");
  if(r.stale)notes.push("Fundamentals stale");
  return{score:Math.round(growthPts+qualityPts+cashPts+promPts+valPts),notes};
}
function renderGrowth_(){
  if(!$("#growthView")||$("#growthView").hidden)return;
  const rows=valuation.rows||[];
  const q=($("#gpSearch").value||"").toLowerCase();
  const withData=rows.filter(r=>r.view&&r.view!=="No fundamentals").length;
  const scored=rows.map(r=>({r,g:growthScore(r)})).filter(x=>x.g);
  const picks=scored.filter(({r})=>(!q||`${r.company} ${r.symbol}`.toLowerCase().includes(q))&&($("#gpCap").value==="All"||r.cap===$("#gpCap").value)&&(!$("#gpNotRich").checked||!["Rich","Very rich"].includes(r.view))&&(!$("#gpZoneOnly").checked||["In zone","Below zone"].includes(r.status))).sort((a,b)=>b.g.score-a.g.score);
  $("#gpCount").textContent=`${picks.length} match · ${scored.length} pass the gates · ${withData} of ${rows.length} stocks have fundamentals`;
  $("#gpRows").innerHTML=picks.length?picks.map(({r,g},i)=>`<tr data-id="${r.id}"${r.stale?' style="opacity:.6"':""}><td>${i+1}</td><td><div class="company">${esc(r.company)}${capTag(r.cap)}</div><div class="ticker">${esc(r.symbol)}${r.marketCap?` · ₹${Math.round(r.marketCap).toLocaleString("en-IN")} Cr`:""}${r.sector?` · ${esc(r.sector)}`:""}</div></td><td><strong class="${g.score>=75?"buy":g.score>=60?"wait":""}">${g.score}</strong></td><td>${money(r.price)}</td><td>${fmt(r.salesCagr3)}</td><td>${fmt(r.profitCagr3)}</td><td>${r.profile==="financial"?`ROE ${fmt(r.roe)}`:fmt(r.roce)}</td><td>${Number.isFinite(r.cfoToProfit3)?fmt(r.cfoToProfit3,2)+"×":"—"}</td><td>${fmt(r.promoter)}</td><td>${viewChip(r.view)}${gaugeHtml(r.ratio)}</td><td class="range">${r.zoneLow?`${money(r.zoneLow)} – ${money(r.zoneHigh)}${r.floored?" ⚑":""}`:"—"}</td><td>${statusChip(r.status)}</td><td class="kpi">${esc(g.notes.join(". "))}</td><td>${r.ageDays===null||r.ageDays===undefined?"—":r.ageDays+"d"}${r.stale?" ⚠":""}</td></tr>`).join(""):`<tr><td colspan="14" style="text-align:center;padding:24px;color:var(--muted)">${withData?"No stock matches these filters right now.":"No fundamentals yet. Open the Valuation tab and Fetch data first."}</td></tr>`;
}
for(const id of ["#gpSearch"])$(id).oninput=renderGrowth;
for(const id of ["#gpCap","#gpNotRich","#gpZoneOnly"])$(id).onchange=renderGrowth;


// ---- Refresh all: background job on the server, polled here ----
let jobTimer=null;
async function pollJob(){
  try{
    const j=await (await fetch("/api/fundamentals/job")).json();
    const st=$("#valFetchStatus");
    if(j.running){
      $("#valAllBtn").disabled=true;$("#valFetchBtn").disabled=true;$("#valAllCancel").hidden=false;
      st.textContent=`Refreshing ${j.done}/${j.total}${j.current?` · now ${j.current}`:""} · ${j.saved} saved, ${j.failed.length} failed`;
      loadValuation().then(renderValuation);
      jobTimer=setTimeout(pollJob,3000);
    }else{
      $("#valAllBtn").disabled=false;$("#valFetchBtn").disabled=false;$("#valAllCancel").hidden=true;
      if(j.startedAt){st.textContent=`${j.note} ${j.failed.length?"Failed: "+j.failed.slice(0,5).map(f=>`${f.company} (${String(f.error).slice(0,90)})`).join(" | ")+(j.failed.length>5?` … +${j.failed.length-5} more`:""):""}`;await loadValuation();renderValuation();loadPe().then(render)}
    }
  }catch{jobTimer=setTimeout(pollJob,5000)}
}
$("#valAllBtn").onclick=async()=>{
  const force=$("#valAllForce").checked;
  if(force&&!(await ui.confirm({title:"Re-fetch every stock?",message:"Stocks fetched in the last 7 days are fetched again. This takes several minutes.",okText:"Re-fetch all",icon:"🔄"})))return;
  const r=await fetch("/api/fundamentals/refresh-all",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({force,source:$("#valSource").value})});
  const x=await r.json();if(!r.ok&&r.status!==409){$("#valFetchStatus").textContent=x.message||"Could not start.";return}
  clearTimeout(jobTimer);pollJob();
};
$("#valAllCancel").onclick=()=>fetch("/api/fundamentals/job/cancel",{method:"POST"});
pollJob();


// ---- Quick add: symbol -> watchlist -> fetch valuation ----
$("#qaBtn").onclick=async()=>{
  const st=$("#qaStatus"),btn=$("#qaBtn"),symbol=$("#qaSymbol").value.trim().toUpperCase();
  if(!symbol){st.textContent="Enter the NSE symbol first.";return}
  btn.disabled=true;st.textContent=`Adding ${symbol}…`;
  try{
    const r=await fetch("/api/stocks/add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({company:$("#qaName").value,symbol})});
    const x=await r.json();
    let id;
    if(r.status===409){id=stocks.find(s=>(s.marketSymbol||s.ticker||"").toUpperCase()===symbol)?.id;st.textContent=`${symbol} is already in the watchlist; refreshing its data…`}
    else if(!r.ok)throw new Error(x.message);
    else{id=x.stock.id;await loadStocks()}
    if(id===undefined)throw new Error("Could not find the stock after adding it.");
    await fetchFundamentals([id],true,{status:st,btn:$("#qaBtn"),source:$("#valSource")});
    await loadValuation();await loadStocks();render();renderValuation();renderPicks();loadPe().then(render);
    $("#qaSymbol").value="";$("#qaName").value="";
  }catch(e){st.textContent=`Failed: ${e.message}`}
  finally{btn.disabled=false}
};


// ---- Named watchlists: every screen below only shows the stocks in the selected list. ----
// `stocks` (and valuation.rows) always hold the whole tracked pool, because publishWatchlist() saves `stocks` back to the server;
// each draw function therefore sees a filtered copy for the duration of the call only.
let activeListSymbols=null; // Set of symbols, or null = show everything
const symOfAny=x=>String(x.marketSymbol||x.ticker||x.symbol||"").toUpperCase();
function scoped(fn){
  if(!activeListSymbols)return fn();
  const fullStocks=stocks;let fullRows;try{fullRows=valuation.rows}catch{fullRows=undefined}
  stocks=fullStocks.filter(s=>activeListSymbols.has(symOfAny(s)));
  try{if(fullRows)valuation.rows=fullRows.filter(r=>activeListSymbols.has(symOfAny(r)))}catch{}
  try{return fn()}finally{stocks=fullStocks;try{if(fullRows)valuation.rows=fullRows}catch{}}
}
function render(){return scoped(render_)}
function renderDashboard(){return scoped(renderDashboard_)}
function populatePrintStockSelect(){return scoped(populatePrintStockSelect_)}
function renderPrint(){return scoped(renderPrint_)}
function renderAdvisorList(){return scoped(renderAdvisorList_)}
function renderValuation(){return scoped(renderValuation_)}
function renderPicks(){return scoped(renderPicks_)}
function renderGrowth(){return scoped(renderGrowth_)}

// Sector P/E: official value (Screener peers / NSE) when fetched; otherwise "~" estimate from the stocks you track in that sector.
function sectorPeText(r){if(Number.isFinite(r.sectorPe))return `${fmt(r.sectorPe)}${r.sectorPeSource?` <small title="${esc(r.sectorPeSource)}">ⓘ</small>`:""}`;if(Number.isFinite(r.sectorPeEst))return `<span title="Estimate: median P/E of ${r.sectorPeEstN} ${esc(r.sector||"")} stocks you track. Refresh fundamentals to get Screener's industry P/E.">~${fmt(r.sectorPeEst)}</span>`;return "—"}
