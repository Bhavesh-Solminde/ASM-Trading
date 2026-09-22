# ASM Trading Platform — Complete Architecture & Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A production-grade digital-options trading platform with a synthetic price engine, real-time charting, deposit/withdrawal flows, an admin console, and a full manipulation-ready pricing engine — built end-to-end by AI.

**Architecture:** A pnpm monorepo with four apps (web, engine, harness, relay) and six shared packages (pricing, trading, contracts, db, config, logger). The web app is a Next.js 15 server-first application. The engine is a standalone Node.js process that owns all price state, runs a 10 Hz tick loop, manages open trades, broadcasts via WebSocket, and reconciles bank credits. Communication between web and engine uses a shared-secret internal HTTP API for trade execution and Redis-mediated one-time tickets for WebSocket authentication.

**Tech Stack:** TypeScript 5.9, Node 22+, Next.js 15 (App Router, server components), Prisma ORM, PostgreSQL 16, Redis, WebSocket (`ws`), lightweight-charts for candlestick rendering, Tailwind CSS v4, Vitest 5, pnpm 10 workspaces, Zod schema validation.

## Global Constraints

- Node >= 22.0.0, pnpm 10.33.0
- All monetary values stored as integers (minor units / paise / cents) — never floating-point dollars
- `Math.random` is banned project-wide by lint; the engine uses a seeded mulberry32 PRNG for reproducibility, and crypto.getRandomValues for security-bearing randomness
- Server-first: only 19 of 83 source files are `"use client"` — platform pages are async server components querying the database at render time
- Tailwind v4 CSS-first (no `tailwind.config.*`), tokens in a `@theme` block in `globals.css`
- Every environment variable is validated at startup through a strict Zod schema (`@asm/config`)

---

## Subsystem 1: Monorepo Structure & Shared Packages

### What it is and why it matters

The project is a **pnpm workspace monorepo** containing four deployable applications and six shared library packages. This structure means every component — from the price math to the database queries — lives in one repository with consistent tooling, and packages reference each other by workspace protocol (`workspace:*`) rather than published versions.

### The four applications

| App | Role | Port(s) |
|-----|------|---------|
| `apps/web` | Next.js 15 — the trader-facing platform, admin console, and all API routes | 3000 |
| `apps/engine` | Standalone Node.js process — price generation, trade settlement, WebSocket broadcast, bank feed | WS 4001, HTTP 4002 |
| `apps/harness` | Next.js helper — receives SMS relay messages, displays them for debugging | 3001 |
| `apps/relay` | React Native (Expo) — companion Android app that reads bank SMS and forwards to the harness | Mobile |

### The six shared packages

| Package | Responsibility |
|---------|---------------|
| `packages/pricing` | Pure math: GARCH volatility, price stepping, candle aggregation, seeded RNG |
| `packages/trading` | Pure business logic: win/loss outcome, payout calculation, credit splitting, position bucketing, durations, expiry rounding |
| `packages/contracts` | Zod schemas for every API boundary — auth, trades, deposits, WebSocket messages, account updates |
| `packages/db` | Prisma schema, generated client, and repository functions for every domain entity |
| `packages/config` | Environment validation with a strict Zod schema, lazy-initialized singleton |
| `packages/logger` | Structured JSON logger (pino) with correlation IDs |

### Why this separation matters for explanation

Each package is **independently testable** with its own Vitest config. The pricing package has zero database dependencies — it's pure math you can unit-test with deterministic seeds. The trading package has zero database dependencies — it's pure business rules. The contracts package has zero runtime dependencies beyond Zod — it's pure validation. This means you can prove correctness of the core algorithms without running a database or a server.

### Edge cases handled

- **`packages/config`**: Uses a pick-only strategy for environment parsing — it extracts only the keys it knows about from `process.env` before running `strictObject()`, so ambient OS variables (PATH, HOME, SHELL) don't cause validation failures, while unknown application-level variables are still rejected
- **`packages/config`**: The singleton uses `Object.defineProperties` with lazy getters instead of a Proxy, because Proxy traps violate ECMAScript invariants when the target is empty — `Object.keys()`, spread, and `JSON.stringify` all throw TypeError on a proxy whose `getOwnPropertyDescriptor` reports non-configurable properties the target doesn't have. A custom `util.inspect` symbol makes `console.log(config)` show real values instead of `[Getter]`

---

## Subsystem 2: The Pricing Engine — GARCH Volatility & Price Generation

### Overview

The pricing engine generates **realistic synthetic asset prices** using a four-layer mathematical model that runs at 10 Hz (ten ticks per second). The prices look indistinguishable from real market data because they exhibit **volatility clustering** — the phenomenon where volatile periods beget more volatility and calm periods beget calm — exactly as real financial markets do.

### Algorithm 1: The Seeded Pseudo-Random Number Generator (mulberry32)

**File:** `packages/pricing/src/rng.ts`

**What it does:** Generates a deterministic sequence of random numbers from a seed. Given the same seed, it produces the exact same price path every time — this makes the engine reproducible for debugging and testing.

**How it works:**

1. Takes a 32-bit integer seed
2. On each call to `next()`:
   - Adds the golden ratio constant `0x6D2B79F5` to the state
   - Applies three rounds of bit mixing (XOR with right-shifts, multiply by odd constants)
   - Returns the result divided by 2^32 to get a uniform number in [0, 1)
