# Affiliate Center, levels, market-exempt accounts and the mobile trade bar — brief

Owner decisions of 2026-11-22. Orchestrator: Claude (plans and reviews). Builders: three Codex agents
working in this one worktree on branch `feat/affiliate-dashboard-levels` (from `origin/main` at b014e40).
Reference: the Quotex partner portal. Full-page screenshots of every Quotex page are in
`.playwright-mcp/quotex/` (git-ignored): `01-dashboard.png` … `18-profile.png`, `19-level-popup.png`,
`20-new-link-modal.png`. Use them for layout and content, never copy Quotex branding.

## Owner decisions (final)

1. Build a separate **Affiliate Center** (Quotex-style portal with its own sidebar). Sections now:
   Dashboard, Statistics (Dates / Traders / Links / Countries), Links (several tracked links),
   Levels, Withdrawal, FAQ. Support and My Account link to our existing `/support` and `/account`.
   Not now: promo codes, sub-affiliates, top-10 ranking, promo materials, postbacks, Telegram bot.
2. The trading app's **Affiliate** item (rail/drawer → `/affiliate/dashboard`) becomes a compact
   summary: totals, this month's numbers, level, invite link, and a big **Open Affiliate Dashboard**
   button that opens the Affiliate Center.
3. **Levels**: 7 monthly levels for Revenue Share and the first-deposit reward.
   - Names and bands (count of qualifying first deposits in a calendar month):
     1 Starter 0–14 · 2 Advanced 15–49 · 3 Professional 50–99 · 4 Expert 100–199 ·
     5 Master 200–399 · 6 Guru 400–699 · 7 Legend 700+.
   - A "qualifying first deposit" = a referred user's first credited LIVE deposit of at least the
     `MIN_QUALIFYING_DEPOSIT_INR_MINOR` in force at the time, counted in the IST calendar month it was
     credited. Each referred user counts once, ever. Exclude referred users with a CONFIRMED
     self-referral fraud flag.
   - A month's level comes from the previous month's count. New affiliates start at Level 1.
     Levels can go down.
   - Each level has its own Revenue Share and first-deposit reward, **editable in the admin console**
     (append-only versions like ProgramSetting; a change starts at the next IST midnight, like the
     existing rate editor). The migration seeds all 7 levels with today's defaults
     (DEFAULT_REVENUE_SHARE_BPS and AFFILIATE_DEPOSIT_REWARD_BPS in force), so nothing changes in
     money on deploy until the owner edits the table.
   - Rate precedence: an affiliate's own assigned `AffiliateRate` (custom terms) > their level's
     terms > the global defaults. Today's `getAffiliateRateAt` gains the middle step.
4. **Never show an affiliate their percentage** — no Revenue Share % and no first-deposit reward %,
   in pages, popovers or API responses to affiliates. The single exception: the Levels page cards show
   each level's Revenue Share % (owner chose "show % on cards only"). An affiliate's custom assigned
   rate is never shown anywhere. The admin console keeps every number.
5. **No KYC for affiliates** for affiliate earnings: transfers and withdrawals of program money need
   no KYC for role AFFILIATE (non-legacy). Regular users keep KYC for program withdrawals, and an
   affiliate's own *trading-account* withdrawals keep KYC. Remove the KYC row from affiliate pages.
6. Payout rules stay as they are (no 10-first-deposit gate, no weekly schedule).
7. **Market-exempt accounts**: `bhaveshsolminde@gmail.com` and `test10@asmtrade.local` (production)
   must not move OTC prices (no order-book flow) and must not count in the daily OTC vault / House
   P&L. Their LIVE trades still use real money and settle at the shown price, like ADMIN trades.
   The production daily vault target is already set to ₹10,000 (done by the orchestrator; it only
   feeds the House P&L report).
8. **Mobile trade bar** (phone layout, both themes): the open-trade pill and the three chart buttons
   (chart type, open positions/briefcase, fullscreen) need clearly visible outlines. Inside the green
   countdown ring of the open-trade pill, show the traded market's icon (existing `AssetIcon`).

## Ground rules for every agent

- Read `AgentContext.md` (worktree root) before touching files; log every file and region you touch.
  Re-read a shared file's region immediately before each edit; edit narrowly.
