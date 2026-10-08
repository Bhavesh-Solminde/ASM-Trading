# Affiliate accounts

**Status:** draft design
**Date:** 2026-10-08

## Problem

Live-stream content creators ("affiliates") need a trading account they can
show on camera that:

- Looks and behaves exactly like a real user account — same URL, same UI, same
  flows — so a viewer cannot tell it apart from a regular trader's screen.
- Has no real money attached: deposits and withdrawals must render but never
  move funds.
- Starts each day with a fresh, bounded play float so the streamer always has
  something to trade with.
- Wins at a high rate (~80%) on live trades so the stream shows an engaging,
  mostly-successful session.
- Does NOT show chart manipulation to the viewer — the price tape the
  streamer trades against is the same tape the engine settles on. The rigging
  lives in the verdict choice, not in a shown-vs-honest price divergence.

Today only `USER` and `ADMIN` roles exist. There is no mechanism to create a
synthetic trading account, bypass deposit/withdrawal, cap balance to a daily
float, or force a WIN-biased verdict pipeline that leaves shadow prices
honest.

## Non-goals

- Promoting existing users to affiliate (fresh accounts only).
- A separate affiliate domain, subdomain, or route — the differentiator is
  `User.role`, not the URL.
- Any user-facing "affiliate" badge, label, or hint in the trader UI.
- Any payout, referral tracking, or earnings surface for the affiliate
  themselves — their on-platform balance is play money that resets daily.
- Backfilling or migrating existing users.

## Design

### Role

Extend the `Role` enum:

```prisma
enum Role {
  USER
  ADMIN
  AFFILIATE
}
```

`USER` and `ADMIN` behavior is unchanged. Every new check branches on
`role === 'AFFILIATE'` explicitly; existing `role === 'ADMIN'` checks remain
correct because `AFFILIATE` is a third distinct value, not a subtype.

### Account shape

An affiliate has exactly the same `Account` rows as a regular user: one
`LIVE` and one `DEMO`, both `currency = INR`, both starting at
`realBalance = 10_000_00` paise (₹10,000). `bonusBalance`, `turnoverProgress`,
and the lifecycle fields exist but are irrelevant — the daily reset wipes
them.

New column:

```prisma
model Account {
  // ...
  lastAffiliateResetAt DateTime?
}
```

Nullable so regular users leave it NULL forever; the daily-reset job uses it
as an idempotency key keyed on the IST calendar date.

### Admin "Create affiliate" flow

New admin surface at `/admin/affiliates`:

- List page: email, created-at, LIVE balance, DEMO balance, last-reset-at.
  Delete button per row. No edit (role is terminal — don't support flipping
  it back).
- Create page: email, password, nickname (optional). On submit, inside one
  transaction:
  1. Create `User` with:
     - `role = AFFILIATE`
     - `emailVerified = true`
     - `liveAccess = true` (so the LIVE account works without the global gate)
     - `kycStatus = NOT_STARTED` (never prompted)
     - `status = ACTIVE`
  2. Create `Account` × 2 (LIVE, DEMO), both at `realBalance = 10_000_00`,
     `lastAffiliateResetAt = now()`.
  3. Write two `Transaction` rows with the new `TxKind.AFFILIATE_RESET` and
     `amount = 10_000_00` so the ledger reflects the starting float.
  4. Write an `AuditLog` entry attributing the creation to the admin.

New enum variant:

```prisma
enum TxKind {
  // ...existing kinds...
  AFFILIATE_RESET
}
```

### Server-side guard: "money never moves outside of trading and reset"

The core invariant: for an affiliate account, the only `TxKind` values that
may actually change `realBalance` or `bonusBalance` are:

- `AFFILIATE_RESET` (the daily job)
- `TRADE_STAKE` (open debit)
- `TRADE_PAYOUT` (settle credit)
- `TRADE_REFUND` (expired/refunded trade)

Everything else — `DEPOSIT`, `WITHDRAWAL`, `BONUS_GRANT`, `BONUS_CONVERT`,
`CURRENCY_CONVERT`, `DEMO_RESET` — becomes a no-op at the balance-mutation
layer when the account's owner has `role === AFFILIATE`.

This is one chokepoint, not scattered endpoint checks. New deposit or
withdrawal paths added later inherit the guarantee automatically.

Implementation sketch: the single function that writes a `Transaction` and
updates `Account.realBalance / bonusBalance` reads the owner's role once and
returns a no-op outcome for disallowed kinds. Callers still receive a
success-shaped result so UI flows (deposit submit, withdrawal submit) render
their normal "pending" states.

