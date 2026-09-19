# Bank-feed ingestion, deposit verification, and admin panel — Design

**Status:** Approved by user 2026-09-13. Ready for implementation planning.

## Context

Plan 01 (Foundation) is complete and merged to `main`. Before Plan 05
(Deposits) is formally executed, the user wants the real-world SMS-relay
pipeline (built out of order as a Plan 06 spike: `apps/relay`, an
Expo/Kotlin Android app, and `apps/harness`, a standalone Next.js receiver
on its own Supabase database) wired directly into the main website
(`apps/web`), with a working deposit-verification engine and an admin panel
to monitor and manually resolve incoming bank-credit messages.

This design **supersedes Plan 05's `classifyMatch`/VPA-based matching
approach** with a different, user-specified verification engine (see
"A bug found in Plan 05" below). It reuses Plan 05's existing Prisma schema
(`BankCredit`, `Deposit`) and general architecture (amount-as-primary-key,
admin queue for the residue) but replaces the matching logic itself.

## What already exists (verified against the actual code, not assumptions)

- **`apps/relay`** (Expo/RN, Android SMS forwarding in native Kotlin):
  `SmsForwarder.kt` POSTs `{ sender, body, receivedAt, deviceLabel,
  deviceModel }` to `${RELAY_CONFIG.serverUrl}/api/bank-feed/sms` with header
  `Authorization: Bearer ${RELAY_CONFIG.secret}`. `serverUrl`/`secret` are
  hardcoded constants in `apps/relay/src/relayConfig.ts` — no Settings
  screen; changing them requires an app rebuild.
- **`apps/harness`** (standalone Next.js + raw `postgres` client, its own
  Supabase DB, unrelated to `asm_trade`): receives that exact payload at
  `POST /api/bank-feed/sms`, Bearer-auth checked against
  `SMS_RELAY_SECRET`, parses the SMS body with `lib/parseSms.ts` (regex
  extraction of amount + UTR + credit/debit), stores every message in a
  `relay_messages` table, and serves an unauthenticated `/messages`
  dashboard listing the last 200 rows. **Not wired to `BankCredit` or any
  deposit logic — was always disconnected scaffolding, per the plans'
  README's own "Plan 06 status" note.**
- **`BankCredit` and `Deposit` Prisma models already exist** (built ahead of
  schedule in Plan 01's Task 5 schema), including `Deposit.vpa`,
  `Deposit.amountInr`, `Deposit.claimedUtr`, `Deposit.checkoutToken`,
  `Deposit.status`, `BankCredit.vpa`, `BankCredit.amountInr`,
  `BankCredit.utr` (unique), `BankCredit.consumed`.
- **No admin/settings UI and no `ADMIN`-role check exist anywhere in
  `apps/web`** — the `role` field is fetched into every session but never
  branched on.

## A bug found in Plan 05 (why this design departs from it)

Plan 05's `submitRelayedSms` always sets `vpa: null` for SMS-derived
credits (a bank SMS's text doesn't carry the payer's VPA), stored as the
literal placeholder `"relayed"`. But `classifyMatch` requires
`credit.vpa === deposit.vpa` before checking anything else, and
`runMatcher`'s own DB query pre-filters `WHERE vpa = deposit.vpa` — so a
real phone-relayed SMS credit can never be selected as a candidate for any
deposit, let alone match one. Plan 05's matcher only ever works for the
`simulated` feed (which fabricates a real vpa). The real-world path was
dead on arrival.

This design does not patch that gap — it replaces VPA-based matching
entirely with an **amount-as-identifier** scheme (below), per explicit user
direction, which sidesteps the problem: VPA is dropped from matching
altogether.

## Deposit-verification engine (user-specified, supersedes Plan 05 §7 matching)

### Amount reservation

- User requests a deposit of amount **B** (e.g. ₹1,000).
- System picks a **random, currently-unused, exact amount A** within
  **B − ₹10 to B + ₹10** (inclusive), at paise/2-decimal granularity — e.g.
  ₹991.01. That gives ~2,000 candidate values per request.
- **A is reserved exclusively to this deposit** for its lifetime
  (`AWAITING_PAYMENT`/`PENDING_CONFIRMATION`) — enforced unique among all
  currently-live deposits (a partial unique index on the reserved amount,
  following Plan 01's existing pattern for `Deposit`'s partial-unique
  reservation, just keyed on amount alone instead of `(vpa, amountInr)`).
- Selection is **random, not sequential** — assigning ₹991.01, ₹991.02,
  ₹991.03... to successive requesters would let one user guess another's
  amount and hijack their credit. A random draw from the unused pool
  (re-rolling on the rare collision) prevents that.
- The user is credited the **original requested amount B** (₹1,000) on
  match, not the odd assigned amount A (₹991.01) — A is purely an
  identifier, not the real deposit value. (`Deposit.amountUsd`/`amountInr`
  in the existing schema already separates the two: keep the
  user-requested amount as the credited value, and the reserved
  odd-amount identifier as a new field — see Data Model below.)

### QR code

- The checkout page's UPI QR/deep-link (`upi://pay?pa=<vpa>&pn=...`,
  already planned in Plan 05) gets one more query parameter: `am=<A>` (the
  exact assigned amount, e.g. `am=991.01`). Most UPI apps (GPay, PhonePe,
  Paytm, BHIM) pre-fill this amount so the user doesn't type it — removing
  the main source of honest typing mistakes. Some UPI apps allow the user
  to edit the pre-filled amount before paying; the verification engine
  below is the backstop for that case, not the QR.

### Matching an incoming bank credit against pending deposits

Two independent checks, evaluated in this priority: **Amount → Reference
ID → VPA (VPA is never checked — fully optional/ignored)**.

- **Amount check:** does the credit's exact amount equal any live
  deposit's reserved amount **A**? (Exact match, not fuzzy — the ±₹10
  window is the *pool the amount was drawn from*, not a tolerance applied
  at verification time. Paying a different in-range amount that wasn't
  assigned to you does not match you.)