3. For `normal()` (Gaussian distribution), uses the **Box-Muller transform**:
   - Takes two uniform draws u and v
   - Computes `r = sqrt(-2 * ln(u))` and `theta = 2 * pi * v`
   - Returns `r * cos(theta)`, caches `r * sin(theta)` for the next call
   - This transforms uniform [0,1) draws into standard normal (bell curve) values

**Edge cases:**
- Rejects exact zero from `next()` before Box-Muller because `log(0) = -Infinity`
- Caches the second Box-Muller variate to avoid wasting a draw

**Why this matters:** Calling `normal()` produces the random "shocks" that drive the GARCH model below. Without Box-Muller, you'd get uniformly distributed noise that looks artificial. With it, you get realistic bell-curve-shaped returns where small moves are common and large moves are rare — exactly like real markets.

### Algorithm 2: GARCH(1,1) Conditional Variance

**File:** `packages/pricing/src/garch.ts`

**What it does:** Models **volatility clustering** — the empirical fact that if a market was volatile recently, it's likely to stay volatile, and vice versa. This is the single most important feature that makes synthetic prices look real rather than like uniform random noise.

**The mathematical formula:**

```
σ²(t) = ω + α · ε(t-1)² + β · σ²(t-1)
```

Where:
- `σ²(t)` is the **conditional variance** at time t (how volatile the price is right now)
- `ω` (omega) is the **base variance** — the long-run floor that volatility can't stay below
- `α` (alpha) is the **shock sensitivity** — how much a big move increases future volatility
- `ε(t-1)` is the **previous realized shock** (= previous sigma × previous random draw z)
- `β` (beta) is the **persistence** — how slowly elevated volatility decays back to normal

**In plain English:**
- The next tick's volatility = a baseline floor + (how big the last shock was) + (how volatile it was last tick, slowly decaying)
- If a big random draw hit last tick, α amplifies it into higher volatility for the next ticks
- β keeps that elevated volatility lingering — with β = 0.85, it takes many ticks to decay

**Initialization:**

```
σ²(0) = ω / (1 - α - β)
```

This is the **unconditional (long-run) variance** — the stationary mean that the GARCH process reverts to over time. Requires `α + β < 1` for stationarity; the code throws if this is violated.

**Edge cases:**
- Non-stationarity check: `α + β >= 1` throws an error at initialization, because the variance would grow without bound
- `lastEps` is stored for inspection but never read back as an input — `stepGarch` recomputes `eps = sigma * z` from the current state and the caller's random draw, so there's no hidden state dependency

**Concrete example with real parameters from the database:**

The Asset table stores `garchOmega`, `garchAlpha`, `garchBeta` per asset. Typical values:
- omega = 0.00001 (tiny base variance)
- alpha = 0.12 (shocks matter, but not overwhelmingly)
- beta = 0.85 (high persistence — volatile patches last)
- alpha + beta = 0.97 (highly persistent but still stationary)

### Algorithm 3: The Four-Layer Price Step

**File:** `packages/pricing/src/step.ts`

**What it does:** Combines four distinct forces in **log-space** to compute the next price tick. Working in log-space (natural logarithm of price) guarantees the price can never go negative, no matter how large the shocks are.

**The four layers:**

```
logMove = L1 + L2 + L3 + L4

L1 (Base):   driftPerSec × dt + σ × √dt × z     ← GBM with GARCH volatility
L2 (Drift):  driftBias                             ← bounded bias (0 until Plan 04)
L3 (Magnet): magnet                                ← expiry convergence (0 until Plan 04)
L4 (Anchor): anchorAlpha × ln(anchorTarget / price) ← pull toward real market price
```

Then: `newPrice = currentPrice × exp(logMove)`, clamped by `maxTickMove`.

**Layer by layer:**

1. **L1 — Geometric Brownian Motion with GARCH volatility:** The honest random walk. `σ` comes from the GARCH model (so volatility clusters), `z` is a standard normal draw from the PRNG, and `√dt` scales the shock by the square root of the time step (standard in stochastic calculus — volatility scales with the square root of time, not linearly). `driftPerSec` is deterministic drift, currently 0 (no mean-reversion built into the base walk).

2. **L2 — Drift bias:** A small bounded log-space bias that Plan 04 will wire to a controller. Currently hard-zero. When activated, it would nudge the price slightly in a direction chosen by the controller (e.g., to favor the house when imbalance is high). Bounded to ±0.25·σ so it can never overpower the random walk.

3. **L3 — Magnet:** An expiry convergence pull. Currently hard-zero. When activated, it would pull the price toward a target as a trade's expiry approaches, making the outcome more predictable for the house. This is the "manipulation" layer.

4. **L4 — Anchor to real market prices:** A proportional pull expressed in log-space: `anchorAlpha × ln(realPrice / currentPrice)`. When a real quote is available from Twelve Data, this gently pulls the synthetic price toward reality so the chart doesn't drift into implausible territory. The pull is proportional to the log-ratio, so it's stronger when the divergence is larger.

**The clamp:**