### Deposit flow for affiliates

- The deposit page, QR screen, UTR entry, screenshot upload — all render
  identically to a regular user.
- `Deposit` row is written to the DB as normal so it appears in the user's
  deposit history and the UI shows "awaiting payment."
- **USDT path:** skip the Tatum alert subscription registration when
  `user.role === AFFILIATE`. The receiving address is still generated and
  shown on the QR, but no on-chain watcher is set up for it. If someone
  actually sends crypto there, it will not be matched or credited. The
  `Deposit` row expires as `AWAITING_PAYMENT`.
- **UPI path:** the UI generates the QR and reserves the amount as normal.
  The UPI SMS/credit matcher reads `user.role` on the candidate deposit and
  refuses to credit affiliate deposits. If a matching SMS arrives, the
  `Deposit` row stays `AWAITING_PAYMENT` until expiry.
- **Admin manual-approve path:** the admin deposit review surface filters out
  (or refuses the action on) affiliate deposits.

Net effect: the user clicks through the full flow, the deposit shows up as
"awaiting payment" in their history, and nothing credits the account.

### Withdrawal flow for affiliates

- The withdrawal page, amount selector, method entry, confirmation screen —
  all render identically to a regular user.
- `Withdrawal` row is written with `status = REQUESTED` as normal so it
  appears in the user's withdrawal history.
- The usual "debit `realBalance` at request time" step is skipped for
  affiliates (via the single-chokepoint guard above). Balance never drops.
- The admin withdrawal queue filters out affiliate rows: never approved,
  never paid, never auto-rejected. They sit in `REQUESTED` indefinitely.

Net effect: the user sees their request in history as "pending," balance
stays intact, and the admin never sees the request.

### Bonus / promo flow for affiliates

- Promo banners, bonus-eligible deposit prompts, "double your trading power"
  copy — all render normally.
- The chokepoint guard blocks `TxKind.BONUS_GRANT` and `TxKind.BONUS_CONVERT`,
  so `bonusBalance` never moves and no bonus-related `Transaction` row is
  written for an affiliate. The `BonusGrant` tracking row itself (which is
  not a `Transaction`) is not written either — a bonus with no balance
  movement would be dangling history. The call sites that create a
  `BonusGrant` short-circuit when `role === AFFILIATE`.
- Belt-and-suspenders: the daily reset sets `bonusBalance = 0` explicitly, so
  even if a bonus is somehow granted outside the guarded path it is wiped at
  midnight.

### Daily reset

A once-per-day job snaps every affiliate account's balance back to
₹10,000:

- Runs inside the existing engine tick loop (no new cron infra). On each
  tick, check whether 00:00 IST has crossed since the last reset. If so,
  run the reset pass.
- Query: all `Account` rows whose `user.role === AFFILIATE` and
  `lastAffiliateResetAt < today-IST-midnight`.
- For each row, in a transaction:
  1. Set `realBalance = 10_000_00`.
  2. Set `bonusBalance = 0`.
  3. Set `lastAffiliateResetAt = now()`.
  4. Write a `Transaction (AFFILIATE_RESET, amount = new - old)` row — the
     delta can be negative, zero, or positive depending on how the day went.
     `balanceAfter = 10_000_00`.
- Idempotency: `lastAffiliateResetAt` guards against double-reset within one
  IST calendar day even if the engine restarts mid-pass.
- Open trades at reset time are left alone — stake is already locked in the
  `Trade` row, not in `realBalance`. If a trade settles after the reset, its
  payout credits normally against the new ₹10,000 float.
- No cap during the day: wins and losses accumulate freely. The next reset
  snaps whatever is there back to ₹10,000.

### Verdict pipeline — LIVE account (80% WIN)

At trade-open, when stamping `Trade.verdict`:

- If the owning account's user has `role === AFFILIATE` AND the account is
  `type = LIVE`:
  - Roll `Math.random() < 0.80` → stamp `verdict = WIN`, else
    `verdict = LOSS`.
  - Skip the growth-loop governor entirely: no `HouseTreasury` read, no
    lifecycle probability ladder, no `HouseDay` update at settlement.
  - Still generate `pathStyle` and `targetPrice` the engine's usual way so
    the shown price path lands at the correct exit for the stamped verdict.
- DEMO is handled below.

Rationale for skipping `HouseDay`: affiliate P/L is play money. Counting it
in the house ledger would distort the governor's targeting for real users.

