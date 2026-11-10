# Mobile P3 — Payments, History, Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill the Payments, History and Account tabs with native versions of the mobile web flows: deposit (UPI app hand-off, QR, USDT, claims), withdrawal, unified history with status timelines, account hub and native-camera KYC.

**Architecture:** Every write goes to an existing web route; reads use P1's `/api/v1/*` and existing `GET` routes through the P2 `api()` client and React Query. Pure logic (UPI scheme building, installed-app selection, image compression steps, history merging, deposit/withdraw validation) lives in framework-free modules with vitest tests. Screens are expo-router routes nested under the tabs.

**Tech Stack:** P2 stack plus `react-native-qrcode-svg`, `expo-camera`, `expo-image-picker`, `expo-image-manipulator`, `expo-clipboard`, `@shopify/flash-list`.

**Spec:** `docs/superpowers/specs/2026-10-14-mobile-p3-payments-account-design.md` · **Needs:** P1 and P2 merged.

## Global Constraints

- No new money logic in the app: limits, KYC gate, bonus and statuses come from `@asm/client-core`, `@asm/contracts` and the server. Server errors are shown verbatim (`ApiError.message`).
- Deposit methods: `PhonePe`, `Gpay`, `PayTM`, `UPI`, `USDT` (`DEPOSIT_METHODS`). UPI rows show "Coming soon" when `upiEnabled` is false; USDT hidden with no networks.
- UPI app schemes: PhonePe `phonepe://pay?…`, GPay `tez://upi/pay?…`, Paytm `paytmmp://pay?…`, any app `upi://pay?…`, all carrying the server-built `upiUri` query unchanged. Declared in the Android manifest `<queries>`.
- Checkout status polling every **4s** while the pay screen is visible; immediate poll when the app returns to the foreground; stop on `COMPLETED`, `REJECTED`, `EXPIRED`.
- Withdrawal limits from `@asm/client-core` `withdrawal-limits` (₹700–₹50,000 on INR). KYC `VERIFIED` required (server enforces; app shows the gate card). No withdrawal 2FA step.
- KYC documents: `AADHAAR_FRONT`, `AADHAAR_BACK`, `PAN`, `SELFIE`. Compression: long side 1600px, JPEG quality 0.85 → 0.7 → 0.55 → 0.4, stop at ≤ 900,000 bytes.
- History filters: All · Trades · Deposits · Withdrawals (`HistoryFilter`). Payments paged with P1's cursor (`limit=20`).
- Deep links: `indianxtrade://history?tx=d:<id>` / `w:<id>` open the payment detail sheet.
- Every new UI string in both `en.json` and `hi.json` (parity test from P2 must pass).
- Touch targets ≥ 44pt; skeleton on first load, empty state, error state with Retry on every list.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Map

```
apps/mobile/
  app/(tabs)/payments/_layout.tsx  index.tsx  deposit.tsx  pay/[token].tsx  claim/[id].tsx  withdraw.tsx
  app/(tabs)/history.tsx
  app/(tabs)/account/_layout.tsx  index.tsx  profile.tsx  verify.tsx  currency.tsx  demo.tsx
        notifications.tsx  security.tsx  language.tsx  support.tsx  leaderboard.tsx
  src/api/queries.ts                 (+ wallet, payments, depositConfig, checkout, prefill, profile, tickets, leaderboard)
  src/payments/upi-apps.ts (+test)   src/payments/deposit-form.ts (+test)  src/payments/withdraw-form.ts (+test)
  src/payments/AmountStep.tsx  MethodStep.tsx  UpiPay.tsx  UsdtPay.tsx  PayResult.tsx  ClaimForm.tsx
  src/payments/useCheckoutPoll.ts  BalanceCard.tsx
  src/history/merge.ts (+test)  HistoryList.tsx  DetailSheet.tsx  Timeline.tsx
  src/kyc/compress.ts (+test)  CaptureScreen.tsx  kyc-flow.ts (+test)  upload.ts
  src/ui/StepHeader.tsx  SummaryCard.tsx  EmptyState.tsx  ErrorState.tsx  ListRow.tsx  Keypad.tsx
  e2e/deposit.yaml  withdraw-kyc.yaml  history.yaml
```

---

### Task 1: Queries, shared UI pieces and the Payments tab

**Files:**
- Modify: `apps/mobile/src/api/queries.ts`
- Create: `apps/mobile/src/ui/StepHeader.tsx`, `SummaryCard.tsx`, `EmptyState.tsx`, `ErrorState.tsx`, `ListRow.tsx`, `Keypad.tsx`
- Create: `apps/mobile/src/payments/BalanceCard.tsx`
- Move: `apps/mobile/app/(tabs)/payments.tsx` → `apps/mobile/app/(tabs)/payments/index.tsx`; create `payments/_layout.tsx`
- Modify: `apps/mobile/src/trade/KeypadSheet.tsx` (reuse `Keypad`), `apps/mobile/app/(tabs)/trade.tsx` (bonus tiers from wallet)

**Interfaces:**
- Produces (queries): `useWallet()`, `usePaymentsInfinite()`, `useDepositConfig()`, `useCheckout(token)`, `useWithdrawalPrefill()`, `useProfile()`, `useTickets()`, `useLeaderboard()`, and `invalidateMoney()` (invalidates wallet, payments, bootstrap).
- Produces (UI): `StepHeader({ step, of, title, onBack })`, `SummaryCard({ rows: { label: string; value: string }[] })`, `EmptyState({ title, body })`, `ErrorState({ message, onRetry })`, `ListRow({ title, subtitle?, right?, onPress? })`, `Keypad({ value, onChange, decimals: 0 | 2 })`.

- [ ] **Step 1: Add the queries**

Append to `src/api/queries.ts`:

```ts
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  CheckoutViewSchema,
  DepositConfigSchema,
  LeaderboardResultSchema,
  PaymentsPageSchema,
  WalletSchema,
  WithdrawalPrefillSchema,
} from "@asm/contracts";
import { z } from "zod";

export const useWallet = () => useQuery({ queryKey: ["wallet"], queryFn: () => api("/api/v1/wallet", { schema: WalletSchema }) });

export const usePaymentsInfinite = () =>
  useInfiniteQuery({
    queryKey: ["payments"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api(`/api/v1/payments?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { schema: PaymentsPageSchema }),
    getNextPageParam: (last) => last.nextCursor,
  });

export const useDepositConfig = () =>
  useQuery({ queryKey: ["deposit-config"], queryFn: () => api("/api/v1/deposit-config", { schema: DepositConfigSchema }) });

export const useCheckout = (token: string) =>
  useQuery({ queryKey: ["checkout", token], queryFn: () => api(`/api/v1/checkout/${encodeURIComponent(token)}`, { schema: CheckoutViewSchema }) });

export const useWithdrawalPrefill = () =>
  useQuery({ queryKey: ["withdrawal-prefill"], queryFn: () => api("/api/v1/withdrawal-prefill", { schema: WithdrawalPrefillSchema }) });

const ProfileResponse = z.object({ profile: z.record(z.string(), z.unknown()) });
export const useProfile = () =>
  useQuery({ queryKey: ["profile"], queryFn: async () => (await api("/api/account", { schema: ProfileResponse })).profile });

const TicketsResponse = z.object({ tickets: z.array(z.record(z.string(), z.unknown())) });
export const useTickets = () =>
  useQuery({ queryKey: ["tickets"], queryFn: async () => (await api("/api/support", { schema: TicketsResponse })).tickets });

export const useLeaderboard = () =>
  useQuery({ queryKey: ["leaderboard"], queryFn: () => api("/api/leaderboard", { schema: LeaderboardResultSchema }) });

export function invalidateMoney() {
  void queryClient.invalidateQueries({ queryKey: ["wallet"] });
  void queryClient.invalidateQueries({ queryKey: ["payments"] });
  void queryClient.invalidateQueries({ queryKey: ["bootstrap"] });
}
```

Profile and tickets use loose record schemas because `ProfileView` and ticket rows are not contract schemas today; add `ProfileViewSchema` and `TicketSchema` to `packages/contracts/src/account.ts` / `support.ts` (fields copied from `packages/db/src/repositories/profile.ts` `ProfileView` and the support repository's ticket select) and tighten these two queries in the same commit. Confirm `GET /api/leaderboard`'s response matches `LeaderboardResultSchema`; if it wraps it (`{ result }`), unwrap in the `queryFn`.

- [ ] **Step 2: Shared UI pieces**

`src/ui/StepHeader.tsx`:

```tsx
import { Pressable, Text, View } from "react-native";
import { Icon } from "./Icon";
import { color, space } from "@/theme/tokens";

