# Affiliate accounts and shared charts

Updated on 10 November 2026. Tests use local, isolated Postgres and frozen market references.

## Balance policy

New affiliates receive ₹10,000 once in LIVE and ₹10,000 once in DEMO. Existing balances are preserved. There is no automatic daily reset in either the shared-chart service or the legacy engine.

In **Admin → Affiliates → Set balance**, an authenticated administrator can set either available balance independently, including zero and two decimal places. The form displays the account's current currency. A stale form is refused if that currency changed. Normal users' accounts cannot be changed through this action.

Each change locks the account, sets its available funds to the entered amount, clears bonus funds, and records a ledger delta plus an admin audit entry. Accepted trades retain their locked stakes and settle normally into the new available balance. Repeated submissions of the same form do not overwrite later settlements. The existing historical reset column and transaction enum are retained for compatibility; no migration or environment changes are required.

## Chart isolation

Only USER-role LIVE trades submit market orders. AFFILIATE LIVE and DEMO contracts both observe the shared chart with zero requested or filled order-book lots. Roles and ownership are resolved from the database. HTTP requests cannot supply a replacement role.

| Check | Result |
| --- | --- |
| Affiliate creation | Both INR accounts start once with ₹10,000, with LIVE access enabled |
| LIVE and DEMO entry | Exact verified displayed quote, fixed 92% payout |
| Multiple simultaneous positions | Independent contracts and stake debits |
| SL/TP and expiry | Normal settlement from published executions |
| Retry and engine restart | Same trade, one stake debit, preserved market state |
| Chart and bot book | All 30 market checkpoints and bot leaderboard match the baseline without affiliate orders |
| Public active trader count | Affiliate positions excluded |
| Private events | Owning account receives its events; observers do not |

The old affiliate-specific win-rate override belongs to the legacy desk. It is not used by the shared-chart backend. Affiliate outcomes follow the published market.

## Verification

- 15 admin action tests: authentication, exact decimal parsing, zero, malformed/oversized inputs and refused updates.
- 29 engine tests on isolated Postgres: affiliate LIVE/DEMO creation, open positions during concurrent admin changes, restart/retry, SL/TP and duration settlement across IST midnight, ledger/audit entries, currency checks, zero and refusal of non-affiliate accounts. Includes HTTP/WebSocket delivery and private-event isolation.
- 21 market tests: affiliate paper contracts leave all 30 markets and bot P&L identical to the seeded baseline.
- Engine/database/web typechecks and targeted lint.

A local Chromium browser check signs in as admin, creates an affiliate, changes LIVE to ₹25,000.25, sets DEMO to zero, verifies the other balance stays unchanged, checks the mobile layout, then deletes the QA account. These are functional checks, not browser frame-rate measurements. No production affiliate balances are changed for testing.
