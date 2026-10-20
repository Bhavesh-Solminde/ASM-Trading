import { QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  AppConfigSchema,
  BootstrapSchema,
  CheckoutViewSchema,
  DepositConfigSchema,
  PaymentsPageSchema,
  ProfileViewSchema,
  WalletSchema,
  WithdrawalPrefillSchema,
} from "@asm/contracts";
import { z } from "zod";
import { api } from "./client";
import { shouldRetry } from "./errors";
import { invalidateMoneyOn } from "./invalidate-money";
import { latestStamp } from "./request-stamp";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: shouldRetry, staleTime: 15_000, refetchOnWindowFocus: false } },
});

/** When (epoch ms) the most recent successful bootstrap request STARTED; see `mergeBootstrap` for why start, not finish. */
let lastBootstrapRequestedAt = 0;
export const bootstrapRequestedAt = () => lastBootstrapRequestedAt;

export const useBootstrap = (enabled: boolean) =>
  useQuery({
    queryKey: ["bootstrap"],
    queryFn: async () => {
      const startedAt = Date.now();
      const data = await api("/api/v1/bootstrap", { schema: BootstrapSchema });
      lastBootstrapRequestedAt = latestStamp(lastBootstrapRequestedAt, startedAt);
      return data;
    },
    enabled,
  });

export const useAppConfig = () =>
  useQuery({
    queryKey: ["app-config"],
    queryFn: () => api("/api/v1/app/config", { schema: AppConfigSchema, auth: false }),
    staleTime: 5 * 60_000,
  });

/** Every hook below takes `enabled` (the live session: `useSessionLive()`), so none fetches before hydrate, after sign-out, or while locked. */

/** The LIVE account's wallet (`GET /api/v1/wallet` always reports LIVE). */
export const useWallet = (enabled: boolean) =>
  useQuery({ queryKey: ["wallet"], queryFn: () => api("/api/v1/wallet", { schema: WalletSchema }), enabled });

/** Deposits and withdrawals, newest first, 20 per page; the cursor is the last row's `createdAt`. */
export const usePaymentsInfinite = (enabled: boolean) =>
  useInfiniteQuery({
    queryKey: ["payments"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      api(`/api/v1/payments?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ""}`, { schema: PaymentsPageSchema }),
    getNextPageParam: (last) => last.nextCursor,
    enabled,
  });

export const useDepositConfig = (enabled: boolean) =>
  useQuery({ queryKey: ["deposit-config"], queryFn: () => api("/api/v1/deposit-config", { schema: DepositConfigSchema }), enabled });

/** One deposit checkout by its token. T3a adds the `poll` option. */
export const useCheckout = (token: string, enabled: boolean) =>
  useQuery({
    queryKey: ["checkout", token],
    queryFn: () => api(`/api/v1/checkout/${encodeURIComponent(token)}`, { schema: CheckoutViewSchema }),
    enabled,
  });

export const useWithdrawalPrefill = (enabled: boolean) =>
  useQuery({ queryKey: ["withdrawal-prefill"], queryFn: () => api("/api/v1/withdrawal-prefill", { schema: WithdrawalPrefillSchema }), enabled });

const ProfileResponse = z.object({ profile: ProfileViewSchema });
/** The signed-in user's profile (`GET /api/account` wraps it in `{ profile }`). */
export const useProfile = (enabled: boolean) =>
  useQuery({ queryKey: ["profile"], queryFn: async () => (await api("/api/account", { schema: ProfileResponse })).profile, enabled });

/** After any money movement: refetch wallet, payments, ledger, payment details and deposit config, then the bootstrap. */
export const invalidateMoney = () => invalidateMoneyOn(queryClient);
