"""Deterministic Donchian breakout signals. No broker access or external dependencies."""
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
import math

NY = ZoneInfo('America/New_York')

@dataclass(frozen=True)
class Bar:
    timestamp: int
    open: float
    high: float
    low: float
    close: float

    @property
    def local(self):
        return datetime.fromtimestamp(self.timestamp, timezone.utc).astimezone(NY)

    @property
    def date(self):
        return self.local.date().isoformat()

@dataclass(frozen=True)
class Config:
    lookback: int = 55
    atr_period: int = 20
    atr_multiple: float = 2.0
    risk_fraction: float = 0.0025
    initial_equity: float = 100_000.0
    unit_ounces: float = 1.0  # Assumed 100 oz/lot, minimum and step 0.01 lot.
    commission_per_side: float = 0.035  # $7 round trip per assumed 100-ounce lot.
    annual_carry_rate: float = 0.08  # Placeholder charge for either side; not broker swaps.
    friction_per_ounce: float = 0.30  # adverse spread + slippage per side
    max_notional_multiple: float = 1.0

    def __post_init__(self):
        if self.lookback < 1 or self.atr_period < 1:
            raise ValueError('Indicator periods must be positive')
        if not 0 < self.risk_fraction <= 0.01:
            raise ValueError('Risk fraction must be positive and at most 1%')
        if min(self.atr_multiple, self.initial_equity, self.unit_ounces,
               self.max_notional_multiple) <= 0:
            raise ValueError('Sizing values must be positive')
        if min(self.commission_per_side, self.friction_per_ounce, self.annual_carry_rate) < 0:
            raise ValueError('Costs cannot be negative')


def indicators(bars, cfg):
    """Wilder ATR and signals known only AFTER each bar closes.

    Channel excludes the signal candle. The executor acts on the following bar.
    """
    atrs, signals, trs = [], [], []
    atr = None
    for i, b in enumerate(bars):
        previous = bars[i-1].close if i else b.close
        tr = max(b.high-b.low, abs(b.high-previous), abs(b.low-previous))
        trs.append(tr)
        if i == cfg.atr_period-1:
            atr = sum(trs)/cfg.atr_period
        elif i >= cfg.atr_period:
            atr = (atr*(cfg.atr_period-1)+tr)/cfg.atr_period
        signal = 0
        if i >= cfg.lookback and atr is not None and atr > 0:
            history = bars[i-cfg.lookback:i]
            if b.close > max(x.high for x in history):
                signal = 1
            elif b.close < min(x.low for x in history):
                signal = -1
        atrs.append(atr)
        signals.append(signal)
    return atrs, signals


def size_units(equity, price, distance, cfg):
    """Integer minimum-lot units; costs included in planned risk; notional cap is not margin."""
    per_contract = ((distance+2*cfg.friction_per_ounce)*cfg.unit_ounces
                    +2*cfg.commission_per_side)
    risk_size = math.floor(max(0, equity)*cfg.risk_fraction/per_contract)
    cap_size = math.floor(max(0, equity)*cfg.max_notional_multiple/
                          (price*cfg.unit_ounces))
    return max(0, min(risk_size, cap_size))


def stop_fill(bar, side, stop):
    """Gap-through stops execute at the worse opening price, before slippage."""
    if side == 1 and bar.low <= stop:
        return min(bar.open, stop)
    if side == -1 and bar.high >= stop:
        return max(bar.open, stop)
    return None


def tighten_stop(old, side, best_close, atr, multiple):
    candidate = best_close-side*multiple*atr
    return max(old, candidate) if side == 1 else min(old, candidate)
