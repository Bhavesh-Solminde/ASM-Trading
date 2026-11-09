# Product

<!-- impeccable:product-schema 1 -->

## Platform

android

## Users
Indian retail traders, mostly on budget and mid-range Android phones (Android 8+, 3 GB RAM), trading in short
bursts during the day and at night. Many are first-time traders; many read Hindi more comfortably than English.
They come back several times a day to place fixed-time Up/Down trades (30s–15m) on crypto, forex and Indian index
markets, top up with UPI, and withdraw winnings to a bank, UPI ID or USDT.

## Product Purpose
IndianxTrade is the native Android app for an existing fixed-time trading platform (the website is indianxtrade.com).
It lets a trader watch a live chart, pick an amount and an expiry, and place an Up/Down trade in a couple of taps,
on a free Demo account or a real Live account, then fund and withdraw that account. Success: a trader trusts it
with real money, places a trade quickly, and always knows their balance and what happened to each trade and payment.

## Positioning
Made for India: UPI-first deposits (PhonePe, GPay, Paytm), rupee pricing (₹100 minimum stake), Hindi throughout the
app, Indian index markets alongside crypto and forex, and a deposit bonus. Owner direction: chart-first like the trading
platforms traders already know, with the clarity and trustworthiness of Indian fintech apps.

## Operating Context
- Trade tab: live Skia chart, market picker, Demo/Live switch, stake keypad, expiry chips, Buy (Up) / Sell (Down),
  open-position strip, trades sheet, result toast with haptics.
- Payments tab (P3): balance card, deposit (amount → method → UPI/USDT pay screen → result), withdraw (KYC-gated,
  ₹700–₹50,000, bank/UPI/USDT payout), recent payments.
- History tab (P3): trades and payments merged by day, filters, detail sheets with a status timeline.
- Account tab (P3): profile, KYC (Aadhaar front/back, PAN, selfie with native camera), currency, demo reset,
  notifications (P4), security (app lock PIN/biometric, 2FA), language English/हिन्दी, support, leaderboard, legal, log out.
- Gate screens: login, register, forgot password, lock setup, lock (PIN/biometric), maintenance, VPN blocked,
  update required, offline strip.
- Usage scene: one-handed, often outdoors or at night, on mobile data that drops.

## Capabilities and Constraints
- Expo SDK 57 / React Native; dark UI only; portrait; touch targets ≥ 44pt; safe-area insets.
- Every string exists in English and Hindi (Latin digits in both); Hindi text runs ~30% longer.
- ≥ 45fps chart on low-end phones: no heavy blur, glow or full-screen gradients behind live content.
- Money rules are server-side and unchanged: stake limits, KYC gate for withdrawal, withdrawal limits, bonus tiers.
- Chart types v1: candles, line, area, bars. Up = green, Down = red is a trading convention and stays.

## Brand Commitments
- Name: IndianxTrade. Logo: chrome wordmark with a tricolour (saffron / white / green) "X" carrying the Ashoka chakra;
  tagline "INDIA ME TRADING CHAT". Files: `apps/web/public/brand/indianxtrade-*`. The logo is kept as-is.
- Owner: keep the logo and "a little bit" of the current theme (dark ground); everything else may change.
- Bonus is disclosed only at deposit and in the bonus progress; it is not used as a headline elsewhere.

## Evidence on Hand
- Current app screenshots (P2 device checks). Logo files above. Payment-method marks in `apps/web/public/brand/`.
- No testimonials, ratings, user counts, licences or regulatory claims exist; none may be invented.

## Product Principles
1. Money is always legible: balance, stake, payout and result are the clearest things on any screen.
2. Two taps to trade, never an accidental trade: speed with deliberate confirmation of amount and direction.
3. Trust through honesty: plain statuses, clear limits and reasons, no hype, no invented social proof.
4. Built for India's phones and networks: fast on low-end devices, readable in Hindi, resilient offline.

## Accessibility & Inclusion
WCAG AA contrast for text; Up/Down never by colour alone (arrow + label); Hindi as a first-class language;
large tap targets for one-handed use; TalkBack labels on every control.