- **Do not commit, push, stash, switch branches or rebase.** The orchestrator reviews and commits.
- Database: the worktree `.env` files point at the isolated local DB
  `postgresql://solminde@localhost:5433/asm_affiliate_levels`. Never point anything at the shared
  Supabase DB or production. Never run `prisma migrate dev`, `prisma format` or `pnpm db:migrate`
  (schema drift: they fold unrelated changes in). Hand-write migration SQL, apply it with
  `cd packages/db && npx prisma migrate deploy` (check the printed Datasource line says
  asm_affiliate_levels), then `pnpm db:generate`.
- Tests: `cd <package> && npx vitest run <paths>`; `.db.test.ts` suites use the same local DB.
  Typecheck with `npx tsc --noEmit -p <package>`; while three agents work, judge only errors in
  your own files and report any you see in others' files instead of fixing them.
- Shared dev server (owned by the orchestrator): web at `http://aff.localhost:3271` (use the
  `aff.localhost` host, not `localhost`/127.0.0.1). It hot-reloads. If you need it restarted (e.g.
  after `pnpm db:generate`), ask the orchestrator. Seed test user: `test10@asmtrade.local`,
  password `asm-demo-test-2026`. Screenshots only under `.playwright-mcp/` (git-ignored).
- Money: integer minor units; INR display via existing helpers (`formatMoney`); any USD account
  amount converted with the shared ₹110 = $1 rate (`USD_INR_RATE` / `convertMinorBetween` from
  `@asm/contracts`; never hard-code 110).
- Theme: light and dark both, via the existing tokens (`apps/web/src/app/globals.css`,
  `theme-surfaces.css`; light under `:root[data-theme="light"]`). No hard-coded colours outside
  the colour-guard allowlist (`apps/web/src/lib/color-guard.ts`). Use `ThemeToggle` where a switch
  belongs. Phone layout below 1024px.
- Copy: plain English, no internal jargon, no percentages shown to affiliates (decision 4).
- When done, report: files touched, what each change does, tests run with their results, anything
  unfinished or any decision you had to make yourself.

## Agent 1 — affiliate backend (levels, statistics, tracked links, KYC, hidden rates, admin level table)

Owns: `packages/db/**` except the `marketExempt` line and its migration (Agent 3); `apps/engine/src/affiliate/**`;
`apps/web/src/app/api/program/**`; `apps/web/src/app/invite/**`; new tracked-link route
`apps/web/src/app/r/[code]/route.ts`; referral attribution at sign-up (email register + Google);
`apps/web/src/app/admin/(console)/affiliate-program/**`; a shared pure levels module (below).

