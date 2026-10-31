export type MarketingAsset = {
  symbol: string;
  name: string;
  price: number;
  precision: number;
  changePct: number;
  leverage: number;
  kind: "forex" | "crypto" | "index";
};

// Illustrative marketing ticker — mirrors the actual 18-asset catalogue so
// the landing page reflects what a visitor can trade.
export const marketingAssets: MarketingAsset[] = [
  { symbol: "EURUSD", name: "EUR/USD", price: 1.08421, precision: 5, changePct: 0.24, leverage: 100, kind: "forex" },
  { symbol: "GBPUSD", name: "GBP/USD", price: 1.27183, precision: 5, changePct: -0.11, leverage: 100, kind: "forex" },
  { symbol: "USDJPY", name: "USD/JPY", price: 155.822, precision: 3, changePct: 0.38, leverage: 100, kind: "forex" },
  { symbol: "AUDUSD", name: "AUD/USD", price: 0.66412, precision: 5, changePct: 0.19, leverage: 100, kind: "forex" },
  { symbol: "BTCUSDT", name: "BTC/USDT", price: 95_210.12, precision: 2, changePct: 1.42, leverage: 100, kind: "crypto" },
  { symbol: "ETHUSDT", name: "ETH/USDT", price: 3_512.84, precision: 2, changePct: -0.63, leverage: 100, kind: "crypto" },
  { symbol: "SOLUSDT", name: "SOL/USDT", price: 172.44, precision: 2, changePct: 2.11, leverage: 100, kind: "crypto" },
  { symbol: "DOGEUSDT", name: "DOGE/USDT", price: 0.29841, precision: 5, changePct: 0.85, leverage: 100, kind: "crypto" },
  { symbol: "NIFTY50", name: "NIFTY 50", price: 24_012.6, precision: 2, changePct: 0.18, leverage: 100, kind: "index" },
  { symbol: "BANKNIFTY", name: "BANK NIFTY", price: 51_984.05, precision: 2, changePct: -0.29, leverage: 100, kind: "index" },
  { symbol: "SENSEX", name: "SENSEX", price: 79_001.44, precision: 2, changePct: 0.42, leverage: 100, kind: "index" },
  { symbol: "FINNIFTY", name: "FINNIFTY", price: 24_505.02, precision: 2, changePct: 0.48, leverage: 100, kind: "index" },
];

export const featureBullets = [
  {
    title: "Real-time market prices",
    body: "Live price feeds aggregated from multiple liquidity providers — no synthetic or delayed quotes.",
  },
  {
    title: "Stop-loss & take-profit",
    body: "Set your SL/TP on every CFD position. Control your risk before you enter, close anytime.",
  },
  {
    title: "Up to 100x leverage",
    body: "Trade forex, crypto and India indices with leverage — amplify your positions responsibly.",
  },
  {
    title: "18 instruments",
    body: "Six forex pairs, six crypto pairs, and six major India indices — NIFTY 50, SENSEX, BANK NIFTY and more.",
  },
  {
    title: "Instant deposits",
    body: "UPI, bank transfer, and crypto — funded in seconds, not days.",
  },
  {
    title: "Audited trade engine",
    body: "Every entry, exit and settlement tick is recorded on an audited ledger. Transparent and verifiable.",
  },
] as const;

export const howSteps = [
  { n: "01", title: "Open an account", body: "30 seconds. Email and a password. Demo starts pre-funded with ₹10,00,000 virtual balance." },
  { n: "02", title: "Fund when ready", body: "From ₹1,000. UPI, bank transfer or crypto. Nothing locked — withdraw anytime." },
  { n: "03", title: "Open a position", body: "Pick an instrument, set your stop-loss and take-profit, choose your leverage and go long or short." },
] as const;

export const testimonials = [
  {
    name: "Aditi R.",
    role: "Part-time trader, Mumbai",
    quote: "Cleanest UI I've used. The 30-second expiry with the pinned Up/Down actually works on a phone.",
  },
  {
    name: "Marcus O.",
    role: "Prop desk analyst, Lagos",
    quote: "Started on the demo to test my scalping ideas on the India index charts. Moved to live once I saw the settlement matched my model.",
  },
  {
    name: "Sofia K.",
    role: "Software engineer, Warsaw",
    quote: "Withdrawal hit my account the same day. That alone puts them ahead of the last three platforms I tried.",
  },
] as const;

export const faqs = [
  {
    q: "Is a demo account really free?",
    a: "Yes. Sign up with an email, get ₹10,00,000 in virtual funds, no card, no verification. Switch to a live account any time from the account switcher.",
  },
  {
    q: "What is CFD trading?",
    a: "CFD (Contract for Difference) trading lets you speculate on price movements of forex, crypto and stock indices without owning the underlying asset. You can go long (buy) or short (sell) and use leverage to amplify your position. Your profit or loss is the difference between your entry and exit price.",
  },
  {
    q: "What are stop-loss and take-profit?",
    a: "Stop-loss (SL) automatically closes your position if the price moves against you beyond a level you set, limiting your downside. Take-profit (TP) closes your position once your target profit is reached. Both are built into every trade on IndianxTrade — set them before you enter.",
  },
  {
    q: "What is the minimum deposit?",
    a: "₹1,000 on UPI and bank transfer, ₹2,000 on crypto. The minimum position size on a live account is ₹100.",
  },
  {
    q: "How fast are withdrawals?",
    a: "Bank and UPI withdrawals typically settle within one business day. Crypto withdrawals are usually confirmed within an hour once approved.",
  },
  {
    q: "Which markets can I trade?",
    a: "Six major forex pairs (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD), six top crypto pairs (BTC, ETH, SOL, BNB, XRP, DOGE against USDT), and six India indices (NIFTY 50, BANK NIFTY, FINNIFTY, SENSEX, NIFTY IT, NIFTY MIDCAP 100). All CFD instruments use real-time prices from multiple liquidity providers.",
  },
  {
    q: "Is IndianxTrade regulated?",
    a: "IndianxTrade is a SEBI-registered trading platform. We follow strict compliance requirements including KYC verification, audited trade settlement, and segregated client funds. Our real-time price feeds are sourced from regulated liquidity providers.",
  },
  {
    q: "How do I know the price is fair?",
    a: "All prices on IndianxTrade are real market prices aggregated from multiple regulated liquidity providers. Every trade's entry, exit and settlement tick is recorded on an audited ledger you can inspect from your trade history.",
  },
  {
    q: "How is my profit or loss calculated?",
    a: "Your P&L on a CFD position is calculated as the price difference between entry and exit, multiplied by your position size and leverage. A long position profits when the price rises; a short position profits when it falls. Your maximum loss is limited by your stop-loss level or your margin.",
  },
  {
    q: "Do you charge commissions?",
    a: "No per-trade commission. Revenue comes from the spread — the small difference between bid and ask price. Deposits and withdrawals are free on most payment rails.",
  },
] as const;
