# Algo for Gold — XAU/USD breakout research

Implemented strategy #1: a 55-bar high/low breakout, Wilder ATR(20), a 2×ATR initial/trailing stop, and 0.25% planned equity risk per trade. Both long and short positions are supported. Signals use completed candles and execute on the following bar's open. One position at a time; no averaging down.

**Current decision: do not deploy either version.** Intraday ranked first on development data, but lost money on the untouched later period. The daily version also lost money there and has too few trades for a strong conclusion. The stored selection is a research candidate, not approval for live trading.

## What is here

- `strategy.py`: reusable signal calculation, ATR, risk sizing and stop logic.
- `backtest.py`: chronological simulation, intraday/daily comparison, fixed development/holdout split, doubled-cost stress test, and 45/65-bar sensitivity checks.
- `test_strategy.py`: correctness checks for timing, costs, long/short stops, risk sizing, financing, missing session bars and daylight saving.
- `data/`: frozen public price snapshots and source metadata.
- `results/REPORT.md`: the main comparison using $100,000 reference capital.
- `results/capital-10000/REPORT.md`: separate $10,000 sizing check.
- `results/metrics.json`: complete metrics, source hashes and sensitivity results.
- `results/*-trades.csv` and `*-equity.csv`: auditable fills and equity history.
- `results/selected_strategy.json`: development-selected candidate and failed-holdout status. Live trading is disabled.

Python 3.10+; standard library only. No package installation or broker credentials are needed.

```sh
cd "Algo for Gold"
python3 -m unittest -v
python3 backtest.py
python3 backtest.py --capital 10000 --output-dir results/capital-10000
```

## Strategy variants

**Intraday:** apply the channel and ATR to hourly candles, including available overnight bars. Entries are permitted at hourly opens from 08:00 through 15:00 America/New_York. Close at the 16:00 bar open. If a scheduled exit bar is absent, the simulator uses the next observed open and records a `delayed_session_exit`, which can include overnight exposure. No fills are invented. This is one specific hourly intraday approach, not a search over every possible intraday strategy.

**Daily:** apply the same indicator periods to provider daily candles; enter at the next daily open and hold until a stop or the end of the evaluation period. Trailing stops use the best close since entry and never loosen. New stops become effective on the next bar. A stop crossed by an opening gap fills at that worse open plus adverse execution cost.

The two versions deliberately use different elapsed lookback durations: 55 hourly bars versus 55 daily bars. This tests two practical variants, not the isolated effect of holding overnight.

## Data and cost limitations

**The bundled prices are Yahoo `GC=F` futures history, not XAU/USD broker history.** Attempts to obtain public Dukascopy spot history returned HTTP 429. The futures feed was retained only as a preliminary research proxy. Continuous-contract transitions, price basis and different sessions can distort spot-gold results. Individual contracts and rollover adjustments were not available. These results cannot establish your broker's trading profitability.

The frozen snapshots span approximately October 2024–October 2026. Common evaluation dates begin January 30, 2025 after warmup. The first 70% of common dates select the candidate by net profit. April 17–October 23, 2026 is the untouched holdout. The winner is not switched based on holdout results. Each evaluation starts flat with fresh reference capital; the full sample is descriptive and not additive to separate-period results.

Default **assumptions**, all configurable:

- USD account; $100,000 reference capital so both horizons can usually fit minimum trade sizes. This is a simulation reference, not a funding recommendation.
- 100 ounces per lot, minimum/step 0.01 lot: one sizing unit is 1 ounce. `quantity` in trade logs is the number of minimum-lot units, not full lots. With these defaults, 3 units means 3 ounces or 0.03 lots.
- 0.25% planned risk per trade, including estimated entry/exit transaction costs. Financing and gap losses can exceed this budget.
- $0.30 per ounce per side adverse execution, covering half-spread plus slippage.
- $0.035 commission per ounce per side, equivalent to $7 round trip per assumed standard lot.
- An 8% annualized overnight charge on notional for both longs and shorts, charged for calendar days crossed. This is a sensitivity assumption, not a broker swap schedule; actual swaps can be credited, directional and triple-charged.
- Gross notional capped at 1× equity. No margin calls or broker stop-out model. This deliberately avoids using high leverage merely to increase reported profit.

At $10,000 reference capital, a $25 risk budget cannot fit a one-ounce daily position at the tested volatility, so daily trades are skipped. Zero profit from zero trades is not evidence of a successful strategy. Capital, minimum lot size and risk budget materially affect this comparison.

Maximum drawdown is marked at candle closes, so intrabar drawdown can be worse. Holidays, missing bars and source accuracy are not independently certified. There is no tick-level spread or stop-fill validation. A small number of trades does not establish statistical confidence.

## Use real broker data

Export **completed** hourly and daily OHLC candles for the same XAU/USD symbol and period. CSV columns:

```csv
timestamp,open,high,low,close
2025-01-02T14:00:00Z,2650.0,2655.0,2648.0,2652.0
```

Timestamps must be UTC Unix seconds or ISO timestamps with a timezone. Use the bar's opening timestamp; daily bar dates must identify the intended broker session. Confirm how that session maps to New York dates before running. Prices should be mid quotes for the symmetric cost model; broker bid-only data requires a suitable execution adapter rather than blindly adding symmetric costs. Keep bars sorted and unique; do not fill missing OHLC with invented prices. At least 66 daily warmup bars plus 60 overlapping sessions are required.

```sh
python3 backtest.py \
  --hourly-csv /absolute/path/xauusd-hourly.csv \
  --daily-csv /absolute/path/xauusd-daily.csv \
  --capital 10000 \
  --unit-ounces 1 \
  --friction 0.30 \
  --commission 0.035 \
  --annual-carry 0.08 \
  --output-dir results/broker-study
```

`--unit-ounces` represents the minimum tradable quantity and step in ounces; the current sizing model assumes they are equal. `--commission` is per sizing unit per side. Change these to match actual symbol specifications. A custom broker swap adapter is needed for exact daily swap charges.

## What remains before a live bot

The strategy and historical simulator are implemented; no broker connection or live execution service is included. Once the broker/platform, intended capital and historical quotes are available, first rerun this comparison with actual costs and session rules. A viable result would still need prospective paper trading and a broker adapter that checks minimum lot size, margin, maximum spread, stale prices, duplicate orders, order acknowledgements and server-side stops. With the current failed holdout, automatically submitting trades would not be justified by this research.