- **Reference check:** does the credit's UTR equal a live deposit's
  self-declared `claimedUtr` (Plan 05's existing "self-declared UTR" flow —
  user optionally tells the system their UTR before/after paying)?

| Amount matches a live deposit? | Reference matches (when present)? | Outcome |
|---|---|---|
| Yes | Yes, or reference absent on either side | **Auto-approve** (Cases 1, 4, 5) |
| Yes | Present but wrong | **Manual review** (Case 2) |
| No | Yes (UTR matches some *other* deposit's claim) | **Manual review** (Case 3) |
| No | No / absent | **Orphan** — credit held unconsumed, deposit(s) keep waiting |

Never auto-*rejected* — only auto-approved or sent to manual review.
`VPA` is not read from the credit or the deposit for matching purposes at
all (still stored, for audit/display only).

**Added safety rule (not in the user's spec, required for correctness):**
if an incoming credit's exact amount matches **more than one** live
deposit (should be prevented by the reservation's uniqueness constraint,
but defense-in-depth against a bug or a race), route to manual review
rather than picking one — never guess between two live deposits.

**Reference-check semantics:** exact string equality between
`BankCredit.utr` (parsed from the SMS) and `Deposit.claimedUtr`
(self-declared by the user), case-sensitive, no normalization — matching
Plan 05's existing `claimUtr` flow, unchanged by this design.

**What "manual review" concretely means:** no new `Deposit` status is
introduced. The deposit stays in its current status (`AWAITING_PAYMENT` or
`PENDING_CONFIRMATION`); the conflicting `BankCredit` is simply left
`consumed: false` (never auto-linked) and becomes visible in the admin
panel's orphan/manual-match queue (see below) alongside any deposit whose
reserved amount or claimed UTR it partially matched, for a human to
resolve with the manual-match action.

### Reconciliation flow (reusing Plan 05's approach where it's sound)

Plan 05's transactional "approve and credit" logic (`creditDepositToAccount`
— mark `Deposit.status = COMPLETED`, mark the consumed `BankCredit`, credit
the account, grant the bonus, write the `Transaction`/`AuditLog` rows, all
in one `prisma.$transaction`) is reused as-is; only the *lookup* that
decides which deposit a credit belongs to changes (amount+reference,
instead of VPA+amount).

## Data model changes

- **New model `RelayMessage`** — the raw ingestion log, independent of
  whether a message turned into a `BankCredit`: `id`, `source` (string,
  e.g. `"sms-relay"` — kept generic/multi-source per user's request even
  though only one source exists today), `deviceLabel`, `deviceModel`,
  `sender`, `body`, `receivedAt`, `parsedAmountInr` (nullable),
  `parsedUtr` (nullable), `isCredit` (nullable boolean), `bankCreditId`
  (nullable FK to `BankCredit`), `createdAt`.
- **`Deposit`**: add a `reservedAmountInr` (Int, the exact assigned
  identifier `A`) distinct from the existing `amountInr` (the real
  requested/credited value `B`) — a partial unique index on
  `reservedAmountInr` for currently-live deposits, mirroring the existing
  `(vpa, amountInr)` partial-unique pattern from Plan 01's schema note but
  keyed on `reservedAmountInr` alone.
- **`BankCredit`**: no schema change needed — `vpa` stays present but
  unused for matching (store `"relayed"` for SMS-sourced credits, per
  existing convention); matching now joins on `amountInr`/`utr` only.

## Ingestion endpoint

- `POST /api/bank-feed/sms` in `apps/web` — same path and
  `Authorization: Bearer <SMS_RELAY_SECRET>` pattern the relay app already
  sends (only `relayConfig.ts`'s `serverUrl` needs to change, not its auth
  header logic).
- Always writes a `RelayMessage` row. If the body parses as a credit,
  additionally creates a `BankCredit` row and runs the amount/reference
  matcher immediately (rather than only on a periodic sweep) — auto-approve
  or leave orphaned per the table above.
- Reuses `apps/web/src/lib/rate-limit.ts`'s `checkRateLimit` and the
  existing Bearer-auth pattern's structure (timing-safe comparison, as
  Plan 05's own sketch already showed) for the secret check.

## Admin panel (`apps/web`, new `/admin` route group)

- **Access:** a separate shared secret (env var, e.g. `ADMIN_PANEL_SECRET`)
  — independent of user accounts and the `role` field entirely (per user's
  explicit choice). A small login form sets an httpOnly, hashed-token
  cookie on success (same token-hashing pattern as `session.ts`), gated by
  its own rate limit on attempts.
- **`/admin/messages`** — every `RelayMessage`, filterable by `source` and
  `deviceLabel`, showing parsed amount/UTR/credit flag and whether it
  produced a `BankCredit`, and if so, that credit's match status.
- **`/admin/deposits`** —
  - List of `Deposit` rows with status and match info.
  - **Manual-match action** for orphaned `BankCredit` rows: pick an
    unconsumed orphan credit, pick a live deposit, confirm — invokes the
    same `creditDepositToAccount` transaction Plan 05 already designed,
    just triggered manually instead of by the auto-matcher. This is the
    "residue" queue the whole reservation/matching design assumes will
    exist.
  - **"Create test deposit" tool** — a minimal form (requested amount,
    optional pre-set claimed UTR) that runs the real reservation logic
    (picks a random unused amount in range) and creates a real `Deposit`
    row, so a genuine incoming SMS can be watched matching it end-to-end
    without the real checkout page existing yet.

## Relay app changes

- `apps/relay/src/relayConfig.ts`: update `serverUrl` to point at wherever
  a tunnel (e.g. ngrok) exposes `apps/web` during a test session — left as
  an easily-edited constant (as it is today), since the URL changes per
  tunnel session and the app is rebuilt when it does. No change to the
  auth/payload logic — it already sends exactly what the new endpoint
  expects.
- `apps/harness` is **left completely untouched** — no longer wired to
  receive live traffic, but still fully functional as a standalone manual
  testing target (can still be POSTed to directly to test SMS parsing in
  isolation). This is an explicit user requirement, not an oversight.

## Testing approach

- **Automated:** integration tests create `Deposit` rows directly against
  a real test database (bypassing any UI), covering all 5 cases from the
  table above plus the added multi-match safety rule, verified against a
  real Postgres.
- **Manual/live:** the admin panel's "create test deposit" tool plus a real
  phone SMS via the tunnel — lets the whole pipeline be watched end-to-end
  in a browser without the real checkout page existing yet.

## Explicitly out of scope for this effort

- The real deposit checkout page / QR display UI (Plan 05's own Task list
  covers this later — this design only builds the QR's `am=` parameter
  logic and the reservation/matching engine it depends on, not the page
  itself).
- Importing apps/harness's existing historical Supabase data (user chose
  to start fresh).
