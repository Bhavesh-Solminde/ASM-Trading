# OTC with fixed expiry, SL/TP, and an order-driven market

Updated: 2026-11-03. Status: first isolated prototype implemented; production application code unchanged.

This is the current proposed direction for new OTC trading. It supersedes the CFD direction in `trading-model-plan.md` for this work. Existing CFD records and open positions need an explicit migration path; they must not acquire different settlement terms.

## 1. Confirmed product rules

| Item | Rule |
| --- | --- |
| Product | Synthetic OTC Up/Down contracts, without CFD leverage or floating monetary P&L |
| Duration | A fixed expiry selected when opening |
| Profit on a win | 92% of the stake, snapshotted at entry |
| ₹100 stake | Debit ₹100 at entry; credit ₹192 on a win, ₹0 on a loss, ₹100 on an expiry tie |
| Take profit | First qualifying TP touch before expiry settles a win at the full fixed payout |
| Stop loss | First qualifying SL touch before expiry settles a loss of the full stake |
| Still open at expiry | Compare the expiry reference price with entry: Up wins above entry; Down wins below; equality refunds |
| Manual close | Unavailable in both UI and server API for these contracts |
| Price feed | One shared synthetic order-driven market per asset, continuously operated by bots |
| Chart | Lightweight Charts with the demonstrated TradingView colors is the proposed first integration; final library selection remains open |

The early-exit payout rules were explicitly confirmed on 2026-11-03. SL is an early full-loss trigger, not a way to limit a ₹100 stake to a ₹20 loss. Explain this beside the controls and on the confirmation view.

## 2. Two different books

Keep the **underlying market order book** separate from the **customer contract registry**.

1. Bots submit bids, asks, cancellations, and marketable orders into the underlying instrument's book.
2. Matching orders generate executions. Executions determine the last price, candles, and simulated volume.
3. Customers buy fixed-payout Up/Down contracts referencing that common price. Their stake is not a quantity of BTC or gold and does not automatically become an underlying buy/sell order.
4. A contract settles on the same recorded price stream that users can see.

```text
Bot strategies → market commands → matching engine → committed execution stream
                                                       ├→ OHLCV → chart / history
                                                       ├→ depth / trade tape
                                                       └→ OTC trigger and expiry service → account ledger

Customer Up/Down request → admission checks → stake reservation + contract registry
```

This preserves the requested fixed-payout product. Direct user limit/market orders in the underlying book would require another product with quantity, inventory, fills, and ownership rules. Optional treasury hedging is a separate later design, not an implicit conversion of each customer stake into market pressure.

## 3. Underlying matching engine

Build a server-side, deterministic engine, with one ordered command stream and one active writer per asset.

- Prices are integer ticks; quantities are integer lot units. Money remains integer minor currency units. Convert at API boundaries.
- Use best price first and FIFO within each price. Execute at the resting order's price; support partial fills and book-depth consumption.
- Initially implement resting limit orders, marketable limit orders with a maximum execution price, cancellation, and order lifetime. Unfilled immediate-or-cancel quantities expire rather than becoming accidental resting liquidity.
- Validate positive prices/quantities, order ownership, size limits, and sequence numbers. Prevent accidental matching of orders from the same bot identity.
- Give bots finite simulated cash/inventory and reserve both for resting orders. Reject unfunded commands and keep cash/inventory accounting consistent across partial fills, cancellations, and restarts.
- A cancellation changes depth, not the last traded price. Only executions change the tradable reference price.
- An empty or one-sided book does not invent fills. Publish the health condition and stop accepting new contracts when price freshness or depth requirements fail.
- Retain execution ID, command sequence, market timestamp, maker/taker IDs, side, price ticks, and quantity. These IDs connect the chart, triggers, and settlement audit.

