# ASM Trade — Plan 07: Platform Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rest of the platform — the icon rail, sentiment bar, asset switcher with live payouts, account and KYC screens, two-factor authentication, payments history, the withdrawal page, support tickets, and admin payout control — bringing the build to visual and functional parity with the screenshots.

**Architecture:** The rail becomes a registry of route modules, so the four deferred destinations drop in later as a folder plus one registration line rather than a refactor. The engine gains a sentiment broadcast derived from the open book it already tracks. Two-factor codes are delivered to the log, which needs no provider and demonstrates the flow exactly as well as email would.

**Tech Stack:** Next.js 16 · React 19 · Tailwind 4 · Prisma 7 · Zod 4 · Vitest 5

## Global Constraints

- **Everything from Plans 01–06 applies** — exact pinned versions, `z.strictObject()` at every boundary, money as integer minor units, `actorId` on every user-owned query, `BANK_FEED=simulated`, no shadow field in any trading-client response.
- **Two-factor codes go to the log.** No SMTP, no provider, no credentials. `logger.info` with `evt: "auth.2fa_sent"` and the code; read it from the terminal. A real sender is one adapter away and deliberately not built.
- **KYC fields are stored, never verified.** There is no identity check and no document upload in this build. The Aadhaar field exists for parity with the original and holds whatever is typed.
- **Sentiment is the bots' only visible output.** No trade ticker, no leaderboard, no bot presence anywhere in the UI.
- **Payout changes never alter open positions.** Each trade already stores its own `payoutPct`; the admin control edits the asset only.
- **Four rail destinations stay out of scope** — Tournaments, Market, Analytics, More. They get registry entries marked unavailable, not invented screens.

---

## File Structure

```
packages/db/prisma/migrations/*_support_tickets/migration.sql

packages/contracts/src/
├── account.ts              UpdateProfileSchema, TwoFaSchema
├── support.ts              CreateTicketSchema
└── index.ts                modified

packages/db/src/repositories/
├── profile.ts              profile read/update, 2FA toggles
├── twofa.ts                code issue + verify
└── support.ts              ticket create/list

apps/engine/src/
├── sentiment.ts            derives up/down split from the open book
└── loop.ts                 modified — broadcasts sentiment each second

apps/web/src/
├── lib/nav.ts              the rail registry
├── components/
│   ├── shell/
│   │   ├── IconRail.tsx
│   │   ├── TopBar.tsx
│   │   └── PromoBanner.tsx
│   ├── chart/SentimentBar.tsx
│   └── trade/AssetTabs.tsx
├── app/(platform)/
│   ├── layout.tsx          rail + top bar around every platform page
│   ├── account/page.tsx
│   ├── balance/page.tsx    payments history
│   ├── withdrawal/page.tsx
│   └── support/page.tsx
├── app/(auth)/two-factor/page.tsx
├── app/api/account/route.ts
├── app/api/account/two-factor/route.ts
├── app/api/support/route.ts
└── app/admin/assets/
    ├── page.tsx
    └── actions.ts
```

---

## Task 1: Support-ticket schema and the rail registry

**Files:**
- Create: `packages/db/prisma/migrations/20260912100000_support_tickets/migration.sql`, `apps/web/src/lib/nav.ts`
- Modify: `packages/db/prisma/schema.prisma`
- Test: `apps/web/src/lib/nav.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `SupportTicket` model — `id, userId, subject, body, status, createdAt`
  - `RailItem = { id: string; label: string; href: string; icon: string; available: boolean; badge?: number }`
  - `RAIL_ITEMS: readonly RailItem[]`
  - `availableRailItems(): RailItem[]`

- [ ] **Step 1: Append the model to `packages/db/prisma/schema.prisma`**

```prisma
enum TicketStatus {
  OPEN
  ANSWERED
  CLOSED
}

model SupportTicket {
  id        String       @id @default(uuid())
  userId    String
  subject   String
  body      String
  status    TicketStatus @default(OPEN)
  createdAt DateTime     @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, createdAt])
}

model TwoFactorCode {
  id        String   @id @default(uuid())
  userId    String
  codeHash  String
  purpose   String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, purpose])
}
```

Add the back-relations to `User`:

```prisma
  supportTickets SupportTicket[]
  twoFactorCodes TwoFactorCode[]
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade?schema=public" \
  pnpm exec prisma migrate dev --name support_tickets
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec prisma migrate deploy
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
psql -d asm_trade -f packages/db/sql/restrict-role.sql
```

Re-applying the role script is necessary: new tables need the runtime grants, and `ALTER DEFAULT PRIVILEGES` only covers tables created after it was set.

- [ ] **Step 3: Write the failing rail test**

Create `apps/web/src/lib/nav.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RAIL_ITEMS, availableRailItems } from "./nav";