export function StepHeader({ step, of, title, onBack }: { step: number; of: number; title: string; onBack?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space(2), paddingVertical: space(2) }}>
      {onBack ? (
        <Pressable accessibilityLabel="Back" onPress={onBack} hitSlop={12} style={{ transform: [{ rotate: "180deg" }] }}>
          <Icon name="chevron" />
        </Pressable>
      ) : null}
      <Text style={{ color: color.ink, fontSize: 18, fontWeight: "700", flex: 1 }}>{title}</Text>
      <Text style={{ color: color.ink2, fontSize: 12 }}>{step}/{of}</Text>
    </View>
  );
}
```

`src/ui/SummaryCard.tsx`:

```tsx
import { Text, View } from "react-native";
import { Card } from "@/theme/ui";
import { color, space } from "@/theme/tokens";

export function SummaryCard({ rows }: { rows: { label: string; value: string }[] }) {
  return (
    <Card style={{ gap: space(2) }}>
      {rows.map((r) => (
        <View key={r.label} style={{ flexDirection: "row", justifyContent: "space-between", gap: space(3) }}>
          <Text style={{ color: color.ink2 }}>{r.label}</Text>
          <Text style={{ color: color.ink, fontWeight: "600", flexShrink: 1, textAlign: "right" }}>{r.value}</Text>
        </View>
      ))}
    </Card>
  );
}
```

`src/ui/EmptyState.tsx` / `ErrorState.tsx`:

```tsx
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View style={{ padding: space(8), alignItems: "center", gap: space(2) }}>
      <Txt variant="title">{title}</Txt>
      {body ? <Txt variant="small" style={{ textAlign: "center" }}>{body}</Txt> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <View style={{ padding: space(8), alignItems: "center", gap: space(3) }}>
      <Txt style={{ textAlign: "center" }}>{message}</Txt>
      <Button label={t("common.retry")} kind="secondary" onPress={onRetry} />
    </View>
  );
}
```

(put `ErrorState` in its own file `ErrorState.tsx` with the same imports.)

`src/ui/ListRow.tsx`:

```tsx
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "./Icon";
import { color, space } from "@/theme/tokens";

export function ListRow({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={{ minHeight: 56, flexDirection: "row", alignItems: "center", gap: space(3), paddingVertical: space(2) }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: color.ink, fontSize: 15 }}>{title}</Text>
        {subtitle ? <Text style={{ color: color.ink2, fontSize: 12 }}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress ? <Icon name="chevron" size={18} color={color.ink2} /> : null}
    </Pressable>
  );
}
```

`src/ui/Keypad.tsx` — extract the keypad grid from P2's `KeypadSheet` into a reusable component:

```tsx
import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";
import { color, radius, space } from "@/theme/tokens";

export function nextAmount(value: string, key: string, decimals: 0 | 2): string {
  if (key === "⌫") return value.slice(0, -1);
  if (key === ".") return decimals === 0 || value.includes(".") ? value : (value || "0") + ".";
  const [, frac] = value.split(".");
  if (frac !== undefined && frac.length >= decimals) return value;
  if (value === "0") return key;
  return (value + key).slice(0, 12);
}

export function Keypad({ value, onChange, decimals }: { value: string; onChange: (v: string) => void; decimals: 0 | 2 }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", decimals ? "." : "", "0", "⌫"];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space(2), justifyContent: "center" }}>
      {keys.map((k, i) => (
        <Pressable
          key={i}
          testID={k ? `key-${k === "⌫" ? "del" : k}` : undefined}
          disabled={!k}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onChange(nextAmount(value, k, decimals));
          }}
          style={{ width: "30%", height: 56, borderRadius: radius.md, backgroundColor: k ? color.tile : "transparent", alignItems: "center", justifyContent: "center" }}
        >
          <Text style={{ color: color.ink, fontSize: 22, fontWeight: "600" }}>{k}</Text>
        </Pressable>
      ))}
    </View>
  );
}
```

Move `nextAmount` into `src/payments/amount-keys.ts` with a test (`"" + "0"` → `"0"`, `"12.3" + "4"` with 2 decimals → `"12.34"`, `"12.34" + "5"` → `"12.34"`, `"." with decimals 0` ignored, `"⌫"` deletes) so it is testable without React Native; `Keypad.tsx` imports it. Update P2's `KeypadSheet` to render `<Keypad>`; its `testID`s change to `key-<k>` / `key-del` — update `e2e/login-trade.yaml` accordingly.

- [ ] **Step 3: Balance card and Payments tab**

`src/payments/BalanceCard.tsx`:

```tsx
import { router } from "expo-router";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { formatMinor } from "@asm/client-core";
import type { Wallet } from "@asm/contracts";
import { useSocket } from "@/socket/socket-store";
import { Button, Card } from "@/theme/ui";
import { color, space } from "@/theme/tokens";

export function BalanceCard({ wallet }: { wallet: Wallet }) {
  const { t } = useTranslation();
  const live = wallet.accounts.find((a) => a.type === "LIVE");
  const liveBal = useSocket((s) => (live ? s.trades.balances[live.id] : undefined)) ?? live;
  if (!live || !liveBal) return null;
  const tierIndex = Math.min(wallet.completedDeposits, wallet.bonusTiers.length);
  return (
    <Card style={{ gap: space(3) }}>
      <View>
        <Text style={{ color: color.ink2, fontSize: 13 }}>{t("payments.balance")}</Text>
        <Text style={{ color: color.ink, fontSize: 28, fontWeight: "800" }}>{formatMinor(liveBal.realBalance + liveBal.bonusBalance, live.currency)}</Text>
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ color: color.ink2 }}>{t("payments.withdrawable")}</Text>
        <Text style={{ color: color.ink, fontWeight: "700" }}>{formatMinor(liveBal.realBalance, live.currency)}</Text>
      </View>
      {liveBal.bonusBalance > 0 ? (
        <Text style={{ color: color.ink2, fontSize: 12 }}>{t("payments.lockedBonus", { amount: formatMinor(liveBal.bonusBalance, live.currency) })}</Text>
      ) : null}
      {tierIndex < wallet.bonusTiers.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: color.brand, fontSize: 12, fontWeight: "700" }}>{t("payments.nextBonus", { pct: wallet.nextBonusPercent })}</Text>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {wallet.bonusTiers.map((_, i) => (
              <View key={i} style={{ flex: 1, height: 4, borderRadius: 2, backgroundColor: i < tierIndex ? color.brand : color.tile }} />
            ))}
          </View>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: space(2) }}>
        <View style={{ flex: 1 }}><Button label={t("payments.deposit")} kind="up" onPress={() => router.push("/payments/deposit")} /></View>
        <View style={{ flex: 1 }}><Button label={t("payments.withdraw")} kind="secondary" onPress={() => router.push("/payments/withdraw")} /></View>
      </View>
    </Card>
  );
}
```

`app/(tabs)/payments/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
export default function PaymentsLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
```

`app/(tabs)/payments/index.tsx`:

```tsx
import { router } from "expo-router";
import { RefreshControl, ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { formatMinor, paymentTitle, statusLabel } from "@asm/client-core";
import { usePaymentsInfinite, useWallet } from "@/api/queries";
import { BalanceCard } from "@/payments/BalanceCard";
import { ErrorState } from "@/ui/ErrorState";
import { ListRow } from "@/ui/ListRow";
import { Card, Screen, Skeleton, Txt } from "@/theme/ui";
import { space } from "@/theme/tokens";

export default function Payments() {
  const { t } = useTranslation();
  const wallet = useWallet();
  const payments = usePaymentsInfinite();
  const recent = payments.data?.pages[0]?.rows.slice(0, 5) ?? [];
  const refreshing = wallet.isRefetching || payments.isRefetching;
  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: space(4), gap: space(4) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void wallet.refetch(); void payments.refetch(); }} />}
      >
        <Txt variant="title">{t("tabs.payments")}</Txt>
        {wallet.data ? <BalanceCard wallet={wallet.data} /> : wallet.isError ? <ErrorState message={wallet.error.message} onRetry={() => void wallet.refetch()} /> : <Skeleton height={200} />}
        <Card>
          <Txt variant="title">{t("payments.recent")}</Txt>
          {recent.map((r) => (
            <ListRow
              key={r.key}
              title={paymentTitle(r)}
              subtitle={`${r.methodLabel} · ${statusLabel(r.status)}`}
              right={<Txt>{formatMinor(r.amountMinor, r.currency)}</Txt>}
              onPress={() => router.push({ pathname: "/history", params: { tx: r.key } })}
            />
          ))}
          <ListRow title={t("payments.seeAll")} onPress={() => router.push({ pathname: "/history", params: { filter: "deposits" } })} />
        </Card>
      </ScrollView>
    </Screen>
  );
}
```

Add i18n keys `payments.{balance, withdrawable, lockedBonus, nextBonus, deposit, withdraw, recent, seeAll}` in both languages (Hindi: "बैलेंस", "निकासी योग्य", "{{amount}} बोनस — निकाला नहीं जा सकता", "अगली जमा पर +{{pct}}% बोनस", "जमा करें", "निकालें", "हाल के भुगतान", "सब देखें"). `paymentTitle`/`statusLabel` return English; wrap them with i18n keys `history.title.<kind>` and `history.status.<STATUS>` (add every `DepositStatus`/`WithdrawalStatus` value in both files) and use `t(...)` instead of the English helpers in the app.

- [ ] **Step 4: Trade screen uses wallet tiers**

In `app/(tabs)/trade.tsx`, replace the inline `[100, 100, 50, 50]` with `useWallet().data?.bonusTiers` and `nextBonusPercent` (fall back to hiding the chip while loading).

- [ ] **Step 5: Test, typecheck, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck` → PASS.

