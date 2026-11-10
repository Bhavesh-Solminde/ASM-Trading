# Gold breakout comparison

Candidate chosen on development data only: **intraday**. Status: **failed_holdout_do_not_deploy**.

Reference starting capital: **$100,000**, risk 0.25% per trade.
XAU/USD sizing assumes 100 oz/lot and a 0.01-lot minimum/step (1 oz). Default prices are GC futures, NOT broker XAU/USD.

| Period | Strategy | Net P&L | Return | Max drawdown | Trades |
|---|---|---:|---:|---:|---:|
| development | intraday | $2,505.99 | 2.51% | 1.42% | 107 |
| development | daily | $1,551.45 | 1.55% | 0.48% | 7 |
| holdout | intraday | $-484.71 | -0.48% | 1.52% | 45 |
| holdout | daily | $-164.32 | -0.16% | 0.22% | 2 |
| full | intraday | $1,979.07 | 1.98% | 1.56% | 152 |
| full | daily | $1,387.13 | 1.39% | 0.48% | 9 |
| holdout_double_costs | intraday | $-662.68 | -0.66% | 1.55% | 45 |
| holdout_double_costs | daily | $-172.74 | -0.17% | 0.23% | 2 |

Development: 2025-01-30 to 2026-04-17 exclusive. Holdout: 2026-04-17 to 2026-10-24 exclusive.
Each period starts flat with the same capital. Full-period results are descriptive, not selection evidence.

## Interpretation and limitations

- No result establishes which strategy will earn more in the future.
- Public Yahoo GC=F continuous OHLC history; individual contracts, roll dates and roll costs are unavailable. Roll discontinuities can affect signals and P&L.
- XAU/USD minimum-lot sizing is modeled. Futures prices cannot reproduce broker XAU/USD quotes, basis, spreads or execution.
- Defaults: $0.30/oz adverse execution per side, $0.035/oz commission per side, and 8% annualized overnight carrying cost on notional for both longs and shorts. All doubled in stress tests. These are placeholders, not broker quotes. Actual swaps may be asymmetric, credited, or triple-charged on specific days.
- Intraday uses hourly signals, enters 08:00–15:00 New York, and exits at the 16:00 bar open; missing exit bars cause delayed exits at the next available open, possibly overnight. Counts appear in metrics.json. Other schedules are not tested.
- Daily uses provider daily bars and next daily open, holding until stopped; calendar/session conventions differ from hourly bars.
- Stops are checked before trailing updates. Gap stops use the worse open. Drawdown is sampled at bar closes, so intrabar drawdown may be worse.
- Notional exposure is capped at 1x equity. Broker margin/stop-out rules are not modeled; this cannot place live orders. Contract unit and costs are configurable; see metrics.json for the actual run settings.
- Only approximately two years of prices, with a shorter holdout. Low trade counts and a single market regime can make rankings unreliable.
- Null provider rows are omitted, not forward-filled. Holidays/data gaps are not independently reconciled against an exchange calendar.
- 45/65-bar sensitivity results are in metrics.json and do not change the frozen selection.

Reproduce with `python3 backtest.py`; run correctness checks with `python3 -m unittest -v`.
Source: https://query1.finance.yahoo.com/v8/finance/chart/GC=F (2y, 1h and 1d).
Broker CSVs are supported; see README.md. A broker-specific run is required before evaluating deployment.