describe("rail registry", () => {
  it("lists every destination from the screenshots", () => {
    const ids = RAIL_ITEMS.map((i) => i.id);
    for (const expected of [
      "trade",
      "support",
      "account",
      "tournaments",
      "market",
      "more",
    ]) {
      expect(ids).toContain(expected);
    }
  });

  it("marks the four deferred destinations unavailable", () => {
    for (const id of ["tournaments", "market", "analytics", "more"]) {
      const item = RAIL_ITEMS.find((i) => i.id === id);
      expect(item?.available).toBe(false);
    }
  });

  it("returns only available destinations from availableRailItems", () => {
    expect(availableRailItems().every((i) => i.available)).toBe(true);
  });

  it("gives every item a unique id and href", () => {
    expect(new Set(RAIL_ITEMS.map((i) => i.id)).size).toBe(RAIL_ITEMS.length);
    expect(new Set(RAIL_ITEMS.map((i) => i.href)).size).toBe(RAIL_ITEMS.length);
  });

  it("keeps trade first, matching the original", () => {
    expect(RAIL_ITEMS[0]?.id).toBe("trade");
  });

  it("uses only relative hrefs — no external destinations in the rail", () => {
    for (const item of RAIL_ITEMS) {
      expect(item.href.startsWith("/")).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
pnpm --filter @asm/web test
```

Expected: FAIL — cannot resolve `./nav`.

- [ ] **Step 5: Write `apps/web/src/lib/nav.ts`**

```ts
export interface RailItem {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Emoji stand-in. Swap for an icon set without touching consumers. */
  readonly icon: string;
  /** False renders the item disabled rather than hiding it — the original shows all six. */
  readonly available: boolean;
  readonly badge?: number;
}

/**
 * The rail as a registry rather than hard-coded markup.
 *
 * Adding one of the deferred destinations later means flipping `available` and
 * creating its route folder — no consumer changes. That is the extensibility
 * the specification asks for, and it costs nothing now.
 */
export const RAIL_ITEMS: readonly RailItem[] = [
  { id: "trade", label: "Trade", href: "/trade", icon: "📈", available: true },
  { id: "support", label: "Support", href: "/support", icon: "❓", available: true },
  { id: "account", label: "Account", href: "/account", icon: "👤", available: true },
  {
    id: "tournaments",
    label: "Tournaments",
    href: "/tournaments",
    icon: "🏆",
    available: false,
    badge: 4,
  },
  {
    id: "market",
    label: "Market",
    href: "/market",
    icon: "🪙",
    available: false,
    badge: 4,
  },
  {
    id: "analytics",
    label: "Analytics",
    href: "/analytics",
    icon: "📊",
    available: false,
  },
  { id: "more", label: "More", href: "/more", icon: "•••", available: false },
];

export function availableRailItems(): RailItem[] {
  return RAIL_ITEMS.filter((item) => item.available);
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
pnpm --filter @asm/web test
```

Expected: PASS — 6 new tests.

- [ ] **Step 7: Commit**

```bash
git add packages/db apps/web
git commit -m "feat: support ticket schema and rail registry"
```

---

## Task 2: The platform shell

**Files:**
- Create: `apps/web/src/components/shell/IconRail.tsx`, `apps/web/src/components/shell/TopBar.tsx`, `apps/web/src/components/shell/PromoBanner.tsx`, `apps/web/src/app/(platform)/layout.tsx`
- Modify: `apps/web/src/app/(platform)/trade/page.tsx`

**Interfaces:**
- Consumes: `RAIL_ITEMS`, `readSession`, `listAccountsForActor`, `formatMoney`
- Produces: `<IconRail />`, `<TopBar accounts balanceLabel />`, `<PromoBanner />`, and a shared platform layout

- [ ] **Step 1: Write `apps/web/src/components/shell/IconRail.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { RAIL_ITEMS } from "@/lib/nav";

export function IconRail() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Platform sections"
      className="flex w-[72px] shrink-0 flex-col items-center gap-1 border-r border-[var(--color-edge)] bg-[var(--color-panel)] py-3"
    >
      {RAIL_ITEMS.map((item) => {
        const active = pathname.startsWith(item.href);

        const inner = (
          <span className="relative flex flex-col items-center gap-1">
            <span aria-hidden className="text-lg leading-none">
              {item.icon}
            </span>
            <span className="text-[9px] font-semibold uppercase leading-tight tracking-[0.06em]">
              {item.label}
            </span>
            {item.badge ? (
              <span className="absolute -right-2 -top-1 rounded-full bg-[var(--color-brand)] px-1.5 text-[9px] font-bold text-white">
                {item.badge}
              </span>
            ) : null}
          </span>
        );

        if (!item.available) {
          return (
            <span
              key={item.id}
              title="Not available in this build"
              aria-disabled="true"
              className="w-[60px] cursor-not-allowed rounded-lg px-1 py-2.5 text-center text-[var(--color-ink-2)] opacity-40"
            >
              {inner}
            </span>
          );
        }

        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`w-[60px] rounded-lg px-1 py-2.5 text-center ${
              active
                ? "bg-[var(--color-brand)] text-white"
                : "text-[var(--color-ink-2)] hover:bg-[var(--color-panel-2)]"
            }`}
          >
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/components/shell/PromoBanner.tsx`**

```tsx
export function PromoBanner() {
  return (
    <div className="flex items-center gap-2 rounded-full bg-gradient-to-r from-[#1a7f52] to-[#2fbd85] px-4 py-1.5">
      <span aria-hidden>🚀</span>
      <p className="text-xs font-semibold text-white">
        Get a <span className="font-bold">50% bonus</span> on your deposit!
      </p>
      <span className="rounded-full bg-white/25 px-2 py-0.5 text-[10px] font-bold text-white">
        50%
      </span>
    </div>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/components/shell/TopBar.tsx`**

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import type { AccountView } from "@/components/AccountSwitcher";
import { PromoBanner } from "./PromoBanner";

export function TopBar({
  accounts,
  activeId,
  onChangeAccount,
  email,
  accountNumber,
}: {
  accounts: AccountView[];
  activeId: string;
  onChangeAccount: (id: string) => void;
  email: string;
  accountNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const active = accounts.find((a) => a.id === activeId);

  return (
    <header className="flex items-center gap-4 border-b border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-2.5">
      <Link href="/trade" className="flex items-baseline gap-2">
        <span className="text-sm font-bold tracking-tight">ASM TRADE</span>
        <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)] sm:inline">
          Web trading platform
        </span>
      </Link>

      <div className="mx-auto hidden md:block">
        <PromoBanner />
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="flex flex-col items-start rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-1.5 text-left"
          >
            <span
              className="text-[9px] font-bold uppercase tracking-[0.12em]"
              style={{
                color:
                  active?.type === "DEMO" ? "#e0ac50" : "var(--color-up)",
              }}
            >
              {active?.type === "DEMO" ? "Demo account" : "Live account"}
            </span>
            <span className="text-sm font-semibold tabular-nums">
              {active?.balance ?? "—"}
            </span>
          </button>

          {open ? (
            <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-3 shadow-xl">
              <p className="text-xs font-semibold">{email}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink-2)]">
                ID: {accountNumber}
              </p>

              <ul className="mt-3 flex flex-col gap-1">
                {accounts.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onChangeAccount(a.id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-xs ${
                        a.id === activeId
                          ? "bg-[var(--color-panel-2)]"
                          : "hover:bg-[var(--color-panel-2)]"
                      }`}
                    >
                      <span className="font-semibold">
                        {a.type === "DEMO" ? "Demo Account" : "Live Account"}
                      </span>
                      <span className="tabular-nums">{a.balance}</span>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-3 flex flex-col gap-1 border-t border-[var(--color-edge)] pt-2 text-xs">
                <Link href="/deposit" className="px-2 py-1 hover:underline">
                  Deposit
                </Link>
                <Link href="/withdrawal" className="px-2 py-1 hover:underline">
                  Withdrawal
                </Link>
                <Link href="/balance" className="px-2 py-1 hover:underline">
                  Payments
                </Link>
                <Link href="/account" className="px-2 py-1 hover:underline">
                  My account
                </Link>
                <form action="/api/auth/logout" method="post">
                  <button
                    type="submit"
                    className="px-2 py-1 text-[var(--color-down)] hover:underline"
                  >
                    Logout
                  </button>
                </form>
              </div>
            </div>
          ) : null}
        </div>

        <Link
          href="/deposit"
          className="rounded-lg bg-[var(--color-up)] px-3 py-2 text-xs font-bold text-[#06231a]"
        >
          + Deposit
        </Link>
        <Link
          href="/withdrawal"
          className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-xs font-bold"
        >
          Withdrawal
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Write `apps/web/src/app/(platform)/layout.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { IconRail } from "@/components/shell/IconRail";
import { SESSION_COOKIE, readSession } from "@/lib/session";

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  return (
    <div className="flex min-h-screen">
      <IconRail />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
```

The layout guards the whole group, so each page no longer repeats the session check — though pages still call `readSession` when they need the user id.

- [ ] **Step 5: Wire `TopBar` into the trade workspace**

In `apps/web/src/components/trade/TradeWorkspace.tsx`, add the props and render the bar. Replace the component signature and opening markup:

```tsx
export function TradeWorkspace({
  symbol,
  precision,
  token,
  accounts,
  initialTrades,
  email,
  accountNumber,
}: {
  symbol: string;
  precision: number;
  token: string | null;
  accounts: AccountView[];
  initialTrades: TradeView[];
  email: string;
  accountNumber: string;
}) {
```

Then wrap the returned grid:

```tsx
  return (
    <>
      <TopBar
        accounts={accounts}
        activeId={activeAccountId}
        onChangeAccount={setActiveAccountId}
        email={email}
        accountNumber={accountNumber}
      />
      <div className="grid gap-6 p-4 md:grid-cols-[1fr_260px]">
```

Close it with `</div></>` and add the import:

```tsx
import { TopBar } from "@/components/shell/TopBar";
```

- [ ] **Step 6: Pass the new props from the trade page**

In `apps/web/src/app/(platform)/trade/page.tsx`, load the user and pass them. Replace the data fetch and the `<TradeWorkspace>` call:

```tsx
  const [accounts, asset, user] = await Promise.all([
    listAccountsForActor(session.userId),
    prisma.asset.findUnique({ where: { symbol: "AUDNZD_OTC" } }),
    prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { email: true, id: true },
    }),
  ]);
```

```tsx
      <TradeWorkspace
        symbol={asset.symbol}
        precision={asset.precision}
        token={token}
        accounts={accounts.map((a) => ({
          id: a.id,
          type: a.type,
          balance: formatMoney(a.realBalance + a.bonusBalance, a.currency),
        }))}
        initialTrades={[]}
        email={user.email}
        accountNumber={user.id.slice(0, 8).toUpperCase()}
      />
```

Remove the page's own `<header>` block — the top bar replaces it.

- [ ] **Step 7: Verify the shell**

```bash
pnpm dev
```

Open `/trade`. Expected: the icon rail on the left with Trade highlighted and the four deferred items dimmed; the top bar with the wordmark, promo banner, account switcher, Deposit and Withdrawal. Clicking a dimmed rail item does nothing.

- [ ] **Step 8: Commit**

```bash
git add apps/web
git commit -m "feat(web): platform shell with icon rail and top bar"
```

---

## Task 3: Sentiment bar and asset tabs

**Files:**
- Create: `apps/engine/src/sentiment.ts`, `apps/web/src/components/chart/SentimentBar.tsx`, `apps/web/src/components/trade/AssetTabs.tsx`
- Modify: `packages/contracts/src/ws.ts`, `apps/engine/src/loop.ts`, `apps/web/src/components/chart/useEngineSocket.ts`

**Interfaces:**
- Consumes: `SettlementService.openFor`; `AssetRegistry`
- Produces:
  - `SentimentMessage = { type: "sentiment"; symbol: string; upPct: number; downPct: number }`
  - `computeSentiment(positions: readonly Position[]): { upPct: number; downPct: number }`
  - `<SentimentBar upPct downPct />`, `<AssetTabs assets active onSelect />`
  - `useEngineSocket` extended with `sentiment: { upPct: number; downPct: number } | null`

- [ ] **Step 1: Add the message type to `packages/contracts/src/ws.ts`**

```ts
export interface SentimentMessage {
  type: "sentiment";
  symbol: string;
  /** Whole percentages summing to 100. */
  upPct: number;
  downPct: number;
}
```

Add `| SentimentMessage` to the `ServerMessage` union, and export the type from the barrel.

- [ ] **Step 2: Write `apps/engine/src/sentiment.ts`**

```ts
import type { Position } from "@asm/trading";

/**
 * The bots' only visible output.
 *
 * Stake-weighted rather than head-counted, so it agrees with the imbalance the
 * controller acts on — a bar showing 60% up while the engine is defending
 * against a short book would be incoherent.
 *
 * Falls back to an even split for an empty book rather than 0/0.
 */
export function computeSentiment(positions: readonly Position[]): {
  upPct: number;
  downPct: number;
} {
  let up = 0;
  let total = 0;

  for (const position of positions) {
    total += position.stake;
    if (position.direction === "UP") up += position.stake;
  }

  if (total === 0) return { upPct: 50, downPct: 50 };

  const upPct = Math.round((up / total) * 100);
  return { upPct, downPct: 100 - upPct };
}
```

- [ ] **Step 3: Broadcast it from the loop**

In `apps/engine/src/loop.ts`, add the import:

```ts
import { computeSentiment } from "./sentiment.js";
```

Add a throttle above `run`:

```ts
  let lastSentimentSec = 0;
```

Then inside the asset loop, after the tick broadcast, add:

```ts
      // Once per second is plenty — the bar is a mood indicator, not a feed.
      if (nowSec !== lastSentimentSec) {
        const sentiment = computeSentiment(settlement.openFor(asset.id));
        server.broadcast(asset.symbol, {
          type: "sentiment",
          symbol: asset.symbol,
          ...sentiment,
        });
      }
```

And after the asset loop completes, before the lag check:

```ts
    lastSentimentSec = nowSec;
```

- [ ] **Step 4: Consume it in `useEngineSocket`**

Widen the state interface with:

```ts
  sentiment: { upPct: number; downPct: number } | null;
```

Initialise it to `null`, and add a case to the message switch:

```ts
            case "sentiment":
              return {
                ...prev,
                sentiment: { upPct: message.upPct, downPct: message.downPct },
              };
```

- [ ] **Step 5: Write `apps/web/src/components/chart/SentimentBar.tsx`**

```tsx
export function SentimentBar({
  upPct,
  downPct,
}: {
  upPct: number;
  downPct: number;
}) {
  return (
    <div
      className="flex w-10 shrink-0 flex-col items-center gap-1 py-1"
      aria-label={`Trader sentiment: ${upPct}% up, ${downPct}% down`}
    >
      <span className="text-[10px] font-bold tabular-nums text-[var(--color-up)]">
        {upPct}%
      </span>
      <div className="flex w-2 flex-1 flex-col overflow-hidden rounded-full bg-[var(--color-panel-2)]">
        <div
          className="w-full bg-[var(--color-up)] transition-[flex-grow] duration-500"
          style={{ flexGrow: upPct }}
        />
        <div
          className="w-full bg-[var(--color-down)] transition-[flex-grow] duration-500"
          style={{ flexGrow: downPct }}
        />
      </div>
      <span className="text-[10px] font-bold tabular-nums text-[var(--color-down)]">
        {downPct}%
      </span>
    </div>
  );
}
```

- [ ] **Step 6: Write `apps/web/src/components/trade/AssetTabs.tsx`**

```tsx
"use client";

export interface AssetTab {
  symbol: string;
  displayName: string;
  payoutPct: number;
}

export function AssetTabs({
  assets,
  active,
  onSelect,
}: {
  assets: AssetTab[];
  active: string;
  onSelect: (symbol: string) => void;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {assets.map((asset) => {
        const selected = asset.symbol === active;
        return (
          <button
            key={asset.symbol}
            type="button"
            onClick={() => onSelect(asset.symbol)}
            className={`flex shrink-0 flex-col items-start rounded-lg border px-3 py-1.5 text-left ${
              selected
                ? "border-[var(--color-brand)] bg-[var(--color-panel-2)]"
                : "border-[var(--color-edge)] bg-[var(--color-panel)]"
            }`}
          >
            <span className="text-xs font-semibold">{asset.displayName}</span>
            <span className="text-[10px] font-bold tabular-nums text-[var(--color-up)]">
              {asset.payoutPct}%
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 7: Wire both into `TradeWorkspace`**

Add an `assets` prop, hold the selected symbol in state, and render the tabs above the chart with the sentiment bar beside it:

```tsx
  const [activeSymbol, setActiveSymbol] = useState(symbol);
  const activeAsset = assets.find((a) => a.symbol === activeSymbol) ?? assets[0];

  const socket = useEngineSocket({
    symbol: activeSymbol,
    timeframe: "1m",
    token,
  });
```

```tsx
      <div className="grid gap-6 p-4 md:grid-cols-[1fr_260px]">
        <section className="flex flex-col gap-3 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
          <AssetTabs
            assets={assets}
            active={activeSymbol}
            onSelect={setActiveSymbol}
          />
          <div className="flex gap-2">
            <SentimentBar
              upPct={socket.sentiment?.upPct ?? 50}
              downPct={socket.sentiment?.downPct ?? 50}
            />
            <div className="min-w-0 flex-1">
              <PriceChart
                symbol={activeSymbol}
                timeframe="1m"
                token={token}
                precision={activeAsset?.precision ?? precision}
              />
            </div>
          </div>
        </section>
```

Pass `assets` from the trade page by loading all open assets rather than one:

```tsx
  const assetRows = await prisma.asset.findMany({
    where: { isOpen: true },
    orderBy: { symbol: "asc" },
    select: { symbol: true, displayName: true, payoutPct: true, precision: true },
  });
```

- [ ] **Step 8: Verify the sentiment bar moves**

Run both processes with bots enabled. Expected: the vertical bar beside the chart shows a live up/down split that shifts every second, and the asset tabs switch the chart between the three seeded assets with their payouts shown.

- [ ] **Step 9: Commit**

```bash
git add packages/contracts apps/engine apps/web
git commit -m "feat: sentiment bar and asset tabs"
```

---

## Task 4: Account, KYC, and two-factor authentication

**Files:**
- Create: `packages/contracts/src/account.ts`, `packages/db/src/repositories/profile.ts`, `packages/db/src/repositories/twofa.ts`, `apps/web/src/app/api/account/route.ts`, `apps/web/src/app/api/account/two-factor/route.ts`, `apps/web/src/app/(platform)/account/page.tsx`, `apps/web/src/app/(platform)/account/ProfileForm.tsx`
- Modify: `packages/contracts/src/index.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/repositories/twofa.test.ts`

**Interfaces:**
- Consumes: `prisma`, `hashPassword`
- Produces:
  - `UpdateProfileSchema` — strict, omits `role`, `cumulativeDeposits`, `kycStatus`
  - `TwoFaToggleSchema`
  - `loadProfile(actorId: string)`, `updateProfile(actorId: string, input: UpdateProfileInput)`
  - `issueTwoFactorCode(userId: string, purpose: string): Promise<void>` — logs the code
  - `verifyTwoFactorCode(userId: string, purpose: string, code: string): Promise<boolean>`

- [ ] **Step 1: Write `packages/contracts/src/account.ts`**

```ts
import { z } from "zod";

/**
 * Strict, and deliberately omits role, kycStatus and cumulativeDeposits.
 * Those are server-owned; a request carrying one is rejected, which is the
 * mass-assignment control expressed at the boundary.
 */
export const UpdateProfileSchema = z.strictObject({
  nickname: z.string().trim().max(40).optional(),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  dateOfBirth: z.string().date().optional(),
  aadhaar: z
    .string()
    .trim()
    .regex(/^[0-9]{12}$/, "Aadhaar is 12 digits")
    .optional(),
  address: z.string().trim().max(240).optional(),
  country: z.string().trim().max(60).optional(),
});
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export const TwoFaToggleSchema = z.strictObject({
  forLogin: z.boolean(),
  forWithdrawal: z.boolean(),
});
export type TwoFaToggleInput = z.infer<typeof TwoFaToggleSchema>;

export const TwoFaVerifySchema = z.strictObject({
  code: z.string().trim().regex(/^[0-9]{6}$/, "Enter the six-digit code"),
});
```

- [ ] **Step 2: Write the failing 2FA test**

Create `packages/db/src/repositories/twofa.test.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaClient } from "../../generated/prisma/client.js";
import { issueTwoFactorCode, verifyTwoFactorCode } from "./twofa.js";

const prisma = new PrismaClient();
let userId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { email: `tf-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function issueAndRead(purpose = "login"): Promise<string> {
  const code = await issueTwoFactorCode(userId, purpose);
  return code;
}

describe("two-factor codes", () => {
  it("issues a six-digit code", async () => {
    const code = await issueAndRead();
    expect(code).toMatch(/^[0-9]{6}$/);
  });

  it("stores the code hashed, never in plain text", async () => {
    const code = await issueAndRead();
    const row = await prisma.twoFactorCode.findFirstOrThrow({ where: { userId } });
    expect(row.codeHash).not.toBe(code);
    expect(row.codeHash.length).toBeGreaterThan(20);
  });

  it("verifies a correct code", async () => {
    const code = await issueAndRead();
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(true);
  });

  it("rejects an incorrect code", async () => {
    await issueAndRead();
    expect(await verifyTwoFactorCode(userId, "login", "000000")).toBe(false);
  });

  it("is single-use — the same code cannot be replayed", async () => {
    const code = await issueAndRead();
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(true);
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(false);
  });

  it("does not accept a code issued for another purpose", async () => {
    const code = await issueAndRead("withdrawal");
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(false);
  });

  it("rejects an expired code", async () => {
    const code = await issueAndRead();
    await prisma.twoFactorCode.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await verifyTwoFactorCode(userId, "login", code)).toBe(false);
  });

  it("invalidates an earlier code when a new one is issued", async () => {
    const first = await issueAndRead();
    await issueAndRead();
    expect(await verifyTwoFactorCode(userId, "login", first)).toBe(false);
  });

  it("rejects a code for a different user", async () => {
    const code = await issueAndRead();
    const other = await prisma.user.create({
      data: { email: `o-${process.hrtime.bigint()}@test.local`, passwordHash: "x" },
    });
    expect(await verifyTwoFactorCode(other.id, "login", code)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/twofa.test.ts
```

Expected: FAIL — cannot resolve `./twofa.js`.

- [ ] **Step 4: Write `packages/db/src/repositories/twofa.ts`**

```ts
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { logger } from "@asm/logger";
import { prisma } from "../client.js";

const CODE_TTL_MS = 10 * 60_000;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/**
 * Issues a code and DELIVERS IT TO THE LOG.
 *
 * No SMTP, no provider, no credentials — for a demonstration this shows the
 * flow exactly as well as email would, and a real sender is one adapter away.
 * Read the code from the engine or web terminal.
 *
 * Returns the code so tests can use it. Nothing in the request path returns it
 * to a caller.
 */
export async function issueTwoFactorCode(
  userId: string,
  purpose: string,
): Promise<string> {
  // Any earlier unused code for this purpose is dead the moment a new one is
  // issued, so an attacker cannot keep an old code alive by requesting more.
  await prisma.twoFactorCode.updateMany({
    where: { userId, purpose, usedAt: null },
    data: { usedAt: new Date() },
  });

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");

  await prisma.twoFactorCode.create({
    data: {
      userId,
      purpose,
      codeHash: hashCode(code),
      expiresAt: new Date(Date.now() + CODE_TTL_MS),
    },
  });

  logger.info(
    { evt: "auth.2fa_sent", userId, purpose, code },
    `two-factor code for ${purpose}: ${code}`,
  );

  return code;
}

export async function verifyTwoFactorCode(
  userId: string,
  purpose: string,
  code: string,
): Promise<boolean> {
  const row = await prisma.twoFactorCode.findFirst({
    where: { userId, purpose, usedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!row) return false;

  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.twoFactorCode.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    return false;
  }

  const expected = Buffer.from(row.codeHash, "hex");
  const supplied = Buffer.from(hashCode(code), "hex");
  const matches =
    expected.length === supplied.length && timingSafeEqual(expected, supplied);

  if (!matches) {
    logger.info({ evt: "auth.2fa_failed", userId, purpose }, "2fa code rejected");
    return false;
  }

  // Single-use. Claim it conditionally so a concurrent replay loses the race.
  const claimed = await prisma.twoFactorCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  return claimed.count === 1;
}
```

- [ ] **Step 5: Write `packages/db/src/repositories/profile.ts`**

```ts
import { prisma } from "../client.js";

export interface ProfileView {
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  aadhaar: string | null;
  address: string | null;
  country: string | null;
  kycStatus: string;
  twoFaForLogin: boolean;
  twoFaForWithdrawal: boolean;
}

export async function loadProfile(actorId: string): Promise<ProfileView> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: actorId },
    select: {
      email: true,
      emailVerified: true,
      nickname: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      aadhaar: true,
      address: true,
      country: true,
      kycStatus: true,
      twoFaForLogin: true,
      twoFaForWithdrawal: true,
    },
  });

  return {
    ...user,
    dateOfBirth: user.dateOfBirth
      ? user.dateOfBirth.toISOString().slice(0, 10)
      : null,
  };
}

/**
 * Writes only the whitelisted profile fields.
 *
 * Fields are picked explicitly rather than spread, so even if the schema
 * changes, `role`, `kycStatus` and `cumulativeDeposits` cannot be reached
 * through this path.
 */
export async function updateProfile(
  actorId: string,
  input: {
    nickname?: string;
    firstName?: string;
    lastName?: string;
    dateOfBirth?: string;
    aadhaar?: string;
    address?: string;
    country?: string;
  },
): Promise<void> {
  await prisma.user.update({
    where: { id: actorId },
    data: {
      nickname: input.nickname,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : undefined,
      aadhaar: input.aadhaar,
      address: input.address,
      country: input.country,
    },
  });
}

export async function setTwoFactorPreferences(
  actorId: string,
  prefs: { forLogin: boolean; forWithdrawal: boolean },
): Promise<void> {
  await prisma.user.update({
    where: { id: actorId },
    data: {
      twoFaForLogin: prefs.forLogin,
      twoFaForWithdrawal: prefs.forWithdrawal,
      twoFaEnabled: prefs.forLogin || prefs.forWithdrawal,
    },
  });
}
```

- [ ] **Step 6: Write `apps/web/src/app/api/account/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { UpdateProfileSchema } from "@asm/contracts";
import { loadProfile, updateProfile } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({ profile: await loadProfile(session.userId) });
}

export async function PATCH(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = UpdateProfileSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    log.warn(
      { evt: "security.validation_rejected", route: "account" },
      "rejected profile payload",
    );
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the details." },
      { status: 400 },
    );
  }

  await updateProfile(session.userId, parsed.data);
  log.info({ evt: "account.profile_updated", userId: session.userId }, "profile saved");

  return NextResponse.json({ profile: await loadProfile(session.userId) });
}
```

- [ ] **Step 7: Write `apps/web/src/app/api/account/two-factor/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { TwoFaToggleSchema } from "@asm/contracts";
import { issueTwoFactorCode, setTwoFactorPreferences } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";

/** PATCH updates preferences. POST issues a code for the given purpose. */
export async function PATCH(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const parsed = TwoFaToggleSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the settings." }, { status: 400 });
  }

  await setTwoFactorPreferences(session.userId, parsed.data);
  return NextResponse.json({ ok: true });
}

export async function POST(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const purpose = req.nextUrl.searchParams.get("purpose") ?? "login";
  if (purpose !== "login" && purpose !== "withdrawal") {
    return NextResponse.json({ error: "Unknown purpose." }, { status: 400 });
  }

  // The code is logged, never returned. Read it from the server terminal.
  await issueTwoFactorCode(session.userId, purpose);

  return NextResponse.json({
    sent: true,
    hint: "This build writes the code to the server log.",
  });
}
```

- [ ] **Step 8: Write `apps/web/src/app/(platform)/account/ProfileForm.tsx`**

```tsx
"use client";

import { useState } from "react";

type Profile = {
  email: string;
  emailVerified: boolean;
  nickname: string | null;
  firstName: string | null;
  lastName: string | null;
  dateOfBirth: string | null;
  aadhaar: string | null;
  address: string | null;
  country: string | null;
  kycStatus: string;
  twoFaForLogin: boolean;
  twoFaForWithdrawal: boolean;
};

const FIELDS = [
  { key: "nickname", label: "Nickname", type: "text" },
  { key: "firstName", label: "First name", type: "text" },
  { key: "lastName", label: "Last name", type: "text" },
  { key: "dateOfBirth", label: "Date of birth", type: "date" },
  { key: "aadhaar", label: "Aadhaar", type: "text" },
  { key: "address", label: "Address", type: "text" },
  { key: "country", label: "Country", type: "text" },
] as const;

export function ProfileForm({ initial }: { initial: Profile }) {
  const [profile, setProfile] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setMessage(null);
    setError(null);

    const body: Record<string, string> = {};
    for (const field of FIELDS) {
      const value = profile[field.key];
      if (value) body[field.key] = value;
    }

    const res = await fetch("/api/account", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      setMessage("Saved");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not save.");
  }

  async function toggleTwoFa(key: "twoFaForLogin" | "twoFaForWithdrawal") {
    const next = { ...profile, [key]: !profile[key] };
    setProfile(next);
    await fetch("/api/account/two-factor", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        forLogin: next.twoFaForLogin,
        forWithdrawal: next.twoFaForWithdrawal,
      }),
    });
  }

  async function sendTestCode() {
    await fetch("/api/account/two-factor?purpose=login", { method: "POST" });
    setMessage("Code written to the server log");
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold">Personal data</h2>
          <span
            className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
            style={{
              background:
                profile.kycStatus === "VERIFIED" ? "#14301f" : "#2a2213",
              color: profile.kycStatus === "VERIFIED" ? "#4fc08d" : "#e0ac50",
            }}
          >
            {profile.kycStatus === "VERIFIED" ? "Verified" : "Not verified"}
          </span>
        </div>

        <div>
          <label className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
            Email
          </label>
          <p className="mt-1 flex items-center gap-2 text-sm">
            {profile.email}
            {!profile.emailVerified ? (
              <span className="text-[10px] font-semibold text-[#e0ac50]">
                Unverified
              </span>
            ) : null}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label
                htmlFor={field.key}
                className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
              >
                {field.label}
              </label>
              <input
                id={field.key}
                type={field.type}
                value={profile[field.key] ?? ""}
                onChange={(e) =>
                  setProfile({ ...profile, [field.key]: e.target.value })
                }
                className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
              />
            </div>
          ))}
        </div>

        {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}
        {message ? (
          <p className="text-xs text-[var(--color-up)]">{message}</p>
        ) : null}

        <button
          type="button"
          onClick={() => void save()}
          className="self-start rounded-lg bg-[var(--color-brand)] px-5 py-2.5 text-sm font-semibold text-white"
        >
          Save
        </button>

        <p className="text-xs text-[var(--color-ink-2)]">
          Identity fields are stored but never verified in this build — there is
          no identity check and no document upload.
        </p>
      </section>

      <section className="flex flex-col gap-3 border-t border-[var(--color-edge)] pt-5">
        <h2 className="text-sm font-semibold">Security</h2>

        {(
          [
            ["twoFaForLogin", "To enter the platform"],
            ["twoFaForWithdrawal", "To withdraw funds"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={profile[key]}
              onChange={() => void toggleTwoFa(key)}
              className="h-4 w-4 accent-[var(--color-brand)]"
            />
            {label}
          </label>
        ))}

        <button
          type="button"
          onClick={() => void sendTestCode()}
          className="self-start text-xs font-semibold text-[var(--color-brand)] underline underline-offset-4"
        >
          Send a test code
        </button>
        <p className="text-xs text-[var(--color-ink-2)]">
          Codes are written to the server log rather than emailed — no provider
          is configured.
        </p>
      </section>
    </div>
  );
}
```

- [ ] **Step 9: Write `apps/web/src/app/(platform)/account/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadProfile } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { ProfileForm } from "./ProfileForm";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const profile = await loadProfile(session.userId);

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-8">
      <h1 className="mb-6 text-xl font-semibold tracking-tight">My account</h1>
      <ProfileForm initial={profile} />
    </main>
  );
}
```

- [ ] **Step 10: Export the new pieces and run the test**

Append to `packages/contracts/src/index.ts`:

```ts
export {
  UpdateProfileSchema,
  TwoFaToggleSchema,
  TwoFaVerifySchema,
  type UpdateProfileInput,
  type TwoFaToggleInput,
} from "./account.js";
```

Append to `packages/db/src/index.ts`:

```ts
export {
  loadProfile,
  updateProfile,
  setTwoFactorPreferences,
  type ProfileView,
} from "./repositories/profile.js";
export { issueTwoFactorCode, verifyTwoFactorCode } from "./repositories/twofa.js";
```

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading/packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" \
  pnpm exec vitest run src/repositories/twofa.test.ts
```

Expected: PASS — 9 tests.

- [ ] **Step 11: Verify the mass-assignment rejection**

```bash
curl -s -b /tmp/asm.jar -X PATCH http://localhost:3000/api/account \
  -H 'Content-Type: application/json' \
  -d '{"firstName":"Test","role":"ADMIN"}' \
  -o /dev/null -w "%{http_code}\n"
```

Expected: `400`, and the user's role is unchanged:

```bash
psql -d asm_trade -c "SELECT email, role FROM \"User\" WHERE email='trader@test.local';"
```

Expected: `USER`.

- [ ] **Step 12: Commit**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
git add packages/contracts packages/db apps/web
git commit -m "feat: account profile, kyc fields, and two-factor codes"
```

---

## Task 5: Payments history and the withdrawal page

**Files:**
- Create: `apps/web/src/app/(platform)/balance/page.tsx`, `apps/web/src/app/(platform)/withdrawal/page.tsx`, `apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx`, `apps/web/src/components/shell/PlatformTabs.tsx`

**Interfaces:**
- Consumes: `listDepositsForActor`, `listWithdrawalsForActor`, `withdrawableBalance`, `listAccountsForActor`
- Produces: the tabbed payments area from the screenshots

- [ ] **Step 1: Write `apps/web/src/components/shell/PlatformTabs.tsx`**

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/withdrawal", label: "Withdrawal" },
  { href: "/balance", label: "Payments" },
  { href: "/trade", label: "Trades" },
  { href: "/account", label: "My account" },
] as const;

export function PlatformTabs() {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold ${
              active
                ? "bg-[var(--color-panel-2)] text-[var(--color-ink)]"
                : "text-[var(--color-ink-2)] hover:text-[var(--color-ink)]"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: Write `apps/web/src/app/(platform)/balance/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  formatMoney,
  listDepositsForActor,
  listWithdrawalsForActor,
} from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PlatformTabs } from "@/components/shell/PlatformTabs";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  AWAITING_PAYMENT: "Awaiting payment",
  PENDING_CONFIRMATION: "Processing",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  REQUESTED: "Waiting confirmation",
  APPROVED: "Approved",
  PAID: "Paid",
};

export default async function BalancePage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const [deposits, withdrawals] = await Promise.all([
    listDepositsForActor(session.userId, 50),
    listWithdrawalsForActor(session.userId, 50),
  ]);

  const rows = [
    ...deposits.map((d) => ({
      id: d.id,
      at: d.createdAt,
      status: d.status,
      kind: "Deposit",
      method: d.method,
      amount: d.amountUsd,
      note:
        d.status === "PENDING_CONFIRMATION"
          ? "Payments with this method can take up to 48 hours. The status may appear as “Failed” until the funds are received on our side."
          : null,
    })),
    ...withdrawals.map((w) => ({
      id: w.id,
      at: w.createdAt,
      status: w.status,
      kind: "Withdrawal",
      method: w.method,
      amount: -w.amount,
      note: null,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-6 py-8">
      <PlatformTabs />
      <h1 className="text-lg font-semibold tracking-tight">Payments</h1>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--color-ink-2)]">
          No transactions yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-[0.1em] text-[var(--color-ink-2)]">
                <th className="pb-2">Transaction ID</th>
                <th className="pb-2">Date and time</th>
                <th className="pb-2">Status</th>
                <th className="pb-2">Type</th>
                <th className="pb-2">Payment system</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--color-edge)] align-top"
                >
                  <td className="py-3 font-mono text-xs">
                    {row.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className="py-3 tabular-nums text-[var(--color-ink-2)]">
                    {row.at.toISOString().slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="py-3">
                    <span className="flex items-center gap-1.5">
                      <span aria-hidden>🕐</span>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                    {row.note ? (
                      <p className="mt-2 max-w-sm rounded-lg bg-[var(--color-panel-2)] p-2 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                        {row.note}
                      </p>
                    ) : null}
                  </td>
                  <td className="py-3">{row.kind}</td>
                  <td className="py-3">{row.method}</td>
                  <td
                    className="py-3 text-right font-semibold tabular-nums"
                    style={{
                      color:
                        row.amount >= 0
                          ? "var(--color-up)"
                          : "var(--color-down)",
                    }}
                  >
                    {row.amount >= 0 ? "+" : "−"}
                    {formatMoney(Math.abs(row.amount), "USD")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 3: Write `apps/web/src/app/(platform)/withdrawal/WithdrawForm.tsx`**

```tsx
"use client";

import { useState } from "react";
import { DEPOSIT_METHODS } from "@asm/contracts";

export function WithdrawForm({
  accountId,
  withdrawableMinor,
}: {
  accountId: string;
  withdrawableMinor: number;
}) {
  const [amountMajor, setAmountMajor] = useState(
    Math.max(1, Math.floor(withdrawableMinor / 100)),
  );
  const [method, setMethod] = useState<(typeof DEPOSIT_METHODS)[number]>(
    "PhonePe",
  );
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/withdrawals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accountId,
        amount: Math.round(amountMajor * 100),
        method,
      }),
    });

    if (res.ok) {
      setDone(true);
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not request that withdrawal.");
  }

  if (done) {
    return (
      <p className="rounded-lg border border-[var(--color-up)] bg-[#14301f] p-3 text-sm text-[#4fc08d]">
        Withdrawal requested. Requests are processed in 3 business days.
      </p>
    );
  }

  if (withdrawableMinor <= 0) {
    return (
      <div className="rounded-lg border border-[var(--color-down)] bg-[#2a1418] p-4">
        <p className="text-sm text-[#e8798c]">
          You can withdraw money from your balance to the method you used for
          depositing. Requests are processed in 3 business days.
        </p>
        <a
          href="/deposit"
          className="mt-2 inline-block text-xs font-bold text-[var(--color-up)] underline underline-offset-4"
        >
          Make a deposit
        </a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="wamount"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Amount
        </label>
        <input
          id="wamount"
          type="number"
          min={1}
          max={Math.floor(withdrawableMinor / 100)}
          value={amountMajor}
          onChange={(e) => setAmountMajor(Number(e.target.value))}
          className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm tabular-nums outline-none focus:border-[var(--color-brand)]"
        />
      </div>

      <div>
        <label
          htmlFor="wmethod"
          className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]"
        >
          Method
        </label>
        <select
          id="wmethod"
          value={method}
          onChange={(e) =>
            setMethod(e.target.value as (typeof DEPOSIT_METHODS)[number])
          }
          className="mt-1 w-full rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
        >
          {DEPOSIT_METHODS.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[var(--color-ink-2)]">
          Only a method you have already deposited with is accepted.
        </p>
      </div>

      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}

      <button
        type="submit"
        className="rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white"
      >
        Request withdrawal
      </button>
    </form>
  );
}
```

- [ ] **Step 4: Write `apps/web/src/app/(platform)/withdrawal/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  BONUS_PERCENT,
  TURNOVER_MULTIPLE,
  formatMoney,
  listAccountsForActor,
  withdrawableBalance,
} from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { PlatformTabs } from "@/components/shell/PlatformTabs";
import { WithdrawForm } from "./WithdrawForm";

export const dynamic = "force-dynamic";

export default async function WithdrawalPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const accounts = await listAccountsForActor(session.userId);
  const live = accounts.find((a) => a.type === "LIVE");
  if (!live) redirect("/trade");

  const balance = await withdrawableBalance(live.id);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-6 py-8">
      <PlatformTabs />
      <h1 className="text-lg font-semibold tracking-tight">Withdrawal</h1>

      <div className="grid gap-5 md:grid-cols-2">
        <section className="flex flex-col gap-4 rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
          <h2 className="text-sm font-semibold">Account</h2>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
              In the account
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(live.realBalance + live.bonusBalance, live.currency)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-2)]">
              Available for withdrawal
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {formatMoney(balance.withdrawable, live.currency)}
            </p>
          </div>

          {balance.lockedBonus > 0 ? (
            <div className="rounded-lg bg-[var(--color-panel-2)] p-3">
              <p className="text-xs font-semibold">
                {formatMoney(balance.lockedBonus, live.currency)} bonus locked
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--color-ink-2)]">
                A {BONUS_PERCENT}% bonus requires {TURNOVER_MULTIPLE}× turnover
                before it can be withdrawn.{" "}
                {formatMoney(balance.turnoverRemaining, live.currency)} of
                trading volume remaining.
              </p>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-[var(--color-edge)] bg-[var(--color-panel)] p-4">
          <h2 className="mb-3 text-sm font-semibold">Withdraw</h2>
          <WithdrawForm
            accountId={live.id}
            withdrawableMinor={balance.withdrawable}
          />
        </section>
      </div>
    </main>
  );
}
```

- [ ] **Step 5: Verify the pages**

Open `/balance` and `/withdrawal`. Expected: the tab bar, a payments table with the 48-hour note on pending deposits, and a withdrawal page showing locked bonus and remaining turnover when a bonus is outstanding.

- [ ] **Step 6: Commit**

```bash
git add apps/web
git commit -m "feat(web): payments history and withdrawal page"
```

---

## Task 6: Support tickets and admin payout control

**Files:**
- Create: `packages/contracts/src/support.ts`, `packages/db/src/repositories/support.ts`, `apps/web/src/app/api/support/route.ts`, `apps/web/src/app/(platform)/support/page.tsx`, `apps/web/src/app/(platform)/support/TicketForm.tsx`, `apps/web/src/app/admin/assets/page.tsx`, `apps/web/src/app/admin/assets/actions.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/db/src/index.ts`

**Interfaces:**
- Consumes: `prisma`, `requireAdmin`
- Produces:
  - `CreateTicketSchema` — `{ subject, body }`
  - `createTicket(actorId, input)`, `listTicketsForActor(actorId, limit)`
  - `setAssetPayout(assetId: string, payoutPct: number, adminId: string): Promise<void>`

- [ ] **Step 1: Write `packages/contracts/src/support.ts`**

```ts
import { z } from "zod";