The matching convention follows the price/time model described in [Coinbase's execution policy](https://www.coinbase.com/legal/eea/order-execution-policy). This is a design reference, not use of Coinbase data or services.

## 4. Bots and market flow

Use several independent strategy families rather than one bot alternating equal buys and sells.

| Bot family | Activity |
| --- | --- |
| Liquidity providers | Quote several levels on both sides; adjust size and quote skew for their own inventory |
| Noise traders | Submit small randomized orders with varied timing, size, and direction |
| Momentum traders | Respond to recent executed returns, with position and order-rate limits |
| Mean-reversion traders | Trade against distance from their own slowly evolving valuation |
| Larger participants | Split occasional larger decisions into smaller orders to produce depth consumption and replenishment |

Each market has its own seed, starting valuation, tick/lot sizes, depth budget, volatility/activity profile, and inventory limits. Slow shared factors can later introduce correlation between related markets. Strategy valuations influence orders; they never write candle prices directly.

Use irregular event timing, varied order lifetimes, inventory constraints, and quiet/busy activity regimes. Judge resulting spreads, return distributions, volume, volatility persistence, depth, and price impact in simulations. A matching engine alone does not guarantee realistic-looking price behavior.

The browser prototype in `demos/chart-comparison/market-sim.js` is only an illustrative starting point. It lacks the durable log, funding constraints, recovery, and settlement guarantees required here. The referenced Krafer video is inspiration; this plan does not claim an exact reconstruction of its implementation.

### When customer traffic arrives

- Keep bots running continuously, including when no customers are viewing the market.
- The same underlying market serves every account. Customer connection count should not change market speed or bot count.
- Maintain participant awareness per market: the server knows which participants are human customers and which are provisioned bots, and which have active buys/Up or sells/Down. This requirement was added by the user on 2026-11-03.
- Tag participant origin (`HUMAN` or `BOT`) on the server from trusted account/provisioning records, never from a browser-supplied flag. Keep participant origin separate from account balance type (`DEMO` or `LIVE`). A human using a demo account is still a human participant.
- Track connected human viewers separately from humans with open contracts. Publish a strategy snapshot with `BOT_ONLY` or `HUMAN_ACTIVE` mode, active human participant count, active Up/Down contract counts and stake totals, and underlying bot bid/ask counts and quantities. Include the source sequence/version so replay uses the same observations.
- The market registry retains per-participant active records for monitoring; bot strategies receive anonymized market-level totals, without customer personal details. Human contract stakes remain separate from underlying bot order quantities; do not add the two into one depth/volume total.
- Switch to `HUMAN_ACTIVE` when the first human contract is accepted; return to `BOT_ONLY` after the last human contract settles/refunds. A disconnected customer with an open contract still counts. Opening a chart without placing a contract changes viewer counts only. Recover these counts from durable open-contract state after a restart, deduplicate lifecycle events, and reconcile counts to avoid drift.
- Bots may adapt to executed volatility, spread, available depth, their own inventory, and aggregate human activity. The initial bounded adaptation can replenish quote depth or adjust quote sizes as human participation grows, within the same funding and market limits. Exact adaptation parameters need simulation. Their strategies must not read customer SL/TP levels, expiry buckets, account identity, loss streaks, or desired outcomes.
- Customer payout exposure belongs in admission limits and treasury monitoring. It must not rewrite the underlying price path or previously published executions.
- More connected users require fan-out capacity; more open contracts require efficient trigger indexes. Neither requires a different matching rule.

The current legacy governor, outcome restamping, magnets, affiliate verdict overrides, and corrective settlement ticks must be absent from the new OTC execution path. Reusing the old binary feature flag without addressing these branches would not implement this design.

## 5. Settlement and event ordering

Recommended contract lifecycle:

```text
OPEN → SETTLEMENT_PENDING → WON / LOST / REFUNDED
```

`SETTLEMENT_PENDING` describes a frozen decision awaiting durable account settlement; implement it explicitly or with an equivalent durable decision record. Keep outcome separate from close reason: `TAKE_PROFIT`, `STOP_LOSS`, `EXPIRY`, or `MARKET_UNAVAILABLE`.

- Entry is captured from the latest fresh, committed execution by the server. The customer cannot choose entry price, timestamps, payout, or reference sequence.
- Serialize entry acceptance with market events. Reserve the stake transactionally, and do not mark a contract active until its opening state and reference sequence are durable. Define compensation for an interrupted reservation/activation.
- For Up: SL must be below entry and TP above. For Down: TP below entry and SL above. Reject off-tick, immediately crossed, and disallowed-distance levels.
- Evaluate SL/TP on **every committed execution**, not just the chart's throttled updates or candle high/low. An actual jump through a level qualifies; capture the observed execution price and trigger level separately.
- A market sequence resolves multiple executions sharing a timestamp. The first qualifying pre-expiry execution wins the transition, and the other bracket is disabled.
- Recommended boundary rule: only executions with market time strictly before expiry may trigger SL/TP. At the expiry boundary, evaluate the expiry price using the latest eligible committed execution at or before the deadline. Never substitute a later execution. Use an ordered expiry event so the boundary is unambiguous.
- Define a maximum reference-price age per asset/duration. Ordinary quiet periods can use a still-valid last execution. If no valid price exists at the deadline, refund with `MARKET_UNAVAILABLE`; do not wait for a later favorable/unfavorable tick.
- On server failure, recover a committed decision first, then replay durable pre-deadline events. If the evidence cannot establish a valid result, use the documented refund rule rather than generating missing prices retrospectively.
- Use one atomic conditional transition and one idempotent ledger credit per contract. Trigger, expiry, retries, duplicate messages, and restart recovery must never double-pay.
- Snapshot payout and settlement-rule version at entry. Persist entry/exit sequences, exact expiry time, bracket values, close reason, decision time, and account credit.
- For the first implementation, lock SL/TP after entry. Later bracket editing would need its own sequencing and economic validation. Chart dragging before submission remains possible.

## 6. Fixed payout and bracket constraints

Fixed 92% payouts make arbitrary early-exit levels economically significant. A TP one tick above entry with no SL can win on a brief upward touch even if the price later finishes lower. It therefore has a different win probability from an ordinary expiry-only Up contract.

For decisive outcomes, expected customer profit is `stake × (1.92 × winProbability − 1)`. Break-even is approximately **52.08%** wins among non-refunded trades. A 50/50 decisive result gives an expected house margin of 4% of stake before costs, not guaranteed profit. Refunded trades contribute no profit or loss.

Recommended first release: optional **predefined bracket presets** per market and duration, rather than unrestricted SL/TP dragging. Both the exact presets and whether one-sided brackets can be offered remain undecided. Symmetric distances alone are not a proof of sustainable payout behavior under trends, jumps, and inventory dynamics.

Before enabling a preset, simulate expiry-only, TP-only, SL-only, and paired brackets across quiet/trending/volatile regimes, with adversarial selection of direction, timing, and distances. Include statistical uncertainty and correlated customer positions. Expose only validated presets. If none fit the fixed payout, revise the offered levels or early-exit feature; do not tune prices against existing contracts.

Risk controls operate before entry: maximum stake, per-account and per-market concurrent exposure, gross payout reserve, correlated outcome stress tests, and an admission pause if reserves or feed health are insufficient. Existing accepted contracts retain their terms.

## 7. Chart and customer interface

- Start by connecting the shared simulated stream to the existing Lightweight chart adapter, with bullish `#089981` and bearish `#f23645`, matching wicks, volume colors, grid, and crosshair from the comparison demo.
- Keep a chart-library adapter boundary so approved Advanced Charts files can be integrated later if selected. The current TradingView public widget cannot display this private OTC stream.
- Show the market as synthetic OTC. Depth and volume represent the simulated underlying market; customer stake totals are separate information.
- Render candles from the committed executions used by settlement. Add entry, expiry countdown/marker, and permitted SL/TP lines with explicit fixed win/loss labels.
- Ticket: direction, stake, duration, allowed optional bracket preset, profit on win, and total returned on win. No leverage, liquidation, CFD spread fee, manual close, or floating monetary P&L.
- Open contracts show remaining time and price relative to entry. Settled contracts show reason, entry/exit reference prices, stake, profit/loss, and total credit.
- Stream current prices, current candles, depth, and trades with sequence numbers. Throttle screen updates independently from matching and trigger evaluation.
- Persist simulated executed volume: the current shared candle types and database model contain OHLC only and need extending. A no-fill interval must not fabricate volume; outage gaps remain distinguishable from healthy quiet periods.

## 8. Repository implementation map

| Area | Existing pieces | Planned work |
| --- | --- | --- |
| Market engine | `apps/engine/src/assets/registry.ts`, `loop.ts` | Add a separate order-driven OTC market path and lifecycle |
| New core | Proposed `packages/market-sim/` | Integer order book, matching, bot state/strategies, deterministic replay |
| Settlement | `apps/engine/src/trading/trade-desk.ts` | Add a dedicated OTC desk; reuse accounting concepts, not outcome-steering hooks |
| Payoff | `packages/trading/src/outcome.ts` | Reuse fixed-payout credit/refund arithmetic; add trigger/expiry decision helpers |
| Contracts | `packages/contracts/src/trade.ts`, `ws.ts` | Add explicit product/rule version, OTC bracket schema, close reason, reference sequences, feed/depth events |
| Persistence | `packages/db/prisma/schema.prisma`, trade repository | Add market commands/executions, snapshots/checkpoints, durable settlement decisions, OHLCV, and explicit trade product identity |
| API | Existing `/api/trades`, engine internal API | Version/discriminate OTC entry and listing; reject close/modify requests inconsistent with locked OTC terms |
| Web | `PriceChart.tsx`, trade workspace/tickets, trades/history panels | Use OTC contract views and chart adapter; keep historical CFD rendering for CFD records |
| Admin | Existing market configuration and monitoring | Market health, bot inventory, depth, outstanding payout exposure, refunds, replay/settlement errors |

Do not infer trade product solely from `stopLoss`, `takeProfit`, or `durationSec`: both products can have them. Audit legacy records and backfill an explicit discriminator using verified provenance before routing old records to any settlement service. Historical UI labels must follow the stored product.

Use one writer per market, fenced ownership on failover, durable ordered events, bot-state snapshots including PRNG state, and replay from a checkpoint. Persist sufficient events before acknowledging their results or exposing them as tradable prices. Include a recoverable outbox so publishing and settlement resume after interrupted writes.

## 9. Implementation sequence and review points

1. **Market-only prototype.** Build one server-side OTC market, bot book, depth, trade tape, and Lightweight chart. Include a participant-awareness monitor showing bot-only/human-active mode and separate human contract and bot order totals. Use simulated accounts only. Review chart movement and mechanics before replacing application trading.
2. **Deterministic core and recovery.** Test price/FIFO matching, partial fills, funding reservations, self-match policy, cancellation, monotonic events, seed replay, snapshots, restart equivalence, and single-writer ownership.
3. **Contract rules and economics.** Implement fixed payouts and ordered SL/TP/expiry decisions; determine preset bounds through the simulations in section 6. Test ties, jumps, exact expiry boundaries, missing/stale data, and same-timestamp events.
4. **Account integration.** Implement product discrimination, stake reservation, durable decisions, idempotent settlement, and restart recovery using simulated balances. Verify bonus/real balance splitting remains consistent where applicable.
5. **OTC interface.** Restore Up/Down fixed-expiry ticket, preview-only bracket selection, 92% payout labels, price overlays, countdowns, and correct history. Remove manual-close actions for OTC contracts at server and UI levels.
6. **Migration rehearsal.** Replay recorded scenarios; reconcile every stake debit and credit. Classify existing records. Keep their original settlement service until all in-flight positions drain; prevent dual ownership.
7. **Cutover preparation.** Choose enabled assets, expiry menu, validated bracket presets, depth/freshness thresholds, stake/exposure limits, bot budgets, and rollout controls. Review a runnable simulated end-to-end flow before changing the active application model.

Required acceptance results: all viewers share the same market; OHLCV reconstructs from executions; human/bot classification is server-owned; participant modes and counts survive disconnects, duplicate events, and restart; human stake never appears as underlying executed volume; no contract outcomes steer bot orders; one reference stream explains every settlement; every contract settles or refunds exactly once; recovery does not change recorded decisions; OTC APIs cannot manually close; ₹100 produces exactly ₹192/₹0/₹100 in the specified cases.

## 10. Remaining choices

- Final chart library: use the completed color-matched Lightweight demo as the first implementation candidate; the user's earlier TradingView preference is not treated as revoked.
- Initial asset list and expiry menu: existing code supports several durations, but this is not approval to expose all of them on the new engine.
- Allowed bracket presets, including whether one-sided brackets are available. This requires the economic experiments above.
- Starting market depth, bot cash/inventory budgets, volatility targets, price freshness limits, and contract exposure limits.

The next concrete build is step 1: one isolated OTC market with bots, visible depth and executions, and the matching candle chart. Customer account migration follows after that behavior is reviewable.


## 11. First implementation — 2026-11-03

Working branch: `codex/otc-market-prototype`, based on `origin/main`, in
`/Users/solminde/.codex/worktrees/otc-market-prototype/asmtrading`.

- `packages/market-sim/`: integer funded order book, seeded bot strategies,
  execution-built OHLCV, demo contract lifecycle and human/bot activity snapshots.
- `demos/otc-market/`: local-only server and chart/ticket/monitor UI at
  `http://127.0.0.1:4180`; see its README for start and check commands.
- 32 bots, two hours of matching-generated history, a shared market across viewers,
  depth, trade tape, participant awareness and experimental symmetric liquidity adaptation.
- Demo wallets and fixed-payout expiry/SL/TP let us exercise participant changes.
  Browser-created participants are always tagged HUMAN; underlying bots are server-owned.
- No application database, Redis, production engine, external feed or payment service
  is connected. All prototype state resets on restart.

This completes the first demonstrable slice, not the durable/live system. Next:
checkpoint/event-log recovery, full replay equivalence, market calibration,
adversarial bracket economics, treasury admission limits, and application migration.

Prototype boundary convention: expiry precedes an execution with exactly the
same timestamp; SL/TP require a strictly earlier execution. The preceding reference
must be no more than five seconds old or the demo contract refunds. This makes
the choice in section 5 concrete for this prototype; version it before app integration.


## 12. Krafer-model revision and playback — 2026-11-03

The user requested a closer recreation of the linked simulator and fast-forward
controls. The first four-family model is now replaced in this demo by an
independent implementation of the creator's publicly described random-limit
mechanics. See `demos/otc-market/README.md` for the reference and explicit differences.

The prototype now has 1,000 server-owned traders, persistent unfilled quantities,
integer matching, finite simulated bot capital, execution-based OHLCV and sampled
historical depth bands. It starts with twelve hours of matching-generated history.
Price formation has no shared moving valuation or externally imposed trend.
Human awareness still changes only symmetric order size and never targets exits.

`Playback` supplies one simulated clock shared by every viewer. Pause/resume,
1×/10×/60×/300× and +1m/+10m/+1h execute the same intermediate events as normal
playback. Contract entry, quote freshness, SL/TP, expiry and feed timestamps use
that clock. The sparse model uses a two-simulation-minute maximum reference age,
replacing the first prototype's five-second limit. A paused clock freezes expiry;
stepping forward still settles contracts. Retried forward requests are idempotent.

Verification includes cadence-independent deterministic replay, speed/step path
equivalence, paused expiry, complete intermediate candle rendering, simulated-time
freshness, HTTP shared controls and accelerated settlement. Browser visual review
remains unavailable while local browser control is disabled in Work settings.
All changes remain local/demo-only; durable recovery and live integration are not
part of this revision.


## 13. Candle-boundary correction — 2026-11-03

The first execution previously overwrote each minute's carried opening price,
which hid the movement from the previous close and produced disconnected bodies
and extra zero-body candles. Price-state candles now preserve their opening
boundary sample and include it in high/low. Five-minute and higher resampling
keeps that same opening convention even when an initial sub-minute is quiet.
Actual fills, reference prices, matching, payout decisions and executed volume
are unchanged. Genuine quiet and round-trip doji candles remain visible.

A deterministic 721-bar comparison had 548 disconnected opens before the change
and zero after it; trade sequence, execution tape, depth and total volume match
exactly. Regression checks cover single-fill moves, quiet bars, higher-timeframe
boundary opens and the existing fast-forward behavior.


## 14. Activity comparison — 2026-11-03

The remaining flat candles are actual zero-movement intervals or doji candles,
not disconnected opens. The demo now shows recent quiet-minute and unchanged-close
counts, and explains the hovered bar's state. Shared activity presets retain the
original approximate five submitted orders per minute while offering explicit
experimental Active/Busy settings at roughly 20/50. The choice changes future
participation only; it does not rewrite history, force a fill or invent price
movement. These are submitted-order expectations, not guaranteed executions.


## 15. User-requested opposite-human demo flow — 2026-11-03

The user explicitly requested bots that trade opposite human contracts. This
supersedes the earlier direction-independent strategy choice for this visible,
isolated demo scenario only. It does not authorize a production account migration.

250 bots now respond to aggregate net human stake; 750 keep ordinary random-limit
activity. More Up stake causes response Sell limits, more Down stake Buy limits,
and balanced/no human positions produce normal behavior. Response decisions have
four times baseline participation probability and the same finite funding and
1% limit-price boundaries. The monitor shows the direction, order counts, executed
quantities and an explicit comparison toggle. This is custom behavior, not a claim
about Krafer's original code.

Old response orders are cancelled on direction changes, neutralization or disable.
Expiry and SL/TP remove positions from aggregate exposure, so later bot decisions
stop following settled trades. No specific SL/TP, expiry deadline, account identity,
loss streak or predetermined win/loss is a strategy input. Fills remain actual
book matches and there is no guarantee of a particular price move or trade result.

Tests cover Up→Sell, Down→Buy, stake weighting, neutral exposure, reversals, funding,
resting-order cancellation, disable/expiry, visible UI controls and HTTP behavior.


## 16. Multiple entries and disclosed aggregate stress scenario — 2026-11-03

The local paper preview now supports batches of 1–20 entries, up to 20 active
contracts per participant, and mixed Up/Down positions through separate batches.
Investment is per trade; the ticket displays combined stake and the return if all
win. Batch entry is atomic and request-idempotent. Each contract retains independent
SL/TP and expiry settlement with the agreed 92% profit on a win.

The user requested a bot reaction aimed at a worse combined human result. This is
implemented only as a visibly labelled adversarial paper scenario, selectable
against the previous net-stake comparison mode. It compares stakes, entry prices
and directions of all open human contracts at hypothetical common settlement
prices, including tie refunds, and chooses the nearest minimum-credit price band.
250 response bots submit funded Buy/Sell limits toward that band; 750 ordinary
bots keep trading. Response limits obey the 1% radius and selected band boundary.

The strategy does not set prices, rewrite outcomes, target personal SL/TP, or read
identities or expiry deadlines. Book matches produce all executions. Different
expiries, early SL/TP and available liquidity can make actual results differ from
the hypothetical comparison; losses are not guaranteed. This remains an isolated
local demo with simulated balances and no authorization to deploy it for real users
or money. The page discloses the adversarial mode and permits switching it off.

Validation covers atomic debit/rollback, retry consistency, simultaneous limits,
independent settlement, exhaustive payout-band comparisons, deterministic funded
matching, expiry cleanup, batch UI totals, mode disclosure and HTTP integration.


## 17. Count-independent aggregate objective and audit — 2026-11-03

The user clarified that combined human money is the objective, not how many
people lose. Active humans are still counted from distinct owners with open
contracts, but this count no longer changes any bot quantity, timing, side or
price. The old per-human liquidity multiplier is removed in both response modes.

The local preview now displays all-human open stake, settled stake, returned
money, realized net and settled win/loss/refund counts. Open stakes are not
reported as realized losses. Realized net uses actual credited returns minus
settled stakes, including exact per-contract payout rounding.

A disclosed paper-crowd lab adds synthetic HUMAN-role accounts to the shared
market: 1–100 people, 1–200 total positions, up to 20 per account. Inputs include
stake, direction mix, expiry and optional demo brackets. Viewer wallets and own
trade lists remain separate. Additions are atomic, retry-safe and guarded by the
same local-origin and capacity restrictions. These are not real human users.

Tests prove identical portfolios have identical market orders, fills, wallets,
reservations and aggregate settlement when split across 1, 5 or 20 owners. Other
checks include staggered entries/expiries, brackets, unequal stakes, idle viewers,
refund accounting, rollback, fast playback, 100-human loads and HTTP/UI controls.

The offline audit ran 1,080 deterministic simulations covering 600 distinct
portfolios and 480 owner-grouping comparisons. Owner grouping was identical in
480/480 comparisons. 530 portfolios ended at a combined loss and 70 at a profit.
The current hypothetical common-price policy therefore does not meet an
unconditional every-run loss guarantee. This limitation is reported explicitly;
no settlement is overridden or claimed successful to hide profitable outcomes.
The user has been asked to distinguish a loss-seeking order-book scenario from a
clearly labelled scripted loss demonstration. That choice remains pending.


## 18. Actual simulation selected; money-scaled response and simultaneous audit — 2026-11-03

The user selected actual matched-order outcomes and authorized autonomous work.
The earlier question in section 17 is resolved: no scripted price or loss outcome.
The objective remains combined human money, with human count displayed only.

In this isolated paper demo, response strength now uses avoidable common-price
payout: current-price credit minus the minimum credit across candidate bands.
A factor of 1 + min(3, amount / ₹10,000) multiplies response participation and
quantity, capped at 4×. This is explicit experimental demo calibration. Funding,
matching, the 1% limit radius and selected-band boundary remain enforced. It does
not guarantee every portfolio loses. No production account or payment integration
is added. Baseline bot quantity remains 1–20 lots; responding orders may reach 80.

The lab now permits up to 2,000 trades per paper-crowd addition and includes
presets for 1, 10, 20, 40 and 100 people with ten trades each. The requested audit
ran 240 response-on portfolios plus 240 matched response-off comparisons: eight
combinations, two entry schedules and seeds 1/2/3 for each of the five groups.
Batch: ten trades per user at 10:00:00 IST on 03 Nov 2026. Rounds: one per user
every 30 seconds through 10:04:30. Combinations include uniform and mixed sides,
a large ₹1,000 minority trade against nine ₹100 trades, and varied expiry/SLTP.

All five group totals were negative for humans across their 48 portfolios:
1 user −₹37,644; 10 users −₹358,872; 20 users −₹637,104;
40 users −₹1,375,968; 100 users −₹3,432,240. Fourteen individual portfolios were
positive and remain recorded. House contract cashflow is the opposite of human
net, excluding bot inventory valuation and costs. This is not a profit forecast.

Records include 164,160 trades, 2,640 entry combinations, 44,880 market snapshots
and 26,286 featured fills, all with exact timestamps and IDs. The audit verifies
ordinary settlement/payout evidence, balances, funding/conservation, complete
expiry cleanup and exact candle OHLC/volume from a full execution journal. A
separate Python pass reconciles all CSVs and produces four chart images plus a
locally served report at /reports/simultaneous/. The chart paths remain highly
volatile: the largest consecutive fill move was 3.48%, and entry-to-final-settlement
reference changes ranged from −24.97% to +17.29%. These are synthetic stress paths,
not calibrated live Bitcoin behavior. Zero-volume/doji candles are never hidden.

The broader owner-invariance audit was rerun after this change: 480/480 ownership
comparisons stayed identical; 525/600 portfolios lost and 75 profited. The new
simultaneous audit is a separate dataset and is not substituted for those results.


## 19. 70% net-loss target experiment — 2026-11-03

The user requested approximately ₹7,000 lost and ₹3,000 returned for every
₹10,000 staked. This is a total-money return ratio, not a trade-loss count.
The fixed 92% profit payout, ordinary expiry/SLTP settlement and matched prices
remain unchanged. The new `target-return-demo` mode is visibly labelled and is
the preview default. The previous lowest-return mode remains selectable.

The price-band solver now supports a credited-return objective: choose the band
closest to the remaining 30% credit budget, after deducting actual returns
already paid across all session stakes. It reports selected credit separately
from minimum possible credit and shows the target gap. Response strength uses
reduction in absolute target error. Human count remains display-only and settled
credits are never removed to correct the ratio.

The requested ratio was NOT achieved. The new audit ran 240 portfolios and
82,080 trades across the same five user counts, eight combinations, two schedules
and three fixed seeds. Money-weighted actual net loss was 37.09%, with 62.91%
returned. Only 29/240 portfolios came within a stated ±5 percentage-point test
tolerance of 70% loss. The acceptance result is explicitly false in
reports/return-target/verification.json. Unit/accounting correctness does not
prove the requested outcome. No failed portfolio was omitted.

A hard feasibility case is covered by tests: ₹5,000 Up and ₹5,000 Down at the
same entry and expiry return ₹9,600 on any non-tie price, or ₹10,000 on a tie.
Net loss is therefore 4% or 0%, and cannot be approximately 70% for that valid
portfolio under the agreed payoff rules. A long-run ratio could vary with trade
mix and timings; the current implementation cannot promise the requested ratio.

All target-mode CSV trades were independently reconciled to their summaries.
The local report at /reports/return-target/ contains the actual results, the
failed acceptance check and a chart comparing target with observed loss rates.
The earlier /reports/simultaneous/ dataset remains a separate historical audit.


## 20. Smart-human account-cycling and funded-risk lab — 2026-11-03

The user requested smart humans who try to profit, cash out a first win instantly
and recreate accounts. A separate local funded lab now models momentum, mean
reversion, book imbalance, public-counter-following, adaptive, first-win-exit and
mixed agents. Strategies only see past/current public observations, mature their
shadow predictions before learning, and can abstain. Confidence is a heuristic,
not a calibrated probability of SL/TP profit. No agent sees future fills or the
market RNG. First-win-exit agents stop permanently; other agents cash out all
available funds after each trial and can fund a fresh account from the same
person's finite outside bankroll. Losses are not erased when an account closes.

PaperRiskDesk starts accounts at zero, enforces trusted caller ownership and
single-use funding receipts, makes order/withdrawal retries idempotent, locks
committed stakes and retains linked-person account/exposure/rolling limits.
Before accepting a trade it reserves the full possible credit, not just netted
opposite stake. Valid wins and available funds remain immediately withdrawable.
This is memory-only simulated funding. There are no payment/authentication/KYC
adapters; scenario identity links and caller context are assumed, not detected.
The chart demo's free virtual seed funds are not a cash funding source in this lab.

The main audit ran 210 markets across 1/10/20/40/100 people, seven strategies,
three seeds and response on/off: 33,381 trades, 166,905 ledger events, 7,182
person summaries, 25,410 reserve snapshots and 12,990 immediate winning cashouts.
42 portfolios profited for humans, including seven response-on portfolios. These
profits are retained and paid. Minimum free reserve was ₹71,472. Independent
Python replay reconciled each deposit, stake, payout, withdrawal and closure,
checked causal decision timestamps and verified every winning cashout's timing.

18 guard tests cover account cycling, first-win cashout, funding replay, concurrent
withdrawals, committed balances, caller impersonation, stale quotes, client-field
spoofing, linked limits, stake sizing, reserve exhaustion and conservation.
A separate actual-market stress case with 100 adaptive humans and only ₹1,000
house capital rejected 234 new trades before acceptance while paying 200 winning
cashouts. No withdrawal was rejected; minimum free reserve was ₹10.40.

The report and records are served at /reports/smart-humans/. The user's follow-up
request to prevent profitable humans is answered in docs/smart-human-protection-plan.md:
prevent abuse and bound downside before acceptance, without promising that every
human loses or revoking valid wins. Future multi-market master reserves, drawdown
buffers and durable/authenticated financial processing are plan items, not claims
of completed production protections. Fixed 92% profit payouts imply a 4% expected
house margin under a 50/50 equal-stake assumption, not a guaranteed per-user result.


## 21. Repeatable bot weaknesses and clearer chart explanations — 2026-11-03

The user asked the agent to find repeatable advantages itself, then asked for a
plain explanation of the charts and response ON/OFF. The chart report now has
separate profit/loss and reserve images, full rupee amounts, plain strategy labels
and explicit response definitions. Archived totals are unchanged.

The audit tested eleven fixed candidates with training seeds 1–20, locked one
candidate per market mode, then used untouched seeds 101–160 and a ten-person
capacity check: 1,020 cases and 6,269 held-out/capacity trade records. Legacy
bot-follow entries observed no active cue in 400 examined opportunities because
prior positions were already settled. The new background-flow probe exercises
actual active cues, not its momentum fallback.

A small published-direction follower earned 71.05% stake ROI in lowest-payout
mode and 56.05% in target-return mode, on 165 and 251 holdout trades respectively.
It profited on 51/60 and 53/60 seeds. The adjusted seed-cluster intervals remained
positive. With ten followers the ROI became −9.12% and −14.55%, so the advantage
has a capacity limit. The ordinary-market book signal's positive aggregate ROI
was not confirmed because its adjusted interval included zero. Profitable small
followers did not make the whole house lose: larger retail positions lost more.

A secondary fixed-configuration test used 100 fresh cryptographic-entropy trials
per response mode, matching the runtime draw source. It retained the conditional
cue: 70.65% and 65.71% follower ROI, with 92/100 and 93/100 profitable trials.
These are controlled synthetic scenarios, not guaranteed trading returns.

A separate known-seed replay proof matched 100/100 future observations under the
same code, seed, clock and no unknown orders. The preview now uses buffered Node
cryptographic random draws during warmup and subsequent decisions. Offline seeded
audits stay reproducible. The snapshot exposes no live seed or future draw buffer.
Injection/range/replay regression tests cover this fix; it does not remove the
response-driven economic cue. That structural issue is reported in
/docs/bot-weakness-findings.md and /reports/weaknesses/, with full records.

Removing a market reaction aimed at customer payout liabilities would change the
earlier requirement that bots trade against humans. It has not been silently
removed, hidden, or used to block legitimate winning withdrawals.
