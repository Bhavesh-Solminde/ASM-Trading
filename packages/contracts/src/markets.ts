/** Supported markets, aligned with the verified 30-market bot catalogue. */
export const TRADABLE_MARKETS = [
  {
    "symbol": "BTCUSDT",
    "displayName": "BTC/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "ETHUSDT",
    "displayName": "ETH/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "BNBUSDT",
    "displayName": "BNB/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "SOLUSDT",
    "displayName": "SOL/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "XRPUSDT",
    "displayName": "XRP/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "DOGEUSDT",
    "displayName": "DOGE/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "ADAUSDT",
    "displayName": "ADA/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "LTCUSDT",
    "displayName": "LTC/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "LINKUSDT",
    "displayName": "LINK/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "DOTUSDT",
    "displayName": "DOT/USDT",
    "assetClass": "CRYPTO"
  },
  {
    "symbol": "EURUSD",
    "displayName": "EUR/USD",
    "assetClass": "FOREX"
  },
  {
    "symbol": "GBPUSD",
    "displayName": "GBP/USD",
    "assetClass": "FOREX"
  },
  {
    "symbol": "USDJPY",
    "displayName": "USD/JPY",
    "assetClass": "FOREX"
  },
  {
    "symbol": "USDCHF",
    "displayName": "USD/CHF",
    "assetClass": "FOREX"
  },
  {
    "symbol": "AUDUSD",
    "displayName": "AUD/USD",
    "assetClass": "FOREX"
  },
  {
    "symbol": "USDCAD",
    "displayName": "USD/CAD",
    "assetClass": "FOREX"
  },
  {
    "symbol": "NZDUSD",
    "displayName": "NZD/USD",
    "assetClass": "FOREX"
  },
  {
    "symbol": "EURGBP",
    "displayName": "EUR/GBP",
    "assetClass": "FOREX"
  },
  {
    "symbol": "EURJPY",
    "displayName": "EUR/JPY",
    "assetClass": "FOREX"
  },
  {
    "symbol": "GBPJPY",
    "displayName": "GBP/JPY",
    "assetClass": "FOREX"
  },
  {
    "symbol": "NIFTY50",
    "displayName": "NIFTY 50",
    "assetClass": "INDEX"
  },
  {
    "symbol": "BANKNIFTY",
    "displayName": "BANK NIFTY",
    "assetClass": "INDEX"
  },
  {
    "symbol": "FINNIFTY",
    "displayName": "FINNIFTY",
    "assetClass": "INDEX"
  },
  {
    "symbol": "NIFTYIT",
    "displayName": "NIFTY IT",
    "assetClass": "INDEX"
  },
  {
    "symbol": "NIFTYMIDCAP100",
    "displayName": "NIFTY MIDCAP 100",
    "assetClass": "INDEX"
  },
  {
    "symbol": "SENSEX",
    "displayName": "SENSEX",
    "assetClass": "INDEX"
  },
  {
    "symbol": "XAUUSD",
    "displayName": "Gold XAU/USD",
    "assetClass": "COMMODITY"
  },
  {
    "symbol": "XAGUSD",
    "displayName": "Silver XAG/USD",
    "assetClass": "COMMODITY"
  },
  {
    "symbol": "WTI",
    "displayName": "WTI crude futures",
    "assetClass": "COMMODITY"
  },
  {
    "symbol": "BRENT",
    "displayName": "Brent crude futures",
    "assetClass": "COMMODITY"
  }
] as const;
export const MARKET_COUNT = TRADABLE_MARKETS.length;