export const CreateTicketSchema = z.strictObject({
  subject: z.string().trim().min(3).max(120),
  body: z.string().trim().min(10).max(4_000),
});
export type CreateTicketInput = z.infer<typeof CreateTicketSchema>;

export const FAQ = [
  {
    q: "How do I withdraw money from the account?",
    a: "Open Withdrawal, enter an amount within your available balance, and choose a method you have already deposited with. Requests are processed in 3 business days.",
  },
  {
    q: "How long does it take to withdraw funds?",
    a: "Three business days from approval.",
  },
  {
    q: "What is the minimum withdrawal amount?",
    a: "$1.00 in this build.",
  },
  {
    q: "Is there a fee for depositing or withdrawing?",
    a: "No platform fee. The deposit conversion rate includes a spread, which is where a real processor takes its margin.",
  },
  {
    q: "Why is my bonus not withdrawable?",
    a: "A 50% deposit bonus carries a 30× turnover requirement. Until that trading volume is reached, bonus funds stay separate from your withdrawable balance.",
  },
  {
    q: "What is account verification?",
    a: "Identity fields are stored in this build but never verified — there is no identity check and no document upload.",
  },
  {
    q: "Why does my deposit say Processing?",
    a: "A deposit is confirmed by matching the exact amount against the receiving account. Until that match is found it stays in Processing, which can take up to 48 hours.",
  },
  {
    q: "Is this a real trading platform?",
    a: "No. ASM Trade is a demonstration of how manipulated trading platforms operate. No real money is involved and no order reaches any market.",
  },
] as const;
```

- [ ] **Step 2: Write `packages/db/src/repositories/support.ts`**

```ts
import { prisma } from "../client.js";
import type { SupportTicket } from "../../generated/prisma/client.js";