```bash
git add apps/mobile packages/contracts
git commit -m "feat(mobile): payments tab, balance card and shared form UI"
```

---

### Task 2: Deposit — amount and method steps

**Files:**
- Create: `apps/mobile/src/payments/deposit-form.ts`, `deposit-form.test.ts`, `AmountStep.tsx`, `MethodStep.tsx`
- Create: `apps/mobile/app/(tabs)/payments/deposit.tsx`

**Interfaces:**
- Consumes: `methodAmountProblem`, `formatInr`, `inrToUsdt` (`@asm/client-core` deposit-limits), `bonusPercentForDeposit`; `CreateDepositSchema`, `DEPOSIT_METHODS`, `UPI_METHODS`.
- Produces:
  - `methodRows(config: DepositConfig, amountRupees: number): { method: DepositMethod; state: "ok" | "soon" | "limit"; reason: string | null }[]` (pure)
  - `depositBody(method, amountRupees, network?: UsdtNetwork): CreateDepositInput` (pure; UPI → `amountInr` in paise; USDT → `amountUsdtMinor` via `inrToUsdt`)
  - Screen state machine `"amount" → "method" → navigate("/payments/pay/<token>")`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { depositBody, methodRows } from "./deposit-form";

const config = { upiEnabled: true, usdtNetworks: ["tron"], gatewayNetworks: [], completedDeposits: 0, bonusTiers: [100, 100, 50, 50] } as never;

describe("methodRows", () => {
  it("offers every UPI method and USDT when enabled", () => {
    expect(methodRows(config, 1000).map((r) => r.method)).toEqual(["PhonePe", "Gpay", "PayTM", "UPI", "USDT"]);
  });
  it("marks UPI methods coming soon while UPI deposits are off", () => {
    const rows = methodRows({ ...(config as object), upiEnabled: false } as never, 1000);
    expect(rows.filter((r) => r.state === "soon").map((r) => r.method)).toEqual(["PhonePe", "Gpay", "PayTM", "UPI"]);
  });
  it("hides USDT when no network is configured", () => {
    expect(methodRows({ ...(config as object), usdtNetworks: [] } as never, 1000).some((r) => r.method === "USDT")).toBe(false);
  });
});

describe("depositBody", () => {
  it("sends UPI amounts in paise", () => {
    expect(depositBody("PhonePe", 1000)).toEqual({ method: "PhonePe", amountInr: 100_000 });
  });
  it("sends USDT amounts in USDT cents with the network", () => {
    const body = depositBody("USDT", 1000, "tron");
    expect(body).toMatchObject({ method: "USDT", network: "tron" });
    expect((body as { amountUsdtMinor: number }).amountUsdtMinor).toBeGreaterThan(0);
  });
});
```

Before implementing, read `apps/web/src/components/deposit/limits.ts` (now in `@asm/client-core`) to learn `methodAmountProblem`'s signature and units, and `apps/web/src/components/deposit/DepositFlow.tsx` to copy how the web builds the `POST /api/deposits` body (units for `amountInr` and `amountUsdtMinor`, network choice). The test above assumes paise and `inrToUsdt` — align it with what the web actually sends.

- [ ] **Step 2: Implement `deposit-form.ts`**

```ts
import { inrToUsdt, methodAmountProblem } from "@asm/client-core";
import {
  CreateDepositSchema,
  DEPOSIT_METHODS,
  UPI_METHODS,
  type CreateDepositInput,
  type DepositConfig,
  type UsdtNetwork,
} from "@asm/contracts";

export type DepositMethod = (typeof DEPOSIT_METHODS)[number];
const UPI = new Set<string>(UPI_METHODS);

export function methodRows(config: DepositConfig, amountRupees: number) {
  return DEPOSIT_METHODS.filter((m) => m !== "USDT" || config.usdtNetworks.length > 0).map((method) => {
    if (UPI.has(method) && !config.upiEnabled) return { method, state: "soon" as const, reason: null };
    const problem = methodAmountProblem(method, amountRupees);
    return problem ? { method, state: "limit" as const, reason: problem } : { method, state: "ok" as const, reason: null };
  });
}

export function depositBody(method: DepositMethod, amountRupees: number, network?: UsdtNetwork): CreateDepositInput {
  const body =
    method === "USDT"
      ? { method, network: network!, amountUsdtMinor: inrToUsdt(amountRupees) }
      : { method, amountInr: Math.round(amountRupees * 100) };
  return CreateDepositSchema.parse(body);
}
```

Run → PASS (after aligning with the web's real units per Step 1).

- [ ] **Step 3: Steps UI**

`AmountStep.tsx` — big amount display (`formatInr`), `Keypad decimals={0}`, quick chips (₹500, ₹1,000, ₹2,000, ₹5,000), bonus preview line `t("deposit.bonusPreview", { pct, amount })` using `bonusPercentForDeposit(config.completedDeposits + 1)`, Continue disabled while amount is 0.

`MethodStep.tsx` — `ListRow` per `methodRows(...)`: method name, `GatewayIcon`-equivalent image (copy the gateway PNGs used by `apps/web/src/components/deposit/GatewayIcon.tsx` into `apps/mobile/assets/gateways/`), right text "Coming soon" / reason; disabled unless `state === "ok"`. For USDT, a second choice of network when `usdtNetworks.length > 1` (labels from `USDT_NETWORK_INFO`).

`app/(tabs)/payments/deposit.tsx`:

```tsx
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { UsdtNetwork } from "@asm/contracts";
import { api } from "@/api/client";
import { ApiError } from "@/api/errors";
import { useDepositConfig } from "@/api/queries";
import { AmountStep } from "@/payments/AmountStep";
import { depositBody, type DepositMethod } from "@/payments/deposit-form";
import { MethodStep } from "@/payments/MethodStep";
import { ErrorState } from "@/ui/ErrorState";
import { StepHeader } from "@/ui/StepHeader";
import { toast } from "@/ui/Toast";
import { Screen, Skeleton } from "@/theme/ui";
import { space } from "@/theme/tokens";

const Created = z.object({ checkoutToken: z.string() });

export default function Deposit() {
  const { t } = useTranslation();
  const config = useDepositConfig();
  const [step, setStep] = useState<"amount" | "method">("amount");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(method: DepositMethod, network?: UsdtNetwork) {
    setBusy(true);
    try {
      const out = await api("/api/deposits", { method: "POST", body: depositBody(method, Number(amount), network), schema: Created });
      router.replace(`/payments/pay/${out.checkoutToken}`);
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't start the deposit.", "down");
    } finally {
      setBusy(false);
    }
  }

  if (config.isError) return <Screen><ErrorState message={config.error.message} onRetry={() => void config.refetch()} /></Screen>;
  if (!config.data) return <Screen style={{ padding: space(4) }}><Skeleton height={300} /></Screen>;

  return (
    <Screen style={{ padding: space(4), gap: space(3) }}>
      <StepHeader step={step === "amount" ? 1 : 2} of={3} title={t("deposit.title")} onBack={() => (step === "method" ? setStep("amount") : router.back())} />
      {step === "amount" ? (
        <AmountStep value={amount} onChange={setAmount} config={config.data} onNext={() => setStep("method")} />
      ) : (
        <MethodStep config={config.data} amountRupees={Number(amount)} busy={busy} onPick={create} />
      )}
    </Screen>
  );
}
```

Add i18n keys `deposit.{title, bonusPreview, continue, comingSoon, network}` in both files.

- [ ] **Step 4: Test, typecheck, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual: ₹1,000 → PhonePe → lands on `/payments/pay/<token>` (blank until Task 3).

```bash
git add apps/mobile
git commit -m "feat(mobile): deposit amount and method steps"
```

---

### Task 3: UPI pay screen with app hand-off, polling and claims

**Files:**
- Create: `apps/mobile/src/payments/upi-apps.ts`, `upi-apps.test.ts`, `useCheckoutPoll.ts`, `UpiPay.tsx`, `ClaimForm.tsx`, `PayResult.tsx`
- Create: `apps/mobile/app/(tabs)/payments/pay/[token].tsx`, `apps/mobile/app/(tabs)/payments/claim/[id].tsx`
- Modify: `apps/mobile/app.config.ts` (Android `<queries>` via a config plugin)
- Create: `apps/mobile/plugins/with-upi-queries.js`

**Interfaces:**
- Produces:
  - `type UpiApp = "phonepe" | "gpay" | "paytm" | "any"`
  - `upiAppUrl(app: UpiApp, upiUri: string): string` (pure)
  - `orderUpiApps(installed: UpiApp[], preferred: string): UpiApp[]` (pure; preferred method's app first, `any` last)
  - `useCheckoutPoll(depositId: string | undefined, active: boolean): { status: string | null }`

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { orderUpiApps, upiAppUrl } from "./upi-apps";

const uri = "upi://pay?pa=collect%40ybl&pn=IndianxTrade&am=1000.00&cu=INR&tn=IXT-12345678";

describe("upiAppUrl", () => {
  it("keeps the server's query unchanged for each app scheme", () => {
    const q = uri.split("?")[1];
    expect(upiAppUrl("phonepe", uri)).toBe(`phonepe://pay?${q}`);
    expect(upiAppUrl("gpay", uri)).toBe(`tez://upi/pay?${q}`);
    expect(upiAppUrl("paytm", uri)).toBe(`paytmmp://pay?${q}`);
    expect(upiAppUrl("any", uri)).toBe(uri);
  });
});