1. **Contract first (do this before anything else and log it in AgentContext.md):** create
   `packages/db/src/repositories/affiliate-center.ts` exporting the types and function signatures
   below (stubs may throw until implemented), export them from `packages/db/src/index.ts`, and create
   the shared pure module `packages/contracts/src/affiliate-levels.ts` (exported from the contracts
   index) with `AFFILIATE_LEVELS` = `[{ level, name, minDeposits, maxDeposits | null }]` and
   `levelForDeposits(count)`. Agent 2 builds the UI against these.
   ```ts
   type Range = { from: Date; to: Date };            // IST day boundaries, inclusive from, exclusive to
   type Bucket = "day" | "week" | "month";
   interface AffiliateLevelStatus {
     current: { level: number; name: string };       // this month's level
     next: { level: number; name: string };          // projected for next month from this month's count
     monthQualifyingDeposits: number;                // this month so far
     toKeep: number;                                 // more first deposits needed to keep `current` next month (0 if kept)
     toNextLevel: number | null;                     // more needed to reach current.level + 1 (null at Legend)
   }
   interface AffiliateTotals {
     clicks: number; registrations: number;
     ftdCount: number; ftdSumMinor: number;
     depositsCount: number; depositsSumMinor: number;
     withdrawalsCount: number; withdrawalsSumMinor: number;
     turnoverMinor: number;                          // settled LIVE real-money stakes of referred users
     earningsMinor: number;                          // the affiliate's ProgramEarning amounts in range (not VOID)
   }
   interface AffiliateSeriesPoint { start: Date; clicks: number; registrations: number; ftdCount: number }
   interface AffiliateStatsRow extends AffiliateTotals { key: string; label: string }
   interface AffiliateTraderRow {
     traderId: string;            // short public id: first 8 chars of the user id, upper-case. Never email/name/phone.
     registeredAt: Date; linkId: string | null; country: string | null;
     ftdAt: Date | null; ftdMinor: number;
     depositsCount: number; depositsSumMinor: number; withdrawalsSumMinor: number;
     turnoverMinor: number; earningsMinor: number;
   }
   interface AffiliateLinkRow {
     id: string; code: string; url: string; kind: "HOME" | "REGISTER" | "APP";
     comment: string | null; isDefault: boolean; createdAt: Date;
   }
   getAffiliateLevelStatus(affiliateId: string, now?: Date): Promise<AffiliateLevelStatus>;
   getAffiliateTotals(affiliateId: string, range: Range, opts?: { linkId?: string }): Promise<AffiliateTotals>;
   getAffiliateSeries(affiliateId: string, range: Range, bucket: Bucket): Promise<AffiliateSeriesPoint[]>;
   getAffiliateStatsBy(affiliateId: string, by: "date" | "link" | "country", range: Range, opts?: { linkId?: string }): Promise<AffiliateStatsRow[]>;
   listAffiliateTraders(affiliateId: string, range: Range, opts?: { linkId?: string; traderId?: string; page?: number; pageSize?: number }): Promise<{ rows: AffiliateTraderRow[]; total: number }>;
   listAffiliateLinks(affiliateId: string): Promise<AffiliateLinkRow[]>;   // default link first
   createAffiliateLink(affiliateId: string, input: { kind: "HOME" | "REGISTER" | "APP"; comment?: string }): Promise<AffiliateLinkRow>;
   listLevelTerms(at?: Date): Promise<{ level: number; name: string; minDeposits: number; maxDeposits: number | null; revenueShareBps: number }[]>; // for the Levels cards only
   ```
   You may refine names/fields if needed, but log every change to the contract in AgentContext.md
   with a heads-up to Agent 2.
2. **Schema + migration** (`20261122110000_affiliate_center`, hand-written): `AffiliateLinkKind`
   enum; `AffiliateLink` (id, affiliateId → User, unique short `code`, kind, comment, isDefault,
   createdAt, archivedAt?); `AffiliateLinkDay` (linkId, IST `day` @db.Date, clicks; PK linkId+day);
   `User.referralLinkId` (nullable FK → AffiliateLink, onDelete SetNull; add the field right after
   `referralVia`, append new models at the end of schema.prisma); `AffiliateLevelTerms`
   (append-only: level 1–7, revenueShareBps, depositRewardBps, effectiveFrom, createdAt, createdBy,
   reason; index level+effectiveFrom; seed rows for all 7 levels from the defaults in force, effective
   from the epoch); `AffiliateMonthLevel` (affiliateId, month @db.Date = first IST day of the month,
   level, qualifyingDeposits = the previous month's count, computedAt; PK affiliateId+month; written
   once, then frozen). Follow ProgramSetting's revoke pattern for the append-only table if the
   existing migrations revoke UPDATE/DELETE for the runtime role.
3. **Levels in money paths**: extend `getAffiliateRateAt` with `source: "assigned" | "level" | "default"`,
   plus `level` and `levelTermsId`, honouring the precedence in decision 3, for both Revenue Share
   (`revenue-share.ts`) and the first-deposit reward (`referral-qualification.ts`). Snapshot the level
   terms used (RevenueShareDay already stores rateBps/rateId; record the level terms id/level in its
   `calculation` JSON or a new nullable column, and on the reward's `settingIds`/rateId in the same
   style as today). Month level = frozen `AffiliateMonthLevel` row, created on first need from the
   previous month's qualifying first deposits. Unit + DB tests: level boundaries (14/15, 699/700),
   month rollover in IST, a custom AffiliateRate beating the level, a reversed/flagged friend not counting.
4. **Hidden rates**: `getProgramSummary` and every affiliate-facing API (`/api/program/summary`, any
   new ones) must not return `revenueShareBps`, `affiliateDepositRewardBps` or any rate. Add a level
   status to the summary for affiliates. Keep the money amounts.
