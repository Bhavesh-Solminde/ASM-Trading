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
import { pollIntervalMs } from "@/payments/checkout-poll";
import { UsdtChainStatusSchema } from "@/payments/usdt-progress";
import { ApiError, shouldRetry } from "./errors";
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

/**
 * One deposit checkout by its token (`GET /api/v1/checkout/:token`: the only status source for the app; the web's
 * `/api/deposits/<token>/status` is a different, USDT-only route). With `poll` it refetches every 4s until the status
 * is final: `poll` is true only while the screen is focused, the app is in front and the session is live, so the
 * clock stops the moment any of those ends (see `pollIntervalMs`). The interval is re-read after every fetch and
 * whenever `poll` changes.
 */
export const useCheckout = (token: string, enabled: boolean, opts: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: ["checkout", token],
    queryFn: () => api(`/api/v1/checkout/${encodeURIComponent(token)}`, { schema: CheckoutViewSchema }),
    enabled,
    refetchInterval: (query) =>
      pollIntervalMs({
        poll: opts.poll === true,
        status: query.state.data?.status,
        errorStatus: query.state.error instanceof ApiError ? query.state.error.status : null,
      }),
    refetchIntervalInBackground: false,
  });

/**
 * A USDT deposit's on-chain progress (`GET /api/deposits/:token/status`, the website's USDT poller: Bearer, ownership
 * checked, 60 requests a minute per user). Polled like the checkout, every 4s while `poll` (the pay screen is in front),
 * and stopped on the same conditions (see `pollIntervalMs`). This is the ONLY place it is polled: exactly one screen
 * hook (`useUsdtProgress`) calls it. A rate limit is silent (the checkout's own poll is the one the user depends on).
 */
export const useUsdtChainStatus = (token: string, enabled: boolean, opts: { poll?: boolean } = {}) =>
  useQuery({
    queryKey: ["usdt-chain-status", token],
    queryFn: () => api(`/api/deposits/${encodeURIComponent(token)}/status`, { schema: UsdtChainStatusSchema, silentRateLimit: true }),
    enabled,
    refetchInterval: (query) =>
      pollIntervalMs({
        poll: opts.poll === true,
        status: query.state.data?.status ?? undefined,
        errorStatus: query.state.error instanceof ApiError ? query.state.error.status : null,
      }),
    refetchIntervalInBackground: false,
  });

export const useWithdrawalPrefill = (enabled: boolean) =>
  useQuery({ queryKey: ["withdrawal-prefill"], queryFn: () => api("/api/v1/withdrawal-prefill", { schema: WithdrawalPrefillSchema }), enabled });

const ProfileResponse = z.object({ profile: ProfileViewSchema });
/** The signed-in user's profile (`GET /api/account` wraps it in `{ profile }`). */
export const useProfile = (enabled: boolean) =>
  useQuery({ queryKey: ["profile"], queryFn: async () => (await api("/api/account", { schema: ProfileResponse })).profile, enabled });

/** After any money movement: refetch wallet, payments, ledger, payment details and deposit config, then the bootstrap. */
export const invalidateMoney = () => invalidateMoneyOn(queryClient);
