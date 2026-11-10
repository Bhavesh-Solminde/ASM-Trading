# Mobile completion: baseline test repairs (2026-11-01)

The six engine failures reproduced in the Plan 3 baseline-derived checkout before correction: 6 failed / 34 passed across expiry-loop, feed-sources, open-time-overrides and the CFD tick-loop simulation. The relevant implementation and test files were unchanged from commit `899a618`; these were not introduced by mobile P4/P5.

The corrections preserve production trading semantics:

- Closed-market expiry fixtures now implement the registry's real last-published-price API and asset state. The old incomplete registry threw before the scanner, while the loop's error handler correctly swallowed/logged it.
- Binance mapping fixtures include real exchange event timestamps. Missing timestamps are intentionally refused by the feed parser; expected mapped symbol, price and timestamp are all asserted.
- Expiry-bucket examples now verify the current three-second cadence, including both sides of each boundary. The old table still expected five seconds although cadence changed in commit `6d54faa`.
- CFD simulation levels now respect fixed 100× leverage: its stop-loss path stays inside liquidation, its trailing-labelled stop is reachable before liquidation, and an additional unprotected trade explicitly verifies liquidation. All five close reasons are exercised, with exact stop-loss and take-profit payouts. The independent treasury oracle includes the stored leverage, loss floor and mandatory 2× gross-profit cap; it also checks every persisted trade P/L against that oracle. No production risk, fee, leverage, volatility or settlement rule changed.

The catalogue test was identifying a real presentation shortfall: DOGE and USD/JPY had only 2.83 and 2.81 displayed price steps per three-second update, below the existing three-step floor. Their display precision increases by one digit (DOGE 5→6, USD/JPY 3→4). Their tick sizes remain 0.00001 and 0.001; their price calibration and all financial rules remain unchanged. Existing installations receive these presentation values through the normal seed synchronization during deployment, not merely from a native app update.

Validation: engine target suites 40/40; catalogue 3/3; native price formatting 6/6; client-core 121/121; engine and database typechecks; changed-file lint and whitespace checks. The actual seed succeeded against the isolated local `asm_codex_p4_test` database, and querying its Asset rows confirmed the new precisions with unchanged tick sizes. No production database was accessed.

Separate pre-existing limitation found while interpreting the simulation: the engine computes a trailing stop against the current tick rather than retaining a favorable price peak. The simulation previously only asserted the `TRAILING_STOP` reason, despite misleading comments about persistent ratcheting; it now states that scope explicitly. Native mobile protection controls do not expose trailing stops. A separate behavioral change and dedicated sequence test would be needed to alter trailing-stop ratcheting.