5. **No KYC for affiliates**: in `programActionBlockers` (program-wallet.ts) affiliates no longer get
   `kyc_required`; regular users still do for `withdraw`. Update tests. Leave trading-account
   withdrawals untouched.
6. **Tracked links**: every affiliate has a default link (`isDefault`, kind REGISTER) that is today's
   `/invite/CODE`; extra links use `/r/<code>`. Visiting either counts a click into `AffiliateLinkDay`
   (at most one counted click per IP per link per 30 minutes via the existing Redis rate limiter),
   sets the existing referral cookie to the affiliate's code plus a new `asm_ref_link` cookie (same
   options) with the link id, and redirects: HOME → `/`, REGISTER → `/register`, APP → `/download`.
   Keep today's anti-probing behaviour for invalid codes. At sign-up (every path that sets
   `referredById`/`referralVia`), store `User.referralLinkId` when the link belongs to the inviter.
   Limit: 50 links per affiliate. Server actions or API routes for listing/creating links, for
   affiliates only (role AFFILIATE, non-legacy, any status so pending affiliates can prepare).
7. **Statistics**: implement the contract queries with indexed SQL; ranges in IST; amounts in INR
   minor (convert USD accounts). Registrations = referred users created in range; clicks from
   `AffiliateLinkDay`; FTD = first credited LIVE deposit (any amount) in range; turnover = settled
   LIVE real-money stakes; country from `User.country` (null → "Unknown"). Paginate traders.
8. **Admin**: on `/admin/affiliate-program`, a "Levels" table showing each level's bands and current
   Revenue Share / first-deposit reward, with an edit form per level (reason required, effective next
   IST midnight, audited like the existing rate editor). On an affiliate's admin page, show their
   current level, this month's count and whether custom terms override it.

## Agent 2 — Affiliate Center UI and the compact in-app panel

Owns: new route group `apps/web/src/app/affiliate/center/**` (own `layout.tsx`, not inside the
trading `(platform)` shell), new components under `apps/web/src/components/affiliate-center/**`,
`apps/web/src/app/(platform)/affiliate/dashboard/**`, `apps/web/src/components/program/ProgramEarningsPanel.tsx`,
and the route-protection region for `/affiliate/center` in `apps/web/src/proxy.ts`. Build against
Agent 1's contract (`@asm/db` affiliate-center functions, `@asm/contracts` levels); until a function
is implemented, render from its stub-safe empty state, never from fake numbers committed to code.

1. **Shell** (`/affiliate/center`): affiliates only (role AFFILIATE, non-legacy; others → `/trade`,
   signed-out → `/affiliate/login`). Left sidebar: the IndianxTrade logo (`SITE_NAME`, the existing
brand logo files for each theme) + "Affiliate Center",
   Dashboard, Statistics, Links, Levels, Withdrawal, FAQ, then Support (→ `/support`), My Account
   (→ `/account`), Back to trading (→ `/trade`). Top bar: available balance with an arrow to
   Withdrawal; "This month" earnings; the **level badge** "⚡ L1 Starter › L1 Starter"
   (current › projected next month) opening a popover modelled on `19-level-popup.png`
   (current/next banner, "N first deposits this month", "To keep Level X — n left" bar,
   "Go up to Level Y — n left" bar, list of all levels with bands — **no percentages in the popover**);
   `ThemeToggle`; account menu (email, short ID, Withdrawal, My Account, Sign out). Below 1024px the
   sidebar becomes a drawer. Light and dark themes both, premium and consistent with our site
   (not Quotex colours).
2. **Dashboard**: balance card (available balance, Go to Withdrawal, earnings for all time),
   shortcut tiles (Links, Levels, Withdrawal, FAQ), Statistics header with a range picker (Last 7
   days, Last month, Last year, All time, Custom), cards for Deposits (sum + count), Withdrawals
   (sum + count), First deposits (sum + count), Clicks, Registrations, and a Clicks / Registrations /
   First deposits chart with Day / Week / Month. Keep the existing email-verification and
   pending/suspended status notices. Invite link copy box.
3. **Statistics**: tabs Dates / Traders / Links / Countries; period filter, link filter, trader ID
   search (Traders), rows per page (10/20/50/100), a column picker remembered in localStorage
   (try/catch). Columns per `04-statistics-links.png`, without "Vol share"; add Earnings.
