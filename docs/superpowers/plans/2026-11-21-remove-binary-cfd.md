# Remove the Binary and CFD engines

**Approved by the owner on 2026-11-20** ("Can I permanently delete the Binary and CFD engines? yes").
This plan says what goes, what stays, and in which order. Each phase is its own PR, stacked on the previous one.

## Facts (checked 2026-11-21)

- **Production never runs the old engines.** `apps/engine/src/main.ts` line 36 starts the OTC engine and returns when `OTC_ORDER_BOOK_ENABLED=true`, which it is in production. The Binary trade desk, the CFD desk, the tick loop, the price feeds (Binance, Fyers, Twelve Data), the bot crowd, the legacy WebSocket server and the legacy internal HTTP API are all after that line. (`TRADING_MODEL=CFD` is also set in `.env.production`, but it is never reached.)
- **No open Binary or CFD trades.** Production `Trade` counts:

  | Mode | Trades | Last opened |
  |---|---|---|
  | `LEGACY_BINARY` | 4,182 (all settled) | 2026-10-23 |
  | `CFD` | 1,656 (all closed) | 2026-11-03 |
  | `OTC_FIXED` | 1,862 | today |

- **OTC is independent.** The OTC boot imports only the affiliate jobs, ws-ticket auth, bank feed, chain watchers, push and the Tatum runner. None of them use the old trading, feed or algorithm modules. The only crossing is a type import (`Notifier`) in `push/trade-results.ts`.
- **Size:** about 5,200 lines of non-test engine code, plus `@asm/pricing` (862 lines, used only by the old engine, the seed and the market-catalogue sync). Parts of `@asm/algo` (1,648) and `@asm/trading` (344) stay: OTC, the database layer and the website still use some of each.

## What stays

- **Every old trade, and every ledger row and balance effect.** History keeps showing old Binary and CFD trades, so the read path (`tradeViewFrom`, `cfdTradeViewFrom`) and the `TradeMode` enum values stay. No database column or enum value is dropped. Old rows need them, and removing them gains nothing.
- **The OTC engine, the jobs it runs, and the website and app APIs the OTC flow uses.**

## Phases

**A. Engine: delete the unreachable code** (no behaviour change in production)
1. `main.ts` only starts OTC. The `OTC_ORDER_BOOK_ENABLED` and `TRADING_MODEL` switches go.
2. Delete `loop.ts`, `server.ts`, `internal-api.ts`, `controller-bridge.ts`, `sentiment.ts`, `trading/`, `feeds/`, `algo/`, `bots/` and `assets/registry.ts`, with their tests.
3. Move `Notifier` into `push/`.
4. Check: engine OTC tests, a local engine start, and the production log after deploy shows `otc.started` and no errors.

**B. Website: remove the Binary and CFD trading paths**
1. Delete `/api/cfd/*`, `CfdTradeTicket`, `CfdTradesPanel`, `CfdPositionStrip` and `use-cfd-market-status`.
2. `TradeWorkspace` and `/api/v1/bootstrap` always use OTC (no `tradingModel` switch).
3. Admin "Algorithm" and "Win rate" pages: removed only if they control nothing but the old Binary engine. Each is checked first.
4. History, statements and admin trade views keep rendering old trades.

**C. Shared packages**
1. Delete `@asm/pricing`; move the few constants the seed and catalogue sync need into `@asm/db`.
2. Trim `@asm/algo` and `@asm/trading` to what is still imported.

**D. Mobile app** (ships with the next app release)
1. Remove the CFD branches in `socket/trades.ts`, `trade/markets.ts`, `MarketPill` and `MarketSheet`.
2. The server keeps answering older app versions the same way, so nobody is forced to update.

**E. Clean-up after the deploys:** remove `TRADING_MODEL` and `OTC_ORDER_BOOK_ENABLED` from `.env.production` and `.env.production.example`.

## Needs the owner

1. **Landing and SEO wording.** The page title is "SEBI Regulated CFD Trading Platform", and the landing says "adjust leverage, go long or short". Neither describes OTC fixed-time trades. The owner chooses the new wording; this plan doesn't change marketing copy on its own.
2. **Old trades in History:** keep showing them (recommended), or hide them.