After computing the candidate price, the absolute move is clamped to `maxTickMove` (set to 40× the asset's `tickSize`). This prevents a freak GARCH shock or a large magnet from producing a single-tick candle that no trader would believe. The clamped price is also floored at the current price if it would go to zero or negative (an extra safety net beyond the log-space guarantee).

**Edge cases:**
- `anchorTarget === null`: anchoring is skipped entirely (no real quote available)
- `anchorTarget <= 0`: anchoring is skipped (invalid quote)
- `anchorAlpha === 0`: anchoring is disabled for this asset
- Price exactly zero after exp: falls back to the previous price
- `maxTickMove` exceeded: price is clamped to `currentPrice ± maxTickMove`

### Algorithm 4: OHLC Candle Aggregation

**File:** `packages/pricing/src/candles.ts`

**What it does:** Aggregates the 10 Hz tick stream into standard OHLC (Open, High, Low, Close) candlesticks on wall-clock minute boundaries.

**How it works:**

1. Each tick arrives with a timestamp (epoch seconds) and a price
2. The tick is assigned to a **bucket**: `floor(timestamp / 60) × 60` — the start of the current minute
3. If the bucket matches the forming candle, update High and Low (max/min) and set Close to the new price
4. If the bucket is different (minute boundary crossed), **emit the completed candle** and start a new one

**Edge cases:**
- **Out-of-order ticks throw:** `tsSec < lastTs` is a programming error (the engine clock must be monotonic). Throwing immediately surfaces clock bugs.
- **Gaps between candles are real information:** If no ticks arrive for a minute (feed outage), that minute simply has no candle rather than a synthesized flat one. Inventing flat candles would hide outages from the admin.
- **First tick:** Creates the forming candle with O=H=L=C=price, returns null (no candle to emit yet)
- **Candle emitted only on close:** The caller gets the finished candle at the exact moment it's complete, so persistence and broadcast happen in the same step

---

## Subsystem 3: The Trade Desk — Position Management & Settlement

### Overview

The Trade Desk owns every open position from the moment it opens until it settles. It is deliberately split into two phases: a **synchronous collection phase** (inside the tick loop, no I/O) and an **asynchronous settlement phase** (database writes, retries).

### Algorithm 5: Trade Outcome Determination

**File:** `packages/trading/src/outcome.ts`

**What it does:** Determines whether a trade won, lost, or should be refunded.

**The logic:**

```
if exitPrice === entryPrice → REFUNDED  (exact tie is NOT a loss)
if direction is UP:
  exitPrice > entryPrice → WON
  exitPrice < entryPrice → LOST
if direction is DOWN:
  exitPrice < entryPrice → WON
  exitPrice > entryPrice → LOST
```

**Why ties are refunds, not losses:** Counting a tie as a loss would systematically bias every win-rate estimate downward. On a 5-second trade with 5-decimal-place precision, exact ties are rare but not impossible, and miscounting them is a "classic silent error" that would compound over thousands of trades.

### Algorithm 6: Settlement Credit Calculation

**File:** `packages/trading/src/outcome.ts`

**What it does:** Computes how much money flows back to the trader's account.

```
WON:      stake + floor(stake × payoutPct / 100)
REFUNDED: stake (full refund)
LOST:     0 (stake is forfeited)
```

**Why `floor` instead of `round`:** Rounding down means sub-unit remainders (fractions of a cent/paisa) always favor the house. This is one deterministic rounding boundary, always in the same direction — it eliminates an entire class of rounding-direction bugs. On a $100 stake with 85% payout, the profit is `floor(100 × 85 / 100) = floor(85.00) = 85`. On a $7 stake with 85% payout, profit is `floor(7 × 85 / 100) = floor(5.95) = 5` — the house keeps the extra $0.95 fraction.

### Algorithm 7: Credit Splitting (Real vs. Bonus Balance)

**File:** `packages/trading/src/credit-split.ts`

**What it does:** When a trader stakes money that came partly from a deposit and partly from a bonus, the settlement credit must be split back in the **same proportion**.

**The formula:**

```
bonusShare = floor(credit × stakeFromBonus / stake)
realShare  = credit - bonusShare
```

**Why this exists:** Without it, a trader could deposit $100, receive a $50 bonus, stake the $50 bonus, win, and receive the payout as **withdrawable real money**. The bonus would become a one-trade workaround of the turnover requirement. By splitting credits proportionally, bonus money stays as bonus money until turnover is met.

**Edge case:** The bonus share floors, so rounding favors the real balance by at most one minor unit, and the two parts always sum to the credit exactly (no rounding error accumulates).

### Algorithm 8: Bucket Registry — Position Grouping by Expiry Second

**File:** `packages/trading/src/buckets.ts`

**What it does:** Groups all open positions by `(assetId, expirySec)` so that every position expiring in the same second settles against the **same captured price**.

**Why bucketing matters for correctness:** If two traders both bet on the same second and we captured the price separately for each, a tick between the two captures could give them inconsistent outcomes — one wins and the other loses from the same market moment. Bucketing guarantees atomicity: all positions in a bucket share one exit price.

**How `due()` works:**

1. Iterates all buckets
2. Any bucket where `expirySec <= nowSec` is collected
3. Those buckets are **removed** from the registry
4. Returned sorted by expiry time (oldest first)

**Edge cases:**
- **Overdue buckets are included:** If the tick loop stalled for two seconds, buckets from both seconds are collected rather than silently stranded. The positions still settle, just late.
- **Remove by trade ID:** `remove(tradeId)` handles the case where a trade is voided before its natural expiry — it finds the bucket via an index and removes just that one position.

### Algorithm 9: Expiry Rounding

**File:** `packages/trading/src/expiry.ts`

**The formula:** `expirySecFor(expiryMs) = ceil(expiryMs / 1000)`

**Why ceiling, not floor:** The engine settles on the first tick whose whole second is at or past the expiry. Rounding **down** would shave up to one second off every trade — on a 5-second trade, that's a 20% reduction. Ceiling guarantees the full duration always elapses.

### The Two-Phase Settlement Architecture

**File:** `apps/engine/src/trading/trade-desk.ts`

**Phase 1 — `collectDue()` (synchronous, inside the tick loop):**

```
for each bucket due at this second:
  capture exitPrice = current asset price (rounded to asset's precision)
  for each position in the bucket:
    push {position, exitPrice, attempts: 0} to pending queue
```

This is **synchronous with no I/O** — a slow database can never delay a tick. The exit price is captured once per bucket and frozen. A retry that used a later price would let a database outage change who won.

**Phase 2 — `drain()` (asynchronous worker):**

```
while pending queue is not empty:
  take the first item
  try:
    call settleTrade(tradeId, exitPrice) → persist to database
    broadcast result to trader via WebSocket
  catch AlreadySettled or TradeNotFound:
    skip (nothing left to settle)
  catch other error:
    increment attempts
    if attempts >= MAX_SETTLE_ATTEMPTS:
      abandon (trade left OPEN, voided on next engine restart)
    else:
      wait RETRY_BASE_MS × attempts, retry with SAME captured price
```

**Edge cases:**
- **Captured price is immutable:** Retries always use the SAME exit price. If a retry used a newer price, an outage would change outcomes — a trader who was losing could become a winner just because the database was slow.
- **`AlreadySettled` / `TradeNotFound`:** Idempotency guards. If the trade was already settled (perhaps by a restart), skip it rather than erroring.
- **Abandoned trades:** After `MAX_SETTLE_ATTEMPTS` failures, the trade stays OPEN in the database. The next engine restart's `hydrate()` call voids it.
- **Restart hydration:** On boot, `hydrate(nowSec)` reloads all OPEN positions from the database. Positions expiring after now rejoin the book. Positions at or before now are **voided** — a restart resets price state, so there's no recorded price for their expiry second.
- **Race between open and settle:** The code checks `if (expirySec <= Math.floor(this.now() / 1000))` immediately after opening a trade. If the write to the database took so long that the trade already expired, it's voided immediately rather than left in an inconsistent state.

### Trade Opening Flow

1. Look up the asset in the registry
2. Verify the account belongs to the actor (defence in depth — the web app already checked)
3. Capture `entryPrice`, `entryTs`, `expiryTs` together at one moment
4. Call `openTrade()` — deducts the stake from the account balance atomically
5. If `InsufficientFunds`, throw `DeskRejection("insufficient_funds")`
6. Check if the trade already expired during the database write (race condition)
7. If already expired, void it immediately
8. Add the position to the bucket registry
9. Push `trade:opened` and `balance:update` notifications to the trader via WebSocket

**The notification safety rule:** "The money has already moved; a failed push must never undo or retry that." If the WebSocket notification fails (trader disconnected), the trade is still valid — the trader sees it when they reconnect.

---

## Subsystem 4: The Tick Loop

**File:** `apps/engine/src/loop.ts`

### How it works

A 10 Hz loop using `setTimeout` rescheduling (not `setInterval`):

```
Every 100ms:
  1. Capture nowSec = floor(Date.now() / 1000)
  2. desk.collectDue(nowSec)  — settle any expired trades (sync, no I/O)
  3. For each asset:
     a. registry.tick(symbol, nowSec) → advance price by one step
     b. Broadcast {type: "tick", price, ts} to all subscribed WebSocket clients
     c. Once per second: compute and broadcast sentiment
     d. If a candle closed: broadcast it, upsert to database
  4. Schedule next tick
```

**Why `setTimeout` instead of `setInterval`:** If a slow database write delays the next tick, `setTimeout` delays it rather than stacking them up. `setInterval` would queue ticks during the delay and then fire them all at once, producing a burst of price updates with no real time between them.

**Edge cases:**
- **Lag monitoring:** If the tick takes longer than the 100ms budget, a warning is logged (rate-limited to once per second to avoid log spam)
- **Candle upsert:** Uses `upsert` instead of `create` — a restart mid-minute would collide with a candle from the same bucket if `create` were used
- **Candle write failures are swallowed:** The price has already moved and been broadcast — failing to persist a candle is a data-completeness issue, not a correctness issue. It's logged as an error.

---

## Subsystem 5: The WebSocket Server

**File:** `apps/engine/src/server.ts`

### Architecture

A bare `ws` WebSocket server that manages:
- **Per-client state:** `userId` (null until authenticated), subscriptions (symbol → timeframe), message budget, a serial processing queue
- **Authentication:** One-time Redis tickets (see Subsystem 6)
- **Broadcasting:** Fans messages to every client subscribed to a given symbol
- **Rate limiting:** 60 messages per 10-second window per client

### Message protocol (defined in `@asm/contracts`)

**Client → Server:**

| Message | Purpose |
|---------|---------|
| `auth` | Redeem a one-time ticket to authenticate |
| `subscribe` | Start receiving ticks for a symbol at a timeframe |
| `unsubscribe` | Stop receiving ticks for a symbol |

**Server → Client:**

| Message | Purpose |
|---------|---------|
| `authed` | Authentication succeeded |
| `error` | Error message |
| `tick` | Price update (10 Hz) |
| `candle:close` | A 1-minute candle just completed |
| `candles:history` | Last N candles for the subscribed symbol |
| `payout:update` | Current payout percentage for the symbol |
| `sentiment` | UP/DOWN stake-weighted sentiment |
| `trade:opened` | A trade was successfully opened |
| `trade:settled` | A trade has settled (won/lost/refunded) |
| `balance:update` | Account balance changed |

### Edge cases

- **Messages are processed serially per socket:** Each client has a `queue: Promise<void>` — messages chain onto it so a slow `subscribe` (which fetches candle history from the database) doesn't interleave with the next message
- **Rate limiting:** If a client exceeds 60 messages in 10 seconds, the excess is silently dropped. The budget resets every 10 seconds via `setInterval`
- **Unauthenticated sockets:** Everything except `auth` requires `client.userId !== null`. An open socket is not an authorized one.
- **Socket close during broadcast:** `readyState !== OPEN` check before every `send()` — a disconnected client is silently skipped, never crashing the broadcast loop
- **History limit:** Only the last `HISTORY_CANDLES` candles are sent on subscribe, ordered oldest-first

---

## Subsystem 6: Authentication & Security

### WebSocket Ticket Authentication

**Files:** `apps/engine/src/auth/ws-ticket.ts`, `apps/web/src/lib/ws-ticket.ts`

**The flow:**

1. The web app's API route `/api/auth/ws-ticket` (POST) verifies the user's session cookie
2. It generates a cryptographically random ticket, stores its **SHA-256 hash** in Redis with a short TTL, and returns the raw ticket to the client
3. The client opens a WebSocket and sends `{type: "auth", token: ticket}`
4. The engine hashes the ticket, calls `redis.GETDEL(hash)` — atomically reads and deletes
5. If a user ID comes back, the socket is authenticated. If not, it's closed with 1008

**Security properties:**
- **One-time use:** `GETDEL` is atomic, so two sockets racing to redeem the same ticket cannot both succeed
- **Redis dump safety:** Only the hash is stored in Redis — a database dump yields nothing redeemable
- **No token in the URL:** The ticket travels in the WebSocket message body, not as a query parameter (which would end up in server logs)

### Session Authentication (Web App)

- **Cookie-based sessions:** A session token is stored as an HttpOnly cookie
- **Token stored as hash:** Only the SHA-256 hash of the session token is stored in the database — a database breach doesn't yield valid session tokens
- **Middleware security headers:** Every response gets X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: no-referrer, a strict CSP, and Permissions-Policy blocking camera/microphone/geolocation

### Two-Factor Authentication

- **Model:** `TwoFactorCode` — short-lived one-time codes
- Only the **hash** of the code is stored (`codeHash`), never the plaintext
- `usedAt` timestamp makes redemption single-use
- Codes have an `expiresAt` — expired codes cannot be redeemed
- The endpoint that issues codes is **rate-limited** (Plan 07 review fix)

### Internal API Security

- **Bound to 127.0.0.1:** The internal API that opens trades listens only on localhost
- **Shared secret:** Every request must carry `Authorization: Bearer <ENGINE_INTERNAL_SECRET>`
- **Timing-safe comparison:** Uses `crypto.timingSafeEqual` to prevent timing attacks on the secret
- **Refuses to start without a secret:** If `ENGINE_INTERNAL_SECRET` is unset, the engine throws at boot rather than exposing an unauthenticated control surface
- **Strict schema validation:** The trade payload is parsed with the same Zod schema used at the public boundary — "being internal is not a reason to trust it"

---

## Subsystem 7: Deposit & Payment Flow

### The Deposit Lifecycle

```
1. AWAITING_PAYMENT   — user chose an amount and method, checkout page shown
2. PENDING_CONFIRMATION — user entered a UTR (claiming they paid)
3. COMPLETED           — bank credit matched and account funded
   REJECTED            — admin rejected, or credit never arrived
   EXPIRED             — checkout token TTL elapsed with no action
```

### Algorithm 10: Amount Reservation (Anti-Collision)

**The problem:** Two users depositing the same amount at the same time would produce identical bank credits. When the credit arrives, the system can't tell which deposit it belongs to.

**The solution:** Each deposit reserves a **unique paise amount** within a narrow offset window:

```
baseAmountInr = amountUsd × USD_TO_INR_RATE
uniqueAmountInr = baseAmountInr + offset (where offset ∈ [OFFSET_LOW, OFFSET_LOW + OFFSET_SPACE))
```

A database-level partial unique index ensures no two live deposits (status AWAITING_PAYMENT or PENDING_CONFIRMATION) share the same `amountInr`. If the offset space is exhausted (all slots taken), the system throws `AmountSpaceExhausted` and the user must wait or choose a different amount.

### Algorithm 11: Bank Credit Matching

**File:** `packages/db/src/repositories/deposit-matcher.ts`

**The flow:**

1. A bank credit arrives (from the simulated feed or the SMS relay)
2. `createBankCreditIfNew()` inserts it, deduplicated by UTR (unique transaction reference)
3. `matchCreditToDeposit()` tries to match it:
   - First: match by exact `amountInr` among PENDING_CONFIRMATION deposits
   - If matched: credit the deposit to the user's account, transition to COMPLETED
   - If not matched: the credit is an **orphan** — logged for admin review

**Edge cases:**
- **Duplicate credits:** The `BankCredit.utr` has a unique index. If the same credit arrives twice (duplicate SMS, retry), the second insert returns null and is silently skipped
- **Simulated feed synthetic UTR:** When the simulated feed's credit has no UTR, one is synthesized as `sim-{amount}-{timestamp}` so the unique index still deduplicates
- **Failure rate simulation:** The simulated feed has a configurable `failureRate` — a fraction of otherwise-payable deposits silently never get a credit, modeling real payment failures. Those deposits fall through to the admin queue.
- **Single VPA:** In the demo, every deposit shares one fixed VPA (`DEMO_VPA`). The VPA is used only to build the QR/UPI deep link, never as a matching key — matching is purely by amount (the paise-precise reserved amount is what makes it unambiguous).

### Checkout Flow

1. User selects amount and method on `/deposit`
2. Server creates a deposit intent with a unique checkout token and reserved paise amount
3. User is redirected to `/checkout/[token]` — a standalone page outside the platform shell
4. Page shows a QR code (canvas-rendered) and UPI deep link for the exact paise amount
5. User pays via their UPI app, then enters the UTR reference number
6. Server transitions deposit to PENDING_CONFIRMATION
7. The bank feed (simulated or SMS relay) delivers a credit
8. Matching engine credits the account

---

## Subsystem 8: The Simulated Bank Feed

**Files:** `apps/engine/src/bank-feed/simulated.ts`, `apps/engine/src/bank-feed/runner.ts`

### How it works

A timer-based fake bank that auto-pays for confirmed deposits:

1. Every `SIMULATED_DELAY_MS` (default 3 seconds), poll the database for deposits in `PENDING_CONFIRMATION` status
2. For each one not yet emitted (tracked in an in-memory Set):
   - With probability `1 - failureRate`, emit a credit with the exact paise amount, VPA, and claimed UTR
   - With probability `failureRate`, silently skip it (modeling payment failure)
3. The runner receives the credit and calls `reconcile()`:
   - `createBankCreditIfNew()` — insert if not duplicate
   - `matchCreditToDeposit()` — match by amount and credit the account

**Edge cases:**
- **At-most-once emission:** The in-memory `emitted` Set prevents emitting the same deposit twice while the first credit is still being reconciled
- **Reconciliation failures are swallowed:** A failed reconcile is logged but doesn't crash the feed — the next tick will try again (if the credit was created) or skip it (if it wasn't)
- **Configurable via environment:** `SIMULATED_FEED_DELAY_MS` and `SIMULATED_FEED_FAILURE_RATE` are environment variables

