import type { Bootstrap } from "@asm/contracts";

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
