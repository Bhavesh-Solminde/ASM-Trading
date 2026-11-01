# Mobile CFD trading

The owner chose to move the native app to the website's CFD model on 2026-11-01.
The server's `/api/v1/bootstrap` supplies `tradingModel`; older servers default to
`BINARY`, retaining the existing binary ticket. Deploy the server and engine
changes before installing a CFD-capable app.

In CFD mode the app offers long/short positions, the shared fixed leverage and
opening-fee calculation, 30s/1m/5m/15m/1h durations, optional stop-loss/take-profit
price-move percentages, manual close, and editing absolute protection levels.
Investment plus opening fee must fit the current account's balance. The server
resolves percentage protection against the actual entry price and remains the
authority for limits, market availability, close lockout and execution.

CFD positions have their own book; binary payout and refund calculations never
consume them. Net profit/loss subtracts the opening fee exactly once. Live P/L
is a mark at the currently subscribed symbol's price; other symbols show a dash.
A close can apply server adjustments, so an estimate is labelled as such. History
uses the actual close timestamp when supplied and retains the recorded fee and
legacy position leverage.

The engine emits full `cfd:trade:opened` and `cfd:trade:settled` messages alongside
the legacy website notification. The native app ignores CFD rows on the binary
channel. Reconnect, foreground and ten-second foreground polling recover missed
closes; polling stops behind the app lock. Mutation calls are single-flight,
time out after fifteen seconds, reconcile, and never automatically retry.
Settlement feedback is announced once for positions this device held open.

The position list returns **every open CFD position** plus the latest fifty
closed positions. The native memory cap retains all open positions and at most
one hundred closed positions. Changing account currency clears the entire
account book, increments its request generation, and rejects responses from the
old currency/generation/session. A delayed socket settlement cannot replace
converted closed amounts. Currency is checked in both the web route and the
engine debit transaction. The latter also checks actor ownership and refuses
frozen/banned owners before creating a trade or debit.

Validation performed on the implementation branch:

- Mobile: 1,506 tests, typecheck, Android production JavaScript export.
- Contracts: 119 tests.
- CFD web API: five focused tests (bearer-aware resolution, ownership,
  currency guard, strict payload, full position DTO).
- CFD engine: four focused transaction refusal tests (currency, frozen/banned
  owner, wrong actor).
- Web and engine typechecks.
- Changed UI/API files lint clean; seven existing unused import/parameter lint
  errors remain in the pre-existing engine files touched by the guard.

Release checks still require the integrated build and a device: place a DEMO
CFD, inspect/modify SL/TP, close manually after the server's lockout, verify the
fee-inclusive net and balance, let another position expire, disconnect at close
and reconnect, switch accounts/currencies and verify history units, and check
English/Hindi layouts at 320dp. `login-trade.yaml` now selects either the binary
sheet or the visible CFD duration preset. Do not fund a live test account or
publish a release as part of these checks without the owner's release process.