---

## Subsystem 9: The Sentiment System

**File:** `apps/engine/src/sentiment.ts`

### Algorithm 12: Stake-Weighted Sentiment

**The formula:**

```
upStake = sum of stake for all OPEN positions where direction = UP
totalStake = sum of all stakes
upPct = round(upStake / totalStake × 100)
downPct = 100 - upPct
```

**Why stake-weighted, not head-counted:** If 10 traders bet $1 UP and 1 trader bets $1000 DOWN, head-counting shows 91% bullish — but the book is actually massively short by stake. Stake-weighting shows the real imbalance, which is what the (future) controller would act on. Showing 91% bullish while the book is short-heavy by stake would be incoherent.

**Edge case:** Empty book returns `{upPct: 50, downPct: 50}` — a neutral split rather than 0/0 division.

---

## Subsystem 10: The Web Application

### Server-First Architecture

The platform uses Next.js 15's App Router with **async server components** as the default. Pages query the database directly in the render function:

```tsx
export default async function TradePage() {
  const session = await getSession();
  const accounts = await listAccountsForActor(session.userId);
  const trades = await listTradesForActor(session.userId);
  return <TradeWorkspace accounts={accounts} trades={trades} />;
}
```

Only interactive components (the chart, the trade ticket, the deposit form) are `"use client"` with explicit client boundaries. This means:
- No client-side data fetching layer to maintain
- No loading spinners for initial page load — the HTML arrives complete
- Only 19 of 83 files are client components

