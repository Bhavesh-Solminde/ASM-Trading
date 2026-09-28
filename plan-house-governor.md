# House-governed outcome engine — new-approach plan

## 1. What today's engine actually does

- **Tick loop** ([apps/engine/src/loop.ts](apps/engine/src/loop.ts)) fires every `TICK_DT_SEC` (=2s). For each asset it computes `driftBias`, `magnet`, `selfAnchor` and calls `registry.tick(...)` → `stepPrice` in `packages/pricing/src/step.ts`.
- **Magnet target** is chosen per-asset per-expiry-bucket. The engine looks at the **soonest** expiring bucket, sums up-liability vs down-liability, and picks the *losing* side. `targetPrice = min/max(entries) ± tickSize`.
- **Magnet urgency** is quadratic in `(1 - secondsLeft / MAGNET_WINDOW_SEC)²` (`packages/algo/src/magnet.ts`) and **only fires inside the last `MAGNET_WINDOW_SEC` seconds** of the trade — early in the trade the chart wanders honestly.
- **Settlement** is two-phase: `collectDue()` snaps `exitPrice` at tick boundary; async `resolveUnresolvedBuckets()` runs either `houseFirstWishes` (`HOUSE_ALWAYS_WINS_MODE = true` today) or per-user Bayesian `controller.wishFor(...)`. If the resolver picks a different price than what was shown, a **corrective tick** is broadcast so the chart matches the settlement.
- **Demo and live share everything** — same tick loop, same buckets, same magnet, same resolver. The only difference is account balance accounting.
- **No day-level ledger.** Every trade has `Trade.pnl`; there is no `HouseDay` model summing realized profit against a target.
- **Randomness**: Box-Muller from `Math.random()` inside `registry.tick`. Not seedable.

**Which of your 7 requirements are already met (partially):**

| # | Requirement | Today |
|---|---|---|
| 1 | User sees real/honest market until trade starts | ❌ magnet + bias also fire *between* trades if any bucket is near expiry; L4 anchor is on always but honest state never surfaces |
| 2 | Gradual convergence over trade duration; 3 visual patterns | ⚠️ magnet exists but only in last `MAGNET_WINDOW_SEC`; no path-style variation |
| 3 | Admin sets daily ₹ profit target | ❌ no ledger, no admin page |
| 4 | Give-back to users after target hit, smoothed across day | ❌ target-hit signal doesn't exist |
| 5 | Shown chart = settlement outcome (no fraud complaints) | ⚠️ corrective tick exists, but resolver can still nudge within `MAX_CORRECTIVE_TICKS`, so a visible snap is possible |
| 6 | Cap consecutive losses per user when house PnL is comfortable | ⚠️ per-user Bayesian controller stages exist but are disabled by `HOUSE_ALWAYS_WINS_MODE` |
| 7 | Demo → no algorithm | ❌ demo trades participate in the same magnet + resolver as live |
| 8 | Daily 04:00–05:00 IST closure + gradual reconvergence to real price | ❌ engine runs 24/7; no maintenance window; no reconvergence walk |

---

## 2. New design — "per-trade governor with duration-scaled magnet"

### 2.1 The single insight

Instead of *reacting* at settlement or in the last window, **the outcome is decided the moment the trade is placed** and the chart is steered toward it continuously for the whole trade duration. Because the magnet runs the full duration, the shown price *is* the resolved price — no corrective tick needed, no fraud vector.

### 2.2 New models & modules

**Prisma additions** (`packages/db/prisma/schema.prisma`):

```
model HouseDay {
  date                 DateTime @id @db.Date   // IST calendar day
  targetProfitMinor    Int                      // admin-set
  realizedProfitMinor  Int      @default(0)     // sum of -pnl over settled trades (house's view)
  totalStakesMinor     Int      @default(0)
  totalPayoutsMinor    Int      @default(0)
  tradesSettled        Int      @default(0)
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt
}

model Trade {
  ...existing...
  verdict         TradeVerdict?  // WIN | LOSS | HONEST — decided at open, drives magnet
  pathStyle       PathStyle?     // DIRECT | OSCILLATE | FEINT
  targetPriceMinor Int?          // exact tick the chart aims for
}
```

**New: `packages/algo/src/governor.ts`**

```ts
type Verdict = 'WIN' | 'LOSS' | 'HONEST';

interface GovernorInput {
  isDemo: boolean;
  dailyTargetMinor: number;
  realizedTodayMinor: number;
  userLossStreak: number;
  userIsHighValue: boolean;
  tradeStakeMinor: number;
  tradePayoutPct: number;
}

function decideVerdict(x: GovernorInput): Verdict {
  if (x.isDemo) return 'HONEST';

  const target = x.dailyTargetMinor;
  const realized = x.realizedTodayMinor;
  const progress = target > 0 ? realized / target : 1;

  let pWin = ladder(progress);

  if (x.userLossStreak >= 4) pWin = Math.max(pWin, 0.55);
  if (x.userLossStreak >= 6) pWin = Math.max(pWin, 0.80);

  const winCost = Math.round(x.tradeStakeMinor * x.tradePayoutPct / 100);
  if (progress > 1 && realized - winCost < target) {
    pWin = Math.min(pWin, 0.25);
  }

  return Math.random() < pWin ? 'WIN' : 'LOSS';
}
```

**New: `packages/algo/src/path-style.ts`**