describe("orderUpiApps", () => {
  it("puts the app the user picked first and the generic chooser last", () => {
    expect(orderUpiApps(["paytm", "phonepe", "gpay"], "Gpay")).toEqual(["gpay", "paytm", "phonepe", "any"]);
  });
  it("still offers the generic chooser when no known app is installed", () => {
    expect(orderUpiApps([], "UPI")).toEqual(["any"]);
  });
});
```

- [ ] **Step 2: Implement `upi-apps.ts`**

```ts
export type UpiApp = "phonepe" | "gpay" | "paytm" | "any";

const PREFIX: Record<Exclude<UpiApp, "any">, string> = {
  phonepe: "phonepe://pay?",
  gpay: "tez://upi/pay?",
  paytm: "paytmmp://pay?",
};

const FOR_METHOD: Record<string, UpiApp> = { PhonePe: "phonepe", Gpay: "gpay", PayTM: "paytm" };

export function upiAppUrl(app: UpiApp, upiUri: string): string {
  if (app === "any") return upiUri;
  const query = upiUri.slice(upiUri.indexOf("?") + 1);
  return `${PREFIX[app]}${query}`;
}

export function orderUpiApps(installed: UpiApp[], preferredMethod: string): UpiApp[] {
  const pref = FOR_METHOD[preferredMethod];
  const known = installed.filter((a) => a !== "any");
  const sorted = pref && known.includes(pref) ? [pref, ...known.filter((a) => a !== pref)] : known;
  return [...sorted, "any"];
}

export const PROBE: Record<Exclude<UpiApp, "any">, string> = {
  phonepe: "phonepe://pay",
  gpay: "tez://upi/pay",
  paytm: "paytmmp://pay",
};
```

Run → PASS.

- [ ] **Step 3: Android package visibility**

`apps/mobile/plugins/with-upi-queries.js`:

```js
const { withAndroidManifest } = require("expo/config-plugins");

/** Android 11+ hides other apps unless declared; we only need to know if a UPI app can open these schemes. */
module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    const schemes = ["upi", "phonepe", "tez", "paytmmp"];
    manifest.queries = manifest.queries ?? [];
    manifest.queries.push({
      intent: schemes.map((scheme) => ({
        action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
        data: [{ $: { "android:scheme": scheme } }],
      })),
    });
    return cfg;
  });
};
```

Add `"./plugins/with-upi-queries"` to `plugins` in `app.config.ts`. Run `pnpm prebuild` and confirm `android/app/src/main/AndroidManifest.xml` contains the four `<data android:scheme=…/>` entries.

- [ ] **Step 4: Polling hook**

```ts
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { z } from "zod";
import { api } from "@/api/client";
import { invalidateMoney } from "@/api/queries";

const Status = z.object({ status: z.string() });
const FINAL = new Set(["COMPLETED", "REJECTED", "EXPIRED"]);

export function useCheckoutPoll(depositId: string | undefined, initial: string | null) {
  const [status, setStatus] = useState<string | null>(initial);
  useEffect(() => {
    if (!depositId || (status && FINAL.has(status))) return;
    let stopped = false;
    const poll = async () => {
      try {
        const out = await api(`/api/deposits/${depositId}/status`, { schema: Status });
        if (!stopped) setStatus(out.status);
        if (FINAL.has(out.status)) invalidateMoney();
      } catch {
        /* next tick retries */
      }
    };
    const id = setInterval(poll, 4000);
    const sub = AppState.addEventListener("change", (s) => s === "active" && void poll());
    return () => {
      stopped = true;
      clearInterval(id);
      sub.remove();
    };
  }, [depositId, status]);
  return { status };
}
```

Check `GET /api/deposits/[id]/status`'s response body (`apps/web/src/app/api/deposits/[id]/status/route.ts`, the final `NextResponse.json(...)`) and match `Status` to it.

- [ ] **Step 5: UPI pay UI**

`UpiPay.tsx`:

```tsx
import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import { useTranslation } from "react-i18next";
import { formatMinor } from "@asm/client-core";
import type { CheckoutView } from "@asm/contracts";
import { Button, Card } from "@/theme/ui";
import { color, space } from "@/theme/tokens";
import { useNow } from "@/trade/useNow";
import { orderUpiApps, PROBE, upiAppUrl, type UpiApp } from "./upi-apps";

const LABEL: Record<UpiApp, string> = { phonepe: "PhonePe", gpay: "Google Pay", paytm: "Paytm", any: "UPI" };

export function UpiPay({ view }: { view: CheckoutView }) {
  const { t } = useTranslation();
  const now = useNow();
  const [apps, setApps] = useState<UpiApp[]>(["any"]);
  useEffect(() => {
    void (async () => {
      const installed: UpiApp[] = [];
      for (const [app, url] of Object.entries(PROBE) as [Exclude<UpiApp, "any">, string][]) {
        if (await Linking.canOpenURL(url).catch(() => false)) installed.push(app);
      }
      setApps(orderUpiApps(installed, view.method));
    })();
  }, [view.method]);

  const left = Math.max(0, Math.floor((Date.parse(view.expiresAt) - now) / 1000));
  const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <View style={{ gap: space(4) }}>
      <Card style={{ alignItems: "center", gap: space(2) }}>
        <Text style={{ color: color.ink2 }}>{t("pay.amount")}</Text>
        <Text style={{ color: color.ink, fontSize: 32, fontWeight: "800" }}>{formatMinor(view.amountInr, "INR")}</Text>
        <Text style={{ color: left < 60 ? color.down : color.ink2 }}>{t("pay.expiresIn", { time: mm })}</Text>
      </Card>
      {apps.map((app) => (
        <Button key={app} label={t("pay.payWith", { app: LABEL[app] })} kind={app === apps[0] ? "up" : "secondary"} onPress={() => void Linking.openURL(upiAppUrl(app, view.upiUri!))} />
      ))}
      <Card style={{ alignItems: "center", gap: space(3) }}>
        <Text style={{ color: color.ink2 }}>{t("pay.orScan")}</Text>
        <View style={{ backgroundColor: "#fff", padding: 12, borderRadius: 12 }}>
          <QRCode value={view.upiUri!} size={180} />
        </View>
        <Pressable onPress={() => void Clipboard.setStringAsync(view.vpa ?? "")} hitSlop={8}>
          <Text style={{ color: color.brand, fontWeight: "700" }}>{view.vpa} · {t("pay.copy")}</Text>
        </Pressable>
      </Card>
      <Button label={t("pay.iPaid")} kind="secondary" onPress={() => router.push(`/payments/claim/${view.id}`)} />
    </View>
  );
}
```

`PayResult.tsx` — final-status screen: COMPLETED → success text with credited amount (re-fetch wallet), haptic `Success`, "Start trading" (→ `/trade`) and "Done" (→ `/payments`); REJECTED/EXPIRED → the same copy the web deposit page shows for expired windows (copy the two paragraphs from `apps/web/src/app/(platform)/deposit/page.tsx` into i18n keys `pay.expiredUpi`, `pay.expiredUsdt`) with "Already paid? Submit your transaction" → claim screen, and "New deposit".

`app/(tabs)/payments/pay/[token].tsx`:

```tsx
import { useLocalSearchParams } from "expo-router";
import { ScrollView } from "react-native";
import { useTranslation } from "react-i18next";
import { useCheckout } from "@/api/queries";
import { PayResult } from "@/payments/PayResult";
import { UpiPay } from "@/payments/UpiPay";
import { UsdtPay } from "@/payments/UsdtPay";
import { useCheckoutPoll } from "@/payments/useCheckoutPoll";
import { ErrorState } from "@/ui/ErrorState";
import { StepHeader } from "@/ui/StepHeader";
import { Screen, Skeleton } from "@/theme/ui";
import { space } from "@/theme/tokens";

