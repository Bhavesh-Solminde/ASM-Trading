export type MarketStatus = "open" | "closed" | "unavailable";
const crypto = new Set(["BTCUSD","BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","ADAUSDT","LTCUSDT","LINKUSDT","DOTUSDT"]);
const indices = new Set(["NIFTY50","BANKNIFTY","FINNIFTY","NIFTYIT","SENSEX","NIFTYMIDCAP100"]);
const forex = new Set(["EURUSD","GBPUSD","USDJPY","USDCHF","AUDUSD","USDCAD","NZDUSD","EURGBP","EURJPY","GBPJPY"]);
function clock(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {timeZone,weekday:"short",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(now);
  const get = (type:string) => parts.find(p=>p.type===type)!.value;
  return { day:get("weekday"), minute:Number(get("hour"))*60+Number(get("minute")) };
}
/** Regular sessions; fresh provider quotes are additionally required for holidays/outages. */
export function marketSessionOpen(symbol:string, now=new Date()): boolean {
  if(crypto.has(symbol)) return true;
  if(indices.has(symbol)) {
    const {day,minute}=clock(now,"Asia/Kolkata");
    return day!=="Sat" && day!=="Sun" && minute>=555 && minute<930;
  }
  const commodity = ["XAUUSD", "XAGUSD", "WTI", "BRENT"].includes(symbol);
  if(forex.has(symbol)||commodity) {
    const {day,minute}=clock(now,"America/New_York");
    const opening=commodity?1080:1020;
    if(day==="Sat" || (day==="Fri"&&minute>=1020) || (day==="Sun"&&minute<opening)) return false;
    return !commodity || minute<1020 || minute>=1080;
  }
  return false;
}
export function marketStatus(symbol:string, quoteTs?:number, nowMs=Date.now()):MarketStatus {
  if(!marketSessionOpen(symbol,new Date(nowMs))) return "closed";
  const age=quoteTs===undefined?Infinity:nowMs/1000-quoteTs;
  return age>=-1 && age<=3 ? "open" : "unavailable";
}