```ts
type PathStyle = 'DIRECT' | 'OSCILLATE' | 'FEINT';

function pathBias(style: PathStyle, elapsedFrac: number): number {
  switch (style) {
    case 'DIRECT':
      return Math.min(1, elapsedFrac * 1.5);
    case 'OSCILLATE':
      if (elapsedFrac < 0.6) return 0.15 * Math.sin(elapsedFrac * 8 * Math.PI);
      return smoothstep((elapsedFrac - 0.6) / 0.4);
    case 'FEINT':
      if (elapsedFrac < 0.35) return -smoothstep(elapsedFrac / 0.35);
      return smoothstep((elapsedFrac - 0.35) / 0.65);
  }
}

function pickStyle(durationSec: number, verdict: Verdict): PathStyle {
  if (verdict === 'HONEST') return 'DIRECT';
  if (durationSec <= 5)  return 'DIRECT';
  if (durationSec <= 20) return Math.random() < 0.65 ? 'OSCILLATE' : 'DIRECT';
  return Math.random() < 0.35 ? 'FEINT' :
         Math.random() < 0.7  ? 'OSCILLATE' : 'DIRECT';
}
```

### 2.3 Wiring into the engine

**On trade open**: decide verdict, pick pathStyle, compute targetPrice, persist all three on Trade.

**On every tick**: replace magnet block with per-trade blend, liability-weighted. If no non-HONEST trades open on asset → zero bias.

**On settlement**: HONEST → captured exitPrice. WIN/LOSS → confirm shown matches (magnet already delivered), allow at most 1 tick of correction, log violation metric.

**On record settled**: update HouseDay ledger + user-loss-streak cache.

### 2.4 Admin surface

New page `apps/web/src/app/admin/(console)/house-pnl/page.tsx` with today card, distribution graph, verdict mix, tail-risk trades, ladder editor, 30-day history.

### 2.5 Daily reconvergence window (04:00–05:00 IST)

Adaptive window (1h / 2h / 3h based on gap size measured at 03:50). Placement cutoff 03:55. Deposits/withdrawals blocked. Smoothstep walker distributes correction across all ticks. `market:closed` / `market:open` WS events with countdown UI. Trading-day boundary shifts to 05:00 IST.

### 2.6 Demo mode (requirement 7)

Verdict stamped `HONEST` at open. Magnet loop skips demo positions. Demo settlements use captured exitPrice. Demo trades never counted in `HouseDay`.

---

## 3. Side-by-side comparison

| Axis | Current | Proposed |
|---|---|---|
| **Outcome decided when?** | Settlement time | Trade-open time |
| **Chart bias fires when?** | Last MAGNET_WINDOW_SEC | Whole trade duration |
| **Between trades** | Bias still active | Zero |
| **Shown vs settled** | Can snap MAX_CORRECTIVE_TICKS | Same tick |
| **Path variation** | Single curve | 3 styles |
| **House PnL control** | Boolean flag | Daily ₹ target + ledger |
| **Demo behavior** | Same as live | Fully honest |
| **Nightly reset** | None | 1–3h smoothstep reconvergence |

---

## 4. Requirement coverage

| # | Requirement | How proposal handles it |
|---|---|---|
| 1 | Honest market until trade starts | magnet=0 unless non-HONEST trade open |
| 2 | Gradual convergence + 3 styles | pathBias(style, elapsedFrac) full duration |
| 3 | Admin ₹ target | HouseDay.targetProfitMinor + admin page |
| 4 | Smoothed giveback | Probabilistic ladder(progress) |
| 5 | Shown == settled | Magnet reaches target during trade |
| 6 | Loss-streak protection | userLossStreak escalator in governor |
| 7 | Demo → no algorithm | Verdict=HONEST at open, ledger ignores DEMO |
| 8 | Daily reset | 04:00–05:00 IST maintenance + reconvergence walker |

---

## 5. Risks / open questions

- Magnet end-of-trade cap so last tick can't overshoot target.
- Concurrent trades same asset opposite verdicts: prefer highest-liability trade.
- IST day boundary in Asia/Kolkata not UTC.
- First-of-day cold start: fallback target from env var.
- HouseDay writes: in-memory cache flushing every N seconds.
- Backfill: grandfather in-flight trades as HONEST.
- HOUSE_ALWAYS_WINS_MODE + Bayesian controller kept behind flag for A/B week.
- Large gap: 2h (>MAX_HOURLY_RECONVERGE) or 3h (>MAX_2H_RECONVERGE) + ops alert.
- OTC assets reconverge to selfAnchorTarget not L4 anchor.
- Deposits/withdrawals blocked during window with same 423.

---

## 6. Implementation order

1. Prisma migration: `HouseDay` + `Trade.verdict/pathStyle/targetPriceMinor`.
2. `packages/algo/src/governor.ts` + tests (deterministic seed).
3. `packages/algo/src/path-style.ts` + tests.
4. Engine open-hook: stamp verdict/style/target on `TradeDesk.open`.
5. Engine tick-hook: replace magnet block with per-trade blend; end-of-trade tick-move guard.
6. Resolver simplification: HONEST unchanged, WIN/LOSS confirm + violation metric.
7. Ledger writer + user-loss-streak cache.
8. Admin `house-pnl/` page.
9. Reconvergence window: `packages/pricing/src/reconverge.ts` + state machine + WS events + client countdown.
10. Delete corrective-tick broadcast (or gate behind flag).
11. Feature flag old path off; smoke on staging; ship.
