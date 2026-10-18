import type { NextRequest } from "next/server";
import { WalletSchema } from "@asm/contracts";
import {
  BONUS_TIERS,
  bonusPercentForDeposit,
  countCompletedDeposits,
  listAccountsForActor,
  withdrawableBalance,
} from "@asm/db";
import { getSession, noStoreJson, unauthenticated } from "@/lib/request-session";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return unauthenticated();

  const [accounts, completedDeposits] = await Promise.all([
    listAccountsForActor(session.userId),
    countCompletedDeposits(session.userId),
  ]);
  const live = accounts.find((a) => a.type === "LIVE");
  const balance = live ? await withdrawableBalance(live.id) : { withdrawable: 0, lockedBonus: 0 };

  return noStoreJson(
    WalletSchema.parse({
      accounts: accounts.map((a) => ({
        id: a.id,
        type: a.type,
        currency: a.currency,
        realBalance: a.realBalance,
        bonusBalance: a.bonusBalance,
      })),
      withdrawable: balance.withdrawable,
      lockedBonus: balance.lockedBonus,
      completedDeposits,
      nextBonusPercent: bonusPercentForDeposit(completedDeposits + 1),
      bonusTiers: [...BONUS_TIERS],
    }),
  );
}