export default function Pay() {
  const { t } = useTranslation();
  const { token } = useLocalSearchParams<{ token: string }>();
  const checkout = useCheckout(token);
  const { status } = useCheckoutPoll(checkout.data?.id, checkout.data?.status ?? null);
  const view = checkout.data ? { ...checkout.data, status: (status ?? checkout.data.status) as typeof checkout.data.status } : null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: space(4), gap: space(3) }}>
        <StepHeader step={3} of={3} title={t("pay.title")} />
        {checkout.isError ? <ErrorState message={checkout.error.message} onRetry={() => void checkout.refetch()} /> : null}
        {!view ? <Skeleton height={320} /> : null}
        {view && ["COMPLETED", "REJECTED", "EXPIRED"].includes(view.status) ? <PayResult view={view} /> : null}
        {view && !["COMPLETED", "REJECTED", "EXPIRED"].includes(view.status) ? (view.method === "USDT" ? <UsdtPay view={view} /> : <UpiPay view={view} />) : null}
      </ScrollView>
    </Screen>
  );
}
```

(`UsdtPay` comes in Task 4; until then import a stub that renders `null`.)

- [ ] **Step 6: Claim screen**

`ClaimForm.tsx` + `app/(tabs)/payments/claim/[id].tsx`: a UTR field validated with `ClaimUtrSchema` (show its message on failure) and an optional "Add screenshot" button. Screenshot: `ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 })` → `compressForUpload(uri)` (Task 7's `src/kyc/compress.ts` runner — build Task 7 Step 1–3 first or inline a single `manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.7, format: JPEG })` and replace it when Task 7 lands) → multipart `POST /api/deposits/:id/screenshot` with field `file` → `{ url }` → include as `screenshotUrl` in `POST /api/deposits/:id/claim` body `{ utr, screenshotUrl? }`. On success, `invalidateMoney()` and go back to the pay screen (which shows the pending state). Server messages (e.g. claim too early — `manualClaimDelaySec`) are shown verbatim; disable "Submit" until `manualClaimDelaySec` seconds after the deposit was created (from `CheckoutView`).

i18n keys: `pay.{title, amount, expiresIn, payWith, orScan, copy, iPaid, expiredUpi, expiredUsdt, alreadyPaid, newDeposit, success, startTrading}` and `claim.{title, utr, utrHelp, screenshot, submit, sent}` in both languages.

- [ ] **Step 7: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual on an emulator with no UPI apps: only "Pay with UPI" shows; QR renders; copy works; status flips to the result screen after an admin marks the deposit completed in the web admin.

```bash
git add apps/mobile
git commit -m "feat(mobile): UPI pay screen with app hand-off, polling and claims"
```

---

### Task 4: USDT pay screen

**Files:**
- Create: `apps/mobile/src/payments/UsdtPay.tsx`, `apps/mobile/src/payments/usdt-display.ts`, `usdt-display.test.ts`

**Interfaces:**
- Consumes: `USDT_NETWORK_INFO`, `ClaimUsdtPaymentSchema`.
- Produces: `usdtAmountText(amountUsdtMinor: number | null): string` (pure; `"12.34"`), `networkLabel(network: string | null): string`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { usdtAmountText } from "./usdt-display";

describe("usdtAmountText", () => {
  it("formats USDT cents with two decimals", () => {
    expect(usdtAmountText(1234)).toBe("12.34");
    expect(usdtAmountText(null)).toBe("0.00");
  });
});
```

- [ ] **Step 2: Implement**

```ts
import { USDT_NETWORK_INFO, isUsdtNetwork } from "@asm/contracts";

export const usdtAmountText = (minor: number | null) => ((minor ?? 0) / 100).toFixed(2);

export function networkLabel(network: string | null): string {
  return network && isUsdtNetwork(network) ? USDT_NETWORK_INFO[network].label : "USDT";
}
```

Check `USDT_NETWORK_INFO`'s field name for the display label (`label`/`name`) in `packages/contracts/src/deposit.ts`.

`UsdtPay.tsx`: amount `usdtAmountText(view.amountUsdtMinor)` + "USDT" + `networkLabel(view.network)` (with a warning "Send only on this network"), countdown, QR of `receivingAddress`, copy-address and copy-amount buttons (`expo-clipboard`). If `view.isGateway`: text "We'll detect your payment automatically" (status polling only). Else: tx-hash field validated by `ClaimUsdtPaymentSchema` → `POST /api/deposits/:id/usdt-claim` `{ txHash }`, then show pending. If `view.isSlot`: emphasise the exact amount ("Send exactly …") as the web checkout does.

- [ ] **Step 3: Test, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck` → PASS.

```bash
git add apps/mobile/src/payments
git commit -m "feat(mobile): USDT pay screen"
```

---

### Task 5: Withdraw flow

**Files:**
- Create: `apps/mobile/src/payments/withdraw-form.ts`, `withdraw-form.test.ts`
- Create: `apps/mobile/app/(tabs)/payments/withdraw.tsx`

**Interfaces:**
- Consumes: `withdrawalLimitsMinor`, `PayoutDetailsSchema`, `CreateWithdrawalSchema`, `PAYOUT_METHODS`, `PAYOUT_METHOD_LABEL`, `isValidUsdtAddress`, `payoutDestinationLabel` (`@asm/contracts`).
- Produces:
  - `amountProblem(amountMinor: number, currency: string, withdrawable: number): "min" | "max" | "balance" | null` (pure)
  - `withdrawBody(accountId, amountMinor, payout): CreateWithdrawalInput` (pure, validated)

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";
import { amountProblem, withdrawBody } from "./withdraw-form";

describe("amountProblem", () => {
  it("enforces ₹700 minimum and ₹50,000 maximum on INR", () => {
    expect(amountProblem(69_900, "INR", 10_000_000)).toBe("min");
    expect(amountProblem(5_000_100, "INR", 10_000_000)).toBe("max");
    expect(amountProblem(70_000, "INR", 10_000_000)).toBeNull();
  });
  it("cannot exceed the withdrawable balance", () => {
    expect(amountProblem(100_000, "INR", 90_000)).toBe("balance");
  });
});

describe("withdrawBody", () => {
  it("builds a valid UPI withdrawal", () => {
    const body = withdrawBody("7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11", 70_000, { method: "UPI", upiId: "asha@okaxis" });
    expect(body).toEqual({ accountId: "7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11", amount: 70_000, payout: { method: "UPI", upiId: "asha@okaxis" } });
  });
  it("throws on an invalid IFSC so the form can show the message", () => {
    expect(() =>
      withdrawBody("7d3c9a1e-3b55-4e8a-9a0b-6f4e2a1d0c11", 70_000, { method: "BANK", accountHolder: "Asha", accountNumber: "123456789", ifsc: "bad" }),
    ).toThrow();
  });
});
```

Confirm the payout field names (`accountHolder`, `accountNumber`, `ifsc`, `upiId`, `usdtNetwork`, `usdtAddress`) against `BankPayoutSchema`/`UpiPayoutSchema`/`UsdtPayoutSchema` in `packages/contracts/src/withdrawal.ts`.

- [ ] **Step 2: Implement**

```ts
import { CreateWithdrawalSchema, withdrawalLimitsMinor, type CreateWithdrawalInput, type PayoutDetails } from "@asm/contracts";

export function amountProblem(amountMinor: number, currency: string, withdrawable: number): "min" | "max" | "balance" | null {
  const { min, max } = withdrawalLimitsMinor(currency);
  if (amountMinor < min) return "min";
  if (amountMinor > max) return "max";
  if (amountMinor > withdrawable) return "balance";
  return null;
}

export function withdrawBody(accountId: string, amountMinor: number, payout: PayoutDetails): CreateWithdrawalInput {
  return CreateWithdrawalSchema.parse({ accountId, amount: amountMinor, payout });
}
```

Run → PASS.

- [ ] **Step 3: Screen**

`app/(tabs)/payments/withdraw.tsx` — three steps with `StepHeader`:

