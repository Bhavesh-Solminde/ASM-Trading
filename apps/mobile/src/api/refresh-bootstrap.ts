import type { QueryClient } from "@tanstack/react-query";

/**
 * Marks the bootstrap stale and refetches it. `cancelRefetch: false` makes a trigger that fires while a fetch is
 * already running JOIN it instead of cancelling and restarting it. The default would let any repeating trigger
 * (the settlement watchdog every 10s) cancel a slow bootstrap before its response can land, which is exactly the
 * poor-network case where settlements get lost. Every bootstrap invalidation goes through here.
 */
export function refreshBootstrap(client: Pick<QueryClient, "invalidateQueries">): void {
  void client.invalidateQueries({ queryKey: ["bootstrap"] }, { cancelRefetch: false });
}