### Verdict pipeline — DEMO account (unchanged)

- An affiliate's DEMO account uses the existing demo path:
  `verdict = HONEST`, no shadow bias, same as any regular user's DEMO. Not
  rigged.

### Chart honesty — no shown-vs-honest divergence (LIVE)

When writing `TradeShadow` and `ShadowTick` for an affiliate's LIVE trade:

- `TradeShadow.shownExitPrice = TradeShadow.honestExitPrice`
- `TradeShadow.biasApplied = 0`
- `TradeShadow.magnetApplied = 0`
- `TradeShadow.deltaPips = 0`
- `TradeShadow.shownResult = TradeShadow.honestResult`
- Every `ShadowTick` written during the trade: `shownPrice = honestPrice`

Net effect: the tape a live-stream viewer sees is bit-identical to the tape
the engine settles against. The 80% WIN rate is enforced only via the
verdict stamp at open, not by divergent exit prices.

### UI parity

No UI element reveals affiliate status to the user. No badge, no banner, no
alt layout. Every page the trader can reach is the same page any other user
reaches. Admins can see the role in `/admin/users/[id]` and the dedicated
`/admin/affiliates` list; nothing surfaces it in the client UI.

### Data model summary

New / changed:

```prisma
enum Role {
  USER
  ADMIN
  AFFILIATE
}

enum TxKind {
  // existing...
  AFFILIATE_RESET
}

model Account {
  // existing...
  lastAffiliateResetAt DateTime?
}
```

No new tables.

### Error / edge cases

- **Reset race with trade settlement:** both are serialized through the
  account-mutation chokepoint; whichever lands first wins, the other sees
  the fresh row and no-ops or applies against the new balance. Correct in
  both orderings.
- **Admin deletes an affiliate with open trades:** standard
  `onDelete: Cascade` on `Account → Trade` applies (same as any user
  delete). Rare, acceptable.
- **Engine down over midnight:** on next start, the first tick finds every
  affiliate account with `lastAffiliateResetAt < today-IST-midnight` and
  resets them. One reset per day regardless of restart count.
- **UPI reservation collision:** affiliate deposits participate in the live
  amount reservation like any other `AWAITING_PAYMENT` row until expiry.
  Acceptable — the amount space is big and reservations expire. If this
  becomes a real contention source, revisit.
- **Admin role flip (AFFILIATE → USER):** out of scope. Not supported from
  the UI. If done directly in the DB, the balance guard flips off and
  normal money flow resumes; the user keeps their last daily-float balance
  as realBalance. Document; don't engineer against.

## Testing

- Repository-level test on the mutation chokepoint:
  `AFFILIATE + DEPOSIT` → `realBalance` unchanged AND no `Transaction` row
  written (the chokepoint is a hard no-op, not an audit-logged skip).
  `AFFILIATE + TRADE_PAYOUT` → balance updated normally, `Transaction`
  written.
  `USER + DEPOSIT` → balance updated normally, `Transaction` written.
- Daily-reset test: seed an affiliate at ₹8_000, run reset, assert
  balance = ₹10_000, `AFFILIATE_RESET` txn written, `lastAffiliateResetAt`
  advanced. Run reset again same day → no-op.
- Verdict-pipeline unit: given an affiliate LIVE account, 10_000 opens →
  WIN count in [7_800, 8_200] (3σ band on p=0.8). Governor functions not
  called.
- Shadow-honesty assertion: for an affiliate LIVE trade, after settlement
  `shownExitPrice === honestExitPrice` and every `ShadowTick` written has
  `shownPrice === honestPrice`.
- Deposit happy-path integration: affiliate creates a deposit → `Deposit`
  row exists, no Tatum subscription created (USDT) / matcher refuses to
  credit (UPI), balance unchanged.
- Withdrawal happy-path integration: affiliate submits a withdrawal →
  `Withdrawal` row exists in REQUESTED, balance unchanged, admin queue
  excludes it.

## Rollout

- Migration: `Role` enum addition, `TxKind` enum addition, `Account.lastAffiliateResetAt`
  column (nullable). Pure additive, zero-risk.
- Code: ship the chokepoint guard, verdict branch, shadow-honesty branch,
  admin page, and reset job in one PR gated behind the enum addition.
- No feature flag — the behavior only applies to users whose role is
  explicitly set to `AFFILIATE`, which only the new admin page can do, so
  there is no exposure to existing users.