- Gating the admin panel by the existing user `role: ADMIN` field (user
  chose a separate shared secret instead).
- Any change to `apps/harness` or `apps/relay`'s Kotlin/native SMS-reading
  logic beyond the one config-value change described above.

## Manual end-to-end test walkthrough (once this plan is implemented)

1. Start a tunnel: `ngrok http 3000` (or your preferred tunnel tool), note the https URL it prints.
2. Update `apps/relay/src/relayConfig.ts`'s `serverUrl` to that URL, rebuild and reinstall the relay app on your phone (`cd apps/relay && pnpm android`, or your usual build command).
3. Set `SMS_RELAY_SECRET` and `ADMIN_PANEL_SECRET` in `.env` to match what you put in `relayConfig.ts`'s `secret`.
4. Run `pnpm dev` (starts `apps/web`).
5. Log into `/admin/login` with your `ADMIN_PANEL_SECRET`.
6. Use the admin panel (or a direct `fetch`/curl to `/api/admin/deposits`) to create a test deposit for a real seeded user, noting the reserved amount it returns.
7. Pay that exact amount via UPI on your phone (or send yourself a test SMS that mimics your bank's real format with that amount) so the relay forwards it.
8. Check `/admin/messages` — the message should appear. Check `/admin/deposits` — the deposit should show `COMPLETED` if the amount and (if present) reference matched, or the credit should appear in the orphan list if not, ready for a manual match.
