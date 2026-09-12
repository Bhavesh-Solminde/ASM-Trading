# ASM Trade — Plan Series Index

ASM Trade is a demonstration build: a working replica of a manipulated digital-options
platform, built end-to-end but **never deployed, never taking real users or real money**.
Its purpose is to show how such platforms decide winners and how their payment rails work.

The scope spans six independent subsystems. Each gets its own plan, and each produces
working, testable software on its own.

## Reference specifications

| Document | Covers |
|---|---|
| [Build Spec](https://claude.ai/code/artifact/c13bac38-4b12-42c1-bcee-a975cabe1d90) | Architecture, price engine, deposits, screens, data model, observability, security |
| [Win-Rate Control Engine](https://claude.ai/code/artifact/d004b3f9-cec6-4ddd-a220-f92b6fd5358e) | The compensated controller — targets, pipeline, loopholes, test suite |
| [Threat Model](https://claude.ai/code/artifact/9afaee66-94fb-42e4-8181-4827f8100420) | 94 controls, OWASP 2025 mapped. Only the Phase 01 subset is implemented |

## Plans

All seven are written. Execute them in order — each depends on interfaces the previous
one establishes, and each ends with something you can look at.

| # | Plan | Deliverable | Tasks |
|---|---|---|---|
| 01 | [Foundation](2026-09-10-asm-trade-01-foundation.md) | Register, log in, see Live $0.00 and Demo $10,000.00 | 14 |
| 02 | [Price engine](2026-09-12-asm-trade-02-price-engine.md) | A live candlestick chart from real market data, unbiased | 8 |
| 03 | [Trade engine](2026-09-12-asm-trade-03-trade-engine.md) | Up/Down trades that settle at expiry and move balances | 8 |
| 04 | [Win-rate controller](2026-09-12-asm-trade-04-winrate-controller.md) | The compensated algorithm, bot crowd, shadow ledger, nine-test suite | 9 |
| 05 | [Deposit simulation](2026-09-12-asm-trade-05-deposits.md) | Odd-amount reconciliation, admin queue, three `BankFeed` adapters | 8 |
| 06 | [Companion app](2026-09-12-asm-trade-06-companion-app.md) | Expo + Kotlin SMS relay — see the blocker below | 6 |
| 07 | [Platform surface](2026-09-12-asm-trade-07-platform-surface.md) | Rail, sentiment, account, KYC, 2FA, payments, support, admin | 7 |

Roughly 460 bite-sized steps in total.

## Environment findings that shaped these plans

Discovered by scanning the machine rather than assumed, and already baked into the plans:

- **Node 18.20.8 is active but Next.js 16 needs ≥20.9.0.** Plan 01 Task 1 upgrades it. Nothing runs until it does.
- **No Docker, colima, or podman.** `postgresql@16` and `redis 8.8.0` are already installed via Homebrew, so the plans use `brew services` and never mention containers.
- **No Xcode, only Command Line Tools.** Android only for Plan 06.
- **Prisma 8 is a release candidate.** Pinned to 7.10.0 stable, with the v7 `prisma-client` generator and its mandatory `output` path.
- **Twelve Data's free tier allows 8 requests/minute.** Plan 02 polls one asset at a time, round-robin — which happens to be exactly the anchor cadence the price engine wants.

## Blocker to resolve before Plan 06 (Expo companion app)

**Expo Go cannot read SMS.** There is no Expo SDK module for a
`RECEIVE_SMS` / `SMS_RECEIVED` broadcast receiver, and the managed workflow has
no way to register one. This is not a configuration problem — the capability
does not exist in Expo Go at all.

React Native and Expo tooling still work, but the project has to leave the
managed runtime:

1. **`expo prebuild` + a config plugin** (recommended) — keeps Expo Router,
   EAS, and the rest of the Expo developer experience, generates the native
   Android project, and registers the receiver through a config plugin. Run on
   device or emulator via a custom development build (`expo-dev-client`), never
   Expo Go.
2. **Bare React Native** — drop Expo entirely. Less tooling, no real advantage
   here.

Plan 06 assumes option 1. Two consequences worth knowing now:

- **Android only.** This machine has Command Line Tools but no Xcode, so iOS
  builds cannot run locally. iOS could not read SMS regardless — no such API
  exists on the platform.
- **A custom dev build is required**, so the first run needs a connected
  Android device or an emulator plus the Android SDK. Java 17 is already
  installed.

## Standing constraint

Every plan inherits this: `BANK_FEED=simulated` is the only feed configured, reveal data
is recorded but never rendered in the trading UI, and no step moves toward real deposits,
real users, or third-party accounts.
