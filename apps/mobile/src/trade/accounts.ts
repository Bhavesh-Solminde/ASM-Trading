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
 * The cached balance of the saved account (real + bonus, minor units) with its type and currency, for the top bar
 * until bootstrap arrives. Null when there is nothing usable: no snapshot, an older one without the account
 * record, or no balance saved for that account.
 */
export function staleBalance(
  resume: ResumeSnapshot | null,
): { totalMinor: number; type: "DEMO" | "LIVE"; currency: string } | null {
  if (!resume?.account) return null;
  const bal = resume.balances[resume.accountId];
  if (!bal) return null;
  return { totalMinor: Math.round(bal.realBalance + bal.bonusBalance), type: resume.account.type, currency: resume.account.currency };
}