4. **Links**: info banner explaining tracked links, table (ID, link + copy button, comment, type,
   created), **New link** dialog (Type: Home page / Sign-up page / App download; optional comment).
5. **Levels**: a short explanation (level set monthly from last month's first deposits; starts at
   Level 1; can go up or down), then the 7 cards exactly in the style of the owner's reference
   image: "LEVEL N", coloured icon tile + name (Starter, Advanced, Professional, Expert, Master,
   Guru, Legend), "Deposits required: a–b" with a bar, "Revenue Share: x%" with a bar. Colours per
   level as tokens in both themes: L1 sky, L2 blue, L3 deep blue, L4 purple, L5 deep violet,
   L6 red, L7 gold. Icons: person (1–3), star (4), brain/sparkle (5), trophy (6), crown (7).
   Highlight the affiliate's current level card. Grid: 3 + 4 on desktop as in the image, one column
   on phones. This page is the only place a percentage appears.
6. **Withdrawal**: move the program withdraw + transfer-to-trading experience here (reuse
   `ProgramEarningsPanel` logic; keep its tests passing), with the history table and statuses
   explained in a small FAQ. No KYC prompt for affiliates.
7. **FAQ**: grouped like `12-faq.png` (General, Links, Withdrawals, Statistics, Account, Support),
   rewritten for our program and rules, no percentages, and "Verification (KYC) is not required for
   affiliates; we may ask you to confirm ownership of a payout method."
8. **Compact in-app panel** (`/affiliate/dashboard` inside the trading shell): keep the
   verification/status notices; show available balance, all-time earnings, this month's referrals
   and first deposits, the level (name + progress to next), the invite link, and a large primary
   **Open Affiliate Dashboard** button → `/affiliate/center`. Remove "Your terms" and the KYC row.
9. Verify in the browser at desktop 1440px and phone 390px, light and dark, signed in as an
   affiliate (create one in the local DB; see `apps/web/src/lib/session.ts` for session rows).
   Save screenshots to `.playwright-mcp/affiliate-center/`.

## Agent 3 — market-exempt accounts and the mobile trade bar

Owns: the `marketExempt` field (one line in the `User` model right after `legacySimulated`) and
migration `20261122100000_user_market_exempt`; `packages/market-sim/src/eligibility.ts` and its
callers; `packages/db/src/repositories/otc-trade.ts`; the SQL in `apps/engine/src/otc/runtime.ts`
and `apps/web/src/app/admin/(console)/house-pnl/report.ts` that "mirrors isRealTrader()";
`apps/web/src/app/admin/(console)/users/**`; `apps/web/src/components/trade/PositionStrip.tsx` and
the chart-overlay button components for the phone trade view.

1. **Market-exempt**: `User.marketExempt Boolean @default(false)`. `isRealTrader`/`isTob` return
   false when it is true; `AccountActor` gains `marketExempt?: boolean` (absent in older durable
   commands → treat as false, so replays don't change). Load it from the database row wherever the
   actor is built (never from request payloads). Every SQL that mirrors `isRealTrader()` excludes
   exempt users (grep for that comment and for `legacySimulated` filters in vault/house P&L/open-TOB
   queries). Confirm an exempt LIVE trade opens with `filledLots = 0` at the displayed price and
   settles normally with real money. The migration adds the column only — **no data changes**
   (production rows are flagged after deploy). Admin user page: a toggle "Keep out of market and
   vault" with a reason, audited. Tests: eligibility unit tests, an OTC open/settle test for an
   exempt LIVE account, house-pnl report excludes it.
2. **Mobile trade bar**: in the phone trade layout, give the open-trade pill and the chart-type,
   positions and fullscreen buttons a clearly visible outline in both themes (≥ 3:1 contrast
   against the chart background; use or add a theme token, no hard-coded colours). Put the trade's
   market `AssetIcon` centred inside the countdown ring (ring keeps its direction colour and
   progress); fall back to the symbol's first letters if no icon. Update `PositionStrip.test.ts`.
   Verify at 390px in light and dark with an open trade if the engine is available; otherwise
   report what you verified and the orchestrator will check it with the engine running.
