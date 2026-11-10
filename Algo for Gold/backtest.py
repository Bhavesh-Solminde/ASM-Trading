"""Offline, reproducible hourly-versus-daily gold breakout research."""
import argparse
import csv
from dataclasses import asdict, replace
from datetime import datetime, timezone, timedelta
import hashlib
import json
import math
from pathlib import Path
from strategy import Bar, Config, indicators, size_units, stop_fill, tighten_stop

ROOT = Path(__file__).resolve().parent


def load(path):
    raw = path.read_bytes()
    result = json.loads(raw)['chart']['result'][0]
    quote = result['indicators']['quote'][0]
    bars, missing = [], 0
    for i, ts in enumerate(result['timestamp']):
        values = [quote[k][i] for k in ('open','high','low','close')]
        if any(v is None for v in values):
            missing += 1
            continue
        if not all(math.isfinite(v) and v > 0 for v in values):
            raise ValueError('Invalid price')
        o,h,l,c = values
        if not l <= min(o,c) <= max(o,c) <= h:
            raise ValueError('Invalid OHLC')
        if bars and ts <= bars[-1].timestamp:
            raise ValueError('Duplicate or unsorted timestamps')
        bars.append(Bar(ts,o,h,l,c))
    return bars, {'file':path.name,'sha256':hashlib.sha256(raw).hexdigest(),
                  'bars':len(bars),'null_rows_omitted':missing,
                  'first':bars[0].date,'last':bars[-1].date,
                  'symbol':result['meta']['symbol']}


def load_csv(path):
    """UTC Unix timestamp or timezone-aware ISO timestamp; completed bars only."""
    raw = path.read_bytes()
    bars = []
    for row in csv.DictReader(raw.decode('utf-8-sig').splitlines()):
        value = row['timestamp']
        if value.isdigit():
            ts = int(value)
        else:
            dt = datetime.fromisoformat(value.replace('Z','+00:00'))
            if dt.tzinfo is None:
                raise ValueError('CSV timestamps must include timezone')
            ts = int(dt.timestamp())
        o,h,l,c = [float(row[k]) for k in ('open','high','low','close')]
        if not all(math.isfinite(v) and v > 0 for v in (o,h,l,c)) or not l <= min(o,c) <= max(o,c) <= h:
            raise ValueError('Invalid CSV OHLC')
        if bars and ts <= bars[-1].timestamp:
            raise ValueError('CSV timestamps must be unique and increasing')
        bars.append(Bar(ts,o,h,l,c))
    if not bars:
        raise ValueError('Empty CSV')
    return bars, {'file':str(path),'sha256':hashlib.sha256(raw).hexdigest(),
                  'bars':len(bars),'first':bars[0].date,'last':bars[-1].date,
                  'symbol':'user_supplied_XAUUSD_unverified'}


