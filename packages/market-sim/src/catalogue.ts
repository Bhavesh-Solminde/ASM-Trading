export type MarketGroup = "Crypto" | "Forex" | "India" | "Commodities";
export interface MarketSpec { symbol: string; name: string; group: MarketGroup; yahoo: string; base: number; minuteBps: number; precision: number; }
const row = (symbol: string, name: string, group: MarketGroup, yahoo: string, base: number, minuteBps: number, precision: number): MarketSpec => ({ symbol, name, group, yahoo, base, minuteBps, precision });
export const MULTI_MARKETS: MarketSpec[] = [
  row("BTCUSDT","BTC/USDT","Crypto","BTC-USD",80000,7,2), row("ETHUSDT","ETH/USDT","Crypto","ETH-USD",2500,10,2),
  row("BNBUSDT","BNB/USDT","Crypto","BNB-USD",700,8,3), row("SOLUSDT","SOL/USDT","Crypto","SOL-USD",150,13,3),
  row("XRPUSDT","XRP/USDT","Crypto","XRP-USD",1.5,12,5), row("DOGEUSDT","DOGE/USDT","Crypto","DOGE-USD",.15,15,6),
  row("ADAUSDT","ADA/USDT","Crypto","ADA-USD",.5,13,6), row("LTCUSDT","LTC/USDT","Crypto","LTC-USD",80,11,4),
  row("LINKUSDT","LINK/USDT","Crypto","LINK-USD",15,12,4), row("DOTUSDT","DOT/USDT","Crypto","DOT-USD",3,14,5),
  row("EURUSD","EUR/USD","Forex","EURUSD=X",1.12,1.1,6), row("GBPUSD","GBP/USD","Forex","GBPUSD=X",1.34,1.4,6),
  row("USDJPY","USD/JPY","Forex","JPY=X",158,1.6,4), row("USDCHF","USD/CHF","Forex","CHF=X",.81,1.3,6),
  row("AUDUSD","AUD/USD","Forex","AUDUSD=X",.7,1.5,6), row("USDCAD","USD/CAD","Forex","CAD=X",1.39,1.2,6),
  row("NZDUSD","NZD/USD","Forex","NZDUSD=X",.56,1.6,6), row("EURGBP","EUR/GBP","Forex","EURGBP=X",.83,.9,6),
  row("EURJPY","EUR/JPY","Forex","EURJPY=X",177,1.7,4), row("GBPJPY","GBP/JPY","Forex","GBPJPY=X",213,2,4),
  row("NIFTY50","NIFTY 50","India","^NSEI",24000,2.3,2), row("BANKNIFTY","BANK NIFTY","India","^NSEBANK",52000,3.2,2),
  row("FINNIFTY","FINNIFTY","India","NIFTY_FIN_SERVICE.NS",25000,3,2), row("NIFTYIT","NIFTY IT","India","^CNXIT",32000,4.1,2),
  row("NIFTYMIDCAP100","NIFTY MIDCAP 100","India","NIFTY_MIDCAP_100.NS",57000,3.3,2), row("SENSEX","SENSEX","India","^BSESN",79000,2.5,2),
  row("XAUUSD","Gold · XAU/USD","Commodities","GC=F",4000,3.8,3), row("XAGUSD","Silver · XAG/USD","Commodities","SI=F",50,6,4),
  row("WTI","WTI crude futures","Commodities","CL=F",65,5,3), row("BRENT","Brent crude futures","Commodities","BZ=F",70,4.8,3),
];
export interface ReferenceQuote {
  symbol: string; price: number; quoteTime: number; receivedAt: number; source: string; url: string;
  kind: "PUBLIC_QUOTE" | "PUBLIC_DELAYED" | "FUTURES_PROXY" | "ILLUSTRATIVE";
  minuteBps: number; calibration: string; sampleBars: number; session: "OPEN" | "CLOSED" | "UNKNOWN";
}
export function indiaOpen(time: number): boolean {
  const d = new Date(time + 330 * 60000), minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  return d.getUTCDay() > 0 && d.getUTCDay() < 6 && minute >= 555 && minute < 930;
}
