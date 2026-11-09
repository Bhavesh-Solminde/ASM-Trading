# Affiliate trading with the shared OTC charts

Audited on 10 November 2026 against main. Tests use local, isolated Postgres and frozen market references.

## Result

Only USER-role LIVE trades submit market orders. AFFILIATE LIVE and DEMO contracts both observe the shared chart with zero requested or filled order-book lots. Roles and account ownership are resolved from the database. HTTP requests cannot supply a replacement role.

| Check | Result |
| --- | --- |
| Affiliate creation | Both INR accounts start with ₹10,000, with LIVE access enabled |
| LIVE and DEMO entry | Exact verified displayed quote, fixed 92% payout |
| Multiple simultaneous positions | Independent contracts and stake debits |
| SL/TP and expiry | Settle from published executions with normal fixed-payout rules |
| Request retry and engine restart | Same trade, one stake debit, same preserved market state |
| Shared chart and bot book | Every market checkpoint and bot leaderboard matches the baseline without affiliate orders |
| Public active trader count | Affiliate positions excluded |
| Private events | Open/settlement events delivered to the owning account, excluded from an observer connection |
| Daily float | Restored in the new OTC engine, checked at startup and every minute |

The old affiliate-specific win-rate override belongs to the legacy desk. It is not used by the shared-chart OTC backend. Affiliate outcomes follow the published market.

## Fixed gaps

The OTC boot path bypassed the legacy tick loop, which also removed its affiliate daily-reset job. The OTC service now runs a separate reset task. It does not call the market worker or submit orders.

Reset now locks the account before reading its balance. Concurrent reset calls apply once per IST date, and balance changes serialize with trade debits, settlement and currency conversion. It rejects non-affiliate accounts, uses the ₹10,000 equivalent in the account's current currency, clears bonus funds, and records the complete balance delta.

## Verification

- 21 market tests, including 20 affiliate contracts per account type across Bitcoin and EUR/USD, plus recovery. Compare all 30 markets and bot P&L with identical seeded baselines after ten simulated minutes.
- 27 OTC engine tests on isolated Postgres, including affiliate entry, replay, protected and duration settlements, resets with open contracts, HTTP/WebSocket delivery and private-event isolation for both LIVE and DEMO.
- Three scheduler tests covering startup, minute cadence, no overlapping scans, retries and shutdown.
- Engine, database and market typechecks, plus targeted lint.

These checks prove deterministic market isolation and server behaviour. They are not browser frame-rate measurements. Deposit/withdrawal processing, affiliate promotional policy and manual browser sign-in were inspected only, not exercised against live money.
