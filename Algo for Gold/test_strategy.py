import unittest
import tempfile
from pathlib import Path
from datetime import datetime
from dataclasses import replace
from strategy import Bar, Config, indicators, size_units, stop_fill, tighten_stop
from backtest import run, load_csv


def bar(day,o,h,l,c,hour=9):
    ts=int(datetime.fromisoformat(f'2025-01-{day:02d}T{hour:02d}:00:00-05:00').timestamp())
    return Bar(ts,o,h,l,c)


class GoldTests(unittest.TestCase):
    def setUp(self):
        self.cfg=Config(lookback=2,atr_period=2,initial_equity=100000,
                        friction_per_ounce=0,commission_per_side=0,annual_carry_rate=0)
        self.bars=[bar(1,100,101,99,100),bar(2,100,102,99,101),
                   bar(3,101,105,100,104),bar(4,107,109,106,108)]

    def test_channel_excludes_signal_candle(self):
        self.assertEqual(indicators(self.bars,self.cfg)[1][2],1)

    def test_future_prices_do_not_change_past_signals(self):
        a,s=indicators(self.bars,self.cfg)
        b,t=indicators(self.bars[:3],self.cfg)
        self.assertEqual(a[:3],b);self.assertEqual(s[:3],t)

    def test_wilder_atr(self):
        a,_=indicators(self.bars,self.cfg)
        self.assertEqual(a[1],2.5)
        self.assertEqual(a[2],3.75)

    def test_next_open_entry(self):
        _,trades,_=run(self.bars,'daily','2025-01-01','2025-01-05',self.cfg)
        self.assertEqual(len(trades),1)
        self.assertEqual(trades[0]['entry_price'],107)
        self.assertEqual(trades[0]['entry_date'],'2025-01-04')

    def test_gap_stops_both_directions(self):
        self.assertEqual(stop_fill(bar(1,90,94,88,92),1,95),90)
        self.assertEqual(stop_fill(bar(1,110,112,108,111),-1,105),110)

    def test_trailing_never_loosens(self):
        self.assertEqual(tighten_stop(100,1,110,20,2),100)
        self.assertEqual(tighten_stop(100,-1,90,20,2),100)

    def test_current_close_cannot_retroactively_stop_same_bar(self):
        bars=self.bars[:3]+[bar(4,107,121,106,120)]
        _,trades,_=run(bars,'daily','2025-01-01','2025-01-05',self.cfg)
        self.assertEqual(trades[0]['reason'],'sample_end')

    def test_stop_can_hit_entry_bar(self):
        bars=self.bars[:3]+[bar(4,107,108,90,100)]
        _,trades,_=run(bars,'daily','2025-01-01','2025-01-05',self.cfg)
        self.assertEqual(trades[0]['reason'],'stop')
        self.assertEqual(trades[0]['exit_price'],99.5)

    def test_sizing_accounts_for_costs_and_minimum_units(self):
        cfg=replace(self.cfg,friction_per_ounce=.3,commission_per_side=.035)
        n=size_units(100000,3000,100,cfg)
        self.assertLessEqual(n*100.67,250)
        self.assertEqual(size_units(100,3000,100,cfg),0)

    def test_net_profit_deducts_both_sides(self):
        cfg=replace(self.cfg,friction_per_ounce=.1,commission_per_side=.2)
        m,t,_=run(self.bars,'daily','2025-01-01','2025-01-05',cfg)
        self.assertAlmostEqual(t[0]['net_pnl'],(.8-.4)*t[0]['quantity'])
        self.assertAlmostEqual(m['net_pnl'],t[0]['net_pnl'])

    def test_overnight_financing(self):
        bars=self.bars+[bar(7,108,109,107,108)]
        cfg=replace(self.cfg,annual_carry_rate=.365)
        _,t,_=run(bars,'daily','2025-01-01','2025-01-08',cfg)
        self.assertAlmostEqual(t[0]['financing'],t[0]['quantity']*108*.003)

    def test_intraday_exit_at_16_open(self):
        bars=[bar(1,100,101,99,100,6),bar(1,100,102,99,101,7),
              bar(1,101,105,100,104,8),bar(1,107,109,106,108,9),
              bar(1,109,110,108,109,16)]
        _,t,_=run(bars,'intraday','2025-01-01','2025-01-02',self.cfg)
        self.assertEqual(t[0]['exit_price'],109)
        self.assertEqual(t[0]['reason'],'session_exit')

    def test_missing_exit_is_reported_without_fabricating_fill(self):
        bars=[bar(1,100,101,99,100,6),bar(1,100,102,99,101,7),
              bar(1,101,105,100,104,8),bar(1,107,109,106,108,9),
              bar(2,109,110,108,109,8)]
        m,t,_=run(bars,'intraday','2025-01-01','2025-01-03',self.cfg)
        self.assertEqual(m['delayed_session_exits'],1)
        self.assertEqual(t[0]['reason'],'delayed_session_exit')

    def test_short_signal_and_profit(self):
        bars=[bar(1,105,106,104,105),bar(2,105,106,103,104),
              bar(3,103,104,100,101),bar(4,99,100,97,98)]
        _,t,_=run(bars,'daily','2025-01-01','2025-01-05',self.cfg)
        self.assertEqual(t[0]['side'],-1)
        self.assertGreater(t[0]['net_pnl'],0)

    def test_dst_uses_new_york_timezone(self):
        winter=Bar(int(datetime.fromisoformat('2025-01-02T21:00:00+00:00').timestamp()),1,1,1,1)
        summer=Bar(int(datetime.fromisoformat('2025-07-02T20:00:00+00:00').timestamp()),1,1,1,1)
        self.assertEqual(winter.local.hour,16);self.assertEqual(summer.local.hour,16)

    def test_csv_rejects_ambiguous_timezone(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'bars.csv'
            p.write_text('timestamp,open,high,low,close\n2025-01-01T00:00:00,100,101,99,100\n')
            with self.assertRaises(ValueError): load_csv(p)

if __name__=='__main__':
    unittest.main()
