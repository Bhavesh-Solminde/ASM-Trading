import { isUsdtNetwork, type PayoutMethod, type UsdtNetwork, type WithdrawalPrefill } from "@asm/contracts";
import { listWithdrawalsForActor, loadProfile } from "@asm/db";

export interface WithdrawalLike {
  method: string;
  accountHolder: string | null;
  accountNumber: string | null;
  ifsc: string | null;
  upiId: string | null;
  usdtNetwork: string | null;
  usdtAddress: string | null;
}

export interface LastPayouts {
  BANK?: { accountHolder: string; accountNumber: string; ifsc: string };
  UPI?: { upiId: string };
  USDT?: { usdtNetwork: UsdtNetwork; usdtAddress: string };
}

/** Newest complete payout destination per method, from newest-first withdrawals. */
export function lastPayoutsFrom(recent: readonly WithdrawalLike[]): { lastPayouts: LastPayouts; initialMethod: PayoutMethod | null } {
  const lastPayouts: LastPayouts = {};
  let initialMethod: PayoutMethod | null = null;
  for (const w of recent) {
    if (w.method === "BANK" && !lastPayouts.BANK && w.accountHolder && w.accountNumber && w.ifsc) {
      lastPayouts.BANK = { accountHolder: w.accountHolder, accountNumber: w.accountNumber, ifsc: w.ifsc };
      initialMethod ??= "BANK";
    } else if (w.method === "UPI" && !lastPayouts.UPI && w.upiId) {
      lastPayouts.UPI = { upiId: w.upiId };
      initialMethod ??= "UPI";
    } else if (w.method === "USDT" && !lastPayouts.USDT && w.usdtAddress && isUsdtNetwork(w.usdtNetwork)) {
      lastPayouts.USDT = { usdtNetwork: w.usdtNetwork, usdtAddress: w.usdtAddress };
      initialMethod ??= "USDT";
    }
  }
  return { lastPayouts, initialMethod };
}

export async function loadWithdrawalPrefill(userId: string): Promise<WithdrawalPrefill> {
  const [recent, profile] = await Promise.all([listWithdrawalsForActor(userId, 20), loadProfile(userId)]);
  const { lastPayouts, initialMethod } = lastPayoutsFrom(recent);
  return {
    lastPayouts,
    initialMethod,
    kycName: [profile.firstName, profile.lastName].filter(Boolean).join(" "),
    kycStatus: profile.kycStatus as WithdrawalPrefill["kycStatus"],
    heldWithdrawals: recent
      .filter((w) => w.status === "HELD")
      .map((w) => ({ id: w.id, amountMinor: w.amount, createdAt: w.createdAt.toISOString() })),
  };
}
