export type MarketingAsset = {
  symbol: string;
  name: string;
  price: number;
  precision: number;
  changePct: number;
  payoutPct: number;
  kind: "forex" | "crypto" | "index";
};

// Illustrative marketing ticker — mirrors the actual 18-asset catalogue so
// the landing page reflects what a visitor can trade.
export const marketingAssets: MarketingAsset[] = [
  { symbol: "EURUSD", name: "EUR/USD", price: 1.08421, precision: 5, changePct: 0.24, payoutPct: 87, kind: "forex" },
  { symbol: "GBPUSD", name: "GBP/USD", price: 1.27183, precision: 5, changePct: -0.11, payoutPct: 85, kind: "forex" },
  { symbol: "USDJPY", name: "USD/JPY", price: 155.822, precision: 3, changePct: 0.38, payoutPct: 86, kind: "forex" },
  { symbol: "AUDUSD", name: "AUD/USD", price: 0.66412, precision: 5, changePct: 0.19, payoutPct: 86, kind: "forex" },
  { symbol: "BTCUSDT", name: "BTC/USDT", price: 95_210.12, precision: 2, changePct: 1.42, payoutPct: 82, kind: "crypto" },
  { symbol: "ETHUSDT", name: "ETH/USDT", price: 3_512.84, precision: 2, changePct: -0.63, payoutPct: 80, kind: "crypto" },
  { symbol: "SOLUSDT", name: "SOL/USDT", price: 172.44, precision: 2, changePct: 2.11, payoutPct: 78, kind: "crypto" },
  { symbol: "DOGEUSDT", name: "DOGE/USDT", price: 0.29841, precision: 5, changePct: 0.85, payoutPct: 80, kind: "crypto" },
  { symbol: "NIFTY50", name: "NIFTY 50", price: 24_012.6, precision: 2, changePct: 0.18, payoutPct: 88, kind: "index" },
  { symbol: "BANKNIFTY", name: "BANK NIFTY", price: 51_984.05, precision: 2, changePct: -0.29, payoutPct: 88, kind: "index" },
  { symbol: "SENSEX", name: "SENSEX", price: 79_001.44, precision: 2, changePct: 0.42, payoutPct: 88, kind: "index" },
  { symbol: "FINNIFTY", name: "FINNIFTY", price: 24_505.02, precision: 2, changePct: 0.48, payoutPct: 88, kind: "index" },
];

export const featureBullets = [
  {
    title: "Trade from $1",
    body: "Small stakes, real market. No card required to try the demo.",
  },
  {
    title: "Up to 95% payout",
    body: "Fixed return per winning trade — you know your risk before you click.",
  },
  {
    title: "18 markets",
    body: "Six forex pairs, six crypto pairs, and the six major India indices — every one live 24/7.",
  },
  {
    title: "Fast expiries",
    body: "From 15 seconds to end-of-day. Pinned Up/Down bar on mobile.",
  },
  {
    title: "Instant deposits",
    body: "Cards, bank transfer, and crypto — funded in seconds, not days.",
  },
  {
    title: "Real settlement engine",
    body: "Live matching, audited ledger, no re-quote on close. Built to be honest.",
  },
] as const;

export const howSteps = [
  { n: "01", title: "Open an account", body: "30 seconds. Email and a password. Demo starts pre-funded with $10,000." },
  { n: "02", title: "Fund when ready", body: "From $10. Card, bank or crypto. Nothing locked — withdraw anytime." },
  { n: "03", title: "Pick UP or DOWN", body: "Choose a duration, click a direction. Result settles on the tick." },
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
    a: "Yes. Sign up with an email, get $10,000 in demo funds, no card, no verification. Switch to a live account any time from the account switcher.",
  },
  {
    q: "What is the minimum deposit?",
    a: "$10 on card and bank transfer, $20 on crypto. The minimum trade size on a live account is $1.",
  },
  {
    q: "How fast are withdrawals?",
    a: "Card and bank withdrawals typically settle within one business day. Crypto withdrawals are usually confirmed within an hour once approved.",
  },
  {
    q: "Which markets can I trade?",
    a: "Six major forex pairs (EUR/USD, GBP/USD, USD/JPY, USD/CHF, AUD/USD, USD/CAD), six top crypto pairs (BTC, ETH, SOL, BNB, XRP, DOGE against USDT), and six India indices (NIFTY 50, BANK NIFTY, FINNIFTY, SENSEX, NIFTY IT, NIFTY MIDCAP 100). Every market is live 24/7 except the India indices, which pause overnight to mirror local market hours. Payouts are quoted per-asset and shown before you place a trade.",
  },
  {
    q: "Is ASM Trade available in my country?",
    a: "We support most jurisdictions but restrict access where local regulation requires it. The full list is in the footer. Your country is checked at sign-up.",
  },
  {
    q: "How is my payout calculated?",
    a: "Each asset shows a payout percentage. A winning $10 trade at 93% pays out $19.30 — your $10 stake back plus $9.30 profit. A losing trade loses the stake and nothing more.",
  },
  {
    q: "How do I know the price is fair?",
    a: "Live prices are streamed from our engine which aggregates multiple liquidity providers. Every trade's open, close and settle tick is recorded in an audited ledger you can inspect.",
  },
  {
    q: "Do you charge commissions?",
    a: "No per-trade commission. The payout percentage is our only revenue on winning trades. Deposits and withdrawals are free on most rails.",
  },
] as const;
