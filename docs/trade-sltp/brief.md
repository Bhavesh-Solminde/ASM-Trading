# SL / TP after the trade is placed — brief

Owner request 2026-11-23 (phone screenshot of /trade, OTC Gold): "fill this red marked space by
increasing length of buy and sell, remove sl/tp from there and keep it only as a check mark instead
of such a big setting and the sl/tp should come after the order is placed (when it is toggled on)
not before it".

Branch `feat/sltp-after-trade` (from main 244862bf). Orchestrator: Claude (plans, reviews, commits).
Workers do not commit, push, stash, switch branches or rebase. Coordination log: `AgentContext.md`.

## Owner decisions (2026-11-23)

1. **Ticket:** the big SL / TP card goes. Only a small check mark labelled "SL / TP" stays. No
   "Buy levels / Sell levels" buttons and no fine print.
2. **Phone BUY / SELL** grow taller and fill the empty band between them and the bottom navigation.
3. **Order of events:** SL / TP is never chosen before the trade. With the tick on, after the trade
   opens, SL and TP lines appear on the chart for that trade. The trader drags them and taps **Set**.
   Nothing protects the trade until Set succeeds.
4. **Changing:** the trader can move or remove SL / TP any time until the trade ends.
5. **Scope:** the website (phone and desktop) **and** the Android app (`apps/mobile`).

## Rules the engine enforces (authoritative)

`E` is the trade's entry price. `P` is the trade's last price when the change is applied in the
engine's ordered command log.
- UP trade: SL < min(E, P) and TP > max(E, P). DOWN trade: SL > max(E, P) and TP < min(E, P).
  So a level can never close the trade instantly, and a losing trade can't be turned into a win.
- `null` means no level. Both `null` removes protection.
- The change is allowed only on the actor's own OTC fixed trade while it is OPEN and before expiry.
- At most 20 changes per trade.
- Idempotent per `requestId`: a retried request never applies twice and returns the same outcome.
- Settlement does not change. An SL hit is LOST (stake lost, reason STOP_LOSS). A TP hit is WON at
  92% (reason TAKE_PROFIT). Otherwise the trade settles at expiry.
- Opening with `stopLoss` / `takeProfit` stays accepted, because installed Android builds still send
  them. The new web and app builds stop sending them.

## Contract (Agent 1 builds it; Agents 2 and 3 code against it now)

- **Web API:** `POST /api/trades/{tradeId}/stops`.
  - Auth is the same as `POST /api/trades`, so it works with the web session cookie and the app's
    bearer token.
  - Body: `{ "requestId": "<uuid>", "stopLoss": number|null, "takeProfit": number|null }`.
  - **200:** `{ "trade": TradeView }`, the updated trade, with `stopLoss` / `takeProfit` set.
  - **409:** `{ "code": string, "error": "<trader-facing text>" }`. Codes:

    | Code | Meaning |
    |---|---|
    | `stop_loss_invalid` | SL is on the wrong side |
    | `take_profit_invalid` | TP is on the wrong side |
    | `trade_not_open` | The trade has already ended |
    | `stops_limit` | Over the 20-change cap |
    | `not_found` | Not the actor's trade, or not an OTC fixed trade |

  - **429:** rate limited. **503:** trading unavailable.
  - Texts come from `tradeRejectionMessage(code)` in `@asm/contracts`.
- **Schema:** `OtcSetStopsSchema` in `packages/contracts/src/otc.ts`, exported from the package index.
- **Broadcast:** after a successful change, the engine sends the updated trade to all the user's
  sockets as the existing `trade:opened` message. That message upserts by id in `applyTradeMessage`,
  so installed app builds pick it up. Clients must not treat a repeat `trade:opened` for a known
  trade id as a new trade, so no "opened" toast or sound.
- **Engine internals (Agent 1):**
  - A durable command `kind: "stops"` in the OTC command log, replayed deterministically like
    `open`.
  - `FixedContracts.setStops(...)` and `MarketWorld.setStops(...)`, plus the worker message.
  - The Trade row's `stopLoss` / `takeProfit` update in the same fenced transaction that applies
    the command.
  - Internal HTTP `POST /otc/trades/:id/stops` with the internal secret, called by the web route
    through `apps/web/src/lib/otc-client.ts`.

## UI behaviour (web: Agent 3, Android: Agent 2)

**The tick:**
- The "SL / TP" tick is remembered per device and means "SL / TP controls on my trades".
- With it on, each new trade opens with draft SL (red) and TP (green) lines on the chart. Place them
  at the same default distance from the current price as today's pre-trade draft.
- The draft lines are draggable, with **Set** and **Cancel**. Either line can be dropped so the
  trader sets only SL or only TP.
- Draft lines must sit beyond both entry and the current price (rules above). Show the engine's
  error text if Set is refused.

**After Set:**
- The lines turn solid and are labelled SL / TP.
- Dragging an active line shows **Update** / **Cancel**. **Remove** clears the levels, or one level
  via its ✕.

**Which trades show lines:**
- Only the focused / selected trade's levels show, so lines don't pile up.
- With the tick on, any open OTC trade the trader selects can get SL / TP the same way.

**Old code:**
- Remove the pre-trade draft: the `OtcProtection` chart overlay, `protectionDraft` plumbing and the
  stops in the open request. On Android, the protection-store pre-trade flow.
- Delete code that only existed for it.

## Agent assignments

- **Agent 1** (terminal 8b12, backend):
  - `packages/market-sim/**`, `apps/engine/src/otc/**`, `packages/db/src/repositories/otc-trade.ts`
    and the OTC db tests.
  - `packages/contracts/src/{otc,trade,ws}.ts` and the index exports.
  - `packages/client-core/**`, only if needed.
  - `apps/web/src/app/api/trades/[id]/stops/route.ts`, plus its test.
  - `apps/web/src/lib/otc-client.ts`.
  - Order: contract first (schema, codes, route), then post in AgentContext; then the engine.
- **Agent 3** (terminal cfcc, web trade page):
  - `apps/web/src/components/trade/**`, `apps/web/src/components/chart/**`.
  - `apps/web/src/lib/chart-protection-preference.ts`, or a new preference file.
  - `apps/web/src/components/shell/PlatformProvider.tsx`, only the trade:opened repeat handling if
    needed.
- **Agent 2** (terminal 98e5, Android app): `apps/mobile/**` only.

## Evidence the orchestrator will check

**Agent 1:**
- Unit tests: `FixedContracts.setStops` and `MarketWorld`.
- Runtime db tests:
  - apply, replay after restart, idempotent retry;
  - each rejection code;
  - an SL hit after a change settles LOST, and a TP hit settles WON;
  - old opens with stops still work.
- Route tests.
- Typecheck for contracts, db, engine and web.

**Agent 3:**
- Component and unit tests.
- Typecheck for web.
- Screenshots (ignored folder `.playwright-mcp/sltp/`):
  - phone 430×932 and 390×844, dark and light, before and after;
  - desktop 1440×900, dark and light;
  - the full flow: tick on → place → draft lines → drag → Set → active → move → Update → Remove.

**Agent 2:**
- Jest tests for the new flow.
- Typecheck for mobile.
- Screenshots from an Android emulator if one runs on this machine. If not, say so and explain why.

The orchestrator runs the isolated DB `asm_affiliate_levels` (localhost:5433), the local engine (ws
4071, http 4072) and web `http://aff.localhost:3271`. Ask it for restarts.
