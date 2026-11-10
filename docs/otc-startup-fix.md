# Artificial trend defect: cause, fix and verification

The owner's 5 November screenshots identified a real startup defect. Earlier
green matching/ledger/recovery/load tests did not establish price-path quality
when the first real quote differs from a placeholder. That verification gap
is acknowledged here; the older results must not be presented as proof that
the affected initial charts were realistic.

## What happened

The old service created its books before its first external poll. With an empty
reference cache, the generic worker used illustrative catalogue prices for the
initial 45-minute generated warm-up. A little later, real quotes arrived. The
bots then converged from those unrelated placeholders to the real prices,
creating hours of mostly one-direction movement.

The affected local database confirms this directly. Its first fetched references
were applied at approximately **2:12 PM IST**, after the initial history existed.

| Market | First generated opening price | First fetched reference |
| --- | ---: | ---: |
| SOL | 150.014 | 96.82 |
| DOGE | 0.150007 | 0.07699 |
| ADA | 0.499979 | 0.1992 |
| WTI | 65.007 | 88.07 |
| Brent | 69.986 | 95.14 |

The falling crypto and rising oil/index charts were therefore consistent with
an artificial initialization gap. It was not corrected by changing candle
colours, copying the demo's bot settings, or testing accounting alone.

Evidence: [original database audit](verification/otc-startup-defect.json).
The original local database is retained under `otc_integration` on port55439;
its trades and candles were not rewritten to hide the problem.

## Fix

- Under the single-writer lock, a fresh service polls references and calibrates
  before constructing its first worker/history. Seed time includes the completed
  pull's receipt time. This does not apply a future quote to an existing candle.
- A fresh durable runtime requires a finite, verified non-illustrative quote
  for every market. Missing references prevent startup with a named error;
  no published placeholder charts are created.
- Existing checkpoints still recover unchanged. The fix does not erase stored
  executions, rewrite accepted contracts or force a new price over an old book.
- Calibration and provider cooldowns remain persistent. An overlapping process
  cannot bypass the writer lock to start another bootstrap poll.
- The corrected local preview uses the fresh `otc_preview_fixed` database on
  port55439. It starts from saved real references, then normal provider polling
  continues. The previous database is preserved for comparison.

## What was tested

Earlier website acceptance used **30 markets, 200 internal bots each, six-second
simulation ticks, 92% fixed-profit contracts**, normal registered USER + LIVE
accounts, and ten requested trades/account in cohorts of1,10,20,40,100. Balanced,
buy-heavy, sell-heavy, burst and staggered flows were exercised. DEMO isolation,
SL/TP, expiry, refunds, ownership, private notifications and balances were checked.
Worker performance tests also used frozen illustrative references; those tests
proved conservation/determinism/load, not real-reference startup quality.

The new price-path check runs **all30 markets × three seeds (503,731,991), each
for180 simulated minutes**, after45minutes of generated warm-up, with200bots per
market and noTobs. It freezes the exact recorded real quotes and measured
volatility calibration, recording every input and result. It compares correctly
seeded books with the old placeholder-first sequence.

All90 runs passed. Maximum observed close-price distance from its frozen
reference was **3.356%**; first generated opening prices were within0.5%.
The8% excursion assertion is a deliberately wide regression boundary to detect
the previous20–60% drift. It is not a promise about future markets or a target
for individual candles, trader wins/losses or platform profit.

Evidence: [full path inputs/results](verification/otc-reference-path-proof.json).
Reproduce from `apps/engine` with the project's `tsx` runner:
`tsx scripts/otc-reference-path-proof.mjs /absolute/path/to/saved-reference-array.json`.

Actual PostgreSQL coordinator checks additionally prove that missing SOL input
creates no checkpoint/history, and a96.82 SOL input seeds around96.82 rather
than150. Restart, execution, settlement and transport tests continue to pass.
Fresh preview persisted candles were separately inspected against all30 references.

## Requested interface changes

The main website no longer draws external reference lines or labels, and no
longer renders Order book/Market flow or Chart performance sections below the
chart. The underlying simulation still uses reference prices and matched orders.

SL/TP is selected by dragging draft lines on the chart, with keyboard adjustment
also supported. Choose Buy/Sell levels before placing the corresponding trade.
No SL/TP number fields remain. Accepted positions keep their original fixed
levels; draft movement applies only to the next trade. The server still validates
levels against the actual matched entry, and ambiguous retries keep their key
and original body even if the displayed price subsequently crosses a level.

DOM interaction checks prove snapped drag values, navigation restoration,
direction validation and request/retry payloads. They are not real browser
frame-rate or visual measurements. Fresh browser control remains unavailable
because the tool reports local browser access disabled.