def run(bars, mode, start, end, cfg):
    atrs, signals = indicators(bars,cfg)
    cash = cfg.initial_equity
    position = None
    trades, curve = [], []
    skipped = 0
    delayed_exits = 0
    # Missing scheduled exits execute at the next observed open, never an invented price.
    # This can cause unwanted overnight exposure; count and report every exception.
    def close(price, b, reason):
        nonlocal cash, position
        p = position
        exit_price = price-p['side']*cfg.friction_per_ounce
        commission = p['quantity']*cfg.commission_per_side
        gross = (exit_price-p['entry_price'])*p['side']*p['quantity']*cfg.unit_ounces
        cash += gross-commission
        trades.append({**p,'exit_timestamp':b.timestamp,'exit_date':b.date,
                       'exit_price':exit_price,'reason':reason,
                       'net_pnl':gross-2*commission-p['financing']})
        position = None

    active = [i for i,b in enumerate(bars) if start <= b.date < end]
    for i in active:
        b = bars[i]
        if position:
            days = (b.local.date()-datetime.fromisoformat(position['last_carry_date']).date()).days
            charge = max(0,days)*position['quantity']*cfg.unit_ounces*bars[i-1].close*cfg.annual_carry_rate/365
            cash -= charge
            position['financing'] += charge
            position['last_carry_date'] = b.date
        # Daily bars use provider session dates; hourly execution uses New York time.
        if position and mode == 'intraday':
            if b.date != position['entry_date'] or b.local.hour >= 16:
                delayed = b.date != position['entry_date'] or b.local.hour != 16
                delayed_exits += int(delayed)
                close(b.open,b,'delayed_session_exit' if delayed else 'session_exit')
        if position is None and i > 0 and signals[i-1]:
            allowed = mode == 'daily' or (8 <= b.local.hour < 16 and
                        b.timestamp-bars[i-1].timestamp == 3600)
            if allowed and b.date >= start:
                side = signals[i-1]
                distance = cfg.atr_multiple*atrs[i-1]
                quantity = size_units(cash,b.open,distance,cfg)
                if quantity:
                    entry = b.open+side*cfg.friction_per_ounce
                    cash -= quantity*cfg.commission_per_side
                    position = dict(side=side,quantity=quantity,entry_price=entry,
                                    entry_timestamp=b.timestamp,entry_date=b.date,
                                    stop=b.open-side*distance,best_close=b.open,
                                    financing=0.0,last_carry_date=b.date)
                else:
                    skipped += 1
        if position:
            fill = stop_fill(b,position['side'],position['stop'])
            if fill is not None:
                close(fill,b,'stop')
            elif atrs[i] is not None:
                p = position
                p['best_close'] = (max(p['best_close'],b.close) if p['side'] == 1
                                   else min(p['best_close'],b.close))
                p['stop'] = tighten_stop(p['stop'],p['side'],p['best_close'],
                                         atrs[i],cfg.atr_multiple)
        if i == active[-1] and position:
            close(b.close,b,'sample_end')
        equity = cash
        if position:
            p = position
            equity += ((b.close-p['entry_price'])*p['side']*p['quantity']*cfg.unit_ounces
                       -p['quantity']*cfg.commission_per_side
                       -p['quantity']*cfg.unit_ounces*cfg.friction_per_ounce)
        curve.append({'timestamp':b.timestamp,'date':b.date,'equity':equity})
    peak = cfg.initial_equity
    drawdown = 0.0
    for point in curve:
        peak = max(peak,point['equity'])
        drawdown = max(drawdown,(peak-point['equity'])/peak)
    wins = sum(t['net_pnl'] > 0 for t in trades)
    profit = sum(max(t['net_pnl'],0) for t in trades)
    loss = -sum(min(t['net_pnl'],0) for t in trades)
    result = dict(mode=mode,start=start,end_exclusive=end,
                  initial_equity=cfg.initial_equity,final_equity=cash,
                  net_pnl=cash-cfg.initial_equity,
                  return_pct=100*(cash/cfg.initial_equity-1),
                  max_drawdown_pct=100*drawdown,trades=len(trades),
                  win_rate_pct=100*wins/len(trades) if trades else 0,
                  profit_factor=profit/loss if loss else None,
                  skipped_for_sizing=skipped,delayed_session_exits=delayed_exits)
    assert abs(sum(t['net_pnl'] for t in trades)-(cash-cfg.initial_equity)) < 1e-6
    return result,trades,curve