1. **Gate + amount.** If `prefill.kycStatus !== "VERIFIED"`: a `Card` "Verify your identity to withdraw" + `Button` → `/account/verify` (PENDING shows "Your documents are under review" instead). Else: available-to-withdraw (`wallet.withdrawable`), `Keypad decimals={0}` (INR) / `2` (USD), error text from `amountProblem` (keys `withdraw.min`, `withdraw.max`, `withdraw.balance` with amounts from `withdrawalLimitsMinor`).
2. **Payout.** Segmented `PAYOUT_METHODS` (labels `PAYOUT_METHOD_LABEL`), starting on `prefill.initialMethod`. Fields per method prefilled from `prefill.lastPayouts`. Bank holder defaults to `prefill.kycName`. Validate with `PayoutDetailsSchema.safeParse` and show the first issue message under the field.
3. **Confirm.** `SummaryCard` rows: amount, method, destination (`payoutDestinationLabel(payout)`), "Usually paid within 24 hours" (same copy as web). `Button` → `api("/api/withdrawals", { method: "POST", body: withdrawBody(...) })` → success screen, `invalidateMoney()`, `queryClient.invalidateQueries({ queryKey: ["withdrawal-prefill"] })`.

Held withdrawals: above step 1, one banner per `prefill.heldWithdrawals` item with amount, "Cancel" → `POST /api/withdrawals/:id/cancel` (confirm with an `Alert.alert` first) → invalidate.

i18n keys `withdraw.{title, available, verifyTitle, verifyBody, pendingBody, verifyCta, min, max, balance, method, holder, account, ifsc, upi, network, address, confirm, eta, submit, done, held, cancel, cancelConfirm}` in both languages.

- [ ] **Step 4: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual: non-KYC user → gate card; KYC-verified seeded user → ₹700 UPI withdrawal created and visible in the web admin queue.

```bash
git add apps/mobile
git commit -m "feat(mobile): withdrawal flow with KYC gate and prefill"
```

---

### Task 6: History tab and detail sheet

**Files:**
- Create: `apps/mobile/src/history/merge.ts`, `merge.test.ts`, `HistoryList.tsx`, `DetailSheet.tsx`, `Timeline.tsx`
- Modify: `apps/mobile/app/(tabs)/history.tsx`

**Interfaces:**
- Consumes: `paymentItem`, `groupByDay`, `itemMatchesFilter`, `parseFilter`, `timelineSteps`, `latestReachedIndex`, `tradeAmount`, `tradePairName` (`@asm/client-core`).
- Produces: `historyItems(input: { trades: TradeView[]; payments: PaymentRow[]; currencyFor: (accountId: string) => string; displayName: (symbol: string) => string | undefined }): HistoryItem[]` (pure, newest first); `<DetailSheet ref txKey />`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import { historyItems } from "./merge";

const trade = { id: "t1", accountId: "a", symbol: "EURUSD", direction: "UP", stake: 10_000, payoutPct: 80, entryPrice: 1, entryTs: 2_000, expiryTs: 2_030, exitPrice: 1.1, status: "WON", pnl: 8_000 } as never;
const pay = { key: "d:1", id: "1", kind: "deposit", createdAt: new Date(3_000_000).toISOString(), updatedAt: null, status: "COMPLETED", methodLabel: "UPI", amountMinor: 100_000, currency: "INR", destination: null, expiresAt: null, holdUntil: null, cancelableUntil: null } as never;

describe("historyItems", () => {
  it("merges closed trades and payments newest first", () => {
    const items = historyItems({ trades: [trade], payments: [pay], currencyFor: () => "INR", displayName: () => "EUR/USD" });
    expect(items.map((i) => i.key)).toEqual(["d:1", "t:t1"]);
  });
  it("leaves open trades out of history", () => {
    const open = { ...(trade as object), id: "t2", status: "OPEN" } as never;
    expect(historyItems({ trades: [open], payments: [], currencyFor: () => "INR", displayName: () => undefined })).toEqual([]);
  });
});
```

Check the web's `HistoryList.tsx` for how it builds trade items (`key` prefix, `atMs` = `expiryTs * 1000` or `entryTs`) and mirror it exactly so keys match deep links.

- [ ] **Step 2: Implement `merge.ts`**

```ts
import { paymentItem, tradePairName, type HistoryItem, type PaymentRow } from "@asm/client-core";
import type { TradeView } from "@asm/contracts";

export function historyItems(input: {
  trades: TradeView[];
  payments: PaymentRow[];
  currencyFor: (accountId: string) => string;
  displayName: (symbol: string) => string | undefined;
}): HistoryItem[] {
  const tradeItems: HistoryItem[] = input.trades
    .filter((t) => t.status !== "OPEN")
    .map((t) => ({
      kind: "trade",
      key: `t:${t.id}`,
      atMs: t.expiryTs * 1000,
      trade: t,
      currency: input.currencyFor(t.accountId),
      pair: tradePairName(t, input.displayName(t.symbol)),
    }));
  return [...tradeItems, ...input.payments.map(paymentItem)].sort((a, b) => b.atMs - a.atMs);
}
```

Run → PASS.

- [ ] **Step 3: UI**

`HistoryList.tsx` — `FlashList` (`pnpm exec expo install @shopify/flash-list`) over `groupByDay(items, now)` flattened into header + row entries; filter chips (`all`, `trades`, `deposits`, `withdrawals`, labels from i18n `history.filter.<f>`) applying `itemMatchesFilter`; `RefreshControl` refetching payments and `GET /api/trades?accountId=<active>` (merge results into the socket store via `withFetchedTrades` from `@asm/client-core`); `onEndReached` → `payments.fetchNextPage()` when `hasNextPage`; skeleton rows while the first page loads; `EmptyState` with `history.empty.<filter>` copy (from `EMPTY_COPY`, translated).

Row content: trade → pair, direction, amount via `tradeAmount(trade, currency)` coloured by tone; payment → `t("history.title.<kind>")`, `methodLabel`, `t("history.status.<STATUS>")`, amount.

`Timeline.tsx` — vertical list of `timelineSteps(kind, status)` with dot states `done`/`current`/`todo`/`ended` and labels translated by step id.

`DetailSheet.tsx` — `Sheet` showing either the trade (entry/exit price, stake, payout, P&L, open/close times) or the payment (amount, method, destination, created/updated, reference `referenceFor(row)` with copy, `Timeline`; for deposits awaiting payment a "Continue payment" button → `/payments/pay/<checkoutToken>` is **not** available because `PaymentRow` has no token — show "Open Payments" instead; for held withdrawals a Cancel button as in Task 5).

`app/(tabs)/history.tsx`:

```tsx
import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import { HistoryList } from "@/history/HistoryList";
import { DetailSheet, type DetailSheetRef } from "@/history/DetailSheet";
import { Screen } from "@/theme/ui";

export default function History() {
  const { tx, filter } = useLocalSearchParams<{ tx?: string; filter?: string }>();
  const sheet = useRef<DetailSheetRef>(null);
  useEffect(() => {
    if (tx) sheet.current?.open(tx);
  }, [tx]);
  return (
    <Screen>
      <HistoryList initialFilter={filter} onOpen={(key) => sheet.current?.open(key)} />
      <DetailSheet ref={sheet} />
    </Screen>
  );
}
```

`DetailSheetRef.open(key)` looks the key up in the loaded payments/trades; if a payment key isn't loaded yet, it fetches pages until found or `nextCursor` is null (max 5 pages), then shows "Not found".

Deep link: expo-router maps `indianxtrade://history?tx=d:<id>` to this route automatically (scheme set in `app.config.ts`). Verify with `adb shell am start -W -a android.intent.action.VIEW -d "indianxtrade://history?tx=d:<id>" com.indianxtrade.app`.

- [ ] **Step 4: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual: filters, pull to refresh, infinite scroll with > 20 payments (seed them), deep link opens the right sheet.

```bash
git add apps/mobile
git commit -m "feat(mobile): history tab with filters, paging and detail timelines"
```

---

### Task 7: KYC with the native camera

**Files:**
- Create: `apps/mobile/src/kyc/compress.ts`, `compress.test.ts`, `kyc-flow.ts`, `kyc-flow.test.ts`, `upload.ts`, `CaptureScreen.tsx`
- Create: `apps/mobile/app/(tabs)/account/verify.tsx`

**Interfaces:**
- Produces:
  - `COMPRESS_STEPS = [0.85, 0.7, 0.55, 0.4]`, `MAX_BYTES = 900_000`, `MAX_SIDE = 1600`
  - `compressWith(run: (quality: number) => Promise<{ uri: string; bytes: number }>): Promise<{ uri: string; bytes: number }>` (pure orchestration; first result ≤ `MAX_BYTES`, else the last)
  - `compressForUpload(uri: string): Promise<{ uri: string; bytes: number }>` (uses `expo-image-manipulator` + `expo-file-system`)
  - `KYC_STEPS = ["details", "AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE", "review"] as const`; `nextKycStep(profile: { kycDocuments: string[]; detailsComplete: boolean }): KycStep` (pure)
  - `uploadKycDocument(kind, uri): Promise<void>` (multipart `kind`, `file` → `POST /api/account/kyc/documents`)