export async function createTicket(
  actorId: string,
  input: { subject: string; body: string },
): Promise<SupportTicket> {
  return prisma.supportTicket.create({
    data: { userId: actorId, subject: input.subject, body: input.body },
  });
}

/** Ownership is in the predicate. */
export async function listTicketsForActor(
  actorId: string,
  limit: number,
): Promise<SupportTicket[]> {
  return prisma.supportTicket.findMany({
    where: { userId: actorId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
}
```

- [ ] **Step 3: Write `apps/web/src/app/api/support/route.ts`**

```ts
import { NextResponse, type NextRequest } from "next/server";
import { CreateTicketSchema } from "@asm/contracts";
import { createTicket, listTicketsForActor } from "@asm/db";
import { childLogger } from "@asm/logger";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { requestContext } from "@/lib/request-context";
import { checkRateLimit } from "@/lib/rate-limit";

export async function POST(req: NextRequest) {
  const ctx = requestContext(req);
  const log = childLogger(ctx.cid);

  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (!(await checkRateLimit(`rl:ticket:${session.userId}`, 5, 600))) {
    return NextResponse.json(
      { error: "You have opened several tickets recently. Try again later." },
      { status: 429 },
    );
  }

  const parsed = CreateTicketSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Check the ticket." },
      { status: 400 },
    );
  }

  const ticket = await createTicket(session.userId, parsed.data);
  log.info({ evt: "support.ticket_created", ticketId: ticket.id }, "ticket created");

  return NextResponse.json({ id: ticket.id }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await readSession(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }
  return NextResponse.json({
    tickets: await listTicketsForActor(session.userId, 20),
  });
}
```

- [ ] **Step 4: Write `apps/web/src/app/(platform)/support/TicketForm.tsx`**

```tsx
"use client";

import { useState } from "react";

export function TicketForm() {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const res = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject, body }),
    });

    if (res.ok) {
      setDone(true);
      setSubject("");
      setBody("");
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setError(data.error ?? "Could not submit that ticket.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="Subject"
        required
        className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Describe the problem"
        required
        rows={5}
        className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-3 py-2 text-sm outline-none focus:border-[var(--color-brand)]"
      />
      {error ? <p className="text-xs text-[var(--color-down)]">{error}</p> : null}
      {done ? (
        <p className="text-xs text-[var(--color-up)]">
          Ticket submitted. There is no support team in this build.
        </p>
      ) : null}
      <button
        type="submit"
        className="self-start rounded-lg bg-[var(--color-brand)] px-4 py-2.5 text-sm font-semibold text-white"
      >
        Create request
      </button>
    </form>
  );
}
```

Plain text only — no Markdown rendering, which closes the stored-XSS vector the threat model lists for ticket bodies. React escapes the output by default.

- [ ] **Step 5: Write `apps/web/src/app/(platform)/support/page.tsx`**

```tsx
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { FAQ } from "@asm/contracts";
import { listTicketsForActor } from "@asm/db";
import { SESSION_COOKIE, readSession } from "@/lib/session";
import { TicketForm } from "./TicketForm";

