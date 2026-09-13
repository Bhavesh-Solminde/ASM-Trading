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

Nominally executed in order — each depends on interfaces the previous one establishes, and
each ends with something you can look at. **In practice, Plan 06 was built first, out of
order, as a spike** (see status note below); Plan 01 is where sequential execution actually
starts.

| # | Plan | Deliverable | Tasks | Status |
|---|---|---|---|---|
| 01 | [Foundation](2026-09-10-asm-trade-01-foundation.md) | Register, log in, see Live $0.00 and Demo $10,000.00 | 14 | **In progress** — starting 2026-09-13 |
| 02 | [Price engine](2026-09-12-asm-trade-02-price-engine.md) | A live candlestick chart from real market data, unbiased | 8 | Not started |
| 03 | [Trade engine](2026-09-12-asm-trade-03-trade-engine.md) | Up/Down trades that settle at expiry and move balances | 8 | Not started |
| 04 | [Win-rate controller](2026-09-12-asm-trade-04-winrate-controller.md) | The compensated algorithm, bot crowd, shadow ledger, nine-test suite | 9 | Not started |
| 05 | [Deposit simulation](2026-09-12-asm-trade-05-deposits.md) | Odd-amount reconciliation, admin queue, three `BankFeed` adapters | 8 | Not started |
| 06 | [Companion app](2026-09-12-asm-trade-06-companion-app.md) | Expo + Kotlin SMS relay — see the blocker below | 6 | **Built out of order, and diverged** — see status note in the plan |
| 07 | [Platform surface](2026-09-12-asm-trade-07-platform-surface.md) | Rail, sentiment, account, KYC, 2FA, payments, support, admin | 7 | Not started |

Roughly 460 bite-sized steps in total.

### Plan 06 status (2026-09-13)

Before Plan 01 was ever executed, the companion app was hand-built as a spike, out of order —
git history starts with `expo companion app scaffold with native sms module` and runs through
`offline backlog catch-up + retry, dedup safety net`. What actually landed diverged
substantially from Plan 06's written steps:

- All SMS forwarding logic moved into native Kotlin (`apps/relay/modules/sms-reader`,
  `apps/relay/android/`) — the plan's JS-side SQLite outbox/backoff was abandoned after
  discovering RN JS timers get suspended in the background.
- The Settings screen was cut; relay config is baked in at build time
  (`apps/relay/src/relayConfig.ts`), not read from `expo-secure-store`.
- The receiving side is **`apps/harness`**, a standalone Next.js app deployed to
  Vercel/Supabase with its own `relay_messages` table — not the main platform's `BankCredit`
  table from Plans 01/05. `apps/harness` is unplanned scaffolding invented during the spike,
  not part of Plan 06's original scope. It stays as-is for now; wiring real SMS relay into the
  main app's ledger is undone and belongs to whoever revisits Plan 05.
- No unit tests exist for the native sender-allowlist logic.

Treat Plan 06's document as a historical record of intent, not a to-do list to execute as
written — if the companion app needs further work, diff against the actual code in
`apps/relay`/`apps/harness` first.

## Environment findings that shaped these plans

Discovered by scanning the machine rather than assumed, and already baked into the plans:

- **Node 18.20.8 was active when this plan was written; Next.js 16 needs ≥20.9.0.** Now moot —
  Node was upgraded to 22 during the Plan 06 spike, and 22.23.2 is confirmed active as of
  2026-09-13. Plan 01 Task 1 Step 1 is a verification, not an upgrade.
- **No Docker, colima, or podman.** `postgresql@16` and `redis 8.8.0` are already installed via Homebrew, so the plans use `brew services` and never mention containers.
- **Local Postgres runs on port 5433, not 5432 — found 2026-09-13.** This machine has an
  unrelated system-level Postgres 18 (`/Library/PostgreSQL/18`, launchd-managed) already bound
  to the default 5432. Homebrew's `postgresql@16` was already configured for port 5433 to avoid
  that conflict. Every `DATABASE_URL` and `pg_isready` call across all seven plans has been
  updated to 5433 — do not revert this.
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
