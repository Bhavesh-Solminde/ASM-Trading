# Phase 2 · Currency Per Rail — INR default (#7) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans, TDD, checkbox steps.

**Goal:** Accounts are denominated in **INR by default**, with a denomination toggle to **USD**. Deposits and withdrawals follow the account's own currency (INR-in→INR-out, USD-in→USD-out) — **consistency, not cross-currency conversion**.

**Architecture:** `Account.currency` already exists and drives display via `formatMinor`/`currencySymbol`. Balances are integer minor units in that currency; withdrawals already debit in-currency. The changes are: default currency INR, seed demo in INR, make the deposit flow currency-aware (credit in the account currency, ₹-denominated UI), and a currency selector honoring "no conversion".

**Tech Stack:** `@asm/db` (schema + repositories + migration), `@asm/web` (deposit flow, account menu), config.

## Global Constraints
- Money = integer minor units in the account's own currency. **Never convert an existing balance between currencies.** Switching currency applies only to an empty rail (LIVE) or re-seeds play money (DEMO).
- Supported currencies now: **INR (₹, default)** and **USD ($)**. `currencySymbol` already maps both. No crypto/USDT integration.
- FX rate `USD_TO_INR_RATE = 107.64` (in `deposit.ts`) is used only to relate the two *records* on a deposit (the payment is always collected in INR via UPI); it is **not** used to convert account balances.
- Deposit min/max become per-currency (existing USD bounds; add INR bounds).
- Tests: `pnpm --filter @asm/db test` (Postgres, serial), `@asm/web test`.

---

### Task 1: Default new accounts to INR + INR demo seed
**Files:** `packages/db/prisma/schema.prisma` (Account.currency default), a hand-written migration, `packages/db/src/repositories/account.ts` (`createAccountsForUser`), `apps/web/src/app/api/auth/register/route.ts` (demo start amount).
**Interfaces produced:** `createAccountsForUser(userId, { currency, demoBalanceMinor })` (currency-explicit).
- [ ] Change `Account.currency @default("USD")` → `@default("INR")`; generate a migration (`prisma migrate dev --name account_currency_inr_default`). Do NOT back-fill existing rows in the schema migration.
- [ ] Set `currency: "INR"` explicitly on both `account.create` calls in `createAccountsForUser` (defense-in-depth, independent of DB default).
- [ ] Register route: introduce `DEMO_START_BALANCE_INR = 100_000_000` (₹10,00,000.00) and pass currency INR + that balance.
- [ ] **Test (db):** a freshly created user's LIVE and DEMO accounts both have `currency === "INR"`, and DEMO `realBalance === DEMO_START_BALANCE_INR`.
- [ ] Run db test.

### Task 2: Currency-aware deposit crediting
**Files:** `packages/db/src/repositories/deposit.ts`.
Rationale: `creditDepositToAccount` hardcodes `realBalance += amountUsd` and `bonus = amountUsd * BONUS%`. Credit in the **account's** currency instead.
- [ ] **Test (db):** crediting a deposit to an INR LIVE account increments `realBalance` by the INR amount (and bonus 100% of it in INR); crediting a USD account uses the USD amount. (Extend `deposit.test.ts`; it currently asserts the USD path.)
- [ ] In `creditDepositToAccount`, read `account.currency`; let `credit = account.currency === "INR" ? deposit.amountInr : deposit.amountUsd` and use `credit` for the realBalance increment, the DEPOSIT transaction amount, `cumulativeDeposits`, and the 100% bonus. Keep the ledger/audit shape.
- [ ] Run db test.

### Task 3: ₹-denominated deposit intent + bounds
**Files:** `packages/db/src/repositories/deposit.ts` (`createDepositIntent`), its callers/route (`apps/web/src/app/api/deposits/route.ts`).
Rationale: today the deposit input is a USD minor amount and `amountInr` is derived. For an INR account the user enters ₹ directly and that is the reserved/credited amount.
- [ ] Make `createDepositIntent` accept the **account currency + amount in that currency**: for INR, `amountInr = input` (with the existing ±offset uniqueness probe) and `amountUsd = round(amountInr / USD_TO_INR_RATE)` for the record; for USD, keep current behaviour.
- [ ] Add `MIN_DEPOSIT_INR_MINOR` / `MAX_DEPOSIT_INR_MINOR` bounds; validate against the account currency's bounds.
- [ ] **Test (db):** an INR deposit intent reserves a unique `amountInr` equal to (near) the requested ₹ amount and records a derived `amountUsd`; bounds reject below-min / above-max.
- [ ] Route: derive the account currency from the actor's LIVE account; pass currency + amount. Update the request contract if it currently assumes USD.
- [ ] Run db + web tests.

### Task 4: Deposit UI in account currency
**Files:** `apps/web/src/components/deposit/AmountStep.tsx`, `DepositFlow.tsx`, `MethodPicker.tsx` as needed.
- [ ] Replace hardcoded `$` and `* 1`(bonus) math with the account currency: symbol from `currencySymbol(currency)`, amount presets in ₹, "You will receive"/"Bonus (100%)" in ₹. (Bonus already 100% from Phase 1.)
- [ ] Pass the active account currency down from the platform context/page.
- [ ] Verify in preview: deposit screen shows ₹, presets and totals in INR; screenshot.

### Task 5: Currency selector (no conversion)
**Files:** `packages/db/src/repositories/account.ts` (`changeAccountCurrency`), an API route `apps/web/src/app/api/account/currency/route.ts`, `apps/web/src/components/shell/TopBar.tsx` account menu (the "Currency: INR [CHANGE]" control).
**Interface:** `changeAccountCurrency({ actorId, accountId, currency })` with rules below.
- [ ] Rules (enforced in one guarded UPDATE): **DEMO** — allowed anytime; set currency and re-seed the demo balance to that currency's demo-start amount, recorded as a `DEMO_RESET` transaction (play money, no conversion). **LIVE** — allowed only when `realBalance + bonusBalance === 0` (an untouched rail); otherwise reject with "Your live rail is already in <cur>; it can't be switched after funding." No balance is ever converted.
- [ ] **Test (db):** switching a DEMO account to USD sets currency and re-seeds the USD demo start (ledgered); switching a funded LIVE account is rejected; switching an empty LIVE account succeeds.
- [ ] Route: authed, validates currency ∈ {INR,USD}, calls the repo, returns the updated account. 
- [ ] Account menu: a small currency control (INR/USD) that calls the route and refreshes; matches the reference "Currency … CHANGE".
- [ ] Verify in preview: switch DEMO INR↔USD, see balance re-denominate; screenshot.

### Task 6: Verification
- [ ] `pnpm --filter @asm/db test` + `@asm/web test` green; `tsc --noEmit` clean; lint clean on changed files.
- [ ] Browser: register/login, confirm ₹ demo balance, deposit screen in ₹, currency switch; screenshot.
- [ ] Commit. Note the schema migration in the PR description.

## Self-review
- Coverage: default+seed (T1), credit (T2), intent+bounds (T3), UI (T4), selector/no-conversion (T5). ✅
- Consistency: "INR-in→INR-out" holds because withdrawals already debit in the account currency and credits now match it; the FX rate touches only deposit *records*, never balances.
- Risk: the shared remote dev DB — the migration changes a default only (no back-fill); existing rows keep their currency. A separate dev-only data step can set existing DEMO accounts to INR if desired (out of plan scope).