def write_csv(path,rows):
    if not rows:
        path.write_text('')
        return
    with path.open('w',newline='') as f:
        writer = csv.DictWriter(f,fieldnames=list(rows[0]))
        writer.writeheader(); writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--capital',type=float,default=100_000)
    parser.add_argument('--hourly-csv',type=Path)
    parser.add_argument('--daily-csv',type=Path)
    parser.add_argument('--unit-ounces',type=float,default=1.0)
    parser.add_argument('--friction',type=float,default=0.30)
    parser.add_argument('--commission',type=float,default=0.035)
    parser.add_argument('--annual-carry',type=float,default=0.08)
    parser.add_argument('--output-dir',type=Path,default=ROOT/'results')
    args = parser.parse_args()
    if bool(args.hourly_csv) != bool(args.daily_csv):
        parser.error('Supply both hourly and daily CSVs')
    cfg = Config(initial_equity=args.capital,unit_ounces=args.unit_ounces,
                 friction_per_ounce=args.friction,commission_per_side=args.commission,
                 annual_carry_rate=args.annual_carry)
    if args.hourly_csv:
        hourly,hmeta = load_csv(args.hourly_csv)
        daily,dmeta = load_csv(args.daily_csv)
    else:
        hourly,hmeta = load(ROOT/'data/gc-hourly.json')
        daily,dmeta = load(ROOT/'data/gc-daily.json')
    # Fixed parameters; common dates after a 65-day warmup for sensitivity tests.
    dates = sorted(set(b.date for b in daily[66:]) & set(b.date for b in hourly))
    if len(dates) < 60:
        raise ValueError('Need at least 60 overlapping sessions after 66 warmup bars')
    split = dates[int(len(dates)*0.70)]
    start = dates[0]
    end = (datetime.fromisoformat(dates[-1])+timedelta(days=1)).date().isoformat()
    periods = {'development':(start,split),'holdout':(split,end),'full':(start,end)}
    output = args.output_dir
    output.mkdir(exist_ok=True,parents=True)
    results = {}
    for period,(a,b) in periods.items():
        results[period] = {}
        for mode,bars in [('intraday',hourly),('daily',daily)]:
            metrics,trades,curve = run(bars,mode,a,b,cfg)
            results[period][mode] = metrics
            write_csv(output/f'{period}-{mode}-trades.csv',trades)
            write_csv(output/f'{period}-{mode}-equity.csv',curve)
    # Freeze the choice using DEVELOPMENT only; holdout is never used to switch it.
    selected = max(results['development'],key=lambda m:results['development'][m]['net_pnl'])
    stress = replace(cfg,friction_per_ounce=cfg.friction_per_ounce*2,
                      commission_per_side=cfg.commission_per_side*2,annual_carry_rate=cfg.annual_carry_rate*2)
    results['holdout_double_costs'] = {
        mode:run(bars,mode,split,end,stress)[0]
        for mode,bars in [('intraday',hourly),('daily',daily)]}
    sensitivity = {}
    for lookback in (45,65):
        sensitivity[str(lookback)] = {
            mode:run(bars,mode,split,end,replace(cfg,lookback=lookback))[0]
            for mode,bars in [('intraday',hourly),('daily',daily)]}
    h = results['holdout'][selected]
    status = ('preliminary_only' if h['net_pnl'] > 0 and
              results['holdout_double_costs'][selected]['net_pnl'] > 0
              else 'failed_holdout_do_not_deploy')
    selection = {'selected_research_candidate':selected,'status':status,
                 'live_trading_enabled':False,'selection_basis':'highest development net P&L',
                 'config':asdict(cfg),'instrument':'XAU/USD',
                 'data_kind':'user_csv_unverified' if args.hourly_csv else 'GC_futures_proxy_not_XAUUSD',
                 'warning':'Research only. Broker spread, swaps, lot specifications and execution must be verified. Default data is futures, not spot gold.'}
    payload = {'sources':[hmeta,dmeta],'config':asdict(cfg),'periods':results,
               'sensitivity_holdout':sensitivity,'selection':selection}
    (output/'metrics.json').write_text(json.dumps(payload,indent=2)+'\n')
    (output/'selected_strategy.json').write_text(json.dumps(selection,indent=2)+'\n')
    lines = ['# Gold breakout comparison','',
             f'Candidate chosen on development data only: **{selected}**. Status: **{status}**.',
             '',f'Reference starting capital: **${cfg.initial_equity:,.0f}**, risk 0.25% per trade.',
             'XAU/USD sizing assumes 100 oz/lot and a 0.01-lot minimum/step (1 oz). Default prices are GC futures, NOT broker XAU/USD.',
             '', '| Period | Strategy | Net P&L | Return | Max drawdown | Trades |',
             '|---|---|---:|---:|---:|---:|']
    for name,pair in results.items():
        for mode,m in pair.items():
            lines.append(f"| {name} | {mode} | ${m['net_pnl']:,.2f} | {m['return_pct']:.2f}% | {m['max_drawdown_pct']:.2f}% | {m['trades']} |")
    lines += ['',f'Development: {start} to {split} exclusive. Holdout: {split} to {end} exclusive.',
              'Each period starts flat with the same capital. Full-period results are descriptive, not selection evidence.',
              '', '## Interpretation and limitations','',
              '- No result establishes which strategy will earn more in the future.',
              '- Public Yahoo GC=F continuous OHLC history; individual contracts, roll dates and roll costs are unavailable. Roll discontinuities can affect signals and P&L.',
              '- XAU/USD minimum-lot sizing is modeled. Futures prices cannot reproduce broker XAU/USD quotes, basis, spreads or execution.',
              '- Defaults: $0.30/oz adverse execution per side, $0.035/oz commission per side, and 8% annualized overnight carrying cost on notional for both longs and shorts. All doubled in stress tests. These are placeholders, not broker quotes. Actual swaps may be asymmetric, credited, or triple-charged on specific days.',
              '- Intraday uses hourly signals, enters 08:00–15:00 New York, and exits at the 16:00 bar open; missing exit bars cause delayed exits at the next available open, possibly overnight. Counts appear in metrics.json. Other schedules are not tested.',
              '- Daily uses provider daily bars and next daily open, holding until stopped; calendar/session conventions differ from hourly bars.',
              '- Stops are checked before trailing updates. Gap stops use the worse open. Drawdown is sampled at bar closes, so intrabar drawdown may be worse.',
              '- Notional exposure is capped at 1x equity. Broker margin/stop-out rules are not modeled; this cannot place live orders. Contract unit and costs are configurable; see metrics.json for the actual run settings.',
              '- Only approximately two years of prices, with a shorter holdout. Low trade counts and a single market regime can make rankings unreliable.',
              '- Null provider rows are omitted, not forward-filled. Holidays/data gaps are not independently reconciled against an exchange calendar.',
              '- 45/65-bar sensitivity results are in metrics.json and do not change the frozen selection.',
              '', 'Reproduce with `python3 backtest.py`; run correctness checks with `python3 -m unittest -v`.',
              'Source: https://query1.finance.yahoo.com/v8/finance/chart/GC=F (2y, 1h and 1d).',
              'Broker CSVs are supported; see README.md. A broker-specific run is required before evaluating deployment.']
    (output/'REPORT.md').write_text('\n'.join(lines)+'\n')
    print('\n'.join(lines[:20]))

if __name__ == '__main__':
    main()