export const dynamic = "force-dynamic";

export default async function SupportPage() {
  const store = await cookies();
  const session = await readSession(store.get(SESSION_COOKIE)?.value);
  if (!session) redirect("/login");

  const tickets = await listTicketsForActor(session.userId, 20);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
      <section>
        <h1 className="mb-4 text-lg font-semibold tracking-tight">
          Frequently asked questions
        </h1>
        <div className="flex flex-col gap-1">
          {FAQ.map((entry) => (
            <details
              key={entry.q}
              className="rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] px-4 py-3"
            >
              <summary className="cursor-pointer text-sm font-semibold">
                {entry.q}
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-[var(--color-ink-2)]">
                {entry.a}
              </p>
            </details>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Create a request</h2>
        <TicketForm />
      </section>

      {tickets.length > 0 ? (
        <section>
          <h2 className="mb-3 text-sm font-semibold">My requests</h2>
          <ul className="flex flex-col gap-1">
            {tickets.map((ticket) => (
              <li
                key={ticket.id}
                className="flex items-baseline justify-between border-t border-[var(--color-edge)] py-2 text-sm"
              >
                <span>{ticket.subject}</span>
                <span className="text-xs text-[var(--color-ink-2)]">
                  {ticket.status}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
```

- [ ] **Step 6: Write `apps/web/src/app/admin/assets/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@asm/db";
import { logger } from "@asm/logger";
import { requireAdmin } from "@/lib/require-admin";

/**
 * Edits the asset's payout only. Every open trade already stores the payout it
 * was opened at, so a change here can never alter an existing position's terms.
 */
export async function setAssetPayoutAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();

  const assetId = String(formData.get("assetId") ?? "");
  const payoutPct = Number(formData.get("payoutPct"));

  if (!assetId || !Number.isInteger(payoutPct) || payoutPct < 1 || payoutPct > 200) {
    return;
  }

  const before = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { payoutPct: true, symbol: true },
  });
  if (!before) return;

  await prisma.asset.update({ where: { id: assetId }, data: { payoutPct } });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: "asset.payout_changed",
      targetType: "Asset",
      targetId: assetId,
      before: { payoutPct: before.payoutPct },
      after: { payoutPct },
    },
  });

  logger.info(
    {
      evt: "admin.action",
      action: "asset.payout_changed",
      actorId: userId,
      symbol: before.symbol,
      from: before.payoutPct,
      to: payoutPct,
    },
    "asset payout changed",
  );

  revalidatePath("/admin/assets");
}

export async function toggleAssetOpenAction(formData: FormData): Promise<void> {
  const { userId } = await requireAdmin();
  const assetId = String(formData.get("assetId") ?? "");
  if (!assetId) return;

  const asset = await prisma.asset.findUnique({
    where: { id: assetId },
    select: { isOpen: true, symbol: true },
  });
  if (!asset) return;

  await prisma.asset.update({
    where: { id: assetId },
    data: { isOpen: !asset.isOpen },
  });

  await prisma.auditLog.create({
    data: {
      actorId: userId,
      action: "asset.open_toggled",
      targetType: "Asset",
      targetId: assetId,
      before: { isOpen: asset.isOpen },
      after: { isOpen: !asset.isOpen },
    },
  });

  revalidatePath("/admin/assets");
}
```

- [ ] **Step 7: Write `apps/web/src/app/admin/assets/page.tsx`**

```tsx
import { prisma } from "@asm/db";
import { requireAdmin } from "@/lib/require-admin";
import { setAssetPayoutAction, toggleAssetOpenAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function AdminAssetsPage() {
  await requireAdmin();

  const assets = await prisma.asset.findMany({ orderBy: { symbol: "asc" } });

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
      <header>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-2)]">
          Admin
        </p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Assets</h1>
        <p className="mt-1 text-xs text-[var(--color-ink-2)]">
          Payout changes take effect for new trades only. Open positions settle
          on the terms they were opened at.
        </p>
      </header>

      <ul className="flex flex-col gap-2">
        {assets.map((asset) => (
          <li
            key={asset.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--color-edge)] bg-[var(--color-panel)] p-3"
          >
            <div className="min-w-[140px]">
              <p className="text-sm font-semibold">{asset.displayName}</p>
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-ink-2)]">
                {asset.kind}
              </p>
            </div>

            <form action={setAssetPayoutAction} className="flex items-center gap-2">
              <input type="hidden" name="assetId" value={asset.id} />
              <input
                name="payoutPct"
                type="number"
                min={1}
                max={200}
                defaultValue={asset.payoutPct}
                className="w-20 rounded-md border border-[var(--color-edge)] bg-[var(--color-panel-2)] px-2 py-1.5 text-sm tabular-nums"
              />
              <span className="text-xs text-[var(--color-ink-2)]">%</span>
              <button
                type="submit"
                className="rounded-md bg-[var(--color-brand)] px-3 py-1.5 text-xs font-bold text-white"
              >
                Set payout
              </button>
            </form>

            <form action={toggleAssetOpenAction} className="ml-auto">
              <input type="hidden" name="assetId" value={asset.id} />
              <button
                type="submit"
                className="rounded-md border border-[var(--color-edge)] px-3 py-1.5 text-xs font-bold"
              >
                {asset.isOpen ? "Close" : "Open"}
              </button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

- [ ] **Step 8: Export the new pieces**

Append to `packages/contracts/src/index.ts`:

```ts
export {
  CreateTicketSchema,
  FAQ,
  type CreateTicketInput,
} from "./support.js";
```

Append to `packages/db/src/index.ts`:

```ts
export { createTicket, listTicketsForActor } from "./repositories/support.js";
```

- [ ] **Step 9: Verify the payout control**

Log in as admin, open `/admin/assets`, set AUD/NZD OTC to `85`, and press **Set payout**. Expected: the trade ticket's payout figure updates on the next chart subscription, and the audit log records the change:

```bash
psql -d asm_trade -c "
SELECT action, before, after FROM \"AuditLog\"
WHERE action = 'asset.payout_changed' ORDER BY \"createdAt\" DESC LIMIT 1;"
```

Expected: `before` showing `100`, `after` showing `85`.

Then confirm open positions were untouched:

```bash
psql -d asm_trade -c "
SELECT DISTINCT \"payoutPct\" FROM \"Trade\" WHERE status = 'OPEN';"
```

Expected: still `100` for trades opened before the change.

- [ ] **Step 10: Commit**

```bash
git add packages/contracts packages/db apps/web
git commit -m "feat: support tickets and admin payout control"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the whole suite**

```bash
cd /Users/solminde/Developer/Personal/AMScoins/asmtrading
pnpm lint
pnpm typecheck
pnpm test
```

Expected: all clean.

- [ ] **Step 2: Run the database-backed suites**

```bash
cd packages/db
DATABASE_URL="postgresql://asm_owner:asm_dev_password@localhost:5433/asm_trade_test?schema=public" pnpm exec vitest run
cd ../..
```

Expected: PASS across account, trade, account-stats, shadow, deposit, matcher, withdrawal, and twofa suites.

- [ ] **Step 3: Walk the whole platform**

With both processes running, confirm each screen renders and behaves:

| Route | Expect |
|---|---|
| `/trade` | Rail, top bar, asset tabs, sentiment bar, chart, ticket, trades |
| `/deposit` | Method picker → amount → checkout handoff |
| `/balance` | Payments table with the 48-hour note |
| `/withdrawal` | Balances, locked bonus, turnover remaining |
| `/account` | Profile fields, KYC badge, 2FA toggles |
| `/support` | FAQ accordion, ticket form, my requests |
| `/admin/algorithm` | Realised vs target, shadow counts |
| `/admin/deposits` | Pending claims beside the bank feed |
| `/admin/assets` | Payout editor and open/close |

- [ ] **Step 4: Verify the rail's disabled items are genuinely inert**

```bash
curl -s -b /tmp/asm.jar -o /dev/null -w "%{http_code}\n" http://localhost:3000/tournaments
```

Expected: `404` — no route exists, and the rail renders it disabled rather than linking to a broken page.

- [ ] **Step 5: Re-verify shadow containment across the new routes**

```bash
for path in /api/trades /api/deposits /api/account /api/support; do
  echo -n "$path: "
  curl -s -b /tmp/asm.jar "http://localhost:3000$path?accountId=none" \
    | grep -ciE 'honestExitPrice|honestResult|biasApplied|shadow' || echo 0
done
```

Expected: `0` for every route.

- [ ] **Step 6: Confirm the standing constraints hold**

```bash
grep -E '^BANK_FEED=|^BOTS_ENABLED=' .env
```

Expected: `BANK_FEED="simulated"`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: plan 07 verification"
```

---

## Definition of Done

- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass
- [ ] The icon rail shows all seven destinations, with the four deferred ones dimmed and inert
- [ ] The top bar shows the wordmark, promo banner, account switcher, Deposit and Withdrawal
- [ ] The sentiment bar updates every second and is stake-weighted
- [ ] Asset tabs switch the chart between the three seeded assets with live payouts
- [ ] `/account` saves profile fields; a payload containing `role` returns 400 and changes nothing
- [ ] A 2FA code appears in the server log, verifies once, and is rejected on replay
- [ ] `/balance` lists deposits and withdrawals with the 48-hour processing note
- [ ] `/withdrawal` shows locked bonus and remaining turnover, and refuses an unused method
- [ ] `/support` renders the FAQ and accepts a ticket
- [ ] `/admin/assets` changes an asset's payout, writes an audit row, and leaves open trades untouched
- [ ] No response on any route contains a shadow field
- [ ] `BANK_FEED` is still `simulated`

## Deferred, deliberately

Four rail destinations have registry entries and no screens: **Tournaments**, **Market**, **Analytics**, **More**. There are no screenshots for them, so building them would mean inventing an interface and calling it parity. Each now needs only a route folder and `available: true`.

Also not built, and worth naming rather than leaving as a silent gap:

- **Document upload for KYC.** Fields are stored; nothing is verified. Adding it would mean the file-upload threat surface from the threat model — MIME confusion, polyglots, path traversal — which is a task of its own.
- **A real 2FA sender.** The log is the delivery channel. An SMTP or provider adapter slots in behind `issueTwoFactorCode` without touching callers.
- **Chart drawing tools and additional timeframes.** The engine already persists 1m candles; 5m and 15m aggregation and the drawing layer are additive.

## The build, complete

With Plan 07 done, ASM Trade runs end to end: registration and login, a live chart from real market data, trades that settle against an exposure-driven price engine under a compensated win-rate controller, a shadow ledger recording every counterfactual, a full deposit flow with odd-amount reconciliation and an admin queue, a companion app that can feed it real bank alerts, and the surrounding platform surface.

Every part of it is a demonstration. `BANK_FEED` stays `simulated`, no real user ever reaches it, and the shadow ledger is what turns a convincing clone into something that can actually teach someone how these platforms work.