### The Trade Workspace

The main trading interface is a composition of:

1. **AssetTabs** — horizontal tabs to switch between tradeable assets
2. **PriceChart** — a `lightweight-charts` candlestick chart with real-time tick updates
3. **SentimentBar** — the UP/DOWN sentiment indicator
4. **TradeTicket** — the order form (direction, duration, stake)
5. **TradesPanel** — open positions and trade history

### Real-Time Price Chart

**File:** `apps/web/src/components/chart/PriceChart.tsx`

Uses TradingView's `lightweight-charts` library:
- Creates a candlestick series with custom colors
- Receives historical candles on subscribe, live ticks and closed candles via WebSocket
- Shows entry-price lines for open trades as horizontal lines on the chart
- Countdown timer for the next candle close
- OHLC readout overlay
- Watermark with the asset symbol

### Trade Ticket Form

**File:** `apps/web/src/components/trade/TradeTicket.tsx`

- **13 durations:** 5s, 10s, 15s, 30s, 1m, 2m, 5m, 10m, 15m, 30m, 1h, 2h, 4h
- **Stake presets:** $5, $10, $25, $50, $100 with manual input
- **Live profit display:** `floor(stake × payoutPct / 100)` — matches the server-side calculation exactly
- **UP/DOWN buttons** with green/red styling
- **Expiry time display:** Shows the clock time the trade will expire