- [ ] **Step 1: Failing tests**

`compress.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { compressWith } from "./compress";

describe("compressWith", () => {
  it("stops at the first quality that fits under 900 KB", async () => {
    const tried: number[] = [];
    const out = await compressWith(async (q) => {
      tried.push(q);
      return { uri: `q${q}`, bytes: q > 0.6 ? 1_200_000 : 800_000 };
    });
    expect(tried).toEqual([0.85, 0.7, 0.55]);
    expect(out.uri).toBe("q0.55");
  });
  it("returns the smallest attempt when nothing fits, so the server can decide", async () => {
    const out = await compressWith(async (q) => ({ uri: `q${q}`, bytes: 2_000_000 }));
    expect(out.uri).toBe("q0.4");
  });
});
```

`kyc-flow.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { nextKycStep } from "./kyc-flow";

describe("nextKycStep", () => {
  it("starts with personal details", () => {
    expect(nextKycStep({ detailsComplete: false, kycDocuments: [] })).toBe("details");
  });
  it("asks for the first missing document in order", () => {
    expect(nextKycStep({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT", "PAN"] })).toBe("AADHAAR_BACK");
  });
  it("goes to review once everything is uploaded", () => {
    expect(nextKycStep({ detailsComplete: true, kycDocuments: ["AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE"] })).toBe("review");
  });
});
```

- [ ] **Step 2: Implement**

```ts
// compress.ts (pure part)
export const COMPRESS_STEPS = [0.85, 0.7, 0.55, 0.4];
export const MAX_BYTES = 900_000;
export const MAX_SIDE = 1600;

export async function compressWith(run: (quality: number) => Promise<{ uri: string; bytes: number }>) {
  let last: { uri: string; bytes: number } | null = null;
  for (const q of COMPRESS_STEPS) {
    last = await run(q);
    if (last.bytes <= MAX_BYTES) return last;
  }
  return last!;
}
```

```ts
// compress-native.ts (not unit-tested; imports native modules)
import { File } from "expo-file-system";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { compressWith, MAX_SIDE } from "./compress";

export function compressForUpload(uri: string, width: number, height: number) {
  const resize = width >= height ? { width: Math.min(width, MAX_SIDE) } : { height: Math.min(height, MAX_SIDE) };
  return compressWith(async (quality) => {
    const ctx = ImageManipulator.manipulate(uri).resize(resize);
    const img = await ctx.renderAsync();
    const out = await img.saveAsync({ compress: quality, format: SaveFormat.JPEG });
    return { uri: out.uri, bytes: new File(out.uri).size ?? 0 };
  });
}
```

Use the `expo-image-manipulator` / `expo-file-system` APIs exactly as documented for SDK 57 (check `node_modules/expo-image-manipulator/build/index.d.ts`); if the contextual API differs, use `manipulateAsync(uri, [{ resize }], { compress: quality, format: SaveFormat.JPEG })`.

```ts
// kyc-flow.ts
export const KYC_DOCS = ["AADHAAR_FRONT", "AADHAAR_BACK", "PAN", "SELFIE"] as const;
export type KycStep = "details" | (typeof KYC_DOCS)[number] | "review";

export function nextKycStep(p: { detailsComplete: boolean; kycDocuments: string[] }): KycStep {
  if (!p.detailsComplete) return "details";
  return KYC_DOCS.find((d) => !p.kycDocuments.includes(d)) ?? "review";
}
```

```ts
// upload.ts
import { api } from "@/api/client";
import type { KycStep } from "./kyc-flow";

export async function uploadKycDocument(kind: Exclude<KycStep, "details" | "review">, uri: string): Promise<void> {
  const form = new FormData();
  form.append("kind", kind);
  form.append("file", { uri, name: `${kind.toLowerCase()}.jpg`, type: "image/jpeg" } as unknown as Blob);
  await api("/api/account/kyc/documents", { method: "POST", form });
}
```

Run → PASS.

- [ ] **Step 3: Capture screen**

`CaptureScreen.tsx`:

```tsx
import { CameraView, useCameraPermissions } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useRef, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Button } from "@/theme/ui";
import { color, space } from "@/theme/tokens";

export function CaptureScreen({ kind, onPhoto }: { kind: "document" | "selfie"; onPhoto: (p: { uri: string; width: number; height: number }) => void }) {
  const { t } = useTranslation();
  const [perm, request] = useCameraPermissions();
  const cam = useRef<CameraView>(null);
  const [torch, setTorch] = useState(false);
  const [shot, setShot] = useState<{ uri: string; width: number; height: number } | null>(null);

  async function pickFromGallery() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const a = res.assets?.[0];
    if (a) setShot({ uri: a.uri, width: a.width, height: a.height });
  }

  if (!perm) return null;
  if (!perm.granted) {
    return (
      <View style={{ gap: space(3), padding: space(4) }}>
        <Text style={{ color: color.ink }}>{t("kyc.cameraNeeded")}</Text>
        {perm.canAskAgain ? <Button label={t("kyc.allowCamera")} onPress={() => void request()} /> : <Button label={t("kyc.openSettings")} onPress={() => void Linking.openSettings()} />}
        <Button label={t("kyc.useGallery")} kind="secondary" onPress={() => void pickFromGallery()} />
      </View>
    );
  }

  if (shot) {
    return (
      <View style={{ flex: 1, gap: space(3), padding: space(4) }}>
        <Image source={{ uri: shot.uri }} style={{ flex: 1, borderRadius: 12 }} resizeMode="contain" />
        <Button label={t("kyc.usePhoto")} onPress={() => onPhoto(shot)} />
        <Button label={t("kyc.retake")} kind="secondary" onPress={() => setShot(null)} />
      </View>
    );
  }

  const guide = kind === "selfie"
    ? { width: 220, height: 290, borderRadius: 145 }
    : { width: "86%" as const, aspectRatio: 1.586, borderRadius: 14 };

  return (
    <View style={{ flex: 1 }}>
      <CameraView ref={cam} style={{ flex: 1 }} facing={kind === "selfie" ? "front" : "back"} enableTorch={torch} autofocus="on" />
      <View pointerEvents="none" style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
        <View style={[{ borderWidth: 3, borderColor: "#ffffffcc" }, guide]} />
        <Text style={{ color: "#fff", marginTop: space(3) }}>{kind === "selfie" ? t("kyc.selfieHint") : t("kyc.cardHint")}</Text>
      </View>
      <View style={{ position: "absolute", bottom: space(8), left: 0, right: 0, flexDirection: "row", justifyContent: "space-around", alignItems: "center" }}>
        <Pressable onPress={() => void pickFromGallery()}><Text style={{ color: "#fff" }}>{t("kyc.gallery")}</Text></Pressable>
        <Pressable
          accessibilityLabel={t("kyc.capture")}
          onPress={async () => {
            const p = await cam.current?.takePictureAsync({ quality: 1, skipProcessing: false });
            if (p) setShot({ uri: p.uri, width: p.width, height: p.height });
          }}
          style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 4, borderColor: "#fff" }}
        />
        {kind === "document" ? <Pressable onPress={() => setTorch((v) => !v)}><Text style={{ color: "#fff" }}>{torch ? t("kyc.torchOff") : t("kyc.torchOn")}</Text></Pressable> : <View style={{ width: 48 }} />}
      </View>
    </View>
  );
}
```

Install: `pnpm exec expo install expo-camera expo-image-picker expo-image-manipulator expo-file-system expo-clipboard react-native-qrcode-svg`. Add the `expo-camera` config plugin with `cameraPermission: "IndianxTrade uses the camera to photograph your ID documents and take a verification selfie."` and the `expo-image-picker` plugin with `photosPermission` text.

- [ ] **Step 4: Verify screen**

`app/(tabs)/account/verify.tsx` — uses `useProfile()`:

- `kycStatus === "VERIFIED"` → done card ("Identity verified — withdrawals unlocked").
- `"PENDING"` → "Under review" card with `kycSubmittedAt`.
- `"REJECTED"` → shows `kycReviewNote` + "Start again" (the server clears the note and lets documents be replaced on resubmit).
- Otherwise the step machine from `nextKycStep`:
  - `details` → form for the KYC-required profile fields (copy the field list and order from `apps/web/src/app/(platform)/account/verify/page.tsx`; validate with `UpdateProfileSchema`) → `PATCH /api/account` → refetch profile.
  - document steps → `CaptureScreen kind="document"` (or `"selfie"` for `SELFIE`) → `compressForUpload` → `uploadKycDocument` with a progress/"Uploading…" state and Retry on failure → refetch profile (the server's `kycDocuments` list drives the next step).
  - `review` → thumbnails of the four captured images (local URIs held in state; after an app restart show ticks instead), `Button` "Submit for review" → `POST /api/account/kyc/submit` → PENDING card. A 409 shows the server message.

Define `detailsComplete` as "every field the web verify page requires is non-empty in `profile`".

i18n keys `kyc.{title, details, front, back, pan, selfie, review, submit, verified, pending, rejected, startAgain, uploading, cameraNeeded, allowCamera, openSettings, useGallery, usePhoto, retake, selfieHint, cardHint, gallery, capture, torchOn, torchOff}` in both languages.

- [ ] **Step 5: Test, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual on a real phone: capture all four, submit → PENDING; admin approves in the web console → VERIFIED after pull to refresh. Check uploaded image sizes in the admin KYC page are ≤ 900 KB.

```bash
git add apps/mobile
git commit -m "feat(mobile): KYC with native camera capture and compression"
```

---

### Task 8: Account hub and settings screens

**Files:**
- Move: `apps/mobile/app/(tabs)/account.tsx` → `apps/mobile/app/(tabs)/account/index.tsx`; create `account/_layout.tsx`
- Create: `apps/mobile/app/(tabs)/account/{profile,currency,demo,notifications,security,language,support,leaderboard}.tsx`

**Interfaces:**
- Consumes: `useProfile`, `useTickets`, `useLeaderboard`, `useAppConfig`, `useLock`, `useSession`, `setLocale` (P2 i18n), `CreateTicketSchema`, `FAQ`, `UpdateProfileSchema`, `TwoFaToggleSchema`.

- [ ] **Step 1: Hub**

`account/index.tsx`: header (nickname or email, KYC badge coloured by status) and a list of `ListRow`s: Profile, Verify identity (subtitle = status), Currency, Demo account, Notifications, Security, Language (subtitle = current), Support, Leaderboard, Legal & guides, Log out. "Legal & guides" opens `WebBrowser.openBrowserAsync(\`${appConfig().apiUrl}/legit\`)` (and a second row for `/guides`). Log out → `Alert.alert` confirm → `useSession.getState().signOut()` + `useLock.getState().reset()`.

- [ ] **Step 2: Screens**

- `profile.tsx` — form with `UpdateProfileSchema` fields (nickname editable always; identity fields read-only with a note when `kycStatus` is PENDING or VERIFIED — the server returns 409 `KycLocked` otherwise) → `PATCH /api/account` → toast + refetch.
- `currency.tsx` — radio list of supported currencies (read the `CURRENCIES` set in `apps/web/src/app/api/account/currency/route.ts`; mirror it in `@asm/contracts` as `ACCOUNT_CURRENCIES` and use it in both places) → `POST /api/account/currency` `{ accountId: <demo or live per web behaviour on /account/currency>, currency }`. Copy which account the web page changes from `apps/web/src/app/(platform)/account/currency/page.tsx`.
- `demo.tsx` — demo balance and "Reset demo balance" → `POST /api/account/demo-balance` `{ accountId: demoId }` (optionally `amountMinor` with the same choices the web page offers) → update socket balances from the response.
- `notifications.tsx` — placeholder text "Coming soon" until P4 Task 6 replaces it.
- `security.tsx` — app lock switch (on → `/lock-setup`; off → confirm with biometric/PIN via `/lock` first, then `useLock.disable()`), "Change PIN" (→ `/lock-setup` PIN branch), and the two-factor toggles (`TwoFaToggleSchema` → `PATCH /api/account/two-factor`) shown with the same labels as the web page.
- `language.tsx` — English / हिन्दी radio → `setLocale(l)` + `PATCH /api/v1/account/preferences { locale }` + invalidate `bootstrap`.
- `support.tsx` — WhatsApp/Telegram buttons when `useAppConfig().data.support.*` is set (`Linking.openURL`), FAQ accordion from `FAQ`, tickets list (`useTickets`), "New ticket" sheet with subject + body (`CreateTicketSchema`) → `POST /api/support` → refetch.
- `leaderboard.tsx` — `FlashList` of `useLeaderboard()` entries (rank, nickname, result), the caller's row highlighted if the response marks it.

i18n keys for every label in both languages (`account.*`, `support.*`, `leaderboard.*`, `security.*`, `language.*`, `profile.*`, `currency.*`, `demo.*`).

- [ ] **Step 3: Typecheck, manual check, commit**

Run: `pnpm --filter @asm/mobile test && pnpm --filter @asm/mobile typecheck`. Manual: every hub row opens; language switch flips the whole UI and survives restart; ticket creation shows in the web admin Messages page.

```bash
git add apps/mobile packages/contracts apps/web/src/app/api/account/currency/route.ts
git commit -m "feat(mobile): account hub, profile, currency, demo, security, language, support, leaderboard"
```

---

### Task 9: E2E flows and the real-UPI checklist

**Files:**
- Create: `apps/mobile/e2e/deposit.yaml`, `withdraw-kyc.yaml`, `history.yaml`
- Create: `docs/mobile-upi-checklist.md`

- [ ] **Step 1: Flows**

`deposit.yaml` (logged-in demo user with `upiEnabled` on locally — set `UPI_DEPOSITS_ENABLED=1` in the local web env):

```yaml
appId: com.indianxtrade.app
---
- launchApp
- tapOn: "Payments"
- tapOn: "Deposit"
- tapOn: { id: "key-1" }
- tapOn: { id: "key-0" }
- tapOn: { id: "key-0" }
- tapOn: { id: "key-0" }
- tapOn: "Continue"
- tapOn: "PhonePe"
- assertVisible: "Pay with UPI"
- assertVisible: "I've paid"
```

`withdraw-kyc.yaml`: user with `kycStatus NOT_STARTED` → Payments → Withdraw → `assertVisible: "Verify your identity to withdraw"` → tap CTA → `assertVisible: "Verify identity"`.

`history.yaml`: History → tap "Deposits" chip → `assertVisible` the first seeded deposit's amount → tap it → `assertVisible: "Reference"`.

Add `testID`s / texts as needed so these selectors are stable (prefer `id:` selectors over English text; the flows run in English).

- [ ] **Step 2: Real-UPI checklist**

`docs/mobile-upi-checklist.md`:

```markdown
# UPI app hand-off — manual release check

Run before every release that touches deposits. Use a real Android phone with
PhonePe, Google Pay and Paytm installed, the production API, and each VPA in
`UPI_COLLECTION_VPAS`.

| VPA | App | Opens with amount filled? | Payment allowed? | Credited? | Notes |
|---|---|---|---|---|---|
| | PhonePe | | | | |
| | Google Pay | | | | |
| | Paytm | | | | |
| | Any UPI (chooser) | | | | |

If an app shows "payment declined for security reasons" or caps the amount
(common for personal/P2P VPAs), record it. Release is allowed only if at least
the QR + copy path works for every VPA; consider hiding that app's button by
adding it to `UPI_APP_BLOCKLIST` (app config) if it fails for all VPAs.
```

Add `upiAppBlocklist: string[]` to `AppConfigSchema` + `appConfigFromEnv` (`UPI_APP_BLOCKLIST=gpay,paytm`), and filter `orderUpiApps` output by it in `UpiPay.tsx` — a server-side switch so a bad app can be hidden without a release. Include a test for the filter in `upi-apps.test.ts` (`orderUpiApps(["gpay","phonepe"], "Gpay", ["gpay"])` → `["phonepe","any"]`) by giving `orderUpiApps` an optional third `blocklist` parameter.

- [ ] **Step 3: Run, record, commit**

Run: `maestro test apps/mobile/e2e/` → all flows pass. Fill the checklist once on a real phone and attach it to the PR.

```bash
git add apps/mobile docs/mobile-upi-checklist.md packages/contracts apps/web/src/lib/app-config.ts
git commit -m "test(mobile): payments, KYC and history flows; UPI release checklist"
```

---

## Self-Review Notes

- Spec coverage: Payments tab (balance card, recent) → T1; deposit amount/method → T2; UPI pay (apps, QR, poll, return-poll, claim UTR/screenshot, expired) → T3; USDT pay → T4; result screens → T3; withdraw (gate, limits, payout prefill, confirm, held cancel) → T5; history (merge, filters, paging, refresh, skeleton, empty, detail, timeline, deep link) → T6; account hub + all items → T8; KYC (steps, camera, guides, torch, gallery fallback, compression, per-document upload, statuses, permission denied) → T7; shared UI → T1; testing → each task + T9.
- Spec said "2FA code step" for withdrawals; the server has none — spec corrected, no step built.
- Added (beyond spec, small): `UPI_APP_BLOCKLIST` server switch in T9 so a misbehaving UPI app can be hidden without shipping a build.
