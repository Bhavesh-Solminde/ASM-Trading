import type { Bootstrap } from "@asm/contracts";
import type { ResumeSnapshot } from "@/cache/codec";

export type AppAccount = Bootstrap["accounts"][number];

export function accountOfType(accounts: readonly AppAccount[], type: AppAccount["type"]): AppAccount | undefined {
  return accounts.find((a) => a.type === type);
}

/** Live is selectable only when the user has access AND a live account exists. */
export function canUseLive(accounts: readonly AppAccount[], liveAccess: boolean): boolean {
  return liveAccess && accountOfType(accounts, "LIVE") !== undefined;
}

/**
 * The account whose last 50 trades bootstrap's `recentTrades` carries: the server picks the DEMO account, else the
 * first one (`loadPlatformBootstrap`). Any other account's list has to be fetched. Keep in step with that rule.
 */
export function bootstrapTradesAccountId(accounts: readonly AppAccount[]): string | undefined {
  return (accountOfType(accounts, "DEMO") ?? accounts[0])?.id;
}

/** The saved account if it still exists (and live is allowed), else demo, else whatever there is. */
export function resolveAccount(
  accounts: readonly AppAccount[],
  savedId: string | null,
  liveAccess: boolean,
): AppAccount | undefined {
  const saved = accounts.find((a) => a.id === savedId);
  if (saved && (saved.type !== "LIVE" || liveAccess)) return saved;
  return accountOfType(accounts, "DEMO") ?? accounts[0];
}

/**
 * The balance for the top bar until bootstrap arrives, with its type and currency. A balance the store already holds
 * for the saved account (a socket push or an HTTP open result can arrive before bootstrap) beats the cached one and
 * is `live`; the cached one is stale. Null when there is nothing usable: no snapshot, an older one without the
 * account record, or no balance for that account.
 */
export function staleBalance(
  resume: ResumeSnapshot | null,
  stored?: { realBalance: number; bonusBalance: number },
): { totalMinor: number; type: "DEMO" | "LIVE"; currency: string; live: boolean } | null {
  if (!resume?.account) return null;
  const bal = stored ?? resume.balances[resume.accountId];
  if (!bal) return null;
  return {
    totalMinor: Math.round(bal.realBalance + bal.bonusBalance),
    type: resume.account.type,
    currency: resume.account.currency,
    live: stored !== undefined,
  };
}