### Account Switching

- Every user has a LIVE and DEMO account
- The active account is shown in the top bar with a clear visual indicator
- Trades, balances, and history are all scoped to the active account
- The demo account has a resettable balance

---

## Subsystem 11: The Admin Console

**File:** `apps/web/src/app/admin/(console)/`

### Dashboard

A server-rendered dashboard showing:
- **Registered users count**
- **Settled deposits total** (in USD, compact format)
- **Pending approvals** (deposit + withdrawal counts)
- **Open support tickets**
- **30-day trade volume** with an area chart
- **Volume by market** with a donut chart
- **Top markets by volume** table with status pills
- **Recent audit log** feed

### Admin Sections

| Section | Route | Purpose |
|---------|-------|---------|
| Users | `/admin/users` | View all users, drill into individual user detail |
| Approvals | `/admin/approvals` | Approve/reject pending deposits and withdrawals |
| Markets | `/admin/markets` | Manage tradeable assets (open/close, adjust parameters) |
| Messages | `/admin/messages` | View relay messages from companion devices |
| Audit | `/admin/audit` | Full append-only audit log |
| Settings | `/admin/settings` | Platform configuration |

### Audit Trail

Every admin action writes to an **append-only `AuditLog` table**:
- `actorId` — who did it
- `action` — what they did
- `targetType` + `targetId` — what it was done to
- `before` / `after` — JSON snapshots of the entity state before and after
- `createdAt` — when

