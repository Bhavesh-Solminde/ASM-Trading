import { QueryClient, useQuery } from "@tanstack/react-query";
import { AppConfigSchema, BootstrapSchema } from "@asm/contracts";
import { api } from "./client";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 15_000, refetchOnWindowFocus: false } },
});

export const useBootstrap = (enabled: boolean) =>
  useQuery({ queryKey: ["bootstrap"], queryFn: () => api("/api/v1/bootstrap", { schema: BootstrapSchema }), enabled });

export const useAppConfig = () =>
  useQuery({
    queryKey: ["app-config"],
    queryFn: () => api("/api/v1/app/config", { schema: AppConfigSchema, auth: false }),
    staleTime: 5 * 60_000,
  });
