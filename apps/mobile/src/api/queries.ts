import { QueryClient, useQuery } from "@tanstack/react-query";
import { AppConfigSchema, BootstrapSchema } from "@asm/contracts";
import { api } from "./client";
import { shouldRetry } from "./errors";

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
      lastBootstrapRequestedAt = startedAt;
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
