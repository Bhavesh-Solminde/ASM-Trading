import type { QueryClient } from "@tanstack/react-query";
import { refreshBootstrap } from "./refresh-bootstrap";

/** Every query a deposit, withdrawal or conversion can make stale. Bootstrap is not here: see `invalidateMoneyOn`. */
export const MONEY_QUERY_KEYS = ["wallet", "payments", "ledger", "payment", "deposit-config"] as const;

/** Invalidates the money queries, then the bootstrap through `refreshBootstrap` (never `["bootstrap"]` directly). */
export function invalidateMoneyOn(client: Pick<QueryClient, "invalidateQueries">): void {
  for (const key of MONEY_QUERY_KEYS) void client.invalidateQueries({ queryKey: [key] });
  refreshBootstrap(client);
}
