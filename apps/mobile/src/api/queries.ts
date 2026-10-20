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

/** The LIVE account's wallet (`GET /api/v1/wallet` always reports LIVE). */
export const useWallet = () => useQuery({ queryKey: ["wallet"], queryFn: () => api("/api/v1/wallet", { schema: WalletSchema }) });

/** Deposits and withdrawals, newest first, 20 per page; the cursor is the last row's `createdAt`. */
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

/** One deposit checkout by its token. T3a adds the `poll` option. */
export const useCheckout = (token: string) =>
  useQuery({
    queryKey: ["checkout", token],
    queryFn: () => api(`/api/v1/checkout/${encodeURIComponent(token)}`, { schema: CheckoutViewSchema }),
  });

export const useWithdrawalPrefill = () =>
  useQuery({ queryKey: ["withdrawal-prefill"], queryFn: () => api("/api/v1/withdrawal-prefill", { schema: WithdrawalPrefillSchema }) });

const ProfileResponse = z.object({ profile: ProfileViewSchema });
/** The signed-in user's profile (`GET /api/account` wraps it in `{ profile }`). */
export const useProfile = () =>
  useQuery({ queryKey: ["profile"], queryFn: async () => (await api("/api/account", { schema: ProfileResponse })).profile });

/** After any money movement: refetch wallet, payments, ledger, payment details and deposit config, then the bootstrap. */
export const invalidateMoney = () => invalidateMoneyOn(queryClient);
