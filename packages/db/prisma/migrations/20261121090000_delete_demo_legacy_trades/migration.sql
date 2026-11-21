-- Owner decision 2026-11-21: permanently delete the trades of the retired
-- Binary (LEGACY_BINARY) and CFD engines on DEMO accounts, with the demo
-- ledger rows that point at them. Their TradeShadow rows go by cascade.
--
-- LIVE legacy trades and their ledger rows are kept: those rows explain real
-- balances. Users no longer see them (listTradesForActor skips retired modes).
-- None of these trades is open, and no referral qualification names one.
-- Production dry run before merge: 4,902 trades, 8,542 ledger rows,
-- 3,354 shadow rows; 936 LIVE legacy trades kept.
--
-- Ledger rows first, so a failure in between never leaves ledger rows behind
-- for trades that are gone.

DELETE FROM "Transaction" x
USING "Trade" t, "Account" a
WHERE x."refType" = 'Trade'
  AND x."refId" = t."id"
  AND t."accountId" = a."id"
  AND a."type" = 'DEMO'
  AND t."mode" IN ('LEGACY_BINARY', 'CFD');

DELETE FROM "Trade" t
USING "Account" a
WHERE t."accountId" = a."id"
  AND a."type" = 'DEMO'
  AND t."mode" IN ('LEGACY_BINARY', 'CFD');