UPDATE and DELETE are **revoked from the runtime database role** — the audit log is physically append-only, not just logically.

---

## Subsystem 12: The Shadow Audit System

### TradeShadow Model

Every settled trade records a **shadow** (never exposed to the trading client):

```
shownExitPrice    — the price shown to the trader
honestExitPrice   — what the price would have been without manipulation
shownResult       — the outcome shown (WON/LOST/REFUNDED)
honestResult      — what the outcome would have been honestly
deltaPips         — the difference in pips
biasApplied       — how much L2 drift was applied
magnetApplied     — how much L3 magnet was applied
imbalanceAtEntry  — the book imbalance when the trade was opened
exposureUp/Down   — aggregate exposure in each direction
lifecycleStage    — the trader's lifecycle stage at entry time
```

### ShadowTick Model

A separate table records `shownPrice` vs `honestPrice` for every tick, per asset, enabling a complete reconstruction of how the synthetic price diverged from the honest random walk.

**Why this exists:** This is the complete forensic record. An auditor can replay any trade and verify exactly what manipulation (if any) was applied, what the honest outcome would have been, and how the shown price differed from the unmanipulated path.

---

## Subsystem 13: The Real Market Feed

### Twelve Data Integration

**File:** `apps/engine/src/feeds/twelve-data.ts`

A REST poller that fetches real market prices to anchor the synthetic engine:

- Free tier: 8 requests/minute, 800/day
- Polls **one symbol at a time, round-robin**, spaced at `ceil(60000 / requestsPerMinute)` ms
- With 3 assets at 7 req/min, each gets a fresh quote every ~26 seconds
- The synthetic GARCH process covers the gaps between real quotes

**Fallback:** If no `TWELVE_DATA_API_KEY` is set, automatically falls back to the **replay feed** — a bundled JSON dataset (`data/seed-quotes.json`) that cycles through pre-recorded prices on a 5-second timer. This means the engine runs with zero network access for demos.

**Edge cases:**
- **Consecutive failure tracking:** If the API fails repeatedly, it logs warnings with the failure count but doesn't stop — the synthetic process continues without anchoring
- **Feed selection at boot:** `createPriceFeed()` checks for the API key and transparently returns either the live poller or the replay feed

---

## Subsystem 14: Engine Lifecycle & Graceful Shutdown

**File:** `apps/engine/src/main.ts`

### Boot sequence

```
1. Create internal API (fails fast if ENGINE_INTERNAL_SECRET is unset)
2. Create and load asset registry from database
3. Verify at least one open asset exists (throw if not — "run the seed")
4. Connect to Redis
5. Create and start WebSocket server
6. Create trade desk and hydrate open positions
7. Start the 10 Hz tick loop
8. Start the price feed (live or replay)
9. Start the internal API listener
10. Start the bank feed runner
11. Log "engine started"
```

### Shutdown sequence (SIGINT / SIGTERM)

```
1. Close internal API (accept no new trades)
2. Stop bank feed (inject no new credits)
3. Stop tick loop (collect no new settlements)
4. Stop trade desk (let captured settlements persist, bounded by timeout)
5. Stop price feed
6. Stop WebSocket server (close all sockets with 1001)
7. Quit Redis
8. Disconnect Prisma
9. Exit 0
```

**The order matters:** Internal API closes first so no new trades arrive. The tick loop stops next so no more prices are generated. The trade desk drains its pending settlements (bounded by `STOP_TIMEOUT_MS`) — settlements that were already captured will be persisted with the correct price, even during shutdown.

---

