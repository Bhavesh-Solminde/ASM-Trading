# Bot predictability findings

## Confirmed conditional advantage

A small follower can trade in the publicly shown bot direction while larger
background retail positions keep that reaction active. The follower waits six
seconds after the retail entry, reads current public data and takes a ₹100,
30-second position. Retail positions stake ₹1,000 for a minute. Its own order
enters the response policy; no future price or generator state enters its choice.

The audit trained eleven fixed candidates on seeds 1–20, saved one selected rule
per mode before evaluation, and tested untouched seeds 101–160. It ran 1,020 cases
including a ten-person capacity check and recorded 6,269 held-out/capacity trades.

| Mode | Small follower/trader ROI | Profitable seeds | Ten-person ROI |
|---|---:|---:|---:|
| Ordinary market (selected book-imbalance rule) | 10.50% | 24/60 | 10.50% |
| Lowest-payout response (published-bot follower) | 71.05% | 51/60 | −9.12% |
| 70% target response (published-bot follower) | 56.05% | 53/60 | −14.55% |

The ordinary-market finding did not meet the predefined repeatability rule: its
adjusted ROI interval included zero and fewer than 60% of seeds profited. Both
small-follower response cases passed that rule. Bootstrap intervals resample
whole seed scenarios and adjust for the three selected primary comparisons.
These are conditional toy-market results, not a general or guaranteed profit.

A further 100 fresh cryptographic-entropy trials per response mode retained the
same follower configuration. Lowest-payout mode produced 70.65% follower ROI
(92/100 trials profitable); target mode produced 65.71% (93/100 profitable).
Completed trial records preserve the evidence; trial numbers are not seeds.

The advantage did not scale to ten followers because their combined stake changed
the reaction. The house still profited in the small-follower scenarios because
larger background traders lost more. Individual profit and aggregate human loss
can coexist.

## Fixed runtime issue

The preview previously used the known audit seed. A clone with the same code,
seed, clock and no unknown human orders matched 100/100 future observations.
This is a conditional state-replay risk, not a public-price-only trading claim.

The preview now injects buffered Node crypto.randomBytes draws throughout market
warmup and future trading. Offline audits retain explicit deterministic seeds.
The snapshot exposes only the randomness mode, never the live seed or future
draw buffer. Tests verify injection, range checks, seed independence and retained
offline determinism. Fixing replay does not remove economic price-pattern cues.

## Corrected test coverage

The older bot-follow entry schedule observed zero active bot directions in 400
examined opportunities: its 30-second trades had settled before the next one-minute
entry. It used its momentum fallback at entry. The new funded background-flow
probe exercises the actual response cue; held-out small-follower cases observed
416 such cues. Older archived test results remain intact and are marked with
this limitation.

## Remaining design decision

Price pressure that reacts predictably to customer payout liabilities creates a
directional cue. Hiding the on-screen label alone does not remove the relationship
because net stakes and observed price reactions can also reveal it.

The structural fix is price formation independent of desired customer payouts,
with admission, exposure, reserve and drawdown controls handling house risk.
That changes the earlier requirement that bots trade against humans. This audit
does not silently change that product behavior or block valid winning payouts.

The report is served at http://127.0.0.1:4180/reports/weaknesses/. It includes
selection logs, all cases, exact trade records, independent analysis and the
fresh-entropy replication data. It is not a production security certification.
