# Phase 2 · Leaderboard of the Day (#6) Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or executing-plans, TDD, checkbox steps.

**Goal:** A real "Leaderboard of the Day" ranking LIVE accounts by today's realized P/L, with the viewer's own position, styled like the Quotex reference (rank, flag, name, amount).

**Architecture:** A DB aggregation over settled `Trade` rows joined to `User` profile, exposed by a read-only API route and consumed by a new platform page. Money stays integer minor units in each account's currency.

**Tech Stack:** `@asm/db` (repository), `@asm/contracts` (DTO), `@asm/web` (API route + page + nav).

## Global Constraints
- Rank **LIVE** accounts by **today's realized P/L** = sum of `Trade.pnl` for trades that **settled today** (`status ∈ {WON,LOST,REFUNDED}`, `expiryTs` within the current day). Ledger `pnl` is net minor units.
- "Today" = the current day in a single fixed timezone (Asia/Kolkata, matching INR product); implement via a `startOfDayMs(now, tz)` helper so it is testable and not host-tz dependent.
- Read-only. No writes. Ownership: "your position" derives from the session's own LIVE account only.
- Money display via `formatMinor`/`currencySymbol` (per-account currency).
- **Population tension (flagged):** bots are DEMO-only and LIVE is env-gated, so a pure-LIVE board is sparse until real LIVE traders exist. Task 5 adds an opt-in `LEADERBOARD_INCLUDE_BOTS`/LIVE-bot seeding switch so the board can be populated like the reference; default off (real data only).
- Tests: `pnpm --filter @asm/db test` (needs Postgres, serial), `@asm/contracts test`, `@asm/web test`.

---

### Task 1: `startOfDayMs` timezone helper
**Files:** create `packages/contracts/src/time.ts` (+ test) or `apps/web/src/lib/day.ts` if only web needs it — put it where both the repo and route can import; contracts is dependency-free, so put a pure `startOfDayMs(nowMs, tz)` there.
- [ ] **Test first:** `startOfDayMs(t, "Asia/Kolkata")` returns the most recent 00:00 IST as epoch ms; a time just after IST midnight and just before both map to the correct day boundary.
- [ ] Implement with `Intl.DateTimeFormat` parts (no external tz lib).
- [ ] Run test.

### Task 2: Leaderboard aggregation repository
**Files:** create `packages/db/src/repositories/leaderboard.ts` (+ test), export from `packages/db/src/index.ts`.
**Interfaces produced:**
```ts
interface LeaderboardEntry {
  accountId: string;
  userId: string;
  nickname: string | null;   // display name
  country: string | null;    // ISO-ish code for the flag
  currency: string;
  pnlMinor: number;          // today's realized P/L
}
interface LeaderboardResult { entries: LeaderboardEntry[]; you: { rank: number | null; entry: LeaderboardEntry | null }; }
async function dailyLeaderboard(input: { sinceMs: number; viewerUserId: string; limit: number; includeBots: boolean }): Promise<LeaderboardResult>;
```
- [ ] **Test first:** seed two LIVE accounts with settled trades today (one net +, one net −) and one trade before `sinceMs`; assert ordering by `pnlMinor` desc, the pre-`sinceMs` trade is excluded, `you.rank` matches the viewer, and bots are excluded when `includeBots=false`.
- [ ] Implement: `prisma.trade.groupBy({ by: ['accountId'], where: { status: { in: ['WON','LOST','REFUNDED'] }, expiryTs: { gte: new Date(sinceMs) }, account: { type: 'LIVE', user: { isBot: includeBots ? undefined : false } } }, _sum: { pnl: true } })`, then fetch account+user profile fields, sort desc, take `limit`, and compute the viewer's rank across the full sorted set.
- [ ] Run db test (serial, Postgres).

### Task 3: Contract DTO + API route
**Files:** create `packages/contracts/src/leaderboard.ts` (+ export in index), create `apps/web/src/app/api/leaderboard/route.ts` (+ test).
- [ ] **Test first (route):** an authed GET returns `{ entries, you }` shaped to the DTO; an unauthed GET is 401. (Mirror `api/trades/route.test.ts` patterns.)
- [ ] Zod DTO for `LeaderboardEntry`/`LeaderboardResult`.
- [ ] Route: read session (`readSession`), compute `sinceMs = startOfDayMs(Date.now(), TZ)`, call `dailyLeaderboard({ sinceMs, viewerUserId, limit: 100, includeBots: env })`, return JSON. No-store.
- [ ] Run contracts + web tests.

### Task 4: Leaderboard page + navigation
**Files:** create `apps/web/src/app/(platform)/leaderboard/page.tsx` + a client `LeaderboardList.tsx`; add a nav entry in `IconRail`/`MobileNav`/`src/lib/nav.ts`.
- [ ] Page fetches `/api/leaderboard` (client) and renders: a header "Leaderboard — of the Day", a highlighted "your position" row (rank + masked id `#<shortId>` + amount), a "How does this rating work?" info line, then the ranked list — rank badge (gold/silver/bronze for 1–3), a country flag (emoji from `country`, fallback globe `Icon`), display name (`nickname` or masked id), and `formatMinor(pnlMinor, currency)` in up/down colour. Match the charcoal theme + tokens.
- [ ] Empty state: "No ranked traders yet today." (covers the sparse-LIVE case).
- [ ] Add the nav item (label "Top"/"Leaderboard") to the rail + mobile nav; update `nav.ts` + its test.
- [ ] Verify in preview (needs auth): screenshot desktop + phone.

### Task 5: Optional population switch (bots)
**Files:** `apps/engine/src/main.ts` or bot provisioning (`packages/db/src/repositories/bots.ts`), env in `.env.example`.
- [ ] Add `LEADERBOARD_INCLUDE_BOTS` env (default false) wired into the route's `includeBots`. When true, the board includes bot accounts.
- [ ] (Optional, only if the user wants a populated LIVE board) extend `provisionBots` to also create a LIVE account + seed `nickname`/`country` on bot users so they render like the reference. Gate behind a flag; document in DEMO.md. **Decide with user before building this task.**
- [ ] Run affected tests.

### Task 6: Verification
- [ ] All affected package tests green; `tsc --noEmit` clean; lint clean on changed files.
- [ ] Browser: log in, open leaderboard, confirm ranking + your-position; screenshot.
- [ ] Commit.

## Self-review
- Coverage: day boundary (T1), aggregation (T2), API+DTO (T3), page+nav (T4), population (T5). ✅
- Risk: timezone correctness (T1 tested); groupBy + profile join N+1 — fetch profiles in one `findMany({ where: { id: in accountIds } })`. Sparse board is expected and handled by the empty state + T5 switch.