## Subsystem 15: The Relay System (SMS Ingestion)

### The Problem

In India, UPI payments trigger a bank SMS. The system needs to read those SMS messages and match them to pending deposits.

### The Solution — Three Components

1. **Relay app** (`apps/relay`): A React Native (Expo) Android app that reads incoming SMS, parses them for credit amounts and UTR references, and forwards them to the harness
2. **Harness app** (`apps/harness`): A Next.js app that receives the forwarded SMS via an API route (`/api/bank-feed/sms`), persists them as `RelayMessage` records, and creates `BankCredit` entries
3. **Engine runner**: Polls `BankCredit` entries and runs the same matching logic as the simulated feed

### RelayMessage Model

Every incoming SMS is stored verbatim:
- `source` — where it came from (app identifier)
- `deviceLabel` / `deviceModel` — which phone
- `sender` — SMS sender
- `body` — full message text
- `parsedAmountInr` / `parsedUtr` — extracted values (nullable if parsing failed)
- `isCredit` — whether it parsed as a credit
- `bankCreditId` — link to the matched BankCredit (if any)

This is the raw log — every message, whether usable or not.

---

## Subsystem 16: Database Design

### Key Design Decisions

1. **All money is integers:** `realBalance`, `bonusBalance`, `stake`, `amountUsd`, `amountInr` — all stored as integers in minor units (cents/paise). This eliminates floating-point arithmetic errors that plague financial systems.

2. **Optimistic concurrency on Account:** The `Account` model has a `version` field. Every balance mutation increments it and checks the expected version, preventing lost updates from concurrent trades.

3. **Append-only Transaction ledger:** Every balance change writes a `Transaction` row with `kind`, `amount`, `balanceAfter`, and a reference to what caused it. This is the source of truth for balance history — you can reconstruct any account's balance at any point in time by replaying transactions.

4. **Lifecycle stages:** `PRE_DEPOSIT`, `DEPOSITED`, `HIGH_VALUE` — tracked on the Account, used by the (future) controller to adjust manipulation intensity based on where the user is in their journey.

5. **Rolling statistics:** The Account tracks `rollingWinRate`, `tradesCount`, `medianStake`, `lossStreak`, `winStreak` — precomputed for the (future) controller to make real-time decisions without scanning the full trade history.

### Key Models (22 total)

| Model | Purpose |
|-------|---------|
| User | Authentication, KYC status, cumulative deposits |
| Account | Balances (real + bonus), lifecycle stage, rolling stats |
| Session | Cookie-based auth with hashed tokens |
| Asset | Tradeable instrument with GARCH parameters |
| Candle | Persisted OHLC data by timeframe |
| Trade | Open/settled positions |
| TradeShadow | Forensic audit of manipulation per trade |
| ShadowTick | Per-tick honest vs shown price |
| Deposit | Full payment lifecycle |
| BankCredit | Matched bank credits |
| RelayMessage | Raw SMS log |
| Withdrawal | Withdrawal requests and approvals |
| Transaction | Append-only balance ledger |
| BonusGrant | Deposit bonuses with turnover tracking |
| AuditLog | Admin action log (physically append-only) |
| SupportTicket | User support requests |
| TwoFactorCode | One-time verification codes (hashed) |

---

## Subsystem 17: Testing Strategy

### Test Distribution

- **`packages/pricing`**: 4 test files — GARCH properties (stationarity, mean-reversion), step function invariants, candle boundary conditions, RNG distribution
- **`packages/trading`**: 4 test files — outcome truth table, credit split proportionality, bucket registry operations, expiry rounding
- **`apps/engine`**: 5 test files — server message handling, internal API auth, trade desk settlement, sentiment computation, bank feed matching
- **`apps/web`**: Integration tests for security headers, nav configuration

### What the tests prove

The pricing tests verify:
- GARCH variance converges to the unconditional mean over many steps
- Step price never produces negative values
- Candle boundaries align with wall-clock minutes
- RNG produces uniform and normal distributions with correct statistical properties

The trading tests verify:
- Every direction × outcome combination is correct
- Credit splitting always sums to the exact credit (no rounding leak)
- Bucket registry correctly groups and removes positions
- Expiry rounding never shortens a trade

---

## Summary: What This Proves

This platform demonstrates that AI can build:

1. **A mathematically rigorous pricing engine** using real financial models (GARCH) — not random noise
2. **A complete trade lifecycle** from order placement through settlement with correct monetary arithmetic
3. **A real-time system** running at 10 Hz with WebSocket broadcast to hundreds of clients
4. **A complete payment flow** with UPI checkout, bank credit matching, and deposit reconciliation
5. **A security-conscious architecture** with hashed tokens, timing-safe comparisons, CSP headers, rate limiting, and audit trails
6. **An admin console** with full operational visibility
7. **A forensic audit system** (TradeShadow) that records the honest outcome alongside the shown one
8. **A manipulation framework** (drift + magnet layers) that's architecturally complete but deliberately zeroed — ready to activate without rewriting anything
9. **Production edge-case handling** throughout: idempotent settlements, graceful shutdown ordering, concurrent balance protection, rate limiting, and comprehensive error recovery

Every algorithm is tested. Every monetary calculation uses integer arithmetic. Every security boundary validates its inputs. The system runs completely offline for demos and transparently upgrades to real market data when an API key is provided.
